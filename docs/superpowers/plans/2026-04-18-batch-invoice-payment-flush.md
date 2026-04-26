# Batch Invoice & Payment Flush Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate N-per-row `setValues()` calls in Regular/Partial/Due batch posting by deferring all invoice and payment writes to two single-flush API calls after the loop.

**Architecture:** Extend `batchContext` with deferred-write buffers (`pendingInvoiceRows`, `pendingPaymentRows`, `pendingPaidDateChecks`). The batch loop accumulates; post-loop flush methods write everything in one call each. Balance calculations move post-flush so SUMIFS values are accurate. Follows the existing Unpaid batch pattern (`flushPendingInvoiceRows`).

**Tech Stack:** Google Apps Script (V8), Google Sheets API (SpreadsheetApp). No external dependencies. All tests run manually from Script Editor.

---

## File Map

| File | Role | Change type |
|------|------|-------------|
| `UIMenu.gs` | Batch orchestration | Modify `_initBatchContext`, `_initBatchPostSetup`, `_runBatchPostLoop`, `_handleRegularBatchPosting`; add `_markAllPendingAsFailed`, `_runPaidDatePass`, `_runBalancePass` |
| `InvoiceManager.gs` | Invoice CRUD | Modify `createInvoice` line 215; add `flushPendingRegularInvoices` |
| `PaymentManager.gs` | Payment CRUD | Modify `_recordPayment` lines 341–346, `processPayment` lines 65–102; add `flushPendingPaymentRows` |
| `Test.BatchFlush.gs` | Unit tests | New file |
| `Benchmark.Performance.gs` | Benchmark | Add `runBatchFlushBenchmark` |

---

## Task 1: Commit spec doc

**Files:**
- Already created: `docs/superpowers/specs/2026-04-18-batch-invoice-payment-flush-design.md`

- [ ] **Step 1: Stage and commit the spec**

```bash
git add docs/superpowers/specs/2026-04-18-batch-invoice-payment-flush-design.md
git commit -m "docs(specs): add batch invoice+payment flush design spec"
```

---

## Task 2: Extend `_initBatchContext()` — add buffer fields

**Files:**
- Modify: `UIMenu.gs:1555–1583`

**Context:** `_initBatchContext` currently has a local-mode early return that sets sheets/rows to null.
We remove it (both modes can fetch their own sheets via `MasterDatabaseUtils.getTargetSheet`) and add
five new deferred-write buffer fields. The minimal fallback on exception omits buffers so callers
fall back to per-row writes.

- [ ] **Step 1: Replace `_initBatchContext` body**

In `UIMenu.gs`, replace the entire function body (lines 1555–1583):

```javascript
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
      pendingPaidDateChecks: [],     // Array<{invoiceRow, invoiceNo, supplier}>
    };
  } catch (e) {
    // Non-fatal — fall back to per-row getLastRow() + writes; lock still carried.
    // No buffer fields: createInvoice/_recordPayment detect absence and write immediately.
    AuditLogger.logWarning('UIMenu._initBatchContext',
      `Failed to pre-fetch batch context: ${e.toString()}`);
    return { batchLock };
  }
},
```

- [ ] **Step 2: Verify no syntax errors**

Open the Script Editor, navigate to UIMenu.gs, and confirm the file saves without error (the editor highlights syntax errors on save).

- [ ] **Step 3: Commit**

```bash
git add UIMenu.gs
git commit -m "refactor(UIMenu): extend _initBatchContext with deferred-write buffer fields"
```

---

## Task 3: Add `pendingBalanceRows` to batch context object

**Files:**
- Modify: `UIMenu.gs:731–747` (inside `_initBatchPostSetup`)

**Context:** Balance calculations currently happen mid-loop via `_queueBalanceUpdate`, reading SUMIFS
before PaymentLog is written. We defer them post-flush by accumulating `{rowNum, supplier}` pairs
in `pendingBalanceRows` and computing the actual balance in `_runBalancePass` after both flushes.

- [ ] **Step 1: Add `pendingBalanceRows: []` to the context return object**

In `UIMenu.gs`, find the return object inside `_initBatchPostSetup` (around line 731). Add one line:

```javascript
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
```

- [ ] **Step 2: Verify save**

Save UIMenu.gs in Script Editor — no errors.

- [ ] **Step 3: Commit**

```bash
git add UIMenu.gs
git commit -m "refactor(UIMenu): add pendingBalanceRows accumulator to batch context"
```

---

## Task 4: Guard cache update in `createInvoice()`

**Files:**
- Modify: `InvoiceManager.gs:215`

**Context:** `CacheManager.addInvoiceToCache(newRow, newRowData)` is currently called unconditionally
after writing (or deferring). In deferred mode the row hasn't been written yet; the runtime cache
expires after each execution anyway, so the update has no benefit. We guard it so it only fires on
the immediate (non-deferred) path.

- [ ] **Step 1: Write failing test**

Add to `Test.InvoiceManager.gs` (at the bottom, before the closing `};` of the test object):

