// ==================== MODULE: Utils.gs ====================
/**
 * _Utils.gs - Utility Functions
 * Shared helper functions used across the application
 */


/**
 * String normalization and manipulation utilities
 */
const StringUtils = {
  /**
   * Normalize string for comparison (trim, uppercase, handle nulls)
   * @param {*} value - Value to normalize
   * @returns {string} Normalized string
   */
  normalize: function(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return value.toString().trim().toUpperCase();
  },
  
  /**
   * Compare two values with normalization
   * @param {*} val1 - First value
   * @param {*} val2 - Second value
   * @returns {boolean} True if values match after normalization
   */
  equals: function(val1, val2) {
    return this.normalize(val1) === this.normalize(val2);
  },
  
  /**
   * Check if string is empty after normalization
   * @param {*} value - Value to check
   * @returns {boolean} True if empty
   */
  isEmpty: function(value) {
    return this.normalize(value) === '';
  },
  
  /**
   * Sanitize string for use in formulas (escape quotes, etc.)
   * @param {string} value - Value to sanitize
   * @returns {string} Sanitized string
   */
  sanitizeForFormula: function(value) {
    if (!value) return '';
    return value.toString().replace(/"/g, '""');
  },
  
  /**
   * Truncate string to max length
   * @param {string} value - Value to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated string
   */
  truncate: function(value, maxLength) {
    if (!value) return '';
    const str = value.toString();
    return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
  }
};

/**
 * Date and time utilities
 */
const DateUtils = {
  /**
   * Format time as HH:mm:ss
   * @param {Date} date - Date object
   * @returns {string} Formatted time
   */
  formatTime: function(date) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'HH:mm:ss');
  },
  
  /**
   * Format date as YYYY-MM-DD
   * @param {Date} date - Date object
   * @returns {string} Formatted date
   */
  formatDate: function(date) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  },
  
  /**
   * Format datetime as YYYY-MM-DD HH:mm:ss
   * @param {Date} date - Date object
   * @returns {string} Formatted datetime
   */
  formatDateTime: function(date) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  },
  
  /**
   * Get current timestamp
   * @returns {Date} Current date and time
   */
  now: function() {
    return new Date();
  }
};

/**
 * Sheet access utilities with error handling
 */
const SheetUtils = {
  /**
   * Get sheet by name with validation
   * @param {string} name - Sheet name
   * @returns {GoogleAppsScript.Spreadsheet.Sheet} Sheet object
   * @throws {Error} If sheet not found
   */
  getSheet: function(name) {
    if (!name) {
      const error = 'Sheet name is required';
      AuditLogger.logError('SheetUtils.getSheet', error);
      throw new Error(error);
    }

    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) {
        throw new Error('Unable to access active spreadsheet');
      }
      
      const sheet = ss.getSheetByName(name);
      if (!sheet) {
        const availableSheets = ss.getSheets().map(s => s.getName()).join(', ');
        const error = `Sheet "${name}" not found. Available sheets: ${availableSheets}`;
        AuditLogger.logError('SheetUtils.getSheet', error);
        throw new Error(error);
      }
      
      return sheet;
    } catch (error) {
      AuditLogger.logError('SheetUtils.getSheet', `Failed to access sheet "${name}": ${error.toString()}`);
      throw error;
    }
  },
  
  /**
   * Check if sheet exists
   * @param {string} name - Sheet name
   * @returns {boolean} True if sheet exists
   */
  sheetExists: function(name) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return ss.getSheetByName(name) !== null;
    } catch (error) {
      return false;
    }
  },
  
  /**
   * Get all sheet names
   * @returns {string[]} Array of sheet names
   */
  getAllSheetNames: function() {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return ss.getSheets().map(s => s.getName());
    } catch (error) {
      AuditLogger.logError('SheetUtils.getAllSheetNames', error.toString());
      return [];
    }
  }
};

/**
 * Execution context for caching data during a single execution
 * PERFORMANCE OPTIMIZATION: Caches frequently accessed data
 * - Daily sheet dates: Reduces 50+ API calls to 1 per sheet
 * - TTL: Cleared automatically between executions
 */
