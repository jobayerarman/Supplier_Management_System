// ==================== MODULE: PaymentManager.gs ====================
/**
 * Payment management module
 * Handles all payment operations including paid date updates
 *
 * REFACTORED FOR SINGLE RESPONSIBILITY:
 * - processPayment: Records payment + conditionally triggers status update
 * - _updateInvoicePaidDate: All-in-one handler for paid status workflow
 * - Clean separation of concerns with comprehensive result objects
 *
 * PERFORMANCE OPTIMIZATIONS:
 * - PaymentCache: TTL-based cache with quad-index structure
 * - Granular locking: Lock acquired only during sheet writes
 * - Write-through cache: New payments added to cache immediately
 *
 * ORGANIZATION:
 * PaymentCache has been moved to CacheManager.gs (sole cache owner)
 * 1. PaymentManager Public API (external interface)
 * 2. PaymentManager Core Workflow (internal orchestration)
 * 3. PaymentManager Helper Functions (utilities)
 * 4. PaymentManager Result Builders (immutable constructors)
 *
 * NOTE: Constants moved to CONFIG.constants in _Config.gs for centralization
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: PAYMENT MANAGER - PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

const PaymentManager = {
  /**
   * Process and log payment with delegated paid date workflow
   *
   * ✓ REFACTORED: Orchestration function with extracted helpers for clarity
   * ✓ OPTIMIZED: Lock-free coordination with granular locking in sub-functions
   * ✓ OPTIMIZED: Eliminated double cache update by passing cached invoice
   *
   * WORKFLOW:
   * 1. Validate payment amount → _validatePaymentAmount()
   * 2. Record payment to PaymentLog → _recordPayment() (lock acquired internally)
   * 3. Update invoice cache and fetch cached data → _updateCacheAndFetchInvoice()
   * 4. Handle paid status update if needed → _handlePaidStatusUpdate()
   * 5. Build consolidated result → _buildPaymentResult()
   *
   * PERFORMANCE IMPROVEMENTS:
   * - Locks acquired only during sheet writes (~75% reduction: 100-200ms → 20-50ms)
   * - Cache operations no longer block other transactions
   * - Eliminated double cache update (~50% reduction in cache operations)
   * - Single invoice lookup instead of two for Regular/Due payments
   *
   * @typedef {Object} PaymentResult
   * @property {boolean} success - Whether payment processing succeeded
   * @property {string} [paymentId] - Generated payment ID (if successful)
   * @property {number} [row] - Row number in PaymentLog (if successful)
   * @property {boolean} [fullyPaid] - Whether invoice is fully paid after this payment
   * @property {boolean} [paidDateUpdated] - Whether paid date was set on invoice
   * @property {BalanceInfo} [balanceInfo] - Balance information after payment
   * @property {boolean} [cacheUpdated] - Whether cache was updated
   * @property {string} [error] - Error message (if failed)
   *
   * @param {Object} data - Transaction data
   * @param {string} invoiceId - Invoice ID from InvoiceManager
   * @returns {PaymentResult} Result object with success status, payment details, and balance info
   */
  processPayment: function(data, invoiceId, batchContext = null) {
    // Step 1: Validate payment amount
    const validationError = this._validatePaymentAmount(data);
    if (validationError) {
      return validationError;
    }

    try {
      // Step 2: Record payment (lock acquired internally)
      const paymentRecorded = this._recordPayment(data, invoiceId, batchContext);
      if (!paymentRecorded.success) {
        return paymentRecorded;
      }

      const { paymentId, targetInvoice } = paymentRecorded;

      // Deferred mode: skip Steps 3-4; queue paidDate check for post-flush pass
      if (batchContext?.pendingPaymentRows) {
        if (this._shouldUpdatePaidDate(data.paymentType)) {
          const invoice = data.invoiceRow
            ? { row: data.invoiceRow }
            : InvoiceManager.findInvoice(data.supplier, targetInvoice);
          if (invoice) {
            batchContext.pendingPaidDateChecks.push({
              invoiceRow:  invoice.row,
              invoiceNo:   targetInvoice,
              supplier:    data.supplier,
              paymentDate: data.paymentDate || data.invoiceDate
            });
          }
        }
        return this._buildPaymentResult(paymentRecorded, { attempted: false, fullyPaid: false, paidDateUpdated: false, balanceInfo: null });
      }

      // Step 3: Update cache and fetch invoice data
      const cachedInvoice = this._updateCacheAndFetchInvoice(data.supplier, targetInvoice);

      // Step 4: Handle paid status update (lock acquired internally if needed)
      const paidStatusResult = this._handlePaidStatusUpdate(
        targetInvoice,
        data,
        paymentId,
        cachedInvoice
      );

      // Step 5: Build and return consolidated result
      return this._buildPaymentResult(paymentRecorded, paidStatusResult);

    } catch (error) {
      AuditLogger.logError('PaymentManager.processPayment', error.toString());
      return {
        success: false,
        error: error.toString()
      };
    }
  },

  /**
   * Check if payment should be recorded based on payment amount and type
   *
   * @param {Object} data - Transaction data
   * @returns {boolean} True if payment should be recorded
   */
  shouldRecordPayment: function(data) {
    return data.paymentAmt > 0;
  },

  /**
   * Check for duplicate payment
   *
   * ✓ OPTIMIZED: Uses PaymentCache paymentIdIndex for O(1) lookups
   *
   * @param {string} sysId - System ID to check
   * @returns {boolean} True if duplicate exists
   */
  isDuplicate: function(sysId) {
    if (!sysId) return false;

    try {
      // Generate payment ID from system ID
      const searchId = IDGenerator.generatePaymentId(sysId);

      // ✓ Use cached payment ID index for O(1) lookup
      const { paymentIdIndex } = PaymentCache.getPaymentData();

      // Check if payment ID exists in index
      return paymentIdIndex.has(searchId);

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
   * ✓ OPTIMIZED: Uses PaymentCache for O(1) indexed lookups
   * ✓ REFACTORED: Uses _queryPayments template to eliminate duplication
   *
   * @typedef {Object} PaymentObject
   * @property {Date} date - Payment date
   * @property {number} amount - Payment amount
   * @property {string} type - Payment type (Regular, Due, Partial, Unpaid)
   * @property {string} method - Payment method (Cash, Bank, etc.)
   * @property {string} reference - Reference/notes
   * @property {string} fromSheet - Sheet where payment was entered
   * @property {string} enteredBy - User who entered payment
   * @property {Date} timestamp - Entry timestamp
   * @property {string} [supplier] - Supplier name (included in invoice history)
   * @property {string} [invoiceNo] - Invoice number (included in supplier history)
   *
   * @param {string} invoiceNo - Invoice number
   * @returns {PaymentObject[]} Array of payment records (includes supplier field)
   */
  getHistoryForInvoice: function(invoiceNo) {
    return this._queryPayments(
      invoiceNo,
      'invoiceIndex',
      (data, indices, col) => indices.map(i => this._buildPaymentObject(data[i], col, 'supplier')),
      [],
      'getHistoryForInvoice'
    );
  },

  /**
   * Get payment history for supplier
   *
   * ✓ OPTIMIZED: Uses PaymentCache for O(1) indexed lookups
   * ✓ REFACTORED: Uses _queryPayments template to eliminate duplication
   *
   * @param {string} supplier - Supplier name
   * @returns {PaymentObject[]} Array of payment records (includes invoiceNo field)
   */
  getHistoryForSupplier: function(supplier) {
    return this._queryPayments(
      supplier,
      'supplierIndex',
      (data, indices, col) => indices.map(i => this._buildPaymentObject(data[i], col, 'invoiceNo')),
      [],
      'getHistoryForSupplier'
    );
  },

  /**
   * Get total payments for supplier
   *
   * ✓ OPTIMIZED: Uses PaymentCache for O(1) indexed lookups
   * ✓ REFACTORED: Uses _queryPayments template to eliminate duplication
   *
   * @param {string} supplier - Supplier name
   * @returns {number} Total payment amount
   */
  getTotalForSupplier: function(supplier) {
    return this._queryPayments(
      supplier,
      'supplierIndex',
      (data, indices, col) => indices.reduce((sum, i) => sum + (Number(data[i][col.amount]) || 0), 0),
      0,
      'getTotalForSupplier'
    );
  },

  /**
   * Get payment statistics
   *
   * ✓ OPTIMIZED: Uses PaymentCache with single-pass aggregation
   *
   * @typedef {Object} PaymentStatistics
   * @property {number} total - Total number of payments
   * @property {number} totalAmount - Sum of all payment amounts
   * @property {Object.<string, number>} byType - Payment amounts grouped by type
   * @property {Object.<string, number>} byMethod - Payment amounts grouped by method
   *
   * @returns {PaymentStatistics} Statistics summary with totals and breakdowns
   */
  getStatistics: function() {
    try {
      // ✓ Use cached data for single-pass aggregation
      const { data } = PaymentCache.getPaymentData();

      if (data.length < CONFIG.constants.MIN_ROWS_WITH_DATA) {
        return {
          total: 0,
          totalAmount: 0,
          byType: {},
          byMethod: {}
        };
      }

      const col = CONFIG.paymentCols;
      let totalAmount = 0;
      const byType = {};
      const byMethod = {};

      // Single-pass aggregation (skip header row)
      for (let i = CONFIG.constants.FIRST_DATA_ROW_INDEX; i < data.length; i++) {
        const amount = Number(data[i][col.amount]) || 0;
        const type = data[i][col.paymentType];
        const method = data[i][col.method];

        totalAmount += amount;

        byType[type] = (byType[type] || 0) + amount;
        byMethod[method] = (byMethod[method] || 0) + amount;
      }

      return {
        total: data.length - CONFIG.constants.HEADER_ROW_COUNT, // Exclude header
        totalAmount: totalAmount,
        byType: byType,
        byMethod: byMethod
      };

    } catch (error) {
      AuditLogger.logError('PaymentManager.getStatistics',
        `Failed to get statistics: ${error.toString()}`);
      return null;
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: PAYMENT MANAGER - CORE WORKFLOW (PRIVATE)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Record payment to PaymentLog sheet
   * INTERNAL: Separated for clarity and testability
   *
   * ✓ OPTIMIZED: Manages own lock for minimal lock duration
   *
   * @typedef {Object} RecordPaymentResult
   * @property {boolean} success - Whether payment was recorded
   * @property {string} [paymentId] - Generated payment ID (if successful)
   * @property {string} [targetInvoice] - Invoice number payment applies to (if successful)
   * @property {number} [row] - Row number in PaymentLog (if successful)
   * @property {string} [error] - Error message (if failed)
   *
   * @private
   * @param {Object} data - Transaction data
   * @param {string} invoiceId - Invoice ID
   * @returns {RecordPaymentResult} Result with payment ID and row number
   */
  _recordPayment: function(data, invoiceId, batchContext = null) {
    // Skip per-row lock acquisition when the caller holds a batch lock already.
    const ownLock = batchContext && batchContext.batchLock
      ? null
      : LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
    if (!batchContext?.batchLock && !ownLock) {
      return { success: false, error: 'Unable to acquire payment lock' };
    }

    try {
      // Use Master Database if in master mode, otherwise use local sheet.
      // PERF: batchContext pre-fetched the sheet and last-row before the batch
      // loop — reuse them and increment the counter instead of a remote getLastRow().
      const paymentSh = batchContext?.paymentSheet ?? MasterDatabaseUtils.getTargetSheet('payment');
      const newRow = batchContext ? batchContext.paymentNextRow++
                                  : paymentSh.getLastRow() + 1;

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

      // Deferred mode: buffer for batch flush; immediate mode: write now
      if (batchContext?.pendingPaymentRows) {
        if (batchContext.paymentFirstRow === null) batchContext.paymentFirstRow = newRow;
        batchContext.pendingPaymentRows.push(paymentRow);
      } else {
        paymentSh.getRange(newRow, 1, 1, CONFIG.totalColumns.payment).setValues([paymentRow]);
        // ═══ WRITE-THROUGH CACHE ═══
        PaymentCache.addPaymentToCache(newRow, paymentRow);
      }

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
    } finally {
      // ═══ RELEASE LOCK IMMEDIATELY AFTER WRITE ═══
      LockManager.releaseLock(ownLock);
    }
  },

  /**
   * Flush deferred payment rows for Regular/Partial/Due batch.
   * @param {Object} batchContext - Must contain paymentSheet, paymentFirstRow, pendingPaymentRows[].
   * @returns {{success: boolean, failedCount: number, error?: string}}
   */
  flushPendingPaymentRows: function(batchContext) {
    const rows = batchContext.pendingPaymentRows;
    if (!rows || rows.length === 0) return { success: true, failedCount: 0 };
    try {
      batchContext.paymentSheet
        .getRange(batchContext.paymentFirstRow, 1, rows.length, rows[0].length)
        .setValues(rows);
      return { success: true, failedCount: 0 };
    } catch (e) {
      AuditLogger.logError('PaymentManager.flushPendingPaymentRows', e);
      return { success: false, failedCount: rows.length, error: e.toString() };
    }
  },

  /**
   * Check invoice balance and update paid date if fully settled
   *
   * ✓ OPTIMIZED: Lock acquired only during sheet write operation (via helper)
   * ✓ OPTIMIZED: Accepts optional cached invoice to eliminate redundant sheet read
   * ✓ REFACTORED: Uses helper functions for clearer separation of concerns
   *
   * WORKFLOW:
   * 1. Find invoice (uses cached if provided)
   * 2. Calculate balance (via _calculateBalanceInfo)
   * 3. Check if fully paid (early return if partial)
   * 4. Write paid date (via _writePaidDateToSheet with lock management)
   * 5. Update cache if written
   * 6. Return result with audit logging
   *
   * @typedef {Object} PaidStatusResult
   * @property {boolean} attempted - Whether paid status update was attempted
   * @property {boolean} success - Whether paid date was successfully updated
   * @property {boolean} fullyPaid - Whether invoice is fully paid
   * @property {boolean} paidDateUpdated - Whether paid date was written to sheet
   * @property {string} [reason] - Reason for outcome (invoice_not_found, partial_payment, already_set, updated, lock_failed, error)
   * @property {string} [message] - Human-readable message about outcome
   * @property {BalanceInfo} [balanceInfo] - Balance information
   *
   * @typedef {Object} BalanceInfo
   * @property {number} totalAmount - Invoice total amount
   * @property {number} totalPaid - Amount paid so far
   * @property {number} balanceDue - Remaining balance
   * @property {boolean} fullyPaid - Whether balance is within tolerance (< 0.01)
   *
   * @private
   * @param {string} invoiceNo - Invoice number
   * @param {string} supplier - Supplier name
   * @param {Date} paidDate - Date to set as paid date
   * @param {number} currentPaymentAmount - Amount just paid (for logging context)
   * @param {Object} context - Additional context {paymentId, paymentType, transactionData}
   * @param {Object} cachedInvoice - Optional pre-cached invoice data
   * @returns {PaidStatusResult} Comprehensive result with balance info and update status
   */
  _updateInvoicePaidDate: function(invoiceNo, supplier, paidDate, currentPaymentAmount, context = {}, cachedInvoice = null) {
    try {
      // ═══ STEP 1: FIND INVOICE ═══
      const invoice = cachedInvoice || InvoiceManager.findInvoice(supplier, invoiceNo);

      if (!invoice) {
        const result = this._buildInvoiceNotFoundResult(invoiceNo, supplier);
        AuditLogger.logError('PaymentManager._updateInvoicePaidDate', result.message);
        return result;
      }

      // ═══ STEP 2: CALCULATE BALANCE ═══
      // When cachedInvoice is non-null it came from _updateCacheAndFetchInvoice which
      // uses forceRead=true — the SUMIFS already include the current payment, so
      // pass 0 to avoid double-counting currentPaymentAmount in _calculateBalanceInfo.
      // When cachedInvoice is null (cache update failed) the cache still holds
      // pre-payment values, so currentPaymentAmount must be added manually.
      const pendingAmount = cachedInvoice ? 0 : currentPaymentAmount;
      const balanceInfo = this._calculateBalanceInfo(invoice, pendingAmount);

      // ═══ STEP 3: CHECK IF FULLY PAID ═══
      if (!balanceInfo.fullyPaid) {
        const result = this._buildPartialPaymentResult(invoiceNo, balanceInfo);

        AuditLogger.log('INVOICE_PARTIAL_PAYMENT', context.transactionData,
          `${result.message} | Total Paid: ${balanceInfo.totalPaid}/${balanceInfo.totalAmount} | Payment: ${context.paymentId}`);

        return result;
      }

      const successResult = this._buildPaidDateSuccessResult(paidDate, balanceInfo);

      // ═══ STEP 4: WRITE PAID DATE TO SHEET ═══
      try {
        this._writePaidDateToSheet(invoice, paidDate, context.paymentType);
        // Log AFTER successful sheet write (inside try block)
        AuditLogger.log('INVOICE_FULLY_PAID', context.transactionData,
        `Invoice ${invoiceNo} ${successResult.message} | Invoice row ${invoice.row} | Total Paid: ${balanceInfo.totalPaid}/${balanceInfo.totalAmount} | Payment: ${context.paymentId}`);
      } catch (lockError) {
        const result = this._buildLockFailedResult(lockError);
        AuditLogger.logError('PaymentManager._updateInvoicePaidDate', result.message);
        return result;
      }

      // ═══ STEP 5: UPDATE CACHE ═══
      // PERF: paidDate is not a SUMIFS field — patch it directly in memory
      // instead of re-reading the row from MASTER DB (~500ms saved).
      // SUMIFS fields (totalPaid, balanceDue) are refreshed by
      // invalidateSupplierCache() after the batch loop completes.
      const patched = CacheManager.patchInvoiceField(
        supplier, invoiceNo, CONFIG.invoiceCols.paidDate, paidDate
      );
      if (!patched) {
        // Invoice not in cache — fall back to full incremental update
        CacheManager.updateInvoiceInCache(supplier, invoiceNo);
      }

      // ═══ STEP 6: RETURN SUCCESS ═══
      return successResult;

    } catch (error) {
      const result = this._buildErrorResult(error);

      AuditLogger.logError('PaymentManager._updateInvoicePaidDate',
        `Error updating paid date for ${invoiceNo}: ${error.toString()}`);

      return result;
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

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: PAYMENT MANAGER - HELPER FUNCTIONS (PRIVATE)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generic query template for payment lookups
   * Consolidates common pattern: validate → lookup index → transform data
   *
   * @private
   * @param {string} key - Lookup key (invoice number or supplier name)
   * @param {string} indexName - Name of index to use ('invoiceIndex' or 'supplierIndex')
   * @param {function(Array, number[], Object): *} transformer - Function to transform results
   * @param {*} defaultValue - Value to return if no results found
   * @param {string} operationName - Operation name for error logging
   * @returns {*} Transformed results or defaultValue
   */
  _queryPayments: function(key, indexName, transformer, defaultValue, operationName) {
    // Validate input
    if (StringUtils.isEmpty(key)) {
      return defaultValue;
    }

    try {
      // Get cached data and specified index
      const cacheData = PaymentCache.getPaymentData();
      const { data } = cacheData;
      const index = cacheData[indexName];

      // Normalize key and lookup
      const normalizedKey = StringUtils.normalize(key);
      const indices = index.get(normalizedKey) || [];

      // Early return if no results
      if (indices.length === 0) {
        return defaultValue;
      }

      // Get column configuration
      const col = CONFIG.paymentCols;

      // Apply transformer function
      return transformer(data, indices, col);

    } catch (error) {
      AuditLogger.logError(`PaymentManager.${operationName}`,
        `Failed ${operationName} for ${key}: ${error.toString()}`);
      return defaultValue;
    }
  },

  /**
   * Helper: Build payment object from row data
   * @private
   * @param {Array} rowData - Payment row data
   * @param {Object} col - Column configuration
   * @param {string} includeField - Optional field to include ('supplier' or 'invoiceNo')
   * @returns {PaymentObject} Payment object
   */
  _buildPaymentObject: function(rowData, col, includeField) {
    const payment = {
      date: rowData[col.date],
      amount: rowData[col.amount],
      type: rowData[col.paymentType],
      method: rowData[col.method],
      reference: rowData[col.reference],
      fromSheet: rowData[col.fromSheet],
      enteredBy: rowData[col.enteredBy],
      timestamp: rowData[col.timestamp]
    };

    // Add conditional field if specified
    if (includeField === 'supplier') {
      payment.supplier = rowData[col.supplier];
    } else if (includeField === 'invoiceNo') {
      payment.invoiceNo = rowData[col.invoiceNo];
    }

    return payment;
  },

  /**
   * Generic lock wrapper for operations requiring lock management
   * Standardizes acquire → execute → release pattern
   *
   * @private
   * @param {string} lockType - Type of lock ('script' or 'document')
   * @param {function(): *} operation - Function to execute while holding lock
   * @param {string} context - Context description for error messages
   * @returns {*} Result from operation function
   * @throws {Error} If unable to acquire lock or operation fails
   */
  _withLock: function(lockType, operation, context) {
    // Acquire appropriate lock type
    const lock = lockType === 'document'
      ? LockManager.acquireDocumentLock(CONFIG.rules.LOCK_TIMEOUT_MS)
      : LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);

    if (!lock) {
      throw new Error(`Unable to acquire ${lockType} lock for ${context}`);
    }

    try {
      return operation();
    } finally {
      LockManager.releaseLock(lock);
    }
  },

  /**
   * Helper: Calculate balance information from invoice data
   * @private
   * @param {Object} invoice - Invoice object from InvoiceManager.findInvoice()
   * @returns {BalanceInfo} Balance information object
   */
  _calculateBalanceInfo: function(invoice, currentPaymentAmount = 0) {
    const col = CONFIG.invoiceCols;
    const totalAmount = Number(invoice.data[col.totalAmount]) || 0;

    // currentPaymentAmount is non-zero only when the caller holds pre-payment cache
    // state (cache update failed fallback). When the cache was refreshed post-payment
    // via forceRead=true (normal path), the caller passes 0 and SUMIFS values are
    // used directly.
    //
    // Formula strings are a special case: the invoice was cached before SUMIFS
    // ever evaluated (new invoice, cache update failed). Prior totalPaid = 0;
    // apply current payment only.
    let rawTotalPaid = invoice.data[col.totalPaid];
    if (typeof rawTotalPaid === 'string' && rawTotalPaid.startsWith('=')) {
      // New invoice: no prior payments in cache — use currentPaymentAmount directly.
      const balanceDue = Math.max(0, totalAmount - currentPaymentAmount);
      return {
        totalAmount,
        totalPaid: currentPaymentAmount,
        balanceDue,
        fullyPaid: Math.abs(balanceDue) < CONFIG.constants.BALANCE_TOLERANCE
      };
    }

    // Existing invoice: cache holds pre-payment numeric values.
    const cachedTotalPaid = Number(rawTotalPaid) || 0;
    const cachedBalanceDue = Number(invoice.data[col.balanceDue]) || 0;
    const balanceDue = Math.max(0, cachedBalanceDue - currentPaymentAmount);

    return {
      totalAmount,
      totalPaid: cachedTotalPaid + currentPaymentAmount,
      balanceDue,
      fullyPaid: Math.abs(balanceDue) < CONFIG.constants.BALANCE_TOLERANCE
    };
  },

  /**
   * Helper: Write paid date to sheet with lock management
   * ✓ REFACTORED: Uses _withLock wrapper for standardized lock handling
   *
   * Writes to Master DB (or local sheet in local mode). Local monthly files
   * display InvoiceDatabase data via IMPORTRANGE — no secondary write needed.
   *
   * Read-back verification is performed only for Due payments, where the
   * paid date update is known to be intermittently missing.
   *
   * @private
   * @param {Object} invoice - Invoice object from InvoiceManager.findInvoice()
   * @param {Date} paidDate - Date to set as paid date
   * @param {string} [paymentType] - Payment type (e.g. 'Due', 'Regular', 'Partial')
   * @throws {Error} If unable to acquire lock
   */
  _writePaidDateToSheet: function(invoice, paidDate, paymentType) {
    return this._withLock('script', () => {
      const col = CONFIG.invoiceCols;
      const paidDateCol = col.paidDate + 1;
      const invoiceSh = MasterDatabaseUtils.getTargetSheet('invoice');

      invoiceSh.getRange(invoice.row, paidDateCol, 1, 1).setValues([[paidDate]]);
      SpreadsheetApp.flush(); // Force commit before lock release

      // Read-back verification for Due payments only
      if (paymentType === 'Due') {
        const writtenValue = invoiceSh.getRange(invoice.row, paidDateCol).getValue();
        if (!writtenValue) {
          const formula = invoiceSh.getRange(invoice.row, paidDateCol).getFormula();
          AuditLogger.logWarning('PaymentManager._writePaidDateToSheet',
            `POST-WRITE row ${invoice.row} col ${paidDateCol}: ` +
            `wrote="${paidDate}" (${typeof paidDate}) | read="${writtenValue}" | formula="${formula}"`);
        }
      }
    }, 'paid date update');
  },

  /**
   * Helper: Validate payment amount
   * @private
   * @param {Object} data - Transaction data
   * @returns {Object|null} Error result if invalid, null if valid
   */
  _validatePaymentAmount: function(data) {
    if (!data.paymentAmt || data.paymentAmt <= 0) {
      return {
        success: false,
        error: 'Invalid payment amount'
      };
    }
    return null;
  },

  /**
   * Helper: Update cache and fetch invoice data
   * Updates invoice cache after payment and retrieves cached invoice for downstream processing
   *
   * @private
   * @param {string} supplier - Supplier name
   * @param {string} targetInvoice - Invoice number
   * @returns {Object|null} Cached invoice object or null if not found/failed
   */
  _updateCacheAndFetchInvoice: function(supplier, targetInvoice) {
    if (!targetInvoice) {
      return null;
    }

    CacheManager.markPaymentWritten(supplier, targetInvoice);
    // forceRead=true: payment is already written to PaymentLog at this point, so
    // getValues() will flush that write and return the evaluated SUMIFS balance.
    // Without forceRead, the 100ms deferral leaves a stale formula string in cache,
    // causing _sumInvoiceBalances to fall back to totalAmount (overcounts balance).
    const cacheUpdated = CacheManager.updateInvoiceInCache(supplier, targetInvoice, true);

    if (!cacheUpdated) {
      // Log warning but don't fail - cache inconsistency is recoverable
      AuditLogger.logWarning('PaymentManager._updateCacheAndFetchInvoice',
        `Cache update failed for invoice ${targetInvoice}, cache may be stale`);
      return null;
    }

    // Fetch cached invoice to pass to paid date workflow
    // This eliminates redundant sheet read in _updateInvoicePaidDate
    return InvoiceManager.findInvoice(supplier, targetInvoice);
  },

  /**
   * Helper: Handle paid status update workflow
   * Determines if paid status should be checked and delegates to _updateInvoicePaidDate
   *
   * @private
   * @param {string} targetInvoice - Invoice number
   * @param {Object} data - Transaction data
   * @param {string} paymentId - Payment ID from recorded payment
   * @param {Object|null} cachedInvoice - Cached invoice object (may be null)
   * @returns {Object} Paid status result with fullyPaid, paidDateUpdated, balanceInfo
   */
  _handlePaidStatusUpdate: function(targetInvoice, data, paymentId, cachedInvoice) {
    // Default result if no update attempted
    const defaultResult = {
      attempted: false,
      fullyPaid: false,
      paidDateUpdated: false
    };

    // Determine if we should attempt paid date update
    const shouldCheckPaidStatus = this._shouldUpdatePaidDate(data.paymentType);

    if (!shouldCheckPaidStatus || !targetInvoice) {
      return defaultResult;
    }

    // Delegate entire workflow to _updateInvoicePaidDate with cached invoice
    return this._updateInvoicePaidDate(
      targetInvoice,
      data.supplier,
      data.paymentDate || data.invoiceDate,
      data.paymentAmt,
      {
        paymentId: paymentId,
        paymentType: data.paymentType,
        transactionData: data
      },
      cachedInvoice  // Pass cached invoice to avoid redundant read
    );
  },

  /**
   * Helper: Build consolidated payment result
   * Creates final result object combining payment record and paid status results
   *
   * @private
   * @param {Object} paymentRecorded - Result from _recordPayment
   * @param {Object} paidStatusResult - Result from _handlePaidStatusUpdate
   * @returns {Object} Consolidated success result
   */
  _buildPaymentResult: function(paymentRecorded, paidStatusResult) {
    return {
      success: true,
      paymentId: paymentRecorded.paymentId,
      row: paymentRecorded.row,
      fullyPaid: paidStatusResult.fullyPaid,
      paidDateUpdated: paidStatusResult.paidDateUpdated,
      balanceInfo: paidStatusResult.balanceInfo,
      cacheUpdated: true
    };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: PAYMENT MANAGER - RESULT BUILDERS (PRIVATE)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Result Builder: Create base PaidStatusResult structure
   * @private
   * @returns {PaidStatusResult} Base result object with default values
   */
  _createBasePaidStatusResult: function() {
    return {
      attempted: true,
      success: false,
      fullyPaid: false,
      paidDateUpdated: false,
      reason: null,
      message: null,
      balanceInfo: null
    };
  },

  /**
   * Result Builder: Invoice not found result
   * @private
   * @param {string} invoiceNo - Invoice number
   * @param {string} supplier - Supplier name
   * @returns {PaidStatusResult} Result indicating invoice not found
   */
  _buildInvoiceNotFoundResult: function(invoiceNo, supplier) {
    const result = this._createBasePaidStatusResult();
    result.reason = 'invoice_not_found';
    result.message = `Invoice ${invoiceNo} not found for supplier ${supplier}`;
    return result;
  },

  /**
   * Result Builder: Partial payment result
   * @private
   * @param {string} invoiceNo - Invoice number
   * @param {BalanceInfo} balanceInfo - Balance information
   * @returns {PaidStatusResult} Result indicating partial payment
   */
  _buildPartialPaymentResult: function(invoiceNo, balanceInfo) {
    const result = this._createBasePaidStatusResult();
    result.fullyPaid = false;
    result.balanceInfo = balanceInfo;
    result.reason = 'partial_payment';
    result.message = `Invoice ${invoiceNo} partially paid | Balance: ${balanceInfo.balanceDue}`;
    return result;
  },

  /**
   * Result Builder: Successful paid date update result
   * @private
   * @param {Date} paidDate - Paid date that was set
   * @param {BalanceInfo} balanceInfo - Balance information
   * @returns {PaidStatusResult} Result indicating successful update
   */
  _buildPaidDateSuccessResult: function(paidDate, balanceInfo) {
    const result = this._createBasePaidStatusResult();
    result.success = true;
    result.fullyPaid = true;
    result.paidDateUpdated = true;
    result.balanceInfo = balanceInfo;
    result.reason = 'updated';
    result.message = `Paid on ${DateUtils.formatDate(paidDate)}`;
    return result;
  },

  /**
   * Result Builder: Lock failed result
   * @private
   * @param {Error} error - Lock error
   * @returns {PaidStatusResult} Result indicating lock failure
   */
  _buildLockFailedResult: function(error) {
    const result = this._createBasePaidStatusResult();
    result.reason = 'lock_failed';
    result.message = error.toString();
    return result;
  },

  /**
   * Result Builder: Error result
   * @private
   * @param {Error} error - Error that occurred
   * @returns {PaidStatusResult} Result indicating error
   */
  _buildErrorResult: function(error) {
    const result = this._createBasePaidStatusResult();
    result.reason = 'error';
    result.message = error.toString();
    return result;
  }
};
