/**
 * SYSTEM - Main Application Logic (Code.gs)
 * Modular Architecture:
 * - _Config.gs → global config
 * - _Utils.gs → helpers
 * - AuditLogger.gs → audit trail
 * - ValidationEngine.gs → validation
 * - InvoiceManager.gs → invoice operations
 * - PaymentManager.gs → payment operations
 * - BalanceCalculator.gs → balance + cache
 *
 * PERFORMANCE STRATEGY:
 * - Single batch read per edit event
 * - Zero redundant cell reads
 * - Cached balance lookups (3–5min)
 * - Minimal SpreadsheetApp API calls
 * - Graceful concurrency with document locks
 */

function onEdit(e) {
  // Validate event object
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  const row = e.range.getRow();
  const col = e.range.getColumn();

  // Skip non-daily sheets or header rows immediately
  if (row < 6 || !CONFIG.dailySheets.includes(sheetName)) return;

  // Acquire document lock for concurrent safety
  const lock = LockManager.acquireDocumentLock(CONFIG.rules.LOCK_TIMEOUT_MS);
  if (!lock) return;
  
  try {
    const configCols = CONFIG.cols;

    // ═══ SINGLE BATCH READ - ONE API CALL ═══
    const activeRow = sheet.getRange(row, 1, 1, CONFIG.totalColumns.daily);
    const rowValues = activeRow.getValues()[0];

    // Pre-extract commonly used values
    const editedValue = rowValues[col - 1];
    const paymentType = rowValues[configCols.paymentType];
    const supplier = rowValues[configCols.supplier];
    const invoiceNo = rowValues[configCols.invoiceNo];
    const receivedAmt = parseFloat(rowValues[configCols.receivedAmt]) || 0;
    const paymentAmt = parseFloat(rowValues[configCols.paymentAmt]) || 0;

    // ═══ CENTRALIZED BRANCHING - MINIMAL WRITES ═══
    switch (col) {
      // ═══ 1. HANDLE POSTING ═══
      case configCols.post + 1:
        if (editedValue === true || String(editedValue).toUpperCase() === 'TRUE') {
          // Pass pre-read data to avoid redundant read
          processPostedRowWithLock(sheet, row, rowValues);
        }
        break;

      // ═══ 2. HANDLE SUPPLIER EDIT ═══
      case configCols.supplier + 1:
        buildUnpaidDropdown(sheet, row, supplier, paymentType);
        updateCurrentBalance(sheet, row, false, rowValues);
        break;

      // ═══ 3. HANDLE INVOICE NO EDIT ═══
      case configCols.invoiceNo + 1:
        if (['Regular', 'Partial'].includes(paymentType)) {
          if (invoiceNo) sheet.getRange(row, cols.prevInvoice + 1).setValue(invoiceNo);
        }
        break;
    
      // ═══ 4. HANDLE RECEIVED AMOUNT EDIT ═══
      case configCols.receivedAmt + 1:
        if (paymentType === 'Regular') {
          sheet.getRange(row, configCols.paymentAmt + 1).setValue(receivedAmt);
        }
        updateCurrentBalance(sheet, row, false, rowValues);
        break;

      // ═══ 5. HANDLE PAYMENT TYPE EDIT ═══
      case configCols.paymentType + 1:
        clearPaymentFieldsForTypeChange(sheet, row, paymentType);
        buildUnpaidDropdown(sheet, row, supplier, paymentType);
        
        if (['Regular', 'Partial'].includes(paymentType)) {
          autoPopulatePaymentFields(sheet, row, paymentType, rowValues);
        }
        
        updateCurrentBalance(sheet, row, false, rowValues);
        break;

      // ═══ 6. HANDLE PREVIOUS INVOICE SELECTION ═══
      case configCols.prevInvoice + 1:
        if ((paymentType === 'Due') && supplier && editedValue) {
          autoPopulateDuePaymentAmount(sheet, row, supplier, editedValue);
        }
        updateCurrentBalance(sheet, row, false, rowValues);
        break;

      // ═══ 7. HANDLE PAYMENT AMOUNT EDIT ═══
      case configCols.paymentAmt + 1:
        updateCurrentBalance(sheet, row, false, rowValues);
        break;
      
      default:
        return; // Nothing to process
    }

  } catch (error) {
    console.error("onEdit error:", error);
    logSystemError("onEdit", error.toString());
  } finally {
    LockManager.releaseLock(lock);
  }
}

