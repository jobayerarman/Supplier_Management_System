/**
 * UIMenu.gs - Custom Menu System for Batch Operations
 *
 * Provides UI menu for batch validation and posting operations
 * to streamline end-of-day workflow processing.
 *
 * MASTER DATABASE COMPATIBILITY:
 * - All operations are Master DB aware
 * - Reads from daily sheets (always local)
 * - Writes via InvoiceManager/PaymentManager (Master DB aware)
 * - Performance tracking for both Local and Master modes
 * - Audit logging via AuditLogger (Master DB aware)
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
    .addSeparator()
    .addSubMenu(ui.createMenu('👤 User Settings')
      .addItem('Set My Email', 'menuSetMyEmail')
      .addItem('Show User Info', 'menuShowUserInfo')
      .addItem('Clear User Cache', 'menuClearUserCache'))
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
 * Calculate dynamic progress update interval based on total rows
 * Aims for ~10 progress updates regardless of batch size
 *
 * Strategy:
 * - Small batches (1-50 rows): Update every 5 rows
 * - Medium batches (51-100 rows): Update every 10 rows
 * - Large batches (101-500 rows): Update every 50 rows
 * - Extra large (500+ rows): Update every 100 rows
 *
 * @param {number} totalRows - Total number of rows to process
 * @return {number} Interval for progress updates (how often to show toast)
 */
