// ==================== MODULE: Config.gs ====================
/**
 * 
 * 
*/

/**
 * Enhanced configuration object with validation
 */
const CONFIG = {
  // Sheet names
  dailySheets: ['01','02','03','04','05','06','07','08','09','10',
                '11','12','13','14','15','16','17','18','19','20',
                '21','22','23','24','25','26','27','28','29','30','31'],
  invoiceSheet: 'InvoiceDatabase',
  paymentSheet: 'PaymentLog',
  supplierLedger: 'SupplierLedger',
  auditSheet: 'AuditLog',
  supplierList: 'SupplierList',
  idColHeader: 'SYS_ID',

  // Daily sheet column mappings (0-based indices)
  cols: {
    supplier: 1,        // B
    invoiceNo: 2,       // C
    receivedAmt: 3,     // D
    paymentType: 4,     // E
    paymentAmt: 5,      // F
    prevInvoice: 6,     // G (reference invoice for Due payments)
    balance: 7,         // H (CURRENT BALANCE column)
    notes: 8,           // I
    commit: 9,          // J (checkbox)
    status: 10,         // K
    enteredBy: 11,      // L
    timestamp: 12,      // M
    sysId: 13           // N
  },
  
  // Invoice sheet column mappings (0-based indices)
  invoiceCols: {
    date: 0,              // A
    supplier: 1,          // B
    invoiceNo: 2,         // C
    invoiceDate: 3,       // D (NEW - actual receive date)
    totalAmount: 4,       // E
    totalPaid: 5,         // F (formula)
    balanceDue: 6,        // G (formula)
    status: 7,            // H (formula)
    paidDate: 8,          // I (NEW - formula)
    originDay: 9,         // J
    daysOutstanding: 10,  // K (formula)
    sysId: 11             // L
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
    sysId: 10           // K
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
  
  // Business rules
  rules: {
    MAX_TRANSACTION_AMOUNT: 1000000,
    CACHE_TTL_MS: 30000,
    LOCK_TIMEOUT_MS: 30000,
    MAX_INVOICE_NO_LENGTH: 50,
    SUPPORTED_PAYMENT_TYPES: ['Unpaid', 'Regular', 'Partial', 'Due'],
    SUPPORTED_PAYMENT_METHODS: ['Cash', 'Check', 'Bank Transfer', 'None'],
    DEFAULT_PAYMENT_METHOD: 'Cash'
  },
  
  // UI Colors
  colors: {
    success: '#E8F5E8',      // Light green
    error: '#FFEBEE',        // Light red
    warning: '#FFF4E6',      // Light orange
    info: '#E3F2FD',         // Light blue
    neutral: '#F5F5F5'       // Light gray
  },
  
  // Total columns in each sheet
  totalColumns: {
    daily: 14,          // A through N
    invoice: 12,        // A through L
    payment: 11,        // A through K
    ledger: 4,          // A through D
    audit: 7            // A through G
  },
  
  // Validation state
  _isValidated: false,
  _validationErrors: [],
  _validationWarnings: [],
  
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
          const requiredHeaders = ['Date', 'Supplier', 'Invoice No', 'Total Amount', 'Total Paid', 'Balance Due', 'Status', 'Origin Day', 'Days Outstanding', 'SYS_ID'];
          
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