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
 * Get the date from cell A3 of a daily sheet
 * @param {string} sheetName - Daily sheet name (01-31)
 * @returns {Date|null} Date from A3 or null
 */
function getDailySheetDate(sheetName) {
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
    AuditLogger.logError('getDailySheetDate', 
      `Failed to get date from sheet ${sheetName}: ${error.toString()}`);
    return null;
  }
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
function setBatchPostStatus(sheet, row, status, user, time, keepChecked, bgColor) {
  const cols = CONFIG.cols;
  
  // Prepare all values in single array
  const updates = [[keepChecked, status, user, time]];
  
  // Single batch write (columns: Post checkbox, Status, PostedBy, PostedAt)
  const startCol = cols.post + 1;
  const range = sheet.getRange(row, startCol, 1, 4);
  range.setValues(updates);
  
  // Apply background color to entire row
  if (bgColor) {
    setRowBackground(sheet, row, bgColor)
  }
}

/**
 * Set background color for entire row
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