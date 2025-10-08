/**
 * SYSTEM - Main Application Logic
 * Uses modular architecture with:
 * - _Config.gs for configuration
 * - _Utils.gs for utilities
 * - AuditLogger.gs for audit trail
 * - ValidationEngine.gs for validation
 * - InvoiceManager.gs for invoice operations
 * - PaymentManager.gs for payment operations
 * - BalanceCalculator.gs for balance calculations
 */

function onEdit(e) {
  const lock = LockManager.acquireDocumentLock(CONFIG.rules.LOCK_TIMEOUT_MS);

  if (!lock) {
    console.warn('onEdit: could not obtain lock; aborting.');
    return;
  }

  try {
    // Validate event object
    if (!e || !e.range) {
      console.warn('onEdit: Invalid event object');
      return;
    }

    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    const row = e.range.getRow();
    const col = e.range.getColumn();

    // Only process daily sheets, skip header row
    if (!CONFIG.dailySheets.includes(sheetName) || row < 6) return;

    // ==================== 1. HANDLE POSTING ====================
    if (col === CONFIG.cols.post + 1) {
      const cellVal = sheet.getRange(row, col).getValue();
      const isPosted = (cellVal === true || String(cellVal).toUpperCase() === 'TRUE');
      if (isPosted) {
        processPostedRowWithLock(sheet, row);
      }
      return;
    }

    // ==================== 2. HANDLE SUPPLIER EDIT ====================
    if (col === CONFIG.cols.supplier + 1) {
      buildPrevInvoiceDropdown(sheet, row);
      updateCurrentBalance(sheet, row, false);
      return;
    }

    // ==================== 3. HANDLE PAYMENT TYPE EDIT ====================
    if (col === CONFIG.cols.paymentType + 1) {
      const paymentType = sheet.getRange(row, col).getValue();
      
      // First, clean up fields from previous payment type
      clearPaymentFieldsForTypeChange(sheet, row, paymentType);
      
      // Build dropdown for Due payment type
      buildPrevInvoiceDropdown(sheet, row);
      
      // Auto-populate for Regular or Partial payment types
      if (StringUtils.equals(paymentType, 'Regular') || StringUtils.equals(paymentType, 'Partial')) {
        autoPopulatePaymentFields(sheet, row, paymentType);
      }
      
      updateCurrentBalance(sheet, row, false);
      return;
    }

    // ==================== 4. HANDLE RECEIVED AMOUNT EDIT ====================
    if (col === CONFIG.cols.receivedAmt + 1) {
      const paymentType = sheet.getRange(row, CONFIG.cols.paymentType + 1).getValue();
      
      // If payment type is Regular, sync payment amount with received amount
      if (StringUtils.equals(paymentType, 'Regular')) {
        const receivedAmt = sheet.getRange(row, col).getValue();
        sheet.getRange(row, CONFIG.cols.paymentAmt + 1).setValue(receivedAmt);
      }
      
      // If payment type is Partial, keep the existing payment amount
      // (user needs to manually adjust for partial payments)
      
      updateCurrentBalance(sheet, row, false);
      return;
    }

    // ==================== 5. HANDLE PAYMENT AMOUNT EDIT ====================
    if (col === CONFIG.cols.paymentAmt + 1) {
      updateCurrentBalance(sheet, row, false);
      return;
    }

    // ==================== 6. HANDLE PREVIOUS INVOICE SELECTION ====================
    if (col === CONFIG.cols.prevInvoice + 1) {
      updateCurrentBalance(sheet, row, false);
      return;
    }

  } catch (error) {
    console.error("onEdit error:", error);
    logSystemError("onEdit", error.toString());
  } finally {
    LockManager.releaseLock(lock);
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Clear payment fields when changing payment type
 * Handles cleanup based on new payment type selected
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
 * @param {number} row - Row number
 * @param {string} newPaymentType - New payment type selected
 */
function clearPaymentFieldsForTypeChange(sheet, row, newPaymentType) {
  try {
    const paymentAmtCell = sheet.getRange(row, CONFIG.cols.paymentAmt + 1);
    const prevInvoiceCell = sheet.getRange(row, CONFIG.cols.prevInvoice + 1);
    
    // Clear based on new payment type
    if (StringUtils.equals(newPaymentType, 'Unpaid')) {
      // Unpaid: Clear payment amount and previous invoice
      paymentAmtCell
        .clearContent()
        .clearNote()
        .setBackground(null);
      
      prevInvoiceCell
        .clearContent()
        .clearNote()
        .clearDataValidations()
        .setBackground(null);
        
    } else if (StringUtils.equals(newPaymentType, 'Due')) {
      // Due: Clear payment amount and previous invoice (dropdown will be rebuilt)
      paymentAmtCell
        .clearContent()
        .clearNote()
        .setBackground(null);
      
      prevInvoiceCell
        .clearContent()
        .clearNote()
        .clearDataValidations();
        
    } else if (StringUtils.equals(newPaymentType, 'Regular') || StringUtils.equals(newPaymentType, 'Partial')) {
      // Regular/Partial: Just clear notes and background (will be repopulated)
      paymentAmtCell
        .clearNote()
        .setBackground(null);
      
      prevInvoiceCell
        .clearNote()
        .clearDataValidations()
        .setBackground(null);
        
    } else {
      // Unknown type or empty: Clear everything
      paymentAmtCell
        .clearContent()
        .clearNote()
        .setBackground(null);
      
      prevInvoiceCell
        .clearContent()
        .clearNote()
        .clearDataValidations();
    }
    
  } catch (error) {
    logSystemError('clearPaymentFieldsForTypeChange', 
      `Failed to clear fields at row ${row}: ${error.toString()}`);
  }
}

/**
 * Auto-populate payment fields for Regular and Partial payment types
 * Copies Invoice No to Previous Invoice and Received Amount to Payment Amount
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
 * @param {number} row - Row number
 * @param {string} paymentType - Payment type (Regular or Partial)
 */
function autoPopulatePaymentFields(sheet, row, paymentType) {
  try {
    // Get invoice number from column C
    const invoiceNo = sheet.getRange(row, CONFIG.cols.invoiceNo + 1).getValue();
    
    // Get received amount from column D
    const receivedAmt = sheet.getRange(row, CONFIG.cols.receivedAmt + 1).getValue();
    
    // Set payment amount (column E) = received amount
    // For Regular: This will be full amount (validation enforces equality)
    // For Partial: This is just a starting point (user should adjust down)
    if (receivedAmt && receivedAmt !== '') {
      sheet.getRange(row, CONFIG.cols.paymentAmt + 1).setValue(receivedAmt);
    }
    
    // Set previous invoice (column G) = invoice number
    // Note: For Regular/Partial, this field is informational (not used in logic)
    // But it helps user see which invoice is being paid
    if (invoiceNo && invoiceNo !== '') {
      const note = paymentType === 'Regular' 
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
 * Process posted row with full transaction workflow
 */
function processPostedRowWithLock(sheet, rowNum) {
  const totalCols = CONFIG.totalColumns.daily;
  const rowData = sheet.getRange(rowNum, 1, 1, totalCols).getValues()[0]; // A:N

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
      setPostStatus(sheet, rowNum, `ERROR: ${validation.error}`, "SYSTEM", DateUtils.formatTime(data.timestamp), false);
      auditAction('VALIDATION_FAILED', data, validation.error);
      return;
    }
    
    // 2. PROCESS INVOICE - Uses InvoiceManager.gs
    const invoiceResult = processInvoice(data);
    if (!invoiceResult.success) {
      setPostStatus(sheet, rowNum, `ERROR: ${invoiceResult.error}`, "SYSTEM", DateUtils.formatTime(data.timestamp), false);
      return;
    }
    
    // 3. PROCESS PAYMENT - Uses PaymentManager.gs
    if (shouldProcessPayment(data)) {
      const paymentResult = processPayment(data);
      if (!paymentResult.success) {
        setPostStatus(sheet, rowNum, `ERROR: ${paymentResult.error}`, "SYSTEM", DateUtils.formatTime(data.timestamp), false);
        return;
      }

      // Check if invoice is fully paid and update paid date
      SpreadsheetApp.flush();
      
      const targetInvoice = data.paymentType === 'Due' ? data.prevInvoice : data.invoiceNo;
      if (targetInvoice) {
        InvoiceManager.updatePaidDate(targetInvoice, data.supplier, data.invoiceDate);
      }
    }
    
    // 4. Force formula recalculation
    SpreadsheetApp.flush();
    
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
    updateCurrentBalance(sheet, rowNum, true);

    // AFTER-POST AUDIT
    const supplierOutstanding = BalanceCalculator.getSupplierOutstanding(data.supplier);
    auditAction('AFTER-POST', data, `Posting completed. Supplier outstanding: ${supplierOutstanding}`);
    
  } catch (error) {
    setPostStatus(sheet, rowNum, `SYSTEM ERROR: ${error.message}`, "SYSTEM", DateUtils.formatTime(data.timestamp), false);
    logSystemError('processPostedRow', error.toString());
  }
}

/**
 * Update balance preview in daily sheet
 * Shows context-appropriate balance based on payment type and post state
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
 * @param {number} row - Row number
 * @param {boolean} afterPost - Whether this is after post
 */
function updateCurrentBalance(sheet, row, afterPost) {
  const supplier = sheet.getRange(row, CONFIG.cols.supplier + 1).getValue();
  const prevInvoice = sheet.getRange(row, CONFIG.cols.prevInvoice + 1).getValue();
  const receivedAmt = parseFloat(sheet.getRange(row, CONFIG.cols.receivedAmt + 1).getValue()) || 0;
  const paymentAmt = parseFloat(sheet.getRange(row, CONFIG.cols.paymentAmt + 1).getValue()) || 0;
  const paymentType = sheet.getRange(row, CONFIG.cols.paymentType + 1).getValue();

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

