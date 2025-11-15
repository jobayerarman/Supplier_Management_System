/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UIMenu.gs - Batch Operations and Custom Menu System
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * OVERVIEW:
 * Batch operations system for streamlining end-of-day workflow processing.
 * Provides custom menu interface for bulk validation and posting operations
 * with real-time progress tracking and comprehensive error reporting.
 *
 * CORE RESPONSIBILITIES:
 * ━━━━━━━━━━━━━━━━━━━━
 * 1. MENU MANAGEMENT
 *    - onOpen(): Create custom menu on spreadsheet open
 *    - Menu structure: Batch validation, batch posting, user settings, utilities
 *    - Delegates to module methods for all operations
 *
 * 2. BATCH VALIDATION
 *    - UIMenu.batchValidateAllRows(): Validate all rows without posting
 *    - UIMenu.batchValidateSelectedRows(): Validate selected rows only
 *    - Real-time progress tracking with dynamic update intervals
 *    - Error collection with detailed error reporting
 *
 * 3. BATCH POSTING
 *    - UIMenu.batchPostAllRows(): Validate and post all valid rows
 *    - UIMenu.batchPostSelectedRows(): Post selected rows only
 *    - Performance-optimized cache invalidation (once per supplier)
 *    - Comprehensive error handling and status updates
 *
 * 4. UTILITY OPERATIONS
 *    - UIMenu.clearAllPostCheckboxes(): Reset sheet after batch operations
 *    - User settings delegation to UserResolver module
 *
 * ARCHITECTURE & DESIGN PATTERNS:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * MODULE ORGANIZATION (following Code/PaymentManager patterns):
 *   1. MODULE HEADER - This documentation
 *   2. GLOBAL MENU FUNCTIONS - onOpen, handler entry points
 *   3. UIMENU MODULE - Public API and private helpers
 *      - PUBLIC API - User-facing batch operations
 *      - PRIVATE HANDLERS - Operation-specific logic
 *      - PRIVATE UTILITIES - Shared helper functions
 *   4. USER SETTINGS DELEGATION - MenuSetMyEmail, etc. (in _UserResolver.gs)
 *
 * DESIGN PATTERNS USED:
 *   • Module Pattern: Encapsulation via UIMenu object with public/private methods
 *   • Handler Dispatch: Delegates from global functions to module methods
 *   • Single Responsibility: Each handler focused on specific batch operation
 *   • Early Exit Pattern: Validation gates prevent unnecessary processing
 *   • Error Boundary: Try-catch with consistent audit logging
 *   • Performance Optimization: Phase 2 parameter passing (user caching)
 *
 * PERFORMANCE STRATEGY:
 * ━━━━━━━━━━━━━━━━━━
 * BATCH READ PATTERN:
 *   - Single batch read: getRange(...).getValues() (1 API call)
 *   - In-memory processing loop (zero redundant reads)
 *   - Collected writes in single batch operation
 *
 * USER RESOLUTION OPTIMIZATION (Phase 2):
 *   - Get user once before loop: UserResolver.getCurrentUser()
 *   - Pass through batch: buildDataObject(..., enteredBy)
 *   - Result: 99% reduction in UserResolver calls per batch
 *
 * CACHE INVALIDATION OPTIMIZATION:
 *   - Collect suppliers in Set during loop
 *   - Invalidate once per unique supplier after loop
 *   - Result: 50-90% reduction in redundant invalidations
 *
 * PROGRESS FEEDBACK:
 *   - Dynamic intervals: Targets ~10 updates regardless of batch size
 *   - Formula: interval = max(5, min(100, ceil(totalRows / 10)))
 *   - Minimal UI blocking during heavy processing
 *
 * MASTER DATABASE COMPATIBILITY:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * - Connection mode tracked and logged (BATCH_POST_START)
 * - All reads from daily sheets (always local, fast)
 * - All writes via InvoiceManager/PaymentManager (Master DB aware)
 * - Performance metrics logged per operation mode
 * - Toast notifications show connection mode and expected performance
 * - Audit logging includes supplier cache invalidation count
 *
 * INTEGRATION POINTS:
 * ━━━━━━━━━━━━━━━━━
 * VALIDATION INTEGRATION (ValidationEngine.gs):
 *   - validatePostData(): Main validation for each row
 *   - validatePaymentTypeRules(): Payment type specific validation
 *
 * INVOICE INTEGRATION (InvoiceManager.gs):
 *   - createOrUpdateInvoice(): UPSERT operation during posting
 *
 * PAYMENT INTEGRATION (PaymentManager.gs):
 *   - processPayment(): Record payment transaction during posting
 *
 * BALANCE INTEGRATION (BalanceCalculator.gs):
 *   - updateBalanceCell(): Calculate balance after posting
 *
 * CACHE INTEGRATION (CacheManager.gs):
 *   - invalidateSupplierCache(): Surgical invalidation per supplier
 *   - Result: O(n) cache calls reduced to O(m) where m = unique suppliers
 *
 * USER RESOLUTION (UserResolver.gs):
 *   - getCurrentUser(): Get user once before batch loop
 *   - extractUsername(): Format for display in status column
 *   - User settings menu functions (menuSetMyEmail, menuShowUserInfo, etc.)
 *
 * AUDIT INTEGRATION (AuditLogger.gs):
 *   - BATCH_POST_START: Log connection mode at batch start
 *   - BATCH_POST_COMPLETE: Log performance metrics at completion
 *   - flush(): Batch audit operations into single write
 *
 * CONFIGURATION (CONFIG):
 *   - CONFIG.dataStartRow: First data row (5)
 *   - CONFIG.totalColumns.daily: Column count for daily sheets
 *   - CONFIG.cols: Column index mappings
 *   - CONFIG.dailySheets: Array of valid sheet names (01-31)
 *   - CONFIG.colors: UI colors for status display
 *
 * DATA STRUCTURES:
 * ━━━━━━━━━━━━━━
 * VALIDATION RESULTS:
 *   {
 *     total: number,           // Total rows processed
 *     valid: number,           // Passed validation
 *     invalid: number,         // Failed validation
 *     skipped: number,         // Empty or already posted
 *     errors: Array<{
 *       row: number,           // Row number
 *       supplier: string,      // Supplier name
 *       invoiceNo: string,     // Invoice number
 *       error: string          // Error message
 *     }>
 *   }
 *
 * POSTING RESULTS (extends Validation Results):
 *   {
 *     ...validation results...
 *     posted: number,          // Successfully posted
 *     failed: number,          // Failed to post
 *     connectionMode: string,  // 'LOCAL' or 'MASTER'
 *     duration: number,        // Total time in ms
 *     avgTimePerRow: number    // Average ms per row
 *   }
 *
 * Modular Architecture Dependencies:
 * - _Config.gs → global configuration
 * - _Utils.gs → date utilities (getDailySheetDate), ID generation
 * - _UserResolver.gs → user identification and menu functions
 * - ValidationEngine.gs → business rule validation
 * - InvoiceManager.gs → invoice CRUD operations
 * - PaymentManager.gs → payment processing
 * - BalanceCalculator.gs → balance calculations
 * - CacheManager.gs → cache invalidation operations
 * - AuditLogger.gs → audit trail operations
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 2: GLOBAL MENU FUNCTIONS (Entry Points)
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Creates custom menu when spreadsheet opens
 * This function is automatically triggered by Google Sheets onOpen event.
 *
 * Delegates all operations to UIMenu module methods.
 */
