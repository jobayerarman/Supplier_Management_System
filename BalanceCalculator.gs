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
 * ORGANIZATION:
 * 1. Constants
 * 2. BalanceCalculator Public API
 * 3. BalanceCalculator Core Calculations (Private)
 * 4. Backward Compatibility Functions
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** @const {number} Tolerance for balance comparison (floating point precision) */
const BALANCE_TOLERANCE = 0.01;

/** @const {number} Minimum valid balance value */
const VALID_BALANCE_MIN = 0;

/** @const {number} Threshold for considering invoice fully paid */
const FULLY_PAID_THRESHOLD = 0.01;

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: BALANCE CALCULATOR - PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

const BalanceCalculator = {
  /**
   * Calculate transaction impact on balance
   * INTERNAL: Core calculation logic used by both calculate() and calculatePreview()
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
    switch (paymentType) {
      case "Unpaid":
        return {
          change: receivedAmt,
          description: `Invoice received: +${receivedAmt}`,
          error: null
        };

      case "Regular":
        return {
          change: receivedAmt - paymentAmt,
          description: `Invoice received (+${receivedAmt}), paid immediately (-${paymentAmt})`,
          error: null
        };

      case "Partial":
        return {
          change: receivedAmt - paymentAmt,
          description: `Invoice received (+${receivedAmt}), partial payment (-${paymentAmt})`,
          error: null
        };

      case "Due":
        if (!prevInvoice) {
          return {
            change: 0,
            description: 'Due payment missing invoice reference',
            error: 'Due payment requires prevInvoice reference'
          };
        }
        return {
          change: -paymentAmt,
          description: `Payment on existing invoice: -${paymentAmt}`,
          error: null
        };

      default:
        return {
          change: 0,
          description: `Unknown payment type: ${paymentType}`,
          error: `Invalid payment type: ${paymentType}`
        };
    }
  },

  /**
   * Calculate balance after transaction
   * ALWAYS returns supplier's total outstanding after transaction
   *
   * @param {Object} data - Transaction data
   * @returns {number} New balance after transaction
   */
  calculate: function(data) {
    const supplierOutstanding = this.getSupplierOutstanding(data.supplier);

    // Calculate impact using centralized logic
    const impact = this._calculateTransactionImpact(
      data.paymentType,
      data.receivedAmt,
      data.paymentAmt,
      data.prevInvoice
    );

    // Log errors if any
    if (impact.error) {
      logSystemError('BalanceCalculator.calculate',
        `${impact.error} | Supplier: ${data.supplier}, Type: ${data.paymentType}`);
    }

    const newBalance = supplierOutstanding + impact.change;

    return newBalance;
  },

  /**
   * Calculate balance preview (before post)
   * Shows what the balance will be after transaction is posted
   *
   * @typedef {Object} BalancePreviewResult
   * @property {number} balance - Projected balance after transaction
   * @property {string} note - Human-readable preview note with transaction description
   *
   * @param {string} supplier - Supplier name
   * @param {string} paymentType - Payment type
   * @param {number} receivedAmt - Received amount
   * @param {number} paymentAmt - Payment amount
   * @param {string} prevInvoice - Previous invoice reference
   * @returns {BalancePreviewResult} Balance preview with note
   */
  calculatePreview: function(supplier, paymentType, receivedAmt, paymentAmt, prevInvoice) {
    if (StringUtils.isEmpty(supplier) || !paymentType) {
      return {
        balance: 0,
        note: "⚠️ Supplier and payment type required"
      };
    }

    const currentOutstanding = this.getSupplierOutstanding(supplier);

    // Calculate impact using centralized logic
    const impact = this._calculateTransactionImpact(
      paymentType,
      receivedAmt,
      paymentAmt,
      prevInvoice
    );

    // Handle errors
    if (impact.error) {
      return {
        balance: currentOutstanding,
        note: `⚠️ ${impact.error}`
      };
    }

    const projectedBalance = currentOutstanding + impact.change;

    let note = `Preview: ${impact.description}`;

    return {
      balance: projectedBalance,
      note: note
    };
  },

  /**
   * Update balance cell in daily sheet
   * Shows preview before post, actual balance after post
   * MOVED FROM Code.gs for better encapsulation
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
   * @param {number} row - Row number
   * @param {boolean} afterPost - Whether this is after posting
   * @param {Array} rowData - Pre-read row values (REQUIRED - no fallback reads)
   */
  updateBalanceCell: function(sheet, row, afterPost, rowData) {
    // Validate required parameter
    if (!rowData) {
      logSystemError('BalanceCalculator.updateBalanceCell',
        'rowData parameter is required (no fallback reads allowed)');
      return;
    }

    const supplier = rowData[CONFIG.cols.supplier];
    const paymentType = rowData[CONFIG.cols.paymentType];
    const balanceCell = sheet.getRange(row, CONFIG.cols.balance + 1);

    // Validate minimum required data
    if (StringUtils.isEmpty(supplier) || !paymentType) {
      balanceCell
        .clearContent()
        .setNote("⚠️ Supplier and payment type required")
        .setBackground(null);
      return;
    }

    let balance = 0;
    let note = "";
    let bgColor = null;

    if (afterPost) {
      // AFTER POST: Show actual supplier total outstanding
      balance = this.getSupplierOutstanding(supplier);
      note = `Posted: Supplier outstanding = ${balance}/-\nUpdated: ${DateUtils.formatDateTime(new Date())}`;
      bgColor = CONFIG.colors.success;

    } else {
      // BEFORE POST: Show preview of what balance will be
      const prevInvoice = rowData[CONFIG.cols.prevInvoice];
      const receivedAmt = parseFloat(rowData[CONFIG.cols.receivedAmt]) || 0;
      const paymentAmt = parseFloat(rowData[CONFIG.cols.paymentAmt]) || 0;

      const preview = this.calculatePreview(
        supplier,
        paymentType,
        receivedAmt,
        paymentAmt,
        prevInvoice
      );

      balance = preview.balance;
      note = `${preview.note}\nTime: ${DateUtils.formatDateTime(new Date())}`;

      // Color coding for preview
      if (preview.note.includes('⚠️')) {
        bgColor = CONFIG.colors.warning;
      } else {
        bgColor = CONFIG.colors.info;
      }
    }

    // Single write operation to balance cell
    balanceCell
      .setValue(balance)
      .setNote(note);
  },

  /**
   * Get total outstanding balance for a supplier
   *
   * @performance Uses active partition cache for 70-90% faster iteration
   * See CLAUDE.md "Cache Partitioning" for optimization details
   *
   * OPTIMIZATION: Partition-aware consumer - queries ACTIVE partition only
   * - Active partition: Invoices with balance > $0.01 (typically 10-30% of total)
   * - Skips fully paid invoices entirely
   * - 10x faster for established suppliers with many paid invoices
   *
   * Performance metrics:
   * - Query time: O(m) where m = supplier's active invoices (not total invoices)
   * - Typical supplier: 200 total, 20 active → iterates only 20 invoices
   * - Cache hit: ~1-5ms, Cache miss: ~200-400ms (local), ~300-600ms (master)
   *
   * @param {string} supplier - Supplier name
   * @returns {number} Total outstanding balance
   */
  getSupplierOutstanding: function(supplier) {
    if (StringUtils.isEmpty(supplier)) {
      return 0;
    }

    try {
      // ✅ PERFORMANCE: Use ACTIVE partition (invoices with balance > 0)
      const cacheData = CacheManager.getInvoiceData();
      const normalizedSupplier = StringUtils.normalize(supplier);

      // Try active partition first (fast path - only unpaid/partial invoices)
      const activeIndex = cacheData.activeSupplierIndex || null;
      if (activeIndex && activeIndex.has(normalizedSupplier)) {
        const activeRows = activeIndex.get(normalizedSupplier) || [];
        const activeData = cacheData.activeData || [];
        const col = CONFIG.invoiceCols;

        let total = 0;
        let skippedRows = 0;

        // Iterate ONLY active invoices (balanceDue > 0.01)
        for (const rowIndex of activeRows) {
          try {
            const row = activeData[rowIndex];
            if (!row) {
              // Skip nulled entries (partition transitions)
              skippedRows++;
              continue;
            }

            const balanceDue = Number(row[col.balanceDue]);

            // Validate balance is a valid number
            if (isNaN(balanceDue)) {
              AuditLogger.logWarning('BalanceCalculator.getSupplierOutstanding',
                `Invalid balance at active index ${rowIndex} for supplier "${supplier}": "${row[col.balanceDue]}"`);
              skippedRows++;
              continue;
            }

            total += balanceDue;

          } catch (rowError) {
            AuditLogger.logWarning('BalanceCalculator.getSupplierOutstanding',
              `Error processing active row ${rowIndex} for supplier "${supplier}": ${rowError.toString()}`);
            skippedRows++;
          }
        }

        // Log summary if rows were skipped
        if (skippedRows > 0) {
          AuditLogger.logWarning('BalanceCalculator.getSupplierOutstanding',
            `Calculated outstanding for "${supplier}": ${total} (${skippedRows} rows skipped)`);
        }

        return total;
      }

      // No active partition available - return 0
      AuditLogger.logWarning('BalanceCalculator.getSupplierOutstanding',
        `Active partition not available for supplier "${supplier}"`);
      return 0;
    } catch (error) {
      logSystemError('BalanceCalculator.getSupplierOutstanding',
        `Failed to get outstanding for supplier "${supplier}": ${error.toString()}`);
      return 0;
    }
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
      const invoice = InvoiceManager.find(supplier, invoiceNo);
      if (!invoice) {
        return 0;
      }
      return Number(invoice.data[CONFIG.invoiceCols.balanceDue]) || 0;
    } catch (error) {
      logSystemError('BalanceCalculator.getInvoiceOutstanding',
        `Failed to get invoice outstanding: ${error.toString()}`);
      return 0;
    }
  },

  /**
   * Get balance summary for supplier
   *
   * @typedef {Object} SupplierSummary
   * @property {string} supplier - Supplier name
   * @property {number} outstanding - Total outstanding balance
   * @property {number} unpaidInvoiceCount - Number of unpaid invoices
   * @property {Array} unpaidInvoices - Array of unpaid invoice objects
   *
   * @param {string} supplier - Supplier name
   * @returns {SupplierSummary|null} Summary object or null on error
   */
  getSupplierSummary: function(supplier) {
    try {
      const outstanding = this.getSupplierOutstanding(supplier);
      const unpaidInvoices = InvoiceManager.getUnpaidForSupplier(supplier);

      return {
        supplier: supplier,
        outstanding: outstanding,
        unpaidInvoiceCount: unpaidInvoices.length,
        unpaidInvoices: unpaidInvoices
      };
    } catch (error) {
      logSystemError('BalanceCalculator.getSupplierSummary',
        `Failed to get summary for ${supplier}: ${error.toString()}`);
      return null;
    }
  },

  /**
   * Validate that preview matches actual result (for testing/debugging)
   *
   * @typedef {Object} PreviewValidationResult
   * @property {boolean} matches - Whether preview and actual match (within tolerance)
   * @property {number} preview - Preview balance calculated
   * @property {number} actual - Actual balance calculated
   * @property {number} difference - Absolute difference between preview and actual
   *
   * @param {Object} data - Transaction data
   * @returns {PreviewValidationResult} Validation result with comparison details
   */
  validatePreviewAccuracy: function(data) {
    // Calculate preview
    const preview = this.calculatePreview(
      data.supplier,
      data.paymentType,
      data.receivedAmt,
      data.paymentAmt,
      data.prevInvoice
    );

    // Calculate actual
    const actual = this.calculate(data);

    // Compare (allow small rounding differences)
    const difference = Math.abs(preview.balance - actual);
    const matches = difference < BALANCE_TOLERANCE;

    if (!matches) {
      AuditLogger.logWarning('BalanceCalculator.validatePreviewAccuracy',
        `Preview/Actual mismatch | Supplier: ${data.supplier} | Preview: ${preview.balance} | Actual: ${actual} | Diff: ${difference}`);
    }

    return {
      matches: matches,
      preview: preview.balance,
      actual: actual,
      difference: difference
    };
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: BACKWARD COMPATIBILITY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Legacy wrapper for BalanceCalculator.calculate()
 * @deprecated Use BalanceCalculator.calculate() directly
 * @param {Object} data - Transaction data
 * @returns {number} Calculated balance
 */
function calculateBalance(data) {
  return BalanceCalculator.calculate(data);
}

/**
 * Legacy wrapper for BalanceCalculator.getSupplierOutstanding()
 * @deprecated Use BalanceCalculator.getSupplierOutstanding() directly
 * @param {string} supplier - Supplier name
 * @returns {number} Total outstanding balance
 */
function getOutstandingForSupplier(supplier) {
  return BalanceCalculator.getSupplierOutstanding(supplier);
}

/**
 * Legacy wrapper for BalanceCalculator.getInvoiceOutstanding()
 * @deprecated Use BalanceCalculator.getInvoiceOutstanding() directly
 * @param {string} invoiceNo - Invoice number
 * @param {string} supplier - Supplier name
 * @returns {number} Invoice balance due
 */
function getInvoiceOutstanding(invoiceNo, supplier) {
  return BalanceCalculator.getInvoiceOutstanding(invoiceNo, supplier);
}

/**
 * Legacy function - no longer used
 * @deprecated Ledger updates handled automatically by InvoiceManager
 * @param {string} supplier - Supplier name
 * @param {number} newBalance - New balance (unused)
 */
function updateSupplierLedger(supplier, newBalance) {
  return BalanceCalculator.updateLedger(supplier, newBalance);
}
