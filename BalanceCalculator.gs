// ==================== MODULE: BalanceCalculator.gs ====================

/**
 * Balance calculation and supplier ledger management
 *
 * PERFORMANCE OPTIMIZATIONS:
 * - Partition-aware queries using active invoice cache (70-90% faster)
 * - O(m) complexity for supplier queries (m = supplier's active invoices)
 * - Centralized calculation logic reduces duplication
 * - Single source of truth for all balance operations
 *
 * PUBLIC API:
 * - updateBalanceCell()      — render balance cell (preview or posted)
 * - getSupplierOutstanding() — total outstanding for a supplier
 * - getInvoiceOutstanding()  — balance due for a specific invoice
 *
 * ORGANIZATION:
 * 1. Payment Type Configuration (Internal)
 * 2. Helper Classes
 * 3. BalanceCalculator Public API
 * 4. BalanceCalculator Core Calculations (Private)
 * 5. BalanceCalculator Helper Functions (Private)
 * 6. BalanceCalculator Result Builders (Private)
 *
 * NOTE: Shared constants moved to CONFIG.constants in _Config.gs for centralization
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: PAYMENT TYPE CONFIGURATION (INTERNAL)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Internal payment type configuration
 * Defines calculation rules and description templates for each payment type
 *
 * @const {Object.<string, PaymentTypeConfig>}
 * @private
 */