function calculateProgressInterval(totalRows) {
  // Aim for approximately 10 updates, with min=5 and max=100
  // Formula: interval = max(5, min(100, ceil(totalRows / 10)))
  const targetUpdates = 10;
  const minInterval = 5;
  const maxInterval = 100;

  const calculatedInterval = Math.ceil(totalRows / targetUpdates);
  return Math.max(minInterval, Math.min(maxInterval, calculatedInterval));
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

  // ═══ UX FEEDBACK: Show initial toast ═══
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Starting validation of ${numRows} rows...`,
    'Validating',
    3
  );

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

    // ═══ UX FEEDBACK: Calculate dynamic progress interval ═══
    const progressInterval = calculateProgressInterval(numRows);

    // Validate each row
    for (let i = 0; i < allData.length; i++) {
      const rowNum = startRow + i;
      const rowData = allData[i];

      // ═══ UX FEEDBACK: Dynamic progress toast ═══
      if ((i + 1) % progressInterval === 0) {
        SpreadsheetApp.getActiveSpreadsheet().toast(
          `Validated ${i + 1} of ${numRows} rows...`,
          'Progress',
          2
        );
      }

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
    logSystemError('validateRowsInSheet', error.toString());
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
 * MASTER DATABASE AWARENESS:
 * - Tracks performance in both Local and Master modes
 * - Logs connection mode for audit trail
 * - Optimized cache invalidation (once per supplier)
 * - Batch audit logging for efficiency
 *
 * @param {Sheet} sheet - The sheet to process
 * @param {number} startRow - Optional start row (defaults to dataStartRow)
 * @param {number} endRow - Optional end row (defaults to last row)
 * @return {Object} Posting results with performance metrics
 */
function postRowsInSheet(sheet, startRow = null, endRow = null) {
  // ═══ PERFORMANCE TRACKING: Start timer ═══
  const batchStartTime = Date.now();

  const sheetName = sheet.getName();
  const dataStartRow = CONFIG.dataStartRow;
  const lastRow = sheet.getLastRow();

  // ═══ MASTER DB AWARENESS: Log connection mode ═══
  const connectionMode = CONFIG.isMasterMode() ? 'MASTER' : 'LOCAL';
  AuditLogger.logInfo('BATCH_POST_START',
    `Starting batch post in ${connectionMode} mode (${sheetName})`);

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
      errors: [],
      connectionMode: connectionMode,
      duration: 0
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
      errors: [],
      connectionMode: connectionMode,
      duration: 0
    };
  }

  const numRows = endRow - startRow + 1;

  // ═══ UX FEEDBACK: Show initial toast with connection mode ═══
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Starting batch post of ${numRows} rows (${connectionMode} mode)...`,
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
    errors: [],
    connectionMode: connectionMode,
    duration: 0,
    avgTimePerRow: 0
  };

  // ═══ BATCH OPTIMIZATION: Collect suppliers for cache invalidation ═══
  const suppliersToInvalidate = new Set();

  // ═══ UX FEEDBACK: Calculate dynamic progress interval ═══
  const progressInterval = calculateProgressInterval(numRows);

  // Process each row
  for (let i = 0; i < allData.length; i++) {
    const rowNum = startRow + i;
    const rowData = allData[i];

    // ═══ UX FEEDBACK: Dynamic progress toast ═══
    if ((i + 1) % progressInterval === 0) {
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
          UserResolver.extractUsername(data.enteredBy),  // Display username only
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

      // Process invoice
      const invoiceResult = InvoiceManager.processOptimized(data);
      data.invoiceId = invoiceResult.invoiceId;

      // Process payment if applicable
      let paymentResult = null;
      if (shouldProcessPayment(data)) {
        paymentResult = PaymentManager.processPayment(data, invoiceResult.invoiceId);
      }

      // ═══ UPDATE BALANCE CELL ═══
      // Use updateBalanceCell with afterPost=true to get correct balance
      // This reads the current outstanding (which already reflects the payment)
      BalanceCalculator.updateBalanceCell(sheet, rowNum, true, rowData);

      // Update status to POSTED
      setBatchPostStatus(
        sheet,
        rowNum,
        'POSTED',
        UserResolver.extractUsername(data.enteredBy),  // Display username only
        data.timestamp,
        true,
        CONFIG.colors.success
      );

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
        UserResolver.getUsernameOnly(),  // Get current user and extract username
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

  // ═══ PERFORMANCE TRACKING: Calculate metrics ═══
  const batchEndTime = Date.now();
  results.duration = batchEndTime - batchStartTime;
  results.avgTimePerRow = results.posted > 0
    ? Math.round(results.duration / results.posted)
    : 0;

  // ═══ MASTER DB AWARENESS: Log completion with performance metrics ═══
  AuditLogger.logInfo('BATCH_POST_COMPLETE',
    `Batch post completed in ${connectionMode} mode: ` +
    `${results.posted} posted, ${results.failed} failed, ${results.skipped} skipped | ` +
    `Duration: ${results.duration}ms, Avg: ${results.avgTimePerRow}ms/row | ` +
    `Suppliers invalidated: ${suppliersToInvalidate.size}`);

  // ═══ FLUSH AUDIT QUEUE ═══
  // Write all queued audit entries in single batch operation
  AuditLogger.flush();

  // ═══ UX FEEDBACK: Final completion toast with performance ═══
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Completed in ${(results.duration / 1000).toFixed(1)}s (${connectionMode} mode): ` +
    `${results.posted} posted, ${results.failed} failed, ${results.skipped} skipped`,
    'Success',
    5
  );

  return results;
}

/**
 * Builds data object from row data array
 *
 * IMPORTANT: Extracts invoice date from daily sheet
 * - Reads date from cell A3 of the daily sheet
 * - Falls back to constructing date from sheet name (e.g., "01" → day 1)
 * - Used by both InvoiceManager and PaymentManager for date fields
 *
 * @param {Array} rowData - Array of cell values
 * @param {number} rowNum - Row number
 * @param {string} sheetName - Sheet name
 * @return {Object} Data object with invoiceDate field
 */
function buildDataObject(rowData, rowNum, sheetName) {
  // Get invoice date from daily sheet (cell A3) or construct from sheet name
  const invoiceDate = getDailySheetDate(sheetName) || new Date();

  return {
    supplier: rowData[CONFIG.cols.supplier],
    invoiceNo: rowData[CONFIG.cols.invoiceNo],
    receivedAmt: parseFloat(rowData[CONFIG.cols.receivedAmt]) || 0,
    paymentType: rowData[CONFIG.cols.paymentType],
    prevInvoice: rowData[CONFIG.cols.prevInvoice],
    paymentAmt: parseFloat(rowData[CONFIG.cols.paymentAmt]) || 0,
    notes: rowData[CONFIG.cols.notes] || '',
    sysId: rowData[CONFIG.cols.sysId],
    invoiceDate: invoiceDate,  // ✅ ADDED: Invoice/payment date from daily sheet
    enteredBy: UserResolver.getCurrentUser(),  // ✅ FIXED: Store full email for audit trail (split only for display)
    timestamp: new Date(),     // Current processing time (for audit trail)
    rowNum: rowNum,
    sheetName: sheetName
  };
}

/**
 * Shows validation/posting results in a user-friendly dialog
 *
 * MASTER DATABASE AWARENESS:
 * - Displays connection mode (Local or Master)
 * - Shows performance metrics for posting operations
 * - Helps identify performance differences between modes
 *
 * @param {Object} results - Results object with performance metrics
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

  message += `Skipped (empty or already posted): ${results.skipped}\n`;

  // ═══ MASTER DB AWARENESS: Show connection mode and performance ═══
  if (isPosting && results.connectionMode) {
    message += `\n--- Performance ---\n`;
    message += `Connection Mode: ${results.connectionMode}\n`;
    message += `Total Duration: ${(results.duration / 1000).toFixed(1)}s\n`;
    if (results.posted > 0) {
      message += `Avg Time/Row: ${results.avgTimePerRow}ms\n`;
    }
    if (results.connectionMode === 'MASTER') {
      message += `\nNote: Master mode may be slightly slower due to\n`;
      message += `cross-file writes (+50-100ms per row expected).\n`;
    }
  }

  message += '\n';

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
