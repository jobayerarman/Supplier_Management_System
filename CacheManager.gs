// ==================== MODULE: CacheManager.gs ====================
/**
 * Sole owner of all in-memory caches: invoice data (CacheManager) and
 * payment data (PaymentCache). Any lifecycle pattern change — e.g. adding
 * a CacheService layer or adjusting TTL strategy — is applied once here.
 *
 * ARCHITECTURE:
 * - CacheManager: partitioned invoice cache (Active vs Inactive)
 * - PaymentCache: flat payment cache with quad-index structure
 * - Shared _cacheAddToIndex() utility used by both caches
 * - TTL-based auto-expiration with write-through support
 *
 * PERFORMANCE:
 * - Invoice lookups: O(1) via supplier|invoiceNo key
 * - Payment lookups: O(1) via invoice, supplier, combined, or payment-ID index
 * - Partitioning reduces active invoice cache size by 70-90%
 * - Incremental invoice updates: ~1ms vs ~500ms full reload
 *
 * ORGANIZATION:
 * 1. Shared Utilities  (_cacheAddToIndex)
 * 2. Invoice Cache     (CacheManager)
 * 3. Payment Cache     (PaymentCache)
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: SHARED UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shared index helper for CacheManager and PaymentCache.
 * Appends value to the array stored at index[key], creating it if absent.
 * @param {Map}    index - The index map to update
 * @param {string} key   - Lookup key
 * @param {*}      value - Value to append
 */
function _cacheAddToIndex(index, key, value) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: INVOICE CACHE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Invoice Cache Module
 * ----------------------------------------------------
 * Features:
 *  - Partitioned cache (Active vs Inactive invoices)
 *  - Fast lookup by supplier|invoiceNo (O(1))
 *  - Supplier-wise index for quick filtering (O(m))
 *  - TTL-based auto-expiration (60 seconds)
 *  - Surgical supplier-specific invalidation
 *  - Write-through cache for immediate findability
 *
 * Performance:
 *  - Partitioning reduces active cache size by 70-90%
 *  - Eliminates redundant sheet reads during transaction processing
 *  - Incremental updates: 1ms vs 500ms full reload
 */