const ExecutionContext = {
  _sheetDateCache: {},    // Cache for daily sheet dates

  /**
   * Clear all execution context caches
   * Called automatically at start of major operations
   */
  clearAll: function() {
    this._sheetDateCache = {};
  },

  /**
   * Get cached sheet date or fetch and cache it
   * @param {string} sheetName - Sheet name
   * @returns {Date|null} Sheet date
   */
  getDailySheetDate: function(sheetName) {
    // Check cache first
    if (this._sheetDateCache.hasOwnProperty(sheetName)) {
      return this._sheetDateCache[sheetName];
    }

    // Cache miss - fetch from sheet
    const date = this._fetchDailySheetDate(sheetName);
    this._sheetDateCache[sheetName] = date;
    return date;
  },

  /**
   * Internal: Fetch date from sheet (no caching)
   * @private
   * @param {string} sheetName - Sheet name
   * @returns {Date|null} Sheet date
   */
  _fetchDailySheetDate: function(sheetName) {
    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
      if (!sheet) return null;

      const dateValue = sheet.getRange('A3').getValue();

      // Handle various date formats
      if (dateValue instanceof Date) {
        return dateValue;
      }

      // Try parsing string
      if (typeof dateValue === 'string') {
        const parsed = new Date(dateValue);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }

      // Fallback: construct from sheet name and current month/year
      const day = parseInt(sheetName);
      if (!isNaN(day) && day >= 1 && day <= 31) {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), day);
      }

      return null;

    } catch (error) {
      AuditLogger.logError('ExecutionContext._fetchDailySheetDate',
        `Failed to get date from sheet ${sheetName}: ${error.toString()}`);
      return null;
    }
  }
};

/**
 * Get the date from cell A3 of a daily sheet
 * PERFORMANCE: Uses ExecutionContext cache to avoid repeated API calls
 * @param {string} sheetName - Daily sheet name (01-31)
 * @returns {Date|null} Date from A3 or null
 */
function getDailySheetDate(sheetName) {
  return ExecutionContext.getDailySheetDate(sheetName);
}

/**
 * Generate unique identifiers
 */
const IDGenerator = {
  /**
   * Generate UUID
   * @returns {string} UUID string
   */
  generateUUID: function() {
    return 'inv_' + Utilities.getUuid();
  },
  
  /**
   * Generate invoice ID
   * @param {string} baseId - Base system ID
   * @returns {string} Invoice ID
   */
  generateInvoiceId: function(baseId) {
    return baseId + '_INV';
  },
  
  /**
   * Generate payment ID
   * @param {string} baseId - Base system ID
   * @returns {string} Payment ID
   */
  generatePaymentId: function(baseId) {
    return baseId + '_PAY';
  },
  
  /**
   * Generate ledger ID
   * @returns {string} Ledger ID
   */
  generateLedgerId: function() {
    return 'LEDGER_' + Date.now();
  }
};

/**
 * Lock management utilities
 */
const LockManager = {
  /**
   * Acquire document lock with timeout
   * @param {number} timeout - Timeout in milliseconds
   * @returns {GoogleAppsScript.Lock.Lock|null} Lock object or null if failed
   */
  acquireDocumentLock: function(timeout = 30000) {
    const lock = LockService.getDocumentLock();
    try {
      const acquired = lock.tryLock(timeout);
      if (!acquired) {
        AuditLogger.logError('LockManager', 'Failed to acquire document lock');
        return null;
      }
      return lock;
    } catch (error) {
      AuditLogger.logError('LockManager', `Lock acquisition error: ${error.toString()}`);
      return null;
    }
  },
  
  /**
   * Acquire script lock with timeout
   * @param {number} timeout - Timeout in milliseconds
   * @returns {GoogleAppsScript.Lock.Lock|null} Lock object or null if failed
   */
  acquireScriptLock: function(timeout = 10000) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(timeout);
      return lock;
    } catch (error) {
      AuditLogger.logError('LockManager', `Script lock acquisition error: ${error.toString()}`);
      return null;
    }
  },
  
  /**
   * Release lock safely
   * @param {GoogleAppsScript.Lock.Lock} lock - Lock object to release
   */
  releaseLock: function(lock) {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (error) {
        AuditLogger.logError('LockManager', `Failed to release lock: ${error.toString()}`);
      }
    }
  }
};

// ==================== MASTER DATABASE UTILITIES ====================

/**
 * Master Database utilities for centralized data access
 *
 * PERFORMANCE OPTIMIZATION: File Reference Caching
 * - Caches Master Database file reference during execution
 * - Reduces 50-200ms SpreadsheetApp.openById() overhead per write
 * - For 50 writes: 2.5-10s → <500ms improvement
 */
