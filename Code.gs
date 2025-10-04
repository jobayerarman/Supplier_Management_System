/**
 * Apps Script for Supplier Accounts automation
 * - onEdit: validates and creates entries
 * - addInvoiceAndPayment: safe append logic
 * - auditLog: always records edits
 */

/** CONFIG - adjust sheet names if needed */
const CONFIG = {
  dailySheets: ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30', '31'],
  invoiceSheet: 'InvoiceDatabase',
  paymentSheet: 'PaymentLog',
  supplierLedger: 'SupplierLedger',
  auditSheet: 'AuditLog',
  supplierList: 'SupplierList',
  idColHeader: 'SYS_ID', // hidden system column header to store unique ids

  // Column indices (0-based from row data array)
  cols: {
    supplier: 1,        // B
    invoiceNo: 2,       // C
    receivedAmt: 3,     // D
    paymentAmt: 4,      // E
    paymentType: 5,     // F
    prevInvoice: 6,     // G (reference invoice for Due payments)
    balance: 7,         // H (CURRENT BALANCE column)
    notes: 8,           // I
    commit: 9,          // J (checkbox)
    status: 10,         // K
    enteredBy: 11,      // L
    timestamp: 12,      // M
    sysId: 13           // N
  }
};

function onEdit(e) {
  const lock = LockService.getDocumentLock();
  let locked = false;

  try {
    locked = lock.tryLock(30000);
    if (!locked) {
      console.warn('onEdit: could not obtain lock; aborting.');
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
      updateCurrentBalance(sh, row, false); // Pre-commit view
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
    if (locked) { lock.releaseLock(); }
  }
}

function processCommittedRowWithLock(sheet, rowNum) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rowData = sheet.getRange(rowNum, 1, 1, 14).getValues()[0]; // A:N
  
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
    timestamp: new Date(),
    sysId: rowData[CONFIG.cols.sysId] || generateUUID()
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
    
    // 4. RECALCULATE BALANCES (patched logic)
    const balance = calculateBalance(data);
    sheet.getRange(rowNum, CONFIG.cols.balance + 1).setValue(balance);
    
    // 5. SUCCESS
    setCommitStatus(
      sheet,
      rowNum,
      `Committed by ${data.enteredBy.split('@')[0]} @ ${formatTime(data.timestamp)}`,
      true
    );
    setRowBackground(sheet, rowNum, '#E8F5E8'); // Light green
    
    // POST-COMMIT AUDIT
    auditAction('POST-COMMIT', data, 'Commit completed successfully');
    
  } catch (error) {
    setCommitStatus(sheet, rowNum, `SYSTEM ERROR: ${error.message}`, false);
    logSystemError('processCommittedRow', error.toString());
  }
}

function calculateBalance(data) {
  const supplierOutstanding = getOutstandingForSupplier(data.supplier); 
  let newBalance = supplierOutstanding;

  switch (data.paymentType) {
    case "Unpaid":
      // Add new received product once
      newBalance = supplierOutstanding + data.receivedAmt;
      break;

    case "Regular":
      // Received today and paid immediately
      newBalance = supplierOutstanding + data.receivedAmt - data.paymentAmt;
      break;

    case "Due":
    case "Partial":
      // Adjust based on selected invoice outstanding
      const invoiceOutstanding = getInvoiceOutstanding(data.invoiceNo || data.prevInvoice, data.supplier);
      // updateInvoiceOutstanding(data.invoiceNo, invoiceOutstanding - data.paymentAmt);
      newBalance = supplierOutstanding - data.paymentAmt;
      break;

    default:
      // Fallback → keep supplier balance unchanged
      newBalance = supplierOutstanding;
  }

  // Update central database / outstanding ledger
  // updateSupplierOutstanding(data.supplier, newBalance);
  return newBalance;
}

function buildPrevInvoiceDropdown(sh, row) {
  const supplier = sh.getRange(row, CONFIG.cols.supplier + 1).getValue();
  const paymentType = sh.getRange(row, CONFIG.cols.paymentType + 1).getValue();
  const targetCell = sh.getRange(row, CONFIG.cols.prevInvoice + 1);

  if (paymentType !== "Due" || !supplier) {
    targetCell.clearDataValidations().clearContent();
    return;
  }

  const invoiceSheet = getSheet(CONFIG.invoiceSheet);
  const lastRow = invoiceSheet.getLastRow();
  const data = invoiceSheet.getDataRange().getValues();

  const validInvoices = data
    .filter((r, i) => i > 0 && r[1] === supplier && r[5] > 0) // Supplier match + Balance Due > 0
    .map(r => r[2]); // Invoice No

  if (validInvoices.length === 0) {
    targetCell.clearDataValidations().setNote("No unpaid invoices for this supplier.");
    return;
  }

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(validInvoices, true)
    .setAllowInvalid(false)
    .build();

  targetCell.setDataValidation(rule);
  targetCell.setNote("Select invoice for due payment");
}

