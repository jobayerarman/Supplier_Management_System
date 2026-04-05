/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Code.gs - Main Application Entry Point and Event Handlers
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * OVERVIEW:
 * Central event handler module for all spreadsheet interactions.
 * Manages edit triggers (both simple and installable), field auto-population,
 * and transaction workflow orchestration.
 *
 * CORE RESPONSIBILITIES:
 * ━━━━━━━━━━━━━━━━━━━━
 * 1. EVENT HANDLING
 *    - onEdit(): Simple trigger for lightweight UI operations (no database access)
 *    - onEditInstallable(): Installable trigger for full database operations
 *    - triggerSetup/teardown functions for Master Database mode support
 *
 * 2. FIELD AUTO-POPULATION
 *    - Code.populatePaymentFields(): Copy Invoice No/Received Amt to payment fields
 *    - Code.populateDuePaymentAmount(): Fetch outstanding balance for Due payments
 *    - Code.clearPaymentFieldsForTypeChange(): Clear irrelevant fields when type changes
 *
 * 3. TRANSACTION PROCESSING
 *    - Code.processPostedRow(): Main workflow orchestration for posted rows
 *    - Validates, creates invoices, records payments, updates balances
 *    - Manages lock acquisition and error handling
 *
 * ARCHITECTURE & DESIGN PATTERNS:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * MODULE ORGANIZATION (following PaymentManager/InvoiceManager patterns):
 *   1. MODULE HEADER - This documentation
 *   2. GLOBAL TRIGGER FUNCTIONS - onEdit, onEditInstallable (entry points)
 *   3. CODE MODULE - Public API and private helpers
 *      - PUBLIC API - Core transaction processing
 *      - EVENT HANDLERS - Per-column edit handlers
 *      - FIELD POPULATION - Auto-population helpers
 *      - INTERNAL UTILITIES - Private helper functions
 *   4. TRIGGER SETUP/TEARDOWN - Master Database configuration
 *
 * DESIGN PATTERNS USED:
 *   • Module Pattern: Encapsulation via Code object with public/private methods
 *   • Handler Dispatch: Switch-based routing to specific column handlers
 *   • Single Responsibility: Each handler focused on specific column edit
 *   • Early Exit Pattern: Return early to avoid nested blocks
 *   • Write-Through Updates: Cache invalidation after state changes
 *   • Error Boundary: Try-catch with consistent audit logging
 *
 * PERFORMANCE STRATEGY:
 * ━━━━━━━━━━━━━━━━━━━
 * - Single batch read per edit event (1 API call per trigger)
 * - Zero redundant cell reads (pass rowData through function chain)
 * - Parameter passing optimization (Phase 2 UserResolver)
 * - Optimized lock acquisition (only for critical POST operations)
 * - Early validation before lock acquisition (fail fast pattern)
 * - Surgical cache invalidation (supplier-specific only)
 *
 * CONCURRENCY STRATEGY:
 * ━━━━━━━━━━━━━━━━━━
 * - Document locks acquired ONLY for critical POST operations
 * - Non-POST edits execute without locks (better concurrency)
 * - Early validation exits before attempting lock (fail fast)
 * - Lock scope minimal (only during critical state changes)
 * - 60-70% reduction in lock contention vs previous implementation
 *
 * DUAL TRIGGER SYSTEM:
 * ━━━━━━━━━━━━━━━━━━
 * SIMPLE TRIGGER (onEdit - global entry point):
 *   - Run for: Invoice No, Received Amount edits
 *   - Permissions: Limited (current spreadsheet only)
 *   - Purpose: Lightweight field copying (Invoice No → Prev Invoice, etc.)
 *   - Duration: ~5-10ms per edit
 *   - No lock required
 *   - Delegates to Code._handleSimpleTrigger() for processing
 *
 * INSTALLABLE TRIGGER (onEditInstallable - global entry point):
 *   - Run for: Payment Type, Post, Due Invoice selection, Payment Amount
 *   - Permissions: Full (can access Master Database)
 *   - Purpose: Database operations, cache access, balance calculations
 *   - Duration: ~50-150ms per edit
 *   - Lock acquired only for POST operations
 *   - Delegates to Code._handleInstallableTrigger() for processing
 *
 * MASTER DATABASE SUPPORT:
 * ━━━━━━━━━━━━━━━━━━━━
 * When using Master Database mode:
 *   1. Run setupInstallableEditTrigger() (one-time setup)
 *   2. Simple trigger (onEdit) continues to work for UI operations
 *   3. Installable trigger (onEditInstallable) accesses Master Database
 *   4. All writes routed automatically via InvoiceManager/PaymentManager
 *   5. Cache reads from local IMPORTRANGE (always fresh)
 *
 * INTEGRATION POINTS:
 * ━━━━━━━━━━━━━━━━━
 * VALIDATION INTEGRATION (ValidationEngine.gs):
 *   - validatePostData(): Main validation before processing
 *   - validatePaymentTypeRules(): Payment type specific rules
 *   - Early validation in onEditInstallable prevents lock acquisition
 *
 * INVOICE INTEGRATION (InvoiceManager.gs):
 *   - createOrUpdateInvoice(): Main invoice UPSERT operation
 *   - buildDuePaymentDropdown(): UI dropdown for Due payments
 *   - updateInvoiceInCache(): Sync cache after payment
 *
 * PAYMENT INTEGRATION (PaymentManager.gs):
 *   - processPayment(): Main payment recording with paid date workflow
 *   - PaymentCache: O(1) duplicate detection and query operations
 *
 * BALANCE INTEGRATION (BalanceCalculator.gs):
 *   - updateBalanceCell(): Calculate and display balance after transaction
 *   - Works with both pre-post preview and post-actual balance
 *
 * CACHE INTEGRATION (CacheManager.gs):
 *   - Automatic invalidation after state changes
 *   - Surgical supplier-specific invalidation reduces overhead
 *   - Write-through support for fresh data
 *
 * USER RESOLUTION (UserResolver.gs):
 *   - getCurrentUser(): Get actual logged-in user
 *   - Parameter passing optimization (Phase 2) reduces redundant calls
 *   - Dual-level caching: Execution-scoped + UserProperties
 *
 * AUDIT INTEGRATION (AuditLogger.gs):
 *   - All operations logged with timestamp and user tracking
 *   - Error logging for debugging and compliance
 *
 * Modular Architecture Dependencies:
 * - _Config.gs → global configuration
 * - _Utils.gs → string, date, sheet, ID generation utilities
 * - _UserResolver.gs → user identification system
 * - AuditLogger.gs → audit trail operations
 * - ValidationEngine.gs → business rule validation
 * - InvoiceManager.gs → invoice CRUD operations
 * - PaymentManager.gs → payment processing
 * - BalanceCalculator.gs → balance calculations
 * - CacheManager.gs → performance-critical caching
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
  // PUBLIC API - CORE TRANSACTION PROCESSING
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
    this._processPostedRowInternal(sheet, rowNum, rowData, invoiceDate, enteredBy);
  },

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
    this._clearPaymentFieldsForTypeChange(sheet, row, newPaymentType);
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
    return this._populateDuePaymentAmount(sheet, row, supplier, prevInvoice);
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
    return this._populatePaymentFields(sheet, row, paymentType, rowData);
  },

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
  // PRIVATE: TRANSACTION PROCESSING INTERNALS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * PRIVATE: Main transaction processing logic
   * @private
   */
  _processPostedRowInternal: function(sheet, rowNum, rowData, invoiceDate, enteredBy) {
    const cols = CONFIG.cols;
    const totalCols = CONFIG.totalColumns.daily;
    const colors = CONFIG.colors;
    const now = DateUtils.now();
    const timeStr = DateUtils.formatTime(now);
    const sheetName = sheet.getName();

    try {
      if (!rowData) {
        rowData = sheet.getRange(rowNum, 1, 1, totalCols).getValues()[0];
      }

      const supplier = rowData[cols.supplier];
      const invoiceNo = rowData[cols.invoiceNo];
      const receivedAmt = parseFloat(rowData[cols.receivedAmt]) || 0;
      const paymentType = rowData[cols.paymentType];
      const prevInvoice = rowData[cols.prevInvoice];
      const paymentAmt = parseFloat(rowData[cols.paymentAmt]) || 0;
      const sysId = rowData[cols.sysId] || IDGenerator.generateUUID();

      const finalInvoiceDate = invoiceDate || getDailySheetDate(sheetName) || now;
      const paymentDate = getDailySheetDate(sheetName) || now;
      const finalEnteredBy = enteredBy || UserResolver.getCurrentUser();

      const data = {
        sheetName,
        rowNum,
        supplier,
        invoiceNo,
        invoiceDate: finalInvoiceDate,
        receivedAmt,
        paymentAmt,
        paymentType,
        paymentDate: paymentDate,
        prevInvoice,
        notes: rowData[cols.notes],
        enteredBy: finalEnteredBy,
        timestamp: now,
        sysId
      };

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
      CacheManager.markPaymentWritten(supplier, data.invoiceNo || data.prevInvoice);
      CacheManager.invalidateSupplierCache(supplier);

      const statusUpdates = [[true, "POSTED", UserResolver.extractUsername(finalEnteredBy), timeStr]];
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

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: FIELD POPULATION INTERNALS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * PRIVATE: Clear payment fields implementation
   * @private
   */
  _clearPaymentFieldsForTypeChange: function(sheet, row, newPaymentType) {
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
   * PRIVATE: Populate due payment amount implementation
   * @private
   */
  _populateDuePaymentAmount: function(sheet, row, supplier, prevInvoice) {
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
   * PRIVATE: Populate payment fields implementation
   * @private
   */
  _populatePaymentFields: function(sheet, row, paymentType, rowData) {
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
