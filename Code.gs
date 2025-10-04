/**
 * Apps Script for Supplier Accounts automation
 * - onEdit: validates and creates entries
 * - addInvoiceAndPayment: safe append logic
 * - auditLog: always records edits
*/

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
    
    // 4. CALCULATE BALANCES
    calculateBalance(data);

    const supplierOutstanding = getOutstandingForSupplier(data.supplier);
    sheet.getRange(rowNum, CONFIG.cols.balance + 1).setValue(supplierOutstanding);
    
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
      newBalance = supplierOutstanding;
  }

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
  const errors = [];

  // === 1. Required Fields ===
  if (!data.supplier) {
    return { valid: false, error: 'Supplier is required' };
  }

  if (!data.paymentType) {
    errors.push('Payment type is required');
  }

  // === 2. Numeric Validation ===
  if (isNaN(data.receivedAmt) || data.receivedAmt < 0) {
    errors.push('Received amount must be a non-negative number');
  }
  
  if (isNaN(data.paymentAmt) || data.paymentAmt < 0) {
    errors.push('Payment amount must be a non-negative number');
  }

  // === 4. Invoice Number Validation ===
  // Check length
  if (data.invoiceNo.length > 50) {
    errors.push('Invoice number cannot exceed 50 characters');
  }
  
  // === 5. Payment Type Specific Validation ===
  switch (data.paymentType) {
    case 'Unpaid':
      if (data.paymentAmt !== 0) {
        errors.push('Payment amount must be 0 for Unpaid transactions');
      }
      if (!data.invoiceNo) {
        errors.push('Invoice number is required for Unpaid transactions');
      }
      if (data.receivedAmt <= 0) {
        errors.push('Received amount must be greater than 0 for Unpaid transactions');
      }
      break;
      
    case 'Regular':
      if (!data.invoiceNo) {
        errors.push('Invoice number is required for Regular payment');
      }
      if (data.receivedAmt <= 0) {
        errors.push('Received amount must be greater than 0 for Regular payment');
      }
      if (data.paymentAmt !== data.receivedAmt) {
        errors.push(`Payment amount (${data.paymentAmt}) must equal received amount (${data.receivedAmt}) for Regular payment`);
      }
      break;
      
    case 'Partial':
      if (!data.invoiceNo) {
        errors.push('Invoice number is required for Partial payment');
      }
      if (data.receivedAmt <= 0) {
        errors.push('Received amount must be greater than 0 for Partial payment');
      }
      if (data.paymentAmt <= 0) {
        errors.push('Payment amount must be greater than 0 for Partial payment');
      }
      if (data.paymentAmt >= data.receivedAmt) {
        errors.push(`Partial payment (${data.paymentAmt}) must be less than received amount (${data.receivedAmt})`);
      }
      break;
      
    case 'Due':
      if (!data.prevInvoice) {
        errors.push('Previous invoice reference is required for Due payment');
      }
      if (data.paymentAmt <= 0) {
        errors.push('Payment amount must be greater than 0 for Due payment');
      }
      if (data.receivedAmt !== 0) {
        errors.push('Received amount must be 0 for Due payment (paying existing invoice)');
      }
      
      // Check if previous invoice exists and has sufficient balance
      if (data.prevInvoice) {
        try {
          const prevInvoice = findInvoiceRecord(data.supplier, data.prevInvoice);
          if (!prevInvoice) {
            errors.push(`Previous invoice "${data.prevInvoice}" not found for supplier "${data.supplier}"`);
          } else {
            const currentBalance = Number(prevInvoice.data[5]) || 0; // Balance Due column
            if (currentBalance <= 0) {
              errors.push(`Invoice "${data.prevInvoice}" has no outstanding balance`);
            } else if (data.paymentAmt > currentBalance) {
              errors.push(`Payment amount (${data.paymentAmt}) exceeds invoice balance (${currentBalance})`);
            }
          }
        } catch (error) {
          logSystemError('validateCommitData:prevInvoice', 
            `Error validating previous invoice: ${error.toString()}`);
          errors.push('Unable to verify previous invoice - system error');
        }
      }
      break;
      
    default:
      errors.push(`Invalid payment type: "${data.paymentType}". Must be Unpaid, Regular, Partial, or Due`);
  }

  // === 6. Business Logic Validation ===

  // Check for duplicate invoice (only for new invoices)
  if (data.invoiceNo && data.paymentType !== 'Due') {
    try {
      const existing = findInvoiceRecord(data.supplier, data.invoiceNo);
      if (existing) {
        errors.push(`Invoice "${data.invoiceNo}" already exists for supplier "${data.supplier}" at row ${existing.row}`);
      }
    } catch (error) {
      logSystemError('validateCommitData:duplicate', 
        `Error checking for duplicate invoice: ${error.toString()}`);
      // Don't block - duplicate check will happen again in createNewInvoice
    }
  }

  // === 7. Return Result ===
  if (errors.length > 0) {
    const errorMessage = errors.join('; ');
    auditAction('VALIDATION_FAILED', data, errorMessage);
    return { 
      valid: false,
      error: errorMessage,
      errors: errors // Array of individual errors
    };
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

  auditAction('INVOICE_CREATED', data, 
    `New invoice created at row ${newRow}`
  );

  return { 
    success: true, 
    action: 'created', 
    invoiceId: data.sysId + '_INV',
    row: newRow
  };
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
  paymentRow[CONFIG.paymentCols.sysId] = data.sysId + '_PAY';                    // System ID
    
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
  const totalCols = CONFIG.totalColumns.daily;
  sheet.getRange(rowNum, 1, 1, totalCols).setBackground(color); // A:N
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