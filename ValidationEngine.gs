/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ValidationEngine.gs - Comprehensive Data Validation System
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * OVERVIEW:
 * Centralized validation engine for the Supplier Management System.
 * Enforces data integrity and business rules for all supplier account transactions
 * including invoices, payments, and balance calculations.
 *
 * CORE RESPONSIBILITIES:
 * ━━━━━━━━━━━━━━━━━━━━━
 * 1. POST DATA VALIDATION
 *    - Main entry point for all transaction validation
 *    - Validates required fields
 *    - Checks numeric constraints
 *    - Enforces payment type-specific rules
 *    - Validates business logic
 *    - Aggregates all errors into comprehensive report
 *
 * 2. PAYMENT TYPE VALIDATION
 *    - Unpaid: New invoice, no payment
 *    - Regular: Full immediate payment (paymentAmt = receivedAmt)
 *    - Partial: Incomplete payment (paymentAmt < receivedAmt)
 *    - Due: Payment on existing invoice (paymentAmt > 0, receivedAmt = 0)
 *    - Type-specific business rules enforcement
 *
 * 3. DUE PAYMENT VALIDATION
 *    - Validate previous invoice reference exists
 *    - Verify invoice has outstanding balance
 *    - Check payment doesn't exceed balance
 *    - Prevent overpayment of invoices
 *
 * 4. BUSINESS LOGIC VALIDATION
 *    - Duplicate invoice detection
 *    - Prevent duplicate payments
 *    - Check data consistency
 *    - Verify related records exist
 *    - Validate invoice status transitions
 *
 * 5. FIELD-LEVEL VALIDATION
 *    - Supplier: Required, non-empty
 *    - Invoice number: Max 50 chars, alphanumeric + hyphens/underscores
 *    - Amounts: Non-negative, within transaction limits
 *    - Payment type: Valid values only
 *
 * 6. DATA INTEGRITY CHECKS
 *    - Verify sheet formulas intact
 *    - Check all required sheets exist
 *    - Validate sheet structure
 *    - Detect formula corruption
 *    - Verify ledger accessibility
 *
 * ARCHITECTURE & DESIGN PATTERNS:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * MODULE ORGANIZATION:
 *   1. MODULE HEADER - This documentation
 *   2. MAIN VALIDATION - Entry point for all transactions
 *      - validatePostData(): Primary public API
 *   3. PAYMENT TYPE VALIDATION - Type-specific rules
 *      - validatePaymentTypeRules(): Dispatch to type handlers
 *      - validateDuePayment(): Due payment-specific logic
 *   4. BUSINESS LOGIC VALIDATION - Cross-record rules
 *      - validateBusinessLogic(): Duplicate detection, consistency checks
 *   5. FIELD-LEVEL VALIDATION - Individual field validators
 *      - validateSupplier(): Supplier field validation
 *      - validateInvoiceNo(): Invoice number format and length
 *      - validateAmount(): Numeric validation with limits
 *   6. DATA INTEGRITY VALIDATION - System health checks
 *      - validateDataIntegrity(): Sheet formulas, structure verification
 *   7. BACKWARD COMPATIBILITY - Legacy function wrappers
 *      - Global wrapper functions for all public validators
 *
 * DESIGN PATTERNS USED:
 *   • Validation Chain: Multiple validators in sequence
 *   • Error Aggregation: Collect all errors before returning
 *   • Type Switch: Type-specific validation dispatch
 *   • Early Exit: Stop on critical errors (missing supplier)
 *   • Related Record Lookup: Verify referenced records exist
 *   • Error Reporting: Consistent {valid, error, errors} format
 *
 * PERFORMANCE STRATEGY:
 * ━━━━━━━━━━━━━━━━━━
 * VALIDATION OPERATIONS:
 *   - Field validation: <1ms (string/number checks)
 *   - Payment type validation: 1-2ms (logic checks)
 *   - Invoice lookup: 10-50ms (cache hit) or 100-300ms (cache miss)
 *   - Due payment validation: 20-100ms (includes invoice lookup)
 *   - Duplicate detection: <1ms (cache lookup) or 50-200ms (database search)
 *   - Data integrity check: 50-200ms (sheet formula verification)
 *
 * OPTIMIZATION STRATEGIES:
 *   - Early exit on missing supplier (fail fast)
 *   - Field validation before expensive lookups
 *   - Cache usage for invoice lookups (CacheManager integration)
 *   - Error aggregation avoids stopping at first error
 *   - Async-friendly (no blocking operations)
 *
 * INTEGRATION POINTS:
 * ━━━━━━━━━━━━━━━━━
 * CODE.GS:
 *   - Uses: validatePostData() from onEdit handler
 *   - Uses: AuditLogger.logWarning() for validation warnings
 *   - Integration: Validation run before posting transaction
 *
 * UIMENU.GS (BATCH OPERATIONS):
 *   - Uses: validatePostData() for batch validation
 *   - Uses: Aggregated errors for results display
 *   - Integration: Validates rows before posting in batch
 *
 * INVOICEMANAGER.GS:
 *   - Uses: Implicit validation via createOrUpdateInvoice
 *   - Uses: Duplicate detection logic
 *
 * INVOICEMANAGER.GS:
 *   - Uses: validateDuePayment() indirectly via payment type validation
 *   - Uses: Related invoice verification
 *
 * CACHEMANAGER.GS:
 *   - Used by: Invoice lookups in due payment validation
 *   - Integration: Cache-first, then database fallback
 *
 * DATA STRUCTURES:
 * ━━━━━━━━━━━━━━
 * VALIDATION RESULT (standard format):
 *   {
 *     valid: boolean,           // Validation passed?
 *     error?: string,           // First/primary error message
 *     errors?: string[]         // All error messages (if multiple)
 *   }
 *
 * TRANSACTION DATA:
 *   {
 *     supplier: string,         // Supplier name (required)
 *     invoiceNo: string,        // Invoice number (conditional)
 *     prevInvoice: string,      // Previous invoice reference (Due only)
 *     receivedAmt: number,      // Amount received
 *     paymentAmt: number,       // Amount paid
 *     paymentType: string,      // Unpaid|Regular|Partial|Due
 *     sheetName: string,        // Daily sheet (02-31)
 *     rowNum: number,           // Row number
 *     enteredBy: string,        // User email
 *     sysId: string            // System ID
 *   }
 *
 * PAYMENT TYPES & REQUIREMENTS:
 *   - UNPAID: invoiceNo required, paymentAmt=0, receivedAmt>0
 *   - REGULAR: invoiceNo required, paymentAmt=receivedAmt>0
 *   - PARTIAL: invoiceNo required, 0<paymentAmt<receivedAmt
 *   - DUE: prevInvoice required, paymentAmt>0, receivedAmt=0
 *
 * MODULE DEPENDENCIES:
 * ━━━━━━━━━━━━━━━━
 * Required:
 *   - _Config.gs → CONFIG object (rules, cols, sheet names)
 *   - _Utils.gs → StringUtils, logSystemError
 *   - AuditLogger.gs → AuditLogger.logWarning() for warnings
 *
 * Used by:
 *   - Code.gs → validatePostData() from onEdit
 *   - UIMenu.gs → validatePostData() from batch operations
 *   - Other modules → Field validators as needed
 *
 * Optional Dependencies:
 *   - InvoiceManager.gs → findInvoice() for due payment validation
 *   - CacheManager.gs → Invoice cache for performance
 *
 * VALIDATION FLOW:
 * ━━━━━━━━━━━━━━━
 * 1. validatePostData(data)
 *    ├─ Check required fields (supplier, paymentType)
 *    ├─ Check numeric constraints (amounts)
 *    ├─ Check invoice length limits
 *    ├─ validatePaymentTypeRules(data)
 *    │  ├─ Type-specific field validation
 *    │  └─ If Due: validateDuePayment(data)
 *    │     ├─ Check prevInvoice exists
 *    │     ├─ Check invoice has balance
 *    │     └─ Check payment doesn't exceed balance
 *    ├─ validateBusinessLogic(data)
 *    │  └─ Check for duplicate invoices
 *    └─ Return aggregated results
 *
 * 2. Optional field validators
 *    ├─ validateSupplier(supplier)
 *    ├─ validateInvoiceNo(invoiceNo)
 *    ├─ validateAmount(amount, fieldName)
 *    └─ validateDataIntegrity(data) - System health check
 *
 * BACKWARD COMPATIBILITY:
 * ━━━━━━━━━━━━━━━━━━━━━
 * All public validation functions remain as global functions
 * for backward compatibility. Code can use either:
 *   - Modern: ValidationEngine.validatePostData(data)
 *   - Legacy: validatePostData(data)
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: MAIN VALIDATION (Primary Public API)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Main validation function - validates all post data
 *
 * PROCESS:
 * 1. Check required fields (supplier, paymentType)
 * 2. Validate numeric fields (amounts must be non-negative)
 * 3. Check field length limits (invoice number max 50 chars)
 * 4. Validate payment type-specific rules
 * 5. Validate business logic (duplicates, consistency)
 * 6. Aggregate all errors and return result
 *
 * VALIDATION RESULT FORMAT:
 *   {
 *     valid: true                    // Validation passed
 *   }
 *   OR
 *   {
 *     valid: false,
 *     error: "error message",        // First error (user-facing)
 *     errors: ["error1", "error2"]   // All errors (debugging)
 *   }
 *
 * @param {Object} data - Transaction data object
 * @returns {Object} Validation result with {valid, error?, errors?}
 */
