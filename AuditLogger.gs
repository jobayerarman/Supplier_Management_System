// @ts-nocheck
// ==================== MODULE: AuditLogger.gs ====================
/**
 * Audit logging module
 * Handles all audit trail operations
 *
 * PERFORMANCE OPTIMIZATION: Batch Queue System
 * - Queues audit entries in memory during batch operations
 * - Flushes queue with single setValues() call
 * - Reduces 150+ API calls to 3-5 calls for batch operations
 * - Auto-flush at 100 entries or when explicitly called
 */

// refactor: implement comprehensive audit logging module

const AuditLogger = {
  // ═══ BATCH QUEUE SYSTEM ═══
  _queue: [],                    // Queue for batched audit entries
  _batchingEnabled: true,        // Enable/disable batching (true = better performance)
  _autoFlushThreshold: 100,      // Auto-flush when queue reaches this size
  _lastFlushTime: Date.now(),    // Track last flush for monitoring

  /**
   * Log action to audit trail
   * Uses batch queue if enabled, otherwise writes immediately
   * @param {string} action - Action type
   * @param {Object} data - Transaction data
   * @param {string} message - Audit message
   */
  log: function (action, data, message) {
    try {
      const auditRow = [
        DateUtils.now(),                          // Timestamp
        data.enteredBy || 'SYSTEM',               // User
        data.sheetName || 'N/A',                  // Sheet
        `Row ${data.rowNum || 'N/A'}`,           // Location
        action,                                    // Action
        this._sanitizeDetails(data),              // Details (JSON)
        message                                    // Message
      ];

      if (this._batchingEnabled) {
        // Queue the entry for batch write
        this._queue.push(auditRow);

        // Auto-flush if queue is full
        if (this._queue.length >= this._autoFlushThreshold) {
          this.flush();
        }
      } else {
        // Immediate write (legacy mode)
        const auditSh = MasterDatabaseUtils.getTargetSheet('audit');
        auditSh.appendRow(auditRow);
      }

    } catch (error) {
      // Fallback to console if audit sheet unavailable
      console.error(`[AUDIT] ${action}: ${message}`, error);
      Logger.log(`AUDIT ERROR: Failed to log action "${action}": ${error.toString()}`);
    }
  },

  /**
   * Log system error
   * Uses batch queue if enabled
   * @param {string} context - Error context/location
   * @param {string} message - Error message
   */
  logError: function (context, message) {
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

      if (this._batchingEnabled) {
        this._queue.push(auditRow);
        if (this._queue.length >= this._autoFlushThreshold) {
          this.flush();
        }
      } else {
        const auditSh = MasterDatabaseUtils.getTargetSheet('audit');
        auditSh.appendRow(auditRow);
      }
    } catch (error) {
      console.error(`[SYSTEM ERROR] ${context}: ${message}`, error);
      Logger.log(`SYSTEM ERROR: ${context} - ${message}`);
    }
  },

  /**
   * Log warning
   * Uses batch queue if enabled
   * @param {string} context - Warning context
   * @param {string} message - Warning message
   */
  logWarning: function (context, message) {
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

      if (this._batchingEnabled) {
        this._queue.push(auditRow);
        if (this._queue.length >= this._autoFlushThreshold) {
          this.flush();
        }
      } else {
        const auditSh = MasterDatabaseUtils.getTargetSheet('audit');
        auditSh.appendRow(auditRow);
      }
    } catch (error) {
      Logger.log(`WARNING: ${context} - ${message}`);
    }
  },

  /**
   * Log info
   * Uses batch queue if enabled
   * @param {string} context - Info context
   * @param {string} message - Info message
   */
  logInfo: function (context, message) {
    try {
      const auditRow = [
        DateUtils.now(),
        'SYSTEM',
        'N/A',
        'N/A',
        'INFO',
        context,
        message
      ];

      if (this._batchingEnabled) {
        this._queue.push(auditRow);
        if (this._queue.length >= this._autoFlushThreshold) {
          this.flush();
        }
      } else {
        const auditSh = MasterDatabaseUtils.getTargetSheet('audit');
        auditSh.appendRow(auditRow);
      }
    } catch (error) {
      Logger.log(`INFO: ${context} - ${message}`);
    }
  },

  /**
   * Flush queued audit entries to sheet
   * Writes all pending entries in a single batch operation
   * PERFORMANCE: Reduces 150+ appendRow() calls to 1-3 setValues() calls
   *
   * @returns {number} Number of entries flushed
   */
  flush: function() {
    if (this._queue.length === 0) {
      return 0;
    }

    try {
      const auditSh = MasterDatabaseUtils.getTargetSheet('audit');
      const lastRow = auditSh.getLastRow();
      const startRow = lastRow + 1;
      const numEntries = this._queue.length;

      // Single batch write - MAJOR PERFORMANCE IMPROVEMENT
      auditSh.getRange(startRow, 1, numEntries, CONFIG.totalColumns.audit)
        .setValues(this._queue);

      // Track performance
      const flushDuration = Date.now() - this._lastFlushTime;
      Logger.log(`[AuditLogger] Flushed ${numEntries} entries in batch (${flushDuration}ms since last flush)`);

      // Clear queue
      const flushedCount = this._queue.length;
      this._queue = [];
      this._lastFlushTime = Date.now();

      return flushedCount;

    } catch (error) {
      Logger.log(`AUDIT FLUSH ERROR: Failed to flush ${this._queue.length} entries: ${error.toString()}`);
      // Keep queue intact for retry
      return 0;
    }
  },

  /**
   * Enable or disable batch mode
   * @param {boolean} enabled - True to enable batching, false for immediate writes
   */
  setBatchMode: function(enabled) {
    // Flush any pending entries before changing mode
    if (!enabled && this._queue.length > 0) {
      this.flush();
    }
    this._batchingEnabled = enabled;
    Logger.log(`[AuditLogger] Batch mode ${enabled ? 'enabled' : 'disabled'}`);
  },

  /**
   * Get queue statistics
   * @returns {Object} Queue stats
   */
  getQueueStats: function() {
    return {
      queueLength: this._queue.length,
      batchingEnabled: this._batchingEnabled,
      autoFlushThreshold: this._autoFlushThreshold,
      timeSinceLastFlush: Date.now() - this._lastFlushTime
    };
  },

  /**
   * Clear the queue without writing
   * USE WITH CAUTION - discards pending audit entries
   */
  clearQueue: function() {
    const discarded = this._queue.length;
    this._queue = [];
    Logger.log(`[AuditLogger] Cleared queue, discarded ${discarded} entries`);
    return discarded;
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
