/**
 * ValidationEngine.gs
 * Comprehensive validation engine for supplier account transactions
 * Handles all data validation and business rule enforcement
 */

/**
 * Main validation function - validates all commit data
 * @param {Object} data - Transaction data to validate
 * @returns {Object} Validation result with {valid: boolean, error: string, errors: array}
 */
function validateCommitData(data) {
  const errors = [];

  // === 1. Required Fields ===
  if (!data.supplier) {
    return { valid: false, error: 'Supplier is required' };
  }

  if (!data.paymentType) {
    errors.push('Payment type is required');
  }

  // === 2. Numeric Validation ===
  if (isNaN(data.receivedAmt) || data.receivedAmt < 0) {
    errors.push('Received amount must be a non-negative number');
  }
  
  if (isNaN(data.paymentAmt) || data.paymentAmt < 0) {
    errors.push('Payment amount must be a non-negative number');
  }

  // === 3. Invoice Number Validation ===
  if (data.invoiceNo && data.invoiceNo.length > 50) {
    errors.push('Invoice number cannot exceed 50 characters');
  }
  
  // === 4. Payment Type Specific Validation ===
  const paymentValidation = validatePaymentTypeRules(data);
  if (!paymentValidation.valid) {
    errors.push(...paymentValidation.errors);
  }

  // === 5. Business Logic Validation ===
  const businessValidation = validateBusinessLogic(data);
  if (!businessValidation.valid) {
    errors.push(...businessValidation.errors);
  }

  // === 6. Return Result ===
  if (errors.length > 0) {
    const errorMessage = errors.join('; ');
    auditAction('VALIDATION_FAILED', data, errorMessage);
    return { 
      valid: false,
      error: errorMessage,
      errors: errors
    };
  }
  
  return { valid: true };
}

/**
 * Validate payment type specific rules
 * @param {Object} data - Transaction data
 * @returns {Object} Validation result
 */
function validatePaymentTypeRules(data) {
  const errors = [];
  
  switch (data.paymentType) {
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
      
    case 'Due':
      const dueValidation = validateDuePayment(data);
      if (!dueValidation.valid) {
        errors.push(...dueValidation.errors);
      }
      break;
      
    default:
      errors.push(`Invalid payment type: "${data.paymentType}". Must be Unpaid, Regular, Partial, or Due`);
  }

  return errors.length > 0 
    ? { valid: false, errors: errors }
    : { valid: true };
}

/**
 * Validate Due payment specific requirements
 * @param {Object} data - Transaction data
 * @returns {Object} Validation result
 */
function validateDuePayment(data) {
  const errors = [];
  
  if (!data.prevInvoice) {
    errors.push('Previous invoice reference is required for Due payment');
  }
  if (data.paymentAmt <= 0) {
    errors.push('Payment amount must be greater than 0 for Due payment');
  }
  if (data.receivedAmt !== 0) {
    errors.push('Received amount must be 0 for Due payment (paying existing invoice)');
  }
  
  // Check if previous invoice exists and has sufficient balance
  if (data.prevInvoice) {
    try {
      const prevInvoice = findInvoiceRecord(data.supplier, data.prevInvoice);
      if (!prevInvoice) {
        errors.push(`Previous invoice "${data.prevInvoice}" not found for supplier "${data.supplier}"`);
      } else {
        const currentBalance = Number(prevInvoice.data[5]) || 0; // Balance Due column
        if (currentBalance <= 0) {
          errors.push(`Invoice "${data.prevInvoice}" has no outstanding balance`);
        } else if (data.paymentAmt > currentBalance) {
          errors.push(`Payment amount (${data.paymentAmt}) exceeds invoice balance (${currentBalance})`);
        }
      }
    } catch (error) {
      logSystemError('validateDuePayment', 
        `Error validating previous invoice: ${error.toString()}`);
      errors.push('Unable to verify previous invoice - system error');
    }
  }
  
  return errors.length > 0 
    ? { valid: false, errors: errors }
    : { valid: true };
}

/**
 * Validate business logic rules
 * @param {Object} data - Transaction data
 * @returns {Object} Validation result
 */