/**
 * Process posted row with full transaction workflow
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
 * @param {number} rowNum - Row number
 * @param {Array} rowData - Pre-read row values (optional, will read if not provided)
 */
function processPostedRowWithLock(sheet, rowNum, rowData = null) {
  const cols = CONFIG.cols;
  const totalCols = CONFIG.totalColumns.daily;
  const colors = CONFIG.colors;
  const now = DateUtils.now();
  const timeStr = DateUtils.formatTime(now);
  const sheetName = sheet.getName();

  try {
    // ═══ 1. DATA EXTRACTION (Zero additional reads) ═══
    // Fallback to single batch read only if not provided
    if (!rowData) {
      rowData = sheet.getRange(rowNum, 1, 1, totalCols).getValues()[0];
    }

    const supplier = rowData[cols.supplier];
    const invoiceNo = rowData[cols.invoiceNo];
    const paymentType = rowData[cols.paymentType];
    const prevInvoice = rowData[cols.prevInvoice];
    const receivedAmt = parseFloat(rowData[cols.receivedAmt]) || 0;
    const paymentAmt = parseFloat(rowData[cols.paymentAmt]) || 0;
    const sysId = rowData[cols.sysId] || IDGenerator.generateUUID();

    const invoiceDate = getDailySheetDate(sheetName) || now;
    const enteredBy = Session.getEffectiveUser().getEmail();

    // Build transaction context object
    const data = {
      sheetName,
      rowNum,
      supplier,
      invoiceNo,
      invoiceDate,
      receivedAmt,
      paymentAmt,
      paymentType,
      prevInvoice,
      notes: rowData[cols.notes],
      enteredBy,
      timestamp: now,
      sysId
    };
    
    // ═══ 2. EARLY VALIDATION (Fail Fast) ═══
    const validation = validatePostData(data);
    if (!validation.valid) {
      setPostStatus(sheet, rowNum, `ERROR: ${validation.error}`, "SYSTEM", timeStr, false);
      auditAction('VALIDATION_FAILED', data, validation.error);
      return;
    }
    
    // ═══ 3. WRITE SYSTEM ID (Only if missing) ═══
    if (!rowData[cols.sysId]) {
      sheet.getRange(rowNum, cols.sysId + 1).setValue(data.sysId);
    }

    // BEFORE-POST AUDIT
    auditAction("BEFORE-POST", data, "Starting posting process");

    // ═══ 4. PRE-CALCULATE BALANCE (Before invoice/payment) ═══
    const currentOutstanding = BalanceCalculator.getSupplierOutstanding(supplier);
    data.preBalance = currentOutstanding;
    
    // ═══ 5. PROCESS INVOICE (Returns existing invoice if found) ═══
    const invoiceResult = processInvoice(data);
    if (!invoiceResult.success) {
      setPostStatus(sheet, rowNum, `ERROR: ${invoiceResult.error}`, "SYSTEM", timeStr, false);
      return;
    }
    
    // ═══ 6. PROCESS PAYMENT (Conditional, with pre-calculated balance) ═══
    if (shouldProcessPayment(data)) {
      const paymentResult = processPayment(data);
      if (!paymentResult.success) {
        setPostStatus(sheet, rowNum, `ERROR: ${paymentResult.error}`, "SYSTEM", timeStr, false);
        return;
      }
      // Update paid date if invoice fully settled
      const targetInvoice = paymentType === "Due" ? prevInvoice : invoiceNo;
      if (targetInvoice) {
        InvoiceManager.updatePaidDate(targetInvoice, supplier, invoiceDate);
      }
    }

    // ═══ 7. CALCULATE FINAL BALANCE (Using cached supplier outstanding) ═══
    const supplierOutstanding = BalanceCalculator.getSupplierOutstanding(supplier);
    updateCurrentBalance(sheet, rowNum, true, null);

    // ═══ 8. BATCH SUCCESS UPDATE (Single API call) ═══
    setPostStatus(sheet, rowNum, "POSTED", enteredBy.split("@")[0], timeStr, true);  // Keep checkbox checked
    setRowBackground(sheet, rowNum, colors.success);

    // ═══ 9. UPDATE BALANCE CELL (Uses finalBalance, no recalculation) ═══
    sheet.getRange(rowNum, cols.balance + 1)
      .setValue(finalBalance)
      .setNote(`Posted: Supplier outstanding = ${finalBalance}`);

    // ═══ 10. SURGICAL CACHE INVALIDATION (Supplier-specific only) ═══
    InvoiceCache.invalidateSupplierCache(supplier);

    // ═══ 11. FINAL AUDIT ═══
    auditAction('AFTER-POST', data, `Posted successfully | Balance: ${currentOutstanding} → ${finalBalance}`);

  } catch (error) {
    const errMsg = `SYSTEM ERROR: ${error.message || error}`;
    setPostStatus(sheet, rowNum, errMsg, "SYSTEM", timeStr, false);
    logSystemError('processPostedRow', error.toString());
  }
}

