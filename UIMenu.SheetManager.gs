/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UIMenu.SheetManager.gs — Daily Sheet Management Operations
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sub-module of UIMenu. Handles all daily sheet lifecycle operations:
 * create, delete, reset, organize, and formula maintenance.
 * Called exclusively by UIMenu's thin public API methods.
 *
 * PUBLIC INTERFACE (called by UIMenu):
 *   handleClearCheckboxes(sheet)
 *   handleCreateDailySheets()
 *   handleCreateMissingSheets()
 *   handleOrganizeSheets()
 *   handleFixDateFormulas()
 *   handleResetCurrentSheet()
 *   handleResetAllSheets()
 *   handleQuickResetCurrentSheet()
 *   handleDeleteDailySheets()       ← handles its own double-confirmation internally
 *
 * Dependencies: _Config.gs, _Utils.gs (UIUtils)
 */

const UIMenuSheetManager = {

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC INTERFACE — called by UIMenu
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * PRIVATE: Handle clear checkboxes operation
   *
   * Clears all POST checkboxes in the current sheet.
   *
   * @param {Sheet} sheet - The sheet to process
   */
  handleClearCheckboxes: function(sheet) {
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

    UIUtils.toast('All post checkboxes cleared successfully.', 'Success', 5);
  },

  /**
   * Handle create all daily sheets operation
   *
   * Creates sheets 02–<last day of month> from sheet 01 as template.
   * Updates formulas to reference previous day's sheet.
   */
  handleCreateDailySheets: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = SpreadsheetApp.getUi();

    try {
      const templateSheet = ss.getSheetByName('01');
      if (!templateSheet) {
        throw new Error('Template sheet "01" not found');
      }

      // Start from Day 2 — up to the last day of the template month
      const daysInMonth = this._getDaysInMonth(ss);
      const sheetsToCreate = CONFIG.dailySheets.slice(1, daysInMonth);

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
   * Handle create missing daily sheets operation
   *
   * Creates only missing sheets (02-31 that don't exist)
   */
  handleCreateMissingSheets: function() {
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
      CONFIG.dailySheets.slice(1, daysInMonth).forEach(sheetName => {
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
   * Handle organize sheets operation
   *
   * Reorders sheets in numerical order (01-31 first, then other sheets)
   */
  handleOrganizeSheets: function() {
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
   * Handle fix date formulas operation
   *
   * Updates date formulas in all daily sheets (02-31)
   */
  handleFixDateFormulas: function() {
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
   * Handle reset current sheet operation
   *
   * Clears all transaction data from current sheet
   */
  handleResetCurrentSheet: function() {
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
   * Handle reset all sheets operation
   *
   * Clears all transaction data from all daily sheets
   */
  handleResetAllSheets: function() {
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
   * Handle quick reset current sheet operation
   *
   * Fast clear of current sheet without confirmations
   */
  handleQuickResetCurrentSheet: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    const ui = SpreadsheetApp.getUi();

    try {
      this._clearSheetData(sheet);
      UIUtils.toast(`Quick reset of "${sheet.getName()}" complete.`, 'Success', 3);
    } catch (error) {
      ui.alert(`Error in quick reset: ${error.message}`);
    }
  },

  /**
   * Handle delete daily sheets operation
   *
   * Safely deletes sheets 02-31, protecting sheet 01 and other important sheets
   */
  handleDeleteDailySheets: function() {
    const ui = SpreadsheetApp.getUi();
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const daysInMonth = this._getDaysInMonth(ss);
    const lastSheet   = CONFIG.dailySheets[daysInMonth - 1] || '31';

    if (!UIUtils.confirmOperation('🗑️ DELETE DAILY SHEETS (SAFE MODE)',
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

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET CREATION HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET ORGANIZATION
  // ═══════════════════════════════════════════════════════════════════════════

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
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET RESET & DATA CLEARING
  // ═══════════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET DELETION HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

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

}; // end UIMenuSheetManager
