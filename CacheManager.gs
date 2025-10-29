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

  // ═══ PERFORMANCE STATISTICS ═══
  stats: {
    incrementalUpdates: 0,      // Count of incremental updates
    fullReloads: 0,             // Count of full cache reloads
    updateTimes: [],            // Array of update times (ms)
    cacheHits: 0,               // Cache hit count
    cacheMisses: 0,             // Cache miss count
    lastResetTime: Date.now()   // Last stats reset timestamp
  },

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
   * UPDATE SINGLE INVOICE (Incremental Cache Update)
   *
   * Updates only one invoice row without invalidating entire cache.
   * This is a major performance optimization that eliminates full cache reloads.
   *
   * PERFORMANCE: 1-5ms (vs 500ms for full reload)
   * USE CASE: Invoice amount or status changes
   *
   * @param {string} supplier - Supplier name
   * @param {string} invoiceNo - Invoice number
   * @returns {boolean} Success flag
   */
  updateSingleInvoice: function (supplier, invoiceNo) {
    const startTime = Date.now();

    // Validate cache is active
    if (!this.data || !this.indexMap || !this.supplierIndex) {
      AuditLogger.logWarning('CacheManager.updateSingleInvoice',
        'Cache not initialized, cannot perform incremental update');
      return false;
    }

    if (!supplier || !invoiceNo) {
      AuditLogger.logWarning('CacheManager.updateSingleInvoice',
        'Invalid supplier or invoice number');
      return false;
    }

    try {
      // Normalize identifiers
      const normalizedSupplier = StringUtils.normalize(supplier);
      const normalizedInvoice = StringUtils.normalize(invoiceNo);
      const key = `${normalizedSupplier}|${normalizedInvoice}`;

      // Find invoice in cache
      const arrayIndex = this.indexMap.get(key);

      if (arrayIndex === undefined) {
        // Not an error - invoice might be new or cache cold
        AuditLogger.logInfo('CacheManager.updateSingleInvoice',
          `Invoice ${invoiceNo} not in cache, skipping incremental update`);
        return true; // Return true because this is not a failure condition
      }

      // Calculate sheet row number (array is 0-based, sheet is 1-based)
      const rowNumber = arrayIndex + 1;

      // Read single row from sheet (evaluated formulas)
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      const updatedData = invoiceSh.getRange(
        rowNumber,
        1,
        1,
        CONFIG.totalColumns.invoice
      ).getValues()[0];

      // Check if supplier changed (edge case - requires index update)
      const col = CONFIG.invoiceCols;
      const oldSupplier = StringUtils.normalize(this.data[arrayIndex][col.supplier]);
      const newSupplier = StringUtils.normalize(updatedData[col.supplier]);

      if (oldSupplier !== newSupplier) {
        // Supplier changed - update indices
        this._updateSupplierIndices(arrayIndex, oldSupplier, newSupplier, normalizedInvoice);
      }

      // Update cache data
      this.data[arrayIndex] = updatedData;

      // Validate consistency
      if (!this._validateRowConsistency(arrayIndex)) {
        AuditLogger.logError('CacheManager.updateSingleInvoice',
          'Row consistency check failed after update, clearing cache');
        this.clear();
        return false;
      }

      // Update statistics
      const endTime = Date.now();
      const updateTime = endTime - startTime;
      this.stats.incrementalUpdates++;
      this.stats.updateTimes.push(updateTime);

      // Log periodic statistics (every 100 updates)
      if (this.stats.incrementalUpdates % 100 === 0) {
        this._logStatistics();
      }

      return true;

    } catch (error) {
      AuditLogger.logError('CacheManager.updateSingleInvoice',
        `Failed to update invoice ${invoiceNo}: ${error.toString()}`);

      // Fallback: Clear cache for safety
      this.clear();
      return false;
    }
  },

  /**
   * Update supplier indices when supplier changes
   * INTERNAL helper for updateSingleInvoice()
   *
   * @private
   * @param {number} arrayIndex - Array index of invoice
   * @param {string} oldSupplier - Previous supplier (normalized)
   * @param {string} newSupplier - New supplier (normalized)
   * @param {string} invoiceNo - Invoice number (normalized)
   */
  _updateSupplierIndices: function (arrayIndex, oldSupplier, newSupplier, invoiceNo) {
    // Remove from old supplier's index
    if (this.supplierIndex.has(oldSupplier)) {
      const rows = this.supplierIndex.get(oldSupplier);
      const filtered = rows.filter(i => i !== arrayIndex);
      if (filtered.length > 0) {
        this.supplierIndex.set(oldSupplier, filtered);
      } else {
        this.supplierIndex.delete(oldSupplier);
      }
    }

    // Add to new supplier's index
    if (!this.supplierIndex.has(newSupplier)) {
      this.supplierIndex.set(newSupplier, []);
    }
    this.supplierIndex.get(newSupplier).push(arrayIndex);

    // Update primary index key
    const oldKey = `${oldSupplier}|${invoiceNo}`;
    const newKey = `${newSupplier}|${invoiceNo}`;
    this.indexMap.delete(oldKey);
    this.indexMap.set(newKey, arrayIndex);

    AuditLogger.logInfo('CacheManager._updateSupplierIndices',
      `Supplier changed for invoice ${invoiceNo}: ${oldSupplier} → ${newSupplier}`);
  },

  /**
   * Validate row consistency after update
   * INTERNAL helper to detect cache corruption
   *
   * @private
   * @param {number} arrayIndex - Array index to validate
   * @returns {boolean} True if consistent
   */
  _validateRowConsistency: function (arrayIndex) {
    try {
      // Check data exists
      if (!this.data[arrayIndex]) {
        return false;
      }

      const col = CONFIG.invoiceCols;
      const row = this.data[arrayIndex];
      const supplier = StringUtils.normalize(row[col.supplier]);
      const invoiceNo = StringUtils.normalize(row[col.invoiceNo]);

      // Check both identifiers are present
      if (!supplier || !invoiceNo) {
        return false;
      }

      const key = `${supplier}|${invoiceNo}`;

      // Primary index should point to this row
      if (this.indexMap.get(key) !== arrayIndex) {
        return false;
      }

      // Supplier index should contain this row
      const supplierRows = this.supplierIndex.get(supplier);
      if (!supplierRows || !supplierRows.includes(arrayIndex)) {
        return false;
      }

      return true;

    } catch (error) {
      AuditLogger.logError('CacheManager._validateRowConsistency',
        `Validation error: ${error.toString()}`);
      return false;
    }
  },

  /**
   * Log cache performance statistics
   * INTERNAL helper for monitoring
   *
   * @private
   */
  _logStatistics: function () {
    const avgUpdateTime = this.stats.updateTimes.length > 0
      ? this.stats.updateTimes.reduce((a, b) => a + b, 0) / this.stats.updateTimes.length
      : 0;

    const hitRate = this.stats.cacheHits + this.stats.cacheMisses > 0
      ? (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) * 100).toFixed(2)
      : 0;

    AuditLogger.logInfo('CacheManager.statistics',
      `Incremental Updates: ${this.stats.incrementalUpdates} | ` +
      `Full Reloads: ${this.stats.fullReloads} | ` +
      `Avg Update Time: ${avgUpdateTime.toFixed(2)}ms | ` +
      `Cache Hit Rate: ${hitRate}%`);

    // Reset update times array to prevent memory growth
    if (this.stats.updateTimes.length > 1000) {
      this.stats.updateTimes = this.stats.updateTimes.slice(-100);
    }
  },

  /**
   * Invalidate cache based on operation type
   *
   * ENHANCED: Now supports incremental updates for specific operations
   * If supplier and invoiceNo provided → incremental update (1ms)
   * Otherwise → full invalidation (500ms on next access)
   *
   * @param {string} operation - Action type (updateAmount, updateStatus, etc.)
   * @param {string} supplier - Optional: Supplier name for incremental update
   * @param {string} invoiceNo - Optional: Invoice number for incremental update
   */
  invalidate: function (operation, supplier = null, invoiceNo = null) {
    const incrementalOps = ['updateAmount', 'updateStatus', 'updateDate'];

    // Incremental update if target specified
    if (incrementalOps.includes(operation) && supplier && invoiceNo) {
      const success = this.updateSingleInvoice(supplier, invoiceNo);

      if (!success) {
        // Fallback to full clear if incremental fails
        AuditLogger.logWarning('CacheManager.invalidate',
          `Incremental update failed for ${supplier}|${invoiceNo}, falling back to full clear`);
        this.clear();
        this.stats.fullReloads++;
      }
      return;
    }

    // Full invalidation for operations requiring it
    const fullInvalidateOps = ['updateAmount', 'updateStatus', 'schemaChange', 'bulkUpdate'];
    if (fullInvalidateOps.includes(operation)) {
      this.clear();
      this.stats.fullReloads++;
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
