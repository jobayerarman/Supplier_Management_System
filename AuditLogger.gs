// @ts-nocheck
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AuditLogger.gs - Comprehensive Audit Trail Management
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * OVERVIEW:
 * Centralized audit logging system for the Supplier Management System.
 * Maintains complete audit trail of all transactions, system errors, and
 * administrative actions with performance-optimized batch queue system.
 *
 * CORE RESPONSIBILITIES:
 * ━━━━━━━━━━━━━━━━━━━━━
 * 1. TRANSACTION LOGGING
 *    - Log invoice and payment operations
 *    - Capture transaction details (supplier, amount, type, etc.)
 *    - User attribution for all operations
 *    - Integration with batch operations
 *
 * 2. SYSTEM ERROR LOGGING
 *    - Capture system-level errors and exceptions
 *    - Log validation failures and edge cases
 *    - Track error context and messages
 *    - Enable error investigation and debugging
 *
 * 3. ADMINISTRATIVE LOGGING
 *    - Log warnings and informational messages
 *    - Track batch operation start/completion
 *    - Monitor system health events
 *    - Audit administrative actions
 *
 * 4. BATCH QUEUE MANAGEMENT
 *    - In-memory queue for audit entries
 *    - Automatic flush at threshold (100 entries)
 *    - Manual flush capability for end-of-operation cleanup
 *    - Queue statistics for monitoring
 *
 * 5. AUDIT TRAIL QUERYING
 *    - Retrieve complete audit trail for specific transaction
 *    - Query recent entries with limit control
 *    - Filter by user email
 *    - Filter by action type
 *    - Read-only access to audit history
 *
 * ARCHITECTURE & DESIGN PATTERNS:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * MODULE ORGANIZATION:
 *   1. MODULE HEADER - This documentation
 *   2. BATCH QUEUE SYSTEM - Internal state management
 *      - _queue: In-memory array of audit entries
 *      - _batchingEnabled: Feature toggle for batching
 *      - _autoFlushThreshold: Threshold for automatic flush (100 entries)
 *      - _lastFlushTime: Performance monitoring timestamp
 *   3. LOGGING OPERATIONS - Primary public API for logging
 *      - log(): Log transaction/action
 *      - logError(): Log system errors
 *      - logWarning(): Log warnings
 *      - logInfo(): Log informational messages
 *   4. QUEUE MANAGEMENT - Queue control operations
 *      - flush(): Write queued entries to sheet
 *      - setBatchMode(): Enable/disable batching
 *      - getQueueStats(): Inspect queue status
 *      - clearQueue(): Discard pending entries
 *   5. AUDIT TRAIL QUERIES - Read-only query operations
 *      - getTrailForRecord(): Get all entries for transaction
 *      - getRecentEntries(): Get N most recent entries
 *      - getEntriesByUser(): Get all entries by user
 *      - getEntriesByAction(): Get all entries by action type
 *   6. PRIVATE HELPERS - Internal utilities
 *      - _sanitizeDetails(): Prepare data for logging
 *   7. BACKWARD COMPATIBILITY - Legacy function wrappers
 *      - auditAction(): Delegates to log()
 *      - logSystemError(): Delegates to logError()
 *
 * DESIGN PATTERNS USED:
 *   • Module Pattern: Encapsulation via AuditLogger object
 *   • Batch Queue Pattern: In-memory queueing with batch writes
 *   • Error Handling: Try-catch with console fallback
 *   • Data Sanitization: Selective field extraction for privacy
 *   • Master Database Support: Uses getTargetSheet() for writes
 *
 * PERFORMANCE STRATEGY:
 * ━━━━━━━━━━━━━━━━━━
 * BATCH QUEUE SYSTEM:
 *   - Operation: Queues entries in memory, writes in batches
 *   - Benefit: Reduces 150+ API calls to 1-3 calls per batch operation
 *   - Threshold: Auto-flushes at 100 entries
 *   - Cost: Minimal memory overhead (~1-2KB per 100 entries)
 *   - Trade-off: Slight delay in audit trail visibility vs significant API savings
 *
 * LOGGING PERFORMANCE:
 *   - Queue operation: <0.5ms per log call (memory write only)
 *   - Auto-flush trigger: 10-50ms (one-time batch write)
 *   - Manual flush: 20-100ms (sheet write operation)
 *   - Query operations: 500-2000ms (full sheet read required)
 *
 * MASTER DATABASE INTEGRATION:
 *   - All writes use MasterDatabaseUtils.getTargetSheet('audit')
 *   - Works seamlessly in both local and master modes
 *   - Master mode: Writes to centralized audit database
 *   - Local mode: Writes to local AuditLog sheet
 *   - No code changes required for mode switching
 *
 * INTEGRATION POINTS:
 * ━━━━━━━━━━━━━━━━━
 * CODE.GS:
 *   - Uses: AuditLogger.logError() for error reporting
 *   - Uses: auditAction() for transaction logging
 *   - Integration: Every post operation logs to audit trail
 *
 * INVOICE MANAGER:
 *   - Uses: AuditLogger.log() for invoice operations
 *   - Uses: AuditLogger.logError() for validation failures
 *
 * PAYMENT MANAGER:
 *   - Uses: AuditLogger.log() for payment processing
 *   - Uses: AuditLogger.logError() for duplicate detection
 *
 * UIMENU.GS (BATCH OPERATIONS):
 *   - Uses: AuditLogger.flush() at end of batch
 *   - Uses: AuditLogger.setBatchMode(true) for batch operations
 *   - Integration: Batch mode enabled during batch processing
 *
 * VALIDATION ENGINE:
 *   - Uses: AuditLogger.logWarning() for validation warnings
 *   - Uses: AuditLogger.logError() for validation failures
 *
 * AUDIT TRAIL QUERIES:
 *   - Can be called from any module to inspect history
 *   - No write operations (read-only access)
 *   - Used for debugging and compliance verification
 *
 * DATA STRUCTURES:
 * ━━━━━━━━━━━━━━
 * AUDIT ENTRY (7 columns):
 *   1. Timestamp (Date)
 *   2. User (string) - User email or 'SYSTEM'
 *   3. Sheet (string) - Daily sheet name or 'N/A'
 *   4. Location (string) - Row number or 'N/A'
 *   5. Action (string) - Action type (POST, ERROR, WARNING, INFO, etc.)
 *   6. Details (JSON string) - Transaction details
 *      - supplier, invoice, prevInvoice, receivedAmt, paymentAmt, paymentType, sysId
 *   7. Message (string) - Human-readable message
 *
 * QUEUE STATS (object):
 *   {
 *     queueLength: number,           // Current entries pending
 *     batchingEnabled: boolean,      // Batching active?
 *     autoFlushThreshold: number,    // Flush trigger (100)
 *     timeSinceLastFlush: number     // Milliseconds since last flush
 *   }
 *
 * AUDIT RECORD (object) - From query operations:
 *   {
 *     timestamp: string,
 *     user: string,
 *     sheet: string,
 *     location: string,
 *     action: string,
 *     details: string (JSON),
 *     message: string
 *   }
 *
 * MODULE DEPENDENCIES:
 * ━━━━━━━━━━━━━━━━
 * Required:
 *   - _Config.gs → CONFIG object (totalColumns, auditCols)
 *   - _Utils.gs → DateUtils, StringUtils, MasterDatabaseUtils
 *
 * Used by:
 *   - Code.gs → onEdit handler error logging
 *   - UIMenu.gs → Batch operation logging
 *   - InvoiceManager.gs → Invoice operation logging
 *   - PaymentManager.gs → Payment operation logging
 *   - ValidationEngine.gs → Validation error logging
 *   - All modules → Error reporting via logError()
 *
 * Does NOT use:
 *   - No circular dependencies
 *   - No direct imports from other logging modules
 *
 * BACKWARD COMPATIBILITY:
 * ━━━━━━━━━━━━━━━━━━━━
 * Legacy Functions Provided:
 *   - auditAction(action, data, message) → Delegates to AuditLogger.log()
 *   - logSystemError(context, message) → Delegates to AuditLogger.logError()
 *
 * Migration Path:
 *   - Use: AuditLogger.log() instead of auditAction()
 *   - Use: AuditLogger.logError() instead of logSystemError()
 *   - Use: AuditLogger.logWarning() for warnings
 *   - Use: AuditLogger.logInfo() for informational messages
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: BATCH QUEUE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Centralized audit logging module
 *
 * BATCH QUEUE SYSTEM:
 * - Queues entries in memory during operations
 * - Auto-flushes at 100 entries or when explicitly called
 * - Reduces 150+ appendRow() calls to 1-3 setValues() calls
 * - Net result: 50-90% reduction in API calls during batch operations
 */
