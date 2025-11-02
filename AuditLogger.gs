// @ts-nocheck
// ==================== MODULE: AuditLogger.gs ====================
/**
 * Audit logging module
 * Handles all audit trail operations
 */

// refactor: implement comprehensive audit logging module

const AuditLogger = {
  /**
   * Log action to audit trail
   * @param {string} action - Action type
   * @param {Object} data - Transaction data
   * @param {string} message - Audit message
   */
  log: function (action, data, message) {
    try {
      // Use Master Database if in master mode, otherwise use local sheet
      const auditSh = MasterDatabaseUtils.getTargetSheet('audit');

      const auditRow = [
        DateUtils.now(),                          // Timestamp
        data.enteredBy || 'SYSTEM',               // User
        data.sheetName || 'N/A',                  // Sheet
        `Row ${data.rowNum || 'N/A'}`,           // Location
        action,                                    // Action
        this._sanitizeDetails(data),              // Details (JSON)
        message                                    // Message
      ];

      auditSh.appendRow(auditRow);

    } catch (error) {
      // Fallback to console if audit sheet unavailable
      console.error(`[AUDIT] ${action}: ${message}`, error);
      Logger.log(`AUDIT ERROR: Failed to log action "${action}": ${error.toString()}`);
    }
  },

  /**
   * Log system error
   * @param {string} context - Error context/location
   * @param {string} message - Error message
   */
  logError: function (context, message) {
    try {
      // Use Master Database if in master mode, otherwise use local sheet
      const auditSh = MasterDatabaseUtils.getTargetSheet('audit');
      auditSh.appendRow([
        DateUtils.now(),
        'SYSTEM',
        'N/A',
        'N/A',
        'SYSTEM_ERROR',
        context,
        message
      ]);
    } catch (error) {
      console.error(`[SYSTEM ERROR] ${context}: ${message}`, error);
      Logger.log(`SYSTEM ERROR: ${context} - ${message}`);
    }
  },

  /**
   * Log warning
   * @param {string} context - Warning context
   * @param {string} message - Warning message
   */
  logWarning: function (context, message) {
    try {
      // Use Master Database if in master mode, otherwise use local sheet
      const auditSh = MasterDatabaseUtils.getTargetSheet('audit');
      auditSh.appendRow([
        DateUtils.now(),
        'SYSTEM',
        'N/A',
        'N/A',
        'WARNING',
        context,
        message
      ]);
    } catch (error) {
      Logger.log(`WARNING: ${context} - ${message}`);
    }
  },

  /**
   * Log info
   * @param {string} context - Info context
   * @param {string} message - Info message
   */
  logInfo: function (context, message) {
    try {
      // Use Master Database if in master mode, otherwise use local sheet
      const auditSh = MasterDatabaseUtils.getTargetSheet('audit');
      auditSh.appendRow([
        DateUtils.now(),
        'SYSTEM',
        'N/A',
        'N/A',
        'INFO',
        context,
        message
      ]);
    } catch (error) {
      Logger.log(`INFO: ${context} - ${message}`);
    }
  },

  /**
   * Get audit trail for specific record
   * @param {string} sysId - System ID to search for
   * @returns {Array} Array of audit records
   */
  getTrailForRecord: function (sysId) {
    if (StringUtils.isEmpty(sysId)) {
      return [];
    }

    try {
      // Use Master Database if in master mode, otherwise use local sheet
      const auditSh = MasterDatabaseUtils.getTargetSheet('audit');
      const data = auditSh.getDataRange().getValues();

      return data
        .filter((row, i) => {
          if (i === 0) return false; // Skip header
          const details = row[CONFIG.auditCols.details];
          return details && details.toString().includes(sysId);
        })
        .map(row => ({
          timestamp: row[CONFIG.auditCols.timestamp],
          user: row[CONFIG.auditCols.user],
          sheet: row[CONFIG.auditCols.sheet],
          location: row[CONFIG.auditCols.location],
          action: row[CONFIG.auditCols.action],
          details: row[CONFIG.auditCols.details],
          message: row[CONFIG.auditCols.message]
        }));

    } catch (error) {
      this.logError('AuditLogger.getTrailForRecord',
        `Failed to get audit trail for ${sysId}: ${error.toString()}`);
      return [];
    }
  },

  /**
   * Get recent audit entries
   * @param {number} limit - Maximum number of entries to return
   * @returns {Array} Array of recent audit records
   */
  getRecentEntries: function (limit = 100) {
    try {
      // Use Master Database if in master mode, otherwise use local sheet
      const auditSh = MasterDatabaseUtils.getTargetSheet('audit');
      const lastRow = auditSh.getLastRow();

      if (lastRow <= 1) return [];

      const startRow = Math.max(2, lastRow - limit + 1);
      const numRows = lastRow - startRow + 1;

      const data = auditSh.getRange(startRow, 1, numRows, CONFIG.totalColumns.audit).getValues();

      return data.map(row => ({
        timestamp: row[CONFIG.auditCols.timestamp],
        user: row[CONFIG.auditCols.user],
        sheet: row[CONFIG.auditCols.sheet],
        location: row[CONFIG.auditCols.location],
        action: row[CONFIG.auditCols.action],
        details: row[CONFIG.auditCols.details],
        message: row[CONFIG.auditCols.message]
      }));

    } catch (error) {
      this.logError('AuditLogger.getRecentEntries',
        `Failed to get recent entries: ${error.toString()}`);
      return [];
    }
  },

  /**
   * Get audit entries by user
   * @param {string} userEmail - User email to filter by
   * @param {number} limit - Maximum number of entries
   * @returns {Array} Array of audit records for user
   */
  getEntriesByUser: function (userEmail, limit = 100) {
    try {
      // Use Master Database if in master mode, otherwise use local sheet
      const auditSh = MasterDatabaseUtils.getTargetSheet('audit');
      const data = auditSh.getDataRange().getValues();

      const normalizedEmail = StringUtils.normalize(userEmail);

      return data
        .filter((row, i) => {
          if (i === 0) return false;
          return StringUtils.equals(row[CONFIG.auditCols.user], normalizedEmail);
        })
        .slice(-limit) // Get last N entries
        .map(row => ({
          timestamp: row[CONFIG.auditCols.timestamp],
          user: row[CONFIG.auditCols.user],
          sheet: row[CONFIG.auditCols.sheet],
          location: row[CONFIG.auditCols.location],
          action: row[CONFIG.auditCols.action],
          details: row[CONFIG.auditCols.details],
          message: row[CONFIG.auditCols.message]
        }));

    } catch (error) {
      this.logError('AuditLogger.getEntriesByUser',
        `Failed to get entries for user ${userEmail}: ${error.toString()}`);
      return [];
    }
  },

  /**
   * Get audit entries by action type
   * @param {string} actionType - Action type to filter by
   * @param {number} limit - Maximum number of entries
   * @returns {Array} Array of audit records
   */
  getEntriesByAction: function (actionType, limit = 100) {
    try {
      // Use Master Database if in master mode, otherwise use local sheet
      const auditSh = MasterDatabaseUtils.getTargetSheet('audit');
      const data = auditSh.getDataRange().getValues();

      return data
        .filter((row, i) => {
          if (i === 0) return false;
          return StringUtils.equals(row[CONFIG.auditCols.action], actionType);
        })
        .slice(-limit)
        .map(row => ({
          timestamp: row[CONFIG.auditCols.timestamp],
          user: row[CONFIG.auditCols.user],
          sheet: row[CONFIG.auditCols.sheet],
          location: row[CONFIG.auditCols.location],
          action: row[CONFIG.auditCols.action],
          details: row[CONFIG.auditCols.details],
          message: row[CONFIG.auditCols.message]
        }));

    } catch (error) {
      this.logError('AuditLogger.getEntriesByAction',
        `Failed to get entries for action ${actionType}: ${error.toString()}`);
      return [];
    }
  },

  /**
   * Sanitize data object for audit logging
   * @private
   * @param {Object} data - Data object to sanitize
   * @returns {string} JSON string of sanitized data
   */
  _sanitizeDetails: function (data) {
    try {
      const sanitized = {
        supplier: data.supplier || '',
        invoice: data.invoiceNo || '',
        prevInvoice: data.prevInvoice || '',
        receivedAmt: data.receivedAmt || 0,
        paymentAmt: data.paymentAmt || 0,
        paymentType: data.paymentType || '',
        sysId: data.sysId || ''
      };
      return JSON.stringify(sanitized);
    } catch (error) {
      return { error: "Failed to sanitize data: ${error.message}" };
    }
  }
};

// Backward compatibility functions
function auditAction(action, data, message) {
  AuditLogger.log(action, data, message);
}
function logSystemError(context, message) {
  AuditLogger.logError(context, message);
}
