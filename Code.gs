/**
 * Apps Script for Supplier Accounts automation
 * Code.gs - Main Application Logic
 * Uses modular architecture with:
 * - onEdit: validates and creates entries
 * 
 * 
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

    // === 1. Handle commit ===
    if (col === CONFIG.cols.commit + 1) {
      const cellVal = sh.getRange(row, col).getValue();
      const isCommitted = (cellVal === true || String(cellVal).toUpperCase() === 'TRUE'); // covers boolean & strings
      if (isCommitted) {
        processCommittedRowWithLock(sh, row);
        // After commit: recalc balance in col H
        updateCurrentBalance(sh, row, true);
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

function processCommittedRowWithLock(sheet, rowNum) {
  const totalCols = CONFIG.totalColumns.daily;
  const rowData = sheet.getRange(rowNum, 1, 1, totalCols).getValues()[0]; // A:N
  
  const data = {
    sheetName: sheet.getName(),
    rowNum: rowNum,
    supplier: rowData[CONFIG.cols.supplier],
    invoiceNo: rowData[CONFIG.cols.invoiceNo],
    receivedAmt: parseFloat(rowData[CONFIG.cols.receivedAmt]) || 0,
    paymentAmt: parseFloat(rowData[CONFIG.cols.paymentAmt]) || 0,
    paymentType: rowData[CONFIG.cols.paymentType],
    prevInvoice: rowData[CONFIG.cols.prevInvoice],
    notes: rowData[CONFIG.cols.notes],
    enteredBy: Session.getEffectiveUser().getEmail(),
    timestamp: DateUtils.now(), // Uses DateUtils
    sysId: rowData[CONFIG.cols.sysId] || IDGenerator.generateUUID() // Uses IDGenerator
  };
  
  // Store system ID if not exists
  if (!rowData[CONFIG.cols.sysId]) {
    sheet.getRange(rowNum, CONFIG.cols.sysId + 1).setValue(data.sysId);
  }
  
  // PRE-COMMIT AUDIT
  auditAction('PRE-COMMIT', data, 'Starting commit process');
  
  try {
    // 1. VALIDATION
    const validation = validateCommitData(data);
    if (!validation.valid) {
      setCommitStatus(sheet, rowNum, `ERROR: ${validation.error}`, false);
      auditAction('VALIDATION_FAILED', data, validation.error);
      return;
    }
    
    // 2. PROCESS INVOICE
    const invoiceResult = processInvoice(data);
    if (!invoiceResult.success) {
      setCommitStatus(sheet, rowNum, `ERROR: ${invoiceResult.error}`, false);
      return;
    }
    
    // 3. PROCESS PAYMENT (only if applicable)
    if (shouldProcessPayment(data)) {
      const paymentResult = processPayment(data);
      if (!paymentResult.success) {
        setCommitStatus(sheet, rowNum, `ERROR: ${paymentResult.error}`, false);
        return;
      }
    }
    
    // 4. CALCULATE CURRENT SUPPLIER OUTSTANDING
    const supplierOutstanding = calculateBalance(data);

    // 5. UPDATE DAILY SHEET WITH SUPPLIER OUTSTANDING
    sheet.getRange(rowNum, CONFIG.cols.balance + 1).setValue(supplierOutstanding);
    
    // 6. SUCCESS
    setCommitStatus(
      sheet,
      rowNum,
      `Committed by ${data.enteredBy.split('@')[0]} @ ${DateUtils.formatTime(data.timestamp)}`, // Uses DateUtils
      true
    );
    setRowBackground(sheet, rowNum, '#E8F5E8'); // Light green
    
    // POST-COMMIT AUDIT
    auditAction('POST-COMMIT', data, `Commit completed. Supplier outstanding: ${supplierOutstanding}`);
    
  } catch (error) {
    setCommitStatus(sheet, rowNum, `SYSTEM ERROR: ${error.message}`, false);
    logSystemError('processCommittedRow', error.toString());
  }
}

/**
 * Calculate balance and update supplier ledger
 * ALWAYS returns supplier's total outstanding after transaction
 * 
 * @param {Object} data - Transaction data
 * @returns {number} Supplier's total outstanding balance (consistent across all payment types)
 */
function calculateBalance(data) {
  const supplierOutstanding = getOutstandingForSupplier(data.supplier); 
  let newBalance = supplierOutstanding;

  switch (data.paymentType) {
    case "Unpaid":
      // Add new received product once
      newBalance = supplierOutstanding + data.receivedAmt;
      break;

    case "Regular":
      // Received today and paid immediately - net effect is zero on outstanding
      newBalance = supplierOutstanding + data.receivedAmt - data.paymentAmt;
      break;

    case "Due":
      // Payment against existing invoice - use prevInvoice reference
      // Don't manually update invoice balance - formulas handle this automatically
      if (!data.prevInvoice) {
        logSystemError('calculateBalance', 'Due payment missing prevInvoice reference');
        return supplierOutstanding;
      }
      newBalance = supplierOutstanding - data.paymentAmt;
      break;
    case "Partial":
      // Partial payment on today's invoice
      // Invoice balance will be: receivedAmt - paymentAmt (handled by formulas)
      newBalance = supplierOutstanding + data.receivedAmt - data.paymentAmt;
      break;

    default:
      // Fallback → keep supplier balance unchanged
      logSystemError('calculateBalance', `Unknown payment type: ${data.paymentType}`);
      newBalance = supplierOutstanding;
  }

  return newBalance;
}

