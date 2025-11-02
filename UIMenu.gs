/**
 * UIMenu.gs - Custom Menu System for Batch Operations
 *
 * Provides UI menu for batch validation and posting operations
 * to streamline end-of-day workflow processing.
 */

/**
 * Creates custom menu when spreadsheet opens
 * This function is automatically triggered by Google Sheets onOpen event
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('📋FP - Operations')
    .addItem('Batch Validate All Rows', 'batchValidateAllRows')
    .addItem('Batch Post All Valid Rows', 'batchPostAllRows')
    .addSeparator()
    .addItem('Validate Selected Rows', 'batchValidateSelectedRows')
    .addItem('Post Selected Rows', 'batchPostSelectedRows')
    .addSeparator()
    .addItem('Clear All Post Checkboxes', 'clearAllPostCheckboxes')
    .addToUi();
}

/**
 * Validates all data rows in the current sheet without posting
 * Shows summary of validation results
 */
function batchValidateAllRows() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();

  // Check if current sheet is a daily sheet (01-31)
  if (!validateDailySheet(sheet)) {
    return;
  }

  // Confirm action
  const response = ui.alert(
    'Batch Validate All Rows',
    'This will validate all rows in the current sheet. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  const results = validateRowsInSheet(sheet);
  showValidationResults(results, false);
}

/**
 * Validates and posts all valid rows in the current sheet
 * Only posts rows that pass validation
 */
function batchPostAllRows() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();

  // Check if current sheet is a daily sheet (01-31)
  if (!validateDailySheet(sheet)) {
    return;
  }

  // Confirm action
  const response = ui.alert(
    'Batch Post All Valid Rows',
    'This will validate and post all valid rows in the current sheet.\n\n' +
    'WARNING: This action cannot be undone. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  const results = postRowsInSheet(sheet);
  showValidationResults(results, true);
}

/**
 * Validates selected rows only
 */
function batchValidateSelectedRows() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();

  // Check if current sheet is a daily sheet
  if (!validateDailySheet(sheet)) {
    return;
  }

  const selection = sheet.getActiveRange();
  const startRow = selection.getRow();
  const numRows = selection.getNumRows();

  if (startRow < CONFIG.dataStartRow) {
    ui.alert('Invalid Selection',
             `Please select data rows (row ${CONFIG.dataStartRow} and below).`,
             ui.ButtonSet.OK);
    return;
  }

  const results = validateRowsInSheet(sheet, startRow, startRow + numRows - 1);
  showValidationResults(results, false);
}

/**
 * Posts selected rows only
 */
function batchPostSelectedRows() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();

  // Check if current sheet is a daily sheet
  if (!validateDailySheet(sheet)) {
    return;
  }

  const selection = sheet.getActiveRange();
  const startRow = selection.getRow();
  const numRows = selection.getNumRows();

  if (startRow < CONFIG.dataStartRow) {
    ui.alert('Invalid Selection',
             `Please select data rows (row ${CONFIG.dataStartRow} and below).`,
             ui.ButtonSet.OK);
    return;
  }

  // Confirm action
  const response = ui.alert(
    'Batch Post Selected Rows',
    `This will validate and post ${numRows} selected row(s).\n\n` +
    'WARNING: This action cannot be undone. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  const results = postRowsInSheet(sheet, startRow, startRow + numRows - 1);
  showValidationResults(results, true);
}

/**
 * Clears all post checkboxes in the current sheet
 * Useful for resetting the sheet after batch operations
 */
function clearAllPostCheckboxes() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();

  // Check if current sheet is a daily sheet
  if (!validateDailySheet(sheet)) {
    return;
  }

  // Confirm action
  const response = ui.alert(
    'Clear All Post Checkboxes',
    'This will uncheck all post checkboxes (Column J) in the current sheet. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.dataStartRow) {
    ui.alert('No Data', 'No data rows found in this sheet.', ui.ButtonSet.OK);
    return;
  }

  // Clear all checkboxes in column J
  const postCol = CONFIG.cols.post + 1; // Convert to 1-based
  const range = sheet.getRange(CONFIG.dataStartRow, postCol, lastRow - CONFIG.dataStartRow + 1, 1);
  range.uncheck();

  SpreadsheetApp.getActiveSpreadsheet().toast(
    'All post checkboxes cleared successfully.',
    'Success',
    5
  );
}