function updateCurrentBalance(sh, row, afterCommit) {
  const supplier = sh.getRange(row, CONFIG.cols.supplier + 1).getValue();
  const invoiceNo = sh.getRange(row, CONFIG.cols.invoiceNo + 1).getValue();
  const prevInvoice = sh.getRange(row, CONFIG.cols.prevInvoice + 1).getValue();
  const receivedAmt = parseFloat(sh.getRange(row, CONFIG.cols.receivedAmt + 1).getValue()) || 0;
  const paymentAmt = parseFloat(sh.getRange(row, CONFIG.cols.paymentAmt + 1).getValue()) || 0;
  const paymentType = sh.getRange(row, CONFIG.cols.paymentType + 1).getValue();

  const balanceCell = sh.getRange(row, CONFIG.cols.balance + 1); // H = Current Balance

  if (!supplier || !paymentType) {
    balanceCell.clearContent().setNote("Balance requires supplier & payment type");
    return;
  }

  const invoiceSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.invoiceSheet);
  const data = invoiceSheet.getDataRange().getValues();

  // Helper to sum supplier’s open balances
  function getSupplierTotalOutstanding(supp) {
    return data
      .filter((r, i) => i > 0 && r[1] === supp && r[5] > 0)
      .reduce((sum, r) => sum + r[5], 0);
  }

  // Helper to find single invoice
  function getInvoiceBalance(supp, inv) {
    const row = data.find((r, i) => i > 0 && r[1] === supp && r[2] == inv);
    return row ? row[5] : 0;
  }

  let balance = 0;

  switch (paymentType) {
    case "Unpaid":
      balance = getSupplierTotalOutstanding(supplier) + receivedAmt;
      break;

    case "Regular":
      balance = getSupplierTotalOutstanding(supplier); // invoice is instantly balanced
      break;

    case "Partial":
      balance = receivedAmt - paymentAmt;
      break;

    case "Due":
      if (!prevInvoice) {
        balanceCell.clearContent().setNote("Select previous invoice");
        return;
      }
      const invBalance = getInvoiceBalance(supplier, prevInvoice);
      balance = afterCommit ? invBalance - paymentAmt : invBalance;
      break;

    default:
      balanceCell.clearContent().setNote("Invalid payment type");
      return;
  }

  balanceCell.setValue(balance).setNote("Calculated balance");
}

/**
 * Sum current outstanding (Balance Due) for a supplier from InvoiceDatabase.
 * Returns a Number (0 if none).
 */
function getOutstandingForSupplier(supplier) {
  if (!supplier) return 0;

  const invoiceSh = getSheet(CONFIG.invoiceSheet);
  const data = invoiceSh.getDataRange().getValues();
  let total = 0;
  for (let i = 1; i < data.length; i++) { // skip header row
    try {
      const rowSupplier = (data[i][1] || '').toString().trim();
      if (rowSupplier === supplier.toString().trim()) {
        const bal = Number(data[i][5]) || 0; // Balance Due is column F (index 5)
        total += bal;
      }
    } catch (e) {
      // skip bad rows silently
    }
  }
  return total;
}

/**
 * Get Balance Due for a specific invoice (supplier + invoiceNo).
 * Returns Number or 0 if not found.
 */
function getInvoiceOutstanding(invoiceNo, supplier) {
  if (!invoiceNo || !supplier) return 0;
  // use existing findInvoiceRecord which expects supplier + invoice
  const rec = findInvoiceRecord(supplier, invoiceNo);
  if (!rec) return 0;
  return Number(rec.data[5]) || 0; // column F (index 5)
}

