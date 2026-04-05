/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UIMenu.gs - Batch Operations and Custom Menu System
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * OVERVIEW:
 * Batch operations system for end-of-day workflow processing. Provides a
 * custom menu for bulk validation and posting with progress tracking and
 * comprehensive error reporting.
 *
 * CORE RESPONSIBILITIES:
 * - Menu management      : onOpen(), custom menu structure and delegates
 * - Batch validation     : validateAllRows, validateSelectedRows, error collection
 * - Batch posting        : postAllRows, postSelectedRows, cache invalidation, status updates
 * - Utility operations   : clearCheckboxes, sheet management, reset operations
 *
 * DATA STRUCTURES:
 *
 * Validation Results:
 *   { total, valid, invalid, skipped,
 *     errors: [{ row, supplier, invoiceNo, error }] }
 *
 * Posting Results (extends Validation Results):
 *   { ...validationResults, posted, failed,
 *     connectionMode,   // 'LOCAL' or 'MASTER'
 *     duration,         // total ms
 *     avgTimePerRow }   // ms per posted row
 *
 * @see agent_docs/caching_architecture.md  — batch read + cache invalidation strategy
 * @see agent_docs/master_database.md       — LOCAL/MASTER mode behaviour
 * @see agent_docs/coding_patterns.md       — naming conventions, error handling patterns
 *
 * Dependencies: _Config.gs, _Utils.gs, _UserResolver.gs, ValidationEngine.gs,
 *               InvoiceManager.gs, PaymentManager.gs, BalanceCalculator.gs,
 *               CacheManager.gs, AuditLogger.gs
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
 * Global handler: Create daily sheets 02-31
 * Delegates to UIMenu module
 */
function createDailySheets() {
  UIMenu.createDailySheets();
}

/**
 * Global handler: Create missing daily sheets only
 * Delegates to UIMenu module
 */
function createMissingSheets() {
  UIMenu.createMissingSheets();
}

/**
 * Global handler: Reorganize sheets in numerical order
 * Delegates to UIMenu module
 */
function organizeSheets() {
  UIMenu.organizeSheets();
}

/**
 * Global handler: Fix date formulas only
 * Delegates to UIMenu module
 */
function fixDateFormulasOnly() {
  UIMenu.fixDateFormulasOnly();
}

/**
 * Global handler: Reset current sheet to zero
 * Delegates to UIMenu module
 */
function resetInputCellsToZero() {
  UIMenu.resetInputCellsToZero();
}

/**
 * Global handler: Reset all daily sheets to zero
 * Delegates to UIMenu module
 */
function resetAllDailySheetsToZero() {
  UIMenu.resetAllDailySheetsToZero();
}

/**
 * Global handler: Quick reset current sheet
 * Delegates to UIMenu module
 */
function quickResetCurrentSheet() {
  UIMenu.quickResetCurrentSheet();
}

/**
 * Global handler: Delete daily sheets safely
 * Delegates to UIMenu module
 */