/**
 * Validates that the current sheet is a daily sheet (01-31)
 * Helper function to eliminate code duplication across menu functions
 *
 * @param {Sheet} sheet - The sheet to validate
 * @return {boolean} True if valid daily sheet, false otherwise (alert shown to user)
 */
function validateDailySheet(sheet) {
  const ui = SpreadsheetApp.getUi();
  const sheetName = sheet.getName();

  if (!CONFIG.dailySheets.includes(sheetName)) {
    ui.alert('Invalid Sheet',
             'This operation can only be performed on daily sheets (01-31).',
             ui.ButtonSet.OK);
    return false;
  }

  return true;
}

/**
 * Validates rows in the specified sheet
 *
 * @param {Sheet} sheet - The sheet to validate
 * @param {number} startRow - Optional start row (defaults to dataStartRow)
 * @param {number} endRow - Optional end row (defaults to last row)
 * @return {Object} Validation results
 */
function validateRowsInSheet(sheet, startRow = null, endRow = null) {
  const sheetName = sheet.getName();
  const dataStartRow = CONFIG.dataStartRow;
  const lastRow = sheet.getLastRow();

  // Set default row range
  if (startRow === null) startRow = dataStartRow;
  if (endRow === null) endRow = lastRow;

  // Validate row range
  if (lastRow < dataStartRow) {
    return {
      total: 0,
      valid: 0,
      invalid: 0,
      skipped: 0,
      errors: []
    };
  }

  // Adjust end row if needed
  if (endRow > lastRow) endRow = lastRow;
  if (startRow > endRow) {
    return {
      total: 0,
      valid: 0,
      invalid: 0,
      skipped: 0,
      errors: []
    };
  }

  const numRows = endRow - startRow + 1;

  const results = {
    total: numRows,
    valid: 0,
    invalid: 0,
    skipped: 0,
    errors: []
  };

  try {
    // Read all data at once for performance
    const dataRange = sheet.getRange(startRow, 1, numRows, CONFIG.totalColumns.daily);
    const allData = dataRange.getValues();

    // Validate each row
    for (let i = 0; i < allData.length; i++) {
      const rowNum = startRow + i;
      const rowData = allData[i];

      // Skip empty rows (no supplier)
      if (!rowData[CONFIG.cols.supplier]) {
        results.skipped++;
        continue;
      }

      try {
        // Build validation data object
        const data = buildDataObject(rowData, rowNum, sheetName);

        // Validate
        const validation = validatePostData(data);

        if (validation.valid) {
          results.valid++;
        } else {
          results.invalid++;
          results.errors.push({
            row: rowNum,
            supplier: data.supplier,
            invoiceNo: data.invoiceNo || 'N/A',
            error: validation.error || validation.errors.join(', ')
          });
        }
      } catch (rowError) {
        // Handle individual row validation errors
        results.invalid++;
        results.errors.push({
          row: rowNum,
          supplier: rowData[CONFIG.cols.supplier] || 'Unknown',
          invoiceNo: rowData[CONFIG.cols.invoiceNo] || 'N/A',
          error: `Validation error: ${rowError.message}`
        });
      }
    }
  } catch (error) {
    // Handle critical errors (sheet access, config issues, etc.)
    Logger.log(`Critical error in validateRowsInSheet: ${error.message}`);
    results.errors.push({
      row: 'N/A',
      supplier: 'SYSTEM',
      invoiceNo: 'N/A',
      error: `System error: ${error.message}`
    });
  }

  // ═══ FLUSH AUDIT QUEUE ═══
  // Write any queued audit entries
  AuditLogger.flush();

  return results;
}

/**
 * Posts rows in the specified sheet
 * Only posts rows that pass validation
 *
 * @param {Sheet} sheet - The sheet to process
 * @param {number} startRow - Optional start row (defaults to dataStartRow)
 * @param {number} endRow - Optional end row (defaults to last row)
 * @return {Object} Posting results
 */
