/**
 * Invoice management module
 * Handles all invoice-related operations
 * - Creating new invoices
 * - Updating existing invoices
 * - Finding invoice records
 * - Managing invoice formulas
 * 
 * OPTIMIZATIONS:
 * - Intelligent caching with automatic invalidation
 * - Batch operations for multiple invoice operations
 * - Single getDataRange() call per operation
 * - Lazy formula application
 * - Index-based lookups
 * - Memory-efficient filtering
 */

// ═══ INTELLIGENT CACHE ═══
/**
 * High-performance in-memory + persistent cache for Invoice Sheet
 * Reduces read latency and redundant sheet access
 */
const InvoiceCache = {
  data: null,
  indexMap: null, // NEW: Fast lookup by supplier-invoice key
  timestamp: null,
  TTL: CONFIG.rules.CACHE_TTL_MS,

  /**
   * Get cached data with validation
   */
  get: function () {
    const now = Date.now();
    if (this.data && this.timestamp && (now - this.timestamp) < this.TTL) {
      return { data: this.data, indexMap: this.indexMap };
    }
    return null;
  },

  /**
   * Set cache with index map generation
   */
  set: function (data) {
    this.data = data;
    this.timestamp = Date.now();

    // Build fast lookup index: "SUPPLIER|INVOICENO" -> row index
    this.indexMap = new Map();
    for (let i = 1; i < data.length; i++) {
      const supplier = StringUtils.normalize(data[i][CONFIG.invoiceCols.supplier]);
      const invoiceNo = StringUtils.normalize(data[i][CONFIG.invoiceCols.invoiceNo]);
      if (supplier && invoiceNo) {
        const key = `${supplier}|${invoiceNo}`;
        this.indexMap.set(key, i);
      }
    }
  },

  /**
   * Selective cache invalidation
   * Only clear if operation affects queries
   */
  invalidate: function(operation) {
    // SMART: Only clear cache for operations that change dropdown/balance data
    const invalidatingOps = ['create', 'updateAmount', 'updateStatus'];
    if (invalidatingOps.includes(operation)) {
      this.clear();
    }
    // Don't clear for: 'updatePaidDate', 'noChange', etc.
  },

  /**
   * Clear cache
   */
  clear: function () {
    this.data = null;
    this.indexMap = null;
    this.timestamp = null;
  },

  /**
   * Get cached invoice sheet data (single API call)
   */
  getInvoiceData: function () {
    let cached = this.get();
    if (cached) {
      return cached;
    }

    // Cache miss - load data
    const invoiceSh = getSheet(CONFIG.invoiceSheet);
    const data = invoiceSh.getDataRange().getValues();
    this.set(data);

    return { data: data, indexMap: this.indexMap };
  }
};

// ==================== INVOICE MANAGER MODULE ====================

/**
 * InvoiceManager - Optimized version
 * Handles creation, updates, and processing of supplier invoices
 */