```javascript
testCreateInvoiceSkipsCacheInDeferredMode: function() {
  const results = [];
  // Minimal fake batchContext with pendingInvoiceRows — triggers deferred path
  const fakeBatchCtx = {
    batchLock:           {},
    invoiceSheet:        null,   // deferred path never calls sheet directly
    invoiceNextRow:      100,
    invoiceFirstRow:     null,
    pendingInvoiceRows:  [],
    paymentFirstRow:     null,
    pendingPaymentRows:  [],
    pendingPaidDateChecks: [],
  };

  // Intercept CacheManager.addInvoiceToCache
  const originalAdd = CacheManager.addInvoiceToCache;
  let cacheWasCalled = false;
  CacheManager.addInvoiceToCache = function() { cacheWasCalled = true; };

  try {
    InvoiceManager.createInvoice({
      supplier: 'Test Supplier', invoiceNo: 'INV-CACHE-TEST',
      receivedAmt: 500, sheetName: 'TestSheet',
      sysId: 'SYS-001', timestamp: new Date(), enteredBy: 'test@test.com',
    }, null, fakeBatchCtx);

    results.push(cacheWasCalled ? 'FAIL: cache was called in deferred mode'
                                : 'PASS: cache skipped in deferred mode');
    results.push(fakeBatchCtx.pendingInvoiceRows.length === 1
      ? 'PASS: row added to pendingInvoiceRows'
      : 'FAIL: pendingInvoiceRows is empty');
  } finally {
    CacheManager.addInvoiceToCache = originalAdd;
  }

  Logger.log(results.join('\n'));
  return results;
},
```

- [ ] **Step 2: Run test — expect FAIL**

