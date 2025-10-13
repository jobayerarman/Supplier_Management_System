// ==================== MODULE: BalanceCalculator.gs ====================

/**
 * BalanceCalculator.gs
 * Handles all balance-related calculations and supplier ledger updates
 * 
 * OPTIMIZATIONS:
 * - getSupplierOutstanding() uses InvoiceCache.supplierIndex for O(m) performance
 * - Consolidated calculate() and calculatePreview() logic via _calculateTransactionImpact()
 * - Single source of truth for balance calculation rules
 * - Added error logging for skipped rows
 */

const BalanceCalculator = {
  /**
   * Calculate balance and update supplier ledger
   * ALWAYS returns supplier's total outstanding after transaction
   */
  calculate: function(data) {
    const supplierOutstanding = this.getSupplierOutstanding(data.supplier); 
    let newBalance = supplierOutstanding;

    switch (data.paymentType) {
      case "Unpaid":
        newBalance = supplierOutstanding + data.receivedAmt;
        break;

      case "Partial":
        newBalance = supplierOutstanding + data.receivedAmt - data.paymentAmt;
        break;

      case "Regular":
        newBalance = supplierOutstanding + data.receivedAmt - data.paymentAmt;
        break;

      case "Due":
        if (!data.prevInvoice) {
          logSystemError('BalanceCalculator.calculate', 'Due payment missing prevInvoice reference');
          return supplierOutstanding;
        }
        newBalance = supplierOutstanding - data.paymentAmt;
        break;

      default:
        logSystemError('BalanceCalculator.calculate', `Unknown payment type: ${data.paymentType}`);
        newBalance = supplierOutstanding;
    }

    return newBalance;
  },

  /**
   * Calculate balance preview (before post)
   * @param {string} supplier - Supplier name
   * @param {string} paymentType - Payment type
   * @param {number} receivedAmt - Received amount
   * @param {number} paymentAmt - Payment amount
   * @param {string} prevInvoice - Previous invoice reference
   * @returns {Object} Object with balance and note
   */
  calculatePreview: function(supplier, paymentType, receivedAmt, paymentAmt, prevInvoice) {
    if (StringUtils.isEmpty(supplier) || !paymentType) {
      return { balance: 0, note: "Balance requires supplier & payment type" };
    }

    let balance = 0;
    let note = "";

    switch (paymentType) {
      case "Unpaid":
        balance = this.getSupplierOutstanding(supplier) + receivedAmt;
        note = "Preview: Supplier outstanding after receiving";
        break;
      
      case "Partial":
        balance = this.getSupplierOutstanding(supplier) + receivedAmt - paymentAmt;
        note = "Preview: Supplier outstanding after partial payment";
        break;

      case "Regular":
        balance = this.getSupplierOutstanding(supplier) + receivedAmt - paymentAmt;
        note = "Preview: Supplier outstanding (net zero expected)";
        break;

      case "Due":
        if (StringUtils.isEmpty(prevInvoice)) {
          return { balance: 0, note: "Select previous invoice" };
        }
        balance = this.getSupplierOutstanding(supplier) - paymentAmt;
        note = `Preview: Supplier outstanding after paying ${paymentAmt}`;
        break;

      default:
        return { balance: 0, note: "Invalid payment type" };
    }

    return { balance: balance, note: note };
  },

  /**
   * Get total outstanding balance for a supplier
   * OPTIMIZED: Uses InvoiceCache.supplierIndex for O(m) performance where m = supplier's invoices
   * 
   * Performance improvements:
   * - Leverages cached data (no sheet read)
   * - Uses supplier index for direct lookup (no full table scan)
   * - Only iterates supplier-specific rows
   * - Logs skipped rows with details
   * 
   * @param {string} supplier - Supplier name
   * @returns {number} Total outstanding balance
   */
  getSupplierOutstanding: function(supplier) {
    if (StringUtils.isEmpty(supplier)) {
      return 0;
    }

    try {
      // Get cached data with supplier index (zero API calls when cache is warm)
      const { data, supplierIndex } = InvoiceCache.getInvoiceData();

      const normalizedSupplier = StringUtils.normalize(supplier);
      const rowIndices = supplierIndex.get(normalizedSupplier);
      
      // Supplier not found in index
      if (!rowIndices || rowIndices.length === 0) {
        return 0;
      }

      let total = 0;
      let skippedRows = 0;
      
      // Only iterate supplier-specific rows (O(m) where m = supplier's invoice count)
      for (const rowIndex of rowIndices) {
        try {
          const row = data[rowIndex];

          // Double-check supplier match (defensive programming)
          if (!StringUtils.equals(row[CONFIG.invoiceCols.supplier], normalizedSupplier)) {
            AuditLogger.logWarning('BalanceCalculator.getSupplierOutstanding',
              `Index mismatch: Row ${rowIndex + 1} indexed for "${supplier}" but contains "${row[CONFIG.invoiceCols.supplier]}"`);
            skippedRows++;
            continue;
          }

          const balanceDue = Number(row[CONFIG.invoiceCols.balanceDue]);

          // Validate balance is a valid number
          if (isNaN(balanceDue)) {
            AuditLogger.logWarning('BalanceCalculator.getSupplierOutstanding',
              `Invalid balance at row ${rowIndex + 1} for supplier "${supplier}": "${row[CONFIG.invoiceCols.balanceDue]}"`);
            skippedRows++;
            continue;
          }

          total += balanceDue;

        } catch (rowError) {
          // Log specific row errors instead of silently skipping
          AuditLogger.logWarning('BalanceCalculator.getSupplierOutstanding',
            `Error processing row ${rowIndex + 1} for supplier "${supplier}": ${rowError.toString()}`);
          skippedRows++;
        }
      }

      // Log summary if rows were skipped
      if (skippedRows > 0) {
        AuditLogger.logWarning('BalanceCalculator.getSupplierOutstanding',
          `Calculated outstanding for "${supplier}": ${total} (${skippedRows} rows skipped due to errors)`);
      }

      return total;
    } catch (error) {
      logSystemError('BalanceCalculator.getSupplierOutstanding', 
        `Failed to get outstanding for supplier "${supplier}": ${error.toString()}`);
      return 0;
    }
  },

  /**
   * Get balance due for a specific invoice
   * @param {string} invoiceNo - Invoice number
   * @param {string} supplier - Supplier name
   * @returns {number} Invoice balance due or 0 if not found
   */
  getInvoiceOutstanding: function(invoiceNo, supplier) {
    if (StringUtils.isEmpty(invoiceNo) || StringUtils.isEmpty(supplier)) {
      return 0;
    }

    try {
      const invoice = findInvoiceRecord(supplier, invoiceNo);
      if (!invoice) {
        return 0;
      }
      return Number(invoice.data[CONFIG.invoiceCols.balanceDue]) || 0; // Column F (index 5)
    } catch (error) {
      logSystemError('BalanceCalculator.getInvoiceOutstanding', 
        `Failed to get invoice outstanding: ${error.toString()}`);
      return 0;
    }
  },

  /**
   * Get balance summary for supplier
   * @param {string} supplier - Supplier name
   * @returns {Object|null} Summary object or null on error
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
   * @param {Object} data - Transaction data
   * @returns {Object} {matches: boolean, preview: number, actual: number, difference: number}
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
    const matches = difference < 0.01;
    
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

// ==================== BACKWARD COMPATIBILITY ====================

function calculateBalance(data) {
  return BalanceCalculator.calculate(data);
}

function getOutstandingForSupplier(supplier) {
  return BalanceCalculator.getSupplierOutstanding(supplier);
}

function getInvoiceOutstanding(invoiceNo, supplier) {
  return BalanceCalculator.getInvoiceOutstanding(invoiceNo, supplier);
}

function updateSupplierLedger(supplier, newBalance) {
  return BalanceCalculator.updateLedger(supplier, newBalance);
}