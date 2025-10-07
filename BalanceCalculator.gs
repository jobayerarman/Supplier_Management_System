// ==================== MODULE: BalanceCalculator.gs ====================

/**
 * BalanceCalculator.gs
 * Handles all balance-related calculations and supplier ledger updates
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

      case "Partial":
        newBalance = supplierOutstanding + data.receivedAmt - data.paymentAmt;
        break;

      default:
        logSystemError('BalanceCalculator.calculate', `Unknown payment type: ${data.paymentType}`);
        newBalance = supplierOutstanding;
    }

    return newBalance;
  },

  /**
   * Get total outstanding balance for a supplier
   * Sums all Balance Due amounts from InvoiceDatabase
   * @param {string} supplier - Supplier name
   * @returns {number} Total outstanding balance
   */
  getSupplierOutstanding: function(supplier) {
    if (StringUtils.isEmpty(supplier)) {
      return 0;
    }

    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const data = invoiceSh.getDataRange().getValues();
      let total = 0;
      
      for (let i = 1; i < data.length; i++) {
        try {
          if (StringUtils.equals(data[i][CONFIG.invoiceCols.supplier], supplier)) {
            const bal = Number(data[i][CONFIG.invoiceCols.balanceDue]) || 0; // Balance Due is column F (index 5)
            total += bal;
          }
        } catch (e) {
          // skip bad rows silently
        }
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
   * Calculate balance preview (before post)
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

      case "Regular":
        balance = this.getSupplierOutstanding(supplier) + receivedAmt - paymentAmt;
        note = "Preview: Supplier outstanding (net zero expected)";
        break;

      case "Partial":
        balance = this.getSupplierOutstanding(supplier) + receivedAmt - paymentAmt;
        note = "Preview: Supplier outstanding after partial payment";
        break;

      case "Due":
        if (StringUtils.isEmpty(prevInvoice)) {
          return { balance: 0, note: "Select previous invoice" };
        }
        balance = this.getInvoiceOutstanding(prevInvoice, supplier);
        note = `Preview: Invoice ${prevInvoice} balance (before payment)`;
        break;

      default:
        return { balance: 0, note: "Invalid payment type" };
    }

    return { balance: balance, note: note };
  },

  /**
   * Get balance summary for supplier
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