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

    const sh = e.range.getSheet();
    const sheetName = sh.getName();
    const row = e.range.getRow();
    const col = e.range.getColumn();
    if (!CONFIG.dailySheets.includes(sheetName) || row < 2) return;

    // === 1. Handle Posting ===
    if (col === CONFIG.cols.commit + 1) {
      const cellVal = sh.getRange(row, col).getValue();
      const isPosted = (cellVal === true || String(cellVal).toUpperCase() === 'TRUE'); // covers boolean & strings
      if (isPosted) {
        processCommittedRowWithLock(sh, row);
        updateCurrentBalance(sh, row, true); // After commit: show supplier total outstanding
      }
      return;
    }

    // === 2. Handle Supplier/Payment Type edits ===
    if (col === CONFIG.cols.supplier + 1 || col === CONFIG.cols.paymentType + 1) {
      buildPrevInvoiceDropdown(sh, row);
      updateCurrentBalance(sh, row, false); // Pre-commit preview
    }

    // === 3. Handle Invoice selection (col G) for Due ===
    if (col === CONFIG.cols.prevInvoice + 1) {
      updateCurrentBalance(sh, row, false);
    }

    // === 4. Handle Payment Amount edits ===
    if (col === CONFIG.cols.paymentAmt + 1) {
      updateCurrentBalance(sh, row, false);
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
 */
function processCommittedRowWithLock(sheet, rowNum) {
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
    timestamp: DateUtils.now(),
    sysId: rowData[CONFIG.cols.sysId] || IDGenerator.generateUUID()
  };
  
  // Store system ID if not exists
  if (!rowData[CONFIG.cols.sysId]) {
    sheet.getRange(rowNum, CONFIG.cols.sysId + 1).setValue(data.sysId);
  }
  
  // PRE-COMMIT AUDIT
  auditAction('PRE-COMMIT', data, 'Starting posting process');
  
  try {
    // 1. VALIDATION - Uses ValidationEngine.gs
    const validation = validateCommitData(data);
    if (!validation.valid) {
      setCommitStatus(sheet, rowNum, `ERROR: ${validation.error}`, "SYSTEM", DateUtils.formatTime(data.timestamp), false);
      auditAction('VALIDATION_FAILED', data, validation.error);
      return;
    }
    
    // 2. PROCESS INVOICE - Uses InvoiceManager.gs
    const invoiceResult = processInvoice(data);
    if (!invoiceResult.success) {
      setCommitStatus(sheet, rowNum, `ERROR: ${invoiceResult.error}`, "SYSTEM", DateUtils.formatTime(data.timestamp), false);
      return;
    }
    
    // 3. PROCESS PAYMENT - Uses PaymentManager.gs
    if (shouldProcessPayment(data)) {
      const paymentResult = processPayment(data);
      if (!paymentResult.success) {
        setCommitStatus(sheet, rowNum, `ERROR: ${paymentResult.error}`, "SYSTEM", DateUtils.formatTime(data.timestamp), false);
        return;
      }

      // Check if invoice is fully paid and update paid date
      SpreadsheetApp.flush();
      
      const targetInvoice = data.paymentType === 'Due' ? data.prevInvoice : data.invoiceNo;
      if (targetInvoice) {
        InvoiceManager.updatePaidDate(targetInvoice, data.supplier, data.invoiceDate);
      }
    }
    
    // 4. SUCCESS
    setCommitStatus(
      sheet,
      rowNum,
      'POSTED',
      data.enteredBy.split('@')[0],
      DateUtils.formatTime(data.timestamp),
      true
    );
    setRowBackground(sheet, rowNum, CONFIG.colors.success);
    
    // 5. Get final supplier outstanding AFTER all updates
    const supplierOutstanding = BalanceCalculator.getSupplierOutstanding(data.supplier);

    // POST-COMMIT AUDIT
    auditAction('POST-COMMIT', data, `Posting completed. Supplier outstanding: ${supplierOutstanding}`);
    
  } catch (error) {
    setCommitStatus(sheet, rowNum, `SYSTEM ERROR: ${error.message}`, "SYSTEM", DateUtils.formatTime(data.timestamp), false);
    logSystemError('processCommittedRow', error.toString());
  }
}

/**
 * Update balance preview in daily sheet
 * Shows context-appropriate balance based on payment type and post state
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh - Active sheet
 * @param {number} row - Row number
 * @param {boolean} afterCommit - Whether this is after post
 */
function updateCurrentBalance(sh, row, afterCommit) {
  const supplier = sh.getRange(row, CONFIG.cols.supplier + 1).getValue();
  const prevInvoice = sh.getRange(row, CONFIG.cols.prevInvoice + 1).getValue();
  const receivedAmt = parseFloat(sh.getRange(row, CONFIG.cols.receivedAmt + 1).getValue()) || 0;
  const paymentAmt = parseFloat(sh.getRange(row, CONFIG.cols.paymentAmt + 1).getValue()) || 0;
  const paymentType = sh.getRange(row, CONFIG.cols.paymentType + 1).getValue();

  const balanceCell = sh.getRange(row, CONFIG.cols.balance + 1); // H = Current Balance

  if (StringUtils.isEmpty(supplier) || !paymentType) {
    balanceCell.clearContent().setNote("Balance requires supplier & payment type");
    return;
  }

  const invoiceSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.invoiceSheet);
  const data = invoiceSheet.getDataRange().getValues();

  let balance = 0;
  let note = "";

  if (afterCommit) {
    // AFTER COMMIT: Always show supplier total outstanding
    balance = BalanceCalculator.getSupplierOutstanding(supplier);
    note = "Supplier total outstanding";
  } else {
    // BEFORE COMMIT: Show context-specific preview using BalanceCalculator
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

