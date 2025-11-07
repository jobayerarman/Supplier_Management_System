// ==================== MODULE: Config.gs ====================
/**
 * 
 * 
*/

/**
 * Enhanced configuration object with validation
 */
const CONFIG = {
  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════════
  // Shared constants used across multiple modules (PaymentManager, BalanceCalculator, etc.)

  constants: {
    // Balance calculation constants
    BALANCE_TOLERANCE: 0.01,              // Tolerance for floating point balance comparison
    VALID_BALANCE_MIN: 0,                 // Minimum valid balance value
    FULLY_PAID_THRESHOLD: 0.01,           // Threshold for considering invoice fully paid

    // Sheet data structure constants
    HEADER_ROW_COUNT: 1,                  // Number of header rows in sheet arrays
    HEADER_ROW_INDEX: 0,                  // Index of header row in data array (0-based)
    FIRST_DATA_ROW_INDEX: 1,              // Index of first data row in array (0-based)
    MIN_ROWS_WITH_DATA: 2                 // Minimum rows required (header + at least 1 data row)
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET NAMES
  // ═══════════════════════════════════════════════════════════════════════════

  dailySheets: ['01','02','03','04','05','06','07','08','09','10',
                '11','12','13','14','15','16','17','18','19','20',
                '21','22','23','24','25','26','27','28','29','30','31'],
  invoiceSheet: 'InvoiceDatabase',
  paymentSheet: 'PaymentLog',
  supplierLedger: 'SupplierLedger',
  auditSheet: 'AuditLog',
  supplierList: 'SupplierList',
  idColHeader: 'SYS_ID',

  // ═══════════════════════════════════════════════════════════════════════════
  // MASTER DATABASE CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  masterDatabase: {
    // Connection mode: 'local' (current monthly file) or 'master' (central database)
    connectionMode: 'local',  // Change to 'master' to enable Master Database writes

    // Master database file identification (to be filled in during setup)
    id: '',  // Spreadsheet ID from URL: https://docs.google.com/spreadsheets/d/{ID}/edit
    url: '', // Full spreadsheet URL

    // Master database sheet names (must match actual sheet names in Master file)
    sheets: {
      invoice: 'InvoiceDatabase',
      payment: 'PaymentLog',
      audit: 'AuditLog',
      supplier: 'SupplierDatabase'
    },

    // Import ranges for monthly files (used when building IMPORTRANGE formulas)
    importRanges: {
      invoice: 'A:M',      // All invoice columns
      payment: 'A:L',      // All payment columns
      audit: 'A:G',        // All audit columns
      supplier: 'A:D'      // All supplier columns
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET STRUCTURE
  // ═══════════════════════════════════════════════════════════════════════════

  dataStartRow: 7,        // First row of data in daily sheets (0-based would be 6)

  // ═══════════════════════════════════════════════════════════════════════════
  // COLUMN MAPPINGS
  // ═══════════════════════════════════════════════════════════════════════════

  // Daily sheet column mappings (0-based indices)
  cols: {
    supplier: 1,        // B
    invoiceNo: 2,       // C
    receivedAmt: 3,     // D
    paymentType: 4,     // E
    prevInvoice: 5,     // F (reference invoice for Due payments)
    paymentAmt: 6,      // G
    balance: 7,         // H (CURRENT BALANCE column)
    notes: 8,           // I
    post: 9,            // J (checkbox)
    status: 10,         // K
    enteredBy: 11,      // L
    timestamp: 12,      // M
    sysId: 13           // N
  },
  
  // Invoice sheet column mappings (0-based indices)
  // Structure matches paymentCols pattern: identifiers → business data → metadata → system
  invoiceCols: {
    // Core identifiers
    invoiceDate: 0,       // A - actual invoice receive date
    supplier: 1,          // B
    invoiceNo: 2,         // C

    // Invoice-specific data
    totalAmount: 3,       // D
    totalPaid: 4,         // E (formula)
    balanceDue: 5,        // F (formula)
    status: 6,            // G (formula)
    paidDate: 7,          // H (formula)
    daysOutstanding: 8,   // I (formula)

    // Metadata
    originDay: 9,         // J
    enteredBy: 10,        // K
    timestamp: 11,        // L

    // System fields
    sysId: 12             // M
  },
  
  // Payment sheet column mappings (0-based indices)
  paymentCols: {
    date: 0,            // A
    supplier: 1,        // B
    invoiceNo: 2,       // C
    paymentType: 3,     // D
    amount: 4,          // E
    method: 5,          // F
    reference: 6,       // G
    fromSheet: 7,       // H
    enteredBy: 8,       // I
    timestamp: 9,       // J
    sysId: 10,          // K
    invoiceId: 11       // L
  },
  
  // Ledger sheet column mappings (0-based indices)
  ledgerCols: {
    supplier: 0,        // A
    outstanding: 1,     // B
    lastUpdated: 2,     // C
    status: 3           // D
  },
  
  // Audit sheet column mappings
  auditCols: {
    timestamp: 0,       // A
    user: 1,            // B
    sheet: 2,           // C
    location: 3,        // D
    action: 4,          // E
    details: 5,         // F
    message: 6          // G
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BUSINESS RULES
  // ═══════════════════════════════════════════════════════════════════════════

  rules: {
    MAX_TRANSACTION_AMOUNT: 1000000,
    CACHE_TTL_MS: 60000,
    LOCK_TIMEOUT_MS: 30000,
    MAX_INVOICE_NO_LENGTH: 50,
    SUPPORTED_PAYMENT_TYPES: ['Unpaid', 'Regular', 'Partial', 'Due'],
    SUPPORTED_PAYMENT_METHODS: ['Cash', 'Check', 'Bank Transfer', 'None'],
    DEFAULT_PAYMENT_METHOD: 'Cash'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // UI COLORS
  // ═══════════════════════════════════════════════════════════════════════════

  colors: {
    success: '#E8F5E8',      // Light green
    error: '#FFEBEE',        // Light red
    warning: '#FFF4E6',      // Light orange
    processing: '#FFF9C4',   // Light yellow (for in-progress operations)
    info: '#E3F2FD',         // Light blue
    neutral: '#F5F5F5'       // Light gray
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TOTAL COLUMNS
  // ═══════════════════════════════════════════════════════════════════════════

  totalColumns: {
    daily: 14,          // A through N
    invoice: 13,        // A through M (added enteredBy column)
    payment: 12,        // A through L
    ledger: 4,          // A through D
    audit: 7            // A through G
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION STATE
  // ═══════════════════════════════════════════════════════════════════════════

  _isValidated: false,
  _validationErrors: [],
  _validationWarnings: [],

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate configuration on initialization
   * @returns {Object} Validation result with valid flag and errors
   */
  validate: function() {
    if (this._isValidated) {
      return { valid: true, errors: [], warnings: this._validationWarnings };
    }
    
    const errors = [];
    const warnings = [];
    
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      
      // === 1. Check required sheets exist ===
      const requiredSheets = [
        this.invoiceSheet,
        this.paymentSheet,
        this.supplierLedger,
        this.auditSheet,
        this.supplierList
      ];
      
      const missingSheets = requiredSheets.filter(name => !ss.getSheetByName(name));
      if (missingSheets.length > 0) {
        errors.push(`Missing required sheets: ${missingSheets.join(', ')}`);
      }
      
      // === 2. Check daily sheets ===
      const missingDailySheets = this.dailySheets.filter(name => !ss.getSheetByName(name));
      if (missingDailySheets.length > 0) {
        warnings.push(`Missing daily sheets: ${missingDailySheets.join(', ')}`);
      }
      
      // === 3. Validate column configurations ===
      if (Object.keys(this.cols).length + 1 !== this.totalColumns.daily) {
        warnings.push(`Daily sheet column count mismatch: ${Object.keys(this.cols).length + 1} defined vs ${this.totalColumns.daily} expected`);
      }
      
      if (Object.keys(this.invoiceCols).length !== this.totalColumns.invoice) {
        warnings.push(`Invoice sheet column count mismatch: ${Object.keys(this.invoiceCols).length} defined vs ${this.totalColumns.invoice} expected`);
      }
      
      // === 4. Validate sheet headers (if sheets exist) ===
      if (!missingSheets.includes(this.invoiceSheet)) {
        const invoiceSh = ss.getSheetByName(this.invoiceSheet);
        if (invoiceSh.getLastRow() > 0) {
          const headers = invoiceSh.getRange(1, 1, 1, this.totalColumns.invoice).getValues()[0];
          const requiredHeaders = ['Invoice Date', 'Supplier', 'Invoice No', 'Total Amount', 'Total Paid', 'Balance Due', 'Status', 'Paid Date', 'Days Outstanding', 'Origin Day', 'Entered By', 'Timestamp', 'SYS_ID'];

          requiredHeaders.forEach((header, i) => {
            if (!headers[i] || !StringUtils.equals(headers[i], header)) {
              warnings.push(`Invoice sheet header mismatch at column ${i + 1}: expected "${header}", found "${headers[i] || '(empty)'}"`);
            }
          });
        }
      }
      
      // === 5. Validate business rules ===
      if (this.rules.MAX_TRANSACTION_AMOUNT <= 0) {
        errors.push('MAX_TRANSACTION_AMOUNT must be positive');
      }

      if (this.rules.CACHE_TTL_MS <= 0) {
        errors.push('CACHE_TTL_MS must be positive');
      }

      // === 6. Validate Master Database configuration ===
      if (this.masterDatabase.connectionMode === 'master') {
        if (!this.masterDatabase.id || this.masterDatabase.id.trim() === '') {
          errors.push('Master Database ID is required when connectionMode is "master"');
        }
        if (!this.masterDatabase.url || this.masterDatabase.url.trim() === '') {
          errors.push('Master Database URL is required when connectionMode is "master"');
        }

        // Validate Master Database accessibility
        if (this.masterDatabase.id && this.masterDatabase.id.trim() !== '') {
          try {
            const masterFile = SpreadsheetApp.openById(this.masterDatabase.id);
            if (!masterFile) {
              errors.push('Cannot access Master Database file with provided ID');
            } else {
              // Validate that required sheets exist in Master
              const requiredMasterSheets = Object.values(this.masterDatabase.sheets);
              const missingMasterSheets = requiredMasterSheets.filter(name => !masterFile.getSheetByName(name));
              if (missingMasterSheets.length > 0) {
                errors.push(`Missing sheets in Master Database: ${missingMasterSheets.join(', ')}`);
              }
            }
          } catch (error) {
            errors.push(`Cannot access Master Database: ${error.message}`);
          }
        }
      } else if (this.masterDatabase.connectionMode !== 'local') {
        warnings.push(`Invalid connectionMode "${this.masterDatabase.connectionMode}", must be "local" or "master". Defaulting to "local".`);
        this.masterDatabase.connectionMode = 'local';
      }
      
      this._validationErrors = errors;
      this._validationWarnings = warnings;
      this._isValidated = errors.length === 0;
      
      if (errors.length > 0) {
        Logger.log('=== CONFIG VALIDATION ERRORS ===');
        errors.forEach(err => Logger.log(`  ❌ ${err}`));
      }
      
      if (warnings.length > 0) {
        Logger.log('=== CONFIG VALIDATION WARNINGS ===');
        warnings.forEach(warn => Logger.log(`  ⚠️ ${warn}`));
      }
      
      if (errors.length === 0) {
        Logger.log('✅ CONFIG validation passed');
      }
      
      return { 
        valid: this._isValidated, 
        errors: errors,
        warnings: warnings
      };
      
    } catch (error) {
      const errorMsg = `Configuration validation failed: ${error.toString()}`;
      Logger.log(`❌ ${errorMsg}`);
      this._validationErrors = [errorMsg];
      return { valid: false, errors: [errorMsg], warnings: [] };
    }
  },
  
  /**
   * Get column letter from index (0-based)
   * @param {number} index - Column index (0-based)
   * @returns {string} Column letter
   */
  getColumnLetter: function(index) {
    let letter = '';
    let num = index;
    while (num >= 0) {
      letter = String.fromCharCode((num % 26) + 65) + letter;
      num = Math.floor(num / 26) - 1;
    }
    return letter;
  },
  
  /**
   * Get column index from letter
   * @param {string} letter - Column letter
   * @returns {number} Column index (0-based)
   */
  getColumnIndex: function(letter) {
    let index = 0;
    for (let i = 0; i < letter.length; i++) {
      index = index * 26 + (letter.toUpperCase().charCodeAt(i) - 64);
    }
    return index - 1;
  },
  
  /**
   * Check if payment type is valid
   * @param {string} type - Payment type to validate
   * @returns {boolean} True if valid
   */
  isValidPaymentType: function(type) {
    return this.rules.SUPPORTED_PAYMENT_TYPES.includes(type);
  },
  
  /**
   * Get default payment method for payment type
   * @param {string} paymentType - Payment type
   * @returns {string} Default payment method
   */
  getDefaultPaymentMethod: function(paymentType) {
    if (paymentType === 'Unpaid') {
      return 'None';
    }
    return this.rules.DEFAULT_PAYMENT_METHOD;
  },
  
  /**
   * Export configuration as JSON
   * @returns {Object} Configuration object
   */
  export: function() {
    return {
      sheets: {
        invoice: this.invoiceSheet,
        payment: this.paymentSheet,
        ledger: this.supplierLedger,
        audit: this.auditSheet,
        supplierList: this.supplierList,
        daily: this.dailySheets
      },
      columns: {
        daily: this.cols,
        invoice: this.invoiceCols,
        payment: this.paymentCols,
        ledger: this.ledgerCols,
        audit: this.auditCols
      },
      rules: this.rules,
      colors: this.colors,
      validated: this._isValidated,
      errors: this._validationErrors,
      warnings: this._validationWarnings
    };
  },
  
  /**
   * Get configuration summary for display
   * @returns {string} Formatted configuration summary
   */
  getSummary: function() {
    const summary = [];
    summary.push('=== CONFIGURATION SUMMARY ===');
    summary.push(`Validated: ${this._isValidated ? '✅ Yes' : '❌ No'}`);
    summary.push(`Errors: ${this._validationErrors.length}`);
    summary.push(`Warnings: ${this._validationWarnings.length}`);
    summary.push('');
    summary.push('Database Mode:');
    summary.push(`  - Connection Mode: ${this.masterDatabase.connectionMode.toUpperCase()}`);
    if (this.masterDatabase.connectionMode === 'master') {
      summary.push(`  - Master Database ID: ${this.masterDatabase.id || '(not configured)'}`);
      summary.push(`  - Master Database URL: ${this.masterDatabase.url ? 'configured' : '(not configured)'}`);
    }
    summary.push('');
    summary.push('Required Sheets:');
    summary.push(`  - Invoice: ${this.invoiceSheet}`);
    summary.push(`  - Payment: ${this.paymentSheet}`);
    summary.push(`  - Ledger: ${this.supplierLedger}`);
    summary.push(`  - Audit: ${this.auditSheet}`);
    summary.push(`  - Supplier List: ${this.supplierList}`);
    summary.push(`  - Daily Sheets: ${this.dailySheets.length} sheets`);
    summary.push('');
    summary.push('Business Rules:');
    summary.push(`  - Max Transaction: ${this.rules.MAX_TRANSACTION_AMOUNT}`);
    summary.push(`  - Cache TTL: ${this.rules.CACHE_TTL_MS}ms`);
    summary.push(`  - Lock Timeout: ${this.rules.LOCK_TIMEOUT_MS}ms`);
    summary.push(`  - Max Invoice Length: ${this.rules.MAX_INVOICE_NO_LENGTH}`);
    return summary.join('\n');
  },

  /**
   * Check if Master Database mode is enabled
   * @returns {boolean} True if using Master Database
   */
  isMasterMode: function() {
    return this.masterDatabase.connectionMode === 'master';
  },

  /**
   * Get Master Database spreadsheet ID
   * @returns {string|null} Master Database ID or null if not configured
   */
  getMasterDatabaseId: function() {
    if (!this.isMasterMode()) return null;
    return this.masterDatabase.id || null;
  },

  /**
   * Get Master Database URL
   * @returns {string|null} Master Database URL or null if not configured
   */
  getMasterDatabaseUrl: function() {
    if (!this.isMasterMode()) return null;
    return this.masterDatabase.url || null;
  }
};

/**
 * Initialize configuration on script load
 * Call this manually or automatically depending on your needs
 */
function initializeConfiguration() {
  const result = CONFIG.validate();
  if (!result.valid) {
    const ui = SpreadsheetApp.getUi();
    ui.alert(
      'Configuration Error',
      'The spreadsheet configuration has errors:\n\n' + 
      result.errors.join('\n') +
      '\n\nPlease contact the administrator.',
      ui.ButtonSet.OK
    );
    throw new Error('Configuration validation failed');
  }
  
  if (result.warnings.length > 0) {
    Logger.log('Configuration initialized with warnings');
  } else {
    Logger.log('Configuration initialized successfully');
  }
  
  return result;
}