/**
 * Update balance preview in daily sheet
 * Shows context-appropriate balance based on payment type and commit state
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh - Active sheet
 * @param {number} row - Row number
 * @param {boolean} afterCommit - Whether this is after commit
 */
function updateCurrentBalance(sh, row, afterCommit) {
  const supplier = sh.getRange(row, CONFIG.cols.supplier + 1).getValue();
  const prevInvoice = sh.getRange(row, CONFIG.cols.prevInvoice + 1).getValue();
  const receivedAmt = parseFloat(sh.getRange(row, CONFIG.cols.receivedAmt + 1).getValue()) || 0;
  const paymentAmt = parseFloat(sh.getRange(row, CONFIG.cols.paymentAmt + 1).getValue()) || 0;
  const paymentType = sh.getRange(row, CONFIG.cols.paymentType + 1).getValue();

  const balanceCell = sh.getRange(row, CONFIG.cols.balance + 1); // H = Current Balance

  if (StringUtils.isEmpty(supplier) || !paymentType) { // Uses StringUtils
    balanceCell.clearContent().setNote("Balance requires supplier & payment type");
    return;
  }

  const invoiceSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.invoiceSheet);
  const data = invoiceSheet.getDataRange().getValues();

  // Helper to sum supplier’s open balances
  function getSupplierTotalOutstanding(supp) {
    return data
      .filter((r, i) => i > 0 && StringUtils.equals(r[1], supp) && r[5] > 0) // Uses StringUtils
      .reduce((sum, r) => sum + r[5], 0);
  }

  // Helper to find single invoice
  function getInvoiceBalance(supp, inv) {
    const row = data.find((r, i) => i > 0 && 
      StringUtils.equals(r[1], supp) && 
      StringUtils.equals(r[2], inv)); // Uses StringUtils
    return row ? row[5] : 0;
  }

  let balance = 0;
  let note = "";

  if (afterCommit) {
    // AFTER COMMIT: Always show supplier total outstanding
    balance = getSupplierTotalOutstanding(supplier);
    note = "Supplier total outstanding";
  } else {
    // BEFORE COMMIT: Show context-specific preview
    switch (paymentType) {
      case "Unpaid":
        balance = getSupplierTotalOutstanding(supplier) + receivedAmt;
        note = "Preview: Supplier outstanding after receiving";
        break;

      case "Regular":
        balance = getSupplierTotalOutstanding(supplier) + receivedAmt - paymentAmt;
        note = "Preview: Supplier outstanding (net zero expected)";
        break;

      case "Partial":
        balance = getSupplierTotalOutstanding(supplier) + receivedAmt - paymentAmt;
        note = "Preview: Supplier outstanding after partial payment";
        break;

      case "Due":
        if (StringUtils.isEmpty(prevInvoice)) { // Uses StringUtils
          balanceCell.clearContent().setNote("Select previous invoice");
          return;
        }
        // BEFORE COMMIT: Show specific invoice balance being paid
        const invBalance = getInvoiceBalance(supplier, prevInvoice);
        balance = invBalance;
        note = `Preview: Invoice ${prevInvoice} balance (before payment)`;
        break;

      default:
        balanceCell.clearContent().setNote("Invalid payment type");
        return;
    }
  }

  balanceCell.setValue(balance).setNote(note);
}

// PAYMENT PROCESSING
function processPayment(data) {
  const paymentSh = getSheet(CONFIG.paymentSheet); // Uses SheetUtils
  
  // Determine which invoice this payment applies to
  const targetInvoice = data.paymentType === 'Due' ? data.prevInvoice : data.invoiceNo;
  
  // Check for duplicate payment
  if (isDuplicatePayment(data.sysId)) {
    return { success: false, error: 'Duplicate payment detected' };
  }

  // Build payment row using column indices
  const paymentRow = new Array(CONFIG.totalColumns.payment);

  paymentRow[CONFIG.paymentCols.date] = data.timestamp;                          // Payment Date
  paymentRow[CONFIG.paymentCols.supplier] = data.supplier;                       // Supplier
  paymentRow[CONFIG.paymentCols.invoiceNo] = targetInvoice;                      // Invoice No
  paymentRow[CONFIG.paymentCols.paymentType] = data.paymentType;                 // Payment Type
  paymentRow[CONFIG.paymentCols.amount] = data.paymentAmt;                       // Amount
  paymentRow[CONFIG.paymentCols.method] = getPaymentMethod(data.paymentType);    // Payment Method
  paymentRow[CONFIG.paymentCols.reference] = data.notes;                         // Reference
  paymentRow[CONFIG.paymentCols.fromSheet] = data.sheetName;                     // From Sheet
  paymentRow[CONFIG.paymentCols.enteredBy] = data.enteredBy;                     // Entered By
  paymentRow[CONFIG.paymentCols.timestamp] = data.timestamp;                     // Timestamp
  paymentRow[CONFIG.paymentCols.sysId] = IDGenerator.generatePaymentId(data.sysId);                  // System ID Uses IDGenerator
    
  paymentSh.appendRow(paymentRow);
  return { success: true, action: 'logged', paymentId: IDGenerator.generatePaymentId(data.sysId) };
}