const AuditLogger = {
  // ═══ INTERNAL STATE ═══
  _queue: [],                    // Queue for batched audit entries
  _batchingEnabled: true,        // Enable/disable batching (true = better performance)
  _autoFlushThreshold: 100,      // Auto-flush when queue reaches this size
  _lastFlushTime: Date.now(),    // Track last flush for monitoring

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: LOGGING OPERATIONS (Primary Public API)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Log transaction/action to audit trail
   *
   * QUEUE BEHAVIOR:
   * - If batching enabled: Adds entry to queue (< 0.5ms)
   * - If batching disabled: Writes immediately (20-50ms)
   * - Auto-flushes when queue reaches 100 entries
   *
   * @param {string} action - Action type (POST, UPDATE, DELETE, etc.)
   * @param {Object} data - Transaction data object
   * @param {string} message - Human-readable audit message
   */
  log: function(action, data, message) {
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
   * Log system error to audit trail
   *
   * Used for:
   * - Validation failures
   * - Exception handling
   * - System-level errors
   * - Duplicate detection
   *
   * QUEUE BEHAVIOR: Same as log()
   *
   * @param {string} context - Error context/location
   * @param {string} message - Error message
   */
  logError: function(context, message) {
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
   * Log warning to audit trail
   *
   * Used for:
   * - Non-critical issues
   * - Validation warnings
   * - Suspicious patterns
   * - Performance alerts
   *
   * QUEUE BEHAVIOR: Same as log()
   *
   * @param {string} context - Warning context
   * @param {string} message - Warning message
   */
  logWarning: function(context, message) {
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
   * Log informational message to audit trail
   *
   * Used for:
   * - Batch operation start/completion
   * - System health events
   * - Administrative actions
   * - Performance metrics
   *
   * QUEUE BEHAVIOR: Same as log()
   *
   * @param {string} context - Info context
   * @param {string} message - Info message
   */
  logInfo: function(context, message) {
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

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: QUEUE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Flush all queued audit entries to sheet
   *
   * PERFORMANCE:
   * - Single batch write via setValues() (1 API call)
   * - Writes all pending entries in one operation
   * - Reduces 150+ appendRow() calls to 1-3 setValues() calls
   * - Duration: 20-100ms depending on queue size
   *
   * Called automatically:
   *   - When queue reaches threshold (100 entries)
   * Called manually:
   *   - At end of batch operations (UIMenu.gs)
   *   - Before switching batch mode off
   *   - For explicit audit trail updates
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
   *
   * BATCH MODE:
   * - Enabled (true): Queues entries, writes in batches
   *   - Best for: Batch operations, bulk processing
   *   - Performance: 50-90% fewer API calls
   *   - Visibility: Slight delay in audit trail
   *
   * - Disabled (false): Writes immediately per operation
   *   - Best for: Real-time audit trail visibility
   *   - Performance: More API calls but instant logging
   *   - Visibility: Immediate audit trail updates
   *
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
   * Get queue statistics for monitoring
   *
   * Returns object with:
   * - queueLength: Current number of pending entries
   * - batchingEnabled: Is batching active?
   * - autoFlushThreshold: Flush trigger (100)
   * - timeSinceLastFlush: Milliseconds since last flush
   *
   * @returns {Object} Queue statistics
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
   *
   * ⚠️ WARNING: USE WITH CAUTION
   * This discards all pending audit entries permanently
   * Only use for emergency cleanup or testing
   *
   * Consider flush() instead if you want to preserve entries
   *
   * @returns {number} Number of entries discarded
   */
  clearQueue: function() {
    const discarded = this._queue.length;
    this._queue = [];
    Logger.log(`[AuditLogger] Cleared queue, discarded ${discarded} entries`);
    return discarded;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: AUDIT TRAIL QUERIES (Read-Only Access)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get complete audit trail for specific transaction
   *
   * Searches entire audit trail for entries related to transaction
   * (identified by system ID)
   *
   * PERFORMANCE:
   * - Reads entire audit sheet (500-2000ms)
   * - Filters by sysId in transaction details
   * - Returns array of matching records
   *
   * @param {string} sysId - System ID to search for
   * @returns {Array} Array of audit records for transaction
   */
  getTrailForRecord: function(sysId) {
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
   * Get most recent audit entries
   *
   * Retrieves N most recent entries from audit trail
   *
   * PERFORMANCE:
   * - Reads entire audit sheet
   * - Extracts last N rows
   * - Good for recent activity review
   *
   * @param {number} limit - Maximum number of entries to return (default: 100)
   * @returns {Array} Array of recent audit records
   */
  getRecentEntries: function(limit = 100) {
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
   * Get all audit entries for specific user
   *
   * Filters audit trail by user email
   *
   * PERFORMANCE:
   * - Reads entire audit sheet
   * - Filters by normalized user email
   * - Returns last N matching entries
   *
   * @param {string} userEmail - User email to filter by
   * @param {number} limit - Maximum number of entries (default: 100)
   * @returns {Array} Array of audit records for user
   */
  getEntriesByUser: function(userEmail, limit = 100) {
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
   * Get all audit entries for specific action type
   *
   * Filters audit trail by action type
   *
   * PERFORMANCE:
   * - Reads entire audit sheet
   * - Filters by action (case-insensitive)
   * - Returns last N matching entries
   *
   * Action Types:
   *   - POST: Invoice/payment posting
   *   - UPDATE: Record updates
   *   - DELETE: Record deletion
   *   - SYSTEM_ERROR: System-level errors
   *   - WARNING: Warning conditions
   *   - INFO: Informational messages
   *
   * @param {string} actionType - Action type to filter by
   * @param {number} limit - Maximum number of entries (default: 100)
   * @returns {Array} Array of audit records for action type
   */
  getEntriesByAction: function(actionType, limit = 100) {
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

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sanitize data object for audit logging
   * Extracts relevant fields only (excludes sensitive data)
   *
   * @private
   * @param {Object} data - Data object to sanitize
   * @returns {string} JSON string of sanitized data
   */
  _sanitizeDetails: function(data) {
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

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: BACKWARD COMPATIBILITY
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
