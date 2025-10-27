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

  ui.createMenu('SMS Operations')
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
  const sheetName = sheet.getName();

  // Check if current sheet is a daily sheet (01-31)
  if (!CONFIG.dailySheets.includes(sheetName)) {
    ui.alert('Invalid Sheet',
             'Batch validation can only be performed on daily sheets (01-31).',
             ui.ButtonSet.OK);
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
  const sheetName = sheet.getName();

  // Check if current sheet is a daily sheet (01-31)
  if (!CONFIG.dailySheets.includes(sheetName)) {
    ui.alert('Invalid Sheet',
             'Batch posting can only be performed on daily sheets (01-31).',
             ui.ButtonSet.OK);
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
  const sheetName = sheet.getName();

  // Check if current sheet is a daily sheet
  if (!CONFIG.sheets.daily.includes(sheetName)) {
    ui.alert('Invalid Sheet',
             'Batch validation can only be performed on daily sheets (01-31).',
             ui.ButtonSet.OK);
    return;
  }

  const selection = sheet.getActiveRange();
  const startRow = selection.getRow();
  const numRows = selection.getNumRows();

  if (startRow < 6) {
    ui.alert('Invalid Selection',
             'Please select data rows (row 6 and below).',
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
  const sheetName = sheet.getName();

  // Check if current sheet is a daily sheet
  if (!CONFIG.sheets.daily.includes(sheetName)) {
    ui.alert('Invalid Sheet',
             'Batch posting can only be performed on daily sheets (01-31).',
             ui.ButtonSet.OK);
    return;
  }

  const selection = sheet.getActiveRange();
  const startRow = selection.getRow();
  const numRows = selection.getNumRows();

  if (startRow < 6) {
    ui.alert('Invalid Selection',
             'Please select data rows (row 6 and below).',
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
  const sheetName = sheet.getName();

  // Check if current sheet is a daily sheet
  if (!CONFIG.sheets.daily.includes(sheetName)) {
    ui.alert('Invalid Sheet',
             'This operation can only be performed on daily sheets (01-31).',
             ui.ButtonSet.OK);
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
  if (lastRow < 6) {
    ui.alert('No Data', 'No data rows found in this sheet.', ui.ButtonSet.OK);
    return;
  }

  // Clear all checkboxes in column J
  const postCol = CONFIG.cols.post + 1; // Convert to 1-based
  const range = sheet.getRange(6, postCol, lastRow - 6 + 1, 1);
  range.uncheck();

  SpreadsheetApp.getActiveSpreadsheet().toast(
    'All post checkboxes cleared successfully.',
    'Success',
    5
  );
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
  const dataStartRow = 6;
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

  // Read all data at once for performance
  const dataRange = sheet.getRange(startRow, 2, numRows, CONFIG.totalColumns.daily);
  const allData = dataRange.getValues();

  const results = {
    total: numRows,
    valid: 0,
    invalid: 0,
    skipped: 0,
    errors: []
  };

  // Validate each row
  for (let i = 0; i < allData.length; i++) {
    const rowNum = startRow + i;
    const rowData = allData[i];

    // Skip empty rows (no supplier)
    if (!rowData[CONFIG.cols.supplier]) {
      results.skipped++;
      continue;
    }

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
  }

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
  const dataStartRow = 6;
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

  // Read all data at once for performance
  const dataRange = sheet.getRange(startRow, 2, numRows, CONFIG.totalColumns.daily);
  const allData = dataRange.getValues();

  const results = {
    total: numRows,
    posted: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  // Process each row
  for (let i = 0; i < allData.length; i++) {
    const rowNum = startRow + i;
    const rowData = allData[i];

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
        const errorMsg = validation.error || validation.errors[0];
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

      // Update status to POSTED
      setBatchPostStatus(
        sheet,
        rowNum,
        'POSTED',
        data.enteredBy,
        data.timestamp,
        false,
        CONFIG.colors.success
      );

      // Update balance cell
      BalanceCalculator.updateBalanceCell(sheet, rowNum, true, rowData);

      // Invalidate cache for this supplier
      InvoiceCache.invalidateSupplierCache(data.supplier);

      // Log success
      AuditLogger.log('BATCH_POST', data, 'Posted via batch operation');

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
        Utils.getCurrentUserEmail(),
        new Date(),
        false,
        CONFIG.colors.error
      );

      // Log error
      AuditLogger.logError('BATCH_POST_FAILED', error, { row: rowNum });
    }
  }

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
    enteredBy: getCurrentUserEmail(),
    timestamp: new Date(),
    row: rowNum,
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
  const operation = isPosting ? 'Posting' : 'Validation';

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