const PAYMENT_TYPE_CONFIG = {
  Unpaid: {
    calculateImpact: (received, payment) => received,
    descriptionTemplate: (received, payment) => `Invoice received: +${received}`,
    requiresPrevInvoice: false
  },
  Regular: {
    calculateImpact: (received, payment) => received - payment,
    descriptionTemplate: (received, payment) =>
      `Invoice received (+${received}), paid immediately (-${payment})`,
    requiresPrevInvoice: false
  },
  Partial: {
    calculateImpact: (received, payment) => received - payment,
    descriptionTemplate: (received, payment) =>
      `Invoice received (+${received}), partial payment (-${payment})`,
    requiresPrevInvoice: false
  },
  Due: {
    calculateImpact: (received, payment) => -payment,
    descriptionTemplate: (received, payment) =>
      `Payment on existing invoice: -${payment}`,
    requiresPrevInvoice: true
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: HELPER CLASSES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Helper class for tracking skipped rows during iteration
 * Used to collect diagnostic information about processing failures
 *
 * @private
 */
class RowProcessingTracker {
  constructor() {
    this.skipped = [];
  }

  /**
   * Record a skipped row with reason
   * @param {number} rowIndex - Row index that was skipped
   * @param {string} reason - Reason for skipping
   */
  skip(rowIndex, reason) {
    this.skipped.push({ rowIndex, reason });
  }

  /**
   * Get count of skipped rows
   * @returns {number} Number of rows skipped
   */
  getCount() {
    return this.skipped.length;
  }

  /**
   * Get detailed skip information
   * @returns {Array<{rowIndex: number, reason: string}>} Array of skip details
   */
  getDetails() {
    return this.skipped;
  }

  /**
   * Log summary if any rows were skipped
   * @param {string} context - Context for logging (function name)
   * @param {string} identifier - Identifier (e.g., supplier name)
   */
  logSummary(context, identifier) {
    if (this.skipped.length > 0) {
      const reasons = this.skipped.map(s => `${s.rowIndex}:${s.reason}`).join(', ');
      AuditLogger.logWarning(context,
        `Processed "${identifier}": ${this.skipped.length} rows skipped [${reasons}]`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: BALANCE CALCULATOR - PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

const BalanceCalculator = {
  /**
   * Update balance cell in daily sheet
   * Shows preview before post, actual balance after post
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
   * @param {number} row - Row number
   * @param {boolean} afterPost - Whether this is after posting
   * @param {Array} rowData - Pre-read row values (REQUIRED - no fallback reads)
   */
  updateBalanceCell: function(sheet, row, afterPost, rowData, renderBg = true) {
    if (!rowData) {
      AuditLogger.logError('BalanceCalculator.updateBalanceCell',
        'rowData parameter is required');
      return;
    }

    const validationResult = this._validateCellData(rowData);
    if (!validationResult.valid) {
      this._renderInvalidCell(sheet, row, validationResult.message);
      return;
    }

    const balanceInfo = this._computeBalanceInfo(rowData, afterPost);
    this._renderBalanceCell(sheet, row, balanceInfo, renderBg);
  },

  /**
   * Get total outstanding balance for a supplier
   *
   * @performance Uses active partition cache for 70-90% faster iteration
   * See CLAUDE.md "Cache Partitioning" for optimization details
   *
   * @param {string} supplier - Supplier name
   * @returns {number} Total outstanding balance
   */
  getSupplierOutstanding: function(supplier) {
    if (!this._validateSupplier(supplier)) {
      return 0;
    }

    const activeInvoices = this._getActiveInvoicesForSupplier(supplier);
    if (!activeInvoices) {
      return 0;
    }

    return this._sumInvoiceBalances(activeInvoices, supplier);
  },

  /**
   * Convenience wrapper: extracts supplier from rowData and returns their outstanding balance.
   * Functionally equivalent to getSupplierOutstanding(rowData[CONFIG.cols.supplier]).
   * Reserved for future callers that hold rowData rather than the extracted supplier name.
   *
   * @param {Array} rowData - Row data array
   * @returns {number} Supplier outstanding balance after posting
   */
  computeBalance: function(rowData) {
    return this.getSupplierOutstanding(rowData[CONFIG.cols.supplier]);
  },

  /**
   * Get balance due for a specific invoice
   *
   * @param {string} invoiceNo - Invoice number
   * @param {string} supplier - Supplier name
   * @returns {number} Invoice balance due or 0 if not found
   */
  getInvoiceOutstanding: function(invoiceNo, supplier) {
    if (StringUtils.isEmpty(invoiceNo) || StringUtils.isEmpty(supplier)) {
      return 0;
    }

    try {
      const invoice = InvoiceManager.findInvoice(supplier, invoiceNo);
      if (!invoice) {
        return 0;
      }
      return Number(invoice.data[CONFIG.invoiceCols.balanceDue]) || 0;
    } catch (error) {
      AuditLogger.logError('BalanceCalculator.getInvoiceOutstanding',
        `Failed to get invoice outstanding: ${error.toString()}`);
      return 0;
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: BALANCE CALCULATOR - CORE CALCULATIONS (PRIVATE)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate transaction impact on balance
   * INTERNAL: Core calculation logic used by updateBalanceCell() preview path
   *
   * @private
   * @typedef {Object} TransactionImpact
   * @property {number} change - Balance change amount
   * @property {string} description - Human-readable description of the transaction
   * @property {string|null} error - Error message or null if successful
   *
   * @param {string} paymentType - Transaction payment type
   * @param {number} receivedAmt - Amount received
   * @param {number} paymentAmt - Amount paid
   * @param {string} prevInvoice - Previous invoice reference (for Due payments)
   * @returns {TransactionImpact} Impact calculation result
   */
  _calculateTransactionImpact: function(paymentType, receivedAmt, paymentAmt, prevInvoice) {
    const config = PAYMENT_TYPE_CONFIG[paymentType];

    if (!config) {
      return this._buildUnknownTypeResult(paymentType);
    }

    if (config.requiresPrevInvoice && !prevInvoice) {
      return this._buildMissingReferenceResult();
    }

    return this._buildTransactionImpactResult(
      config.calculateImpact(receivedAmt, paymentAmt),
      config.descriptionTemplate(receivedAmt, paymentAmt)
    );
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: BALANCE CALCULATOR - HELPER FUNCTIONS (PRIVATE)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate supplier parameter
   * @private
   * @param {string} supplier - Supplier name
   * @returns {boolean} True if valid supplier name
   */
  _validateSupplier: function(supplier) {
    return !StringUtils.isEmpty(supplier);
  },

  /**
   * Get active partition invoices for supplier
   *
   * @private
   * @typedef {Object} ActiveInvoicesData
   * @property {Array<number>} rows - Array of row indices in active partition
   * @property {Array<Array>} data - Active partition data array
   *
   * @param {string} supplier - Supplier name
   * @returns {ActiveInvoicesData|null} Active invoices data or null if not available
   */
  _getActiveInvoicesForSupplier: function(supplier) {
    try {
      const cacheData = CacheManager.getInvoiceData();
      const normalizedSupplier = StringUtils.normalize(supplier);

      const activeIndex = cacheData.activeSupplierIndex;
      if (!activeIndex || !activeIndex.has(normalizedSupplier)) {
        return null;
      }

      return {
        rows: activeIndex.get(normalizedSupplier) || [],
        data: cacheData.activeData || []
      };
    } catch (error) {
      AuditLogger.logError('BalanceCalculator._getActiveInvoicesForSupplier',
        `Failed to retrieve active invoices: ${error.toString()}`);
      return null;
    }
  },

  /**
   * Sum balances from invoice rows with error tracking
   *
   * @private
   * @param {ActiveInvoicesData} activeInvoices - Object with {rows, data}
   * @param {string} supplier - Supplier name (for logging)
   * @returns {number} Total balance from active invoices
   */
  _sumInvoiceBalances: function(activeInvoices, supplier) {
    const { rows, data } = activeInvoices;
    const col = CONFIG.invoiceCols;

    let total = 0;
    const tracker = new RowProcessingTracker();

    for (const rowIndex of rows) {
      try {
        const row = data[rowIndex];
        if (!row) {
          tracker.skip(rowIndex, 'null_row');
          continue;
        }

        // Guard: formula strings appear when a new invoice was cached before SUMIFS evaluated.
        // Mirror the same fallback used in _isActiveInvoice: treat unevaluated balanceDue
        // as totalAmount (full amount still owed), matching CacheManager.gs:167.
        let rawBalance = row[col.balanceDue];
        if (typeof rawBalance === 'string' && rawBalance.startsWith('=')) {
          rawBalance = Number(row[col.totalAmount]) || 0;
        }
        const balanceDue = Number(rawBalance);

        if (!this._isValidBalance(balanceDue)) {
          tracker.skip(rowIndex, 'invalid_balance');
          continue;
        }

        total += balanceDue;

      } catch (rowError) {
        tracker.skip(rowIndex, rowError.message);
      }
    }

    tracker.logSummary('BalanceCalculator._sumInvoiceBalances', supplier);
    return total;
  },

  /**
   * Validate balance value
   * @private
   * @param {*} balance - Balance value to validate
   * @returns {boolean} True if valid number >= 0
   */
  _isValidBalance: function(balance) {
    return !isNaN(balance) && balance >= CONFIG.constants.VALID_BALANCE_MIN;
  },

  /**
   * Validate cell data for balance calculation
   *
   * @private
   * @typedef {Object} CellValidationResult
   * @property {boolean} valid - Whether data is valid
   * @property {string} [message] - Error message if invalid
   *
   * @param {Array} rowData - Row data array
   * @returns {CellValidationResult} Validation result
   */
  _validateCellData: function(rowData) {
    const supplier = rowData[CONFIG.cols.supplier];
    const paymentType = rowData[CONFIG.cols.paymentType];

    if (StringUtils.isEmpty(supplier) || !paymentType) {
      return {
        valid: false,
        message: "⚠️ Supplier and payment type required"
      };
    }

    return { valid: true };
  },

  /**
   * Compute balance information for display
   *
   * @private
   * @typedef {Object} BalanceDisplayInfo
   * @property {number} balance - Balance amount
   * @property {string} note - Display note
   * @property {string} bgColor - Background color
   *
   * @param {Array} rowData - Row data array
   * @param {boolean} afterPost - Whether after posting
   * @returns {BalanceDisplayInfo} Balance display information
   */
  _computeBalanceInfo: function(rowData, afterPost) {
    const supplier = rowData[CONFIG.cols.supplier];

    if (afterPost) {
      return this._buildPostedBalanceInfo(supplier);
    } else {
      return this._buildPreviewBalanceInfo(rowData);
    }
  },

  /**
   * Build balance info for posted transaction
   * @private
   * @param {string} supplier - Supplier name
   * @returns {BalanceDisplayInfo} Balance display info
   */
  _buildPostedBalanceInfo: function(supplier) {
    return {
      balance: this.getSupplierOutstanding(supplier),
      note:    ``,
      bgColor: CONFIG.colors.success
    };
  },

  /**
   * Build balance info for preview
   * @private
   * @param {Array} rowData - Row data array
   * @returns {BalanceDisplayInfo} Balance display info
   */
  _buildPreviewBalanceInfo: function(rowData) {
    const supplier    = rowData[CONFIG.cols.supplier];
    const paymentType = rowData[CONFIG.cols.paymentType];
    const prevInvoice = rowData[CONFIG.cols.prevInvoice];
    const receivedAmt = parseFloat(rowData[CONFIG.cols.receivedAmt]) || 0;
    const paymentAmt  = parseFloat(rowData[CONFIG.cols.paymentAmt])  || 0;

    const outstanding = this.getSupplierOutstanding(supplier);
    const impact = this._calculateTransactionImpact(paymentType, receivedAmt, paymentAmt, prevInvoice);

    const previewNote    = impact.error ? `⚠️ ${impact.error}` : `Preview: ${impact.description}`;
    const previewBalance = impact.error ? outstanding : outstanding + impact.change;

    return {
      balance: previewBalance,
      note:    `${previewNote}\nTime: ${DateUtils.formatDateTime(new Date())}`,
      bgColor: previewNote.includes('⚠️') ? CONFIG.colors.warning : CONFIG.colors.info
    };
  },

  /**
   * Render invalid cell state
   * @private
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Sheet
   * @param {number} row - Row number
   * @param {string} message - Error message
   */
  _renderInvalidCell: function(sheet, row, message) {
    sheet.getRange(row, CONFIG.cols.balance + 1)
      .clearContent()
      .setNote(message)
      .setBackground(null);
  },

  /**
   * Render balance cell with calculated info
   * @private
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Sheet
   * @param {number} row - Row number
   * @param {BalanceDisplayInfo} balanceInfo - Balance display info
   */
  _renderBalanceCell: function(sheet, row, balanceInfo, renderBg = true) {
    const range = sheet.getRange(row, CONFIG.cols.balance + 1)
      .setValue(balanceInfo.balance)
      .setNote(balanceInfo.note);
    if (renderBg) range.setBackground(balanceInfo.bgColor);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: BALANCE CALCULATOR - RESULT BUILDERS (PRIVATE)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Result Builder: Transaction impact result (success case)
   * @private
   * @param {number} change - Balance change amount
   * @param {string} description - Transaction description
   * @returns {TransactionImpact} Impact result
   */
  _buildTransactionImpactResult: function(change, description) {
    return {
      change: change,
      description: description,
      error: null
    };
  },

  /**
   * Result Builder: Unknown payment type result
   * @private
   * @param {string} paymentType - Unknown payment type
   * @returns {TransactionImpact} Error result
   */
  _buildUnknownTypeResult: function(paymentType) {
    return {
      change: 0,
      description: `Unknown payment type: ${paymentType}`,
      error: `Invalid payment type: ${paymentType}`
    };
  },

  /**
   * Result Builder: Missing previous invoice reference result
   * @private
   * @returns {TransactionImpact} Error result
   */
  _buildMissingReferenceResult: function() {
    return {
      change: 0,
      description: 'Due payment missing invoice reference',
      error: 'Due payment requires prevInvoice reference'
    };
  },

};