const MasterDatabaseUtils = {
  // ═══ CACHE ═══
  _cachedMasterFile: null,       // Cached Master Database file reference
  _cacheTimestamp: null,         // When cache was created
  _cacheTTL: 300000,             // Cache TTL: 5 minutes (300,000ms)

  /**
   * Get Master Database spreadsheet ID
   * @returns {string|null} Master Database ID or null if not in master mode
   */
  getMasterDatabaseId: function() {
    return CONFIG.getMasterDatabaseId();
  },

  /**
   * Get Master Database URL
   * @returns {string|null} Master Database URL or null if not in master mode
   */
  getMasterDatabaseUrl: function() {
    return CONFIG.getMasterDatabaseUrl();
  },

  /**
   * Get Master Database spreadsheet object
   * PERFORMANCE: Caches file reference to avoid repeated openById() calls
   * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet|null} Master Database file or null
   * @throws {Error} If Master Database cannot be accessed
   */
  getMasterDatabaseFile: function() {
    if (!CONFIG.isMasterMode()) {
      return null;
    }

    const masterId = this.getMasterDatabaseId();
    if (!masterId) {
      throw new Error('Master Database ID not configured');
    }

    // Check cache validity
    const now = Date.now();
    if (this._cachedMasterFile && this._cacheTimestamp) {
      const cacheAge = now - this._cacheTimestamp;
      if (cacheAge < this._cacheTTL) {
        // Cache hit - return cached file
        return this._cachedMasterFile;
      } else {
        // Cache expired
        this._cachedMasterFile = null;
        this._cacheTimestamp = null;
      }
    }

    // Cache miss - open file and cache it
    try {
      const masterFile = SpreadsheetApp.openById(masterId);
      if (!masterFile) {
        throw new Error(`Cannot open Master Database with ID: ${masterId}`);
      }

      // Cache the file reference
      this._cachedMasterFile = masterFile;
      this._cacheTimestamp = now;

      return masterFile;
    } catch (error) {
      AuditLogger.logError('MasterDatabaseUtils.getMasterDatabaseFile',
        `Failed to access Master Database: ${error.toString()}`);
      throw error;
    }
  },

  /**
   * Clear the cached Master Database file reference
   * Call this if you suspect the file reference is stale
   */
  clearMasterFileCache: function() {
    this._cachedMasterFile = null;
    this._cacheTimestamp = null;
  },

  /**
   * Get a specific sheet from Master Database
   * @param {string} sheetType - Sheet type ('invoice', 'payment', 'audit', 'supplier')
   * @returns {GoogleAppsScript.Spreadsheet.Sheet} Sheet object
   * @throws {Error} If sheet cannot be accessed
   */
  getMasterSheet: function(sheetType) {
    const masterFile = this.getMasterDatabaseFile();
    if (!masterFile) {
      throw new Error('Not in Master Database mode');
    }

    const sheetName = CONFIG.masterDatabase.sheets[sheetType];
    if (!sheetName) {
      throw new Error(`Invalid sheet type: ${sheetType}`);
    }

    const sheet = masterFile.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`Sheet "${sheetName}" not found in Master Database`);
    }

    return sheet;
  },

  /**
   * Build IMPORTRANGE formula for monthly file
   * @param {string} sheetType - Sheet type ('invoice', 'payment', 'audit', 'supplier')
   * @param {string} customRange - Optional custom range (defaults to configured import range)
   * @returns {string} IMPORTRANGE formula
   */
  buildImportFormula: function(sheetType, customRange = null) {
    const masterUrl = this.getMasterDatabaseUrl();
    if (!masterUrl) {
      throw new Error('Master Database URL not configured');
    }

    const sheetName = CONFIG.masterDatabase.sheets[sheetType];
    if (!sheetName) {
      throw new Error(`Invalid sheet type: ${sheetType}`);
    }

    const range = customRange || CONFIG.masterDatabase.importRanges[sheetType];
    if (!range) {
      throw new Error(`No import range configured for sheet type: ${sheetType}`);
    }

    return `=IMPORTRANGE("${masterUrl}", "${sheetName}!${range}")`;
  },

  /**
   * Test Master Database connection
   * @returns {Object} Connection test result
   */
  testConnection: function() {
    const result = {
      success: false,
      mode: CONFIG.masterDatabase.connectionMode,
      errors: [],
      warnings: [],
      sheets: {}
    };

    try {
      // Check if in master mode
      if (!CONFIG.isMasterMode()) {
        result.warnings.push('Not in Master Database mode (connectionMode: local)');
        result.success = true; // Not an error, just local mode
        return result;
      }

      // Check configuration
      const masterId = this.getMasterDatabaseId();
      const masterUrl = this.getMasterDatabaseUrl();

      if (!masterId) {
        result.errors.push('Master Database ID not configured');
      }
      if (!masterUrl) {
        result.errors.push('Master Database URL not configured');
      }

      if (result.errors.length > 0) {
        return result;
      }

      // Test file access
      const masterFile = this.getMasterDatabaseFile();
      if (!masterFile) {
        result.errors.push('Cannot access Master Database file');
        return result;
      }

      result.fileName = masterFile.getName();
      result.fileId = masterFile.getId();

      // Test each sheet
      const sheetTypes = Object.keys(CONFIG.masterDatabase.sheets);
      for (const type of sheetTypes) {
        try {
          const sheet = this.getMasterSheet(type);
          result.sheets[type] = {
            name: sheet.getName(),
            rows: sheet.getLastRow(),
            columns: sheet.getLastColumn(),
            accessible: true
          };
        } catch (error) {
          result.sheets[type] = {
            accessible: false,
            error: error.message
          };
          result.errors.push(`Cannot access ${type} sheet: ${error.message}`);
        }
      }

      // Test IMPORTRANGE formula generation
      try {
        result.sampleFormula = this.buildImportFormula('invoice');
      } catch (error) {
        result.errors.push(`Formula generation failed: ${error.message}`);
      }

      result.success = result.errors.length === 0;
      return result;

    } catch (error) {
      result.errors.push(`Connection test failed: ${error.toString()}`);
      return result;
    }
  },

  /**
   * Get the appropriate sheet for read operations
   * ALWAYS returns local sheet for best performance
   * In master mode, local sheets use IMPORTRANGE to display Master data
   * In local mode, local sheets contain the actual data
   *
   * @param {string} sheetType - Sheet type ('invoice', 'payment', 'audit', 'supplier')
   * @returns {GoogleAppsScript.Spreadsheet.Sheet} Sheet object
   */
  getSourceSheet: function(sheetType) {
    // Always read from local sheets for performance
    // In master mode, these are IMPORTRANGE formulas showing Master data
    // In local mode, these are the actual data sheets
    const sheetNameMap = {
      'invoice': CONFIG.invoiceSheet,
      'payment': CONFIG.paymentSheet,
      'audit': CONFIG.auditSheet,
      'supplier': 'SupplierDatabase'
    };

    const sheetName = sheetNameMap[sheetType];
    if (!sheetName) {
      throw new Error(`Invalid sheet type: ${sheetType}`);
    }

    return SheetUtils.getSheet(sheetName);
  },

  /**
   * Get the appropriate sheet for write operations
   * Returns Master sheet if in master mode, local sheet otherwise
   * @param {string} sheetType - Sheet type ('invoice', 'payment', 'audit', 'supplier')
   * @returns {GoogleAppsScript.Spreadsheet.Sheet} Sheet object
   */
  getTargetSheet: function(sheetType) {
    if (CONFIG.isMasterMode()) {
      return this.getMasterSheet(sheetType);
    }

    // Local mode - use local sheets (same as getSourceSheet)
    return this.getSourceSheet(sheetType);
  }
};

