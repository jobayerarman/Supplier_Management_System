// @ts-nocheck
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AuditLogger.gs - Audit Trail Management
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * OVERVIEW:
 * Centralized audit logging for the Supplier Management System.
 * Writes immediately to the AuditLog sheet for only three action types:
 *   - VALIDATION_FAILED  (via log())
 *   - SYSTEM_ERROR       (via logError())
 *   - WARNING            (via logWarning())
 *
 * All other log() calls (POST, INVOICE_CREATED, PAYMENT_CREATED, etc.) are
 * written to Logger.log() only — keeping the audit sheet clean and focused
 * on actionable events that operators need to investigate.
 *
 * ARCHITECTURE:
 * ━━━━━━━━━━━━━
 * 1. LOGGING OPERATIONS (Primary Public API)
 *    - log()        → Sheet write only for VALIDATION_FAILED; others → console
 *    - logError()   → Always writes SYSTEM_ERROR immediately
 *    - logWarning() → Always writes WARNING immediately
 *    - logInfo()    → Console only (never writes to sheet)
 *
 * 2. AUDIT TRAIL QUERIES (Read-Only)
 *    - getTrailForRecord()  → All entries for a sysId
 *    - getRecentEntries()   → N most recent entries
 *    - getEntriesByUser()   → All entries by user
 *    - getEntriesByAction() → All entries by action type
 *    All query methods use getSourceSheet() (local/IMPORTRANGE, not master DB)
 *
 * 3. PRIVATE HELPERS
 *    - _sanitizeDetails() → Safe JSON string from data object
 *
 * 4. BACKWARD COMPATIBILITY
 *    - auditAction()    → Delegates to log()
 *    - logSystemError() → Delegates to logError()
 *
 * AUDIT ENTRY FORMAT (7 columns — AuditLog sheet):
 *   1. Timestamp  2. User  3. Sheet  4. Location  5. Action  6. Details(JSON)  7. Message
 *
 * MODULE DEPENDENCIES:
 *   - _Config.gs → CONFIG (totalColumns, auditCols)
 *   - _Utils.gs  → DateUtils, StringUtils, MasterDatabaseUtils
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: AUDIT LOGGER MODULE
// ═══════════════════════════════════════════════════════════════════════════