function validateBusinessLogic(data) {
  const errors = [];
  
  // Check for duplicate invoice (only for new invoices, not Due payments)
  if (data.invoiceNo && data.paymentType !== 'Due') {
    try {
      const existing = findInvoiceRecord(data.supplier, data.invoiceNo);
      if (existing) {
        errors.push(`Invoice "${data.invoiceNo}" already exists for supplier "${data.supplier}" at row ${existing.row}`);
      }
    } catch (error) {
      logSystemError('validateBusinessLogic', 
        `Error checking for duplicate invoice: ${error.toString()}`);
      // Don't block - duplicate check will happen again in createNewInvoice
    }
  }
  
  return errors.length > 0 
    ? { valid: false, errors: errors }
    : { valid: true };
}

/**
 * Validate supplier exists (optional - can be expanded)
 * @param {string} supplier - Supplier name
 * @returns {Object} Validation result
 */
function validateSupplier(supplier) {
  if (!supplier || supplier.toString().trim() === '') {
    return { valid: false, error: 'Supplier name is required' };
  }
  
  // Optional: Check if supplier exists in SupplierList sheet
  // Uncomment if you want to enforce supplier list validation
  /*
  try {
    const supplierListSh = getSheet(CONFIG.supplierList);
    const data = supplierListSh.getRange(2, 1, supplierListSh.getLastRow() - 1, 2).getValues();
    const validSuppliers = data
      .filter(row => row[1] === 'ACTIVE')
      .map(row => row[0].toString().trim().toUpperCase());
    
    if (!validSuppliers.includes(supplier.toString().trim().toUpperCase())) {
      return { 
        valid: false, 
        error: `Supplier "${supplier}" is not in the approved active supplier list` 
      };
    }
  } catch (error) {
    logSystemError('validateSupplier', `Supplier validation failed: ${error.toString()}`);
    // Don't block on validation error
  }
  */
  
  return { valid: true };
}

/**
 * Validate invoice number format
 * @param {string} invoiceNo - Invoice number
 * @returns {Object} Validation result
 */
function validateInvoiceNo(invoiceNo) {
  if (!invoiceNo || invoiceNo.toString().trim() === '') {
    return { valid: false, error: 'Invoice number is required' };
  }
  
  // Check format (alphanumeric, hyphens, underscores only)
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
 * Validate amount is valid and within limits
 * @param {number} amount - Amount to validate
 * @param {string} fieldName - Field name for error messages
 * @returns {Object} Validation result
 */
function validateAmount(amount, fieldName) {
  if (isNaN(amount) || amount < 0) {
    return { 
      valid: false, 
      error: `${fieldName} must be a non-negative number` 
    };
  }
  
  // Optional: Check maximum transaction amount
  const MAX_AMOUNT = 1000000; // Configure as needed
  if (amount > MAX_AMOUNT) {
    return { 
      valid: false, 
      error: `${fieldName} (${amount}) exceeds maximum allowed (${MAX_AMOUNT})` 
    };
  }
  
  return { valid: true };
}

/**
 * Validate data integrity before commit (optional advanced validation)
 * @param {Object} data - Transaction data
 * @returns {Object} Validation result
 */
function validateDataIntegrity(data) {
  const issues = [];
  
  try {
    // Check if InvoiceDatabase formulas are intact
    const invoiceSh = getSheet(CONFIG.invoiceSheet);
    const lastRow = invoiceSh.getLastRow();
    
    if (lastRow >= 2) {
      const sampleRow = 2;
      const formulaE = invoiceSh.getRange(sampleRow, 5).getFormula();
      if (!formulaE || !formulaE.includes('SUMIF')) {
        issues.push('InvoiceDatabase formulas may be corrupted - column E (Total Paid)');
      }
      
      const formulaF = invoiceSh.getRange(sampleRow, 6).getFormula();
      if (!formulaF) {
        issues.push('InvoiceDatabase formulas may be corrupted - column F (Balance Due)');
      }
    }
    
    // Check if PaymentLog is accessible
    const paymentSh = getSheet(CONFIG.paymentSheet);
    if (paymentSh.getLastRow() < 1) {
      issues.push('PaymentLog sheet appears empty or has no header');
    }
    
    // Check if SupplierLedger is accessible
    const ledgerSh = getSheet(CONFIG.supplierLedger);
    if (ledgerSh.getLastRow() < 1) {
      issues.push('SupplierLedger sheet appears empty or has no header');
    }
    
  } catch (error) {
    issues.push(`Data integrity check failed: ${error.message}`);
  }
  
  if (issues.length > 0) {
    logSystemError('validateDataIntegrity', issues.join('; '));
    return { valid: false, issues: issues };
  }
  
  return { valid: true };
}