function deleteDailySheetsSafe() {
  UIMenu.deleteDailySheetsSafe();
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
   * Adds: Batch operations, sheet management, reset utilities, and user settings
   */
  createMenus: function() {
    const ui = SpreadsheetApp.getUi();

    ui.createMenu('📋 FP - Operations')

      // ═══ DAILY ═══
      .addItem('✅ Validate Selected Rows', 'batchValidateSelectedRows')
      .addItem('📤 Post Selected Rows', 'batchPostSelectedRows')
      .addSeparator()
      .addItem('✅ Batch Validate All Rows', 'batchValidateAllRows')
      .addItem('📤 Batch Post All Valid Rows', 'batchPostAllRows')

      // ═══ MONTHLY ═══
      .addSubMenu(ui.createMenu('📅 Monthly Setup')
        .addItem('🗑️ Delete Daily Sheets (02-31)', 'deleteDailySheetsSafe')
        .addSeparator()
        .addItem('☑️ Clear All Post Checkboxes', 'clearAllPostCheckboxes')
        .addItem('🧹 Reset Current Sheet to Zero', 'resetInputCellsToZero')
        .addSeparator()
        .addItem('📄 Create All Daily Sheets (02-31)', 'createDailySheets')
        .addItem('📄 Create Missing Sheets Only', 'createMissingSheets')
        .addSeparator()
        .addItem('🗂️ Reorganize Sheets', 'organizeSheets')
        .addItem('🔧 Fix Date Formulas Only', 'fixDateFormulasOnly'))

      // ═══ OCCASIONAL ═══
      .addSubMenu(ui.createMenu('🔄 Reset Operations')
        .addItem('🧹 Quick Reset Current Sheet', 'quickResetCurrentSheet')
        .addItem('🧹 Reset All Daily Sheets to Zero', 'resetAllDailySheetsToZero'))

      // ═══ ADMIN ═══
      .addSeparator()
      .addSubMenu(ui.createMenu('⚙️ System & Admin')
        .addItem('🏥 System Health Check', 'MenuRunDataIntegrityCheck')
        .addSeparator()
        .addItem('⚠️ Setup Installable Trigger', 'setupInstallableTriggerWithConfirmation')
        .addItem('⚠️ Remove Installable Trigger', 'removeInstallableTriggerWithConfirmation'))
      .addSubMenu(ui.createMenu('👤 User Settings')
        .addItem('📧 Set My Email', 'menuSetMyEmail')
        .addItem('ℹ️ Show User Info', 'menuShowUserInfo')
        .addItem('🗑️ Clear User Cache', 'menuClearUserCache')
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
    const sheet = SpreadsheetApp.getActiveSheet();

    // Early exit: invalid sheet
    if (!this._validateDailySheet(sheet)) {
      return;
    }

    // Confirm action
    if (!this._confirmOperation('Batch Validate All Rows',
      'This will validate all rows in the current sheet. Continue?')) return;

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
    const sheet = SpreadsheetApp.getActiveSheet();

    // Early exit: invalid sheet
    if (!this._validateDailySheet(sheet)) {
      return;
    }

    // Confirm action
    if (!this._confirmOperation('Batch Post All Valid Rows',
      'This will validate and post all valid rows in the current sheet.\n\nWARNING: This action cannot be undone. Continue?')) return;

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
    if (!this._confirmOperation('Batch Post Selected Rows',
      `This will validate and post ${numRows} selected row(s).\n\nWARNING: This action cannot be undone. Continue?`)) return;

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
    const sheet = SpreadsheetApp.getActiveSheet();

    // Early exit: invalid sheet
    if (!this._validateDailySheet(sheet)) {
      return;
    }

    // Confirm action
    if (!this._confirmOperation('Clear All Post Checkboxes',
      'This will uncheck all post checkboxes (Column J) in the current sheet. Continue?')) return;

    this._handleClearCheckboxes(sheet);
  },

  /**
   * Creates daily sheets 02-31 from sheet 01 as template
   * Updates formulas to reference previous day's sheet
   *
   * FLOW:
   *   1. Get confirmation from user
   *   2. Delegate to _handleCreateDailySheets()
   *   3. Show success message
   */
  createDailySheets: function() {
    if (!this._confirmOperation('Create All Daily Sheets (02-31)',
      'This will create sheets 02-31 using sheet 01 as a template and update all formulas.\n\nContinue?')) return;

    this._handleCreateDailySheets();
  },

  /**
   * Creates only missing daily sheets (02-31 that don't exist)
   * Useful for recovering deleted sheets without recreating all of them
   *
   * FLOW:
   *   1. Get confirmation from user
   *   2. Delegate to _handleCreateMissingSheets()
   *   3. Show results
   */
  createMissingSheets: function() {
    if (!this._confirmOperation('Create Missing Sheets Only',
      'This will create only missing daily sheets (02-31) that don\'t already exist.\n\nContinue?')) return;

    this._handleCreateMissingSheets();
  },

  /**
   * Reorganizes sheets in numerical order
   * Reorders all sheets so daily sheets (01-31) appear first in numerical order
   *
   * FLOW:
   *   1. Get confirmation from user
   *   2. Delegate to _handleOrganizeSheets()
   *   3. Show success message
   */
  organizeSheets: function() {
    if (!this._confirmOperation('Reorganize Sheets',
      'This will reorder all sheets to place daily sheets (01-31) first in numerical order.\n\nContinue?')) return;

    this._handleOrganizeSheets();
  },

  /**
   * Fixes date formulas in all daily sheets
   * Recalculates date offsets relative to sheet 01
   *
   * FLOW:
   *   1. Get confirmation from user
   *   2. Delegate to _handleFixDateFormulas()
   *   3. Show completion message
   */
  fixDateFormulasOnly: function() {
    if (!this._confirmOperation('Fix Date Formulas Only',
      'This will update all date formulas in daily sheets (02-31) to correctly reference sheet 01.\n\nContinue?')) return;

    this._handleFixDateFormulas();
  },

  /**
   * Resets current sheet input cells to zero
   * Clears transaction data while preserving formulas and formatting
   *
   * FLOW:
   *   1. Validate daily sheet
   *   2. Get confirmation from user
   *   3. Delegate to _handleResetCurrentSheet()
   *   4. Show success message
   */
  resetInputCellsToZero: function() {
    const sheet = SpreadsheetApp.getActiveSheet();

    if (!this._validateDailySheet(sheet)) {
      return;
    }

    if (!this._confirmOperation('Reset Current Sheet to Zero',
      `This will clear all transaction data from sheet "${sheet.getName()}" while preserving formulas and formatting.\n\nContinue?`)) return;

    this._handleResetCurrentSheet();
  },

  /**
   * Resets all daily sheets to zero
   * Clears transaction data from all sheets while preserving formulas and formatting
   *
   * FLOW:
   *   1. Get confirmation from user
   *   2. Delegate to _handleResetAllSheets()
   *   3. Show completion message
   */
  resetAllDailySheetsToZero: function() {
    if (!this._confirmOperation('Reset All Daily Sheets to Zero',
      'This will clear all transaction data from ALL daily sheets (01-31) while preserving formulas and formatting.\n\nWARNING: This cannot be undone. Continue?')) return;

    this._handleResetAllSheets();
  },

  /**
   * Quick reset of current sheet (no confirmation)
   * Fast clear of current sheet data without confirmation dialogs
   *
   * FLOW:
   *   1. Validate daily sheet
   *   2. Delegate to _handleQuickResetCurrentSheet()
   *   3. Show success message
   */
  quickResetCurrentSheet: function() {
    const sheet = SpreadsheetApp.getActiveSheet();

    if (!this._validateDailySheet(sheet)) {
      return;
    }

    this._handleQuickResetCurrentSheet();
  },

  /**
   * Deletes daily sheets safely
   * Only deletes sheets 02-31, never touches protected sheets like 01
   *
   * FLOW:
   *   1. Get initial confirmation
   *   2. Show list of sheets to be deleted
   *   3. Get final confirmation
   *   4. Delegate to _handleDeleteDailySheets()
   *   5. Show results
   */
  deleteDailySheetsSafe: function() {
    this._handleDeleteDailySheets();
  },

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * PRIVATE HANDLERS - Operation-Specific Logic
   * Each complex handler is an orchestrator followed by its co-located phase helpers.
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
    const context = this._initBatchValidationSetup(sheet, startRow, endRow);
    if (!context) return this._createEmptyResults();
    this._runBatchValidationLoop(context);
    return context.results;
  },

  /** @private Phase 1: validate row bounds, show toast, init results object. Returns null if sheet is empty. */
  _initBatchValidationSetup: function(sheet, startRow, endRow) {
    const sheetName    = sheet.getName();
    const dataStartRow = CONFIG.dataStartRow;
    const lastRow      = sheet.getLastRow();

    if (startRow === null) startRow = dataStartRow;
    if (endRow   === null) endRow   = lastRow;

    if (lastRow < dataStartRow)  return null;
    if (endRow  > lastRow)       endRow = lastRow;
    if (startRow > endRow)       return null;

    const numRows = endRow - startRow + 1;

    this._toast(`Starting validation of ${numRows} rows...`, 'Validating', 3);

    return {
      sheet, sheetName, startRow, endRow, numRows,
      results: { total: numRows, valid: 0, invalid: 0, skipped: 0, errors: [] }
    };
  },

  /** @private Phase 2: batch-read rows, validate each, collect errors into context.results. */
  _runBatchValidationLoop: function(context) {
    const { sheet, sheetName, startRow, numRows, results } = context;

    try {
      const allData = sheet.getRange(startRow, 1, numRows, CONFIG.totalColumns.daily).getValues();
      const enteredBy        = UserResolver.getCurrentUser();
      const progressInterval = this._calculateProgressInterval(numRows);

      for (let i = 0; i < allData.length; i++) {
        const rowNum  = startRow + i;
        const rowData = allData[i];

        if ((i + 1) % progressInterval === 0) {
          this._toast(`Validated ${i + 1} of ${numRows} rows...`, 'Progress', 2);
        }

        if (!rowData[CONFIG.cols.supplier]) { results.skipped++; continue; }

        try {
          const data = this._buildDataObject(rowData, rowNum, sheetName, enteredBy);
          const validation = validatePostData(data);

          if (validation.valid) {
            results.valid++;
          } else {
            results.invalid++;
            results.errors.push({
              row: rowNum, supplier: data.supplier,
              invoiceNo: data.invoiceNo || 'N/A',
              error: validation.error || validation.errors.join(', ')
            });
          }
        } catch (rowError) {
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
      Logger.log(`Critical error in validateRowsInSheet: ${error.message}`);
      results.errors.push({
        row: 'N/A', supplier: 'SYSTEM', invoiceNo: 'N/A',
        error: `System error: ${error.message}`
      });
    }
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
    const context = this._initBatchPostSetup(sheet, startRow, endRow);
    if (!context) return this._createEmptyPostResults(CONFIG.isMasterMode() ? 'MASTER' : 'LOCAL');
    this._runBatchPostLoop(context);
    this._invalidateBatchCaches(context);
    this._flushBatchStatusUpdates(context);
    return this._reportBatchPostResults(context);
  },

  /** @private Phase 1: initialise context for a batch post run. Returns null if sheet is empty. */
  _initBatchPostSetup: function(sheet, startRow, endRow) {
    const startTime = Date.now();
    const sheetName = sheet.getName();
    const dataStartRow = CONFIG.dataStartRow;
    const lastRow = sheet.getLastRow();
    const connectionMode = CONFIG.isMasterMode() ? 'MASTER' : 'LOCAL';

    if (startRow === null) startRow = dataStartRow;
    if (endRow   === null) endRow   = lastRow;

    if (lastRow < dataStartRow)  return null;
    if (endRow  > lastRow)       endRow = lastRow;
    if (startRow > endRow)       return null;

    const numRows = endRow - startRow + 1;

    this._toast(`Starting batch post of ${numRows} rows (${connectionMode} mode)...`, 'Processing', 3);

    const allData = sheet.getRange(startRow, 1, numRows, CONFIG.totalColumns.daily).getValues();

    const results = {
      total: numRows, posted: 0, failed: 0, skipped: 0,
      errors: [], connectionMode: connectionMode, duration: 0, avgTimePerRow: 0
    };

    return {
      sheet, sheetName, connectionMode,
      startRow, endRow, numRows, allData,
      results,
      suppliersToInvalidate: new Set(),
      pendingStatusUpdates:  [],
      progressInterval: this._calculateProgressInterval(numRows),
      enteredBy:    UserResolver.getCurrentUser(),
      batchContext: this._initBatchContext(),
      startTime
    };
  },

  /** @private Phase 2: iterate rows, validate, invoice, payment, queue status updates. */
  _runBatchPostLoop: function(context) {
    const { sheet, sheetName, allData, startRow, numRows,
            results, suppliersToInvalidate, pendingStatusUpdates,
            progressInterval, enteredBy, batchContext } = context;

    try {
      for (let i = 0; i < allData.length; i++) {
        const rowNum  = startRow + i;
        const rowData = allData[i];

        if ((i + 1) % progressInterval === 0) {
          this._toast(`Processed ${i + 1} of ${numRows} rows...`, 'Progress', 2);
        }

        if (!rowData[CONFIG.cols.supplier]) { results.skipped++; continue; }

        const status = rowData[CONFIG.cols.status];
        if (status && status.toString().toUpperCase() === 'POSTED') { results.skipped++; continue; }

        try {
          const data = this._buildDataObject(rowData, rowNum, sheetName, enteredBy);
          const validation = validatePostData(data);

          if (!validation.valid) {
            results.failed++;
            results.errors.push({ row: rowNum, supplier: data.supplier,
                                  invoiceNo: data.invoiceNo || 'N/A',
                                  error: validation.error || validation.errors.join(', ') });

            const errorMsg = validation.error ||
              (validation.errors && validation.errors.length > 0 ? validation.errors[0] : 'Validation failed');
            pendingStatusUpdates.push({
              rowNum, keepChecked: false,
              status:  `ERROR: ${errorMsg.substring(0, 100)}`,
              user:    UserResolver.extractUsername(data.enteredBy),
              time:    data.timestamp, bgColor: CONFIG.colors.error
            });
            AuditLogger.log('VALIDATION_FAILED', data, errorMsg);
            continue;
          }

          if (!data.sysId) {
            data.sysId = IDGenerator.generateUUID();
            sheet.getRange(rowNum, CONFIG.cols.sysId + 1, 1, 1).setValue(data.sysId);
          }

          const invoiceResult = InvoiceManager.createOrUpdateInvoice(data, batchContext);
          data.invoiceId = invoiceResult.invoiceId;

          if (this._shouldProcessPayment(data)) {
            PaymentManager.processPayment(data, invoiceResult.invoiceId, batchContext);
          }

          BalanceCalculator.updateBalanceCell(sheet, rowNum, true, rowData);

          pendingStatusUpdates.push({
            rowNum, keepChecked: true, status: 'POSTED',
            user:    UserResolver.extractUsername(data.enteredBy),
            time:    data.timestamp, bgColor: CONFIG.colors.success
          });

          suppliersToInvalidate.add(data.supplier);
          results.posted++;

        } catch (error) {
          results.failed++;
          results.errors.push({
            row: rowNum, supplier: rowData[CONFIG.cols.supplier],
            invoiceNo: rowData[CONFIG.cols.invoiceNo] || 'N/A', error: error.message
          });
          pendingStatusUpdates.push({
            rowNum, keepChecked: false,
            status:  `ERROR: ${error.message.substring(0, 100)}`,
            user:    UserResolver.extractUsername(enteredBy),
            time:    DateUtils.formatTimestamp(), bgColor: CONFIG.colors.error
          });
          AuditLogger.logError('BATCH_POST_FAILED', error, { row: rowNum });
        }
      }
    } finally {
      // Release batch lock immediately after loop — post-loop work does not need it.
      LockManager.releaseLock(batchContext ? batchContext.batchLock : null);
    }
  },

  /** @private Phase 3: invalidate supplier cache once per unique supplier. */
  _invalidateBatchCaches: function(context) {
    for (const supplier of context.suppliersToInvalidate) {
      CacheManager.invalidateSupplierCache(supplier);
    }
  },

  /** @private Phase 4: flush all queued status updates in a single setValues() call. */
  _flushBatchStatusUpdates: function(context) {
    const { sheet, allData, startRow, numRows, pendingStatusUpdates } = context;
    if (pendingStatusUpdates.length === 0) return;
    const statusGrid = buildStatusGrid(allData, startRow, pendingStatusUpdates);
    sheet.getRange(startRow, CONFIG.cols.post + 1, numRows, 4).setValues(statusGrid);
    flushBackgroundUpdates(sheet, pendingStatusUpdates);
  },

  /** @private Phase 5: calculate metrics, show completion toast, return results. */
  _reportBatchPostResults: function(context) {
    const { results, startTime, connectionMode } = context;
    results.duration = Date.now() - startTime;
    results.avgTimePerRow = results.posted > 0
      ? Math.round(results.duration / results.posted) : 0;

    this._toast(
      `Completed in ${(results.duration / 1000).toFixed(1)}s (${connectionMode} mode): ` +
      `${results.posted} posted, ${results.failed} failed, ${results.skipped} skipped`,
      'Success', 5
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

    this._toast('All post checkboxes cleared successfully.', 'Success', 5);
  },

  /**
   * PRIVATE: Returns the number of days in the template month.
   *
   * Reads the date from sheet "01" cell B3 and converts it to the
   * spreadsheet's local timezone before extracting month/year. This is
   * required because GAS executes in UTC: for UTC+6 (Bangladesh), a local
   * date of April 1 00:00 is stored as March 31 18:00 UTC, so a naïve
   * getMonth() would return 2 (March = 31 days) instead of 3 (April = 30).
   *
   * Falls back to 31 on any error so existing behaviour is preserved.
   *
   * @param {Spreadsheet} ss
   * @returns {number} Last day of the template month (28–31)
   * @private
   */
  _getDaysInMonth: function(ss) {
    try {
      const templateSheet = ss.getSheetByName('01');
      if (!templateSheet) return 31;

      const dateCell = templateSheet.getRange('B3').getValue();
      if (!(dateCell instanceof Date) || isNaN(dateCell.getTime())) return 31;

      // Use the spreadsheet's own timezone so UTC offsets don't shift the month.
      const tz = ss.getSpreadsheetTimeZone();
      const localStr = Utilities.formatDate(dateCell, tz, 'yyyy-MM-dd'); // e.g. "2026-04-01"
      const [year, month] = localStr.split('-').map(Number);

      // Day 0 of the next month = last day of the current month
      return new Date(year, month, 0).getDate();
    } catch (e) {
      return 31;
    }
  },

  /**
   * PRIVATE: Handle create all daily sheets operation
   *
   * Creates sheets 02–<last day of month> from sheet 01 as template.
   * Updates formulas to reference previous day's sheet.
   *
   * @private
   */
  _handleCreateDailySheets: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = SpreadsheetApp.getUi();

    try {
      const templateSheet = ss.getSheetByName('01');
      if (!templateSheet) {
        throw new Error('Template sheet "01" not found');
      }

      // Start from Day 2 — up to the last day of the template month
      const daysInMonth = this._getDaysInMonth(ss);
      const sheetsToCreate = CONFIG.sheets.daily.slice(1, daysInMonth);

      // Build a lookup map of already-existing sheets (one API call)
      const sheetMap = {};
      ss.getSheets().forEach(s => { sheetMap[s.getName()] = true; });

      let createdCount = 0;

      sheetsToCreate.forEach(sheetName => {
        if (sheetMap[sheetName]) return; // Skip existing

        // Copy template and rename
        const newSheet = templateSheet.copyTo(ss);
        newSheet.setName(sheetName);

        // Update date formulas
        this._updateDateFormulas(newSheet, sheetName);

        createdCount++;
      });

      // Reorganize sheets in order
      this._organizeSheetOrder(ss);

      const lastSheet = sheetsToCreate[sheetsToCreate.length - 1] || '01';
      ui.alert(`Successfully created ${createdCount} daily sheets (02-${lastSheet}) with proper formula references.`);
    } catch (error) {
      ui.alert(`Error creating daily sheets: ${error.message}`);
    }
  },

  /**
   * PRIVATE: Handle create missing daily sheets operation
   *
   * Creates only missing sheets (02-31 that don't exist)
   *
   * @private
   */
  _handleCreateMissingSheets: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = SpreadsheetApp.getUi();

    try {
      const templateSheet = ss.getSheetByName('01');
      if (!templateSheet) {
        throw new Error('Template sheet "01" not found');
      }

      const missingSheets = [];

      // Build a lookup map of already-existing sheets (one API call)
      const sheetMap = {};
      ss.getSheets().forEach(s => { sheetMap[s.getName()] = true; });

      // Check only sheets valid for this month (02 … last day of month)
      const daysInMonth = this._getDaysInMonth(ss);
      CONFIG.sheets.daily.slice(1, daysInMonth).forEach(sheetName => {
        if (!sheetMap[sheetName]) {
          missingSheets.push(sheetName);
        }
      });

      if (missingSheets.length === 0) {
        ui.alert('All daily sheets already exist!');
        return;
      }

      // Create missing sheets
      missingSheets.forEach(sheetName => {
        const newSheet = templateSheet.copyTo(ss);
        newSheet.setName(sheetName);
        this._updateDateFormulas(newSheet, sheetName);
      });

      this._organizeSheetOrder(ss);
      ui.alert(`Created ${missingSheets.length} missing sheets: ${missingSheets.join(', ')}`);
    } catch (error) {
      ui.alert(`Error creating missing sheets: ${error.message}`);
    }
  },

  /**
   * PRIVATE: Handle organize sheets operation
   *
   * Reorders sheets in numerical order (01-31 first, then other sheets)
   *
   * @private
   */
  _handleOrganizeSheets: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = SpreadsheetApp.getUi();

    try {
      this._organizeSheetOrder(ss);
      ui.alert('Sheets reorganized successfully in numerical order.');
    } catch (error) {
      ui.alert(`Error reorganizing sheets: ${error.message}`);
    }
  },

  /**
   * PRIVATE: Handle fix date formulas operation
   *
   * Updates date formulas in all daily sheets (02-31)
   *
   * @private
   */
  _handleFixDateFormulas: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = SpreadsheetApp.getUi();

    try {
      let fixedCount = 0;

      CONFIG.dailySheets.forEach(sheetName => {
        if (sheetName === '01') return;

        const sheet = ss.getSheetByName(sheetName);
        if (sheet) {
          this._updateDateFormulas(sheet, sheetName);
          fixedCount++;
        }
      });

      ui.alert(`Date formulas fixed in ${fixedCount} sheets.`);
    } catch (error) {
      ui.alert(`Error fixing date formulas: ${error.message}`);
    }
  },

  /**
   * PRIVATE: Handle reset current sheet operation
   *
   * Clears all transaction data from current sheet
   *
   * @private
   */
  _handleResetCurrentSheet: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    const ui = SpreadsheetApp.getUi();

    try {
      this._clearSheetData(sheet);
      ui.alert(`Sheet "${sheet.getName()}" reset to zero successfully.`);
    } catch (error) {
      ui.alert(`Error resetting sheet: ${error.message}`);
    }
  },

  /**
   * PRIVATE: Handle reset all sheets operation
   *
   * Clears all transaction data from all daily sheets
   *
   * @private
   */
  _handleResetAllSheets: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = SpreadsheetApp.getUi();

    try {
      let resetCount = 0;

      CONFIG.dailySheets.forEach(sheetName => {
        const sheet = ss.getSheetByName(sheetName);
        if (sheet) {
          this._clearSheetData(sheet);
          resetCount++;
        }
      });

      ui.alert(`Reset ${resetCount} daily sheets to zero successfully.`);
    } catch (error) {
      ui.alert(`Error resetting sheets: ${error.message}`);
    }
  },

  /**
   * PRIVATE: Handle quick reset current sheet operation
   *
   * Fast clear of current sheet without confirmations
   *
   * @private
   */
  _handleQuickResetCurrentSheet: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    const ui = SpreadsheetApp.getUi();

    try {
      this._clearSheetData(sheet);
      this._toast(`Quick reset of "${sheet.getName()}" complete.`, 'Success', 3);
    } catch (error) {
      ui.alert(`Error in quick reset: ${error.message}`);
    }
  },

  /**
   * PRIVATE: Handle delete daily sheets operation
   *
   * Safely deletes sheets 02-31, protecting sheet 01 and other important sheets
   *
   * @private
   */
  _handleDeleteDailySheets: function() {
    const ui = SpreadsheetApp.getUi();
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const daysInMonth = this._getDaysInMonth(ss);
    const lastSheet   = CONFIG.dailySheets[daysInMonth - 1] || '31';

    if (!this._confirmOperation('🗑️ DELETE DAILY SHEETS (SAFE MODE)',
      `This will delete ONLY daily transaction sheets (02-${lastSheet}).\n\n` +
      'Protected sheets (01, InvoiceDatabase, etc.) will not be affected.\n\nContinue?')) return;

    try {
      const sheetsToDelete = this._collectSheetsToDelete(ss, daysInMonth);

      if (sheetsToDelete.length === 0) {
        ui.alert(`No daily sheets (02-${lastSheet}) found to delete.`);
        return;
      }

      const confirmResponse = ui.alert(
        'CONFIRM DELETION',
        `The following ${sheetsToDelete.length} sheets will be deleted:\n\n• ${sheetsToDelete.join('\n• ')}\n\nContinue?`,
        ui.ButtonSet.YES_NO
      );
      if (confirmResponse !== ui.Button.YES) {
        ui.alert('Deletion cancelled.');
        return;
      }

      const { deletedCount, errors } = this._deleteSheetsWithFeedback(sheetsToDelete, ss);

      let resultMessage = `✅ Deleted ${deletedCount} daily sheets.`;
      if (errors.length > 0) {
        resultMessage += `\n\n❌ ${errors.length} errors:\n• ${errors.join('\n• ')}`;
      }
      ui.alert('DELETION COMPLETE', resultMessage, ui.ButtonSet.OK);

    } catch (error) {
      ui.alert(`Critical Error: ${error.message}`);
    }
  },

  /** @private Collect names of deletable daily sheets for this month (02–<lastDay>, not in protectedSheets). */
  _collectSheetsToDelete: function(ss, daysInMonth) {
    const protectedSheets = ['01', 'MonthlySummary', 'SupplierList', 'Dashboard',
                             'Config', 'InvoiceDatabase', 'PaymentLog', 'AuditLog'];
    // Only sheets that exist in this month's valid range (e.g. 02–28 for February)
    const validDailySet = new Set(CONFIG.dailySheets.slice(1, daysInMonth));
    const sheetsToDelete = [];
    ss.getSheets().forEach(function(sheet) {
      const name = sheet.getName();
      if (validDailySet.has(name) && !protectedSheets.includes(name)) {
        sheetsToDelete.push(name);
      }
    });
    return sheetsToDelete;
  },

  /** @private Delete each sheet in the list, collect errors. Returns {deletedCount, errors}. */
  _deleteSheetsWithFeedback: function(sheetsToDelete, ss) {
    let deletedCount = 0;
    const errors = [];
    sheetsToDelete.forEach(function(sheetName) {
      try {
        const sheet = ss.getSheetByName(sheetName);
        if (sheet) { ss.deleteSheet(sheet); deletedCount++; }
      } catch (error) {
        errors.push(`Failed to delete ${sheetName}: ${error.message}`);
      }
    });
    return { deletedCount, errors };
  },

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * PRIVATE UTILITIES - Shared Helper Functions
   * ═══════════════════════════════════════════════════════════════════════════
   */

  /**
   * PRIVATE: Convenience wrapper for spreadsheet toast notifications.
   * @param {string} message - Toast body
   * @param {string} title   - Toast title
   * @param {number} [duration=3] - Display duration in seconds
   * @private
   */
  _toast: function(message, title, duration) {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, title, duration == null ? 3 : duration);
  },

  /**
   * PRIVATE: Show a YES/NO confirmation dialog. Returns true if the user clicked YES.
   * @param {string} title - Dialog title
   * @param {string} message - Dialog body text
   * @return {boolean}
   * @private
   */
  _confirmOperation: function(title, message) {
    const ui = SpreadsheetApp.getUi();
    return ui.alert(title, message, ui.ButtonSet.YES_NO) === ui.Button.YES;
  },

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
   * PRIVATE: Pre-fetch Master DB sheet references and last-row counters.
   *
   * In MASTER mode every getLastRow() call is a remote API call (~500ms).
   * By reading both last-row values once before the batch loop and tracking
   * them as in-memory counters, createInvoice() and _recordPayment() can
   * skip their per-row getLastRow() calls entirely.
   *
   * Returns null in LOCAL mode (no optimisation needed there).
   *
   * @returns {{invoiceSheet, paymentSheet, invoiceNextRow: number, paymentNextRow: number}|null}
   * @private
   */
  _initBatchContext: function() {
    // PERF FIX Issue 4: Acquire ONE script lock for the entire batch.
    // createInvoice() and _recordPayment() skip their per-row lock when
    // batchContext.batchLock is present, eliminating ~100 lock ops per 50 rows.
    // Non-fatal if acquisition fails — callees fall back to per-row locks.
    const batchLock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);

    if (!CONFIG.isMasterMode()) {
      // LOCAL mode: no remote sheet pre-fetching needed; carry the lock only.
      return { batchLock, invoiceSheet: null, paymentSheet: null, invoiceNextRow: null, paymentNextRow: null };
    }

    try {
      const invoiceSheet = MasterDatabaseUtils.getTargetSheet('invoice');
      const paymentSheet = MasterDatabaseUtils.getTargetSheet('payment');
      return {
        batchLock,
        invoiceSheet,
        paymentSheet,
        invoiceNextRow:  invoiceSheet.getLastRow() + 1,
        paymentNextRow:  paymentSheet.getLastRow() + 1,
      };
    } catch (e) {
      // Non-fatal — fall back to per-row getLastRow() calls; lock still carried.
      AuditLogger.logWarning('UIMenu._initBatchContext',
        `Failed to pre-fetch batch context: ${e.toString()}`);
      return { batchLock, invoiceSheet: null, paymentSheet: null, invoiceNextRow: null, paymentNextRow: null };
    }
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
    // Get transaction date from daily sheet (cell B3) - used for both invoice and payment dates
    const transactionDate = getDailySheetDate(sheetName) || new Date();

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
      invoiceDate: transactionDate,   // Invoice date from daily sheet (cell B3)
      paymentDate: transactionDate,   // Payment date from daily sheet (cell B3) - same as invoice date
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
    const message = this._buildValidationMessage(results, isPosting, 10);
    const title   = isPosting ? 'Batch Posting Results' : 'Batch Validation Results';
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  },

  /**
   * PRIVATE: Build the text body for the validation/posting results dialog.
   *
   * @param {Object}  results    - Results object with validation/posting data
   * @param {boolean} isPosting  - True if posting operation, false if validation only
   * @param {number}  maxErrors  - Maximum error entries to show before truncating
   * @return {string} Formatted multi-line message string
   * @private
   */
  _buildValidationMessage: function(results, isPosting, maxErrors) {
    let message = `Total Rows Processed: ${results.total}\n`;

    if (isPosting) {
      message += `Successfully Posted: ${results.posted}\n`;
      message += `Failed: ${results.failed}\n`;
    } else {
      message += `Valid: ${results.valid}\n`;
      message += `Invalid: ${results.invalid}\n`;
    }

    message += `Skipped (empty or already posted): ${results.skipped}\n`;

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

    if (results.errors && results.errors.length > 0) {
      message += '--- Errors ---\n';
      const errorsToShow = results.errors.slice(0, maxErrors);
      errorsToShow.forEach(function(err) {
        message += `Row ${err.row}: ${err.supplier} - ${err.invoiceNo}\n`;
        message += `  Error: ${err.error}\n\n`;
      });
      if (results.errors.length > maxErrors) {
        message += `... and ${results.errors.length - maxErrors} more errors.\n`;
        message += 'Check the Status column (K) for details.\n';
      }
    }

    return message;
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
  },

  /**
   * PRIVATE: Clear all transaction data from a sheet
   *
   * Clears content while preserving formulas, formatting, and data validation
   * Specifically handles clearing checkboxes, status messages, and system IDs
   *
   * @param {Sheet} sheet - The sheet to clear
   * @private
   */
  _clearSheetData: function(sheet) {
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    if (lastRow < CONFIG.dataStartRow) {
      return; // No data to clear
    }

    // Clear values starting from row CONFIG.dataStartRow (preserve header)
    const dataRange = sheet.getRange(CONFIG.dataStartRow, 1, lastRow - CONFIG.dataStartRow + 1, lastCol);
    dataRange.clearContent();
    dataRange.clearNote();

    // Clear specific columns to avoid breaking formulas
    const postCol = CONFIG.cols.post + 1;
    const statusCol = CONFIG.cols.status + 1;
    const sysIdCol = CONFIG.cols.sysId + 1;
    const balanceCol = CONFIG.cols.balance + 1;

    if (lastRow >= CONFIG.dataStartRow) {
      // Clear post checkboxes
      sheet.getRange(CONFIG.dataStartRow, postCol, lastRow - CONFIG.dataStartRow + 1, 1).uncheck();

      // Clear status messages
      sheet.getRange(CONFIG.dataStartRow, statusCol, lastRow - CONFIG.dataStartRow + 1, 1).clearContent();

      // Clear system IDs
      sheet.getRange(CONFIG.dataStartRow, sysIdCol, lastRow - CONFIG.dataStartRow + 1, 1).clearContent();

      // Clear balance calculations (but keep formulas)
      sheet.getRange(CONFIG.dataStartRow, balanceCol, lastRow - CONFIG.dataStartRow + 1, 1).clearContent();
    }
  },

  /**
   * PRIVATE: Update date formulas in a sheet
   *
   * Sets the B3 cell formula to calculate date offset from sheet 01
   * Sheet 01 uses date as-is, Sheet 02 adds +1 day, Sheet 03 adds +2 days, etc.
   *
   * @param {Sheet} sheet - The sheet to update
   * @param {string} sheetName - The sheet name (e.g., "02", "03")
   * @private
   */
  _updateDateFormulas: function(sheet, sheetName) {
    try {
      const dayOffset = this._getDayOffset(sheetName);
      sheet.getRange('B3').setFormula(`='01'!B3+${dayOffset}`);
    } catch (error) {
      // Silently fail - formula may already be correct or sheet may be read-only
    }
  },

  /**
   * PRIVATE: Calculate day offset for sheet date formulas
   *
   * Sheet 01 gets 0 offset, Sheet 02 gets +1, Sheet 03 gets +2, etc.
   *
   * @param {string} sheetName - The sheet name (e.g., "02", "03")
   * @return {number} Day offset (0 for sheet 01, 1 for sheet 02, etc.)
   * @private
   */
  _getDayOffset: function(sheetName) {
    const dayNum = parseInt(sheetName);
    return dayNum - 1; // Sheet 01 gets +0, Sheet 02 gets +1, etc.
  },
  
  /**
   * PRIVATE: Check if a sheet name is a daily sheet (01-31)
   *
   * @param {string} sheetName - The sheet name to check
   * @return {boolean} True if sheet is a daily sheet
   * @private
   */
  _isDailySheet: function(sheetName) {
    return CONFIG.dailySheets.includes(sheetName);
  },

  /**
   * PRIVATE: Organize all sheets in numerical order
   *
   * Reorders sheets so that daily sheets (01-31) appear first in numerical order,
   * followed by other sheets (InvoiceDatabase, PaymentLog, Settings, etc.)
   *
   * @param {Spreadsheet} ss - The spreadsheet to reorganize
   * @private
   */
  _organizeSheetOrder: function(ss) {
    const sheets = ss.getSheets();
    const dailySheets = [];
    const otherSheets = [];

    // Separate daily sheets from other sheets
    sheets.forEach(sheet => {
      const name = sheet.getName();
      if (this._isDailySheet(name)) {
        dailySheets.push({ name, sheet });
      } else {
        otherSheets.push({ name, sheet });
      }
    });

    // Sort daily sheets numerically
    dailySheets.sort((a, b) => parseInt(a.name) - parseInt(b.name));

    // Combine: daily sheets first, then other sheets
    const allSheets = [...dailySheets, ...otherSheets];

    // Reorder by moving each sheet to its target position
    allSheets.forEach((item, index) => {
      ss.setActiveSheet(item.sheet);
      ss.moveActiveSheet(index + 1);
    });
  }
}

/**
 * Run data integrity check from the custom menu.
 * Checks InvoiceDatabase formulas, PaymentLog, and SupplierLedger accessibility.
 */
function MenuRunDataIntegrityCheck() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = validateDataIntegrity({});
    if (result.valid) {
      ui.alert(
        'System Health Check Passed',
        'InvoiceDatabase formulas, PaymentLog, and SupplierLedger are all intact.',
        ui.ButtonSet.OK
      );
    } else {
      ui.alert(
        'System Health Issues Found',
        'The following issues were detected:\n\n' + result.issues.join('\n'),
        ui.ButtonSet.OK
      );
    }
  } catch (error) {
    ui.alert(
      'Health Check Failed',
      `Error running health check: ${error.message}`,
      ui.ButtonSet.OK
    );
  }
}