// ==================== PAYMENT HELPERS ====================

/**
 * Get payment method based on payment type
 * @param {string} paymentType - Payment type
 * @returns {string} Payment method
 */
function getPaymentMethod(paymentType) {
  const methods = {
    'Regular': 'Cash',
    'Partial': 'Cash',
    'Due': 'Cash',
    'Unpaid': 'None'
  };
  return methods[paymentType] || 'Cash';
}

/**
 * Check if payment should be processed for transaction
 * @param {Object} data - Transaction data
 * @returns {boolean} True if payment should be logged
 */
function shouldProcessPayment(data) {
  return data.paymentAmt > 0 || data.paymentType === 'Regular';
}

/**
 * Check for duplicate payment by system ID
 * @param {string} sysId - System ID to check
 * @returns {boolean} True if duplicate exists
 */


// ==================== UI HELPERS ====================

/**
 * Set post status and metadata in daily sheet
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
 * @param {number} rowNum - Row number
 * @param {string} status - Status message
 * @param {string} enteredBy - User email (optional)
 * @param {string} timestamp - Formatted timestamp (optional)
 * @param {boolean} keepPostChecked - Whether to keep post checkbox checked (default: true)
 */
function setPostStatus(sheet, rowNum, status, enteredBy, timestamp, keepPostChecked = true) {
  sheet.getRange(rowNum, CONFIG.cols.status + 1).setValue(status);
  
  if (enteredBy) {
    sheet.getRange(rowNum, CONFIG.cols.enteredBy + 1).setValue(enteredBy);
  }
  
  if (timestamp) {
    sheet.getRange(rowNum, CONFIG.cols.timestamp + 1).setValue(timestamp);
  }
  
  // Keep checkbox checked by default (visual confirmation)
  // Only uncheck on errors
  if (!keepPostChecked) {
    sheet.getRange(rowNum, CONFIG.cols.post + 1).setValue(false);
  }
}