const AuditLogger = {

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: LOGGING OPERATIONS (Primary Public API)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Log transaction/action.
   *
   * WRITE POLICY: Only VALIDATION_FAILED is written to the AuditLog sheet.
   * All other actions (POST, UPDATE, INVOICE_CREATED, PAYMENT_CREATED, etc.)
   * are sent to Logger.log() only — they do not appear in the audit sheet.
   * This keeps the sheet focused on events operators need to act on.
   *
   * @param {string} action  - Action type (POST, VALIDATION_FAILED, etc.)
   * @param {Object} data    - Transaction data object
   * @param {string} message - Human-readable audit message
   */
  log: function(action, data, message) {
    // Always log to console for debugging
    Logger.log(`[AUDIT] ${action}: ${message}`);

    // Only VALIDATION_FAILED writes to the audit sheet
    if (action !== 'VALIDATION_FAILED') return;

    try {
      const auditRow = [
        DateUtils.now(),
        data.enteredBy || 'SYSTEM',
        data.sheetName || 'N/A',
        `Row ${data.rowNum || 'N/A'}`,
        action,
        this._sanitizeDetails(data),
        message
      ];
      const auditSh = MasterDatabaseUtils.getSourceSheet('audit');
      auditSh.appendRow(auditRow);
    } catch (error) {
      console.error(`[AUDIT] Failed to write VALIDATION_FAILED entry: ${error}`);
      Logger.log(`AUDIT ERROR: ${error.toString()}`);
    }
  },

  /**
   * Log system error. Always writes SYSTEM_ERROR immediately to audit sheet.
   *
   * @param {string} context - Error context/location
   * @param {string} message - Error message
   */
  logError: function(context, message) {
    Logger.log(`[SYSTEM_ERROR] ${context}: ${message}`);
    try {
      const auditRow = [
        DateUtils.now(),
        'SYSTEM',
        'N/A',
        'N/A',
        'SYSTEM_ERROR',
        context,
        message
      ];
      const auditSh = MasterDatabaseUtils.getSourceSheet('audit');
      auditSh.appendRow(auditRow);
    } catch (error) {
      console.error(`[AUDIT] Failed to write SYSTEM_ERROR entry: ${error}`);
      Logger.log(`SYSTEM ERROR: ${context} - ${message}`);
    }
  },

  /**
   * Log warning. Always writes WARNING immediately to audit sheet.
   *
   * @param {string} context - Warning context
   * @param {string} message - Warning message
   */
  logWarning: function(context, message) {
    Logger.log(`[WARNING] ${context}: ${message}`);
    try {
      const auditRow = [
        DateUtils.now(),
        'SYSTEM',
        'N/A',
        'N/A',
        'WARNING',
        context,
        message
      ];
      const auditSh = MasterDatabaseUtils.getSourceSheet('audit');
      auditSh.appendRow(auditRow);
    } catch (error) {
      Logger.log(`WARNING: ${context} - ${message}`);
    }
  },

  /**
   * Log informational message — console only, never writes to audit sheet.
   *
   * @param {string} context - Info context
   * @param {string} message - Info message
   */
  logInfo: function(context, message) {
    Logger.log(`[INFO] ${context}: ${message}`);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: AUDIT TRAIL QUERIES (Read-Only Access)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get complete audit trail for a specific transaction.
   *
   * @param {string} sysId - System ID to search for
   * @returns {Array} Array of matching audit records
   */
  getTrailForRecord: function(sysId) {
    if (StringUtils.isEmpty(sysId)) return [];

    try {
      const auditSh = MasterDatabaseUtils.getSourceSheet('audit');
      const data = auditSh.getDataRange().getValues();

      return data
        .filter((row, i) => {
          if (i === 0) return false; // Skip header
          const details = row[CONFIG.auditCols.details];
          return details && details.toString().includes(sysId);
        })
        .map(row => ({
          timestamp: row[CONFIG.auditCols.timestamp],
          user:      row[CONFIG.auditCols.user],
          sheet:     row[CONFIG.auditCols.sheet],
          location:  row[CONFIG.auditCols.location],
          action:    row[CONFIG.auditCols.action],
          details:   row[CONFIG.auditCols.details],
          message:   row[CONFIG.auditCols.message]
        }));
    } catch (error) {
      this.logError('AuditLogger.getTrailForRecord',
        `Failed to get audit trail for ${sysId}: ${error.toString()}`);
      return [];
    }
  },

  /**
   * Get most recent N audit entries.
   *
   * @param {number} limit - Maximum entries to return (default: 100)
   * @returns {Array} Array of recent audit records
   */
  getRecentEntries: function(limit = 100) {
    try {
      const auditSh = MasterDatabaseUtils.getSourceSheet('audit');
      const lastRow = auditSh.getLastRow();
      if (lastRow <= 1) return [];

      const startRow = Math.max(2, lastRow - limit + 1);
      const numRows  = lastRow - startRow + 1;
      const data = auditSh.getRange(startRow, 1, numRows, CONFIG.totalColumns.audit).getValues();

      return data.map(row => ({
        timestamp: row[CONFIG.auditCols.timestamp],
        user:      row[CONFIG.auditCols.user],
        sheet:     row[CONFIG.auditCols.sheet],
        location:  row[CONFIG.auditCols.location],
        action:    row[CONFIG.auditCols.action],
        details:   row[CONFIG.auditCols.details],
        message:   row[CONFIG.auditCols.message]
      }));
    } catch (error) {
      this.logError('AuditLogger.getRecentEntries',
        `Failed to get recent entries: ${error.toString()}`);
      return [];
    }
  },

  /**
   * Get audit entries for a specific user.
   *
   * @param {string} userEmail
   * @param {number} limit
   * @returns {Array}
   */
  getEntriesByUser: function(userEmail, limit = 100) {
    try {
      const auditSh = MasterDatabaseUtils.getSourceSheet('audit');
      const data = auditSh.getDataRange().getValues();
      const normalizedEmail = StringUtils.normalize(userEmail);

      return data
        .filter((row, i) => {
          if (i === 0) return false;
          return StringUtils.equals(row[CONFIG.auditCols.user], normalizedEmail);
        })
        .slice(-limit)
        .map(row => ({
          timestamp: row[CONFIG.auditCols.timestamp],
          user:      row[CONFIG.auditCols.user],
          sheet:     row[CONFIG.auditCols.sheet],
          location:  row[CONFIG.auditCols.location],
          action:    row[CONFIG.auditCols.action],
          details:   row[CONFIG.auditCols.details],
          message:   row[CONFIG.auditCols.message]
        }));
    } catch (error) {
      this.logError('AuditLogger.getEntriesByUser',
        `Failed to get entries for user ${userEmail}: ${error.toString()}`);
      return [];
    }
  },

  /**
   * Get audit entries for a specific action type.
   *
   * @param {string} actionType
   * @param {number} limit
   * @returns {Array}
   */
  getEntriesByAction: function(actionType, limit = 100) {
    try {
      const auditSh = MasterDatabaseUtils.getSourceSheet('audit');
      const data = auditSh.getDataRange().getValues();

      return data
        .filter((row, i) => {
          if (i === 0) return false;
          return StringUtils.equals(row[CONFIG.auditCols.action], actionType);
        })
        .slice(-limit)
        .map(row => ({
          timestamp: row[CONFIG.auditCols.timestamp],
          user:      row[CONFIG.auditCols.user],
          sheet:     row[CONFIG.auditCols.sheet],
          location:  row[CONFIG.auditCols.location],
          action:    row[CONFIG.auditCols.action],
          details:   row[CONFIG.auditCols.details],
          message:   row[CONFIG.auditCols.message]
        }));
    } catch (error) {
      this.logError('AuditLogger.getEntriesByAction',
        `Failed to get entries for action ${actionType}: ${error.toString()}`);
      return [];
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sanitize data object to a safe JSON string for audit storage.
   * Extracts relevant fields only (excludes sensitive data).
   *
   * @private
   * @param {Object} data
   * @returns {string} JSON string
   */
  _sanitizeDetails: function(data) {
    try {
      const sanitized = {
        supplier:    data.supplier    || '',
        invoice:     data.invoiceNo   || '',
        prevInvoice: data.prevInvoice || '',
        receivedAmt: data.receivedAmt || 0,
        paymentAmt:  data.paymentAmt  || 0,
        paymentType: data.paymentType || '',
        sysId:       data.sysId       || ''
      };
      return JSON.stringify(sanitized);
    } catch (error) {
      return `{"error": "Failed to sanitize data: ${error.message}"}`;
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: BACKWARD COMPATIBILITY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Legacy wrapper for transaction logging
 * @deprecated Use AuditLogger.log() instead
 * @param {string} action - Action type
 * @param {Object} data - Transaction data
 * @param {string} message - Audit message
 */
function auditAction(action, data, message) {
  AuditLogger.log(action, data, message);
}

/**
 * Legacy wrapper for error logging
 * @deprecated Use AuditLogger.logError() instead
 * @param {string} context - Error context
 * @param {string} message - Error message
 */
function logSystemError(context, message) {
  AuditLogger.logError(context, message);
}