In Script Editor: Run → `testCreateInvoiceSkipsCacheInDeferredMode`. Expected output:
```
FAIL: cache was called in deferred mode
PASS: row added to pendingInvoiceRows
```
(First line fails because the guard doesn't exist yet.)

- [ ] **Step 3: Add the guard in `createInvoice()`**

In `InvoiceManager.gs`, find line 215 (currently reads):
```javascript
      // ═══ ADD TO CACHE (Write-Through) - KEY FIX ═══
      CacheManager.addInvoiceToCache(newRow, newRowData);
```

Replace with:
```javascript
      // ═══ ADD TO CACHE (Write-Through) ═══
      // Skip in deferred batch mode — runtime cache is execution-scoped and expires
      // after each run; the next execution repopulates from the sheet automatically.
      if (!batchContext?.pendingInvoiceRows) {
        CacheManager.addInvoiceToCache(newRow, newRowData);
      }
```

- [ ] **Step 4: Run test — expect PASS**

Run → `testCreateInvoiceSkipsCacheInDeferredMode`. Expected:
```
PASS: cache skipped in deferred mode
PASS: row added to pendingInvoiceRows
```

- [ ] **Step 5: Commit**

```bash
git add InvoiceManager.gs Test.InvoiceManager.gs
git commit -m "fix(InvoiceManager): skip cache update in deferred batch mode"
```

---

## Task 5: Add `flushPendingRegularInvoices()` to InvoiceManager

**Files:**
- Modify: `InvoiceManager.gs` — insert after `flushPendingInvoiceRows` (after line ~245)

**Context:** `flushPendingInvoiceRows` (for Unpaid batches) has no error handling. The new method
for Regular/Partial/Due is a separate function (per design decision B) with try-catch, AuditLogger,
and a structured return so the caller can react to failures.

- [ ] **Step 1: Write failing test**

Create new file `Test.BatchFlush.gs`:

```javascript
/**
 * Test.BatchFlush.gs — Unit tests for deferred-write flush methods
 * Run each function from Script Editor → Execution Log shows PASS/FAIL lines.
 */

// ─── flushPendingRegularInvoices ─────────────────────────────────────────────

function testFlushRegularInvoices_EmptyGuard() {
  const ctx = { pendingInvoiceRows: [], invoiceFirstRow: null, invoiceSheet: null };
  const result = InvoiceManager.flushPendingRegularInvoices(ctx);
  Logger.log(result.success === true && result.failedCount === 0
    ? 'PASS: empty buffer returns success without writing'
    : 'FAIL: ' + JSON.stringify(result));
}

function testFlushRegularInvoices_SuccessPath() {
  let rangeCallCount = 0;
  const fakeSheet = {
    getRange: function(r, c, rows, cols) {
      rangeCallCount++;
      return { setValues: function(data) { /* no-op */ } };
    }
  };
  const fakeRow = ['2026-01-01', 'SupA', 'INV-1', 100, '', '', '', '', '', 'Sheet1', 'u@u.com', '2026-01-01', 'SYS-1'];
  const ctx = {
    pendingInvoiceRows: [fakeRow],
    invoiceFirstRow:    10,
    invoiceSheet:       fakeSheet,
  };
  const result = InvoiceManager.flushPendingRegularInvoices(ctx);
  Logger.log(result.success === true ? 'PASS: success path returns success' : 'FAIL: ' + JSON.stringify(result));
  Logger.log(rangeCallCount === 1 ? 'PASS: setValues called exactly once' : 'FAIL: setValues called ' + rangeCallCount + ' times');
}

function testFlushRegularInvoices_FailurePath() {
  const fakeSheet = {
    getRange: function() {
      return { setValues: function() { throw new Error('quota exceeded'); } };
    }
  };
  const ctx = {
    pendingInvoiceRows: [['row1'], ['row2']],
    invoiceFirstRow:    5,
    invoiceSheet:       fakeSheet,
  };
  const result = InvoiceManager.flushPendingRegularInvoices(ctx);
  Logger.log(result.success === false ? 'PASS: failure returns success:false' : 'FAIL');
  Logger.log(result.failedCount === 2 ? 'PASS: failedCount = 2' : 'FAIL: failedCount = ' + result.failedCount);
  Logger.log(typeof result.error === 'string' ? 'PASS: error string present' : 'FAIL: no error string');
}

// ─── flushPendingPaymentRows ──────────────────────────────────────────────────

function testFlushPaymentRows_EmptyGuard() {
  const ctx = { pendingPaymentRows: [], paymentFirstRow: null, paymentSheet: null };
  const result = PaymentManager.flushPendingPaymentRows(ctx);
  Logger.log(result.success === true && result.failedCount === 0
    ? 'PASS: empty buffer returns success without writing'
    : 'FAIL: ' + JSON.stringify(result));
}

function testFlushPaymentRows_SuccessPath() {
  let rangeCallCount = 0;
  const fakeSheet = {
    getRange: function() {
      rangeCallCount++;
      return { setValues: function() {} };
    }
  };
  const fakeRow = ['2026-01-01', 'SupA', 'INV-1', 'Regular', 100, 'Cash', '', 'Sheet1', 'u@u.com', '2026-01-01', 'PAY-1', 'SYS-1'];
  const ctx = {
    pendingPaymentRows: [fakeRow],
    paymentFirstRow:    20,
    paymentSheet:       fakeSheet,
  };
  const result = PaymentManager.flushPendingPaymentRows(ctx);
  Logger.log(result.success === true ? 'PASS: success path returns success' : 'FAIL: ' + JSON.stringify(result));
  Logger.log(rangeCallCount === 1 ? 'PASS: setValues called exactly once' : 'FAIL: called ' + rangeCallCount + ' times');
}

function testFlushPaymentRows_FailurePath() {
  const fakeSheet = {
    getRange: function() {
      return { setValues: function() { throw new Error('network error'); } };
    }
  };
  const ctx = {
    pendingPaymentRows: [['r1'], ['r2'], ['r3']],
    paymentFirstRow:    15,
    paymentSheet:       fakeSheet,
  };
  const result = PaymentManager.flushPendingPaymentRows(ctx);
  Logger.log(result.success === false ? 'PASS: failure returns success:false' : 'FAIL');
  Logger.log(result.failedCount === 3 ? 'PASS: failedCount = 3' : 'FAIL: failedCount = ' + result.failedCount);
  Logger.log(typeof result.error === 'string' ? 'PASS: error string present' : 'FAIL: no error string');
}

// ─── processPayment deferred path ────────────────────────────────────────────

function testProcessPayment_DeferredPath_NoCacheWrite() {
  // Verify that in deferred mode, no immediate setValues and no PaymentCache update occur.
  let setValuesCallCount = 0;
  let cacheCallCount = 0;

  const origAddPaymentToCache = PaymentCache.addPaymentToCache;
  PaymentCache.addPaymentToCache = function() { cacheCallCount++; };

  const fakeBatchCtx = {
    batchLock:             {},
    paymentSheet:          { getRange: function() { return { setValues: function() { setValuesCallCount++; } }; } },
    paymentNextRow:        50,
    paymentFirstRow:       null,
    pendingPaymentRows:    [],
    pendingPaidDateChecks: [],
    invoiceSheet:          null,
    invoiceNextRow:        null,
    invoiceFirstRow:       null,
    pendingInvoiceRows:    [],
  };

  try {
    PaymentManager.processPayment({
      supplier: 'Test Supplier', invoiceNo: 'INV-DEFER-TEST',
      paymentAmt: 100, paymentType: 'Regular',
      prevInvoice: null, sheetName: 'Sheet1',
      sysId: 'SYS-DEFER', enteredBy: 'u@u.com',
      timestamp: '01/01/2026 10:00:00',
      paymentDate: new Date(), invoiceDate: new Date(),
    }, 'INV-SYS-1', fakeBatchCtx);

    Logger.log(setValuesCallCount === 0 ? 'PASS: no immediate sheet write' : 'FAIL: setValues called ' + setValuesCallCount + ' times');
    Logger.log(cacheCallCount === 0 ? 'PASS: PaymentCache not updated' : 'FAIL: cache was called');
    Logger.log(fakeBatchCtx.pendingPaymentRows.length === 1 ? 'PASS: row in pendingPaymentRows' : 'FAIL: pendingPaymentRows empty');
  } finally {
    PaymentCache.addPaymentToCache = origAddPaymentToCache;
  }
}
```

- [ ] **Step 2: Run flush tests — expect FAIL**

Run `testFlushRegularInvoices_EmptyGuard`. Expected: `TypeError: InvoiceManager.flushPendingRegularInvoices is not a function`.

- [ ] **Step 3: Add `flushPendingRegularInvoices` to InvoiceManager.gs**

Insert after `flushPendingInvoiceRows` (after line ~245 in InvoiceManager.gs):

```javascript
  /**
   * Flush buffered Regular/Partial/Due invoice rows to the sheet in a single write.
   * Called once after _runBatchPostLoop completes. No-op if buffer is empty.
   * On failure: logs error, returns {success:false, failedCount} — caller marks rows FAILED.
   *
   * @param {Object} batchContext - Batch context with pendingInvoiceRows buffer
   * @returns {{success: boolean, failedCount: number, error?: string}}
   */
  flushPendingRegularInvoices: function(batchContext) {
    if (!batchContext?.pendingInvoiceRows?.length) return { success: true, failedCount: 0 };
    if (batchContext.invoiceFirstRow === null)      return { success: true, failedCount: 0 };

    const rows      = batchContext.pendingInvoiceRows;
    const firstRow  = batchContext.invoiceFirstRow;
    const invoiceSh = batchContext.invoiceSheet || MasterDatabaseUtils.getTargetSheet('invoice');

    try {
      invoiceSh.getRange(firstRow, 1, rows.length, rows[0].length).setValues(rows);
      return { success: true, failedCount: 0 };
    } catch (error) {
      AuditLogger.logError('InvoiceManager.flushPendingRegularInvoices', error.toString());
      return { success: false, failedCount: rows.length, error: error.toString() };
    }
  },
```

- [ ] **Step 4: Run flush tests — expect PASS**

Run all three `testFlushRegularInvoices_*` functions. All should log PASS lines.

- [ ] **Step 5: Commit**

```bash
git add InvoiceManager.gs Test.BatchFlush.gs
git commit -m "feat(InvoiceManager): add flushPendingRegularInvoices with error handling"
```

---

## Task 6: Defer payment write in `_recordPayment()`

**Files:**
- Modify: `PaymentManager.gs:341–346`

**Context:** `_recordPayment` currently writes immediately via `setValues` and updates `PaymentCache`
on every call. In deferred batch mode (detected by `Array.isArray(batchContext?.pendingPaymentRows)`),
we push to the buffer instead. `PaymentCache` is skipped — it's execution-scoped and self-heals.

- [ ] **Step 1: Replace the write block in `_recordPayment`**

In `PaymentManager.gs`, find lines 341–346:
```javascript
      // Single write operation for payment
      paymentSh.getRange(newRow, 1, 1, CONFIG.totalColumns.payment).setValues([paymentRow]);

      // ═══ WRITE-THROUGH CACHE ═══
      // Add payment to cache for immediate availability
      PaymentCache.addPaymentToCache(newRow, paymentRow);
```

Replace with:
```javascript
      // ═══ WRITE TO SHEET (or defer to batch flush) ═══
      if (Array.isArray(batchContext?.pendingPaymentRows)) {
        if (batchContext.paymentFirstRow === null) batchContext.paymentFirstRow = newRow;
        batchContext.pendingPaymentRows.push(paymentRow);
        // Skip PaymentCache in deferred mode — runtime cache is execution-scoped;
        // the next execution repopulates from the sheet automatically.
      } else {
        paymentSh.getRange(newRow, 1, 1, CONFIG.totalColumns.payment).setValues([paymentRow]);
        // ═══ WRITE-THROUGH CACHE ═══
        PaymentCache.addPaymentToCache(newRow, paymentRow);
      }
```

- [ ] **Step 2: Run deferred path test**

Run `testProcessPayment_DeferredPath_NoCacheWrite`. Expected:
```
PASS: no immediate sheet write
PASS: PaymentCache not updated
PASS: row in pendingPaymentRows
```
(This test may still show partial failure if processPayment hasn't been updated yet — that's Task 7.)

- [ ] **Step 3: Commit**

```bash
git add PaymentManager.gs
git commit -m "feat(PaymentManager): defer payment write in _recordPayment when batch buffer present"
```

---

## Task 7: Skip paidDate logic in `processPayment()` when deferred

**Files:**
- Modify: `PaymentManager.gs:65–102`

**Context:** `processPayment` currently runs steps 3–4 (cache update + paidDate write) immediately
after `_recordPayment`. In deferred mode, PaymentLog hasn't been written yet so SUMIFS are stale;
paidDate determination must happen post-flush. We push candidates to `pendingPaidDateChecks` instead.

- [ ] **Step 1: Modify `processPayment`**

In `PaymentManager.gs`, replace `processPayment` (lines 65–102):

```javascript
  processPayment: function(data, invoiceId, batchContext = null) {
    // Step 1: Validate payment amount
    const validationError = this._validatePaymentAmount(data);
    if (validationError) return validationError;

    try {
      // Step 2: Record payment (lock acquired internally)
      const paymentRecorded = this._recordPayment(data, invoiceId, batchContext);
      if (!paymentRecorded.success) return paymentRecorded;

      const { paymentId, targetInvoice } = paymentRecorded;

      // Deferred batch mode: skip steps 3-4, queue paidDate check for post-flush pass.
      // PaymentLog is not yet written so SUMIFS are stale — paidDate is determined
      // in UIMenu._runPaidDatePass after flushPendingPaymentRows succeeds.
      if (Array.isArray(batchContext?.pendingPaymentRows)) {
        if (this._shouldUpdatePaidDate(data.paymentType) && targetInvoice) {
          const invoice = InvoiceManager.findInvoice(data.supplier, targetInvoice);
          if (invoice) {
            batchContext.pendingPaidDateChecks.push({
              invoiceRow: invoice.row,
              invoiceNo:  targetInvoice,
              supplier:   data.supplier,
            });
          }
        }
        return this._buildPaymentResult(paymentRecorded, {
          attempted: false, success: false, fullyPaid: false,
          paidDateUpdated: false, reason: 'deferred',
        });
      }

      // Non-deferred path (single-row posting): existing steps 3-5 unchanged.
      // Step 3: Update cache and fetch invoice data
      const cachedInvoice = this._updateCacheAndFetchInvoice(data.supplier, targetInvoice);

      // Step 4: Handle paid status update (lock acquired internally if needed)
      const paidStatusResult = this._handlePaidStatusUpdate(
        targetInvoice,
        data,
        paymentId,
        cachedInvoice
      );

      // Step 5: Build and return consolidated result
      return this._buildPaymentResult(paymentRecorded, paidStatusResult);

    } catch (error) {
      AuditLogger.logError('PaymentManager.processPayment', error.toString());
      return {
        success: false,
        error: error.toString()
      };
    }
  },
```

- [ ] **Step 2: Run deferred path test again**

Run `testProcessPayment_DeferredPath_NoCacheWrite`. All three lines should now read PASS.

- [ ] **Step 3: Run existing PaymentManager tests**

Run the existing `runPaymentManagerTests` (or equivalent entry point in `Test.PaymentManager.gs`).
All previously passing tests must still pass — non-deferred path is unchanged.

- [ ] **Step 4: Commit**

```bash
git add PaymentManager.gs
git commit -m "feat(PaymentManager): skip paidDate steps in deferred batch mode; queue for post-flush"
```

---

## Task 8: Add `flushPendingPaymentRows()` to PaymentManager

**Files:**
- Modify: `PaymentManager.gs` — add new public method

- [ ] **Step 1: Run payment flush tests — expect FAIL**

Run `testFlushPaymentRows_EmptyGuard`. Expected: `TypeError: PaymentManager.flushPendingPaymentRows is not a function`.

- [ ] **Step 2: Add `flushPendingPaymentRows` to PaymentManager.gs**

Insert as a new public method in the `PaymentManager` object (after `processPayment`, before the first private helper):

```javascript
  /**
   * Flush buffered payment rows to PaymentLog in a single write.
   * Called once after _runBatchPostLoop completes. No-op if buffer is empty.
   * On failure: logs error, returns {success:false, failedCount} — caller marks rows FAILED.
   * Mirrors InvoiceManager.flushPendingRegularInvoices — same pattern, different sheet.
   *
   * @param {Object} batchContext - Batch context with pendingPaymentRows buffer
   * @returns {{success: boolean, failedCount: number, error?: string}}
   */
  flushPendingPaymentRows: function(batchContext) {
    if (!batchContext?.pendingPaymentRows?.length) return { success: true, failedCount: 0 };
    if (batchContext.paymentFirstRow === null)      return { success: true, failedCount: 0 };

    const rows      = batchContext.pendingPaymentRows;
    const firstRow  = batchContext.paymentFirstRow;
    const paymentSh = batchContext.paymentSheet || MasterDatabaseUtils.getTargetSheet('payment');

    try {
      paymentSh.getRange(firstRow, 1, rows.length, rows[0].length).setValues(rows);
      return { success: true, failedCount: 0 };
    } catch (error) {
      AuditLogger.logError('PaymentManager.flushPendingPaymentRows', error.toString());
      return { success: false, failedCount: rows.length, error: error.toString() };
    }
  },
```

- [ ] **Step 3: Run all payment flush tests — expect PASS**

Run `testFlushPaymentRows_EmptyGuard`, `testFlushPaymentRows_SuccessPath`, `testFlushPaymentRows_FailurePath`. All should log PASS.

- [ ] **Step 4: Commit**

```bash
git add PaymentManager.gs
git commit -m "feat(PaymentManager): add flushPendingPaymentRows with error handling"
```

---

## Task 9: Defer balance calculation in `_runBatchPostLoop()`

**Files:**
- Modify: `UIMenu.gs:777`

**Context:** `_queueBalanceUpdate` (line 777) calls `BalanceCalculator.getSupplierOutstanding()`
mid-loop before PaymentLog is flushed. The SUMIFS value is stale. We replace it with a cheap
accumulation of `{rowNum, supplier}` pairs; `_runBalancePass` resolves them post-flush.

- [ ] **Step 1: Replace line 777 in `_runBatchPostLoop`**

Find this line in `_runBatchPostLoop` (UIMenu.gs ~line 777):
```javascript
          this._queueBalanceUpdate(data, rowNum, context); // Stage 3: State Capture
```

Replace with:
```javascript
          context.pendingBalanceRows.push({ rowNum, supplier: data.supplier }); // Stage 3: defer balance — resolved post-flush
```

- [ ] **Step 2: Verify save**

Save UIMenu.gs. No syntax errors.

- [ ] **Step 3: Commit**

```bash
git add UIMenu.gs
git commit -m "refactor(UIMenu): defer balance calculation from loop to post-flush pass"
```

---

## Task 10: Rewrite `_handleRegularBatchPosting()` + add helpers

**Files:**
- Modify: `UIMenu.gs:692–696`
- Add: `_markAllPendingAsFailed`, `_runPaidDatePass`, `_runBalancePass` to `UIMenu.gs`

**Context:** `_handleRegularBatchPosting` currently calls the loop then flushes the daily sheet.
We insert the 4-step post-loop flush sequence between them. New helpers are added to UIMenu as
private methods alongside the existing batch helpers.

- [ ] **Step 1: Replace `_handleRegularBatchPosting`**

In `UIMenu.gs`, replace lines 692–696:

```javascript
  /** @private Orchestrate the Regular/Partial/Due path: accumulate then bulk-flush. */
  _handleRegularBatchPosting: function(context) {
    this._runBatchPostLoop(context);                           // Phase 2: accumulate

    // Phase 3a — Invoice flush (1 API call to InvoiceDatabase)
    const invResult = InvoiceManager.flushPendingRegularInvoices(context.batchContext);
    if (!invResult.success) {
      this._markAllPendingAsFailed(context, invResult);
      this._flushRegularDailySheetUpdates(context);           // Write FAILED status to daily sheet
      return;
    }

    // Phase 3b — Payment flush (1 API call to PaymentLog)
    const payResult = PaymentManager.flushPendingPaymentRows(context.batchContext);
    if (!payResult.success) {
      this._markAllPendingAsFailed(context, payResult);
      AuditLogger.logWarning('UIMenu._handleRegularBatchPosting',
        'PARTIAL_FLUSH_STATE: Invoices written to InvoiceDatabase; payments NOT written to PaymentLog — reconcile via AuditLog');
      this._flushRegularDailySheetUpdates(context);
      return;
    }

    // Phase 3c — paidDate pass: read recalculated SUMIFS, write paidDate per fully-paid invoice
    this._runPaidDatePass(context.batchContext);

    // Phase 3d — Balance pass: compute once per unique supplier; SUMIFS now accurate
    this._runBalancePass(context);

    // Phase 4: flush daily sheet (sysId col, balance col, status grid + backgrounds)
    this._flushRegularDailySheetUpdates(context);
  },
```

- [ ] **Step 2: Add `_markAllPendingAsFailed` helper**

Add immediately after `_handleRegularBatchPosting` in UIMenu.gs:

```javascript
  /** @private Mark all POSTED status updates as FAILED when a flush fails. */
  _markAllPendingAsFailed: function(context, flushResult) {
    const failMsg = `Flush failed: ${(flushResult.error || 'unknown error').substring(0, 80)}`;
    context.results.failed  += flushResult.failedCount;
    context.results.posted   = Math.max(0, context.results.posted - flushResult.failedCount);
    for (const u of context.pendingStatusUpdates) {
      if (u.bgColor === CONFIG.colors.success) {
        u.bgColor     = CONFIG.colors.error;
        u.status      = `ERROR: ${failMsg}`;
        u.keepChecked = false;
      }
    }
  },
```

- [ ] **Step 3: Add `_runPaidDatePass` helper**

Add after `_markAllPendingAsFailed`:

```javascript
  /**
   * @private Post-flush: for each invoice that received a payment, read the
   * recalculated SUMIFS balanceDue and write paidDate if fully settled.
   * Individual write per invoice — non-contiguous rows; failure is non-critical.
   */
  _runPaidDatePass: function(batchContext) {
    if (!batchContext?.pendingPaidDateChecks?.length) return;
    const invoiceSh = batchContext.invoiceSheet || MasterDatabaseUtils.getTargetSheet('invoice');
    const col    = CONFIG.invoiceCols;
    const today  = new Date();
    const thresh = InvoiceManager.CONSTANTS.BALANCE_THRESHOLD;

    for (const check of batchContext.pendingPaidDateChecks) {
      try {
        const balance = invoiceSh.getRange(check.invoiceRow, col.balanceDue + 1).getValue();
        if (Number(balance) <= thresh) {
          invoiceSh.getRange(check.invoiceRow, col.paidDate + 1).setValue(today);
        }
      } catch (e) {
        AuditLogger.logWarning('UIMenu._runPaidDatePass',
          `PAID_DATE_WRITE_FAILED: invoice ${check.invoiceNo} row ${check.invoiceRow}: ${e.toString()}`);
      }
    }
  },
```

- [ ] **Step 4: Add `_runBalancePass` helper**

Add after `_runPaidDatePass`:

```javascript
  /**
   * @private Post-flush: compute getSupplierOutstanding once per unique supplier
   * (SUMIFS now accurate) and populate pendingBalanceUpdates for _flushBalanceUpdates.
   * Per-supplier failure is non-critical — logs warning and continues.
   */
  _runBalancePass: function(context) {
    if (!context.pendingBalanceRows?.length) return;
    const seen = new Map(); // supplier → balance (computed once per supplier)
    for (const { rowNum, supplier } of context.pendingBalanceRows) {
      try {
        if (!seen.has(supplier)) {
          seen.set(supplier, BalanceCalculator.getSupplierOutstanding(supplier));
        }
        context.pendingBalanceUpdates.push({ rowNum, balance: seen.get(supplier) });
      } catch (e) {
        AuditLogger.logWarning('UIMenu._runBalancePass',
          `BALANCE_PASS_FAILED: ${supplier}: ${e.toString()}`);
      }
    }
  },
```

- [ ] **Step 5: Verify save**

Save UIMenu.gs in Script Editor. No syntax errors.

- [ ] **Step 6: Smoke test — post 1 Regular row manually**

In the Script Editor, post a single Regular row in a test daily sheet via the UIMenu batch option.
Verify:
- InvoiceDatabase: new row appended
- PaymentLog: new payment entry
- Daily sheet: row shows POSTED with green background

- [ ] **Step 7: Commit**

```bash
git add UIMenu.gs
git commit -m "feat(UIMenu): rewrite _handleRegularBatchPosting with post-flush sequence; add _markAllPendingAsFailed, _runPaidDatePass, _runBalancePass"
```

---

## Task 11: Integration tests

**Files:**
- Modify: `Test.BatchFlush.gs` — add integration test functions

- [ ] **Step 1: Add integration tests to `Test.BatchFlush.gs`**

Append to `Test.BatchFlush.gs`:

```javascript
// ─── Integration: happy path ──────────────────────────────────────────────────

/**
 * Happy path: verifies flushPendingRegularInvoices + flushPendingPaymentRows each
 * call setValues exactly once across a simulated 5-row batch.
 * Run from Script Editor. Check Execution Log for PASS/FAIL.
 */
function testIntegration_HappyPath_SingleFlushEach() {
  let invoiceWriteCount = 0;
  let paymentWriteCount = 0;

  const fakeInvoiceSheet = {
    getRange: function() { return { setValues: function() { invoiceWriteCount++; } }; }
  };
  const fakePaymentSheet = {
    getRange: function() { return { setValues: function() { paymentWriteCount++; } }; }
  };

  const batchCtx = {
    batchLock:             null,
    invoiceSheet:          fakeInvoiceSheet,
    invoiceNextRow:        100,
    invoiceFirstRow:       null,
    pendingInvoiceRows:    [],
    paymentSheet:          fakePaymentSheet,
    paymentNextRow:        50,
    paymentFirstRow:       null,
    pendingPaymentRows:    [],
    pendingPaidDateChecks: [],
  };

  // Simulate 5 rows being deferred
  const fakeInvoiceRow = Array(13).fill('test-data');
  const fakePaymentRow = Array(12).fill('test-data');
  for (let i = 0; i < 5; i++) {
    if (batchCtx.invoiceFirstRow === null) batchCtx.invoiceFirstRow = batchCtx.invoiceNextRow;
    batchCtx.pendingInvoiceRows.push(fakeInvoiceRow);
    batchCtx.invoiceNextRow++;

    if (batchCtx.paymentFirstRow === null) batchCtx.paymentFirstRow = batchCtx.paymentNextRow;
    batchCtx.pendingPaymentRows.push(fakePaymentRow);
    batchCtx.paymentNextRow++;
  }

  InvoiceManager.flushPendingRegularInvoices(batchCtx);
  PaymentManager.flushPendingPaymentRows(batchCtx);

  Logger.log(invoiceWriteCount === 1
    ? 'PASS: 5 invoice rows written in 1 API call'
    : 'FAIL: invoiceWriteCount = ' + invoiceWriteCount);
  Logger.log(paymentWriteCount === 1
    ? 'PASS: 5 payment rows written in 1 API call'
    : 'FAIL: paymentWriteCount = ' + paymentWriteCount);
}

/**
 * Invoice flush failure: verifies that _markAllPendingAsFailed flips POSTED → FAILED
 * and that posted count is decremented.
 */
function testIntegration_InvoiceFlushFailure_MarksAllFailed() {
  // Simulate 3 POSTED status updates
  const context = {
    results: { failed: 0, posted: 3 },
    pendingStatusUpdates: [
      { bgColor: CONFIG.colors.success, status: 'POSTED', keepChecked: true },
      { bgColor: CONFIG.colors.success, status: 'POSTED', keepChecked: true },
      { bgColor: CONFIG.colors.success, status: 'POSTED', keepChecked: true },
    ],
    pendingBalanceRows:   [],
    pendingBalanceUpdates: [],
  };

  // Call the helper directly via UIMenu (it's a method on the UIMenu object)
  UIMenu._markAllPendingAsFailed(context, { failedCount: 3, error: 'quota exceeded' });

  const allFailed = context.pendingStatusUpdates.every(u => u.bgColor === CONFIG.colors.error && !u.keepChecked);
  Logger.log(allFailed ? 'PASS: all status updates flipped to error' : 'FAIL: not all updates flipped');
  Logger.log(context.results.failed === 3 ? 'PASS: failed count = 3' : 'FAIL: failed count = ' + context.results.failed);
  Logger.log(context.results.posted === 0 ? 'PASS: posted count = 0' : 'FAIL: posted count = ' + context.results.posted);
}

/**
 * Balance pass: verifies getSupplierOutstanding called once per unique supplier,
 * not once per row.
 */
function testIntegration_BalancePass_OncePerSupplier() {
  let callCount = 0;
  const origFn = BalanceCalculator.getSupplierOutstanding;
  BalanceCalculator.getSupplierOutstanding = function(supplier) {
    callCount++;
    return 1000;
  };

  const context = {
    pendingBalanceRows: [
      { rowNum: 7, supplier: 'SupA' },
      { rowNum: 8, supplier: 'SupA' },   // duplicate — should NOT trigger second call
      { rowNum: 9, supplier: 'SupB' },
    ],
    pendingBalanceUpdates: [],
  };

  try {
    UIMenu._runBalancePass(context);
    Logger.log(callCount === 2 ? 'PASS: getSupplierOutstanding called twice (once per unique supplier)' : 'FAIL: called ' + callCount + ' times');
    Logger.log(context.pendingBalanceUpdates.length === 3 ? 'PASS: 3 balance updates queued' : 'FAIL: ' + context.pendingBalanceUpdates.length + ' updates');
  } finally {
    BalanceCalculator.getSupplierOutstanding = origFn;
  }
}
```

- [ ] **Step 2: Run integration tests**

Run each:
- `testIntegration_HappyPath_SingleFlushEach` → all PASS
- `testIntegration_InvoiceFlushFailure_MarksAllFailed` → all PASS
- `testIntegration_BalancePass_OncePerSupplier` → all PASS

- [ ] **Step 3: Commit**

```bash
git add Test.BatchFlush.gs
git commit -m "test(BatchFlush): add unit and integration tests for flush methods and helpers"
```

---

## Task 12: Benchmark

**Files:**
- Modify: `Benchmark.Performance.gs`

- [ ] **Step 1: Add `runBatchFlushBenchmark` to Benchmark.Performance.gs**

Append to the existing benchmark file:

```javascript
/**
 * runBatchFlushBenchmark — Compare pre-flush (per-row) vs post-flush (deferred) write counts.
 *
 * Run from Script Editor. Results logged to Execution Log.
 * Requires a live daily sheet with ≥ 10 Regular rows that have not been POSTED.
 * Reset those rows to un-posted state before running (clear Status column).
 *
 * WHAT TO LOOK FOR:
 *   - setValues call count should drop from ~2N to 2 (1 invoice flush + 1 payment flush)
 *   - Execution time should drop ≥ 40% for 20-50 row batches in MASTER mode
 */
function runBatchFlushBenchmark() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const sheetName = sheet.getName();

  // Count rows available to post
  const lastRow = sheet.getLastRow();
  const dataStart = CONFIG.dataStartRow;
  if (lastRow < dataStart) {
    Logger.log('No data rows found. Add Regular rows to the active sheet first.');
    return;
  }
  const rowCount = lastRow - dataStart + 1;
  Logger.log(`Benchmark: ${rowCount} rows on sheet "${sheetName}"`);
  Logger.log('--- Running batch post (deferred flush) ---');

  const startTime = Date.now();
  const results = UIMenu._handleBatchPosting(sheet);
  const elapsed = Date.now() - startTime;

  Logger.log(`Posted: ${results.posted} | Failed: ${results.failed} | Skipped: ${results.skipped}`);
  Logger.log(`Total time: ${elapsed}ms | Avg per row: ${(elapsed / rowCount).toFixed(1)}ms`);
  Logger.log(`Expected: 2 remote setValues calls (invoice flush + payment flush) + ${results.posted} paidDate writes at most`);
  Logger.log('Compare against pre-refactor benchmark in git history for the same row count.');
}
```

- [ ] **Step 2: Run benchmark on a test sheet with 20–30 Regular rows**

In Script Editor: Run → `runBatchFlushBenchmark`. Note the total time and avg per row in the Execution Log.

- [ ] **Step 3: Compare against pre-refactor**

Check `git log` for the previous benchmark run (if one exists). Expected improvement: ≥ 40% reduction in total time for 20-50 row batches in MASTER mode.

- [ ] **Step 4: Commit**

```bash
git add Benchmark.Performance.gs
git commit -m "perf(Benchmark): add runBatchFlushBenchmark for deferred-write measurement"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Extend `_initBatchContext` with 5 buffer fields | Task 2 |
| Add `pendingBalanceRows` to context | Task 3 |
| Guard `CacheManager.addInvoiceToCache` in deferred mode | Task 4 |
| Add `flushPendingRegularInvoices` with error handling | Task 5 |
| Defer `_recordPayment` write + skip PaymentCache | Task 6 |
| Skip steps 3–4 in `processPayment` when deferred; push to `pendingPaidDateChecks` | Task 7 |
| Add `flushPendingPaymentRows` with error handling | Task 8 |
| Defer balance calculation from loop to post-flush | Task 9 |
| Rewrite `_handleRegularBatchPosting` + add `_markAllPendingAsFailed`, `_runPaidDatePass`, `_runBalancePass` | Task 10 |
| Unit tests for all flush methods + deferred paths | Tasks 5, 6, 8 |
| Integration tests: happy path, flush failure, balance dedup | Task 11 |
| Benchmark | Task 12 |

All spec requirements covered. ✓

**Placeholder scan:** No TBD, TODO, or "similar to above" patterns. All code is complete. ✓

**Type consistency:** `flushResult.failedCount`, `flushResult.error`, `{invoiceRow, invoiceNo, supplier}`, `{rowNum, supplier}`, `{rowNum, balance}` — consistent across all tasks. ✓
