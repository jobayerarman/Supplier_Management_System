// ==================== MODULE: InvoiceManager.gs ====================
/**
 * Invoice management module
 * Handles all invoice-related operations
 * - Creating new invoices
 * - Updating existing invoices
 * - Finding invoice records
 * - Managing invoice formulas
 */

// Cache for invoice data to reduce repeated sheet reads
const InvoiceCache = {
  data: null,
  timestamp: null,
  TTL: CONFIG.rules.CACHE_TTL_MS,
  
  get: function() {
    const now = Date.now();
    if (this.data && this.timestamp && (now - this.timestamp) < this.TTL) {
      return this.data;
    }
    return null;
  },
  
  set: function(data) {
    this.data = data;
    this.timestamp = Date.now();
  },
  
  clear: function() {
    this.data = null;
    this.timestamp = null;
  }
};

// ==================== INVOICE MANAGER MODULE ====================

const InvoiceManager = {
  /**
   * Process invoice (create or update based on existence)
   * 
   * @param {Object} data - Transaction data
   * @returns {Object} Result with success flag and details
   */
  process: function(data) {
    try {
      // For Due payments, we don't create new invoices
      if (data.paymentType === 'Due' && !data.invoiceNo) {
        return { success: true, action: 'none' };
      }
      
      // Check if invoice already exists
      const existingInvoice = data.invoiceNo ? this.find(data.supplier, data.invoiceNo) : null;
      
      if (existingInvoice) {
        return this.update(existingInvoice, data);
      } else {
        return this.create(data);
      }
      
    } catch (error) {
      AuditLogger.logError('InvoiceManager.process', 
        `Failed to process invoice for ${data.supplier}: ${error.toString()}`);
      return { 
        success: false, 
        error: `Invoice processing failed: ${error.message}` 
      };
    }
  },
  
  /**
   * Create new invoice with atomic duplicate check
   * 
   * @param {Object} data - Transaction data
   * @returns {Object} Result with success flag and invoice details
   */
  create: function(data) {
    const lock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
    if (!lock) {
      return { success: false, error: 'Unable to acquire lock for invoice creation' };
    }
    
    try {
      // Double-check invoice doesn't exist (atomic check with lock)
      const existingInvoice = this.find(data.supplier, data.invoiceNo);
      if (existingInvoice) {
        AuditLogger.log('DUPLICATE_PREVENTED', data, 
          `Invoice ${data.invoiceNo} already exists at row ${existingInvoice.row}`);
        return { 
          success: false, 
          error: `Invoice ${data.invoiceNo} already exists for ${data.supplier}`,
          existingRow: existingInvoice.row
        };
      }
      
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const lastRow = invoiceSh.getLastRow();

      // Build new invoice row
      const newInvoice = [
        data.timestamp,                              // A: Date
        data.supplier,                               // B: Supplier
        data.invoiceNo,                              // C: Invoice No
        data.receivedAmt,                            // D: Total Amount
        '',                                          // E: Total Paid (formula)
        '',                                          // F: Balance Due (formula)
        '',                                          // G: Status (formula)
        data.sheetName,                              // H: Origin Day
        '',                                          // I: Days Outstanding (formula)
        IDGenerator.generateInvoiceId(data.sysId)    // J: System ID
      ];

      invoiceSh.appendRow(newInvoice);

      // Apply formulas to new row
      const newRow = lastRow + 1;
      this.setFormulas(invoiceSh, newRow);
      
      // Clear cache after invoice creation
      InvoiceCache.clear();
      
      AuditLogger.log('INVOICE_CREATED', data, 
        `New invoice created at row ${newRow}`);

      return { 
        success: true, 
        action: 'created', 
        invoiceId: IDGenerator.generateInvoiceId(data.sysId),
        row: newRow
      };
      
    } catch (error) {
      AuditLogger.logError('InvoiceManager.create', 
        `Failed to create invoice ${data.invoiceNo}: ${error.toString()}`);
      return { 
        success: false, 
        error: error.toString() 
      };
    } finally {
      LockManager.releaseLock(lock);
    }
  },
  
  /**
   * Update existing invoice
   * 
   * @param {Object} existingInvoice - Existing invoice record {row, data}
   * @param {Object} data - Transaction data
   * @returns {Object} Result with success flag
   */
  update: function(existingInvoice, data) {
    if (!existingInvoice) {
      return { success: false, error: 'Invoice not found' };
    }
    
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const rowNum = existingInvoice.row;
      const currentTotal = Number(existingInvoice.data[CONFIG.invoiceCols.totalAmount]) || 0;
      const currentOrigin = existingInvoice.data[CONFIG.invoiceCols.originDay];
      
      // Check if updates are needed
      const needsUpdate = (data.receivedAmt !== currentTotal) || 
                          (data.sheetName !== currentOrigin);
      
      if (!needsUpdate) {
        return { success: true, action: 'no_change', row: rowNum };
      }
      
      // Update Total Amount (column D) and Origin Day (column H)
      invoiceSh.getRange(rowNum, CONFIG.invoiceCols.totalAmount + 1).setValue(data.receivedAmt);
      invoiceSh.getRange(rowNum, CONFIG.invoiceCols.originDay + 1).setValue(data.sheetName);

      // Touch the row to trigger formula recalculation
      const currentDate = invoiceSh.getRange(rowNum, 1).getValue();
      invoiceSh.getRange(rowNum, 1).setValue(currentDate);
      
      // Clear cache after update
      InvoiceCache.clear();
      
      AuditLogger.log('INVOICE_UPDATED', data, 
        `Updated invoice at row ${rowNum}: amount ${currentTotal} → ${data.receivedAmt}`);
      
      return { success: true, action: 'updated', row: rowNum };
      
    } catch (error) {
      AuditLogger.logError('InvoiceManager.update', 
        `Failed to update invoice: ${error.toString()}`);
      return { success: false, error: error.toString() };
    }
  },

  /**
   * Set formulas for invoice row
   * 
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Invoice sheet
   * @param {number} row - Row number
   */
  setFormulas: function(sheet, row) {
    try {
      // Column E: Total Paid (sum of all payments for this invoice)
      sheet.getRange(`E${row}`).setFormula(
        `=IF(C${row}="","", IFERROR(SUMIF(PaymentLog!C:C, C${row}, PaymentLog!E:E), 0))`
      );
      
      // Column F: Balance Due (Total Amount - Total Paid)
      sheet.getRange(`F${row}`).setFormula(
        `=IF(D${row}="","", D${row} - E${row})`
      );
      
      // Column G: Status (Paid/Unpaid/Partial based on balance)
      sheet.getRange(`G${row}`).setFormula(
        `=IFS(F${row}=0,"Paid", F${row}=D${row},"Unpaid", F${row}<D${row},"Partial")`
      );
      
      // Column I: Days Outstanding (days since invoice date, 0 if paid)
      sheet.getRange(`I${row}`).setFormula(
        `=IF(F${row}=0,0, TODAY()-A${row})`
      );
    } catch (error) {
      logSystemError('InvoiceManager.setFormulas', 
        `Failed to set formulas for row ${row}: ${error.toString()}`);
      throw error;
    }
  },
  
  /**
   * Find invoice record by supplier and invoice number
   * 
   * @param {string} supplier - Supplier name
   * @param {string} invoiceNo - Invoice number
   * @returns {Object|null} Invoice record or null if not found
   */
  find: function(supplier, invoiceNo) {
    if (StringUtils.isEmpty(supplier) || StringUtils.isEmpty(invoiceNo)) {
      AuditLogger.logWarning('InvoiceManager.find', 
        'Both supplier and invoiceNo are required');
      return null;
    }

    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const data = invoiceSh.getDataRange().getValues();
      
      const normalizedSupplier = StringUtils.normalize(supplier);
      const normalizedInvoice = StringUtils.normalize(invoiceNo);
      
      for (let i = 1; i < data.length; i++) {
        if (StringUtils.equals(data[i][CONFIG.invoiceCols.supplier], normalizedSupplier) &&
            StringUtils.equals(data[i][CONFIG.invoiceCols.invoiceNo], normalizedInvoice)) {
          return { row: i + 1, data: data[i] };
        }
      }
      return null;
      
    } catch (error) {
      AuditLogger.logError('InvoiceManager.find', 
        `Failed to find invoice ${invoiceNo} for ${supplier}: ${error.toString()}`);
      return null;
    }
  },
  
  /**
   * Get unpaid invoices for supplier
   * 
   * @param {string} supplier - Supplier name
   * @returns {Array} Array of unpaid invoice objects
   */
  getUnpaidForSupplier: function(supplier) {
    if (StringUtils.isEmpty(supplier)) {
      return [];
    }
    
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const lastRow = invoiceSh.getLastRow();
      
      if (lastRow < 2) {
        return [];
      }
      
      const data = invoiceSh.getRange(2, 1, lastRow - 1, CONFIG.totalColumns.invoice).getValues();
      const normalizedSupplier = StringUtils.normalize(supplier);
      
      return data
        .filter(row => {
          return StringUtils.equals(row[CONFIG.invoiceCols.supplier], normalizedSupplier) &&
                 Number(row[CONFIG.invoiceCols.balanceDue]) > 0;
        })
        .map(row => ({
          invoiceNo: row[CONFIG.invoiceCols.invoiceNo],
          date: row[CONFIG.invoiceCols.date],
          totalAmount: row[CONFIG.invoiceCols.totalAmount],
          totalPaid: row[CONFIG.invoiceCols.totalPaid],
          balanceDue: row[CONFIG.invoiceCols.balanceDue],
          status: row[CONFIG.invoiceCols.status],
          daysOutstanding: row[CONFIG.invoiceCols.daysOutstanding]
        }));
        
    } catch (error) {
      AuditLogger.logError('InvoiceManager.getUnpaidForSupplier', 
        `Failed to get unpaid invoices for ${supplier}: ${error.toString()}`);
      return [];
    }
  },
  
  /**
   * Get all invoices for supplier
   * 
   * @param {string} supplier - Supplier name
   * @param {boolean} includePaid - Whether to include paid invoices
   * @returns {Array} Array of invoice objects
   */
  getAllForSupplier: function(supplier, includePaid = true) {
    if (StringUtils.isEmpty(supplier)) {
      return [];
    }
    
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const lastRow = invoiceSh.getLastRow();
      
      if (lastRow < 2) {
        return [];
      }
      
      const data = invoiceSh.getRange(2, 1, lastRow - 1, CONFIG.totalColumns.invoice).getValues();
      const normalizedSupplier = StringUtils.normalize(supplier);
      
      return data
        .filter(row => {
          const matchesSupplier = StringUtils.equals(row[CONFIG.invoiceCols.supplier], normalizedSupplier);
          if (!matchesSupplier) return false;
          if (includePaid) return true;
          return Number(row[CONFIG.invoiceCols.balanceDue]) > 0;
        })
        .map(row => ({
          invoiceNo: row[CONFIG.invoiceCols.invoiceNo],
          date: row[CONFIG.invoiceCols.date],
          totalAmount: row[CONFIG.invoiceCols.totalAmount],
          totalPaid: row[CONFIG.invoiceCols.totalPaid],
          balanceDue: row[CONFIG.invoiceCols.balanceDue],
          status: row[CONFIG.invoiceCols.status],
          originDay: row[CONFIG.invoiceCols.originDay],
          daysOutstanding: row[CONFIG.invoiceCols.daysOutstanding],
          sysId: row[CONFIG.invoiceCols.sysId]
        }));
        
    } catch (error) {
      AuditLogger.logError('InvoiceManager.getAllForSupplier', 
        `Failed to get invoices for ${supplier}: ${error.toString()}`);
      return [];
    }
  },
  
  /**
   * Get invoice statistics
   * 
   * @returns {Object} Statistics summary
   */
  getStatistics: function() {
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const lastRow = invoiceSh.getLastRow();
      
      if (lastRow < 2) {
        return {
          total: 0,
          unpaid: 0,
          partial: 0,
          paid: 0,
          totalOutstanding: 0
        };
      }
      
      const data = invoiceSh.getRange(2, 1, lastRow - 1, CONFIG.totalColumns.invoice).getValues();
      
      let unpaid = 0, partial = 0, paid = 0;
      let totalOutstanding = 0;
      
      data.forEach(row => {
        const status = row[CONFIG.invoiceCols.status];
        const balanceDue = Number(row[CONFIG.invoiceCols.balanceDue]) || 0;
        
        if (StringUtils.equals(status, 'Unpaid')) unpaid++;
        else if (StringUtils.equals(status, 'Partial')) partial++;
        else if (StringUtils.equals(status, 'Paid')) paid++;
        
        totalOutstanding += balanceDue;
      });
      
      return {
        total: data.length,
        unpaid: unpaid,
        partial: partial,
        paid: paid,
        totalOutstanding: totalOutstanding
      };
      
    } catch (error) {
      AuditLogger.logError('InvoiceManager.getStatistics', 
        `Failed to get statistics: ${error.toString()}`);
      return null;
    }
  },
  
  /**
   * Build dropdown list of unpaid invoices for a supplier
   * Used for Due payment dropdown
   * 
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Daily sheet
   * @param {number} row - Target row
   * @param {string} supplier - Supplier name
   * @param {string} paymentType - Payment type
   * @returns {boolean} Success flag
   */
  buildUnpaidDropdown: function(sheet, row, supplier, paymentType) {
    const targetCell = sheet.getRange(row, CONFIG.cols.prevInvoice + 1);
    
    // Clear dropdown if not Due payment or no supplier
    if (paymentType !== "Due" || StringUtils.isEmpty(supplier)) {
      try {
        targetCell.clearDataValidations().clearContent();
      } catch (e) {
        AuditLogger.logError('InvoiceManager.buildUnpaidDropdown', 
          `Failed to clear dropdown at row ${row}: ${e.toString()}`);
      }
      return false;
    }

    try {
      const unpaidInvoices = this.getUnpaidForSupplier(supplier);
      
      if (unpaidInvoices.length === 0) {
        targetCell.clearDataValidations()
          .setNote(`No unpaid invoices for ${supplier}`)
          .setBackground(CONFIG.colors.warning);
        return false;
      }

      const invoiceNumbers = unpaidInvoices.map(inv => inv.invoiceNo);
      
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(invoiceNumbers, true)
        .setAllowInvalid(false)
        .setHelpText(`Select from ${invoiceNumbers.length} unpaid invoice(s)`)
        .build();

      targetCell.setDataValidation(rule)
        .setNote(`${invoiceNumbers.length} unpaid invoice(s) available`)
        .setBackground(CONFIG.colors.success);
      
      return true;
      
    } catch (error) {
      AuditLogger.logError('InvoiceManager.buildUnpaidDropdown', 
        `Failed to build dropdown for ${supplier} at row ${row}: ${error.toString()}`);
      
      targetCell.clearDataValidations()
        .setValue('')
        .setNote('Error loading invoices - please contact administrator')
        .setBackground(CONFIG.colors.error);
      
      return false;
    }
  },

  /**
   * Repair formulas for all invoices (maintenance function)
   * 
   * @returns {Object} Result with repaired count
   */
  repairAllFormulas: function() {
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const lastRow = invoiceSh.getLastRow();
      let repairedCount = 0;
      
      for (let i = 2; i <= lastRow; i++) {
        // Check if formulas are missing
        const formulaE = invoiceSh.getRange(i, 5).getFormula();
        const formulaF = invoiceSh.getRange(i, 6).getFormula();
        const formulaG = invoiceSh.getRange(i, 7).getFormula();
        const formulaI = invoiceSh.getRange(i, 9).getFormula();
        
        if (!formulaE || !formulaF || !formulaG || !formulaI) {
          this.setFormulas(invoiceSh, i);
          repairedCount++;
        }
      }
      
      return { success: true, repairedCount: repairedCount };
    } catch (error) {
      logSystemError('InvoiceManager.repairAllFormulas', error.toString());
      return { success: false, error: error.toString() };
    }
  }
};