const InvoiceManager = {
  /**
   * Process invoice (create or update based on existence)
   * 
   * @param {Object} data - Transaction data
   * @returns {Object} Result with success flag and details
   */
  process: function (data) {
    try {
      // Skip creation for "Due" payments with no invoice number
      if (data.paymentType === 'Due' && !data.invoiceNo) {
        return { success: true, action: 'none' };
      }

      // Check if invoice already exists
      const existingInvoice = data.invoiceNo ? this.find(data.supplier, data.invoiceNo) : null;
      return existingInvoice ? this.update(existingInvoice, data) : this.create(data);

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
  create: function (data) {
    const lock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
    if (!lock) {
      return { success: false, error: 'Unable to acquire lock for invoice creation' };
    }

    try {
      const { supplier, invoiceNo, sheetName, sysId, receivedAmt, timestamp } = data;

      // Double-check invoice doesn't exist (atomic check with lock)
      const existingInvoice = this.find(supplier, invoiceNo);

      if (existingInvoice) {
        const msg = `Invoice ${invoiceNo} already exists at row ${existing.row}`;

        AuditLogger.log('DUPLICATE_PREVENTED', data, msg);
        return { success: false, error: msg, existingRow: existingInvoice.row };
      }

      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const lastRow = invoiceSh.getLastRow();
      const newRow = lastRow + 1;
      const invoiceDate = getDailySheetDate(sheetName) || timestamp;
      const formattedDate = DateUtils.formatDate(invoiceDate);
      const invoiceId = IDGenerator.generateInvoiceId(sysId);

      // Cached formula templates (avoids repetitive string concatenations)
      const F = `=IF(C${newRow}="","",IFERROR(SUMIF(PaymentLog!C:C,C${newRow},PaymentLog!E:E),0))`;
      const G = `=IF(E${newRow}="","",E${newRow}-F${newRow})`;
      const H = `=IFS(G${newRow}=0,"Paid",G${newRow}=E${newRow},"Unpaid",G${newRow}<E${newRow},"Partial")`;
      const K = `=IF(G${newRow}=0,0,TODAY()-D${newRow})`;

      // Build new invoice row WITH formulas included
      const newRowData = [
        timestamp,
        supplier,
        invoiceNo,
        invoiceDate,
        receivedAmt,
        F,
        G,
        H,
        '',
        sheetName,
        K,
        invoiceId
      ];

      // Single atomic write
      invoiceSh.getRange(newRow, 1, 1, newRowData.length).setValues([newRowData]);

      // Invalidate supplier-level cache (scoped)
      InvoiceCache.invalidateForSupplier(supplier);

      AuditLogger.log('INVOICE_CREATED', data,
        `Created new invoice ${invoiceNo} at row ${newRow} | Date: ${formattedDate}`);

      return { success: true, action: 'created', invoiceId, row: newRow };

    } catch (error) {
      AuditLogger.logError('InvoiceManager.create',
        `Failed to create invoice ${data.invoiceNo}: ${error.toString()}`);
      return {success: false, error: error.toString()};

    } finally {
      LockManager.releaseLock(lock);
    }
  },

  /**
   * Update existing invoice
   * OPTIMIZED: Batch updates in single operation
   * 
   * @param {Object} existingInvoice - Existing invoice record {row, data}
   * @param {Object} data - Transaction data
   * @returns {Object} Result with success flag
   */
  update: function (existingInvoice, data) {
    try {
      if (!existingInvoice) return { success: false, error: 'Invoice not found' };
      
      const { supplier, sheetName, receivedAmt } = data;
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const rowNum = existingInvoice.row;

      const currentTotal = Number(existingInvoice.data[CONFIG.invoiceCols.totalAmount]) || 0;
      const currentOrigin = existingInvoice.data[CONFIG.invoiceCols.originDay];

      const totalCol = CONFIG.invoiceCols.totalAmount + 1;
      const originCol = CONFIG.invoiceCols.originDay + 1;
      const oldTotal = Number(existingInvoice.data[CONFIG.invoiceCols.totalAmount]) || 0;
      const oldOrigin = String(existingInvoice.data[CONFIG.invoiceCols.originDay]);
      
      // Check if updates are needed
      const amountChanged = Number(receivedAmt) !== oldTotal;
      const originChanged = (String(data.sheetName) !== oldOrigin);
      
      if (!amountChanged && !originChanged) {
        return { success: true, action: 'no_change', row: rowNum };
      }
      
      // Perform only necessary writes in one batch
      const updates = [];
      if (amountChanged) {
        updates.push({ col: totalCol, val: receivedAmt });
      }
      if (originChanged) {
        updates.push({ col: originCol, val: sheetName });
      }

      if (updates.length) {
        const range = invoiceSh.getRange(rowNum, 1, 1, invoiceSh.getLastColumn());
        const values = range.getValues()[0];
        updates.forEach(u => (values[u.col - 1] = u.val));
        range.setValues([values]);
      }

      // Cache invalidation only if numeric data changed
      if (amountChanged) InvoiceCache.clear();

      AuditLogger.log('INVOICE_UPDATED', data,
        `Updated invoice ${existing.data[CONFIG.invoiceCols.invoiceNo]} at row ${rowNum} | Amount ${oldTotal} → ${receivedAmt}`);

      return { success: true, action: 'updated', row: rowNum };

    } catch (error) {
      AuditLogger.logError('InvoiceManager.update',
        `Failed to update invoice: ${error.toString()}`);
      return { success: false, error: error.toString() };
    }
  },

  /**
   * Update paid date when invoice is fully paid
   * Called after payment processing
   * @param {string} invoiceNo - Invoice number
   * @param {string} supplier - Supplier name
   * @param {Date} paymentDate - Date of final payment
   */
  updatePaidDate: function (invoiceNo, supplier, paymentDate) {
    try {
      const invoice = this.find(supplier, invoiceNo);
      if (!invoice) return;

      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const balanceDue = Number(invoice.data[CONFIG.invoiceCols.balanceDue]) || 0;
      const currentPaidDate = invoice.data[CONFIG.invoiceCols.paidDate];

      // If balance is zero and paid date is empty, set it
      if (balanceDue === 0 && !currentPaidDate) {
        invoiceSh.getRange(invoice.row, CONFIG.invoiceCols.paidDate + 1)
          .setValue(paymentDate);

        AuditLogger.log('INVOICE_FULLY_PAID', { invoiceNo, supplier },
          `Invoice fully paid on ${DateUtils.formatDate(paymentDate)}`);

        InvoiceCache.clear();
      }
    } catch (error) {
      AuditLogger.logError('InvoiceManager.updatePaidDate',
        `Failed to update paid date: ${error.toString()}`);
    }
  },

  /**
   * Set formulas for an invoice row in a non-destructive way.
   * This function now only targets the specific formula columns.
   * Used by the repairAllFormulas() utility.
   * 
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Invoice sheet
   * @param {number} row - Row number to apply formulas to
   */
  setFormulas: function (sheet, row) {
    try {
      // TARGETED UPDATE: Set formula for 'Total Paid' (Column F)
      sheet.getRange(row, CONFIG.invoiceCols.totalPaid + 1)
        .setFormula(`=IF(C${row}="","", IFERROR(SUMIF(PaymentLog!C:C, C${row}, PaymentLog!E:E), 0))`);

      // TARGETED UPDATE: Set formula for 'Balance Due' (Column G)
      sheet.getRange(row, CONFIG.invoiceCols.balanceDue + 1)
        .setFormula(`=IF(E${row}="","", E${row} - F${row})`);

      // TARGETED UPDATE: Set formula for 'Status' (Column H)
      sheet.getRange(row, CONFIG.invoiceCols.status + 1)
        .setFormula(`=IFS(G${row}=0,"Paid", G${row}=E${row},"Unpaid", G${row}<E${row},"Partial")`);

      // TARGETED UPDATE: Set formula for 'Days Outstanding' (Column K)
      sheet.getRange(row, CONFIG.invoiceCols.daysOutstanding + 1)
        .setFormula(`=IF(G${row}=0, 0, TODAY() - D${row})`);

    } catch (error) {
      logSystemError('InvoiceManager.setFormulas',
        `Failed to set formulas for row ${row}: ${error.toString()}`);
      throw error;
    }
  },

  /**
   * Find invoice record by supplier and invoice number (cached lookup)
   * 
   * @param {string} supplier - Supplier name
   * @param {string} invoiceNo - Invoice number
   * @returns {Object|null} Invoice record or null if not found
   */
  find: function (supplier, invoiceNo) {
    if (StringUtils.isEmpty(supplier) || StringUtils.isEmpty(invoiceNo)) {
      AuditLogger.logWarning(
        'InvoiceManager.find',
        'Both supplier and invoiceNo are required'
      );
      return null;
    }

    try {
      // Get cached data with index
      const { data, indexMap } = InvoiceCache.getInvoiceData();

      const key = `${StringUtils.normalize(supplier)}|${StringUtils.normalize(invoiceNo)}`;
      const rowIndex = indexMap.get(key);

      if (!rowIndex) {
        return null;
      }
      
      return {
        row: rowIndex + 1, // convert to 1-based sheet index
        data: data[rowIndex],
      };

    } catch (error) {
      AuditLogger.logError(
        'InvoiceManager.find',
        `Failed to find invoice ${invoiceNo} for ${supplier}: ${error.toString()}`
      );
      return null;
    }
  },

  /**
   * Get unpaid invoices for supplier (cached + in-memory filtering)
   * 
   * @param {string} supplier - Supplier name
   * @returns {Array} Array of unpaid invoice objects
   */
  getUnpaidForSupplier: function (supplier) {
    if (StringUtils.isEmpty(supplier)) {
      return [];
    }

    try {
      // Use cached data
      const { data } = InvoiceCache.getInvoiceData();
      if (data.length <= 1) return [];

      const normSupplier = StringUtils.normalize(supplier);
      const col = CONFIG.invoiceCols;

      // Single-pass filter and map
      const unpaidInvoices = [];

      // Start from row 1 to skip headers (if row 0 is header)
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;

        const rowSupplier = StringUtils.normalize(row[col.supplier]);
        const balanceDue = Number(row[col.balanceDue]) || 0;

        if (rowSupplier === normSupplier && balanceDue > 0) {
          unpaidInvoices.push({
            invoiceNo: row[col.invoiceNo],
            date: row[col.date],
            totalAmount: row[col.totalAmount],
            totalPaid: row[col.totalPaid],
            balanceDue: balanceDue,
            status: row[col.status],
            daysOutstanding: row[col.daysOutstanding],
          });
        }
      }

      return unpaidInvoices;

    } catch (error) {
      AuditLogger.logError(
        'InvoiceManager.getUnpaidForSupplier',
        `Failed to get unpaid invoices for ${supplier}: ${error.toString()}`
      );
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
  getAllForSupplier: function (supplier, includePaid = true) {
    if (StringUtils.isEmpty(supplier)) {
      return [];
    }

    try {
      // Use cached data
      const { data } = InvoiceCache.getInvoiceData();
      const normalizedSupplier = StringUtils.normalize(supplier);

      // Single-pass filter and map
      const invoices = [];
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (StringUtils.equals(row[CONFIG.invoiceCols.supplier], normalizedSupplier)) {
          const balanceDue = Number(row[CONFIG.invoiceCols.balanceDue]) || 0;

          if (includePaid || balanceDue > 0) {
            invoices.push({
              invoiceNo: row[CONFIG.invoiceCols.invoiceNo],
              date: row[CONFIG.invoiceCols.date],
              invoiceDate: row[CONFIG.invoiceCols.invoiceDate],
              totalAmount: row[CONFIG.invoiceCols.totalAmount],
              totalPaid: row[CONFIG.invoiceCols.totalPaid],
              balanceDue: balanceDue,
              status: row[CONFIG.invoiceCols.status],
              originDay: row[CONFIG.invoiceCols.originDay],
              daysOutstanding: row[CONFIG.invoiceCols.daysOutstanding],
              sysId: row[CONFIG.invoiceCols.sysId]
            });
          }
        }
      }

      return invoices;

    } catch (error) {
      AuditLogger.logError('InvoiceManager.getAllForSupplier',
        `Failed to get invoices for ${supplier}: ${error.toString()}`);
      return [];
    }
  },

  /**
   * Get invoice statistics
   * OPTIMIZED: Single data read, single-pass aggregation
   * 
   * @returns {Object} Statistics summary
   */
  getStatistics: function () {
    try {
      // Use cached data
      const { data } = InvoiceCache.getInvoiceData();

      if (data.length < 2) {
        return {
          total: 0,
          unpaid: 0,
          partial: 0,
          paid: 0,
          totalOutstanding: 0
        };
      }

      // Single-pass aggregation
      let unpaid = 0, partial = 0, paid = 0;
      let totalOutstanding = 0;

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const status = row[CONFIG.invoiceCols.status];
        const balanceDue = Number(row[CONFIG.invoiceCols.balanceDue]) || 0;

        if (StringUtils.equals(status, 'Unpaid')) unpaid++;
        else if (StringUtils.equals(status, 'Partial')) partial++;
        else if (StringUtils.equals(status, 'Paid')) paid++;

        totalOutstanding += balanceDue;
      }

      return {
        total: data.length - 1, // Exclude header
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
  buildUnpaidDropdown: function (sheet, row, supplier, paymentType) {
    const targetCell = sheet.getRange(row, CONFIG.cols.prevInvoice + 1);

    // Clear dropdown if not Due payment or no supplier
    if (paymentType !== "Due" || StringUtils.isEmpty(supplier)) {
      try {
        targetCell.clearDataValidations();
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

      targetCell.setDataValidation(rule).setBackground(CONFIG.colors.info);

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
  repairAllFormulas: function () {
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const lastRow = invoiceSh.getLastRow();

      if (lastRow < 2) {
        return { success: true, repairedCount: 0, message: 'No invoices to repair' };
      }

      // Batch check all formulas at once
      const formulaRange = invoiceSh.getRange(2, 1, lastRow - 1, CONFIG.totalColumns.invoice);
      const formulas = formulaRange.getFormulas();

      let repairedCount = 0;
      const rowsToRepair = [];

      // Identify rows needing repair
      for (let i = 0; i < formulas.length; i++) {
        const rowFormulas = formulas[i];
        // Check if key formula columns are missing
        if (!rowFormulas[5] || !rowFormulas[6] || !rowFormulas[7] || !rowFormulas[10]) {
          rowsToRepair.push(i + 2); // +2 for header and 0-based index
        }
      }

      // Repair in batch
      for (const rowNum of rowsToRepair) {
        this.setFormulas(invoiceSh, rowNum);
        repairedCount++;
      }

      return {
        success: true,
        repairedCount: repairedCount,
        message: `Repaired ${repairedCount} invoice(s)`
      };
    } catch (error) {
      logSystemError('InvoiceManager.repairAllFormulas', error.toString());
      return { success: false, error: error.toString() };
    }
  },

  /**
  * Batch create multiple invoices (for bulk import)
  * NEW: Optimized for mass data entry
  * 
  * @param {Array} invoiceDataArray - Array of invoice data objects
  * @returns {Object} Result summary
  */
  batchCreate: function (invoiceDataArray) {
    if (!invoiceDataArray || invoiceDataArray.length === 0) {
      return { success: true, created: 0, failed: 0, errors: [] };
    }

    const lock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
    if (!lock) {
      return { success: false, error: 'Unable to acquire lock for batch creation' };
    }

    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const lastRow = invoiceSh.getLastRow();
      const startRow = lastRow + 1;

      const newRowsData = [];
      const errors = [];
      let created = 0;
      let failed = 0;

      // Pre-check all duplicates in memory to avoid multiple `find` calls if possible
      // This is an optimization for larger datasets.
      InvoiceCache.getInvoiceData(); // Ensures cache is populated

      for (let i = 0; i < invoiceDataArray.length; i++) {
        const data = invoiceDataArray[i];
        const currentRowNum = startRow + i;

        try {
          // Check for duplicates using the now-cached data
          const exists = this.find(data.supplier, data.invoiceNo);
          if (exists) {
            errors.push(`Row ${i + 1}: Invoice ${data.invoiceNo} for ${data.supplier} already exists.`);
            failed++;
            continue;
          }

          const invoiceDate = data.invoiceDate || data.timestamp;

          // Build the full row with data and formulas
          const newInvoiceRow = [
            data.timestamp,
            data.supplier,
            data.invoiceNo,
            invoiceDate,
            data.receivedAmt,
            `=IF(C${currentRowNum}="","", IFERROR(SUMIF(PaymentLog!C:C, C${currentRowNum}, PaymentLog!E:E), 0))`,
            `=IF(E${currentRowNum}="","", E${currentRowNum} - F${currentRowNum})`,
            `=IFS(G${currentRowNum}=0,"Paid", G${currentRowNum}=E${currentRowNum},"Unpaid", G${currentRowNum}<E${currentRowNum},"Partial")`,
            '', // Paid Date
            data.sheetName || 'IMPORT',
            `=IF(G${currentRowNum}=0, 0, TODAY() - D${currentRowNum})`,
            IDGenerator.generateInvoiceId(data.sysId || IDGenerator.generateUUID())
          ];

          newRowsData.push(newInvoiceRow);
          created++;

        } catch (error) {
          errors.push(`Row ${i + 1} (${data.invoiceNo}): ${error.message}`);
          failed++;
        }
      }

      // Batch write all new rows at once
      if (newRowsData.length > 0) {
        invoiceSh.getRange(startRow, 1, newRowsData.length, newRowsData[0].length)
          .setValues(newRowsData);
      }

      // Clear cache after all operations are complete
      InvoiceCache.invalidate('create');

      return {
        success: true,
        created: created,
        failed: failed,
        errors: errors,
        message: `Created ${created} invoice(s), ${failed} failed.`
      };

    } catch (error) {
      AuditLogger.logError('InvoiceManager.batchCreate', error.toString());
      return { success: false, error: error.toString() };
    } finally {
      LockManager.releaseLock(lock);
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

function batchCreateInvoices(invoiceDataArray) {
  return InvoiceManager.batchCreate(invoiceDataArray);
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
