/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UIMenu.BatchPosting.gs — Batch Posting and Validation Engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sub-module of UIMenu. Contains all batch posting and validation logic.
 * Called exclusively by UIMenu's thin public API methods.
 *
 * PUBLIC INTERFACE (called by UIMenu):
 *   handleBatchValidation(sheet, startRow, endRow) → results
 *   handleBatchPosting(sheet, startRow, endRow)    → results
 *   showValidationResults(results, isPosting)
 *
 * Dependencies: _Config.gs, _Utils.gs (UIUtils), ValidationEngine.gs,
 *               InvoiceManager.gs, PaymentManager.gs, BalanceCalculator.gs,
 *               CacheManager.gs, AuditLogger.gs, _UserResolver.gs
 */

const UIMenuBatchPosting = {

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC INTERFACE — called by UIMenu
  // ═══════════════════════════════════════════════════════════════════════════

  /** Entry point for all batch validation calls (all-rows and selected-rows). */
  handleBatchValidation: function(sheet, startRow = null, endRow = null) {
    const context = this._initBatchValidationSetup(sheet, startRow, endRow);
    if (!context) return this._createEmptyResults();
    this._runBatchValidationLoop(context);
    return context.results;
  },

  /** Entry point for all batch posting calls (all-rows and selected-rows). */
  handleBatchPosting: function(sheet, startRow = null, endRow = null) {
    const context = this._initBatchPostSetup(sheet, startRow, endRow);
    if (!context) return this._createEmptyPostResults(CONFIG.isMasterMode() ? 'MASTER' : 'LOCAL');

    const isUnpaid = this._isAllUnpaidBatch(context.allData);
    context.batchContext = isUnpaid
      ? this._initUnpaidBatchContext()
      : this._initBatchContext();

    if (isUnpaid) {
      this._handleUnpaidBatchPosting(context);
    } else {
      this._handleRegularBatchPosting(context);
    }

    this._invalidateBatchCaches(context);
    return this._reportBatchPostResults(context);
  },

  /** Show validation or posting results dialog. */
  showValidationResults: function(results, isPosting) {
    const message = this._buildValidationMessage(results, isPosting, 10);
    const title   = isPosting ? 'Batch Posting Results' : 'Batch Validation Results';
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private Phase 1: validate row bounds, show toast, init results object. Returns null if sheet is empty. */
  _initBatchValidationSetup: function(sheet, startRow, endRow) {
    const sheetName    = sheet.getName();
    const dataStartRow = CONFIG.dataStartRow;
    const lastRow      = sheet.getLastRow();

    if (startRow === null) startRow = dataStartRow;
    if (endRow   === null) endRow   = lastRow;

    if (lastRow < dataStartRow)  return null;
    if (endRow  > lastRow)       endRow = lastRow;
    if (startRow > endRow)       return null;

    const numRows = endRow - startRow + 1;

    UIUtils.toast(`Starting validation of ${numRows} rows...`, 'Validating', 3);

    return {
      sheet, sheetName, startRow, endRow, numRows,
      results: { total: numRows, valid: 0, invalid: 0, skipped: 0, errors: [] }
    };
  },

  /** @private Phase 2: batch-read rows, validate each, collect errors into context.results. */
  _runBatchValidationLoop: function(context) {
    const { sheet, sheetName, startRow, numRows, results } = context;

    try {
      const allData = sheet.getRange(startRow, 1, numRows, CONFIG.totalColumns.daily).getValues();
      const enteredBy        = UserResolver.getCurrentUser();
      const progressInterval = this._calculateProgressInterval(numRows);

      for (let i = 0; i < allData.length; i++) {
        const rowNum  = startRow + i;
        const rowData = allData[i];

        if ((i + 1) % progressInterval === 0) {
          UIUtils.toast(`Validated ${i + 1} of ${numRows} rows...`, 'Progress', 2);
        }

        if (!rowData[CONFIG.cols.supplier]) { results.skipped++; continue; }

        try {
          const data = this._buildDataObject(rowData, rowNum, sheetName, enteredBy);
          const validation = validatePostData(data);

          if (validation.valid) {
            results.valid++;
          } else {
            results.invalid++;
            results.errors.push({
              row: rowNum, supplier: data.supplier,
              invoiceNo: data.invoiceNo || 'N/A',
              error: validation.error || validation.errors.join(', ')
            });
          }
        } catch (rowError) {
          results.invalid++;
          results.errors.push({
            row: rowNum,
            supplier: rowData[CONFIG.cols.supplier] || 'Unknown',
            invoiceNo: rowData[CONFIG.cols.invoiceNo] || 'N/A',
            error: `Validation error: ${rowError.message}`
          });
        }
      }
    } catch (error) {
      Logger.log(`Critical error in validateRowsInSheet: ${error.message}`);
      results.errors.push({
        row: 'N/A', supplier: 'SYSTEM', invoiceNo: 'N/A',
        error: `System error: ${error.message}`
      });
    }
  },

  /** @private Orchestrate the Regular/Partial/Due path: accumulate then bulk-flush. */
  _handleRegularBatchPosting: function(context) {
    this._runBatchPostLoop(context);               // Phase 2: accumulate (no sheet writes)

    const batchCtx = context.batchContext;

    // STEP 1 — Invoice flush (1 API call)
    const invoiceFlushResult = InvoiceManager.flushPendingRegularInvoices(batchCtx);
    if (!invoiceFlushResult.success) {
      this._markAllPendingAsFailed(context, invoiceFlushResult);
      this._flushRegularDailySheetUpdates(context);
      return;
    }

    // STEP 2 — Payment flush (1 API call)
    const paymentFlushResult = PaymentManager.flushPendingPaymentRows(batchCtx);
    if (!paymentFlushResult.success) {
      AuditLogger.logWarning('UIMenuBatchPosting._handleRegularBatchPosting',
        'PARTIAL_FLUSH_STATE: invoices written, payments not — manual reconciliation required via AuditLog');
      this._markAllPendingAsFailed(context, paymentFlushResult);
      this._flushRegularDailySheetUpdates(context);
      return;
    }

    // STEP 3 — paidDate pass (SUMIFS now reflect new payments)
    this._runPaidDatePass(batchCtx);

    // STEP 4 — Balance pass (SUMIFS now reflect new payments)
    this._runBalancePass(context);

    // STEPS 5-6 — Flush balance + status updates → daily sheet + summary
    this._flushRegularDailySheetUpdates(context);
  },

  /** @private Orchestrate the all-Unpaid fast path. */
  _handleUnpaidBatchPosting: function(context) {
    this._runUnpaidBatchPostLoop(context);
    InvoiceManager.flushPendingInvoiceRows(context.batchContext);  // 1 remote write
    this._flushUnpaidDailySheetUpdates(context);                   // 3 local writes
  },

  /** @private Phase 1: initialise context for a batch post run. Returns null if sheet is empty. */
  _initBatchPostSetup: function(sheet, startRow, endRow) {
    const startTime = Date.now();
    const sheetName = sheet.getName();
    const dataStartRow = CONFIG.dataStartRow;
    const lastRow = sheet.getLastRow();
    const connectionMode = CONFIG.isMasterMode() ? 'MASTER' : 'LOCAL';

    if (startRow === null) startRow = dataStartRow;
    if (endRow   === null) endRow   = lastRow;

    if (lastRow < dataStartRow)  return null;
    if (endRow  > lastRow)       endRow = lastRow;
    if (startRow > endRow)       return null;

    const numRows = endRow - startRow + 1;

    UIUtils.toast(`Starting batch post of ${numRows} rows (${connectionMode} mode)...`, 'Processing', 3);

    const allData = sheet.getRange(startRow, 1, numRows, CONFIG.totalColumns.daily).getValues();

    const results = {
      total: numRows, posted: 0, failed: 0, skipped: 0,
      errors: [], connectionMode: connectionMode, duration: 0, avgTimePerRow: 0
    };

    return {
      sheet, sheetName, connectionMode,
      startRow, endRow, numRows, allData,
      results,
      suppliersToInvalidate:  new Set(),
      pendingStatusUpdates:   [],
      // -- Deferred daily-sheet write queues (Regular / Partial / Due batches) --
      // Populated during _runBatchPostLoop; flushed atomically in _flushRegularDailySheetUpdates.
      // Shapes are strict contracts — enforce at push site, not in flush layer.
      // { rowNum: number, sysId: string }
      // { rowNum: number, balance: number }
      pendingSysIdUpdates:    [],
      pendingBalanceUpdates:  [],
      pendingBalanceRows:     [],    // { rowNum, supplier } — resolved post-flush in _runBalancePass
      progressInterval: this._calculateProgressInterval(numRows),
      enteredBy:    UserResolver.getCurrentUser(),
      startTime
    };
  },

  /** @private Phase 2: iterate rows, accumulate all writes — no per-row sheet I/O. */
  _runBatchPostLoop: function(context) {
    const { sheetName, allData, startRow, numRows,
            results, suppliersToInvalidate,
            progressInterval, enteredBy } = context;

    try {
      for (let i = 0; i < allData.length; i++) {
        const rowNum  = startRow + i;
        const rowData = allData[i];

        if ((i + 1) % progressInterval === 0) {
          UIUtils.toast(`Processed ${i + 1} of ${numRows} rows...`, 'Progress', 2);
        }

        if (!rowData[CONFIG.cols.supplier]) { results.skipped++; continue; }

        const status = rowData[CONFIG.cols.status];
        if (status && status.toString().toUpperCase() === 'POSTED') { results.skipped++; continue; }

        try {
          const data       = this._buildDataObject(rowData, rowNum, sheetName, enteredBy);
          const validation = validatePostData(data);
          if (!validation.valid) { this._queueValidationError(context, data, rowNum, validation); continue; }

          this._ensureSysId(data, context);                // Stage 1: Identity
          this._executeDomainLogic(data, context);         // Stage 2: Domain Execution
          this._queueBalanceUpdate(data, rowNum, context); // Stage 3: State Capture
          this._queueStatusSuccess(data, rowNum, context); // Stage 4: Status Queue
          suppliersToInvalidate.add(data.supplier); // Error paths skip this — no domain state was mutated
          results.posted++;

        } catch (error) {
          this._queueRuntimeError(context, error, rowData, rowNum, enteredBy);
        }
      }
    } finally {
      // Release batch lock immediately after loop — post-loop flush does not need it.
      LockManager.releaseLock(context.batchContext?.batchLock);
    }
  },

  /** @private Stage 1 — Identity: ensure sysId exists and queue for deferred write. */
  _ensureSysId: function(data, context) {
    if (!data.sysId) data.sysId = IDGenerator.generateUUID();
    context.pendingSysIdUpdates.push({ rowNum: data.rowNum, sysId: data.sysId });
  },

  /** @private Stage 2 — Domain Execution: dispatch by payment type. All branching isolated here. */
  _executeDomainLogic: function(data, context) {
    switch (data.paymentType) {
      case 'Regular':
      case 'Partial':
        return this._executeInvoiceAndPayment(data, context);
      case 'Due':
        return this._executeDuePayment(data, context);
      case 'Unpaid':
        // Mixed-batch path: pure-Unpaid batches use _runUnpaidBatchPostLoop, but any batch
        // containing non-Unpaid rows routes here. Create/update invoice; no payment recorded.
        return this._executeInvoiceOnly(data, context);
      default:
        // Caught by row-level catch → logged → queued as ERROR — no silent corruption
        throw new Error(`Unsupported payment type in batch: "${data.paymentType}"`);

    }
  },

  /** @private Stage 2 (Regular/Partial): create or update invoice, then record full/partial payment. */
  _executeInvoiceAndPayment: function(data, context) {
    const invoiceResult = InvoiceManager.createOrUpdateInvoice(data, context.batchContext);
    data.invoiceId  = invoiceResult.invoiceId;
    data.invoiceRow = invoiceResult.row;
    PaymentManager.processPayment(data, invoiceResult.invoiceId, context.batchContext);
  },

  /** @private Stage 2 (Due): payment only — no invoice creation. */
  _executeDuePayment: function(data, context) {
    PaymentManager.processPayment(data, null, context.batchContext);
  },

  /** @private Stage 2 (Unpaid in mixed batch): create or update invoice only — no payment recorded. */
  _executeInvoiceOnly: function(data, context) {
    const invoiceResult = InvoiceManager.createOrUpdateInvoice(data, context.batchContext);
    data.invoiceId = invoiceResult.invoiceId;
  },

  /** @private Stage 3 — State Capture: queue supplier for post-flush balance calculation. */
  _queueBalanceUpdate: function(data, rowNum, context) {
    context.pendingBalanceRows.push({ rowNum, supplier: data.supplier });
  },

  /** @private Stage 4 — Status Queue: push success status update to accumulator. */
  _queueStatusSuccess: function(data, rowNum, context) {
    context.pendingStatusUpdates.push({
      rowNum, keepChecked: true, status: 'POSTED',
      user:    UserResolver.extractUsername(data.enteredBy),
      time:    data.timestamp, bgColor: CONFIG.colors.success
    });
  },

  /** @private Error helper: queue validation failure status and log audit entry. */
  _queueValidationError: function(context, data, rowNum, validation) {
    const msg = validation.error ||
      (validation.errors?.length ? validation.errors[0] : 'Validation failed');
    context.results.failed++;
    context.results.errors.push({ row: rowNum, supplier: data.supplier,
                                  invoiceNo: data.invoiceNo || 'N/A', error: msg });
    context.pendingStatusUpdates.push({
      rowNum, keepChecked: false,
      status:  `ERROR: ${msg.substring(0, 100)}`,
      user:    UserResolver.extractUsername(data.enteredBy),
      time:    data.timestamp, bgColor: CONFIG.colors.error
    });
    AuditLogger.log('VALIDATION_FAILED', data, msg);
  },

  /** @private Error helper: queue runtime error status and log audit entry. */
  _queueRuntimeError: function(context, error, rowData, rowNum, enteredBy) {
    context.results.failed++;
    context.results.errors.push({
      row: rowNum, supplier: rowData[CONFIG.cols.supplier],
      invoiceNo: rowData[CONFIG.cols.invoiceNo] || 'N/A', error: error.message
    });
    context.pendingStatusUpdates.push({
      rowNum, keepChecked: false,
      status:  `ERROR: ${error.message.substring(0, 100)}`,
      user:    UserResolver.extractUsername(enteredBy),
      time:    DateUtils.formatTimestamp(), bgColor: CONFIG.colors.error
    });
    AuditLogger.logError('BATCH_POST_FAILED', error, { row: rowNum });
  },

  /** @private Fast-path loop for all-Unpaid batch: zero API calls per row; defers writes. */
  _runUnpaidBatchPostLoop: function(context) {
    const { sheet, sheetName, allData, startRow, numRows,
            results, suppliersToInvalidate, pendingStatusUpdates,
            progressInterval, enteredBy, batchContext } = context;
    context.pendingBalanceUpdates = [];

    try {
      for (let i = 0; i < allData.length; i++) {
        const rowNum  = startRow + i;
        const rowData = allData[i];

        if ((i + 1) % progressInterval === 0) {
          UIUtils.toast(`Processed ${i + 1} of ${numRows} rows...`, 'Progress', 2);
        }

        if (!rowData[CONFIG.cols.supplier]) { results.skipped++; continue; }

        const status = rowData[CONFIG.cols.status];
        if (status && status.toString().toUpperCase() === 'POSTED') {
          results.skipped++; continue;
        }

        try {
          const data = this._buildDataObject(rowData, rowNum, sheetName, enteredBy);

          if (!data.sysId) data.sysId = IDGenerator.generateUUID();

          const validation = validatePostData(data);
          if (!validation.valid) {
            results.failed++;
            const errorMsg = validation.error ||
              (validation.errors?.length ? validation.errors[0] : 'Validation failed');
            results.errors.push({ row: rowNum, supplier: data.supplier,
                                  invoiceNo: data.invoiceNo || 'N/A', error: errorMsg });
            pendingStatusUpdates.push({
              rowNum, keepChecked: false,
              status:  `ERROR: ${errorMsg.substring(0, 100)}`,
              user:    UserResolver.extractUsername(data.enteredBy),
              time:    data.timestamp, bgColor: CONFIG.colors.error, sysId: null
            });
            AuditLogger.log('VALIDATION_FAILED', data, errorMsg);
            continue;
          }

          const invoiceResult = InvoiceManager.createOrUpdateInvoice(data, batchContext);
          if (!invoiceResult.success) {
            results.failed++;
            results.errors.push({ row: rowNum, supplier: data.supplier,
                                  invoiceNo: data.invoiceNo || 'N/A',
                                  error: invoiceResult.error });
            pendingStatusUpdates.push({
              rowNum, keepChecked: false,
              status:  `ERROR: ${invoiceResult.error?.substring(0, 100)}`,
              user:    UserResolver.extractUsername(data.enteredBy),
              time:    data.timestamp, bgColor: CONFIG.colors.error, sysId: null
            });
            continue;
          }

          const balance = BalanceCalculator.getSupplierOutstanding(data.supplier);
          context.pendingBalanceUpdates.push({ rowNum, balance });

          pendingStatusUpdates.push({
            rowNum, keepChecked: true, status: 'POSTED',
            user:    UserResolver.extractUsername(data.enteredBy),
            time:    data.timestamp, bgColor: CONFIG.colors.success,
            sysId:   data.sysId
          });

          suppliersToInvalidate.add(data.supplier);
          results.posted++;

        } catch (error) {
          results.failed++;
          results.errors.push({
            row: rowNum, supplier: rowData[CONFIG.cols.supplier],
            invoiceNo: rowData[CONFIG.cols.invoiceNo] || 'N/A', error: error.message
          });
          pendingStatusUpdates.push({
            rowNum, keepChecked: false,
            status:  `ERROR: ${error.message?.substring(0, 100)}`,
            user:    UserResolver.extractUsername(enteredBy),
            time:    DateUtils.formatTimestamp(), bgColor: CONFIG.colors.error, sysId: null
          });
          AuditLogger.logError('UNPAID_BATCH_POST_FAILED', error, { row: rowNum });
        }
      }
    } finally {
      // Release batch lock immediately after loop — post-loop flush does not need it.
      LockManager.releaseLock(batchContext?.batchLock);
    }
  },

  /** @private Phase 3: invalidate supplier cache once per unique supplier. */
  _invalidateBatchCaches: function(context) {
    for (const supplier of context.suppliersToInvalidate) {
      CacheManager.invalidateSupplierCache(supplier);
    }
  },

  /** @private Phase 4: flush all queued status updates in a single setValues() call. */
  _flushBatchStatusUpdates: function(context) {
    const { sheet, allData, startRow, numRows, pendingStatusUpdates } = context;
    if (pendingStatusUpdates.length === 0) return;
    const statusGrid = buildStatusGrid(allData, startRow, pendingStatusUpdates);
    sheet.getRange(startRow, CONFIG.cols.post + 1, numRows, 4).setValues(statusGrid);
    flushBackgroundUpdates(sheet, pendingStatusUpdates);
  },

  /**
   * @private Flush engine for Regular/Partial/Due batches — analogous to _flushUnpaidDailySheetUpdates.
   * Up to 3 bulk writes total; skips each flush if its accumulator is empty.
   */
  _flushRegularDailySheetUpdates: function(context) {
    if (
      context.pendingSysIdUpdates.length   === 0 &&
      context.pendingBalanceUpdates.length === 0 &&
      context.pendingStatusUpdates.length  === 0
    ) return;

    this._flushSysIdUpdates(context);       // 1 setValues — sysId column
    this._flushBalanceUpdates(context);     // 1 setValues — balance column
    this._flushBatchStatusUpdates(context); // 1 setValues + grouped setBackground
  },

  /** @private Flip all POSTED pending status entries to FAILED after a flush error. */
  _markAllPendingAsFailed: function(context, flushResult) {
    var flipped = 0;
    context.pendingStatusUpdates.forEach(function(entry) {
      if (entry.status === 'POSTED') {
        entry.status      = 'FAILED';
        entry.bgColor     = CONFIG.colors.error;
        entry.keepChecked = false;
        flipped++;
      }
    });
    context.results.failed += flipped;
    context.results.posted  = Math.max(0, context.results.posted - flipped);
  },

  /**
   * @private Flush a sorted list of qualifying paidDate rows to the invoice sheet.
   * Groups consecutive rows with the same paymentDate into contiguous runs and issues
   * one setValues() per run — mirrors _applyUnpaidBatchBackgrounds run-grouping pattern.
   *
   * @param {Sheet}  invoiceSheet
   * @param {Array}  qualifyingRows  [{invoiceRow: number, paymentDate: Date}] — pre-filtered, unsorted OK
   * @param {number} paidDateCol     1-based column index of the paidDate column
   */
  _flushPaidDateRuns: function(invoiceSheet, qualifyingRows, paidDateCol) {
    if (!qualifyingRows.length) return;

    const sorted = qualifyingRows.slice().sort((a, b) => a.invoiceRow - b.invoiceRow);

    let runStartRow = null;
    let runValues   = [];

    const flushRun = () => {
      if (runStartRow === null || !runValues.length) return;
      try {
        invoiceSheet
          .getRange(runStartRow, paidDateCol, runValues.length, 1)
          .setValues(runValues);
      } catch (e) {
        AuditLogger.logWarning('UIMenuBatchPosting._flushPaidDateRuns',
          'setValues failed at row ' + runStartRow +
          ' height ' + runValues.length + ': ' + e.toString());
      }
      runStartRow = null;
      runValues   = [];
    };

    for (let i = 0; i < sorted.length; i++) {
      const entry    = sorted[i];
      const prevRow    = i > 0 ? sorted[i - 1].invoiceRow : null;
      const prevDateMs = i > 0
        ? (sorted[i - 1].paymentDate instanceof Date
            ? sorted[i - 1].paymentDate.getTime()
            : Number(new Date(sorted[i - 1].paymentDate)))
        : null;
      const currDateMs = entry.paymentDate instanceof Date
        ? entry.paymentDate.getTime()
        : Number(new Date(entry.paymentDate));
      const isContiguous = prevRow !== null
        && entry.invoiceRow === prevRow + 1
        && currDateMs === prevDateMs;

      if (isContiguous) {
        runValues.push([entry.paymentDate]);
      } else {
        flushRun();
        runStartRow = entry.invoiceRow;
        runValues   = [[entry.paymentDate]];
      }
    }
    flushRun();
  },

  /**
   * @private Post-flush paidDate pass — two optimised paths by payment type.
   *
   * Regular: invoice is always fully paid by definition → write paidDate unconditionally,
   *          zero sheet reads, grouped setValues() per contiguous run.
   * Due:     balance must be re-read to confirm it cleared → one batch getValues() spanning
   *          all Due rows, in-memory filter, then grouped setValues() per contiguous run.
   */
  _runPaidDatePass: function(batchCtx) {
    if (!batchCtx?.pendingPaidDateChecks?.length) return;

    const invoiceSheet = batchCtx.invoiceSheet;
    if (!invoiceSheet) {
      AuditLogger.logWarning('UIMenuBatchPosting._runPaidDatePass', 'invoiceSheet unavailable — skipping paidDate pass');
      return;
    }

    const balanceCol   = CONFIG.invoiceCols.balanceDue + 1;
    const paidDateCol  = CONFIG.invoiceCols.paidDate   + 1;
    const tolerance    = CONFIG.constants.BALANCE_TOLERANCE;
    const checks       = batchCtx.pendingPaidDateChecks;

    const regularEntries = checks.filter(e => e.paymentType === 'Regular');
    const dueEntries     = checks.filter(e => e.paymentType === 'Due');

    checks.forEach(function(e) {
      if (e.paymentType !== 'Regular' && e.paymentType !== 'Due') {
        AuditLogger.logWarning('UIMenuBatchPosting._runPaidDatePass',
          'Unhandled paymentType "' + e.paymentType + '" for invoice ' + e.invoiceNo + ' — skipped');
      }
    });

    // ── Regular path: zero reads ─────────────────────────────────────────────
    if (regularEntries.length) {
      const qualifyingRegular = regularEntries.map(e => ({
        invoiceRow:  e.invoiceRow,
        paymentDate: e.paymentDate || new Date()
      }));
      this._flushPaidDateRuns(invoiceSheet, qualifyingRegular, paidDateCol);
    }

    // ── Due path: one batch read ─────────────────────────────────────────────
    if (!dueEntries.length) return;

    const dueRows = dueEntries.map(e => e.invoiceRow);
    const minRow  = dueRows.reduce((m, r) => r < m ? r : m, dueRows[0]);
    const maxRow  = dueRows.reduce((m, r) => r > m ? r : m, dueRows[0]);

    let balanceWindow;
    try {
      balanceWindow = invoiceSheet
        .getRange(minRow, balanceCol, maxRow - minRow + 1, 1)
        .getValues();
    } catch (e) {
      dueEntries.forEach(function(entry) {
        AuditLogger.logWarning('UIMenuBatchPosting._runPaidDatePass',
          'Batch balance read failed for invoice ' + entry.invoiceNo +
          ' row ' + entry.invoiceRow + ': ' + e.toString());
      });
      return;
    }

    const qualifyingDue = [];
    dueEntries.forEach(function(entry) {
      try {
        const balance = Number(balanceWindow[entry.invoiceRow - minRow][0]);
        if (Math.abs(balance) < tolerance) {
          qualifyingDue.push({ invoiceRow: entry.invoiceRow, paymentDate: entry.paymentDate || new Date() });
        }
      } catch (e) {
        AuditLogger.logWarning('UIMenuBatchPosting._runPaidDatePass',
          'Failed to evaluate balance for invoice ' + entry.invoiceNo +
          ' row ' + entry.invoiceRow + ': ' + e.toString());
      }
    });

    if (qualifyingDue.length) {
      this._flushPaidDateRuns(invoiceSheet, qualifyingDue, paidDateCol);
    }
  },

  /** @private Post-flush balance pass: one getSupplierOutstanding per unique supplier, fills pendingBalanceUpdates. */
  _runBalancePass: function(context) {
    if (!context.pendingBalanceRows?.length) return;
    const balanceBySupplier = new Map();
    context.pendingBalanceRows.forEach(function(entry) {
      if (!balanceBySupplier.has(entry.supplier)) {
        try {
          balanceBySupplier.set(entry.supplier,
            BalanceCalculator.getSupplierOutstanding(entry.supplier));
        } catch (e) {
          AuditLogger.logWarning('UIMenuBatchPosting._runBalancePass',
            'Balance lookup failed for ' + entry.supplier + ': ' + e.toString());
          balanceBySupplier.set(entry.supplier, null);
        }
      }
      const balance = balanceBySupplier.get(entry.supplier);
      if (balance !== null) {
        context.pendingBalanceUpdates.push({ rowNum: entry.rowNum, balance: balance });
      }
    });
  },

  /** @private Build sysId column grid and write in one setValues call. */
  _flushSysIdUpdates: function(context) {
    if (context.pendingSysIdUpdates.length === 0) return;
    const { sheet, allData, startRow, numRows } = context;
    const updateMap = new Map(context.pendingSysIdUpdates.map(u => [u.rowNum, u.sysId]));
    const grid = Array.from({ length: numRows }, (_, i) => {
      const rowNum = startRow + i;
      return [updateMap.get(rowNum) ?? allData[i][CONFIG.cols.sysId]];
    });
    sheet.getRange(startRow, CONFIG.cols.sysId + 1, numRows, 1).setValues(grid);
  },

  /** @private Build balance column grid and write in one setValues call. Reuses _buildBalanceGrid. */
  _flushBalanceUpdates: function(context) {
    if (context.pendingBalanceUpdates.length === 0) return;
    const { sheet, allData, startRow, numRows } = context;
    const grid = this._buildBalanceGrid(allData, startRow, numRows, context.pendingBalanceUpdates);
    sheet.getRange(startRow, CONFIG.cols.balance + 1, numRows, 1).setValues(grid);
  },

  /** @private Write balance col, status+sysId grid, and row backgrounds — 3 local API calls. */
  _flushUnpaidDailySheetUpdates: function(context) {
    const { sheet, allData, startRow, numRows,
            pendingStatusUpdates, pendingBalanceUpdates } = context;
    if (pendingStatusUpdates.length === 0) return;

    if (pendingBalanceUpdates.length > 0) {
      const balanceGrid = this._buildBalanceGrid(allData, startRow, numRows, pendingBalanceUpdates);
      sheet.getRange(startRow, CONFIG.cols.balance + 1, numRows, 1).setValues(balanceGrid);
    }

    const statusGrid = this._buildUnpaidStatusGrid(allData, startRow, numRows, pendingStatusUpdates);
    sheet.getRange(startRow, CONFIG.cols.post + 1, numRows, 5).setValues(statusGrid);

    this._applyUnpaidBatchBackgrounds(sheet, startRow, numRows, pendingStatusUpdates);
  },

  /** @private Build balance column grid: computed value for posted rows, original for skipped. */
  _buildBalanceGrid: function(allData, startRow, numRows, pendingBalanceUpdates) {
    const balanceCol = CONFIG.cols.balance;
    const updateMap  = new Map(pendingBalanceUpdates.map(u => [u.rowNum, u.balance]));
    return Array.from({ length: numRows }, (_, i) => {
      const rowNum = startRow + i;
      return updateMap.has(rowNum)
        ? [updateMap.get(rowNum)]
        : [allData[i][balanceCol]];
    });
  },

  /** @private 5-column status grid: post, status, user, time, sysId. */
  _buildUnpaidStatusGrid: function(allData, startRow, numRows, pendingStatusUpdates) {
    const cols      = CONFIG.cols;
    const updateMap = new Map(pendingStatusUpdates.map(u => [u.rowNum, u]));
    return Array.from({ length: numRows }, (_, i) => {
      const rowNum = startRow + i;
      const u      = updateMap.get(rowNum);
      if (u) {
        return [u.keepChecked, u.status, u.user, u.time, u.sysId ?? allData[i][cols.sysId]];
      }
      return [allData[i][cols.post],      allData[i][cols.status],
              allData[i][cols.enteredBy], allData[i][cols.timestamp],
              allData[i][cols.sysId]];
    });
  },

  /** @private Apply row backgrounds, grouping contiguous same-color rows into one setBackground call per group. */
  _applyUnpaidBatchBackgrounds: function(sheet, startRow, numRows, pendingStatusUpdates) {
    const updateMap = new Map(pendingStatusUpdates.map(u => [u.rowNum, u.bgColor]));
    let groupStart = null, groupColor = null;

    const flushGroup = (endRow) => {
      if (groupStart !== null) {
        sheet.getRange(groupStart, 2, endRow - groupStart + 1, CONFIG.totalColumns.daily - 5)
             .setBackground(groupColor);
      }
    };

    for (let i = 0; i < numRows; i++) {
      const rowNum = startRow + i;
      const color  = updateMap.get(rowNum) ?? null;
      if (color !== groupColor) {
        flushGroup(rowNum - 1);
        groupStart = color ? rowNum : null;
        groupColor = color;
      }
    }
    flushGroup(startRow + numRows - 1);
  },

  /** @private Phase 5: calculate metrics, show completion toast, return results. */
  _reportBatchPostResults: function(context) {
    const { results, startTime, connectionMode } = context;
    results.duration = Date.now() - startTime;
    results.avgTimePerRow = results.posted > 0
      ? Math.round(results.duration / results.posted) : 0;

    UIUtils.toast(
      `Completed in ${(results.duration / 1000).toFixed(1)}s (${connectionMode} mode): ` +
      `${results.posted} posted, ${results.failed} failed, ${results.skipped} skipped`,
      'Success', 5
    );
    return results;
  },

  /**
   * PRIVATE: Pre-fetch Master DB sheet references and last-row counters.
   *
   * In MASTER mode every getLastRow() call is a remote API call (~500ms).
   * By reading both last-row values once before the batch loop and tracking
   * them as in-memory counters, createInvoice() and _recordPayment() can
   * skip their per-row getLastRow() calls entirely.
   *
   * Returns null in LOCAL mode (no optimisation needed there).
   *
   * @returns {{invoiceSheet, paymentSheet, invoiceNextRow: number, paymentNextRow: number}|null}
   * @private
   */
  _initBatchContext: function() {
    // PERF FIX Issue 4: Acquire ONE script lock for the entire batch.
    // createInvoice() and _recordPayment() skip their per-row lock when
    // batchContext.batchLock is present, eliminating ~100 lock ops per 50 rows.
    // Non-fatal if acquisition fails — callees fall back to per-row locks.
    const batchLock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);

    try {
      // Fetch sheet refs for both LOCAL and MASTER modes.
      // MasterDatabaseUtils.getTargetSheet() routes to the correct sheet automatically.
      const invoiceSheet = MasterDatabaseUtils.getTargetSheet('invoice');
      const paymentSheet = MasterDatabaseUtils.getTargetSheet('payment');
      return {
        batchLock,
        invoiceSheet,
        paymentSheet,
        invoiceNextRow:        invoiceSheet.getLastRow() + 1,
        paymentNextRow:        paymentSheet.getLastRow() + 1,
        // Deferred-write buffers for Regular/Partial/Due batch flush
        invoiceFirstRow:       null,   // set on first invoice push
        pendingInvoiceRows:    [],     // Array<Array[13]> — flushed by flushPendingRegularInvoices
        paymentFirstRow:       null,   // set on first payment push
        pendingPaymentRows:    [],     // Array<Array[12]> — flushed by flushPendingPaymentRows
        pendingPaidDateChecks: [],     // Array<{invoiceRow, invoiceNo, supplier, paymentDate, paymentType}>
      };
    } catch (e) {
      // Non-fatal — fall back to per-row getLastRow() + writes; lock still carried.
      // No buffer fields: createInvoice/_recordPayment detect absence and write immediately.
      AuditLogger.logWarning('UIMenuBatchPosting._initBatchContext',
        `Failed to pre-fetch batch context: ${e.toString()}`);
      return { batchLock };
    }
  },

  /** @private Initialise batch context for an all-Unpaid batch: acquires lock + pre-fetches invoice sheet. */
  _initUnpaidBatchContext: function() {
    const batchLock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
    try {
      const invoiceSheet = MasterDatabaseUtils.getTargetSheet('invoice');
      return {
        batchLock,
        invoiceSheet,
        paymentSheet:       null,
        invoiceNextRow:     invoiceSheet.getLastRow() + 1,
        invoiceFirstRow:    null,
        pendingInvoiceRows: [],
        paymentNextRow:     null,
      };
    } catch (e) {
      LockManager.releaseLock(batchLock);
      AuditLogger.logWarning('UIMenuBatchPosting._initUnpaidBatchContext',
        `Failed to pre-fetch invoice sheet for Unpaid batch: ${e.toString()}`);
      throw e;
    }
  },

  /** @private Returns true if every non-empty row in allData has paymentType === 'Unpaid'. Returns false for all-blank selections. */
  _isAllUnpaidBatch: function(allData) {
    let hasData = false;
    const supplierCol    = CONFIG.cols.supplier;
    const paymentTypeCol = CONFIG.cols.paymentType;
    for (let i = 0; i < allData.length; i++) {
      if (!allData[i][supplierCol]) continue;
      hasData = true;
      if (allData[i][paymentTypeCol] !== 'Unpaid') return false;
    }
    return hasData;
  },

  /**
   * PRIVATE: Build data object from row data array
   *
   * Extracts invoice date from daily sheet (cell A3) or constructs from sheet name.
   * Used by both validation and posting operations.
   *
   * @param {Array} rowData - Array of cell values
   * @param {number} rowNum - Row number
   * @param {string} sheetName - Sheet name
   * @param {string} enteredBy - User email (Phase 2 optimization - parameter passing)
   * @return {Object} Data object with all transaction fields
   * @private
   */
  _buildDataObject: function(rowData, rowNum, sheetName, enteredBy = null) {
    // Get transaction date from daily sheet (cell B3) - used for both invoice and payment dates
    const transactionDate = getDailySheetDate(sheetName) || new Date();

    // Use provided enteredBy or fallback to detection (Phase 2 parameter passing optimization)
    const finalEnteredBy = enteredBy || UserResolver.getCurrentUser();

    return {
      supplier: rowData[CONFIG.cols.supplier],
      invoiceNo: rowData[CONFIG.cols.invoiceNo],
      receivedAmt: parseFloat(rowData[CONFIG.cols.receivedAmt]) || 0,
      paymentType: rowData[CONFIG.cols.paymentType],
      prevInvoice: rowData[CONFIG.cols.prevInvoice],
      paymentAmt: parseFloat(rowData[CONFIG.cols.paymentAmt]) || 0,
      notes: rowData[CONFIG.cols.notes] || '',
      sysId: rowData[CONFIG.cols.sysId],
      invoiceDate: transactionDate,   // Invoice date from daily sheet (cell B3)
      paymentDate: transactionDate,   // Payment date from daily sheet (cell B3) - same as invoice date
      enteredBy: finalEnteredBy,
      timestamp: DateUtils.formatTimestamp(),  // MM/DD/YYYY HH:mm:ss
      rowNum: rowNum,
      sheetName: sheetName
    };
  },

  /**
   * PRIVATE: Calculate dynamic progress update interval based on total rows
   *
   * Aims for ~10 progress updates regardless of batch size:
   * - Small batches (1-50): Update every 5 rows
   * - Medium batches (51-100): Update every 10 rows
   * - Large batches (101-500): Update every 50 rows
   * - Extra large (500+): Update every 100 rows
   *
   * @param {number} totalRows - Total number of rows to process
   * @return {number} Interval for progress updates
   * @private
   */
  _calculateProgressInterval: function(totalRows) {
    const targetUpdates = 10;
    const minInterval = 5;
    const maxInterval = 100;

    const calculatedInterval = Math.ceil(totalRows / targetUpdates);
    return Math.max(minInterval, Math.min(maxInterval, calculatedInterval));
  },

  /**
   * PRIVATE: Build the text body for the validation/posting results dialog.
   *
   * @param {Object}  results    - Results object with validation/posting data
   * @param {boolean} isPosting  - True if posting operation, false if validation only
   * @param {number}  maxErrors  - Maximum error entries to show before truncating
   * @return {string} Formatted multi-line message string
   * @private
   */
  _buildValidationMessage: function(results, isPosting, maxErrors) {
    let message = `Total Rows Processed: ${results.total}\n`;

    if (isPosting) {
      message += `Successfully Posted: ${results.posted}\n`;
      message += `Failed: ${results.failed}\n`;
    } else {
      message += `Valid: ${results.valid}\n`;
      message += `Invalid: ${results.invalid}\n`;
    }

    message += `Skipped (empty or already posted): ${results.skipped}\n`;

    if (isPosting && results.connectionMode) {
      message += `\n--- Performance ---\n`;
      message += `Connection Mode: ${results.connectionMode}\n`;
      message += `Total Duration: ${(results.duration / 1000).toFixed(1)}s\n`;
      if (results.posted > 0) {
        message += `Avg Time/Row: ${results.avgTimePerRow}ms\n`;
      }
      if (results.connectionMode === 'MASTER') {
        message += `\nNote: Master mode may be slightly slower due to\n`;
        message += `cross-file writes (+50-100ms per row expected).\n`;
      }
    }

    message += '\n';

    if (results.errors && results.errors.length > 0) {
      message += '--- Errors ---\n';
      const errorsToShow = results.errors.slice(0, maxErrors);
      errorsToShow.forEach(function(err) {
        message += `Row ${err.row}: ${err.supplier} - ${err.invoiceNo}\n`;
        message += `  Error: ${err.error}\n\n`;
      });
      if (results.errors.length > maxErrors) {
        message += `... and ${results.errors.length - maxErrors} more errors.\n`;
        message += 'Check the Status column (K) for details.\n';
      }
    }

    return message;
  },

  /**
   * PRIVATE: Determine if payment should be processed for this row
   *
   * @param {Object} data - Transaction data object
   * @return {boolean} True if payment should be recorded
   * @private
   */
  _shouldProcessPayment: function(data) {
    // Process payment for all types except when receiving new invoice with no payment
    return !(data.paymentType === 'Unpaid' && data.paymentAmt === 0);
  },

  /**
   * PRIVATE: Create empty validation results object
   *
   * @return {Object} Empty results structure
   * @private
   */
  _createEmptyResults: function() {
    return {
      total: 0,
      valid: 0,
      invalid: 0,
      skipped: 0,
      errors: []
    };
  },

  /**
   * PRIVATE: Create empty posting results object
   *
   * @param {string} connectionMode - 'LOCAL' or 'MASTER'
   * @return {Object} Empty results structure with posting fields
   * @private
   */
  _createEmptyPostResults: function(connectionMode) {
    return {
      total: 0,
      posted: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      connectionMode: connectionMode,
      duration: 0,
      avgTimePerRow: 0
    };
  },

}; // end UIMenuBatchPosting
