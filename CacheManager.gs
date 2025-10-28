// ==================== MODULE: CacheManager.gs ====================

/**
 * CacheManager.gs
 * Centralized cache management for invoice data
 *
 * ARCHITECTURE:
 * - Intelligent caching with write-through support
 * - Fast lookup by supplier|invoiceNo (O(1))
 * - Supplier-wise index for quick filtering (O(m))
 * - TTL-based auto-expiration
 * - Surgical supplier-specific invalidation
 *
 * PERFORMANCE BENEFITS:
 * - Eliminates redundant sheet reads during transaction processing
 * - Reduces API calls to Google Sheets
 * - Enables instant invoice lookups
 * - Supports batch operations with in-memory data
 *
 * FEATURES:
 * - Write-through cache for immediate findability
 * - Formula evaluation to ensure numeric data
 * - Cache synchronization after payments
 * - Configurable TTL for automatic expiration
 */

const CacheManager = {
  // ═══ CACHE DATA STRUCTURES ═══
  data: null,           // Full invoice sheet data array
  indexMap: null,       // "SUPPLIER|INVOICE NO" -> row index (O(1) lookup)
  supplierIndex: null,  // "SUPPLIER" -> [row indices] (O(m) supplier queries)
  timestamp: null,      // Cache creation timestamp for TTL
  TTL: CONFIG.rules.CACHE_TTL_MS,  // Time-to-live in milliseconds

  /**
   * Get cached data if valid (within TTL)
   * Returns null if cache is expired or not initialized
   *
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
    return null;
  },

  /**
   * Set new cache with supplier/invoice indexing
   * Builds primary and secondary indices for fast lookups
   *
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

      // Primary index: supplier|invoiceNo -> row index
      const key = `${supplier}|${invoiceNo}`;
      this.indexMap.set(key, i);

      // Secondary index: supplier -> [row indices]
      if (!this.supplierIndex.has(supplier)) {
        this.supplierIndex.set(supplier, []);
      }
      this.supplierIndex.get(supplier).push(i);
    }
  },

  /**
   * ADD INVOICE TO CACHE (Write-Through with Evaluation)
   *
   * CRITICAL FIX: After writing formulas to sheet, immediately reads back
   * evaluated values to ensure cache contains numeric data, not formula strings
   *
   * This enables immediate findability of new invoices without cache reload
   *
   * @param {number} rowNumber - Sheet row number (1-based)
   * @param {Array} rowData - Invoice row data (may contain formulas)
   */
  addInvoiceToCache: function (rowNumber, rowData) {
    // Only add if cache is currently active
    if (!this.data || !this.indexMap || !this.supplierIndex) {
      AuditLogger.logWarning('CacheManager.addInvoiceToCache',
        'Cache not initialized, skipping write-through');
      return;
    }

    const col = CONFIG.invoiceCols;
    const supplier = StringUtils.normalize(rowData[col.supplier]);
    const invoiceNo = StringUtils.normalize(rowData[col.invoiceNo]);

    if (!supplier || !invoiceNo) {
      AuditLogger.logWarning('CacheManager.addInvoiceToCache',
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
        AuditLogger.logError('CacheManager.addInvoiceToCache',
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

    } catch (error) {
      AuditLogger.logError('CacheManager.addInvoiceToCache',
        `Failed to add invoice to cache: ${error.toString()}`);
      // Don't throw - cache inconsistency is better than transaction failure
    }
  },

  /**
   * UPDATE INVOICE IN CACHE (After Payment Processing)
   *
   * Keeps cache synchronized after payments are recorded
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
      AuditLogger.logWarning('CacheManager.updateInvoiceInCache',
        'Cache not initialized, skipping update');
      return false;
    }

    if (!supplier || !invoiceNo) {
      AuditLogger.logWarning('CacheManager.updateInvoiceInCache',
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
        AuditLogger.logWarning('CacheManager.updateInvoiceInCache',
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

      return true;

    } catch (error) {
      AuditLogger.logError('CacheManager.updateInvoiceInCache',
        `Failed to update invoice in cache: ${error.toString()}`);
      return false;
    }
  },

  /**
   * Invalidate cache based on operation type
   *
   * NOTE: 'create' no longer triggers invalidation (uses write-through instead)
   *
   * @param {string} operation - Action type (updateAmount, updateStatus, etc.)
   */
  invalidate: function (operation) {
    const invalidatingOps = ['updateAmount', 'updateStatus'];
    if (invalidatingOps.includes(operation)) {
      this.clear();
    }
  },

  /**
   * Invalidate all cache (manual or force reload)
   * Clears entire cache memory
   */
  invalidateGlobal: function () {
    this.clear();
  },

  /**
   * Invalidate only one supplier's cache index
   *
   * Surgical invalidation - removes supplier from supplierIndex without
   * invalidating entire cache. Used for supplier-specific operations.
   *
   * @param {string} supplier - Supplier name
   */
  invalidateSupplierCache: function (supplier) {
    if (!supplier) return;
    const normalized = StringUtils.normalize(supplier);

    if (this.supplierIndex && this.supplierIndex.has(normalized)) {
      this.supplierIndex.delete(normalized);
    }
  },

  /**
   * Clear entire cache memory
   * Resets all cache data structures
   */
  clear: function () {
    this.data = null;
    this.indexMap = null;
    this.supplierIndex = null;
    this.timestamp = null;
  },

  /**
   * Lazy load invoice data and build indices
   *
   * Returns cached data if valid, otherwise loads from sheet.
   * This is the primary method for accessing invoice data throughout the system.
   *
   * @returns {{data:Array,indexMap:Map,supplierIndex:Map}}
   */
  getInvoiceData: function () {
    const cached = this.get();
    if (cached) return cached;

    // Cache miss - load data from sheet
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
   *
   * Uses supplier index for O(m) performance where m = supplier's invoice count
   *
   * @param {string} supplier - Supplier name
   * @returns {Array<{invoiceNo:string,status:string,amount:number,rowIndex:number}>}
   */
  getSupplierData: function (supplier) {
    if (!supplier) return [];
    const normalized = StringUtils.normalize(supplier);
    const { data, supplierIndex } = this.getInvoiceData();

    const rows = supplierIndex.get(normalized) || [];
    if (rows.length === 0) {
      AuditLogger.logWarning('CacheManager.getSupplierData',
        `No invoice data found for supplier: ${supplier}`);
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

// ==================== BACKWARD COMPATIBILITY ====================

/**
 * Backward compatibility wrapper function
 * Clears the invoice cache
 */
function clearInvoiceCache() {
  CacheManager.clear();
}