function postRowsInSheet(sheet, startRow = null, endRow = null) {
  const sheetName = sheet.getName();
  const dataStartRow = CONFIG.dataStartRow;
  const lastRow = sheet.getLastRow();

  // Set default row range
  if (startRow === null) startRow = dataStartRow;
  if (endRow === null) endRow = lastRow;

  // Validate row range
  if (lastRow < dataStartRow) {
    return {
      total: 0,
      posted: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
  }

  // Adjust end row if needed
  if (endRow > lastRow) endRow = lastRow;
  if (startRow > endRow) {
    return {
      total: 0,
      posted: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
  }

  const numRows = endRow - startRow + 1;

  // ═══ UX FEEDBACK: Show initial toast ═══
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Starting batch post of ${numRows} rows...`,
    'Processing',
    3
  );

  // Read all data at once for performance
  const dataRange = sheet.getRange(startRow, 1, numRows, CONFIG.totalColumns.daily);
  const allData = dataRange.getValues();

  const results = {
    total: numRows,
    posted: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  // ═══ BATCH OPTIMIZATION: Collect suppliers for cache invalidation ═══
  const suppliersToInvalidate = new Set();

  // Process each row
  for (let i = 0; i < allData.length; i++) {
    const rowNum = startRow + i;
    const rowData = allData[i];

    // ═══ UX FEEDBACK: Progress toast every 25 rows ═══
    if ((i + 1) % 25 === 0) {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        `Processed ${i + 1} of ${numRows} rows...`,
        'Progress',
        2
      );
    }

    // Skip empty rows (no supplier)
    if (!rowData[CONFIG.cols.supplier]) {
      results.skipped++;
      continue;
    }

    // Skip already posted rows
    const status = rowData[CONFIG.cols.status];
    if (status && status.toString().toUpperCase() === 'POSTED') {
      results.skipped++;
      continue;
    }

    try {
      // Build data object
      const data = buildDataObject(rowData, rowNum, sheetName);

      // Validate first
      const validation = validatePostData(data);

      if (!validation.valid) {
        results.failed++;
        results.errors.push({
          row: rowNum,
          supplier: data.supplier,
          invoiceNo: data.invoiceNo || 'N/A',
          error: validation.error || validation.errors.join(', ')
        });

        // Update status to show error
        const errorMsg = validation.error ||
                         (validation.errors && validation.errors.length > 0
                           ? validation.errors[0]
                           : 'Validation failed');
        setBatchPostStatus(
          sheet,
          rowNum,
          `ERROR: ${errorMsg.substring(0, 100)}`,
          data.enteredBy,
          data.timestamp,
          false,
          CONFIG.colors.error
        );

        // Log error
        AuditLogger.log('VALIDATION_FAILED', data, errorMsg);
        continue;
      }

      // Generate system ID if needed
      if (!data.sysId) {
        data.sysId = IDGenerator.generateUUID();
        sheet.getRange(rowNum, CONFIG.cols.sysId + 1, 1, 1).setValue(data.sysId);
      }

      // Get pre-posting balance
      data.preBalance = BalanceCalculator.getSupplierOutstanding(data.supplier);

      // Process invoice
      const invoiceResult = InvoiceManager.processOptimized(data);
      data.invoiceId = invoiceResult.invoiceId;

      // Process payment if applicable
      let paymentResult = null;
      if (shouldProcessPayment(data)) {
        paymentResult = PaymentManager.processOptimized(data, invoiceResult.invoiceId);
      }

      // ═══ PERFORMANCE OPTIMIZATION: Calculate balance in memory ═══
      // Instead of invalidating cache and re-reading from sheet, calculate the
      // balance change from the transaction data (instant, no sheet reads)
      //
      // Balance change by payment type:
      // - Unpaid:  +receivedAmt              (new invoice, no payment)
      // - Regular: +receivedAmt -paymentAmt  (new invoice fully paid = 0 change)
      // - Partial: +receivedAmt -paymentAmt  (new invoice partially paid)
      // - Due:     -paymentAmt               (payment only, no new invoice)

      let balanceChange = 0;
      if (data.paymentType === 'Unpaid') {
        balanceChange = data.receivedAmt;  // Add invoice amount
      } else if (data.paymentType === 'Regular') {
        balanceChange = data.receivedAmt - data.paymentAmt;  // Usually 0
      } else if (data.paymentType === 'Partial') {
        balanceChange = data.receivedAmt - data.paymentAmt;  // Positive remainder
      } else if (data.paymentType === 'Due') {
        balanceChange = -data.paymentAmt;  // Reduce balance
      }

      const finalBalance = data.preBalance + balanceChange;
      const now = new Date();
      const balanceNote = `Posted: Supplier outstanding = ${finalBalance}/-\nUpdated: ${DateUtils.formatDateTime(now)}`;

      // Update status to POSTED
      setBatchPostStatus(
        sheet,
        rowNum,
        'POSTED',
        data.enteredBy,
        data.timestamp,
        true,
        CONFIG.colors.success
      );

      // Write balance value and note
      const balanceCell = sheet.getRange(rowNum, CONFIG.cols.balance + 1);
      balanceCell.setValue(finalBalance).setNote(balanceNote);

      // Collect supplier for batch cache invalidation (done after loop)
      suppliersToInvalidate.add(data.supplier);

      // Note: Success audit logging disabled to avoid redundancy
      // InvoiceManager and PaymentManager already log INVOICE_CREATED and PAYMENT_CREATED
      // This batch-level log would create duplicate entries in AuditLog

      results.posted++;

    } catch (error) {
      results.failed++;
      results.errors.push({
        row: rowNum,
        supplier: rowData[CONFIG.cols.supplier],
        invoiceNo: rowData[CONFIG.cols.invoiceNo] || 'N/A',
        error: error.message
      });

      // Update status to show error
      setBatchPostStatus(
        sheet,
        rowNum,
        `ERROR: ${error.message.substring(0, 100)}`,
        UserResolver.getCurrentUser().split("@")[0],
        new Date(),
        false,
        CONFIG.colors.error
      );

      // Log error
      AuditLogger.logError('BATCH_POST_FAILED', error, { row: rowNum });
    }
  }

  // ═══ BATCH CACHE INVALIDATION ═══
  // Invalidate cache once per unique supplier (instead of per row)
  // PERFORMANCE: Reduces redundant invalidations by 50-90%
  for (const supplier of suppliersToInvalidate) {
    CacheManager.invalidateSupplierCache(supplier);
  }

  // ═══ FLUSH AUDIT QUEUE ═══
  // Write all queued audit entries in single batch operation
  AuditLogger.flush();

  // ═══ UX FEEDBACK: Final completion toast ═══
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Completed: ${results.posted} posted, ${results.failed} failed, ${results.skipped} skipped`,
    'Success',
    5
  );

  return results;
}

/**
 * Builds data object from row data array
 *
 * @param {Array} rowData - Array of cell values
 * @param {number} rowNum - Row number
 * @param {string} sheetName - Sheet name
 * @return {Object} Data object
 */
function buildDataObject(rowData, rowNum, sheetName) {
  return {
    supplier: rowData[CONFIG.cols.supplier],
    invoiceNo: rowData[CONFIG.cols.invoiceNo],
    receivedAmt: parseFloat(rowData[CONFIG.cols.receivedAmt]) || 0,
    paymentType: rowData[CONFIG.cols.paymentType],
    prevInvoice: rowData[CONFIG.cols.prevInvoice],
    paymentAmt: parseFloat(rowData[CONFIG.cols.paymentAmt]) || 0,
    notes: rowData[CONFIG.cols.notes] || '',
    sysId: rowData[CONFIG.cols.sysId],
    enteredBy: UserResolver.getCurrentUser().split("@")[0],
    timestamp: new Date(),
    rowNum: rowNum,
    sheetName: sheetName
  };
}

/**
 * Shows validation/posting results in a user-friendly dialog
 *
 * @param {Object} results - Results object
 * @param {boolean} isPosting - True if posting operation, false if validation only
 */
function showValidationResults(results, isPosting) {
  const ui = SpreadsheetApp.getUi();

  let message = `Total Rows Processed: ${results.total}\n`;

  if (isPosting) {
    message += `Successfully Posted: ${results.posted}\n`;
    message += `Failed: ${results.failed}\n`;
  } else {
    message += `Valid: ${results.valid}\n`;
    message += `Invalid: ${results.invalid}\n`;
  }

  message += `Skipped (empty or already posted): ${results.skipped}\n\n`;

  // Show errors if any
  if (results.errors && results.errors.length > 0) {
    message += '--- Errors ---\n';
    const maxErrors = 10; // Limit to 10 errors in dialog
    const errorsToShow = results.errors.slice(0, maxErrors);

    errorsToShow.forEach(err => {
      message += `Row ${err.row}: ${err.supplier} - ${err.invoiceNo}\n`;
      message += `  Error: ${err.error}\n\n`;
    });

    if (results.errors.length > maxErrors) {
      message += `... and ${results.errors.length - maxErrors} more errors.\n`;
      message += 'Check the Status column (K) for details.\n';
    }
  }

  // Determine title and button
  const title = isPosting ? 'Batch Posting Results' : 'Batch Validation Results';

  ui.alert(title, message, ui.ButtonSet.OK);
}