// ==================== BACKWARD COMPATIBILITY ====================

/**
 * Backward compatibility wrapper functions
 */
function processInvoice(data) {
  return InvoiceManager.process(data);
}

function createNewInvoice(data) {
  return InvoiceManager.create(data);
}

function updateExistingInvoice(existingInvoice, data) {
  return InvoiceManager.update(existingInvoice, data);
}

function findInvoiceRecord(supplier, invoiceNo) {
  return InvoiceManager.find(supplier, invoiceNo);
}

function setInvoiceFormulas(sheet, row) {
  return InvoiceManager.setFormulas(sheet, row);
}

function getUnpaidInvoicesForSupplier(supplier) {
  return InvoiceManager.getUnpaidForSupplier(supplier);
}

function getAllInvoicesForSupplier(supplier, includePaid) {
  return InvoiceManager.getAllForSupplier(supplier, includePaid);
}

function getInvoiceStatistics() {
  return InvoiceManager.getStatistics();
}

function buildInvoiceDropdown(sheet, row, supplier, paymentType) {
  return InvoiceManager.buildUnpaidDropdown(sheet, row, supplier, paymentType);
}

function repairAllInvoiceFormulas() {
  return InvoiceManager.repairAllFormulas();
}

function clearInvoiceCache() {
  InvoiceCache.clear();
}

// Legacy function for compatibility with old Code.gs
function buildPrevInvoiceDropdown(sh, row) {
  const supplier = sh.getRange(row, CONFIG.cols.supplier + 1).getValue();
  const paymentType = sh.getRange(row, CONFIG.cols.paymentType + 1).getValue();
  return InvoiceManager.buildUnpaidDropdown(sh, row, supplier, paymentType);
}