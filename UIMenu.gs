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
function batchSyncPaymentFields() {
  UIMenu.batchSyncPaymentFields();
}

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
 * Global handler: Show CacheService status dialog
 * Delegates to UIMenu module
 */
function menuShowCacheStatus() { UIMenu.showCacheStatus(); }

/**
 * Global handler: Force full cache rebuild (clear + reload from sheet)
 * Delegates to UIMenu module
 */
function menuForceRebuildCache() { UIMenu.forceRebuildCache(); }

/**
 * Global handler: Clear runtime + CacheService (lazy reload on next use)
 * Delegates to UIMenu module
 */
function menuClearCache() { UIMenu.clearCache(); }

/**
 * Global handler: Drop in-memory cache only; CacheService entry preserved
 * Delegates to UIMenu module
 */
function menuClearRuntimeCache() { UIMenu.clearRuntimeCache(); }

/**
 * Global handler: Invalidate a single supplier's cache entries
 * Delegates to UIMenu module
 */
function menuInvalidateSupplierCache() { UIMenu.invalidateSupplierCache(); }

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 3: UIMENU MODULE - Batch Operations Implementation
 * ═══════════════════════════════════════════════════════════════════════════
 */

const UIMenu = {

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * PUBLIC API
   * ═══════════════════════════════════════════════════════════════════════════
   */

  /**
   * Creates custom menu items on spreadsheet open
   * Adds: Batch operations, sheet management, reset utilities, and user settings
   */
  createMenus: function() {
    const ui = SpreadsheetApp.getUi();

    ui.createMenu('📋 FP - Operations')
      .addItem('🔄 Batch Sync Payment Fields', 'batchSyncPaymentFields')

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

      // ═══ CACHE ═══
      .addSubMenu(ui.createMenu('🗄️ Cache Management')
        .addItem('ℹ️ Show Cache Status', 'menuShowCacheStatus')
        .addSeparator()
        .addItem('🔄 Force Rebuild (Reload Now)', 'menuForceRebuildCache')
        .addItem('🗑️ Clear Cache (Lazy Reload)', 'menuClearCache')
        .addItem('💨 Clear Runtime Only', 'menuClearRuntimeCache')
        .addSeparator()
        .addItem('🎯 Invalidate Supplier Cache', 'menuInvalidateSupplierCache'))

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

  batchSyncPaymentFields: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    if (!this._validateDailySheet(sheet)) return;
    if (!UIUtils.confirmOperation('Batch Sync Payment Fields',
      'This will populate payment fields for all unprocessed rows on this sheet.\n\nContinue?')) return;
    const results = UIMenuBatchSync.handleBatchSync(sheet);
    UIMenuBatchSync._showSyncResults(results);
  },

  batchValidateAllRows: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    if (!this._validateDailySheet(sheet)) return;
    if (!UIUtils.confirmOperation('Batch Validate All Rows',
      'This will validate all rows in the current sheet. Continue?')) return;
    const results = UIMenuBatchPosting.handleBatchValidation(sheet);
    UIMenuBatchPosting.showValidationResults(results, false);
  },

  batchPostAllRows: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    if (!this._validateDailySheet(sheet)) return;
    if (!UIUtils.confirmOperation('Batch Post All Valid Rows',
      'This will validate and post all valid rows in the current sheet.\n\nWARNING: This action cannot be undone. Continue?')) return;
    const results = UIMenuBatchPosting.handleBatchPosting(sheet);
    UIMenuBatchPosting.showValidationResults(results, true);
  },

  batchValidateSelectedRows: function() {
    const ui    = SpreadsheetApp.getUi();
    const sheet = SpreadsheetApp.getActiveSheet();
    if (!this._validateDailySheet(sheet)) return;
    const selection = sheet.getActiveRange();
    const startRow  = selection.getRow();
    const numRows   = selection.getNumRows();
    if (startRow < CONFIG.dataStartRow) {
      ui.alert('Invalid Selection',
               `Please select data rows (row ${CONFIG.dataStartRow} and below).`,
               ui.ButtonSet.OK);
      return;
    }
    const results = UIMenuBatchPosting.handleBatchValidation(sheet, startRow, startRow + numRows - 1);
    UIMenuBatchPosting.showValidationResults(results, false);
  },

  batchPostSelectedRows: function() {
    const ui    = SpreadsheetApp.getUi();
    const sheet = SpreadsheetApp.getActiveSheet();
    if (!this._validateDailySheet(sheet)) return;
    const selection = sheet.getActiveRange();
    const startRow  = selection.getRow();
    const numRows   = selection.getNumRows();
    if (startRow < CONFIG.dataStartRow) {
      ui.alert('Invalid Selection',
               `Please select data rows (row ${CONFIG.dataStartRow} and below).`,
               ui.ButtonSet.OK);
      return;
    }
    if (!UIUtils.confirmOperation('Batch Post Selected Rows',
      `This will validate and post ${numRows} selected row(s).\n\nWARNING: This action cannot be undone. Continue?`)) return;
    const results = UIMenuBatchPosting.handleBatchPosting(sheet, startRow, startRow + numRows - 1);
    UIMenuBatchPosting.showValidationResults(results, true);
  },

  clearAllPostCheckboxes: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    if (!this._validateDailySheet(sheet)) return;
    if (!UIUtils.confirmOperation('Clear All Post Checkboxes',
      'This will uncheck all post checkboxes (Column J) in the current sheet. Continue?')) return;
    UIMenuSheetManager.handleClearCheckboxes(sheet);
  },

  createDailySheets: function() {
    if (!UIUtils.confirmOperation('Create All Daily Sheets (02-31)',
      'This will create sheets 02-31 using sheet 01 as a template and update all formulas.\n\nContinue?')) return;
    UIMenuSheetManager.handleCreateDailySheets();
  },

  createMissingSheets: function() {
    if (!UIUtils.confirmOperation('Create Missing Sheets Only',
      'This will create only missing daily sheets (02-31) that don\'t already exist.\n\nContinue?')) return;
    UIMenuSheetManager.handleCreateMissingSheets();
  },

  organizeSheets: function() {
    if (!UIUtils.confirmOperation('Reorganize Sheets',
      'This will reorder all sheets to place daily sheets (01-31) first in numerical order.\n\nContinue?')) return;
    UIMenuSheetManager.handleOrganizeSheets();
  },

  fixDateFormulasOnly: function() {
    if (!UIUtils.confirmOperation('Fix Date Formulas Only',
      'This will update all date formulas in daily sheets (02-31) to correctly reference sheet 01.\n\nContinue?')) return;
    UIMenuSheetManager.handleFixDateFormulas();
  },

  resetInputCellsToZero: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    if (!this._validateDailySheet(sheet)) return;
    if (!UIUtils.confirmOperation('Reset Current Sheet to Zero',
      `This will clear all transaction data from sheet "${sheet.getName()}" while preserving formulas and formatting.\n\nContinue?`)) return;
    UIMenuSheetManager.handleResetCurrentSheet();
  },

  resetAllDailySheetsToZero: function() {
    if (!UIUtils.confirmOperation('Reset All Daily Sheets to Zero',
      'This will clear all transaction data from ALL daily sheets (01-31) while preserving formulas and formatting.\n\nWARNING: This cannot be undone. Continue?')) return;
    UIMenuSheetManager.handleResetAllSheets();
  },

  quickResetCurrentSheet: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    if (!this._validateDailySheet(sheet)) return;
    UIMenuSheetManager.handleQuickResetCurrentSheet();
  },

  deleteDailySheetsSafe: function() {
    UIMenuSheetManager.handleDeleteDailySheets();
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

  // ═══════════════════════════════════════════════════════════════════════════
  // CACHE MANAGEMENT MENU HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Shows a dialog with runtime + CacheService status, payload size, active invoice
   * count, last-persist timestamp, and partition distribution stats.
   */
  showCacheStatus: function() {
    const ui = SpreadsheetApp.getUi();
    const key = CacheManager._getServiceKey();
    const raw = CacheService.getScriptCache().get(key);

    const lines = [];

    // ── Runtime status ──────────────────────────────────────────────────────
    const runtimeWarm = !!(CacheManager.timestamp && CacheManager.activeData);
    lines.push('RUNTIME CACHE');
    lines.push('  Status: ' + (runtimeWarm ? 'Warm' : 'Cold'));
    if (runtimeWarm) {
      const remainingS = Math.max(0,
        Math.round((CONFIG.rules.CACHE_TTL_MS - (Date.now() - CacheManager.timestamp)) / 1000));
      lines.push('  TTL remaining: ' + remainingS + 's');
    }
    lines.push('');

    // ── CacheService status ─────────────────────────────────────────────────
    lines.push('CACHESERVICE (cross-execution)');
    let serviceActiveRows = 0;
    let servicePayload = null;
    if (!raw) {
      lines.push('  Status: Cold (empty)');
    } else {
      try {
        servicePayload = JSON.parse(raw);
        const elapsedS = (Date.now() - servicePayload.timestamp) / 1000;
        const ttlRemainingS = Math.max(0,
          Math.round(CONFIG.rules.CACHE_SERVICE_TTL_S - elapsedS));
        serviceActiveRows = Array.isArray(servicePayload.activeData)
          ? servicePayload.activeData.length - 1 : 0;
        const persistedAt = new Date(servicePayload.timestamp).toLocaleTimeString();
        const maxKb = Math.round(CONFIG.rules.CACHE_SERVICE_MAX_BYTES / 1000);
        lines.push('  Status: Warm');
        lines.push('  TTL remaining: ' + ttlRemainingS + 's (~' +
                   Math.ceil(ttlRemainingS / 60) + ' min)');
        lines.push('  Payload size: ' + (raw.length / 1024).toFixed(1) + ' KB' +
                   ' / ' + maxKb + ' KB max');
        lines.push('  Active invoices cached: ' + serviceActiveRows);
        lines.push('  Last persisted: ' + persistedAt);
      } catch (e) {
        lines.push('  Status: Corrupt (parse error)');
        servicePayload = null;
      }
    }
    lines.push('');

    // ── Partition stats ─────────────────────────────────────────────────────
    if (runtimeWarm) {
      // Runtime is loaded — show full live stats
      const stats = CacheManager.getPartitionStats();
      lines.push('PARTITION STATS (runtime)');
      lines.push('  Active (unpaid/partial): ' + stats.active.count +
                 ' rows (' + stats.active.percentage + '%)');
      lines.push('  Inactive (paid):         ' + stats.inactive.count +
                 ' rows (' + stats.inactive.percentage + '%)');
      lines.push('  Total: ' + stats.total + ' rows');
    } else if (servicePayload) {
      // Runtime cold but CacheService warm — derive from persisted payload
      lines.push('PARTITION STATS (from CacheService)');
      lines.push('  Active (unpaid/partial): ' + serviceActiveRows + ' rows');
      lines.push('  Inactive (paid):         not persisted');
      lines.push('  Note: full stats available after next onEdit or Force Rebuild');
    } else {
      lines.push('PARTITION STATS');
      lines.push('  No data — cache is empty');
    }

    ui.alert('🗄️ Cache Status', lines.join('\n'), ui.ButtonSet.OK);
  },

  /**
   * Clears runtime + CacheService, immediately reloads from InvoiceDatabase sheet,
   * and re-persists. Fixes stale data caused by direct edits to the Master DB spreadsheet.
   */
  forceRebuildCache: function() {
    const ui = SpreadsheetApp.getUi();
    if (ui.alert(
      '🔄 Force Rebuild Cache',
      'This will clear all cache data and immediately reload from the InvoiceDatabase sheet.\n\n' +
      'Use this to fix stale data caused by direct edits to the spreadsheet.\n\nContinue?',
      ui.ButtonSet.YES_NO
    ) !== ui.Button.YES) return;

    CacheManager.clear();
    const data = CacheManager.getInvoiceData();
    const activeRows = Array.isArray(data.activeData) ? data.activeData.length - 1 : 0;

    ui.alert(
      '✅ Cache Rebuilt',
      'Cache reloaded from sheet successfully.\n\nActive invoices loaded: ' + activeRows,
      ui.ButtonSet.OK
    );
  },

  /**
   * Clears runtime + CacheService without reloading. Cache rebuilds lazily on the
   * next onEdit trigger (via CacheService restore or full sheet read).
   */
  clearCache: function() {
    const ui = SpreadsheetApp.getUi();
    if (ui.alert(
      '🗑️ Clear Cache',
      'This will clear the runtime and CacheService cache.\n\n' +
      'The cache will rebuild automatically on the next operation.\n\nContinue?',
      ui.ButtonSet.YES_NO
    ) !== ui.Button.YES) return;

    CacheManager.clear();
    UIUtils.toast('Cache cleared. Will rebuild on next use.', '🗑️ Cache Cleared', 4);
  },

  /**
   * Drops in-memory runtime state only. CacheService entry is preserved so the
   * next access restores from CacheService rather than doing a full sheet read.
   */
  clearRuntimeCache: function() {
    CacheManager.timestamp          = null;
    CacheManager.activeData         = null;
    CacheManager.inactiveData       = null;
    CacheManager.activeIndexMap     = null;
    CacheManager.inactiveIndexMap   = null;
    CacheManager.activeSupplierIndex   = null;
    CacheManager.inactiveSupplierIndex = null;
    CacheManager.globalIndexMap     = null;

    SpreadsheetApp.getUi().alert(
      '💨 Runtime Cache Cleared',
      'In-memory cache dropped for this session.\n\n' +
      'CacheService is intact — the next operation will restore from CacheService ' +
      '(no sheet read required).',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  },

  /**
   * Prompts for a supplier name and calls CacheManager.invalidateSupplierCache()
   * to refresh only that supplier's active partition entries.
   */
  invalidateSupplierCache: function() {
    const ui = SpreadsheetApp.getUi();
    const response = ui.prompt(
      '🎯 Invalidate Supplier Cache',
      'Enter the exact supplier name to invalidate:',
      ui.ButtonSet.OK_CANCEL
    );
    if (response.getSelectedButton() !== ui.Button.OK) return;

    const supplier = response.getResponseText().trim();
    if (!supplier) {
      ui.alert('No supplier name entered.', ui.ButtonSet.OK);
      return;
    }

    CacheManager.invalidateSupplierCache(supplier);
    ui.alert(
      '✅ Supplier Cache Invalidated',
      'Cache entries refreshed for supplier: ' + supplier,
      ui.ButtonSet.OK
    );
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