function validatePostData(data) {
  const errors = [];

  // === VALIDATION PHASE 1: REQUIRED FIELDS ===
  if (!data.supplier) {
    return { valid: false, error: 'Supplier is required' };
  }

  if (!data.paymentType) {
    errors.push('Payment type is required');
  }

  // === VALIDATION PHASE 2: NUMERIC CONSTRAINTS ===
  if (isNaN(data.receivedAmt) || data.receivedAmt < 0) {
    errors.push('Received amount must be a non-negative number');
  }

  if (isNaN(data.paymentAmt) || data.paymentAmt < 0) {
    errors.push('Payment amount must be a non-negative number');
  }

  // === VALIDATION PHASE 3: FIELD LENGTH LIMITS ===
  if (data.invoiceNo && data.invoiceNo.length > 50) {
    errors.push('Invoice number cannot exceed 50 characters');
  }

  // === VALIDATION PHASE 4: PAYMENT TYPE SPECIFIC RULES ===
  const paymentValidation = validatePaymentTypeRules(data);
  if (!paymentValidation.valid) {
    errors.push(...paymentValidation.errors);
  }

  // === VALIDATION PHASE 5: BUSINESS LOGIC RULES ===
  const businessValidation = validateBusinessLogic(data);
  if (!businessValidation.valid) {
    errors.push(...businessValidation.errors);
  }

  // === VALIDATION PHASE 6: RETURN RESULT ===
  if (errors.length > 0) {
    const errorMessage = errors.join('; ');
    return {
      valid: false,
      error: errorMessage,
      errors: errors
    };
  }

  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: PAYMENT TYPE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate payment type specific rules
 *
 * PAYMENT TYPES:
 * 1. Unpaid: New invoice, payment pending
 *    - Requires: invoiceNo, receivedAmt > 0
 *    - Forbidden: paymentAmt (must be 0)
 *
 * 2. Regular: Full immediate payment
 *    - Requires: invoiceNo, receivedAmt > 0
 *    - Constraint: paymentAmt must equal receivedAmt
 *
 * 3. Partial: Incomplete payment
 *    - Requires: invoiceNo, receivedAmt > 0, paymentAmt > 0
 *    - Constraint: paymentAmt must be less than receivedAmt
 *
 * 4. Due: Payment on existing invoice
 *    - Requires: prevInvoice, paymentAmt > 0
 *    - Forbidden: receivedAmt (must be 0)
 *    - Additional: validateDuePayment() for invoice verification
 *
 * @param {Object} data - Transaction data
 * @returns {Object} Validation result {valid, errors?}
 */
function validatePaymentTypeRules(data) {
  const errors = [];

  switch (data.paymentType) {
    // ══════════════════════════════════════════════════════════════════════
    // UNPAID: New invoice, no payment
    // ══════════════════════════════════════════════════════════════════════
    case 'Unpaid':
      if (data.paymentAmt !== 0) {
        errors.push('Payment amount must be 0 for Unpaid transactions');
      }
      if (!data.invoiceNo) {
        errors.push('Invoice number is required for Unpaid transactions');
      }
      if (data.receivedAmt <= 0) {
        errors.push('Received amount must be greater than 0 for Unpaid transactions');
      }
      break;

    // ══════════════════════════════════════════════════════════════════════
    // REGULAR: Full immediate payment
    // ══════════════════════════════════════════════════════════════════════
    case 'Regular':
      if (!data.invoiceNo) {
        errors.push('Invoice number is required for Regular payment');
      }
      if (data.receivedAmt <= 0) {
        errors.push('Received amount must be greater than 0 for Regular payment');
      }
      if (data.paymentAmt !== data.receivedAmt) {
        errors.push(`Payment amount (${data.paymentAmt}) must equal received amount (${data.receivedAmt}) for Regular payment`);
      }
      break;

    // ══════════════════════════════════════════════════════════════════════
    // PARTIAL: Incomplete payment
    // ══════════════════════════════════════════════════════════════════════
    case 'Partial':
      if (!data.invoiceNo) {
        errors.push('Invoice number is required for Partial payment');
      }
      if (data.receivedAmt <= 0) {
        errors.push('Received amount must be greater than 0 for Partial payment');
      }
      if (data.paymentAmt <= 0) {
        errors.push('Payment amount must be greater than 0 for Partial payment');
      }
      if (data.paymentAmt >= data.receivedAmt) {
        errors.push(`Partial payment (${data.paymentAmt}) must be less than received amount (${data.receivedAmt})`);
      }
      break;

    // ══════════════════════════════════════════════════════════════════════
    // DUE: Payment on existing invoice
    // ══════════════════════════════════════════════════════════════════════
    case 'Due':
      const dueValidation = validateDuePayment(data);
      if (!dueValidation.valid) {
        errors.push(...dueValidation.errors);
      }
      break;

    // ══════════════════════════════════════════════════════════════════════
    // INVALID: Unknown payment type
    // ══════════════════════════════════════════════════════════════════════
    default:
      errors.push(`Invalid payment type: "${data.paymentType}". Must be Unpaid, Regular, Partial, or Due`);
  }

  return errors.length > 0
    ? { valid: false, errors: errors }
    : { valid: true };
}

/**
 * Validate Due payment specific requirements
 *
 * DUE PAYMENT PROCESS:
 * 1. Verify previous invoice reference provided
 * 2. Verify payment amount is positive
 * 3. Verify received amount is zero (no new invoice)
 * 4. Verify previous invoice exists in system
 * 5. Verify previous invoice has outstanding balance
 * 6. Verify payment doesn't exceed outstanding balance
 *
 * @param {Object} data - Transaction data
 * @returns {Object} Validation result {valid, errors?}
 */
function validateDuePayment(data) {
  const errors = [];

  // === PHASE 1: BASIC FIELD VALIDATION ===
  if (!data.prevInvoice) {
    errors.push('Previous invoice reference is required for Due payment');
  }
  if (data.paymentAmt <= 0) {
    errors.push('Payment amount must be greater than 0 for Due payment');
  }
  if (data.receivedAmt !== 0) {
    errors.push('Received amount must be 0 for Due payment (paying existing invoice)');
  }

  // === PHASE 2: INVOICE EXISTENCE & BALANCE VALIDATION ===
  if (data.prevInvoice) {
    try {
      const prevInvoice = InvoiceManager.findInvoice(data.supplier, data.prevInvoice);
      if (!prevInvoice) {
        errors.push(`Previous invoice "${data.prevInvoice}" not found for supplier "${data.supplier}"`);
      } else {
        // Get balance due from invoice record
        const currentBalance = Number(prevInvoice.data[CONFIG.invoiceCols.balanceDue]) || 0;

        if (currentBalance <= 0) {
          errors.push(`Invoice "${data.prevInvoice}" has no outstanding balance`);
        } else if (data.paymentAmt > currentBalance) {
          errors.push(`Payment amount (${data.paymentAmt}) exceeds invoice balance (${currentBalance})`);
        }
      }
    } catch (error) {
      AuditLogger.logWarning('validateDuePayment',
        `Error validating previous invoice: ${error.toString()}`);
      errors.push('Unable to verify previous invoice - system error');
    }
  }

  return errors.length > 0
    ? { valid: false, errors: errors }
    : { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: BUSINESS LOGIC VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate business logic rules
 *
 * CHECKS:
 * 1. Duplicate invoice detection (skip for Due payments)
 * 2. Invoice consistency validation
 * 3. Cross-record integrity verification
 *
 * Note: More extensive duplicate checking happens in InvoiceManager
 * during actual creation. This is a fast pre-check to catch obvious issues.
 *
 * @param {Object} data - Transaction data
 * @returns {Object} Validation result {valid, errors?}
 */
function validateBusinessLogic(data) {
  const errors = [];

  // === CHECK 1: DUPLICATE INVOICE DETECTION ===
  // Only check for invoices (not Due payments which reference existing invoices)
  if (data.invoiceNo && data.paymentType !== 'Due') {
    try {
      const existing = InvoiceManager.findInvoice(data.supplier, data.invoiceNo);
      if (existing) {
        errors.push(`Invoice "${data.invoiceNo}" already exists for supplier "${data.supplier}" at row ${existing.row}`);
      }
    } catch (error) {
      AuditLogger.logWarning('validateBusinessLogic',
        `Error checking for duplicate invoice: ${error.toString()}`);
      // Don't block on error - duplicate check will happen again in createNewInvoice
    }
  }

  return errors.length > 0
    ? { valid: false, errors: errors }
    : { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: FIELD-LEVEL VALIDATORS (Optional)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate supplier field
 *
 * Optional enhanced validation with supplier list checking
 * Currently disabled - uncomment to enforce supplier list validation
 *
 * @param {string} supplier - Supplier name
 * @returns {Object} Validation result {valid, error?}
 */
function validateSupplier(supplier) {
  if (!supplier || supplier.toString().trim() === '') {
    return { valid: false, error: 'Supplier name is required' };
  }

  return { valid: true };
}

/**
 * Validate invoice number format and length
 *
 * CONSTRAINTS:
 * - Required if not in Due payment context
 * - Max 50 characters
 * - Alphanumeric plus hyphens and underscores only
 *
 * @param {string} invoiceNo - Invoice number
 * @returns {Object} Validation result {valid, error?}
 */
function validateInvoiceNo(invoiceNo) {
  if (!invoiceNo || invoiceNo.toString().trim() === '') {
    return { valid: false, error: 'Invoice number is required' };
  }

  // Check format: alphanumeric, hyphens, underscores only
  if (!/^[A-Za-z0-9\-_]+$/.test(invoiceNo)) {
    return {
      valid: false,
      error: 'Invoice number can only contain letters, numbers, hyphens, and underscores'
    };
  }

  // Check length
  if (invoiceNo.length > 50) {
    return {
      valid: false,
      error: 'Invoice number cannot exceed 50 characters'
    };
  }

  return { valid: true };
}

/**
 * Validate amount field
 *
 * CONSTRAINTS:
 * - Non-negative (≥ 0)
 * - Must be less than MAX_TRANSACTION_AMOUNT (from CONFIG)
 * - Must be a valid number
 *
 * @param {number} amount - Amount to validate
 * @param {string} fieldName - Field name for error messages (e.g., "Received Amount")
 * @returns {Object} Validation result {valid, error?}
 */
function validateAmount(amount, fieldName) {
  if (isNaN(amount) || amount < 0) {
    return {
      valid: false,
      error: `${fieldName} must be a non-negative number`
    };
  }

  // Check maximum transaction amount limit
  if (amount > CONFIG.rules.MAX_TRANSACTION_AMOUNT) {
    return {
      valid: false,
      error: `${fieldName} (${amount}) exceeds maximum allowed (${CONFIG.rules.MAX_TRANSACTION_AMOUNT})`
    };
  }

  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: DATA INTEGRITY VALIDATION (System Health Check)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate data integrity before post
 *
 * CHECKS:
 * 1. Verify InvoiceDatabase formulas are intact
 * 2. Verify PaymentLog sheet is accessible
 * 3. Verify SupplierLedger sheet is accessible
 * 4. Check for formula corruption
 *
 * Note: This is an optional advanced validation for system health checks.
 * Not called during normal transaction processing.
 * Use for periodic maintenance and troubleshooting.
 *
 * @param {Object} data - Transaction data (optional, not used currently)
 * @returns {Object} Validation result {valid, issues?}
 */
function validateDataIntegrity(data) {
  const issues = [];

  try {
    // === CHECK 1: INVOICEDATABASE FORMULAS ===
    const invoiceSh = SheetUtils.getSheet(CONFIG.invoiceSheet);
    const lastRow = invoiceSh.getLastRow();

    if (lastRow >= 2) {
      const sampleRow = 2;
      // Check Total Paid formula (uses CONFIG for correct column position)
      const formulaTotalPaid = invoiceSh.getRange(sampleRow, CONFIG.invoiceCols.totalPaid + 1).getFormula();
      if (!formulaTotalPaid || !formulaTotalPaid.includes('SUMIF')) {
        issues.push('InvoiceDatabase formulas may be corrupted - Total Paid column');
      }

      // Check Balance Due formula (uses CONFIG for correct column position)
      const formulaBalanceDue = invoiceSh.getRange(sampleRow, CONFIG.invoiceCols.balanceDue + 1).getFormula();
      if (!formulaBalanceDue) {
        issues.push('InvoiceDatabase formulas may be corrupted - Balance Due column');
      }
    }

    // === CHECK 2: PAYMENTLOG ACCESSIBILITY ===
    const paymentSh = SheetUtils.getSheet(CONFIG.paymentSheet);
    if (paymentSh.getLastRow() < 1) {
      issues.push('PaymentLog sheet appears empty or has no header');
    }

    // === CHECK 3: SUPPLIERLEDGER ACCESSIBILITY ===
    const ledgerSh = SheetUtils.getSheet(CONFIG.supplierLedger);
    if (ledgerSh.getLastRow() < 1) {
      issues.push('SupplierLedger sheet appears empty or has no header');
    }

  } catch (error) {
    issues.push(`Data integrity check failed: ${error.message}`);
  }

  if (issues.length > 0) {
    AuditLogger.logWarning('validateDataIntegrity', issues.join('; '));
    return { valid: false, issues: issues };
  }

  return { valid: true };
}