// VALIDATION ENGINE
function validateCommitData(data) {
  // Negative amounts
  if (data.receivedAmt < 0 || data.paymentAmt < 0) {
    return { valid: false, error: 'Amounts cannot be negative' };
  }

  // Required fields check
  if (!data.supplier) {
    return { valid: false, error: 'Supplier is required' };
  }
  
  // Payment type specific validations
  switch (data.paymentType) {
    case 'Unpaid':
      if (data.paymentAmt !== 0) {
        return { valid: false, error: 'Payment amount must be 0 for Unpaid' };
      }
      if (!data.invoiceNo) {
        return { valid: false, error: 'Invoice number required for Unpaid' };
      }
      break;
      
    case 'Regular':
      if (data.paymentAmt !== data.receivedAmt) {
        return { valid: false, error: 'Payment amount must equal received amount for Regular payment' };
      }
      if (!data.invoiceNo) {
        return { valid: false, error: 'Invoice number required for Regular payment' };
      }
      break;
      
    case 'Partial':
      if (data.paymentAmt <= 0 || data.paymentAmt >= data.receivedAmt) {
        return { valid: false, error: 'Partial payment must be between 0 and received amount' };
      }
      if (!data.invoiceNo) {
        return { valid: false, error: 'Invoice number required for Partial payment' };
      }
      break;
      
    case 'Due':
      if (!data.prevInvoice) {
        return { valid: false, error: 'Previous invoice reference required for Due payment' };
      }
      if (data.paymentAmt <= 0) {
        return { valid: false, error: 'Payment amount required for Due payment' };
      }
      
      // Check if previous invoice exists and has sufficient balance
      const prevInvoice = findInvoiceRecord(data.supplier, data.prevInvoice);
      if (!prevInvoice) {
        return { valid: false, error: `Previous invoice ${data.prevInvoice} not found` };
      }
      
      const currentBalance = prevInvoice.data[5]; // Balance Due column
      if (data.paymentAmt > currentBalance) {
        return { valid: false, error: `Payment amount (${data.paymentAmt}) exceeds invoice balance (${currentBalance})` };
      }
      break;
      
    default:
      return { valid: false, error: 'Invalid payment type' };
  }
  
  return { valid: true };
}

// INVOICE PROCESSING
function processInvoice(data) {
  const invoiceSh = getSheet(CONFIG.invoiceSheet);
  
  // For Due payments, we don't create new invoices
  if (data.paymentType === 'Due' && !data.invoiceNo) {
    return { success: true, action: 'none' };
  }
  
  // Check if invoice already exists
  const existingInvoice = data.invoiceNo ? findInvoiceRecord(data.supplier, data.invoiceNo) : null;
  
  if (existingInvoice) {
    // Update existing invoice if needed (e.g., amount correction)
    return updateExistingInvoice(existingInvoice, data);
  } else {
    // Create new invoice
    return createNewInvoice(data);
  }
}

function createNewInvoice(data) {
  // Double-check invoice doesn't exist
  if (findInvoiceRecord(data.supplier, data.invoiceNo)) {
    return { success: false, error: 'Invoice already exists' };
  }

  const invoiceSh = getSheet(CONFIG.invoiceSheet);
  const lastRow = invoiceSh.getLastRow();

  const newInvoice = [
    data.timestamp,          // A: Date
    data.supplier,           // B: Supplier
    data.invoiceNo,          // C: Invoice No
    data.receivedAmt,        // D: Total Amount
    '', '', '',              // E,F,G handled by formulas
    data.sheetName,          // H: Origin Day
    '',                      // I: Days Outstanding (formula)
    data.sysId + '_INV'      // J: System ID
  ];

  invoiceSh.appendRow(newInvoice);

  // Apply formulas to new row (E,F,G,I)
  const newRow = lastRow + 1;
  invoiceSh.getRange(`E${newRow}`).setFormula(`=IF(C${newRow}="","", IFERROR(SUMIF(PaymentLog!C:C, C${newRow}, PaymentLog!E:E), 0))`);
  invoiceSh.getRange(`F${newRow}`).setFormula(`=IF(D${newRow}="","", D${newRow} - E${newRow})`);
  invoiceSh.getRange(`G${newRow}`).setFormula(`=IFS(F${newRow}=0,"Paid", F${newRow}=D${newRow},"Unpaid", F${newRow}<D${newRow},"Partial")`);
  invoiceSh.getRange(`I${newRow}`).setFormula(`=IF(F${newRow}=0,0, TODAY()-A${newRow})`);

  return { success: true, action: 'created', invoiceId: data.sysId + '_INV' };
}

