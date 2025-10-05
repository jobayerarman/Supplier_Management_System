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

// Backward compatibility functions
function getSheet(name) {
  return SheetUtils.getSheet(name);
}

function generateUUID() {
  return IDGenerator.generateUUID();
}

function formatTime(date) {
  return DateUtils.formatTime(date);
}

function normalizeString(str) {
  return StringUtils.normalize(str);
}