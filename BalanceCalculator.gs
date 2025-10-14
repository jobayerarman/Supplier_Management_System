// ==================== MODULE: BalanceCalculator.gs ====================

/**
 * BalanceCalculator.gs
 * Handles all balance-related calculations and supplier ledger updates
 * 
 * OPTIMIZATIONS:
 * - getSupplierOutstanding() uses InvoiceCache.supplierIndex for O(m) performance
 * - Consolidated calculate() and calculatePreview() logic via _calculateTransactionImpact()
 * - Moved updateBalanceCell() from Code.gs for better encapsulation
 * - Single source of truth for all balance operations
 * - Added error logging for skipped rows
 */

const BalanceCalculator = {
  /**
   * Calculate transaction impact on balance
   * INTERNAL: Core calculation logic used by both calculate() and calculatePreview()
   * 
   * @private
   * @param {string} paymentType - Transaction payment type
   * @param {number} receivedAmt - Amount received
   * @param {number} paymentAmt - Amount paid
   * @param {string} prevInvoice - Previous invoice reference (for Due payments)
   * @returns {Object} {change: number, description: string, error: string|null}
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
   * @param {string} supplier - Supplier name
   * @param {string} paymentType - Payment type
   * @param {number} receivedAmt - Received amount
   * @param {number} paymentAmt - Payment amount
   * @param {string} prevInvoice - Previous invoice reference
   * @returns {Object} {balance: number, note: string}
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
    
    // Generate user-friendly note
    let note = `Preview: ${impact.description}`;
    if (paymentType === 'Regular' && Math.abs(impact.change) < 0.01) {
      note += ' (net zero expected)';
    }
    
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
      note = `Posted: Supplier total outstanding = ${balance}\nUpdated: ${DateUtils.formatDateTime(new Date())}`;
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
      note = `${preview.note}\nCalculated: ${DateUtils.formatDateTime(new Date())}`;

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
      .setNote(note)
      .setBackground(bgColor);
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
      const invoice = InvoiceManager.find(supplier, invoiceNo);
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