/**
 * Update balance preview in daily sheet
 * Shows context-appropriate balance based on payment type and post state
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
 * @param {number} row - Row number
 * @param {boolean} afterPost - Whether this is after post
 * @param {Array} rowData - Pre-read row values (optional, will read if not provided)
 */
function updateCurrentBalance(sheet, row, afterPost, rowData = null) {
  // Fallback: read if not provided (for backward compatibility or post-post refresh)
  if (!rowData) {
    rowData = sheet.getRange(row, 1, 1, CONFIG.totalColumns.daily).getValues()[0];
  }

  const supplier = rowData[CONFIG.cols.supplier];
  const prevInvoice = rowData[CONFIG.cols.prevInvoice];
  const receivedAmt = parseFloat(rowData[CONFIG.cols.receivedAmt]) || 0;
  const paymentAmt = parseFloat(rowData[CONFIG.cols.paymentAmt]) || 0;
  const paymentType = rowData[CONFIG.cols.paymentType];

  const balanceCell = sheet.getRange(row, CONFIG.cols.balance + 1); // H = Current Balance

  if (StringUtils.isEmpty(supplier) || !paymentType) {
    balanceCell.clearContent().setNote("Balance requires supplier & payment type");
    return;
  }

  let balance = 0;
  let note = "";

  if (afterPost) {
    // AFTER-POST: Always show supplier total outstanding
    balance = BalanceCalculator.getSupplierOutstanding(supplier);
    note = "Supplier total outstanding";
  } else {
    // BEFORE-POST: Show context-specific preview using BalanceCalculator
    const preview = BalanceCalculator.calculatePreview(
      supplier,
      paymentType,
      receivedAmt,
      paymentAmt,
      prevInvoice
    );
    balance = preview.balance;
    note = preview.note;
  }

  balanceCell.setValue(balance).setNote(note);
}

// ═══ HELPER FUNCTIONS ═══

/**
 * Clear payment fields when changing payment type
 * Handles cleanup based on new payment type selected
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
 * @param {number} row - Row number
 * @param {string} newPaymentType - New payment type selected
 */
function clearPaymentFieldsForTypeChange(sheet, row, newPaymentType) {
  const paymentAmtCell = sheet.getRange(row, CONFIG.cols.paymentAmt + 1);
  const prevInvoiceCell = sheet.getRange(row, CONFIG.cols.prevInvoice + 1);
  
  try {
    paymentAmtCell
      .clearContent()
      .clearNote()
      .setBackground(null);
    
    prevInvoiceCell
      .clearDataValidations()
      .clearNote()
      .setBackground(null);

    if (['Unpaid', 'Due'].includes(newPaymentType))
      prevInvoiceCell.clearContent();
    
  } catch (error) {
    logSystemError('clearPaymentFieldsForTypeChange', 
      `Failed to clear fields at row ${row}: ${error.toString()}`);
  }
}

/**
 * Auto-populate payment amount for Due payment type
 * Fills payment amount with the balance due of selected invoice
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
 * @param {number} row - Row number
 * @param {string} supplier - Supplier name
 * @param {string} prevInvoice - Selected previous invoice number
 */