function updateExistingInvoice(existingInvoice, data) {
  // existingInvoice: { row: <sheetRow>, data: <rowArray> }
  const invoiceSh = getSheet(CONFIG.invoiceSheet);
  if (!existingInvoice || !invoiceSh) {
    return { success: false, error: 'Invoice or sheet not found' };
  }
  const rowNum = existingInvoice.row;
  try {
    const currentTotal = Number(existingInvoice.data[3]) || 0; // column D
    if (data.receivedAmt !== currentTotal) {
      invoiceSh.getRange(rowNum, 4).setValue(data.receivedAmt); // update Total Amount (col D)
    }
    // touch the row to trigger formulas (optional)
    invoiceSh.getRange(rowNum, 1).setValue(invoiceSh.getRange(rowNum, 1).getValue());
    return { success: true, action: 'updated', row: rowNum };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// PAYMENT PROCESSING
function processPayment(data) {
  const paymentSh = getSheet(CONFIG.paymentSheet);
  
  // Determine which invoice this payment applies to
  const targetInvoice = data.paymentType === 'Due' ? data.prevInvoice : data.invoiceNo;
  
  // Check for duplicate payment
  if (isDuplicatePayment(data.sysId)) {
    return { success: false, error: 'Duplicate payment detected' };
  }
  
  const paymentRow = [
    data.timestamp,                    // Payment Date
    data.supplier,                     // Supplier
    targetInvoice,                     // Invoice No
    data.paymentType,                  // Payment Type
    data.paymentAmt,                   // Amount
    getPaymentMethod(data.paymentType), // Payment Method
    data.notes,                        // Reference
    data.sheetName,                    // From Sheet
    data.enteredBy,                    // Entered By
    data.timestamp,                    // Timestamp
    data.sysId + '_PAY'                // System ID
  ];
  
  paymentSh.appendRow(paymentRow);
  return { success: true, action: 'logged', paymentId: data.sysId + '_PAY' };
}

// HELPER FUNCTIONS
function shouldProcessPayment(data) {
  return data.paymentAmt > 0 || data.paymentType === 'Regular';
}

function isDuplicatePayment(sysId) {
  const paymentSh = getSheet(CONFIG.paymentSheet);
  if (!paymentSh) return false;
  const lastCol = paymentSh.getLastColumn();
  const headers = paymentSh.getRange(1, 1, 1, lastCol).getValues()[0];
  const idIndex = headers.indexOf(CONFIG.idColHeader); // returns -1 if not present

  const searchId = sysId + '_PAY';
  const startRow = 2;
  const lastRow = paymentSh.getLastRow();
  if (lastRow < startRow) return false;

  if (idIndex >= 0) {
    const vals = paymentSh.getRange(startRow, idIndex + 1, lastRow - 1, 1).getValues().flat();
    return vals.some(v => v === searchId);
  } else {
    // fallback: search last column
    const vals = paymentSh.getRange(startRow, lastCol, lastRow - 1, 1).getValues().flat();
    return vals.some(v => v === searchId);
  }
}

function setCommitStatus(sheet, rowNum, status, resetCommit) {
  sheet.getRange(rowNum, CONFIG.cols.status + 1).setValue(status);
  if (resetCommit) {
    sheet.getRange(rowNum, CONFIG.cols.commit + 1).setValue(false);
  }
}

function setRowBackground(sheet, rowNum, color) {
  sheet.getRange(rowNum, 1, 1, 14).setBackground(color); // A:N
}

function recalculateInvoiceBalances(invoiceNo, supplier) {
  // This triggers sheet formulas to recalc
  // For large datasets, you might want script-based recalculation
  const invoiceSh = getSheet(CONFIG.invoiceSheet);
  invoiceSh.getRange('A:Z').sort(1); // Simple trigger
}

function auditAction(action, data, message) {
  const auditSh = getSheet(CONFIG.auditSheet);
  const auditRow = [
    new Date(),
    data.enteredBy,
    data.sheetName,
    `Row ${data.rowNum}`,
    action,
    JSON.stringify({
      supplier: data.supplier,
      invoice: data.invoiceNo,
      prevInvoice: data.prevInvoice,
      receivedAmt: data.receivedAmt,
      paymentAmt: data.paymentAmt,
      paymentType: data.paymentType,
      sysId: data.sysId
    }),
    message
  ];
  
  auditSh.appendRow(auditRow);
}

// UTILITY FUNCTIONS
function generateUUID() {
  return 'inv_' + Utilities.getUuid();
}

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    logSystemError('getSheet', `Sheet "${name}" not found`);
    throw new Error(`Required sheet "${name}" does not exist`);
  }
  return sheet;
}

function findInvoiceRecord(supplier, invoiceNo) {
  const invoiceSh = getSheet(CONFIG.invoiceSheet);
  const data = invoiceSh.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][1].toString().trim() === supplier.toString().trim() &&
        data[i][2].toString().trim() === invoiceNo.toString().trim()) {
      return { row: i + 1, data: data[i] };
    }
  }
  return null;
}

function getPaymentMethod(paymentType) {
  const methods = {
    'Regular': 'Cash',
    'Partial': 'Cash', 
    'Due': 'Cash',
    'Unpaid': 'None'
  };
  return methods[paymentType] || 'Cash';
}

function formatTime(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'HH:mm:ss');
}

function logSystemError(context, message) {
  const auditSh = getSheet(CONFIG.auditSheet);
  auditSh.appendRow([
    new Date(),
    'SYSTEM',
    'N/A',
    'N/A',
    'SYSTEM_ERROR',
    context,
    message
  ]);
}