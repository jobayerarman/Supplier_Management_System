// ==================== MODULE: PaymentManager.gs ====================
/**
 * Payment management module
 * Handles all payment operations including paid date updates
 * 
 * REFACTORED FOR SINGLE RESPONSIBILITY:
 * - processOptimized: Records payment + conditionally triggers status update
 * - _updateInvoicePaidDate: All-in-one handler for paid status workflow
 * - Clean separation of concerns with comprehensive result objects
 */

const PaymentManager = {
  /**
   * Process and log payment with delegated paid date workflow
   * 
   * SIMPLIFIED RESPONSIBILITIES:
   * 1. Validate payment amount
   * 2. Write payment record to PaymentLog
   * 3. Determine if paid status check is needed
   * 4. Delegate to _updateInvoicePaidDate if needed
   * 5. Return consolidated result
   * 
   * @param {Object} data - Transaction data
   * @param {string} invoiceId - Invoice ID from InvoiceManager
   * @returns {Object} {success, paymentId, fullyPaid, paidDateUpdated, error}
   */
  processOptimized: function(data, invoiceId) {
    // ═══ VALIDATION ═══
    if (!data.paymentAmt || data.paymentAmt <= 0) {
      return { 
        success: false, 
        error: 'Invalid payment amount' 
      };
    }

    // ═══ ACQUIRE LOCK ═══
    const lock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
    if (!lock) {
      return { success: false, error: 'Unable to acquire payment lock' };
    }

    try {
      // ═══ STEP 1: RECORD PAYMENT ═══
      const paymentRecorded = this._recordPayment(data, invoiceId);

      if (!paymentRecorded.success) {
        return paymentRecorded;
      }

      const { paymentId, targetInvoice } = paymentRecorded;

      // ═══ STEP 2: UPDATE INVOICE CACHE ═══
      // ✓ NEW: Refresh cached invoice data after payment
      if (targetInvoice) {
        const cacheUpdated = InvoiceCache.updateInvoiceInCache(
          data.supplier,
          targetInvoice
        );

        if (!cacheUpdated) {
          // Log warning but don't fail - cache inconsistency is recoverable
          AuditLogger.logWarning('PaymentManager.processOptimized',
            `Cache update failed for invoice ${targetInvoice}, cache may be stale`);
        }
      }

      // ═══ STEP 3: UPDATE PAID STATUS (If Applicable) ═══
      let paidStatusResult = {
        attempted: false,
        fullyPaid: false,
        paidDateUpdated: false
      };

      // Determine if we should attempt paid date update
      const shouldCheckPaidStatus = this._shouldUpdatePaidDate(data.paymentType);

      if (shouldCheckPaidStatus && targetInvoice) {
        // Delegate entire workflow to _updateInvoicePaidDate
        paidStatusResult = this._updateInvoicePaidDate(
          targetInvoice,
          data.supplier,
          data.invoiceDate || data.timestamp,
          data.paymentAmt,
          {
            paymentId: paymentId,
            paymentType: data.paymentType,
            transactionData: data
          }
        );
      }

      // ═══ STEP 4: RETURN CONSOLIDATED RESULT ═══
      return {
        success: true,
        paymentId: paymentId,
        row: paymentRecorded.row,
        fullyPaid: paidStatusResult.fullyPaid,
        paidDateUpdated: paidStatusResult.paidDateUpdated,
        balanceInfo: paidStatusResult.balanceInfo,
        cacheUpdated: true
      };
    } catch (error) {
      AuditLogger.logError('PaymentManager.processOptimized', error.toString());
      return { 
        success: false, 
        error: error.toString() 
      };
    } finally {
      LockManager.releaseLock(lock);
    }
  },
  
  /**
   * Record payment to PaymentLog sheet
   * INTERNAL: Separated for clarity and testability
   * 
   * @private
   * @param {Object} data - Transaction data
   * @param {string} invoiceId - Invoice ID
   * @returns {Object} {success, paymentId, targetInvoice, row, error}
   */
  _recordPayment: function(data, invoiceId) {
    try {
      const paymentSh = getSheet(CONFIG.paymentSheet);
      const lastRow = paymentSh.getLastRow();
      const newRow = lastRow + 1;

      const paymentId = IDGenerator.generatePaymentId(data.sysId);
      const paymentMethod = this.getPaymentMethod(data.paymentType);

      // Determine which invoice this payment applies to
      const targetInvoice = data.paymentType === "Due" ? data.prevInvoice : data.invoiceNo;

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

      // Single write operation for payment
      paymentSh.getRange(newRow, 1, 1, CONFIG.totalColumns.payment).setValues([paymentRow]);

      // Log payment creation
      AuditLogger.log('PAYMENT_CREATED', data,
        `Payment ${paymentId} created | Amount: ${data.paymentAmt} | Invoice: ${targetInvoice} | Type: ${data.paymentType}`);

      return {
        success: true,
        paymentId: paymentId,
        targetInvoice: targetInvoice,
        row: newRow
      };
    } catch (error) {
      AuditLogger.logError('PaymentManager._recordPayment',
        `Failed to record payment: ${error.toString()}`);
      return {success: false, error: error.toString()};
    }
  },

  /**
   * ALL-IN-ONE HANDLER: Check invoice balance and update paid date if fully settled
   * 
   * COMPREHENSIVE WORKFLOW:
   * 1. Find invoice record
   * 2. Calculate balance from raw data (formula-independent)
   * 3. Determine if invoice is fully paid
   * 4. Update paid date if conditions met
   * 5. Log appropriate audit trail based on outcome
   * 6. Return comprehensive result object
   * 
   * @private
   * @param {string} invoiceNo - Invoice number
   * @param {string} supplier - Supplier name
   * @param {Date} paidDate - Date to set as paid date
   * @param {number} currentPaymentAmount - Amount just paid (for immediate context)
   * @param {Object} context - Additional context {paymentId, paymentType, transactionData}
   * @returns {Object} Comprehensive result with all workflow details
   */
  _updateInvoicePaidDate: function(invoiceNo, supplier, paidDate, currentPaymentAmount, context = {}) {
    const result = {
      attempted: true,
      success: false,
      fullyPaid: false,
      paidDateUpdated: false,
      reason: null,
      message: null,
      balanceInfo: null
    };

    try {
      // ═══ STEP 1: FIND INVOICE ═══
      const invoice = InvoiceManager.find(supplier, invoiceNo);

      if (!invoice) {
        result.reason = 'invoice_not_found';
        result.message = `Invoice ${invoiceNo} not found for supplier ${supplier}`;
        
        AuditLogger.logError('PaymentManager._updateInvoicePaidDate', result.message);
        return result;
      }

      // ═══ STEP 2: CALCULATE BALANCE FROM CACHED DATA ═══
      // Note: Cache should have been updated in Step 2 of processOptimized
      const col = CONFIG.invoiceCols;
      const totalAmount = Number(invoice.data[col.totalAmount]) || 0;
      const totalPaid = Number(invoice.data[col.totalPaid]) || 0;
      const balanceDue = Number(invoice.data[col.balanceDue]) || 0;

      result.balanceInfo = {
        totalAmount: totalAmount,
        totalPaid: totalPaid,
        balanceDue: balanceDue,
        fullyPaid: Math.abs(balanceDue) < 0.01
      };

      result.fullyPaid = result.balanceInfo.fullyPaid;

      // ═══ STEP 3: CHECK IF FULLY PAID ═══
      if (!result.balanceInfo.fullyPaid) {
        result.reason = 'partial_payment';
        result.message = `Invoice ${invoiceNo} partially paid | Balance: ${balanceDue}`;

        AuditLogger.log('INVOICE_PARTIAL_PAYMENT', context.transactionData,
          `${result.message} | Total Paid: ${totalPaid}/${totalAmount} | Payment: ${context.paymentId}`);

        return result;
      }

      // ═══ STEP 4: CHECK IF PAID DATE ALREADY SET ═══
      const currentPaidDate = invoice.data[col.paidDate];

      if (currentPaidDate) {
        result.reason = 'already_set';
        result.message = `Invoice ${invoiceNo} already marked as paid on ${currentPaidDate}`;
        
        AuditLogger.log('INVOICE_ALREADY_PAID', context.transactionData,
          `${result.message} | Payment: ${context.paymentId}`);
        
        return result;
      }

      // ═══ STEP 5: UPDATE PAID DATE IN SHEET ═══
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      invoiceSh.getRange(invoice.row, col.paidDate + 1).setValue(paidDate);

      result.success = true;
      result.paidDateUpdated = true;
      result.reason = 'updated';
      result.message = `Paid date set to ${DateUtils.formatDate(paidDate)}`;

      // ═══ STEP 6: UPDATE CACHE WITH NEW PAID DATE ═══
      // ✓ NEW: Refresh cache after updating paid date
      InvoiceCache.updateInvoiceInCache(supplier, invoiceNo);

      // ═══ STEP 7: LOG SUCCESS ═══
      // AuditLogger.log('INVOICE_FULLY_PAID', context.transactionData,
      //   `Invoice ${invoiceNo} fully paid and marked | Payment: ${context.paymentId} | ` +
      //   `Type: ${context.paymentType} | Total Paid: ${totalPaid} | ` +
      //   `Paid Date: ${DateUtils.formatDate(paidDate)}`);

      return result;

    } catch (error) {
      result.reason = 'error';
      result.message = error.toString();
      
      AuditLogger.logError('PaymentManager._updateInvoicePaidDate',
        `Error updating paid date for ${invoiceNo}: ${error.toString()}`);
      
      return result;
    }
  },

  /**
   * Calculate invoice balance from raw data (formula-independent)
   * INTERNAL: Encapsulates balance calculation logic
   * 
   * @private
   * @param {string} invoiceNo - Invoice number
   * @param {string} supplier - Supplier name
   * @param {Object} invoice - Invoice record from InvoiceManager.find()
   * @param {number} currentPaymentAmount - Amount being paid right now
   * @returns {Object|null} Balance information object
   */
  _calculateBalance: function(invoiceNo, supplier, invoice, currentPaymentAmount = 0) {
    try {
      // Get invoice total amount (column E)
      const totalAmount = Number(invoice.data[CONFIG.invoiceCols.totalAmount]) || 0;

      // Get all existing payments from PaymentLog
      const existingPayments = this.getHistoryForInvoice(invoiceNo);

      // Sum existing payments
      const existingTotalPaid = existingPayments.reduce((sum, payment) => {
        return sum + (Number(payment.amount) || 0);
      }, 0);

      // Add current payment (not yet in history)
      const totalPaid = existingTotalPaid + currentPaymentAmount;

      // Calculate balance
      const balanceDue = totalAmount - totalPaid;
      const fullyPaid = Math.abs(balanceDue) < 0.01; // 1 cent tolerance

      return {
        invoiceNo: invoiceNo,
        supplier: supplier,
        totalAmount: totalAmount,
        totalPaid: totalPaid,
        balanceDue: balanceDue,
        fullyPaid: fullyPaid,
        paymentCount: existingPayments.length + (currentPaymentAmount > 0 ? 1 : 0),
        calculationMethod: 'raw_data',
        timestamp: new Date()
      };

    } catch (error) {
      AuditLogger.logError('PaymentManager._calculateBalance',
        `Error calculating balance for ${invoiceNo}: ${error.toString()}`);
      return null;
    }
  },

  /**
   * Determine if paid date should be checked/updated based on payment type
   * 
   * BUSINESS RULES:
   * - Regular: Full immediate payment → check paid status
   * - Due: Payment on old invoice → check paid status
   * - Partial: Incomplete payment → skip (by definition not fully paid)
   * - Unpaid: No payment made → skip
   * 
   * @private
   * @param {string} paymentType - Payment type
   * @returns {boolean} True if paid date workflow should be attempted
   */
  _shouldUpdatePaidDate: function(paymentType) {
    switch (paymentType) {
      case "Regular":
      case "Due":
        return true;
      
      case "Partial":
      case "Unpaid":
        return false;
      
      default:
        return false;
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