/**
 * OPTIMIZED: Batch status update (Single API call)
 * Combines status, user, time, checkbox, and background color
 */
/**
 * Set post status and metadata in daily sheet
 * OPTIMIZED: Reduced from 2 separate function calls to inline operations
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
 * @param {number} row - Row number
 * @param {string} status - Status message
 * @param {string} user - User name
 * @param {string} time - Timestamp string
 * @param {boolean} keepChecked - Keep post checkbox checked
 * @param {string} bgColor - Background color hex code
 */
function setBatchPostStatus(sheet, row, status, user, time, keepChecked, bgColor) {
  const cols = CONFIG.cols;

  // Prepare all values in single array
  const updates = [[keepChecked, status, user, time]];

  // Single batch write (columns: Post checkbox, Status, PostedBy, PostedAt)
  const startCol = cols.post + 1;
  sheet.getRange(row, startCol, 1, 4).setValues(updates);

  // Apply background color to entire row (inline to avoid function call overhead)
  if (bgColor) {
    const totalCols = CONFIG.totalColumns.daily - 4; // A:J Column
    sheet.getRange(row, 1, 1, totalCols).setBackground(bgColor);
  }
}

/**
 * Set background color for entire row
 * NOTE: This function kept for backward compatibility but setBatchPostStatus now inlines this logic
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
 * @param {number} rowNum - Row number
 * @param {string} color - Hex color code
 */
function setRowBackground(sheet, rowNum, color) {
  const totalCols = CONFIG.totalColumns.daily - 4; // A:J Column
  sheet.getRange(rowNum, 1, 1, totalCols).setBackground(color);
}

// ==================== AUDIT LOGGING ====================

/**
 * Log action to audit trail
 * @param {string} action - Action type
 * @param {Object} data - Transaction data
 * @param {string} message - Audit message
 */
function auditAction(action, data, message) {
  try {
    const auditSh = getSheet(CONFIG.auditSheet);
    const auditRow = [
      DateUtils.now(),
      data.enteredBy || 'SYSTEM',
      data.sheetName || 'N/A',
      `Row ${data.rowNum || 'N/A'}`,
      action,
      JSON.stringify({
        supplier: data.supplier,
        invoice: data.invoiceNo,
        prevInvoice: data.prevInvoice,
        receivedAmt: data.receivedAmt,
        paymentAmt: data.paymentAmt,
        paymentType: data.paymentType,
        sysId: data.sysId
      }),
      message
    ];
    
    auditSh.appendRow(auditRow);
  } catch (error) {
    console.error(`[AUDIT ERROR] ${action}: ${message}`, error);
  }
}

/**
 * Log system error to audit trail
 * @param {string} context - Error context/location
 * @param {string} message - Error message
 */
function logSystemError(context, message) {
  try {
    const auditSh = getSheet(CONFIG.auditSheet);
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
    // Fallback to console if audit sheet is unavailable
    console.error(`[SYSTEM ERROR] ${context}: ${message}`);
  }
}

// ==================== BACKWARD COMPATIBILITY ====================

/**
 * Backward compatibility wrappers for legacy code
 */
function generateUUID() {
  return IDGenerator.generateUUID();
}

function getSheet(name) {
  return SheetUtils.getSheet(name);
}

function formatTime(date) {
  return DateUtils.formatTime(date);
}

function normalizeString(str) {
  return StringUtils.normalize(str);
}

/**
 * Get current user email with reliable fallback
 * @returns {string} User email address
 */
function getCurrentUserEmail() {
  return UserResolver.getCurrentUser();
}

/**
 * Get Master Database URL
 * @returns {string|null} Master Database URL or null
 */
function getMasterDatabaseUrl() {
  return MasterDatabaseUtils.getMasterDatabaseUrl();
}

/**
 * Get Master Database ID
 * @returns {string|null} Master Database ID or null
 */
function getMasterDatabaseId() {
  return MasterDatabaseUtils.getMasterDatabaseId();
}

/**
 * Build IMPORTRANGE formula for Master Database
 * @param {string} sheetType - Sheet type ('invoice', 'payment', 'audit', 'supplier')
 * @param {string} customRange - Optional custom range
 * @returns {string} IMPORTRANGE formula
 */
function buildMasterImportFormula(sheetType, customRange = null) {
  return MasterDatabaseUtils.buildImportFormula(sheetType, customRange);
}

/**
 * Test Master Database connection
 * @returns {Object} Connection test result
 */
function testMasterConnection() {
  return MasterDatabaseUtils.testConnection();
}