const CacheManager = {
  timestamp: null,      // Cache creation timestamp for TTL
  TTL: CONFIG.rules.CACHE_TTL_MS,

  // ═══ CACHESERVICE PERSISTENCE (cross-execution) ═══
  CACHE_SERVICE_TTL_S:     CONFIG.rules.CACHE_SERVICE_TTL_S,
  CACHE_SERVICE_MAX_BYTES: CONFIG.rules.CACHE_SERVICE_MAX_BYTES,
  _serviceKey: null,               // memoised; computed on first use (includes spreadsheet ID)

  // Active partition: Unpaid and Partial invoices (hot data - 10-30% of total)
  activeData: null,         // Active invoices array
  activeIndexMap: null,     // "SUPPLIER|INVOICE NO" -> activeData index
  activeSupplierIndex: null,// "SUPPLIER" -> [activeData indices]

  // Inactive partition: Paid invoices (cold data - 70-90% of total)
  inactiveData: null,       // Inactive invoices array
  inactiveIndexMap: null,   // "SUPPLIER|INVOICE NO" -> inactiveData index
  inactiveSupplierIndex: null, // "SUPPLIER" -> [inactiveData indices]

  // Global lookup map for finding invoices across partitions
  globalIndexMap: null,     // "SUPPLIER|INVOICE NO" -> {partition: 'active'|'inactive', index: number}

  // Recent write timestamps for 100ms SUMIFS deferral (see markPaymentWritten)
  _recentWrites: new Map(),

  // ═══ PERFORMANCE STATISTICS ═══
  stats: {
    incrementalUpdates: 0,      // Count of incremental updates
    fullReloads: 0,             // Count of full cache reloads
    cacheHits: 0,               // Cache hit count
    cacheMisses: 0,             // Cache miss count
    partitionTransitions: 0,    // Count of active→inactive transitions
    activePartitionHits: 0,     // Lookups found in active partition
    inactivePartitionHits: 0,   // Lookups found in inactive partition
    lastResetTime: Date.now()   // Last stats reset timestamp
  },

  /**
   * Returns cached invoice partition data if initialized and within TTL, null otherwise.
   * @returns {{activeData:Array, activeIndexMap:Map, activeSupplierIndex:Map, inactiveData:Array, inactiveIndexMap:Map, inactiveSupplierIndex:Map, globalIndexMap:Map}|null}
   */
  get: function () {
    const now = Date.now();
    if (this.activeData && this.timestamp && (now - this.timestamp) < this.TTL) {
      this.stats.cacheHits++;
      return this._snapshot();
    }
    // Expired or not initialized
    this.stats.cacheMisses++;
    return null;
  },

  /**
   * Set new cache with partition-only indexing
   *
   * @param {Array[]} data - Sheet data array
   */
  set: function (data) {
    this.timestamp = Date.now();

    // Initialize partition indices
    this.activeIndexMap = new Map();
    this.activeSupplierIndex = new Map();
    this.inactiveIndexMap = new Map();
    this.inactiveSupplierIndex = new Map();
    this.globalIndexMap = new Map();

    // Initialize partition data arrays
    this.activeData = [data[0]];  // Include header
    this.inactiveData = [data[0]]; // Include header

    const col = CONFIG.invoiceCols;

    // Build partitions - iterate once, track original sheet row numbers
    for (let i = 1; i < data.length; i++) {
      const supplier = StringUtils.normalize(data[i][col.supplier]);
      const invoiceNo = StringUtils.normalize(data[i][col.invoiceNo]);
      if (!supplier || !invoiceNo) continue;

      const key = `${supplier}|${invoiceNo}`;
      const sheetRow = i + 1; // Convert array index to sheet row (1-based)
      const isActive = this._isActiveInvoice(data[i]);
      this._addRowToPartition(key, supplier, data[i], isActive, sheetRow);
    }

    this.stats.fullReloads++;
    this._persistActiveToService();
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CACHESERVICE PERSISTENCE HELPERS (cross-execution)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Returns the CacheService key for this spreadsheet (memoised).
   * Includes the spreadsheet ID to prevent cross-file collisions.
   * @private
   * @returns {string}
   */
  _getServiceKey: function() {
    if (!this._serviceKey) {
      this._serviceKey =
        'cache_v1_invoices_active_' +
        SpreadsheetApp.getActiveSpreadsheet().getId();
    }
    return this._serviceKey;
  },

  /**
   * Serialise the active partition and write it to CacheService.
   * Silent on any error — cache failures must never block transactions.
   * Skips the write if the payload exceeds CACHE_SERVICE_MAX_BYTES.
   * @private
   */
  _persistActiveToService: function() {
    try {
      if (!this.activeData) return;
      const payload = JSON.stringify({
        version: 1,
        timestamp: this.timestamp,
        activeData:            this.activeData,
        activeIndexEntries:    [...this.activeIndexMap.entries()],
        activeSupplierEntries: [...this.activeSupplierIndex.entries()],
        globalActiveEntries:   [...this.globalIndexMap.entries()]
                                 .filter(([, v]) => v.partition === 'active')
      });
      if (payload.length > this.CACHE_SERVICE_MAX_BYTES) return; // size guard
      CacheService.getScriptCache().put(
        this._getServiceKey(), payload, this.CACHE_SERVICE_TTL_S
      );
    } catch (e) { /* silent — must never block transactions */ }
  },

  /**
   * Read the active partition from CacheService and populate runtime memory.
   * Initialises inactive structures as empty Maps so callers using ?. / || []
   * degrade gracefully without null-deref errors.
   * A JSON reviver restores Date objects that were serialised as ISO strings.
   * @private
   * @returns {boolean} True on successful restore, false on miss / error / version mismatch
   */
  _restoreActiveFromService: function() {
    try {
      const raw = CacheService.getScriptCache().get(this._getServiceKey());
      if (!raw) return false;

      const dateRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      const p = JSON.parse(raw, (k, v) =>
        typeof v === 'string' && dateRe.test(v) ? new Date(v) : v
      );
      if (p.version !== 1) return false;

      this.activeData          = p.activeData;
      this.activeIndexMap      = new Map(p.activeIndexEntries);
      this.activeSupplierIndex = new Map(p.activeSupplierEntries);
      this.globalIndexMap      = new Map(p.globalActiveEntries);

      // Inactive not persisted — empty Maps so callers degrade gracefully
      this.inactiveData          = [this.activeData[0]]; // header row only
      this.inactiveIndexMap      = new Map();
      this.inactiveSupplierIndex = new Map();

      this.timestamp = Date.now(); // fresh 60 s runtime window from this execution
      this.stats.cacheHits++;
      return true;
    } catch (e) { return false; }
  },

  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Determine if invoice belongs to active partition
   * Active = Unpaid or Partially Paid (balanceDue > 0.01)
   * Inactive = Fully Paid (balanceDue <= 0.01)
   *
   * @private
   * @param {Array} rowData - Invoice row data
   * @returns {boolean} True if invoice is active
   */
  _isActiveInvoice: function (rowData) {
    const col = CONFIG.invoiceCols;
    const balanceDue = rowData[col.balanceDue];

    // If balanceDue is a formula string (sheet hasn't evaluated it yet),
    // fall back to totalAmount to determine partition for new invoices.
    // Number('=D2-E2') returns NaN → 0, which would wrongly place the invoice in INACTIVE.
    if (typeof balanceDue === 'string' && balanceDue.startsWith('=')) {
      return (Number(rowData[col.totalAmount]) || 0) > 0.01;
    }

    // Normal case: numeric evaluated value
    return Math.abs(Number(balanceDue) || 0) > 0.01;
  },

  /**
   * Helper: Add a value to an index map (creates array if key doesn't exist).
   * @private
   * @param {Map}    index - The index map to update
   * @param {string} key   - Lookup key
   * @param {*}      value - Value to append
   */
  _addToIndex: function(index, key, value) {
    _cacheAddToIndex(index, key, value);
  },

  /**
   * Add a row to the appropriate partition (active or inactive).
   * Updates indexMap, supplierIndex, and globalIndexMap atomically.
   *
   * @private
   * @param {string}  key      - "SUPPLIER|INVOICE_NO" lookup key
   * @param {string}  supplier - Normalized supplier name
   * @param {Array}   rowData  - Invoice row data array
   * @param {boolean} isActive - True → active partition, false → inactive
   * @param {number}  sheetRow - 1-based sheet row number for future re-reads
   */
  _addRowToPartition: function(key, supplier, rowData, isActive, sheetRow) {
    if (isActive) {
      const idx = this.activeData.length;
      this.activeData.push(rowData);
      this.activeIndexMap.set(key, idx);
      this._addToIndex(this.activeSupplierIndex, supplier, idx);
      this.globalIndexMap.set(key, { partition: 'active', index: idx, sheetRow: sheetRow });
    } else {
      const idx = this.inactiveData.length;
      this.inactiveData.push(rowData);
      this.inactiveIndexMap.set(key, idx);
      this._addToIndex(this.inactiveSupplierIndex, supplier, idx);
      this.globalIndexMap.set(key, { partition: 'inactive', index: idx, sheetRow: sheetRow });
    }
  },

  /**
   * Apply a partition transition for an updated invoice row.
   * Handles active→inactive, inactive→active, and in-place updates.
   * Does NOT update stats — callers are responsible for stat increments.
   *
   * @private
   * @param {string}  key         - "SUPPLIER|INVOICE_NO" lookup key
   * @param {string}  supplier    - Normalized supplier name
   * @param {Array}   updatedData - Fresh row data read from sheet
   * @param {Object}  location    - globalIndexMap entry {partition, index, sheetRow}
   * @returns {boolean} True if a partition transition occurred
   */
  _applyPartitionTransition: function(key, supplier, updatedData, location) {
    const wasActive = (location.partition === 'active');
    const isActive = this._isActiveInvoice(updatedData);

    if (wasActive && !isActive) {
      this._moveToInactivePartition(key, supplier, updatedData);
      this.globalIndexMap.get(key).partition = 'inactive';
      return true;
    } else if (!wasActive && isActive) {
      this._moveToActivePartition(key, supplier, updatedData);
      this.globalIndexMap.get(key).partition = 'active';
      return true;
    } else {
      // Update in-place (same partition)
      if (wasActive) {
        this.activeData[location.index] = updatedData;
      } else {
        this.inactiveData[location.index] = updatedData;
      }
      return false;
    }
  },

  /**
   * Build the standard partition-data result object from current state.
   * Called by get() on cache hit and by getInvoiceData() after a cache miss load.
   *
   * @private
   * @returns {{activeData:Array, activeIndexMap:Map, activeSupplierIndex:Map, inactiveData:Array, inactiveIndexMap:Map, inactiveSupplierIndex:Map, globalIndexMap:Map}}
   */
  _snapshot: function() {
    return {
      activeData: this.activeData,
      activeIndexMap: this.activeIndexMap,
      activeSupplierIndex: this.activeSupplierIndex,
      inactiveData: this.inactiveData,
      inactiveIndexMap: this.inactiveIndexMap,
      inactiveSupplierIndex: this.inactiveSupplierIndex,
      globalIndexMap: this.globalIndexMap
    };
  },

  /**
   * Write-through add: inserts a newly created invoice row directly into the
   * appropriate partition without re-reading from the sheet. Trusts pre-calculated
   * values and records the write timestamp for SUMIFS deferral.
   *
   * @param {number} rowNumber - Sheet row number (1-based) stored for targeted re-reads
   * @param {Array}  rowData   - Invoice row data (pre-calculated values)
   */
  addInvoiceToCache: function (rowNumber, rowData) {
    // Only add if cache is currently active
    if (!this.activeData) {
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
      const key = `${supplier}|${invoiceNo}`;
      const isActive = this._isActiveInvoice(rowData);
      this._addRowToPartition(key, supplier, rowData, isActive, rowNumber);
      if (isActive) {
        this.stats.activePartitionHits++;
      } else {
        this.stats.inactivePartitionHits++;
      }

      // Track write time for smart refresh deferral
      this._recentWrites.set(key, Date.now());

      if (isActive) this._persistActiveToService();

    } catch (error) {
      AuditLogger.logError('CacheManager.addInvoiceToCache',
        `Failed to add invoice to cache: ${error.toString()}`);
    }
  },

  /**
   * Public alias for updateSingleInvoice().
   * @param {string}  supplier  - Supplier name
   * @param {string}  invoiceNo - Invoice number
   * @param {boolean} [forceRead=false] - Force immediate sheet read
   * @returns {boolean} Success flag
   */
  updateInvoiceInCache: function (supplier, invoiceNo, forceRead = false) {
    return this.updateSingleInvoice(supplier, invoiceNo, forceRead);
  },

  /**
   * PATCH A SINGLE FIELD in the in-memory cache without re-reading from sheet.
   *
   * Safe only for fields that are NOT recalculated by SUMIFS (e.g. paidDate).
   * SUMIFS-computed fields (totalPaid, balanceDue, status) must still go through
   * updateSingleInvoice / invalidateSupplierCache.
   *
   * @param {string} supplier  - Supplier name
   * @param {string} invoiceNo - Invoice number
   * @param {number} colIndex  - 0-based column index to patch (from CONFIG.invoiceCols)
   * @param {*}      value     - New value to store
   * @returns {boolean} True if patch was applied, false if invoice not in cache
   */
  patchInvoiceField: function(supplier, invoiceNo, colIndex, value) {
    if (!this.globalIndexMap) return false;

    const key = `${StringUtils.normalize(supplier)}|${StringUtils.normalize(invoiceNo)}`;
    const location = this.globalIndexMap.get(key);
    if (!location) return false;

    const rowData = location.partition === 'active'
      ? this.activeData[location.index]
      : this.inactiveData[location.index];

    if (!rowData) return false;

    rowData[colIndex] = value;
    this._persistActiveToService();
    return true;
  },

  /**
   * Refreshes a single invoice row in-place without invalidating the entire cache.
   * Defers the sheet re-read by 100ms when the invoice was recently written
   * (avoids reading before SUMIFS recalculates). Handles active↔inactive
   * partition transitions automatically.
   *
   * @param {string}  supplier   - Supplier name
   * @param {string}  invoiceNo  - Invoice number
   * @param {boolean} [forceRead=false] - Skip the 100ms deferral and read immediately
   * @returns {boolean} True on success or cache-miss (no-op), false on error
   */
  updateSingleInvoice: function (supplier, invoiceNo, forceRead = false) {
    // Validate cache is active
    if (!this.activeData || !this.globalIndexMap) {
      return false;
    }

    if (!supplier || !invoiceNo) {
      return false;
    }

    try {
      const normalizedSupplier = StringUtils.normalize(supplier);
      const normalizedInvoice = StringUtils.normalize(invoiceNo);
      const key = `${normalizedSupplier}|${normalizedInvoice}`;

      // Find invoice in globalIndexMap
      const location = this.globalIndexMap.get(key);

      if (!location) {
        // Not in cache - skip update (will be loaded on next cache refresh)
        return true;
      }

      // Defer read if recently written (avoid reading before SUMIFS evaluates)
      const now = Date.now();
      const writeTime = this._recentWrites.get(key);

      if (writeTime && (now - writeTime) < 100 && !forceRead) {
        // Defer - will refresh on next TTL expiration
        return true;
      }

      // Read from sheet using tracked row number
      const invoiceSh = CONFIG.isMasterMode()
        ? MasterDatabaseUtils.getTargetSheet('invoice')
        : MasterDatabaseUtils.getSourceSheet('invoice');

      const updatedData = invoiceSh.getRange(
        location.sheetRow,
        1,
        1,
        CONFIG.totalColumns.invoice
      ).getValues()[0];

      if (this._applyPartitionTransition(key, normalizedSupplier, updatedData, location)) {
        this.stats.partitionTransitions++;
      }
      this.stats.incrementalUpdates++;
      this._persistActiveToService();

      return true;

    } catch (error) {
      AuditLogger.logError('CacheManager.updateSingleInvoice',
        `Failed to update invoice ${invoiceNo}: ${error.toString()}`);
      this.clear();
      return false;
    }
  },


  /**
   * Move invoice from active to inactive partition
   * Called when invoice becomes fully paid
   *
   * @private
   * @param {string} key - "SUPPLIER|INVOICE_NO" key
   * @param {string} supplier - Normalized supplier name
   * @param {Array} rowData - Updated invoice row data
   */
  _moveToInactivePartition: function (key, supplier, rowData) {
    // Remove from active partition
    const activeIndex = this.activeIndexMap.get(key);
    if (activeIndex !== undefined) {
      // Mark as deleted in active data (preserve indices)
      this.activeData[activeIndex] = null;
      this.activeIndexMap.delete(key);

      // Remove from active supplier index
      if (this.activeSupplierIndex.has(supplier)) {
        const rows = this.activeSupplierIndex.get(supplier);
        const filtered = rows.filter(i => i !== activeIndex);
        if (filtered.length > 0) {
          this.activeSupplierIndex.set(supplier, filtered);
        } else {
          this.activeSupplierIndex.delete(supplier);
        }
      }
    }

    // Add to inactive partition
    const inactiveIndex = this.inactiveData.length;
    this.inactiveData.push(rowData);
    this.inactiveIndexMap.set(key, inactiveIndex);
    this._addToIndex(this.inactiveSupplierIndex, supplier, inactiveIndex);

    // Sync globalIndexMap.index to the new inactive position.
    // Without this, findInvoice reads the stale active index from inactiveData,
    // returning the wrong invoice row after an active→inactive transition.
    if (this.globalIndexMap.has(key)) {
      this.globalIndexMap.get(key).index = inactiveIndex;
    }
  },

  /**
   * Move invoice from inactive to active partition
   * Called when paid invoice is reopened (rare edge case)
   *
   * @private
   * @param {string} key - "SUPPLIER|INVOICE_NO" key
   * @param {string} supplier - Normalized supplier name
   * @param {Array} rowData - Updated invoice row data
   */
  _moveToActivePartition: function (key, supplier, rowData) {
    // Remove from inactive partition
    const inactiveIndex = this.inactiveIndexMap.get(key);
    if (inactiveIndex !== undefined) {
      // Mark as deleted in inactive data (preserve indices)
      this.inactiveData[inactiveIndex] = null;
      this.inactiveIndexMap.delete(key);

      // Remove from inactive supplier index
      if (this.inactiveSupplierIndex.has(supplier)) {
        const rows = this.inactiveSupplierIndex.get(supplier);
        const filtered = rows.filter(i => i !== inactiveIndex);
        if (filtered.length > 0) {
          this.inactiveSupplierIndex.set(supplier, filtered);
        } else {
          this.inactiveSupplierIndex.delete(supplier);
        }
      }
    }

    // Add to active partition
    const activeIndex = this.activeData.length;
    this.activeData.push(rowData);
    this.activeIndexMap.set(key, activeIndex);
    this._addToIndex(this.activeSupplierIndex, supplier, activeIndex);

    // Sync globalIndexMap.index to the new active position.
    if (this.globalIndexMap.has(key)) {
      this.globalIndexMap.get(key).index = activeIndex;
    }
  },

  /**
   * Invalidates the cache based on operation type and available coordinates.
   * When supplier + invoiceNo are provided for an incremental operation, only
   * that row is refreshed (~1ms). Otherwise the entire cache is cleared and
   * reloaded on next access (~500ms).
   *
   * @param {string}      operation - Action type: 'updateAmount' | 'updateStatus' | 'updateDate' | 'schemaChange' | 'bulkUpdate'
   * @param {string|null} [supplier=null]  - Supplier name for incremental update
   * @param {string|null} [invoiceNo=null] - Invoice number for incremental update
   */
  invalidate: function (operation, supplier = null, invoiceNo = null) {
    const incrementalOps = ['updateAmount', 'updateStatus', 'updateDate'];

    // Incremental path: only when target coordinates are known
    if (incrementalOps.includes(operation) && supplier && invoiceNo) {
      const success = this.updateSingleInvoice(supplier, invoiceNo);
      if (!success) {
        // Fallback: incremental failed, do full clear so next access reloads
        AuditLogger.logWarning('CacheManager.invalidate',
          `Incremental update failed for ${supplier}|${invoiceNo}, falling back to full clear`);
        this.clear();
        this.stats.fullReloads++;
      }
      return;
    }

    // Full clear: explicit full-invalidate ops, OR incremental ops without coordinates
    // Note: 'updateAmount'/'updateStatus' without supplier+invoiceNo also land here
    const fullInvalidateOps = ['schemaChange', 'bulkUpdate'];
    if (fullInvalidateOps.includes(operation) || incrementalOps.includes(operation)) {
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
   * Refreshes all cached invoices for a single supplier without touching the
   * rest of the cache. Issues one batch sheet read covering all of that
   * supplier's rows (active + inactive), then applies partition transitions.
   *
   * @param {string} supplier - Supplier name to refresh
   */
  invalidateSupplierCache: function (supplier) {
    if (!supplier || !this.globalIndexMap) {
      // Cache not initialized or no supplier - nothing to do
      return;
    }

    try {
      const normalizedSupplier = StringUtils.normalize(supplier);

      // Get invoices from both partitions
      const activeRows = this.activeSupplierIndex?.get(normalizedSupplier) || [];
      const inactiveRows = this.inactiveSupplierIndex?.get(normalizedSupplier) || [];

      if (activeRows.length === 0 && inactiveRows.length === 0) {
        return;
      }

      const invoiceSh = CONFIG.isMasterMode()
        ? MasterDatabaseUtils.getTargetSheet('invoice')
        : MasterDatabaseUtils.getSourceSheet('invoice');

      const col = CONFIG.invoiceCols;

      // Collect sheet-row numbers for both partitions in a single pass.
      // One batch API read covers all rows regardless of N invoices.
      const invoiceEntries = [];
      for (const idx of activeRows) {
        const currentData = this.activeData[idx];
        if (!currentData) continue;
        const invoiceNo = StringUtils.normalize(currentData[col.invoiceNo]);
        const key = `${normalizedSupplier}|${invoiceNo}`;
        const location = this.globalIndexMap.get(key);
        if (!location) continue;
        invoiceEntries.push({ key, location });
      }
      for (const idx of inactiveRows) {
        const currentData = this.inactiveData[idx];
        if (!currentData) continue;
        const invoiceNo = StringUtils.normalize(currentData[col.invoiceNo]);
        const key = `${normalizedSupplier}|${invoiceNo}`;
        const location = this.globalIndexMap.get(key);
        if (!location) continue;
        invoiceEntries.push({ key, location });
      }

      // One batch read covering minRow..maxRow  (1 API call regardless of N invoices)
      const rowMap = new Map(); // sheetRow → rowData
      if (invoiceEntries.length > 0) {
        const sheetRows = invoiceEntries.map(e => e.location.sheetRow);
        const minRow = Math.min(...sheetRows);
        const maxRow = Math.max(...sheetRows);
        const batchValues = invoiceSh.getRange(
          minRow, 1, maxRow - minRow + 1, CONFIG.totalColumns.invoice
        ).getValues();
        sheetRows.forEach(r => rowMap.set(r, batchValues[r - minRow]));
      }

      for (const { key, location } of invoiceEntries) {
        try {
          // Use pre-fetched row data from the batch read above
          const updatedData = rowMap.get(location.sheetRow);
          if (!updatedData) continue;

          this._applyPartitionTransition(key, normalizedSupplier, updatedData, location);

        } catch (rowError) {
          AuditLogger.logError('CacheManager.invalidateSupplierCache',
            `Failed to update invoice for supplier "${supplier}": ${rowError.toString()}`);
        }
      }
      this._persistActiveToService();
    } catch (error) {
      // Fallback: Clear entire cache if surgical update fails
      AuditLogger.logError('CacheManager.invalidateSupplierCache',
        `Surgical update failed for supplier "${supplier}": ${error.toString()}, falling back to full clear`);
      this.clear();
    }
  },

  /**
   * Signal that a payment was just written to PaymentLog for this invoice.
   * Prevents the cache from reading InvoiceDatabase before SUMIFS recalculates.
   * The _recentWrites 100ms defer in updateSingleInvoice will skip the re-read.
   *
   * Call this BEFORE invalidateSupplierCache() after a payment write.
   * See CLAUDE.md Critical Gotcha #2.
   *
   * @param {string} supplier
   * @param {string} invoiceNo
   */
  markPaymentWritten: function(supplier, invoiceNo) {
    if (!supplier || !invoiceNo) return;
    const key = `${StringUtils.normalize(supplier)}|${StringUtils.normalize(invoiceNo)}`;
    this._recentWrites.set(key, Date.now());
  },

  /**
   * Clear entire cache memory
   * Resets all partition data structures and global index
   */
  clear: function () {
    this.timestamp = null;

    // Partition cache structures
    this.activeData = null;
    this.activeIndexMap = null;
    this.activeSupplierIndex = null;
    this.inactiveData = null;
    this.inactiveIndexMap = null;
    this.inactiveSupplierIndex = null;

    // Global cross-partition index
    this.globalIndexMap = null;

    // Recent write timestamps (reset to bound memory growth)
    this._recentWrites = new Map();
    try { CacheService.getScriptCache().remove(this._getServiceKey()); } catch (e) {}
  },

  /**
   * Lazy load invoice data and build indices
   *
   * Returns cached partition data if valid, otherwise loads from sheet.
   * This is the primary method for accessing invoice data throughout the system.
   *
   * CONDITIONAL CACHE STRATEGY:
   * - Local mode: Read from local InvoiceDatabase (fast, always fresh)
   * - Master mode: Read from Master Database directly (bypasses IMPORTRANGE timing issues)
   *
   * PERFORMANCE:
   * - Local mode: 200-400ms per cache load
   * - Master mode: 300-600ms per cache load (+100-200ms cross-file latency)
   * - Cache loads happen once per TTL (60 seconds), not per transaction
   * - Tradeoff: Slight latency for guaranteed data freshness
   *
   * @returns {{activeData:Array,activeIndexMap:Map,activeSupplierIndex:Map,inactiveData:Array,inactiveIndexMap:Map,inactiveSupplierIndex:Map,globalIndexMap:Map}}
   */
  getInvoiceData: function () {
    const cached = this.get();
    if (cached) return cached;

    // ② CacheService — cross-execution persistence (active partition only)
    if (this._restoreActiveFromService()) return this._snapshot();

    try {
      // Cache miss - load data from sheet
      // CONDITIONAL: Master mode reads from Master DB, Local mode reads from local sheet
      const invoiceSh = CONFIG.isMasterMode()
        ? MasterDatabaseUtils.getTargetSheet('invoice')  // Master: Read from Master DB (always fresh)
        : MasterDatabaseUtils.getSourceSheet('invoice'); // Local: Read from local sheet

      const lastRow = invoiceSh.getLastRow();

      if (lastRow < 2) {
        this.set([[]]); // Header placeholder
        return this._snapshot();
      }

      // OPTIMIZED: Read only used range
      const data = invoiceSh.getRange(1, 1, lastRow, CONFIG.totalColumns.invoice).getValues();
      this.set(data);
      return this._snapshot();
    } catch (error) {
      AuditLogger.logError('CacheManager.getInvoiceData',
        `Failed to load invoice data: ${error.toString()}`);
      return {
        activeData: [[]],
        activeIndexMap: new Map(),
        activeSupplierIndex: new Map(),
        inactiveData: [[]],
        inactiveIndexMap: new Map(),
        inactiveSupplierIndex: new Map(),
        globalIndexMap: new Map()
      };
    }
  },

  /**
   * Get partition statistics
   * Useful for monitoring cache efficiency and partition distribution
   *
   * @returns {Object} Partition statistics
   */
  getPartitionStats: function () {
    const activeCount = this.activeData ? this.activeData.length - 1 : 0; // Exclude header
    const inactiveCount = this.inactiveData ? this.inactiveData.length - 1 : 0;
    const totalCount = activeCount + inactiveCount;

    const activePercent = totalCount > 0 ? activeCount / totalCount * 100 : 0;
    const inactivePercent = totalCount > 0 ? inactiveCount / totalCount * 100 : 0;

    const totalPartitionHits = this.stats.activePartitionHits + this.stats.inactivePartitionHits;
    const activeHitPercent = totalPartitionHits > 0
      ? this.stats.activePartitionHits / totalPartitionHits * 100
      : 0;
    const inactiveHitPercent = totalPartitionHits > 0
      ? this.stats.inactivePartitionHits / totalPartitionHits * 100
      : 0;

    return {
      active: {
        count: activeCount,
        percentage: activePercent.toFixed(1),
        hitCount: this.stats.activePartitionHits,
        hitRate: activeHitPercent.toFixed(1)
      },
      inactive: {
        count: inactiveCount,
        percentage: inactivePercent.toFixed(1),
        hitCount: this.stats.inactivePartitionHits,
        hitRate: inactiveHitPercent.toFixed(1)
      },
      total: totalCount,
      transitions: this.stats.partitionTransitions,
      memoryReduction: `${inactivePercent.toFixed(0)}% (inactive invoices separated)`
    };
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: PAYMENT CACHE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Optimized Payment Cache Module
 * ----------------------------------------------------
 * Features:
 *  - Global payment data cache (in-memory)
 *  - Quad-index structure for O(1) lookups:
 *    1. Invoice index: "INVOICE_NO" → [payment indices]
 *    2. Supplier index: "SUPPLIER" → [payment indices]
 *    3. Combined index: "SUPPLIER|INVOICE_NO" → [payment indices]
 *    4. Payment ID index: "PAYMENT_ID" → row index (for duplicate detection)
 *  - TTL-based auto-expiration (60 seconds)
 *  - Write-through cache for immediate availability
 *  - Memory-efficient: ~450KB for 1,000 payments
 *
 * Performance:
 *  - Query time: 340ms → 2ms (170x faster)
 *  - Duplicate check: 340ms → <1ms (340x faster)
 *  - Scales to 50,000+ payments with constant performance
 */
const PaymentCache = {
  data: null,
  invoiceIndex: null,      // "INVOICE_NO" -> [row indices]
  supplierIndex: null,     // "SUPPLIER" -> [row indices]
  combinedIndex: null,     // "SUPPLIER|INVOICE_NO" -> [row indices]
  paymentIdIndex: null,    // "PAYMENT_ID" -> row index (for duplicate detection)
  timestamp: null,
  TTL: CONFIG.rules.CACHE_TTL_MS,

  /**
   * Get cached data if valid (within TTL)
   * @returns {{data:Array, invoiceIndex:Map, supplierIndex:Map, combinedIndex:Map, paymentIdIndex:Map}|null}
   */
  get: function() {
    const now = Date.now();
    if (this.data && this.timestamp && (now - this.timestamp) < this.TTL) {
      return {
        data: this.data,
        invoiceIndex: this.invoiceIndex,
        supplierIndex: this.supplierIndex,
        combinedIndex: this.combinedIndex,
        paymentIdIndex: this.paymentIdIndex
      };
    }
    return null;
  },

  /**
   * Set new cache with quad-index structure
   * @param {Array[]} data - Sheet data array
   */
  set: function(data) {
    this.data = data;
    this.timestamp = Date.now();
    this.invoiceIndex = new Map();
    this.supplierIndex = new Map();
    this.combinedIndex = new Map();
    this.paymentIdIndex = new Map();

    const col = CONFIG.paymentCols;

    for (let i = CONFIG.constants.FIRST_DATA_ROW_INDEX; i < data.length; i++) {
      const supplier = StringUtils.normalize(data[i][col.supplier]);
      const invoiceNo = StringUtils.normalize(data[i][col.invoiceNo]);
      const paymentId = data[i][col.sysId];

      if (!supplier || !invoiceNo) continue;

      _cacheAddToIndex(this.invoiceIndex, invoiceNo, i);
      _cacheAddToIndex(this.supplierIndex, supplier, i);
      _cacheAddToIndex(this.combinedIndex, `${supplier}|${invoiceNo}`, i);

      if (paymentId) {
        this.paymentIdIndex.set(paymentId, i);
      }
    }
  },

  /**
   * ADD PAYMENT TO CACHE (Write-Through)
   * Immediately adds newly created payment to cache indices
   *
   * @param {number} rowNumber - Sheet row number (1-based)
   * @param {Array}  rowData   - Payment row data
   */
  addPaymentToCache: function(rowNumber, rowData) {
    if (!this.data || !this.invoiceIndex || !this.supplierIndex || !this.combinedIndex || !this.paymentIdIndex) {
      return; // Cache cold (single-row or onEdit path) — payment is on the sheet; skip write-through
    }

    const col = CONFIG.paymentCols;
    const supplier = StringUtils.normalize(rowData[col.supplier]);
    const invoiceNo = StringUtils.normalize(rowData[col.invoiceNo]);
    const paymentId = rowData[col.sysId];

    if (!supplier || !invoiceNo) return;

    try {
      const arrayIndex = rowNumber - 1;

      while (this.data.length <= arrayIndex) {
        this.data.push([]);
      }

      this.data[arrayIndex] = rowData;

      _cacheAddToIndex(this.invoiceIndex, invoiceNo, arrayIndex);
      _cacheAddToIndex(this.supplierIndex, supplier, arrayIndex);
      _cacheAddToIndex(this.combinedIndex, `${supplier}|${invoiceNo}`, arrayIndex);

      if (paymentId) {
        this.paymentIdIndex.set(paymentId, arrayIndex);
      }

    } catch (error) {
      AuditLogger.logError('PaymentCache.addPaymentToCache',
        `Failed to add payment to cache: ${error.toString()}`);
    }
  },

  /**
   * Lazy load payment data and build indices
   * @returns {{data:Array, invoiceIndex:Map, supplierIndex:Map, combinedIndex:Map, paymentIdIndex:Map}}
   */
  getPaymentData: function() {
    const cached = this.get();
    if (cached) return cached;

    try {
      // Always read from local sheet (IMPORTRANGE in master mode)
      const paymentSh = MasterDatabaseUtils.getSourceSheet('payment');
      const lastRow = paymentSh.getLastRow();

      if (lastRow < CONFIG.constants.MIN_ROWS_WITH_DATA) {
        const emptyData = [[]];
        this.set(emptyData);
        return {
          data: emptyData,
          invoiceIndex: new Map(),
          supplierIndex: new Map(),
          combinedIndex: new Map(),
          paymentIdIndex: new Map()
        };
      }

      const data = paymentSh.getRange(1, 1, lastRow, CONFIG.totalColumns.payment).getValues();
      this.set(data);

      return {
        data: this.data,
        invoiceIndex: this.invoiceIndex,
        supplierIndex: this.supplierIndex,
        combinedIndex: this.combinedIndex,
        paymentIdIndex: this.paymentIdIndex
      };
    } catch (error) {
      AuditLogger.logError('PaymentCache.getPaymentData',
        `Failed to load payment data: ${error.toString()}`);
      return {
        data: [[]],
        invoiceIndex: new Map(),
        supplierIndex: new Map(),
        combinedIndex: new Map(),
        paymentIdIndex: new Map()
      };
    }
  },

  /**
   * Clear entire cache memory
   */
  clear: function() {
    this.data = null;
    this.invoiceIndex = null;
    this.supplierIndex = null;
    this.combinedIndex = null;
    this.paymentIdIndex = null;
    this.timestamp = null;
  }
};
