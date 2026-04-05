/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Code.gs - Main Application Entry Point and Event Handlers
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Central event handler for all spreadsheet interactions.
 * Manages edit triggers, field auto-population, and transaction workflow.
 *
 * CORE RESPONSIBILITIES:
 * 1. EVENT HANDLING — onEdit() simple trigger (UI only), onEditInstallable() (full DB access)
 * 2. FIELD AUTO-POPULATION — Invoice No, Received Amt, Due payment balance population
 * 3. TRANSACTION PROCESSING — Lock-guarded POST workflow: validate → invoice → payment → balance
 *
 * DUAL TRIGGER SYSTEM:
 * - Simple (onEdit): Invoice No/Received Amt edits; ~5-10ms; no lock; no Master DB access
 * - Installable (onEditInstallable): Payment Type/Post/Due edits; ~50-150ms; lock on POST only
 * - Run setupInstallableEditTrigger() once per monthly file for Master Database mode
 *
 * MODULE ORGANIZATION:
 *   1. MODULE HEADER — This documentation
 *   2. GLOBAL TRIGGER FUNCTIONS — onEdit, onEditInstallable (entry points)
 *   3. CODE MODULE — Public API + trigger handlers + column handlers + helpers
 *   4. TRIGGER SETUP/TEARDOWN — Master Database trigger configuration
 *
 * See agent_docs/ for architecture, caching, coding patterns, and testing details.
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 2: GLOBAL TRIGGER FUNCTIONS (Entry Points)
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Simple Edit Trigger - Lightweight UI Operations Only
 *
 * Automatically triggered by Google Sheets when a user edits a cell.
 * Delegates to Code module for processing.
 *
 * RESTRICTIONS:
 * - Cannot access other spreadsheets (no Master Database access)
 * - Cannot call SpreadsheetApp.openById()
 * - Limited permissions (AuthMode.LIMITED)
 * - 30-second execution limit
 *
 * @param {GoogleAppsScript.Events.SheetsOnEditEvent} e - Edit event object
 * @returns {void}
 */
function onEdit(e) {
  Code._handleSimpleTrigger(e);
}

/**
 * Installable Edit Trigger - Full Database and Cache Operations
 *
 * Must be set up as an INSTALLABLE trigger (not automatic).
 * Run setupInstallableEditTrigger() to create it.
 * Delegates to Code module for processing.
 *
 * CAPABILITIES:
 * - Full permissions (AuthMode.FULL)
 * - Can access Master Database (SpreadsheetApp.openById)
 * - Can read/write InvoiceDatabase, PaymentLog, AuditLog
 * - Can access CacheManager for lookups
 * - Can build dropdowns with database data
 * - Can calculate balances using cache
 * - No 30-second limit
 *
 * @param {GoogleAppsScript.Events.SheetsOnEditEvent} e - Edit event object
 * @returns {void}
 */