function onOpen() {
  UIMenu.createMenus();
}

/**
 * Global handler: Batch validate all rows
 * Delegates to UIMenu module
 */
function batchValidateAllRows() {
  UIMenu.batchValidateAllRows();
}

/**
 * Global handler: Batch post all valid rows
 * Delegates to UIMenu module
 */
function batchPostAllRows() {
  UIMenu.batchPostAllRows();
}

/**
 * Global handler: Batch validate selected rows
 * Delegates to UIMenu module
 */
function batchValidateSelectedRows() {
  UIMenu.batchValidateSelectedRows();
}

/**
 * Global handler: Batch post selected rows
 * Delegates to UIMenu module
 */
function batchPostSelectedRows() {
  UIMenu.batchPostSelectedRows();
}

/**
 * Global handler: Clear all post checkboxes
 * Delegates to UIMenu module
 */
function clearAllPostCheckboxes() {
  UIMenu.clearAllPostCheckboxes();
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 3: UIMENU MODULE - Batch Operations Implementation
 * ═══════════════════════════════════════════════════════════════════════════
 */

const UIMenu = {

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * PUBLIC API - User-Facing Batch Operations
   * ═══════════════════════════════════════════════════════════════════════════
   */

  /**
   * Creates custom menu items on spreadsheet open
   * Adds: Batch operations, utilities, and user settings submenu
   */
  createMenus: function() {
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
        .addItem('Clear User Cache', 'menuClearUserCache')
        .addSeparator()
        .addItem('🔍 Diagnose User Resolution', 'diagnoseUserResolution'))
      .addToUi();
  },

  /**
   * Validates all data rows in the current sheet without posting
   * Shows summary of validation results with error details
   *
   * FLOW:
   *   1. Validate daily sheet
   *   2. Get confirmation from user
   *   3. Delegate to _handleBatchValidation()
   *   4. Display results dialog
   */
  batchValidateAllRows: function() {
    const ui = SpreadsheetApp.getUi();
    const sheet = SpreadsheetApp.getActiveSheet();

    // Early exit: invalid sheet
    if (!this._validateDailySheet(sheet)) {
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

    const results = this._handleBatchValidation(sheet);
    this._showValidationResults(results, false);
  },

  /**
   * Validates and posts all valid rows in the current sheet
   * Only posts rows that pass validation
   *
   * FLOW:
   *   1. Validate daily sheet
   *   2. Get confirmation from user
   *   3. Delegate to _handleBatchPosting()
   *   4. Display results dialog with performance metrics
   */
  batchPostAllRows: function() {
    const ui = SpreadsheetApp.getUi();
    const sheet = SpreadsheetApp.getActiveSheet();

    // Early exit: invalid sheet
    if (!this._validateDailySheet(sheet)) {
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

    const results = this._handleBatchPosting(sheet);
    this._showValidationResults(results, true);
  },

  /**
   * Validates selected rows only
   *
   * FLOW:
   *   1. Validate daily sheet
   *   2. Validate selection is within data range
   *   3. Delegate to _handleBatchValidation() with selected range
   *   4. Display results dialog
   */
  batchValidateSelectedRows: function() {
    const ui = SpreadsheetApp.getUi();
    const sheet = SpreadsheetApp.getActiveSheet();

    // Early exit: invalid sheet
    if (!this._validateDailySheet(sheet)) {
      return;
    }

    const selection = sheet.getActiveRange();
    const startRow = selection.getRow();
    const numRows = selection.getNumRows();

    // Validate selection
    if (startRow < CONFIG.dataStartRow) {
      ui.alert('Invalid Selection',
               `Please select data rows (row ${CONFIG.dataStartRow} and below).`,
               ui.ButtonSet.OK);
      return;
    }

    const results = this._handleBatchValidation(sheet, startRow, startRow + numRows - 1);
    this._showValidationResults(results, false);
  },

  /**
   * Posts selected rows only
   *
   * FLOW:
   *   1. Validate daily sheet
   *   2. Validate selection is within data range
   *   3. Get confirmation from user
   *   4. Delegate to _handleBatchPosting() with selected range
   *   5. Display results dialog with performance metrics
   */
  batchPostSelectedRows: function() {
    const ui = SpreadsheetApp.getUi();
    const sheet = SpreadsheetApp.getActiveSheet();

    // Early exit: invalid sheet
    if (!this._validateDailySheet(sheet)) {
      return;
    }

    const selection = sheet.getActiveRange();
    const startRow = selection.getRow();
    const numRows = selection.getNumRows();

    // Validate selection
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

    const results = this._handleBatchPosting(sheet, startRow, startRow + numRows - 1);
    this._showValidationResults(results, true);
  },

  /**
   * Clears all post checkboxes in the current sheet
   * Useful for resetting the sheet after batch operations
   *
   * FLOW:
   *   1. Validate daily sheet
   *   2. Get confirmation from user
   *   3. Delegate to _handleClearCheckboxes()
   *   4. Show success toast
   */
  clearAllPostCheckboxes: function() {
    const ui = SpreadsheetApp.getUi();
    const sheet = SpreadsheetApp.getActiveSheet();

    // Early exit: invalid sheet
    if (!this._validateDailySheet(sheet)) {
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

    this._handleClearCheckboxes(sheet);
  },

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * PRIVATE HANDLERS - Operation-Specific Logic
   * ═══════════════════════════════════════════════════════════════════════════
   */

  /**
   * PRIVATE: Handle batch validation operation
   *
   * PERFORMANCE OPTIMIZATIONS:
   *   - Single batch read: getRange().getValues() (1 API call)
   *   - User resolution once before loop (Phase 2)
   *   - Dynamic progress intervals (targets ~10 updates)
   *
   * @param {Sheet} sheet - The sheet to validate
   * @param {number} startRow - Optional start row (defaults to dataStartRow)
   * @param {number} endRow - Optional end row (defaults to last row)
   * @return {Object} Validation results
   * @private
   */
  _handleBatchValidation: function(sheet, startRow = null, endRow = null) {
    const sheetName = sheet.getName();
    const dataStartRow = CONFIG.dataStartRow;
    const lastRow = sheet.getLastRow();

    // Set default row range
    if (startRow === null) startRow = dataStartRow;
    if (endRow === null) endRow = lastRow;

    // Validate row range
    if (lastRow < dataStartRow) {
      return this._createEmptyResults();
    }

    // Adjust end row if needed
    if (endRow > lastRow) endRow = lastRow;
    if (startRow > endRow) {
      return this._createEmptyResults();
    }

    const numRows = endRow - startRow + 1;

    // UX FEEDBACK: Show initial toast
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

      // PHASE 2 OPTIMIZATION: Get user once before loop
      const enteredBy = UserResolver.getCurrentUser();

      // Dynamic progress interval
      const progressInterval = this._calculateProgressInterval(numRows);

      // Validate each row
      for (let i = 0; i < allData.length; i++) {
        const rowNum = startRow + i;
        const rowData = allData[i];

        // UX FEEDBACK: Dynamic progress toast
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
          // Build validation data object (pass enteredBy to avoid redundant calls)
          const data = this._buildDataObject(rowData, rowNum, sheetName, enteredBy);

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
      logSystemError('_handleBatchValidation', error.toString());
      results.errors.push({
        row: 'N/A',
        supplier: 'SYSTEM',
        invoiceNo: 'N/A',
        error: `System error: ${error.message}`
      });
    }

    // FLUSH AUDIT QUEUE
    AuditLogger.flush();

    return results;
  },

  /**
   * PRIVATE: Handle batch posting operation
   *
   * MASTER DATABASE AWARENESS:
   *   - Tracks connection mode (LOCAL/MASTER)
   *   - Logs performance metrics per mode
   *   - Toast shows connection mode and expected performance
   *
   * PERFORMANCE OPTIMIZATIONS:
   *   - Single batch read: getRange().getValues() (1 API call)
   *   - User resolution once before loop (Phase 2)
   *   - Collect suppliers in Set, invalidate once per supplier
   *   - Performance tracking: duration, average time per row
   *
   * @param {Sheet} sheet - The sheet to process
   * @param {number} startRow - Optional start row (defaults to dataStartRow)
   * @param {number} endRow - Optional end row (defaults to last row)
   * @return {Object} Posting results with performance metrics
   * @private
   */
  _handleBatchPosting: function(sheet, startRow = null, endRow = null) {
    // PERFORMANCE TRACKING: Start timer
    const batchStartTime = Date.now();

    const sheetName = sheet.getName();
    const dataStartRow = CONFIG.dataStartRow;
    const lastRow = sheet.getLastRow();

    // MASTER DB AWARENESS: Log connection mode
    const connectionMode = CONFIG.isMasterMode() ? 'MASTER' : 'LOCAL';
    AuditLogger.logInfo('BATCH_POST_START',
      `Starting batch post in ${connectionMode} mode (${sheetName})`);

    // Set default row range
    if (startRow === null) startRow = dataStartRow;
    if (endRow === null) endRow = lastRow;

    // Validate row range
    if (lastRow < dataStartRow) {
      return this._createEmptyPostResults(connectionMode);
    }

    // Adjust end row if needed
    if (endRow > lastRow) endRow = lastRow;
    if (startRow > endRow) {
      return this._createEmptyPostResults(connectionMode);
    }

    const numRows = endRow - startRow + 1;

    // UX FEEDBACK: Show initial toast with connection mode
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

    // BATCH OPTIMIZATION: Collect suppliers for cache invalidation
    const suppliersToInvalidate = new Set();

    // Dynamic progress interval
    const progressInterval = this._calculateProgressInterval(numRows);

    // PHASE 2 OPTIMIZATION: Get user once before loop
    const enteredBy = UserResolver.getCurrentUser();

    // Process each row
    for (let i = 0; i < allData.length; i++) {
      const rowNum = startRow + i;
      const rowData = allData[i];

      // UX FEEDBACK: Dynamic progress toast
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
        // Build data object (pass enteredBy to avoid redundant calls)
        const data = this._buildDataObject(rowData, rowNum, sheetName, enteredBy);

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

        // Process invoice (create if new, update if exists)
        const invoiceResult = InvoiceManager.createOrUpdateInvoice(data);
        data.invoiceId = invoiceResult.invoiceId;

        // Process payment if applicable
        let paymentResult = null;
        if (this._shouldProcessPayment(data)) {
          paymentResult = PaymentManager.processPayment(data, invoiceResult.invoiceId);
        }

        // UPDATE BALANCE CELL
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
          UserResolver.extractUsername(enteredBy),  // Reuse pre-resolved user
          DateUtils.formatTimestamp(),
          false,
          CONFIG.colors.error
        );

        // Log error
        AuditLogger.logError('BATCH_POST_FAILED', error, { row: rowNum });
      }
    }

    // BATCH CACHE INVALIDATION
    // Invalidate cache once per unique supplier (instead of per row)
    // PERFORMANCE: Reduces redundant invalidations by 50-90%
    for (const supplier of suppliersToInvalidate) {
      CacheManager.invalidateSupplierCache(supplier);
    }

    // PERFORMANCE TRACKING: Calculate metrics
    const batchEndTime = Date.now();
    results.duration = batchEndTime - batchStartTime;
    results.avgTimePerRow = results.posted > 0
      ? Math.round(results.duration / results.posted)
      : 0;

    // MASTER DB AWARENESS: Log completion with performance metrics
    AuditLogger.logInfo('BATCH_POST_COMPLETE',
      `Batch post completed in ${connectionMode} mode: ` +
      `${results.posted} posted, ${results.failed} failed, ${results.skipped} skipped | ` +
      `Duration: ${results.duration}ms, Avg: ${results.avgTimePerRow}ms/row | ` +
      `Suppliers invalidated: ${suppliersToInvalidate.size}`);

    // FLUSH AUDIT QUEUE
    AuditLogger.flush();

    // UX FEEDBACK: Final completion toast with performance
    SpreadsheetApp.getActiveSpreadsheet().toast(
      `Completed in ${(results.duration / 1000).toFixed(1)}s (${connectionMode} mode): ` +
      `${results.posted} posted, ${results.failed} failed, ${results.skipped} skipped`,
      'Success',
      5
    );

    return results;
  },

  /**
   * PRIVATE: Handle clear checkboxes operation
   *
   * Clears all POST checkboxes in the current sheet.
   *
   * @param {Sheet} sheet - The sheet to process
   * @private
   */
  _handleClearCheckboxes: function(sheet) {
    const lastRow = sheet.getLastRow();

    // Validate data exists
    if (lastRow < CONFIG.dataStartRow) {
      const ui = SpreadsheetApp.getUi();
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
  },

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * PRIVATE UTILITIES - Shared Helper Functions
   * ═══════════════════════════════════════════════════════════════════════════
   */

  /**
   * PRIVATE: Validate that the current sheet is a daily sheet (01-31)
   * Shows alert to user if not valid
   *
   * @param {Sheet} sheet - The sheet to validate
   * @return {boolean} True if valid daily sheet, false otherwise
   * @private
   */
  _validateDailySheet: function(sheet) {
    const ui = SpreadsheetApp.getUi();
    const sheetName = sheet.getName();

    if (!CONFIG.dailySheets.includes(sheetName)) {
      ui.alert('Invalid Sheet',
               'This operation can only be performed on daily sheets (01-31).',
               ui.ButtonSet.OK);
      return false;
    }

    return true;
  },

  /**
   * PRIVATE: Calculate dynamic progress update interval based on total rows
   *
   * Aims for ~10 progress updates regardless of batch size:
   * - Small batches (1-50): Update every 5 rows
   * - Medium batches (51-100): Update every 10 rows
   * - Large batches (101-500): Update every 50 rows
   * - Extra large (500+): Update every 100 rows
   *
   * @param {number} totalRows - Total number of rows to process
   * @return {number} Interval for progress updates
   * @private
   */
  _calculateProgressInterval: function(totalRows) {
    const targetUpdates = 10;
    const minInterval = 5;
    const maxInterval = 100;

    const calculatedInterval = Math.ceil(totalRows / targetUpdates);
    return Math.max(minInterval, Math.min(maxInterval, calculatedInterval));
  },

  /**
   * PRIVATE: Build data object from row data array
   *
   * Extracts invoice date from daily sheet (cell A3) or constructs from sheet name.
   * Used by both validation and posting operations.
   *
   * @param {Array} rowData - Array of cell values
   * @param {number} rowNum - Row number
   * @param {string} sheetName - Sheet name
   * @param {string} enteredBy - User email (Phase 2 optimization - parameter passing)
   * @return {Object} Data object with all transaction fields
   * @private
   */
  _buildDataObject: function(rowData, rowNum, sheetName, enteredBy = null) {
    // Get invoice date from daily sheet (cell A3) or construct from sheet name
    const invoiceDate = getDailySheetDate(sheetName) || new Date();

    // Use provided enteredBy or fallback to detection (Phase 2 parameter passing optimization)
    const finalEnteredBy = enteredBy || UserResolver.getCurrentUser();

    return {
      supplier: rowData[CONFIG.cols.supplier],
      invoiceNo: rowData[CONFIG.cols.invoiceNo],
      receivedAmt: parseFloat(rowData[CONFIG.cols.receivedAmt]) || 0,
      paymentType: rowData[CONFIG.cols.paymentType],
      prevInvoice: rowData[CONFIG.cols.prevInvoice],
      paymentAmt: parseFloat(rowData[CONFIG.cols.paymentAmt]) || 0,
      notes: rowData[CONFIG.cols.notes] || '',
      sysId: rowData[CONFIG.cols.sysId],
      invoiceDate: invoiceDate,
      enteredBy: finalEnteredBy,
      timestamp: DateUtils.formatTimestamp(),  // MM/DD/YYYY HH:mm:ss
      rowNum: rowNum,
      sheetName: sheetName
    };
  },

  /**
   * PRIVATE: Show validation or posting results in user-friendly dialog
   *
   * MASTER DATABASE AWARENESS:
   *   - Displays connection mode (Local or Master)
   *   - Shows performance metrics for posting operations
   *   - Helps identify performance differences between modes
   *
   * @param {Object} results - Results object with validation/posting data
   * @param {boolean} isPosting - True if posting operation, false if validation only
   * @private
   */
  _showValidationResults: function(results, isPosting) {
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

    // MASTER DB AWARENESS: Show connection mode and performance
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
  },

  /**
   * PRIVATE: Determine if payment should be processed for this row
   *
   * @param {Object} data - Transaction data object
   * @return {boolean} True if payment should be recorded
   * @private
   */
  _shouldProcessPayment: function(data) {
    // Process payment for all types except when receiving new invoice with no payment
    return !(data.paymentType === 'Unpaid' && data.paymentAmt === 0);
  },

  /**
   * PRIVATE: Create empty validation results object
   *
   * @return {Object} Empty results structure
   * @private
   */
  _createEmptyResults: function() {
    return {
      total: 0,
      valid: 0,
      invalid: 0,
      skipped: 0,
      errors: []
    };
  },

  /**
   * PRIVATE: Create empty posting results object
   *
   * @param {string} connectionMode - 'LOCAL' or 'MASTER'
   * @return {Object} Empty results structure with posting fields
   * @private
   */
  _createEmptyPostResults: function(connectionMode) {
    return {
      total: 0,
      posted: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      connectionMode: connectionMode,
      duration: 0,
      avgTimePerRow: 0
    };
  }

};
