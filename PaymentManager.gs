// ==================== MODULE: PaymentManager.gs ====================
/**
 * Payment management module
 * Handles all payment operations
 */

const PaymentManager = {
  /**
   * Process and log payment
   * 
   * @param {Object} data - Transaction data
   * @returns {Object} Result with success flag and payment details
   */
  process: function(data) {
    try {
      const paymentSh = SheetUtils.getSheet(CONFIG.paymentSheet);
      
      // Determine which invoice this payment applies to
      const targetInvoice = data.paymentType === 'Due' ? data.prevInvoice : data.invoiceNo;
      
      // Check for duplicate payment
      if (this.isDuplicate(data.sysId)) {
        return { success: false, error: 'Duplicate payment detected' };
      }
      
      // Build payment row using column indices
      const paymentRow = new Array(CONFIG.totalColumns.payment);

      // Get payment date from daily sheet (same as invoice date)
      const paymentDate = getDailySheetDate(data.sheetName) || data.timestamp;
      
      paymentRow[CONFIG.paymentCols.date] = paymentDate;
      paymentRow[CONFIG.paymentCols.supplier] = data.supplier;
      paymentRow[CONFIG.paymentCols.invoiceNo] = targetInvoice;
      paymentRow[CONFIG.paymentCols.paymentType] = data.paymentType;
      paymentRow[CONFIG.paymentCols.amount] = data.paymentAmt;
      paymentRow[CONFIG.paymentCols.method] = this.getPaymentMethod(data.paymentType);
      paymentRow[CONFIG.paymentCols.reference] = data.notes || '';
      paymentRow[CONFIG.paymentCols.fromSheet] = data.sheetName;
      paymentRow[CONFIG.paymentCols.enteredBy] = data.enteredBy;
      paymentRow[CONFIG.paymentCols.timestamp] = data.timestamp;
      paymentRow[CONFIG.paymentCols.sysId] = IDGenerator.generatePaymentId(data.sysId);
      
      paymentSh.appendRow(paymentRow);
      
      AuditLogger.log('PAYMENT_LOGGED', data, 
        `Payment of ${data.paymentAmt} logged for invoice ${targetInvoice} on ${DateUtils.formatDate(paymentDate)}`);
      
      return { 
        success: true, 
        action: 'logged', 
        paymentId: IDGenerator.generatePaymentId(data.sysId)
      };
      
    } catch (error) {
      AuditLogger.logError('PaymentManager.process', 
        `Failed to process payment: ${error.toString()}`);
      return { 
        success: false, 
        error: error.toString() 
      };
    }
  },

  /**
   * OPTIMIZED: PaymentManager.processOptimized()
   * Accepts pre-calculated invoiceId and balance
   */
  processOptimized: function(data, invoiceId) {
    // Early validation
    if (!data.paymentAmt || data.paymentAmt <= 0) {
      return { 
        success: false, 
        error: 'Invalid payment amount' 
      };
    }
    const lock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
    if (!lock) {
      return { success: false, error: 'Unable to acquire payment lock' };
    }

    try {
      const paymentSh = getSheet(CONFIG.paymentSheet);
      const lastRow = paymentSh.getLastRow();
      const newRow = lastRow + 1;

      const paymentId = IDGenerator.generatePaymentId(data.sysId);
      const targetInvoice = data.paymentType === "Due" ? data.prevInvoice : data.invoiceNo;
      const paymentMethod = this.getPaymentMethod(data.paymentType);

      // Build payment row
      const paymentRow = [
        data.paymentDate || data.invoiceDate,
        data.supplier,
        targetInvoice,
        data.paymentType,
        data.paymentAmt,
        paymentMethod,
        data.notes || '',
        data.sheetName,
        data.enteredBy,
        data.timestamp,
        paymentId,
        invoiceId || ''
      ];

      // Single write operation
      paymentSh.getRange(newRow, 1, 1, CONFIG.totalColumns.payment).setValues([paymentRow]);

      // Check if invoice is fully paid
      const invoiceBalance = BalanceCalculator.getInvoiceOutstanding(targetInvoice, data.supplier);
      const fullyPaid = (invoiceBalance === 0);

      AuditLogger.log('PAYMENT_CREATED', data, 
        `Payment ${paymentId} created | Amount: ${data.paymentAmt} | Invoice: ${targetInvoice}`);

      return { 
        success: true, 
        paymentId: paymentId, 
        row: newRow,
        fullyPaid: fullyPaid
      };

    } catch (error) {
      AuditLogger.logError('PaymentManager.processOptimized', error.toString());
      return { success: false, error: error.toString() };
    } finally {
      LockManager.releaseLock(lock);
    }
  },
  
  /**
   * Check if payment should be processed based on payment type
   * 
   * @param {Object} data - Transaction data
   * @returns {boolean} True if payment should be processed
   */
  shouldProcess: function(data) {
    return data.paymentAmt > 0 || data.paymentType === 'Regular';
  },
  
  /**
   * Check for duplicate payment
   * 
   * @param {string} sysId - System ID to check
   * @returns {boolean} True if duplicate exists
   */
  isDuplicate: function(sysId) {
    if (!sysId) return false;
    
    try {
      const paymentSh = SheetUtils.getSheet(CONFIG.paymentSheet);
      const lastRow = paymentSh.getLastRow();
      
      if (lastRow < 2) return false;
      
      const searchId = IDGenerator.generatePaymentId(sysId);
      const data = paymentSh.getRange(2, CONFIG.paymentCols.sysId + 1, lastRow - 1, 1).getValues();
      
      return data.some(row => row[0] === searchId);
      
    } catch (error) {
      AuditLogger.logError('PaymentManager.isDuplicate', 
        `Failed to check duplicate: ${error.toString()}`);
      return false; // Don't block on error
    }
  },
  
  /**
   * Get payment method based on payment type
   * 
   * @param {string} paymentType - Payment type
   * @returns {string} Payment method
   */
  getPaymentMethod: function(paymentType) {
    return CONFIG.getDefaultPaymentMethod(paymentType);
  },
  
  /**
   * Get payment history for invoice
   * 
   * @param {string} invoiceNo - Invoice number
   * @returns {Array} Array of payment records
   */
  getHistoryForInvoice: function(invoiceNo) {
    if (StringUtils.isEmpty(invoiceNo)) {
      return [];
    }
    
    try {
      const paymentSh = SheetUtils.getSheet(CONFIG.paymentSheet);
      const lastRow = paymentSh.getLastRow();
      
      if (lastRow < 2) {
        return [];
      }
      
      const data = paymentSh.getRange(2, 1, lastRow - 1, CONFIG.totalColumns.payment).getValues();
      const normalizedInvoice = StringUtils.normalize(invoiceNo);
      
      return data
        .filter(row => StringUtils.equals(row[CONFIG.paymentCols.invoiceNo], normalizedInvoice))
        .map(row => ({
          date: row[CONFIG.paymentCols.date],
          supplier: row[CONFIG.paymentCols.supplier],
          amount: row[CONFIG.paymentCols.amount],
          type: row[CONFIG.paymentCols.paymentType],
          method: row[CONFIG.paymentCols.method],
          reference: row[CONFIG.paymentCols.reference],
          fromSheet: row[CONFIG.paymentCols.fromSheet],
          enteredBy: row[CONFIG.paymentCols.enteredBy],
          timestamp: row[CONFIG.paymentCols.timestamp]
        }));
        
    } catch (error) {
      AuditLogger.logError('PaymentManager.getHistoryForInvoice', 
        `Failed to get payment history for ${invoiceNo}: ${error.toString()}`);
      return [];
    }
  },
  
  /**
   * Get payment history for supplier
   * 
   * @param {string} supplier - Supplier name
   * @returns {Array} Array of payment records
   */
  getHistoryForSupplier: function(supplier) {
    if (StringUtils.isEmpty(supplier)) {
      return [];
    }
    
    try {
      const paymentSh = SheetUtils.getSheet(CONFIG.paymentSheet);
      const lastRow = paymentSh.getLastRow();
      
      if (lastRow < 2) {
        return [];
      }
      
      const data = paymentSh.getRange(2, 1, lastRow - 1, CONFIG.totalColumns.payment).getValues();
      const normalizedSupplier = StringUtils.normalize(supplier);
      
      return data
        .filter(row => StringUtils.equals(row[CONFIG.paymentCols.supplier], normalizedSupplier))
        .map(row => ({
          date: row[CONFIG.paymentCols.date],
          invoiceNo: row[CONFIG.paymentCols.invoiceNo],
          amount: row[CONFIG.paymentCols.amount],
          type: row[CONFIG.paymentCols.paymentType],
          method: row[CONFIG.paymentCols.method],
          reference: row[CONFIG.paymentCols.reference],
          fromSheet: row[CONFIG.paymentCols.fromSheet],
          enteredBy: row[CONFIG.paymentCols.enteredBy],
          timestamp: row[CONFIG.paymentCols.timestamp]
        }));
        
    } catch (error) {
      AuditLogger.logError('PaymentManager.getHistoryForSupplier', 
        `Failed to get payment history for ${supplier}: ${error.toString()}`);
      return [];
    }
  },
  
  /**
   * Get total payments for supplier
   * 
   * @param {string} supplier - Supplier name
   * @returns {number} Total payment amount
   */
  getTotalForSupplier: function(supplier) {
    if (StringUtils.isEmpty(supplier)) {
      return 0;
    }
    
    try {
      const paymentSh = SheetUtils.getSheet(CONFIG.paymentSheet);
      const lastRow = paymentSh.getLastRow();
      
      if (lastRow < 2) {
        return 0;
      }
      
      const data = paymentSh.getRange(2, 1, lastRow - 1, CONFIG.totalColumns.payment).getValues();
      const normalizedSupplier = StringUtils.normalize(supplier);
      
      return data
        .filter(row => StringUtils.equals(row[CONFIG.paymentCols.supplier], normalizedSupplier))
        .reduce((sum, row) => sum + (Number(row[CONFIG.paymentCols.amount]) || 0), 0);
        
    } catch (error) {
      AuditLogger.logError('PaymentManager.getTotalForSupplier', 
        `Failed to get total payments for ${supplier}: ${error.toString()}`);
      return 0;
    }
  },
  
  /**
   * Get payment statistics
   * 
   * @returns {Object} Statistics summary
   */
  getStatistics: function() {
    try {
      const paymentSh = SheetUtils.getSheet(CONFIG.paymentSheet);
      const lastRow = paymentSh.getLastRow();
      
      if (lastRow < 2) {
        return {
          total: 0,
          totalAmount: 0,
          byType: {},
          byMethod: {}
        };
      }
      
      const data = paymentSh.getRange(2, 1, lastRow - 1, CONFIG.totalColumns.payment).getValues();
      
      let totalAmount = 0;
      const byType = {};
      const byMethod = {};
      
      data.forEach(row => {
        const amount = Number(row[CONFIG.paymentCols.amount]) || 0;
        const type = row[CONFIG.paymentCols.paymentType];
        const method = row[CONFIG.paymentCols.method];
        
        totalAmount += amount;
        
        byType[type] = (byType[type] || 0) + amount;
        byMethod[method] = (byMethod[method] || 0) + amount;
      });
      
      return {
        total: data.length,
        totalAmount: totalAmount,
        byType: byType,
        byMethod: byMethod
      };
      
    } catch (error) {
      AuditLogger.logError('PaymentManager.getStatistics', 
        `Failed to get statistics: ${error.toString()}`);
      return null;
    }
  }
};

// Backward compatibility functions
function processPayment(data) {
  return PaymentManager.process(data);
}

function shouldProcessPayment(data) {
  return PaymentManager.shouldProcess(data);
}

function isDuplicatePayment(sysId) {
  return PaymentManager.isDuplicate(sysId);
}

function getPaymentMethod(paymentType) {
  return PaymentManager.getPaymentMethod(paymentType);
}