function autoPopulateDuePaymentAmount(sheet, row, supplier, prevInvoice) {
  try {
    // Get the balance due for the selected invoice
    const invoiceBalance = BalanceCalculator.getInvoiceOutstanding(prevInvoice, supplier);
    const targetCell = sheet.getRange(row, CONFIG.cols.paymentAmt + 1);
    
    if (invoiceBalance > 0) {
      // Set payment amount to invoice balance
      targetCell
        .setValue(invoiceBalance)
        .setNote(`Auto-populated: Outstanding balance of ${prevInvoice}`)
        .setBackground(CONFIG.colors.info);
    } else {
      // Invoice has no balance or not found
      targetCell
        .clearContent()
        .setNote(`⚠️ Invoice ${prevInvoice} has no outstanding balance`)
        .setBackground(CONFIG.colors.warning);
    }
    
  } catch (error) {
    logSystemError('autoPopulateDuePaymentAmount', 
      `Failed to auto-populate due payment at row ${row}: ${error.toString()}`);
    
    targetCell
      .clearContent()
      .setNote('Error loading invoice balance')
      .setBackground(CONFIG.colors.error);
  }
}

/**
 * Auto-populate payment fields for Regular and Partial payment types
 * Copies Invoice No to Previous Invoice and Received Amount to Payment Amount
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
 * @param {number} row - Row number
 * @param {string} paymentType - Payment type (Regular or Partial)
 * @param {Array} rowData - Pre-read row values
 */
function autoPopulatePaymentFields(sheet, row, paymentType, rowData) {
  try {
    // Extract values from pre-read data
    const invoiceNo = rowData[CONFIG.cols.invoiceNo];
    const receivedAmt = rowData[CONFIG.cols.receivedAmt];
    
    // Set payment amount (column G) = received amount
    // For Regular: This will be full amount (validation enforces equality)
    // For Partial: This is just a starting point (user should adjust down)
    if (receivedAmt && receivedAmt !== '') {
      sheet.getRange(row, CONFIG.cols.paymentAmt + 1).setValue(receivedAmt);
    }
    
    // Set previous invoice (column F) = invoice number
    // Note: For Regular/Partial, this field is informational (not used in logic)
    // But it helps user see which invoice is being paid
    if (invoiceNo && invoiceNo !== '') {
      const note = StringUtils.equals(paymentType, 'Regular')
        ? 'Auto-populated for Regular payment' 
        : 'Auto-populated for Partial payment - adjust payment amount as needed';
      
      sheet.getRange(row, CONFIG.cols.prevInvoice + 1)
        .setValue(invoiceNo)
        .setNote(note);
    }
    
    // Add visual cue for Partial payments
    if (StringUtils.equals(paymentType, 'Partial')) {
      // Highlight payment amount cell to remind user to adjust
      sheet.getRange(row, CONFIG.cols.paymentAmt + 1)
        .setBackground(CONFIG.colors.warning)
        .setNote('⚠️ Adjust this to partial payment amount (must be less than received amount)');
    } else {
      // Clear any previous highlighting for Regular
      sheet.getRange(row, CONFIG.cols.paymentAmt + 1)
        .setBackground(null)
        .setNote('Auto-populated (equals received amount)');
    }
    
  } catch (error) {
    logSystemError('autoPopulatePaymentFields', 
      `Failed to auto-populate at row ${row}: ${error.toString()}`);
  }
}

/**
 * Build previous invoice dropdown with optimized supplier detection
 * OPTIMIZED: Accepts pre-read row data
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
 * @param {number} row - Row number
 * @param {Array} rowData - Pre-read row values (optional)
 */
function buildPrevInvoiceDropdown(sheet, row, rowData = null) {
  // Fallback for direct calls
  if (!rowData) {
    rowData = sheet.getRange(row, 1, 1, CONFIG.totalColumns.daily).getValues()[0];
  }
  
  const supplier = rowData[CONFIG.cols.supplier];
  const paymentType = rowData[CONFIG.cols.paymentType];
  
  return InvoiceManager.buildUnpaidDropdown(sheet, row, supplier, paymentType);
}
