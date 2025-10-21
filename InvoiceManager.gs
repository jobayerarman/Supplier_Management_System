/**
 * Invoice management module
 * Handles all invoice-related operations
 * - Creating new invoices
 * - Updating existing invoices
 * - Finding invoice records
 * - Managing invoice formulas
 * 
 * OPTIMIZATIONS:
 * - Intelligent caching with write-through support
 * - Immediate findability after creation (fixes Regular payment bug)
 * - Batch operations for multiple invoice operations
 * - Single getDataRange() call per operation
 * - Lazy formula application
 * - Index-based lookups
 * - Memory-efficient filtering
 */

// ═══ INTELLIGENT CACHE WITH WRITE-THROUGH ═══
/**
 * Optimized Invoice Cache Module
 * ----------------------------------------------------
 * Features:
 *  - Global invoice data cache (in-memory)
 *  - Fast lookup by supplier|invoiceNo
 *  - Supplier-wise index for quick filtering
 *  - TTL-based auto-expiration
 *  - Write-through cache for immediate findability
 *  - Surgical supplier-specific invalidation
 */
const InvoiceCache = {
  data: null,
  indexMap: null,        // "SUPPLIER|INVOICE NO" -> row index
  supplierIndex: null,   // "SUPPLIER" -> [row indices]
  timestamp: null,
  TTL: CONFIG.rules.CACHE_TTL_MS,

  /**
   * Get cached data if valid (within TTL)
   * @returns {{data:Array, indexMap:Map, supplierIndex:Map}|null}
   */
  get: function () {
    const now = Date.now();
    if (this.data && this.timestamp && (now - this.timestamp) < this.TTL) {
      return {
        data: this.data,
        indexMap: this.indexMap,
        supplierIndex: this.supplierIndex
      };
    }
    // Expired or not initialized
    if (this.timestamp && (now - this.timestamp) >= this.TTL) {
      AuditLogger.logWarning('InvoiceCache', 'Cache expired, reloading data');
    }
    return null;
  },

  /**
   * Set new cache with supplier/invoice indexing
   * @param {Array[]} data - Sheet data array
   */
  set: function (data) {
    this.data = data;
    this.timestamp = Date.now();
    this.indexMap = new Map();
    this.supplierIndex = new Map();

    const col = CONFIG.invoiceCols;

    // Start from 1 if row 0 = header
    for (let i = 1; i < data.length; i++) {
      const supplier = StringUtils.normalize(data[i][col.supplier]);
      const invoiceNo = StringUtils.normalize(data[i][col.invoiceNo]);
      if (!supplier || !invoiceNo) continue;

      const key = `${supplier}|${invoiceNo}`;
      this.indexMap.set(key, i);

      if (!this.supplierIndex.has(supplier)) {
        this.supplierIndex.set(supplier, []);
      }
      this.supplierIndex.get(supplier).push(i);
    }
  },

  /**
   * ADD INVOICE TO CACHE (Write-Through with Evaluation)
   * ✓ FIXED: Now reads back evaluated values from sheet
   * 
   * KEY FIX: After writing formulas to sheet, immediately read back
   *          the evaluated values to ensure cache contains numeric data
   * 
   * @param {number} rowNumber - Sheet row number (1-based)
   * @param {Array} rowData - Invoice row data (may contain formulas)
   */
  addInvoiceToCache: function (rowNumber, rowData) {
    // Only add if cache is currently active
    if (!this.data || !this.indexMap || !this.supplierIndex) {
      AuditLogger.logWarning('InvoiceCache.addInvoiceToCache',
        'Cache not initialized, skipping write-through');
      return;
    }

    const col = CONFIG.invoiceCols;
    const supplier = StringUtils.normalize(rowData[col.supplier]);
    const invoiceNo = StringUtils.normalize(rowData[col.invoiceNo]);

    if (!supplier || !invoiceNo) {
      AuditLogger.logWarning('InvoiceCache.addInvoiceToCache',
        'Invalid supplier or invoice number, skipping');
      return;
    }

    try {
      // Calculate array index (row number is 1-based, array is 0-based)
      const arrayIndex = rowNumber - 1;

      // Ensure array is large enough
      while (this.data.length <= arrayIndex) {
        this.data.push([]);
      }

      // ✓ FIX: Read back EVALUATED values from sheet
      // This ensures formulas are calculated and we store numbers, not strings
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const evaluatedData = invoiceSh.getRange(
        rowNumber,
        1,
        1,
        CONFIG.totalColumns.invoice
      ).getValues()[0];

      // ✓ VALIDATION: Detect any formula strings that slipped through
      const hasFormulaStrings = evaluatedData.some((cell, idx) => {
        // Check numeric columns for formula strings
        const numericColumns = [
          col.totalAmount,
          col.totalPaid,
          col.balanceDue,
          col.daysOutstanding
        ];

        if (numericColumns.includes(idx)) {
          return typeof cell === 'string' && cell.startsWith('=');
        }
        return false;
      });

      if (hasFormulaStrings) {
        AuditLogger.logError('InvoiceCache.addInvoiceToCache',
          `WARNING: Formula strings detected in evaluated data for row ${rowNumber}. ` +
          `This indicates formulas haven't been calculated yet. Skipping cache write.`);

        // Don't cache invalid data - better to reload from sheet later
        return;
      }

      // Store evaluated data (contains numbers, not formula strings)
      this.data[arrayIndex] = evaluatedData;

      // Add to indexMap
      const key = `${supplier}|${invoiceNo}`;
      this.indexMap.set(key, arrayIndex);

      // Add to supplierIndex
      if (!this.supplierIndex.has(supplier)) {
        this.supplierIndex.set(supplier, []);
      }
      this.supplierIndex.get(supplier).push(arrayIndex);

      // Enhanced logging with data type verification
      const totalAmount = evaluatedData[col.totalAmount];
      const balanceDue = evaluatedData[col.balanceDue];
      const status = evaluatedData[col.status];

      AuditLogger.logWarning('InvoiceCache.addInvoiceToCache',
        `Added invoice ${invoiceNo} for ${supplier} at row ${rowNumber} to cache | ` +
        `Amount: ${totalAmount} (${typeof totalAmount}) | ` +
        `Due: ${balanceDue} (${typeof balanceDue}) | ` +
        `Status: ${status}`);

    } catch (error) {
      AuditLogger.logError('InvoiceCache.addInvoiceToCache',
        `Failed to add invoice to cache: ${error.toString()}`);
      // Don't throw - cache inconsistency is better than transaction failure
    }
  },

  /**
   * UPDATE INVOICE IN CACHE (After Payment Processing)
   * ✓ NEW: Keeps cache synchronized after payments are recorded
   * 
   * This method ensures that after a payment is processed:
   * 1. Total Paid is recalculated (formula evaluated)
   * 2. Balance Due is updated
   * 3. Status reflects current payment state
   * 4. Days Outstanding is current
   * 
   * CRITICAL: Must be called AFTER payment is written to PaymentLog
   * so that formulas can recalculate based on new SUMIFS results
   * 
   * @param {string} supplier - Supplier name
   * @param {string} invoiceNo - Invoice number
   * @returns {boolean} Success flag
   */
  updateInvoiceInCache: function (supplier, invoiceNo) {
    if (!this.data || !this.indexMap || !this.supplierIndex) {
      AuditLogger.logWarning('InvoiceCache.updateInvoiceInCache',
        'Cache not initialized, skipping update');
      return false;
    }

    if (!supplier || !invoiceNo) {
      AuditLogger.logWarning('InvoiceCache.updateInvoiceInCache',
        'Invalid supplier or invoice number');
      return false;
    }

    try {
      const normalizedSupplier = StringUtils.normalize(supplier);
      const normalizedInvoice = StringUtils.normalize(invoiceNo);
      const key = `${normalizedSupplier}|${normalizedInvoice}`;

      // Find invoice in cache
      const arrayIndex = this.indexMap.get(key);

      if (arrayIndex === undefined) {
        AuditLogger.logWarning('InvoiceCache.updateInvoiceInCache',
          `Invoice ${invoiceNo} not found in cache, skipping update`);
        return false;
      }

      // Calculate sheet row number (array is 0-based, sheet is 1-based)
      const rowNumber = arrayIndex + 1;

      // ✓ KEY FIX: Read EVALUATED values from sheet after payment
      // This captures the recalculated SUMIFS formulas
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const updatedData = invoiceSh.getRange(
        rowNumber,
        1,
        1,
        CONFIG.totalColumns.invoice
      ).getValues()[0];

      // Update cache with fresh evaluated data
      this.data[arrayIndex] = updatedData;

      // const col = CONFIG.invoiceCols;
      // const totalPaid = updatedData[col.totalPaid];
      // const balanceDue = updatedData[col.balanceDue];
      // const status = updatedData[col.status];

      // AuditLogger.logWarning('InvoiceCache.updateInvoiceInCache',
      //   `Updated invoice ${invoiceNo} for ${supplier} in cache | ` +
      //   `Paid: ${totalPaid} | Balance: ${balanceDue} | Status: ${status}`);

      return true;

    } catch (error) {
      AuditLogger.logError('InvoiceCache.updateInvoiceInCache',
        `Failed to update invoice in cache: ${error.toString()}`);
      return false;
    }
  },

  /**
   * Invalidate based on operation type
   * NOTE: 'create' no longer triggers invalidation (uses write-through instead)
   * 
   * @param {string} operation - Action type (updateAmount, updateStatus, etc.)
   */
  invalidate: function (operation) {
    const invalidatingOps = ['updateAmount', 'updateStatus'];
    if (invalidatingOps.includes(operation)) {
      this.clear();
      AuditLogger.logWarning('InvoiceCache', `Cache invalidated due to operation: ${operation}`);
    }
  },

  /**
   * Invalidate all cache (manual or force reload)
   */
  invalidateGlobal: function () {
    this.clear();
    AuditLogger.logInfo('InvoiceCache', 'Global cache invalidated');
  },

  /**
   * Invalidate only one supplier’s cache index
   * (does NOT reload data, just removes supplier from supplierIndex)
   * @param {string} supplier - Supplier name
   */
  invalidateSupplierCache: function (supplier) {
    if (!supplier) return;
    const normalized = StringUtils.normalize(supplier);

    if (this.supplierIndex && this.supplierIndex.has(normalized)) {
      this.supplierIndex.delete(normalized);
      // AuditLogger.logWarning('InvoiceCache', `Supplier cache invalidated: ${supplier}`);
    }
  },

  /**
   * Clear entire cache memory
   */
  clear: function () {
    this.data = null;
    this.indexMap = null;
    this.supplierIndex = null;
    this.timestamp = null;
  },

  /**
   * Lazy load invoice data and build indices
   * @returns {{data:Array,indexMap:Map,supplierIndex:Map}}
   */
  getInvoiceData: function () {
    const cached = this.get();
    if (cached) return cached;

    // Cache miss - load data
    const invoiceSh = getSheet(CONFIG.invoiceSheet);
    const lastRow = invoiceSh.getLastRow();

    if (lastRow < 2) {
      const emptyData = [[]]; // Header placeholder
      this.set(emptyData);
      return {
        data: emptyData,
        indexMap: new Map(),
        supplierIndex: new Map()
      };
    }

    // OPTIMIZED: Read only used range
    const data = invoiceSh.getRange(1, 1, lastRow, CONFIG.totalColumns.invoice).getValues();
    this.set(data);

    return {
      data: this.data,
      indexMap: this.indexMap,
      supplierIndex: this.supplierIndex
    };
  },

  /**
   * Get all invoice rows for a specific supplier
   * @param {string} supplier
   * @returns {Array<{invoiceNo:string,status:string,amount:number,rowIndex:number}>}
   */
  getSupplierData: function (supplier) {
    if (!supplier) return [];
    const normalized = StringUtils.normalize(supplier);
    const { data, supplierIndex } = this.getInvoiceData();

    const rows = supplierIndex.get(normalized) || [];
    if (rows.length === 0) {
      AuditLogger.logWarning('InvoiceCache', `No invoice data found for supplier: ${supplier}`);
      return [];
    }

    return rows.map(i => {
      const row = data[i];
      return {
        invoiceNo: row[CONFIG.invoiceCols.invoiceNo],
        status: row[CONFIG.invoiceCols.paymentStatus],
        amount: row[CONFIG.invoiceCols.totalAmount],
        rowIndex: i
      };
    });
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
      return existingInvoice ? this.update(existingInvoice, data) : this.create(data, existingInvoice);

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
   * OPTIMIZED: InvoiceManager.processOptimized()
   * Returns invoiceId immediately for payment processing
   */
  processOptimized: function(data) {
    try {
      // Skip for Due payments without invoice
      if (data.paymentType === 'Due' && !data.invoiceNo) {
        return { success: true, action: 'none', invoiceId: null };
      }

      // Check existence using cached data
      const existingInvoice = data.invoiceNo ? this.find(data.supplier, data.invoiceNo) : null;
      
      if (existingInvoice) {
        // Update if needed
        const result = this.updateOptimized(existingInvoice, data);
        const invoiceId = existingInvoice.data[CONFIG.invoiceCols.sysId] || 
                          IDGenerator.generateInvoiceId(data.sysId);
        return { 
          ...result, 
          invoiceId: invoiceId
        };
      } else {
        // Create new
        return this.create(data);
      }

    } catch (error) {
      AuditLogger.logError('InvoiceManager.processOptimized', error.toString());
      return { success: false, error: `Invoice processing failed: ${error.message}` };
    }
  },

  /**
   * Create new invoice with write-through cache
   * 
   * @param {Object} data - Transaction data
   * @param {Object} invoice - Pre-checked invoice (optional)
   * @returns {Object} Result with success flag and invoice details
   */
  create: function (data, invoice = null) {
    const lock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
    if (!lock) {
      return { success: false, error: 'Unable to acquire lock for invoice creation' };
    }

    try {
      const { supplier, invoiceNo, sheetName, sysId, receivedAmt, timestamp } = data;

      // Double-check invoice doesn't exist (atomic check with lock)
      const existingInvoice = invoice || this.find(supplier, invoiceNo);

      if (existingInvoice) {
        const msg = `Invoice ${invoiceNo} already exists at row ${existingInvoice.row}`;
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
      const F = `=IF(C${newRow}="","",IFERROR(SUMIFS(PaymentLog!E:E, PaymentLog!C:C,C${newRow}, PaymentLog!B:B,B${newRow}),0))`;
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

      // ═══ WRITE TO SHEET ═══
      invoiceSh.getRange(newRow, 1, 1, newRowData.length).setValues([newRowData]);

      // ═══ ADD TO CACHE (Write-Through) - KEY FIX ═══
      InvoiceCache.addInvoiceToCache(newRow, newRowData);

      // AuditLogger.log('INVOICE_CREATED', data, `Created new invoice ${invoiceNo} at row ${newRow} | Date: ${formattedDate} | Added to cache`);

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
      const col = CONFIG.invoiceCols;
      
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const rowNum = existingInvoice.row;

      const oldTotal = Number(existingInvoice.data[col.totalAmount]) || 0;
      const oldOrigin = String(existingInvoice.data[col.originDay]);
      
      // Check if updates are needed
      const amountChanged = Number(data.receivedAmt) !== oldTotal;
      const originChanged = (String(data.sheetName) !== oldOrigin);
      
      if (!amountChanged && !originChanged) {
        return { success: true, action: 'no_change', row: rowNum };
      }
      
      // Perform only necessary writes in one batch
      const updates = [];
      if (amountChanged) {
        updates.push({ col: col.totalAmount + 1, val: data.receivedAmt });
      }
      if (originChanged) {
        updates.push({ col: col.originDay + 1, val: data.sheetName });
      }

      if (updates.length) {
        const range = invoiceSh.getRange(rowNum, 1, 1, CONFIG.totalColumns.invoice);
        const values = range.getValues()[0];
        updates.forEach(u => (values[u.col - 1] = u.val));
        range.setValues([values]);
      }

      // Cache invalidation only if numeric data changed
      if (amountChanged) InvoiceCache.invalidate('updateAmount');

      // AuditLogger.log('INVOICE_UPDATED', data, `Updated invoice ${existingInvoice.data[col.invoiceNo]} at row ${rowNum} | Amount ${oldTotal} → ${data.receivedAmt }`);

      return { success: true, action: 'updated', row: rowNum };

    } catch (error) {
      AuditLogger.logError('InvoiceManager.update',
        `Failed to update invoice: ${error.toString()}`);
      return { success: false, error: error.toString() };
    }
  },

  /**
   * OPTIMIZED: InvoiceManager.updateOptimized()
   * Only writes if data actually changed
   */
  updateOptimized: function(existingInvoice, data) {
    try {
      const col = CONFIG.invoiceCols;
      const rowNum = existingInvoice.row;
      
      const oldTotal = Number(existingInvoice.data[col.totalAmount]) || 0;
      const oldOrigin = String(existingInvoice.data[col.originDay]);
      const newTotal = Number(data.receivedAmt);
      const newOrigin = String(data.sheetName);
      
      // Early exit if no changes
      if (newTotal === oldTotal && newOrigin === oldOrigin) {
        return { success: true, action: 'no_change', row: rowNum };
      }
      
      // Batch write only changed columns
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const updates = [];
      
      if (newTotal !== oldTotal) {
        updates.push({ col: col.totalAmount + 1, val: newTotal });
      }
      if (newOrigin !== oldOrigin) {
        updates.push({ col: col.originDay + 1, val: newOrigin });
      }
      
      if (updates.length > 0) {
        const range = invoiceSh.getRange(rowNum, 1, 1, CONFIG.totalColumns.invoice);
        const values = range.getValues()[0];
        updates.forEach(u => (values[u.col - 1] = u.val));
        range.setValues([values]);
        
        // Only invalidate supplier cache (not global)
        InvoiceCache.invalidateSupplierCache(data.supplier);
      }

      // AuditLogger.log('INVOICE_UPDATED', data, `Updated invoice ${existingInvoice.data[col.invoiceNo]} | Amount: ${oldTotal} → ${newTotal}`);
      
      return { success: true, action: 'updated', row: rowNum };

    } catch (error) {
      AuditLogger.logError('InvoiceManager.updateOptimized', error.toString());
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
      const col = CONFIG.invoiceCols;
      if (!invoice) return;

      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const balanceDue = Number(invoice.data[col.balanceDue]) || 0;
      const currentPaidDate = invoice.data[col.paidDate];

      // If balance is zero and paid date is empty, set it
      if (balanceDue === 0 && !currentPaidDate) {
        invoiceSh.getRange(invoice.row, col.paidDate + 1)
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
   * OPTIMIZED: InvoiceManager.updatePaidDateOptimized()
   * Only writes if balance is zero and date is empty
   */
  updatePaidDateOptimized: function(invoiceNo, supplier, paymentDate) {
    try {
      const invoice = this.find(supplier, invoiceNo);
      if (!invoice) return;

      const col = CONFIG.invoiceCols;
      const balanceDue = Number(invoice.data[col.balanceDue]) || 0;
      const currentPaidDate = invoice.data[col.paidDate];

      // Only write if conditions met
      if (balanceDue === 0 && !currentPaidDate) {
        const invoiceSh = getSheet(CONFIG.invoiceSheet);
        invoiceSh.getRange(invoice.row, col.paidDate + 1).setValue(paymentDate);

        AuditLogger.log('INVOICE_FULLY_PAID', { invoiceNo, supplier },
          `Invoice fully paid on ${DateUtils.formatDate(paymentDate)}`);
      }
    } catch (error) {
      AuditLogger.logError('InvoiceManager.updatePaidDateOptimized', error.toString());
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
      const col = CONFIG.invoiceCols;

      // TARGETED UPDATE: Set formula for 'Total Paid' (Column F)
      sheet.getRange(row, col.totalPaid + 1)
        .setFormula(`=IF(C${row}="","",IFERROR(SUMIFS(PaymentLog!E:E, PaymentLog!C:C,C${row}, PaymentLog!B:B,B${row}),0))`);

      // TARGETED UPDATE: Set formula for 'Balance Due' (Column G)
      sheet.getRange(row, col.balanceDue + 1)
        .setFormula(`=IF(E${row}="","", E${row} - F${row})`);

      // TARGETED UPDATE: Set formula for 'Status' (Column H)
      sheet.getRange(row, col.status + 1)
        .setFormula(`=IFS(G${row}=0,"Paid", G${row}=E${row},"Unpaid", G${row}<E${row},"Partial")`);

      // TARGETED UPDATE: Set formula for 'Days Outstanding' (Column K)
      sheet.getRange(row, col.daysOutstanding + 1)
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
      AuditLogger.logWarning('InvoiceManager.find', 'Both supplier and invoiceNo are required');
      return null;
    }

    try {
      // Get cached data with index
      const { data, indexMap } = InvoiceCache.getInvoiceData();

      const normalizedSupplier = StringUtils.normalize(supplier);
      const normalizedInvoice = StringUtils.normalize(invoiceNo);
      const key = `${normalizedSupplier}|${normalizedInvoice}`;
      
      const rowIndex = indexMap.get(key);

      if (rowIndex === undefined || rowIndex === null) {
        return null;
      }
      
      return {
        row: rowIndex + 1, // convert to 1-based sheet index
        data: data[rowIndex],
      };

    } catch (error) {
      AuditLogger.logError('InvoiceManager.find', `Failed to find invoice ${invoiceNo} for ${supplier}: ${error.toString()}`);
      return null;
    }
  },

  /**
   * Return all unpaid invoices for a given supplier.
   * Uses InvoiceCache for instant lookup.
   * 
   * @param {string} supplier - Supplier name
   * @returns {Array} Array of unpaid invoice objects
   */
  getUnpaidForSupplier: function (supplier) {
    if (StringUtils.isEmpty(supplier)) return [];

    try {
      // Use cached data
      const { data, supplierIndex } = InvoiceCache.getInvoiceData();

      const normalizedSupplier = StringUtils.normalize(supplier);
      const rows = supplierIndex.get(normalizedSupplier) || [];
      
      if (!rows || rows.length === 0) {
        return [];
      }

      const col = CONFIG.invoiceCols;
      const unpaidInvoices = [];

      for (let i of rows) {
        const row = data[i];
        const status = StringUtils.normalize(row[col.status]);
        const invoiceNo = row[col.invoiceNo];
        const totalAmount = row[col.totalAmount];
        const totalPaid = row[col.totalPaid] || 0;

        if (status === 'Unpaid' || status === 'Partial' || (totalAmount > totalPaid)) {
          unpaidInvoices.push({
            invoiceNo,
            rowIndex: i,
            amount: totalAmount - totalPaid
          });
        }
      }

      return unpaidInvoices;

    } catch (error) {
      AuditLogger.logError('InvoiceManager.getUnpaidForSupplier', `Failed to get unpaid invoices for ${supplier}: ${error.toString()}`);
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
      const col = CONFIG.invoiceCols;
      const normalizedSupplier = StringUtils.normalize(supplier);

      // Single-pass filter and map
      const invoices = [];
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (StringUtils.equals(row[col.supplier], normalizedSupplier)) {
          const balanceDue = Number(row[col.balanceDue]) || 0;

          if (includePaid || balanceDue > 0) {
            invoices.push({
              invoiceNo: row[col.invoiceNo],
              date: row[col.date],
              invoiceDate: row[col.invoiceDate],
              totalAmount: row[col.totalAmount],
              totalPaid: row[col.totalPaid],
              balanceDue: balanceDue,
              status: row[col.status],
              originDay: row[col.originDay],
              daysOutstanding: row[col.daysOutstanding],
              sysId: row[col.sysId]
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
      const col = CONFIG.invoiceCols;

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
        const status = row[col.status];
        const balanceDue = Number(row[col.balanceDue]) || 0;

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
   * Used for "Due" payment type dropdown in daily sheet.
   * 
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Daily sheet
   * @param {number} row - Target row
   * @param {string} supplier - Supplier name
   * @param {string} paymentType - Payment type
   * @returns {boolean} Success flag
   */
  buildUnpaidDropdown: function (sheet, row, supplier, paymentType) {
    const targetCell = sheet.getRange(row, CONFIG.cols.prevInvoice + 1);

    // Clear dropdown if not "Due" or missing supplier
    if (paymentType !== "Due" || StringUtils.isEmpty(supplier)) {
      try {
        targetCell.clearDataValidations()
          .clearNote()
          .setBackground(null);
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
            `=IF(C${currentRowNum}="","",IFERROR(SUMIFS(PaymentLog!E:E, PaymentLog!C:C,C${currentRowNum}, PaymentLog!B:B,B${currentRowNum}),0))`,
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

function buildUnpaidDropdown(sheet, row, supplier, paymentType) {
  return InvoiceManager.buildUnpaidDropdown(sheet, row, supplier, paymentType);
}

function repairAllInvoiceFormulas() {
  return InvoiceManager.repairAllFormulas();
}

function clearInvoiceCache() {
  InvoiceCache.clear();
}

// ==================== TESTING FUNCTIONS ====================

/**
 * Test: Verify invoice is immediately findable after creation
 */
function testImmediateFindability() {
  Logger.log('=== Testing Immediate Invoice Findability ===\n');
  
  const testSupplier = 'TEST_SUPPLIER_CACHE';
  const testInvoice = `INV-TEST-${Date.now()}`;
  
  try {
    // Clear cache to start fresh
    InvoiceCache.invalidateGlobal();
    Logger.log('✓ Cache cleared\n');
    
    // Create test invoice
    const createData = {
      supplier: testSupplier,
      invoiceNo: testInvoice,
      sheetName: '01',
      sysId: IDGenerator.generateUUID(),
      receivedAmt: 1000,
      timestamp: new Date()
    };
    
    Logger.log('Creating invoice...');
    const createResult = InvoiceManager.create(createData);
    
    if (!createResult.success) {
      Logger.log(`✗ FAIL: Invoice creation failed - ${createResult.error}`);
      return false;
    }
    
    Logger.log(`✓ Invoice created at row ${createResult.row}\n`);
    
    // CRITICAL TEST: Try to find invoice IMMEDIATELY (same transaction)
    Logger.log('Attempting immediate find (same transaction)...');
    const foundInvoice = InvoiceManager.find(testSupplier, testInvoice);
    
    if (!foundInvoice) {
      Logger.log('✗ FAIL: Invoice not found immediately after creation!');
      Logger.log('This is the bug we are fixing.\n');
      return false;
    }
    
    Logger.log(`✓ SUCCESS: Invoice found at row ${foundInvoice.row}`);
    Logger.log(`✓ Invoice data: ${foundInvoice.data[CONFIG.invoiceCols.invoiceNo]}`);
    Logger.log(`✓ Amount: ${foundInvoice.data[CONFIG.invoiceCols.totalAmount]}\n`);
    
    // Verify data matches
    if (foundInvoice.row !== createResult.row) {
      Logger.log(`✗ FAIL: Row mismatch - Created: ${createResult.row}, Found: ${foundInvoice.row}`);
      return false;
    }
    
    Logger.log('✓ All checks passed!\n');
    Logger.log('╔═══════════════════════════════════════╗');
    Logger.log('║  ✓ IMMEDIATE FINDABILITY VERIFIED  ║');
    Logger.log('╚═══════════════════════════════════════╝');
    
    // Cleanup: Delete test invoice
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      invoiceSh.deleteRow(createResult.row);
      InvoiceCache.invalidateGlobal();
      Logger.log('\n✓ Test data cleaned up');
    } catch (cleanupError) {
      Logger.log(`\n⚠️ Cleanup failed: ${cleanupError.toString()}`);
    }
    
    return true;
    
  } catch (error) {
    Logger.log(`\n✗ TEST FAILED WITH ERROR: ${error.toString()}`);
    Logger.log(error.stack);
    return false;
  }
}

/**
 * Test: Full Regular payment flow
 */
function testRegularPaymentFlow() {
  Logger.log('\n=== Testing Regular Payment Flow ===\n');
  
  const testSupplier = 'TEST_SUPPLIER_REGULAR';
  const testInvoice = `INV-REG-${Date.now()}`;
  
  try {
    InvoiceCache.invalidateGlobal();
    
    // Simulate Regular payment data
    const data = {
      supplier: testSupplier,
      invoiceNo: testInvoice,
      sheetName: '01',
      sysId: IDGenerator.generateUUID(),
      receivedAmt: 1000,
      paymentAmt: 1000,
      paymentType: 'Regular',
      timestamp: new Date(),
      invoiceDate: new Date(),
      enteredBy: 'test@example.com',
      notes: 'Test regular payment'
    };
    
    Logger.log('Step 1: Create invoice...');
    const invoiceResult = InvoiceManager.create(data);
    
    if (!invoiceResult.success) {
      Logger.log(`✗ Invoice creation failed: ${invoiceResult.error}`);
      return false;
    }
    Logger.log(`✓ Invoice created at row ${invoiceResult.row}\n`);
    
    Logger.log('Step 2: Verify invoice is findable...');
    const foundInvoice = InvoiceManager.find(testSupplier, testInvoice);
    
    if (!foundInvoice) {
      Logger.log('✗ CRITICAL: Invoice not found after creation!');
      return false;
    }
    Logger.log(`✓ Invoice found at row ${foundInvoice.row}\n`);
    
    Logger.log('Step 3: Process payment...');
    const paymentResult = PaymentManager.processOptimized(data, invoiceResult.invoiceId);
    
    if (!paymentResult.success) {
      Logger.log(`✗ Payment processing failed: ${paymentResult.error}`);
      return false;
    }
    
    Logger.log(`✓ Payment processed: ${paymentResult.paymentId}`);
    Logger.log(`✓ Fully paid: ${paymentResult.fullyPaid}`);
    Logger.log(`✓ Paid date updated: ${paymentResult.paidDateUpdated}\n`);
    
    if (!paymentResult.fullyPaid) {
      Logger.log('✗ Expected fully paid for Regular payment');
      return false;
    }
    
    if (!paymentResult.paidDateUpdated) {
      Logger.log('✗ Expected paid date to be updated for Regular payment');
      return false;
    }
    
    Logger.log('╔═══════════════════════════════════════╗');
    Logger.log('║  ✓ REGULAR PAYMENT FLOW SUCCESS    ║');
    Logger.log('╚═══════════════════════════════════════╝');
    
    // Cleanup
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      invoiceSh.deleteRow(invoiceResult.row);
      
      const paymentSh = getSheet(CONFIG.paymentSheet);
      paymentSh.deleteRow(paymentResult.row);
      
      InvoiceCache.invalidateGlobal();
      Logger.log('\n✓ Test data cleaned up');
    } catch (cleanupError) {
      Logger.log(`\n⚠️ Cleanup failed: ${cleanupError.toString()}`);
    }
    
    return true;
    
  } catch (error) {
    Logger.log(`\n✗ TEST FAILED: ${error.toString()}`);
    Logger.log(error.stack);
    return false;
  }
}

/**
 * Run all cache timing tests
 */
function runCacheTimingTests() {
  Logger.log('╔═══════════════════════════════════════════════════╗');
  Logger.log('║     Cache Timing Fix - Verification Tests     ║');
  Logger.log('╚═══════════════════════════════════════════════════╝\n');
  
  const test1 = testImmediateFindability();
  const test2 = testRegularPaymentFlow();
  
  Logger.log('\n' + '═'.repeat(50));
  Logger.log('FINAL RESULTS:');
  Logger.log('═'.repeat(50));
  Logger.log(`Test 1 (Immediate Findability): ${test1 ? '✓ PASS' : '✗ FAIL'}`);
  Logger.log(`Test 2 (Regular Payment Flow):  ${test2 ? '✓ PASS' : '✗ FAIL'}`);
  Logger.log('═'.repeat(50));
  
  if (test1 && test2) {
    Logger.log('\n🎉 ALL TESTS PASSED - Cache timing fix verified!');
  } else {
    Logger.log('\n❌ SOME TESTS FAILED - Review logs above');
  }
}

/**
 * Test: Verify cache stores evaluated values, not formula strings
 */
function testCacheDataTypes() {
  Logger.log('=== Testing Cache Data Type Integrity ===\n');
  
  const testSupplier = 'TEST_SUPPLIER_TYPES';
  const testInvoice = `INV-TYPE-${Date.now()}`;
  
  try {
    // Clear cache
    InvoiceCache.invalidateGlobal();
    
    // Create invoice
    const createData = {
      supplier: testSupplier,
      invoiceNo: testInvoice,
      sheetName: '01',
      sysId: IDGenerator.generateUUID(),
      receivedAmt: 5000,
      timestamp: new Date()
    };
    
    Logger.log('Creating invoice...');
    const createResult = InvoiceManager.create(createData);
    
    if (!createResult.success) {
      Logger.log(`✗ FAIL: ${createResult.error}`);
      return false;
    }
    
    Logger.log(`✓ Invoice created at row ${createResult.row}\n`);
    
    // Find invoice from cache
    Logger.log('Reading from cache...');
    const foundInvoice = InvoiceManager.find(testSupplier, testInvoice);
    
    if (!foundInvoice) {
      Logger.log('✗ FAIL: Invoice not found in cache');
      return false;
    }
    
    // Validate data types
    const col = CONFIG.invoiceCols;
    const checks = [
      { 
        name: 'Total Amount', 
        value: foundInvoice.data[col.totalAmount],
        expected: 'number'
      },
      { 
        name: 'Total Paid', 
        value: foundInvoice.data[col.totalPaid],
        expected: 'number'
      },
      { 
        name: 'Balance Due', 
        value: foundInvoice.data[col.balanceDue],
        expected: 'number'
      },
      { 
        name: 'Status', 
        value: foundInvoice.data[col.status],
        expected: 'string'
      }
    ];
    
    let allPassed = true;
    
    Logger.log('Validating data types:');
    for (const check of checks) {
      const actualType = typeof check.value;
      const isFormula = typeof check.value === 'string' && 
                        check.value.toString().startsWith('=');
      
      if (isFormula) {
        Logger.log(`  ✗ ${check.name}: FORMULA STRING DETECTED: ${check.value}`);
        allPassed = false;
      } else if (actualType !== check.expected) {
        Logger.log(`  ✗ ${check.name}: Expected ${check.expected}, got ${actualType} (${check.value})`);
        allPassed = false;
      } else {
        Logger.log(`  ✓ ${check.name}: ${actualType} = ${check.value}`);
      }
    }
    
    // Cleanup
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      invoiceSh.deleteRow(createResult.row);
      InvoiceCache.invalidateGlobal();
    } catch (e) {
      Logger.log(`\n⚠️ Cleanup failed: ${e.toString()}`);
    }
    
    Logger.log('\n' + '═'.repeat(50));
    if (allPassed) {
      Logger.log('✓ ALL DATA TYPE CHECKS PASSED');
      Logger.log('✓ Cache is storing EVALUATED VALUES');
    } else {
      Logger.log('✗ DATA TYPE VALIDATION FAILED');
      Logger.log('✗ Cache is storing FORMULA STRINGS');
    }
    Logger.log('═'.repeat(50));
    
    return allPassed;
    
  } catch (error) {
    Logger.log(`\n✗ TEST ERROR: ${error.toString()}`);
    Logger.log(error.stack);
    return false;
  }
}

/**
 * Debug function to check cache state
 */
function debugCacheState() {
  Logger.log('=== Cache State Debug ===\n');
  
  const cacheData = InvoiceCache.get();
  
  if (!cacheData) {
    Logger.log('Cache is EMPTY or EXPIRED');
    return;
  }
  
  Logger.log(`Cache timestamp: ${new Date(InvoiceCache.timestamp)}`);
  Logger.log(`Cache age: ${Date.now() - InvoiceCache.timestamp}ms`);
  Logger.log(`Cache TTL: ${InvoiceCache.TTL}ms`);
  Logger.log(`Data rows: ${cacheData.data.length}`);
  Logger.log(`Index entries: ${cacheData.indexMap.size}`);
  Logger.log(`Suppliers indexed: ${cacheData.supplierIndex.size}`);
  
  Logger.log('\nSupplier Index:');
  for (const [supplier, rows] of cacheData.supplierIndex) {
    Logger.log(`  ${supplier}: ${rows.length} invoices`);
  }
}