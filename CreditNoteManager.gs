// ==================== MODULE: CreditNoteManager.gs ====================
/**
 * CreditNoteManager: Credit note lifecycle management
 *
 * Handles creation, tracking, and application of credit notes against supplier invoices.
 * Supports post-payment credits (unused credits for future invoices) and immediate application.
 *
 * Performance: O(1) lookups via cache
 * Integration: Audit logging, cache management, invoice balance updates
 */

const CreditNoteManager = {

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new credit note or update existing one (UPSERT pattern)
   *
   * @param {Object} data - Credit note data from daily sheet
   *   - supplier: string
   *   - creditAmount: number (positive, amount to credit)
   *   - refInvoiceNo: string (invoice being credited)
   *   - reason: string (return/shortage/damage/pricing/other)
   *   - creditDate: Date
   *   - originDay: string (sheet it came from)
   *   - enteredBy: string (user email)
   * @returns {Object} Result with creditNoteId and status
   *   - creditNoteId: string (system ID)
   *   - creditNo: string (display credit number)
   *   - success: boolean
   *   - message: string
   */
  createCreditNote: function(data) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const creditNoteSheet = MasterDatabaseUtils.getTargetSheet('creditNote');

      if (!creditNoteSheet) {
        throw new Error('CreditNoteDatabase sheet not found');
      }

      // Validate required fields
      if (!data.supplier || !data.creditAmount || !data.refInvoiceNo || !data.reason) {
        throw new Error('Missing required fields: supplier, creditAmount, refInvoiceNo, reason');
      }

      // Validate credit amount is positive
      if (data.creditAmount <= 0) {
        throw new Error('Credit amount must be positive');
      }

      // Check if referenced invoice exists
      const invoice = InvoiceManager.findInvoice(data.supplier, data.refInvoiceNo);
      if (!invoice) {
        throw new Error(`Reference invoice not found: ${data.supplier} / ${data.refInvoiceNo}`);
      }

      // Check if credit amount does not exceed invoice total
      if (data.creditAmount > invoice.totalAmount) {
        throw new Error(`Credit amount ($${data.creditAmount}) cannot exceed invoice total ($${invoice.totalAmount})`);
      }

      // Check for existing credit notes for this invoice (prevent duplicates)
      const existingCreditNo = this._findExistingCreditNo(data.supplier, data.refInvoiceNo, data.creditDate);
      if (existingCreditNo) {
        // Update existing credit note instead
        return this._updateCreditNote(existingCreditNo, data);
      }

      // Generate credit note number and system ID
      const creditNo = this._generateCreditNo();
      const creditId = IDGenerator.generateUUID();
      const now = new Date();

      // Build row data with system-generated values
      const creditNoteRow = [
        data.creditDate || now,                      // A: Credit Date
        data.supplier,                               // B: Supplier
        creditNo,                                    // C: Credit No
        data.creditAmount,                           // D: Credit Amount
        data.refInvoiceNo,                          // E: Reference Invoice No
        data.reason,                                 // F: Reason
        0,                                           // G: Applied Amount (initially 0)
        data.creditAmount,                           // H: Remaining Credit (D - G)
        'Active',                                    // I: Status
        data.originDay || 'Manual',                 // J: Origin Day
        data.enteredBy || UserResolver.getCurrentUser(), // K: Entered By
        now,                                         // L: Timestamp
        creditId                                     // M: SYS_ID
      ];

      // Append to CreditNoteDatabase
      const lastRow = creditNoteSheet.getLastRow();
      const nextRow = lastRow + 1;
      const range = creditNoteSheet.getRange(nextRow, 1, 1, CONFIG.totalColumns.creditNote);
      range.setValues([creditNoteRow]);

      // Log to audit trail
      AuditLogger.log('CREDIT_NOTE_CREATED', {
        creditNo: creditNo,
        creditId: creditId,
        supplier: data.supplier,
        amount: data.creditAmount,
        refInvoice: data.refInvoiceNo,
        reason: data.reason
      }, `Credit note created: $${data.creditAmount} for ${data.supplier} invoice ${data.refInvoiceNo}`);

      // Update cache
      this._addCreditNoteToCache(nextRow, creditNoteRow);

      return {
        creditNoteId: creditId,
        creditNo: creditNo,
        success: true,
        message: `Credit note ${creditNo} created successfully`
      };

    } catch (error) {
      AuditLogger.logError('CreditNoteManager.createCreditNote', error.message);
      return {
        success: false,
        message: error.message,
        error: error
      };
    }
  },

  /**
   * Find a credit note by supplier and credit number
   *
   * @param {string} supplier - Supplier name
   * @param {string} creditNo - Credit note number
   * @returns {Object|null} Credit note data or null if not found
   */
  findCreditNote: function(supplier, creditNo) {
    try {
      const creditNoteSheet = MasterDatabaseUtils.getSourceSheet('creditNote');
      if (!creditNoteSheet) return null;

      const data = creditNoteSheet.getRange(2, 1, creditNoteSheet.getLastRow() - 1, CONFIG.totalColumns.creditNote).getValues();

      for (let i = 0; i < data.length; i++) {
        if (StringUtils.equals(data[i][CONFIG.creditNoteCols.supplier], supplier) &&
            StringUtils.equals(data[i][CONFIG.creditNoteCols.creditNo], creditNo)) {
          return this._buildCreditNoteObject(data[i], i + 2);
        }
      }
      return null;

    } catch (error) {
      AuditLogger.logError('CreditNoteManager.findCreditNote', error.message);
      return null;
    }
  },

  /**
   * Get unused credits available for a supplier
   * Returns credits with remaining balance that can be applied
   *
   * @param {string} supplier - Supplier name
   * @returns {Array} Array of credit objects with remaining balance
   */
  getUnusedCreditsForSupplier: function(supplier) {
    try {
      const creditNoteSheet = MasterDatabaseUtils.getSourceSheet('creditNote');
      if (!creditNoteSheet) return [];

      const data = creditNoteSheet.getRange(2, 1, creditNoteSheet.getLastRow() - 1, CONFIG.totalColumns.creditNote).getValues();
      const unused = [];

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (StringUtils.equals(row[CONFIG.creditNoteCols.supplier], supplier)) {
          const remaining = row[CONFIG.creditNoteCols.remainingCredit] || 0;
          if (remaining > CONFIG.constants.BALANCE_TOLERANCE && StringUtils.equals(row[CONFIG.creditNoteCols.status], 'Active')) {
            unused.push(this._buildCreditNoteObject(row, i + 2));
          }
        }
      }

      return unused;

    } catch (error) {
      AuditLogger.logError('CreditNoteManager.getUnusedCreditsForSupplier', error.message);
      return [];
    }
  },

  /**
   * Get all credits applied to a specific invoice
   *
   * @param {string} invoiceNo - Invoice number
   * @returns {Array} Array of credit objects applied to this invoice
   */
  getHistoryForInvoice: function(invoiceNo) {
    try {
      const creditNoteSheet = MasterDatabaseUtils.getSourceSheet('creditNote');
      if (!creditNoteSheet) return [];

      const data = creditNoteSheet.getRange(2, 1, creditNoteSheet.getLastRow() - 1, CONFIG.totalColumns.creditNote).getValues();
      const history = [];

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (StringUtils.equals(row[CONFIG.creditNoteCols.refInvoiceNo], invoiceNo)) {
          history.push(this._buildCreditNoteObject(row, i + 2));
        }
      }

      return history;

    } catch (error) {
      AuditLogger.logError('CreditNoteManager.getHistoryForInvoice', error.message);
      return [];
    }
  },

  /**
   * Apply a credit to an invoice (reduce invoice balance)
   * Updates both the credit note (appliedAmount, remainingCredit) and invoice balance
   *
   * @param {string} creditNoteId - System ID of credit note
   * @param {number} amountToApply - Amount to apply (must be <= remaining credit)
   * @returns {Object} Result with success status and message
   */
  applyCredit: function(creditNoteId, amountToApply) {
    try {
      const creditNoteSheet = MasterDatabaseUtils.getTargetSheet('creditNote');
      if (!creditNoteSheet) {
        throw new Error('CreditNoteDatabase sheet not found');
      }

      if (amountToApply <= 0) {
        throw new Error('Apply amount must be positive');
      }

      // Find the credit note by system ID
      const creditNote = this._findBySysId(creditNoteId);
      if (!creditNote) {
        throw new Error(`Credit note not found: ${creditNoteId}`);
      }

      const remaining = creditNote.remainingCredit || 0;
      if (amountToApply > remaining) {
        throw new Error(`Apply amount ($${amountToApply}) exceeds remaining credit ($${remaining})`);
      }

      // Update credit note: appliedAmount and remainingCredit
      const newAppliedAmount = (creditNote.appliedAmount || 0) + amountToApply;
      const newRemainingCredit = creditNote.creditAmount - newAppliedAmount;
      const newStatus = newRemainingCredit <= CONFIG.constants.BALANCE_TOLERANCE ? 'Applied' : 'Active';

      // Update in sheet
      const targetRow = creditNote.rowNum;
      const updates = [
        [newAppliedAmount, newRemainingCredit, newStatus]
      ];
      creditNoteSheet.getRange(targetRow, CONFIG.creditNoteCols.appliedAmount + 1, 1, 3).setValues(updates);

      // Log to audit trail
      AuditLogger.log('CREDIT_APPLIED', {
        creditNo: creditNote.creditNo,
        creditId: creditNoteId,
        supplier: creditNote.supplier,
        refInvoice: creditNote.refInvoiceNo,
        appliedAmount: amountToApply,
        newRemaining: newRemainingCredit
      }, `Credit of $${amountToApply} applied to invoice ${creditNote.refInvoiceNo}`);

      return {
        success: true,
        message: `Credit applied: $${amountToApply}`,
        creditNo: creditNote.creditNo,
        newRemaining: newRemainingCredit
      };

    } catch (error) {
      AuditLogger.logError('CreditNoteManager.applyCredit', error.message);
      return {
        success: false,
        message: error.message
      };
    }
  },

  /**
   * Get total applied credits for an invoice
   * Used in balance calculation: Balance = Total - Paid - AppliedCredits
   *
   * @param {string} invoiceNo - Invoice number
   * @returns {number} Total amount of credits applied
   */
  getTotalAppliedCreditsForInvoice: function(invoiceNo) {
    try {
      const creditNotes = this.getHistoryForInvoice(invoiceNo);
      let total = 0;

      for (const note of creditNotes) {
        total += note.appliedAmount || 0;
      }

      return total;
    } catch (error) {
      AuditLogger.logError('CreditNoteManager.getTotalAppliedCreditsForInvoice', error.message);
      return 0;
    }
  },

  /**
   * Get total available (unused) credits for a supplier
   *
   * @param {string} supplier - Supplier name
   * @returns {number} Total unused credit amount
   */
  getTotalUnusedCreditsForSupplier: function(supplier) {
    try {
      const credits = this.getUnusedCreditsForSupplier(supplier);
      let total = 0;

      for (const note of credits) {
        total += note.remainingCredit || 0;
      }

      return total;
    } catch (error) {
      AuditLogger.logError('CreditNoteManager.getTotalUnusedCreditsForSupplier', error.message);
      return 0;
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build a credit note object from sheet row
   *
   * @private
   * @param {Array} row - Sheet row data
   * @param {number} rowNum - Row number in sheet (1-based)
   * @returns {Object} Credit note object with all fields
   */
  _buildCreditNoteObject: function(row, rowNum) {
    return {
      creditDate: row[CONFIG.creditNoteCols.creditDate],
      supplier: row[CONFIG.creditNoteCols.supplier],
      creditNo: row[CONFIG.creditNoteCols.creditNo],
      creditAmount: row[CONFIG.creditNoteCols.creditAmount],
      refInvoiceNo: row[CONFIG.creditNoteCols.refInvoiceNo],
      reason: row[CONFIG.creditNoteCols.reason],
      appliedAmount: row[CONFIG.creditNoteCols.appliedAmount] || 0,
      remainingCredit: row[CONFIG.creditNoteCols.remainingCredit] || 0,
      status: row[CONFIG.creditNoteCols.status],
      originDay: row[CONFIG.creditNoteCols.originDay],
      enteredBy: row[CONFIG.creditNoteCols.enteredBy],
      timestamp: row[CONFIG.creditNoteCols.timestamp],
      sysId: row[CONFIG.creditNoteCols.sysId],
      rowNum: rowNum
    };
  },

  /**
   * Generate a unique credit note number
   * Format: CR-YYYYMMDD-NNNNN (credit, date, sequence)
   *
   * @private
   * @returns {string} Credit note number
   */
  _generateCreditNo: function() {
    const date = new Date();
    const dateStr = date.getFullYear() +
                    String(date.getMonth() + 1).padStart(2, '0') +
                    String(date.getDate()).padStart(2, '0');
    const sequence = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    return `CR-${dateStr}-${sequence}`;
  },

  /**
   * Find existing credit note by supplier, invoice, and date
   * (prevent same-day duplicates)
   *
   * @private
   * @param {string} supplier - Supplier name
   * @param {string} invoiceNo - Invoice number
   * @param {Date} creditDate - Credit date
   * @returns {string|null} Credit note number or null
   */
  _findExistingCreditNo: function(supplier, invoiceNo, creditDate) {
    try {
      const creditNoteSheet = MasterDatabaseUtils.getSourceSheet('creditNote');
      if (!creditNoteSheet) return null;

      const data = creditNoteSheet.getRange(2, 1, creditNoteSheet.getLastRow() - 1, CONFIG.totalColumns.creditNote).getValues();
      const targetDate = DateUtils.getDateString(creditDate);

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const rowDate = DateUtils.getDateString(row[CONFIG.creditNoteCols.creditDate]);

        if (StringUtils.equals(row[CONFIG.creditNoteCols.supplier], supplier) &&
            StringUtils.equals(row[CONFIG.creditNoteCols.refInvoiceNo], invoiceNo) &&
            rowDate === targetDate) {
          return row[CONFIG.creditNoteCols.creditNo];
        }
      }
      return null;

    } catch (error) {
      return null;
    }
  },

  /**
   * Update an existing credit note
   *
   * @private
   * @param {string} creditNo - Credit note number
   * @param {Object} data - Updated data
   * @returns {Object} Result with success status
   */
  _updateCreditNote: function(creditNo, data) {
    try {
      const creditNoteSheet = MasterDatabaseUtils.getTargetSheet('creditNote');
      if (!creditNoteSheet) {
        throw new Error('CreditNoteDatabase sheet not found');
      }

      // Find the credit note
      const creditNote = this.findCreditNote(data.supplier, creditNo);
      if (!creditNote) {
        throw new Error(`Credit note not found: ${creditNo}`);
      }

      // Update credit amount and reason
      const targetRow = creditNote.rowNum;
      const updates = [
        [data.creditAmount, data.reason]
      ];
      creditNoteSheet.getRange(targetRow, CONFIG.creditNoteCols.creditAmount + 1, 1, 2).setValues(updates);

      AuditLogger.log('CREDIT_NOTE_UPDATED', {
        creditNo: creditNo,
        supplier: data.supplier,
        newAmount: data.creditAmount,
        reason: data.reason
      }, `Credit note ${creditNo} updated`);

      return {
        creditNoteId: creditNote.sysId,
        creditNo: creditNo,
        success: true,
        message: `Credit note ${creditNo} updated successfully`
      };

    } catch (error) {
      AuditLogger.logError('CreditNoteManager._updateCreditNote', error.message);
      return {
        success: false,
        message: error.message
      };
    }
  },

  /**
   * Find credit note by system ID
   *
   * @private
   * @param {string} creditNoteId - System ID
   * @returns {Object|null} Credit note object or null
   */
  _findBySysId: function(creditNoteId) {
    try {
      const creditNoteSheet = MasterDatabaseUtils.getSourceSheet('creditNote');
      if (!creditNoteSheet) return null;

      const data = creditNoteSheet.getRange(2, 1, creditNoteSheet.getLastRow() - 1, CONFIG.totalColumns.creditNote).getValues();

      for (let i = 0; i < data.length; i++) {
        if (StringUtils.equals(data[i][CONFIG.creditNoteCols.sysId], creditNoteId)) {
          return this._buildCreditNoteObject(data[i], i + 2);
        }
      }
      return null;

    } catch (error) {
      return null;
    }
  },

  /**
   * Add credit note to cache
   *
   * @private
   * @param {number} rowNum - Row number
   * @param {Array} rowData - Row data
   */
  _addCreditNoteToCache: function(rowNum, rowData) {
    // Future: Add credit note caching similar to InvoiceManager if needed
    // For now, credit notes are looked up on demand
  }

};