function onEditInstallable(e) {
  Code._handleInstallableTrigger(e);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 3: CODE MODULE - Main Logic and Handlers
 * ═══════════════════════════════════════════════════════════════════════════
 */

const Code = {
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: TRIGGER HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * PRIVATE: Handle simple trigger events
   * @private
   */
  _handleSimpleTrigger: function(e) {
    if (!e || !e.range) return;

    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    const row = e.range.getRow();
    const col = e.range.getColumn();

    if (row < CONFIG.dataStartRow || !CONFIG.dailySheets.includes(sheetName)) return;

    // Optimization A: Early column guard — exit before any API call
    // Simple trigger only handles invoiceNo (col C=3) and receivedAmt (col D=4).
    const configCols = CONFIG.cols;
    const invoiceNoCol   = configCols.invoiceNo + 1;    // 3 (col C)
    const receivedAmtCol = configCols.receivedAmt + 1;  // 4 (col D)
    if (col !== invoiceNoCol && col !== receivedAmtCol) return;

    try {
      // Optimization B: Minimal batch read — from edited col through paymentType col.
      // Reads 2 cells (col D→E) or 3 cells (col C→E) instead of all 14.
      // Avoids e.value which is undefined for multi-cell pastes.
      const paymentTypeCol = configCols.paymentType + 1;  // 5 (col E)
      const numCols = paymentTypeCol - col + 1;            // 3 for col C, 2 for col D
      const rangeValues = sheet.getRange(row, col, 1, numCols).getValues()[0];
      const editedValue = rangeValues[0];
      const paymentType = rangeValues[numCols - 1];

      switch (col) {
        case invoiceNoCol:
          this._handleInvoiceNoEdit(sheet, row, paymentType, editedValue);
          break;

        case receivedAmtCol:
          this._handleReceivedAmtEdit(sheet, row, paymentType, editedValue);
          break;
      }
    } catch (error) {
      AuditLogger.logError("onEdit", error.toString());
    }
  },

  /**
   * PRIVATE: Handle installable trigger events
   * @private
   */
  _handleInstallableTrigger: function(e) {
    if (!e || !e.range) return;

    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    const row = e.range.getRow();
    const col = e.range.getColumn();

    if (row < CONFIG.dataStartRow || !CONFIG.dailySheets.includes(sheetName)) return;

    // Optimization A: Early column guard — exit before any API call
    // for non-monitored columns (A, H, I, K, L, M, N = 7 of 14 columns).
    const configCols = CONFIG.cols;
    const monitoredCols = new Set([
      configCols.post + 1, configCols.supplier + 1, configCols.paymentType + 1,
      configCols.prevInvoice + 1, configCols.paymentAmt + 1,
      configCols.receivedAmt + 1, configCols.invoiceNo + 1
    ]);
    if (!monitoredCols.has(col)) return;

    try {
      // Optimization B: Conditional row read.
      // post checkbox passes rowValues to processPostedRow which needs all 14 cols
      // (uses notes at index 8, sysId at index 13, etc.).
      // All other handlers + BalanceCalculator.updateBalanceCell need only cols A-G (indices 0-6).
      const colsToRead = (col === configCols.post + 1) ? CONFIG.totalColumns.daily : 7;
      const rowValues = sheet.getRange(row, 1, 1, colsToRead).getValues()[0];

      const editedValue = rowValues[col - 1];
      const paymentType = rowValues[configCols.paymentType];
      const supplier = rowValues[configCols.supplier];
      let updateBalance = false;

      switch (col) {
        case configCols.post + 1:
          this._handlePostCheckbox(sheet, row, rowValues);
          return;

        case configCols.supplier + 1:
          updateBalance = this._handleSupplierEdit(sheet, row, paymentType, editedValue, rowValues);
          break;

        case configCols.paymentType + 1:
          updateBalance = this._handlePaymentTypeEdit(sheet, row, paymentType, rowValues);
          break;

        case configCols.prevInvoice + 1:
          updateBalance = this._handlePrevInvoiceEdit(sheet, row, paymentType, supplier, editedValue, configCols, rowValues);
          break;

        case configCols.paymentAmt + 1:
          updateBalance = paymentType !== 'Unpaid';
          break;

        case configCols.receivedAmt + 1:
        case configCols.invoiceNo + 1:
          updateBalance = true;
          break;

        default:
          return;
      }

      if (updateBalance) {
        BalanceCalculator.updateBalanceCell(sheet, row, false, rowValues);
      }
    } catch (error) {
      AuditLogger.logError("onEditInstallable", error.toString());
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: COLUMN EDIT HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * PRIVATE: Handle Invoice No edit (simple trigger)
   * @private
   */
  _handleInvoiceNoEdit: function(sheet, row, paymentType, editedValue) {
    if (['Regular', 'Partial'].includes(paymentType)) {
      const prevInvoiceCell = sheet.getRange(row, CONFIG.cols.prevInvoice + 1);
      if (editedValue && String(editedValue).trim()) {
        prevInvoiceCell.setValue(editedValue);
      } else {
        prevInvoiceCell.clearContent().clearNote();
      }
    }
  },

  /**
   * PRIVATE: Handle Received Amount edit (simple trigger)
   * @private
   */
  _handleReceivedAmtEdit: function(sheet, row, paymentType, receivedAmt) {
    if (paymentType === 'Regular') {
      const paymentAmtCell = sheet.getRange(row, CONFIG.cols.paymentAmt + 1);
      const parsedAmt = parseFloat(receivedAmt) || 0;
      if (parsedAmt > 0) {
        paymentAmtCell.setValue(parsedAmt);
      } else {
        paymentAmtCell.clearContent().clearNote();
      }
    }
  },

  /**
   * PRIVATE: Handle POST checkbox (installable trigger)
   * @private
   */
  _handlePostCheckbox: function(sheet, row, rowValues) {
    const now = DateUtils.now();
    const sheetName = sheet.getName();
    const invoiceDate = getDailySheetDate(sheetName) || now;

    const quickValidationData = {
      sheetName: sheetName,
      rowNum: row,
      supplier: rowValues[CONFIG.cols.supplier],
      invoiceNo: rowValues[CONFIG.cols.invoiceNo],
      invoiceDate: invoiceDate,
      receivedAmt: parseFloat(rowValues[CONFIG.cols.receivedAmt]) || 0,
      paymentAmt: parseFloat(rowValues[CONFIG.cols.paymentAmt]) || 0,
      paymentType: rowValues[CONFIG.cols.paymentType],
      prevInvoice: rowValues[CONFIG.cols.prevInvoice],
      notes: rowValues[CONFIG.cols.notes],
      enteredBy: UserResolver.getCurrentUser(),
      timestamp: now,
      sysId: rowValues[CONFIG.cols.sysId] || IDGenerator.generateUUID()
    };

    const quickValidation = validatePostData(quickValidationData);
    if (!quickValidation.valid) {
      const timeStr = DateUtils.formatTime(now);
      writePostStatus(
        sheet, row,
        `ERROR: ${quickValidation.error}`,
        "SYSTEM", timeStr, false,
        CONFIG.colors.error
      );
      AuditLogger.log("VALIDATION_FAILED", quickValidationData, quickValidation.error);
      AuditLogger.flush();
      return;
    }

    const processingTimeStr = DateUtils.formatTime(now);
    writePostStatus(
      sheet, row,
      "PROCESSING...",
      "SYSTEM", processingTimeStr, true,
      CONFIG.colors.processing
    );

    const lock = LockManager.acquireDocumentLock(CONFIG.rules.LOCK_TIMEOUT_MS);
    if (!lock) {
      const timeStr = DateUtils.formatTime(now);
      writePostStatus(
        sheet, row,
        "ERROR: Unable to acquire lock (concurrent edit in progress)",
        "SYSTEM", timeStr, false,
        CONFIG.colors.warning
      );
      return;
    }

    try {
      this.processPostedRow(sheet, row, rowValues, invoiceDate, quickValidationData.enteredBy);
    } finally {
      LockManager.releaseLock(lock);
    }
  },

  /**
   * PRIVATE: Handle Supplier edit (installable trigger)
   * @private
   */
  _handleSupplierEdit: function(sheet, row, paymentType, supplier, rowValues) {
    if (paymentType === 'Due') {
      if (supplier && String(supplier).trim()) {
        InvoiceManager.buildDuePaymentDropdown(
          sheet, row, supplier, paymentType,
          rowValues ? rowValues[CONFIG.cols.prevInvoice] : null
        );
      }
      return false;
    }
    return true;
  },

  /**
   * PRIVATE: Handle Payment Type edit (installable trigger)
   * @private
   */
  _handlePaymentTypeEdit: function(sheet, row, paymentType, rowValues) {
    this.clearPaymentFieldsForTypeChange(sheet, row, paymentType);

    if (['Regular', 'Partial'].includes(paymentType)) {
      const populatedValues = this.populatePaymentFields(sheet, row, paymentType, rowValues);
      rowValues[CONFIG.cols.paymentAmt] = populatedValues.paymentAmt;
      rowValues[CONFIG.cols.prevInvoice] = populatedValues.prevInvoice;
      return true;
    } else if (paymentType === 'Due') {
      const currentSupplier = rowValues[CONFIG.cols.supplier];
      if (currentSupplier && String(currentSupplier).trim()) {
        InvoiceManager.buildDuePaymentDropdown(
          sheet, row, currentSupplier, paymentType,
          rowValues[CONFIG.cols.prevInvoice]
        );
      }
      return false;
    }
    return true;
  },

  /**
   * PRIVATE: Handle Prev Invoice edit (installable trigger)
   * @private
   */
  _handlePrevInvoiceEdit: function(sheet, row, paymentType, supplier, editedValue, configCols, rowValues) {
    if ((paymentType === 'Due') && supplier && editedValue) {
      const populatedAmount = this.populateDuePaymentAmount(sheet, row, supplier, editedValue);
      rowValues[configCols.paymentAmt] = populatedAmount;
    }
    return true;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSACTION PROCESSING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Process Posted Row - Full Transaction Workflow
   *
   * Orchestrates the complete transaction workflow for a posted row:
   *   1. Validates post data (early exit if invalid - no lock acquired)
   *   2. Creates or updates invoice
   *   3. Records payment (if applicable)
   *   4. Updates balance
   *   5. Invalidates cache
   *   6. Batches all writes (minimum API calls)
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet object
   * @param {number} rowNum - Row number to process (1-based)
   * @param {Array} rowData - Pre-read row values from sheet.getRange().getValues()[0]
   * @param {Date} invoiceDate - Invoice date for transaction
   * @param {string} enteredBy - User email of person posting transaction
   * @returns {void} Updates sheet in-place, logs to AuditLog
   */
  processPostedRow: function(sheet, rowNum, rowData, invoiceDate, enteredBy) {
    const cols = CONFIG.cols;
    const colors = CONFIG.colors;
    const now = DateUtils.now();
    const timeStr = DateUtils.formatTime(now);
    const sheetName = sheet.getName();

    try {
      const built = this._buildTransactionData(sheet, rowNum, rowData, invoiceDate, enteredBy, sheetName, now);
      rowData = built.rowData;
      const data = built.data;

      const validation = validatePostData(data);
      if (!validation.valid) {
        writePostStatus(sheet, rowNum, `ERROR: ${validation.error}`, "SYSTEM", timeStr, false, colors.error);
        sheet.getRange(rowNum, cols.balance + 1)
          .clearContent()
          .setNote(`⚠️ Validation failed - balance not calculated\n${validation.error}`)
          .setBackground(colors.error);
        AuditLogger.log("VALIDATION_FAILED", data, validation.error);
        AuditLogger.flush();
        return;
      }

      const invoiceResult = InvoiceManager.createOrUpdateInvoice(data);
      if (!invoiceResult.success) {
        writePostStatus(sheet, rowNum, `ERROR: ${invoiceResult.error}`, "SYSTEM", timeStr, false, colors.error);
        sheet.getRange(rowNum, cols.balance + 1)
          .clearContent()
          .setNote(`⚠️ Invoice processing failed\n${invoiceResult.error}`)
          .setBackground(colors.error);
        return;
      }

      if (PaymentManager.shouldRecordPayment(data)) {
        const paymentResult = PaymentManager.processPayment(data, invoiceResult.invoiceId);
        if (!paymentResult.success) {
          writePostStatus(sheet, rowNum, `ERROR: ${paymentResult.error}`, "SYSTEM", timeStr, false, colors.error);
          sheet.getRange(rowNum, cols.balance + 1)
            .clearContent()
            .setNote(`⚠️ Payment processing failed\n${paymentResult.error}`)
            .setBackground(colors.error);
          return;
        }
      }

      BalanceCalculator.updateBalanceCell(sheet, rowNum, true, rowData);

      const sysIdValue = !rowData[cols.sysId] ? data.sysId : null;
      // Mark payment written before invalidation so cache defers re-read until SUMIFS recalculates
      // See CLAUDE.md Critical Gotcha #2
      CacheManager.markPaymentWritten(data.supplier, data.invoiceNo || data.prevInvoice);
      CacheManager.invalidateSupplierCache(data.supplier);

      const statusUpdates = [[true, "POSTED", UserResolver.extractUsername(data.enteredBy), timeStr]];
      sheet.getRange(rowNum, cols.post + 1, 1, 4).setValues(statusUpdates);

      if (sysIdValue) {
        sheet.getRange(rowNum, cols.sysId + 1).setValue(sysIdValue);
      }

      const bgRange = CONFIG.totalColumns.daily - 5;
      sheet.getRange(rowNum, 2, 1, bgRange).setBackground(colors.success);

    } catch (error) {
      const errMsg = `SYSTEM ERROR: ${error.message || error}`;
      writePostStatus(sheet, rowNum, errMsg, "SYSTEM", timeStr, false, colors.error);
      AuditLogger.logError('processPostedRow', error.toString());
    }
  },

  /**
   * Build transaction data object from row
   *
   * Reads missing rowData from sheet if not supplied, coerces field types,
   * and assembles the canonical `data` payload used throughout the POST workflow.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {number} rowNum
   * @param {Array|null} rowData - Pre-read row values, or null to read from sheet
   * @param {Date|null} invoiceDate
   * @param {string|null} enteredBy
   * @param {string} sheetName
   * @param {Date} now
   * @returns {{rowData: Array, data: Object}}
   */
  _buildTransactionData: function(sheet, rowNum, rowData, invoiceDate, enteredBy, sheetName, now) {
    const cols = CONFIG.cols;
    if (!rowData) {
      rowData = sheet.getRange(rowNum, 1, 1, CONFIG.totalColumns.daily).getValues()[0];
    }
    const finalInvoiceDate = invoiceDate || getDailySheetDate(sheetName) || now;
    const finalEnteredBy = enteredBy || UserResolver.getCurrentUser();
    return {
      rowData: rowData,
      data: {
        sheetName,
        rowNum,
        supplier:    rowData[cols.supplier],
        invoiceNo:   rowData[cols.invoiceNo],
        invoiceDate: finalInvoiceDate,
        receivedAmt: parseFloat(rowData[cols.receivedAmt]) || 0,
        paymentAmt:  parseFloat(rowData[cols.paymentAmt]) || 0,
        paymentType: rowData[cols.paymentType],
        paymentDate: getDailySheetDate(sheetName) || now,
        prevInvoice: rowData[cols.prevInvoice],
        notes:       rowData[cols.notes],
        enteredBy:   finalEnteredBy,
        timestamp:   now,
        sysId:       rowData[cols.sysId] || IDGenerator.generateUUID()
      }
    };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FIELD POPULATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clear Payment Fields for Type Change
   *
   * Clears only necessary fields based on payment type selection.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet object
   * @param {number} row - Row number (1-based)
   * @param {string} newPaymentType - New payment type selected
   * @returns {void} Updates sheet in-place
   */
  clearPaymentFieldsForTypeChange: function(sheet, row, newPaymentType) {
    try {
      const cols = CONFIG.cols;
      const paymentAmtCol  = cols.paymentAmt  + 1;
      const prevInvoiceCol = cols.prevInvoice + 1;

      // Optimization: obtain range lazily inside each case — eliminates 2–4 wasted API calls
      // (2 getValue always wasted; 1–2 getRange wasted depending on case).
      // clearedFields/clearedValues removed: dead code (never consumed after assignment).
      switch (newPaymentType) {
        case 'Regular':
        case 'Partial':
          sheet.getRange(row, prevInvoiceCol)
            .clearContent().clearNote().clearDataValidations().setBackground(null);
          break;

        case 'Due':
          sheet.getRange(row, paymentAmtCol)
            .clearContent().clearNote().clearDataValidations().setBackground(null);
          break;

        case 'Unpaid':
        default:
          sheet.getRange(row, prevInvoiceCol, 1, 2)
            .clearContent().clearNote().clearDataValidations().setBackground(null);
          break;
      }

    } catch (error) {
      AuditLogger.logError('clearPaymentFieldsForTypeChange',
        `Failed to clear fields at row ${row}: ${error.toString()}`);
    }
  },

  /**
   * Populate Due Payment Amount
   *
   * Fills payment amount with the outstanding balance of selected invoice.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet object
   * @param {number} row - Row number (1-based)
   * @param {string} supplier - Supplier name for invoice lookup
   * @param {string} prevInvoice - Previous invoice number selected
   * @returns {number|string} Outstanding balance or empty string
   */
  populateDuePaymentAmount: function(sheet, row, supplier, prevInvoice) {
    try {
      if (!prevInvoice || !String(prevInvoice).trim()) {
        return '';
      }

      const invoiceBalance = BalanceCalculator.getInvoiceOutstanding(prevInvoice, supplier);
      const targetCell = sheet.getRange(row, CONFIG.cols.paymentAmt + 1);

      if (invoiceBalance > 0) {
        targetCell
          .setValue(invoiceBalance)
          .setNote(`Outstanding balance of ${prevInvoice}: ${invoiceBalance}/-`)
          .setBackground(null);
        return invoiceBalance;
      } else {
        targetCell
          .clearContent()
          .setNote(`⚠️ Invoice ${prevInvoice} has no outstanding balance.\n\nPossible reasons:\n- Invoice is fully paid\n- Invoice not found\n- Invoice belongs to different supplier`)
          .setBackground(CONFIG.colors.warning);
        return '';
      }

    } catch (error) {
      AuditLogger.logError('populateDuePaymentAmount',
        `Failed to auto-populate due payment at row ${row}: ${error.toString()}`);
      const targetCell = sheet.getRange(row, CONFIG.cols.paymentAmt + 1);
      targetCell
        .clearContent()
        .setNote('Error loading invoice balance')
        .setBackground(CONFIG.colors.error);
      return '';
    }
  },

  /**
   * Populate Payment Fields
   *
   * Fills payment fields for Regular and Partial payment types.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet object
   * @param {number} row - Row number (1-based)
   * @param {string} paymentType - Payment type (Regular or Partial)
   * @param {Array} rowData - Pre-read row values
   * @returns {Object} Result object with {paymentAmt, prevInvoice}
   */
  populatePaymentFields: function(sheet, row, paymentType, rowData) {
    try {
      const invoiceNo = rowData[CONFIG.cols.invoiceNo];
      const receivedAmt = rowData[CONFIG.cols.receivedAmt];
      const hasInvoice = invoiceNo && invoiceNo !== '';
      const hasAmount = receivedAmt && receivedAmt !== '';

      const isPartial = StringUtils.equals(paymentType, 'Partial');
      const bgColor = isPartial ? CONFIG.colors.warning : null;

      if (hasInvoice && hasAmount) {
        const startCol = CONFIG.cols.prevInvoice + 1;
        const twoColRange = sheet.getRange(row, startCol, 1, 2);
        twoColRange.setValues([[invoiceNo, receivedAmt]]);
        twoColRange.offset(0, 1, 1, 1).setBackground(bgColor);  // offset() = 0 API calls
      } else if (hasInvoice) {
        sheet.getRange(row, CONFIG.cols.prevInvoice + 1).setValue(invoiceNo);
        sheet.getRange(row, CONFIG.cols.paymentAmt + 1).setBackground(bgColor);
      } else if (hasAmount) {
        sheet.getRange(row, CONFIG.cols.paymentAmt + 1).setValue(receivedAmt).setBackground(bgColor);
      } else {
        // Both empty — still apply correct background so prior state (e.g. Partial warning)
        // is cleared when switching to a type that has no values to populate.
        sheet.getRange(row, CONFIG.cols.paymentAmt + 1).setBackground(bgColor);
      }

      return {
        paymentAmt: receivedAmt || '',
        prevInvoice: invoiceNo || ''
      };

    } catch (error) {
      AuditLogger.logError('populatePaymentFields',
        `Failed to auto-populate at row ${row}: ${error.toString()}`);
      return { paymentAmt: '', prevInvoice: '' };
    }
  },

};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 4: TRIGGER SETUP/TEARDOWN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Manages trigger lifecycle for Master Database mode.
 * When using Master Database, onEdit must be an INSTALLABLE trigger
 * (not a simple trigger) to access other spreadsheets.
 */

/**
 * Set Up Installable Edit Trigger
 *
 * Creates an installable Edit trigger for Master Database access.
 *
 * @returns {void} Shows confirmation dialog
 *
 */
function setupInstallableEditTrigger() {
  const ss = SpreadsheetApp.getActive();

  // Remove any existing Edit triggers to avoid duplicates
  const triggers = ScriptApp.getUserTriggers(ss);
  triggers.forEach(trigger => {
    if (trigger.getEventType() === ScriptApp.EventType.ON_EDIT) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create new installable Edit trigger → Calls onEditInstallable (NOT onEdit)
  const newTrigger = ScriptApp.newTrigger('onEditInstallable')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  Logger.log('✅ Installable Edit trigger created successfully!');
  Logger.log(`   Trigger ID: ${newTrigger.getUniqueId()}`);
  Logger.log(`   Handler Function: onEditInstallable`);
  Logger.log('');
  Logger.log('The onEditInstallable function now has full permissions to access Master Database.');
  Logger.log('Simple trigger (onEdit) will handle lightweight UI operations only.');
  Logger.log('You can now post transactions that will write to the Master Database.');
}

/**
 * Remove Installable Edit Trigger
 *
 * Removes the installable Edit trigger if it exists.
 *
 * @returns {void} Shows confirmation dialog with count of triggers removed
 *
 */
function removeInstallableEditTrigger() {
  const ss = SpreadsheetApp.getActive();
  const triggers = ScriptApp.getUserTriggers(ss);
  let removed = 0;

  triggers.forEach(trigger => {
    if (trigger.getEventType() === ScriptApp.EventType.ON_EDIT) {
      ScriptApp.deleteTrigger(trigger);
      Logger.log(`Removed Edit trigger: ${trigger.getUniqueId()}`);
      removed++;
    }
  });

  Logger.log(`✅ Removed ${removed} Edit trigger(s)`);

  SpreadsheetApp.getUi().alert(
    'Trigger Removed',
    `Removed ${removed} installable Edit trigger(s).\n\n` +
    'The system will now use the simple onEdit trigger again (limited permissions).',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Menu handler: Setup Installable Trigger with pre-confirmation dialog
 */
function setupInstallableTriggerWithConfirmation() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '⚠️ Setup Installable Trigger',
    'This will remove any existing edit triggers and install a new one for Master Database mode.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );
  if (response === ui.Button.YES) {
    setupInstallableEditTrigger();
  }
}

/**
 * Menu handler: Remove Installable Trigger with pre-confirmation dialog
 */
function removeInstallableTriggerWithConfirmation() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '⚠️ Remove Installable Trigger',
    'This will remove the installable edit trigger.\n\n' +
    'The spreadsheet will fall back to the simple onEdit trigger. ' +
    'Master Database writes will stop working.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );
  if (response === ui.Button.YES) {
    removeInstallableEditTrigger();
  }
}
