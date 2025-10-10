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
  const sheetRow = e.range.getRow();
  const sheetCol = e.range.getColumn();

  // Skip non-daily sheets or header rows immediately
  if (sheetRow < 6 || !CONFIG.dailySheets.includes(sheetName)) return;

  // Acquire document lock for concurrent safety
  const lock = LockManager.acquireDocumentLock(CONFIG.rules.LOCK_TIMEOUT_MS);
  if (!lock) return;
  
  try {
    const configCols = CONFIG.cols;

    // ═══ SINGLE BATCH READ - ONE API CALL ═══
    const activeRow = sheet.getRange(sheetRow, 1, 1, CONFIG.totalColumns.daily);
    const rowValues = activeRow.getValues()[0];

    // Pre-extract commonly used values
    const editedValue = rowValues[sheetCol - 1];
    const paymentType = rowValues[configCols.paymentType];
    const supplier = rowValues[configCols.supplier];
    const invoiceNo = rowValues[configCols.invoiceNo];
    const receivedAmt = parseFloat(rowValues[configCols.receivedAmt]) || 0;
    const paymentAmt = parseFloat(rowValues[configCols.paymentAmt]) || 0;

    // ═══ CENTRALIZED BRANCHING - MINIMAL WRITES ═══
    switch (sheetCol) {
      // ═══ 1. HANDLE POSTING ═══
      case configCols.post + 1:
        if (editedValue === true || String(editedValue).toUpperCase() === 'TRUE') {
          // Pass pre-read data to avoid redundant read
          processPostedRowWithLock(sheet, sheetRow, rowValues);
        }
        break;

      // ═══ 2. HANDLE SUPPLIER EDIT ═══
      case configCols.supplier + 1:
        buildPrevInvoiceDropdown(sheet, sheetRow, rowValues);
        updateCurrentBalance(sheet, sheetRow, false, rowValues);
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
          sheet.getRange(sheetRow, configCols.paymentAmt + 1).setValue(receivedAmt);
        }
        updateCurrentBalance(sheet, sheetRow, false, rowValues);
        break;

      // ═══ 5. HANDLE PAYMENT TYPE EDIT ═══
      case configCols.paymentType + 1:
        clearPaymentFieldsForTypeChange(sheet, sheetRow, paymentType);
        buildPrevInvoiceDropdown(sheet, sheetRow, rowValues);
        
        if (['Regular', 'Partial'].includes(paymentType)) {
          autoPopulatePaymentFields(sheet, sheetRow, paymentType, rowValues);
        }
        
        updateCurrentBalance(sheet, sheetRow, false, rowValues);
        break;

      // ═══ 6. HANDLE PREVIOUS INVOICE SELECTION ═══
      case configCols.prevInvoice + 1:
        if ((paymentType === 'Due') && supplier && editedValue) {
          autoPopulateDuePaymentAmount(sheet, sheetRow, supplier, editedValue);
        }
        updateCurrentBalance(sheet, sheetRow, false, rowValues);
        break;

      // ═══ 7. HANDLE PAYMENT AMOUNT EDIT ═══
      case configCols.paymentAmt + 1:
        updateCurrentBalance(sheet, sheetRow, false, rowValues);
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
  // Fallback: read if not provided (for backward compatibility)
  if (!rowData) {
    const totalCols = CONFIG.totalColumns.daily;
    rowData = sheet.getRange(rowNum, 1, 1, totalCols).getValues()[0];
  }

  // Calculate timestamp and invoice date BEFORE data object
  const timestamp = DateUtils.now();
  const invoiceDate = getDailySheetDate(sheet.getName()) || timestamp;
  
  const data = {
    sheetName: sheet.getName(),
    rowNum: rowNum,
    supplier: rowData[CONFIG.cols.supplier],
    invoiceNo: rowData[CONFIG.cols.invoiceNo],
    invoiceDate: invoiceDate,
    receivedAmt: parseFloat(rowData[CONFIG.cols.receivedAmt]) || 0,
    paymentAmt: parseFloat(rowData[CONFIG.cols.paymentAmt]) || 0,
    paymentType: rowData[CONFIG.cols.paymentType],
    prevInvoice: rowData[CONFIG.cols.prevInvoice],
    notes: rowData[CONFIG.cols.notes],
    enteredBy: Session.getEffectiveUser().getEmail(),
    timestamp: timestamp,
    sysId: rowData[CONFIG.cols.sysId] || IDGenerator.generateUUID()
  };
  
  // Store system ID if not exists
  if (!rowData[CONFIG.cols.sysId]) {
    sheet.getRange(rowNum, CONFIG.cols.sysId + 1).setValue(data.sysId);
  }
  
  // BEFORE-POST AUDIT
  auditAction('BEFORE-POST', data, 'Starting posting process');
  
  try {
    // 1. VALIDATION - Uses ValidationEngine.gs
    const validation = validatePostData(data);
    if (!validation.valid) {
      setPostStatus(sheet, rowNum, `ERROR: ${validation.error}`, "SYSTEM", DateUtils.formatTime(timestamp), false);
      auditAction('VALIDATION_FAILED', data, validation.error);
      return;
    }
    
    // 2. PROCESS INVOICE - Uses InvoiceManager.gs
    const invoiceResult = processInvoice(data);
    if (!invoiceResult.success) {
      setPostStatus(sheet, rowNum, `ERROR: ${invoiceResult.error}`, "SYSTEM", DateUtils.formatTime(timestamp), false);
      return;
    }
    
    // 3. PROCESS PAYMENT - Uses PaymentManager.gs
    if (shouldProcessPayment(data)) {
      const paymentResult = processPayment(data);
      if (!paymentResult.success) {
        setPostStatus(sheet, rowNum, `ERROR: ${paymentResult.error}`, "SYSTEM", DateUtils.formatTime(timestamp), false);
        return;
      }
      
      const targetInvoice = data.paymentType === 'Due' ? data.prevInvoice : data.invoiceNo;
      if (targetInvoice) {
        InvoiceManager.updatePaidDate(targetInvoice, data.supplier, data.invoiceDate);
      }
    }
        
    // 5. SUCCESS STATUS
    setPostStatus(
      sheet,
      rowNum,
      'POSTED',
      data.enteredBy.split('@')[0],
      DateUtils.formatTime(data.timestamp),
      true  // Keep checkbox checked
    );
    setRowBackground(sheet, rowNum, CONFIG.colors.success);
    
    // 6. UPDATE BALANCE DISPLAY
    updateCurrentBalance(sheet, rowNum, true, null);

    // AFTER-POST AUDIT
    const supplierOutstanding = BalanceCalculator.getSupplierOutstanding(data.supplier);
    auditAction('AFTER-POST', data, `Posting completed. Supplier outstanding: ${supplierOutstanding}`);
    
  } catch (error) {
    setPostStatus(sheet, rowNum, `SYSTEM ERROR: ${error.message}`, "SYSTEM", DateUtils.formatTime(timestamp), false);
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
      .clearNote()
      .clearDataValidations()
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
