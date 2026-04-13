# Plan: Batch Posting Refactor — Regular/Due/Partial Write Batching

## Context

`_runBatchPostLoop()` handles Regular, Partial, and Due payment rows in batch posting. It currently
makes two Google Sheets API calls **per row**: one `setValue()` for SysID (line 782) and one
`updateBalanceCell()` for the balance column. On a 50-row batch this is ~100 avoidable API calls.

The Unpaid path (`_runUnpaidBatchPostLoop` + `_flushUnpaidDailySheetUpdates`) already solved this
correctly: it accumulates all updates during the loop and flushes them in three bulk writes at the
end. This refactor mirrors that pattern for Regular/Partial/Due, while also restructuring the
oversized try block into four explicit stage methods and isolating all payment-type branching into a
single dispatch function.

**Intended outcome:** O(1) API calls per batch regardless of row count; a layered architecture
where each layer has one job and cannot leak responsibility into another.

---

## Invariants (non-negotiable)

These rules must hold in every implementation choice and in every future change to this code path.

1. **Stage order is fixed: Identity → Domain Execution → State Capture → Status Queue.**
   No stage may be reordered. Domain Execution assumes SysID exists (set by Identity).
   State Capture assumes domain state has been mutated (by Domain Execution).

2. **All sheet writes are deferred and batched.**
   No `setValue`, `setValues`, or `setBackground` call may appear inside `_runBatchPostLoop`.
   Every write goes through Layer 4 (`_flushRegularDailySheetUpdates`).

3. **The flush layer performs no business logic.**
   `_flushSysIdUpdates`, `_flushBalanceUpdates`, and `_flushBatchStatusUpdates` read from
   accumulators and write to the sheet. They do not compute balances, generate IDs, or make
   decisions about what to write.

4. **Accumulator shapes are strict contracts.**
   Enforced at push time — not in documentation. Any deviation is a bug at the push site.
   - `pendingSysIdUpdates`   → `{ rowNum: number, sysId: string }`
   - `pendingBalanceUpdates` → `{ rowNum: number, balance: number }`
   - `pendingStatusUpdates`  → `{ rowNum, keepChecked, status, user, time, bgColor }` (existing shape)

---

## Architecture

```
Layer 1: Orchestrator        _handleBatchPosting()
         ├─ Unpaid path  →   _handleUnpaidBatchPosting()        [unchanged]
         └─ Regular path →   _handleRegularBatchPosting()       [new]

Layer 2: Payment Flow Engine _runBatchPostLoop()                [refactored]
         Stage 1: Identity          _ensureSysId()
         Stage 2: Domain Execution  _executeDomainLogic()       [payment-type dispatch]
         │   ├─ Regular / Partial → _executeInvoiceAndPayment()
         │   └─ Due             →   _executeDuePayment()
         Stage 3: State Capture     _queueBalanceUpdate()
         Stage 4: Status Queue      _queueStatusSuccess()
         Error handling:            _queueValidationError()
                                    _queueRuntimeError()

Layer 3: Accumulators (in context object)
         pendingSysIdUpdates[]    { rowNum, sysId }
         pendingBalanceUpdates[]  { rowNum, balance }
         pendingStatusUpdates[]   { rowNum, keepChecked, status, user, time, bgColor }

Layer 4: Flush Engine        _flushRegularDailySheetUpdates()   [new]
         ├─ _flushSysIdUpdates()       → 1 setValues (sysId column)
         ├─ _flushBalanceUpdates()     → 1 setValues (balance column, reuses _buildBalanceGrid)
         └─ _flushBatchStatusUpdates() → 1 setValues + grouped setBackground [existing]
```

---

## Layer Detail

### Layer 1 — Orchestrator changes (`_handleBatchPosting`, lines 673–691)

Replace the `else` branch:

```javascript
// Before
} else {
  this._runBatchPostLoop(context);
  this._flushBatchStatusUpdates(context);
}

// After
} else {
  this._handleRegularBatchPosting(context);
}
```

New function (mirrors `_handleUnpaidBatchPosting`):

```javascript
_handleRegularBatchPosting: function(context) {
  this._runBatchPostLoop(context);               // Phase 2: accumulate
  this._flushRegularDailySheetUpdates(context);  // Phase 3: 3 bulk writes
},
```

---

### Layer 2 — Refactored `_runBatchPostLoop`

The inner try body becomes a clean 4-line stage sequence. No per-row writes anywhere:

```javascript
const data       = this._buildDataObject(rowData, rowNum, sheetName, enteredBy);
const validation = validatePostData(data);
if (!validation.valid) { this._queueValidationError(context, data, rowNum, validation); continue; }

this._ensureSysId(data, context);                // Stage 1: Identity
this._executeDomainLogic(data, context);         // Stage 2: Domain Execution
this._queueBalanceUpdate(data, rowNum, context); // Stage 3: State Capture
this._queueStatusSuccess(data, rowNum, context); // Stage 4: Status Queue
suppliersToInvalidate.add(data.supplier);
results.posted++;
```

**Stage method signatures:**

```javascript
// Stage 1: Identity
// Contract: _executeDomainLogic assumes data.sysId is set.
// Every flow inherits SysID by construction — not by caller discipline.
_ensureSysId: function(data, context) {
  if (!data.sysId) data.sysId = IDGenerator.generateUUID();
  context.pendingSysIdUpdates.push({ rowNum: data.rowNum, sysId: data.sysId });
},

// Stage 2: Domain Execution — single dispatch, all type branching isolated here
_executeDomainLogic: function(data, context) {
  switch (data.paymentType) {
    case 'Regular':
    case 'Partial':
      return this._executeInvoiceAndPayment(data, context);
    case 'Due':
      return this._executeDuePayment(data, context);
    default:
      throw new Error(`Unsupported payment type in batch: "${data.paymentType}"`);
      // Caught by row-level catch → logged → queued as ERROR — no silent corruption
  }
},

// Regular / Partial: create or update invoice, then record full/partial payment
_executeInvoiceAndPayment: function(data, context) {
  const invoiceResult = InvoiceManager.createOrUpdateInvoice(data, context.batchContext);
  data.invoiceId = invoiceResult.invoiceId;
  PaymentManager.processPayment(data, invoiceResult.invoiceId, context.batchContext);
},

// Due: payment only — no invoice creation
// PaymentManager._recordPayment routes to data.prevInvoice internally.
// _shouldUpdatePaidDate('Due') = true → paid date written to InvoiceDatabase if fully settled.
_executeDuePayment: function(data, context) {
  PaymentManager.processPayment(data, null, context.batchContext);
},

// Stage 3: State Capture — read-after-mutation only
// processPayment() Step 3 (_updateCacheAndFetchInvoice) has already updated the cache.
// No business logic here — pure cache read, push to accumulator.
_queueBalanceUpdate: function(data, rowNum, context) {
  const balance = BalanceCalculator.getSupplierOutstanding(data.supplier);
  context.pendingBalanceUpdates.push({ rowNum, balance });
},

// Stage 4: Status Queue — symmetric shape with _queueValidationError / _queueRuntimeError
_queueStatusSuccess: function(data, rowNum, context) {
  context.pendingStatusUpdates.push({
    rowNum, keepChecked: true, status: 'POSTED',
    user:    UserResolver.extractUsername(data.enteredBy),
    time:    data.timestamp, bgColor: CONFIG.colors.success
  });
},
```

**Error helpers — same accumulator, same shape as success:**

```javascript
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
```

---

### Layer 3 — Accumulator additions to `_initBatchContext`

Add one clearly-commented group. Both LOCAL and MASTER mode branches receive these arrays:

```javascript
// -- Deferred daily-sheet write queues (Regular / Partial / Due batches) --
// Populated during _runBatchPostLoop; flushed atomically in _flushRegularDailySheetUpdates.
// Shapes are strict contracts — enforce at push site, not in flush layer.
// { rowNum: number, sysId: string }
// { rowNum: number, balance: number }
pendingSysIdUpdates:   [],
pendingBalanceUpdates: [],
```

`pendingStatusUpdates` is already initialised by `_initBatchPostSetup` — no change.

---

### Layer 4 — Flush Engine

```javascript
// Mirrors _flushUnpaidDailySheetUpdates — 3 bulk writes total regardless of batch size.
_flushRegularDailySheetUpdates: function(context) {
  if (
    context.pendingSysIdUpdates.length   === 0 &&
    context.pendingBalanceUpdates.length === 0 &&
    context.pendingStatusUpdates.length  === 0
  ) return;

  this._flushSysIdUpdates(context);       // 1 setValues — sysId column
  this._flushBalanceUpdates(context);     // 1 setValues — balance column
  this._flushBatchStatusUpdates(context); // 1 setValues + grouped setBackground [existing]
},

// Builds sysId column grid (numRows × 1); preserves original value for untouched rows.
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

// Delegates to existing _buildBalanceGrid — zero new logic, direct reuse from Unpaid path.
_flushBalanceUpdates: function(context) {
  if (context.pendingBalanceUpdates.length === 0) return;
  const { sheet, allData, startRow, numRows } = context;
  const grid = this._buildBalanceGrid(allData, startRow, numRows, context.pendingBalanceUpdates);
  sheet.getRange(startRow, CONFIG.cols.balance + 1, numRows, 1).setValues(grid);
},
```

`_flushBatchStatusUpdates` already calls `flushBackgroundUpdates()` — background coloring included.

---

## Failure Behavior (formal)

| Failure mode | Handling | Audit | UI feedback |
|---|---|---|---|
| Validation failure | `_queueValidationError` → `continue` (no domain execution) | `AuditLogger.log('VALIDATION_FAILED')` | ERROR status in sheet |
| Runtime / domain failure | Row-level `catch` → `_queueRuntimeError` | `AuditLogger.logError('BATCH_POST_FAILED')` | ERROR status in sheet |
| Unsupported payment type | `throw` inside switch → caught by row-level `catch` → `_queueRuntimeError` | Same as above | ERROR status in sheet |
| SysID or flush failure | Propagates to outer `try/finally` (lock released, batch aborted) | Caller logs | Toast error |

No silent failures. Every row either posts as POSTED or surfaces as ERROR in the sheet with a full
audit trail entry.

---

## Data Ownership (per layer)

| Layer | Owns | Must not |
|---|---|---|
| Layer 2 — Payment Flow Engine | Mutates domain state: invoices, payments, cache | Write to sheet; read from sheet |
| Layer 3 — Accumulators | Captures output state after mutation | Perform computation; trigger I/O |
| Layer 4 — Flush Engine | Performs I/O: reads accumulators, writes sheet | Compute balances; generate IDs; make decisions |

Cross-layer leakage (e.g. computing a balance inside a flush function) is a bug, not a shortcut.

---

## Performance Model

| Metric | Before | After |
|---|---|---|
| API calls per row | 2 (sysId setValue + updateBalanceCell) | 0 (deferred) |
| API calls per batch | O(2n) + status flush | O(1): 3 setValues + ~2–3 setBackground |
| 10-row batch | ~23 calls | ~5 calls |
| 50-row batch | ~103 calls | ~5 calls |
| 100-row batch | ~203 calls | ~5 calls |

Designed for Google Apps Script execution limits. The flush engine's API call count is independent
of batch size — it scales with the number of distinct background colour groups (typically 2–3),
not with the number of rows processed.

---

## Files to Modify

| File | Change |
|---|---|
| `UIMenu.gs` | `_handleBatchPosting`: replace `else` branch with `_handleRegularBatchPosting` call |
| `UIMenu.gs` | Add `_handleRegularBatchPosting` |
| `UIMenu.gs` | Refactor `_runBatchPostLoop`: inner try becomes 4 stage calls; row catch calls `_queueRuntimeError` |
| `UIMenu.gs` | Add `_executeDomainLogic`, `_executeInvoiceAndPayment`, `_executeDuePayment` |
| `UIMenu.gs` | Add `_ensureSysId`, `_queueBalanceUpdate`, `_queueStatusSuccess` |
| `UIMenu.gs` | Add `_queueValidationError`, `_queueRuntimeError` |
| `UIMenu.gs` | `_initBatchContext`: add `pendingSysIdUpdates` and `pendingBalanceUpdates` with comment group |
| `UIMenu.gs` | Add `_flushRegularDailySheetUpdates`, `_flushSysIdUpdates`, `_flushBalanceUpdates` |
| `BalanceCalculator.gs` | Add `computeBalance(rowData)` — thin wrapper over `_computeBalanceInfo(rowData, true)` returning numeric balance (reserved for future; Stage 3 currently uses `getSupplierOutstanding` directly) |

`_flushBatchStatusUpdates` is **unchanged** — it becomes one step inside
`_flushRegularDailySheetUpdates` rather than a direct call from `_handleBatchPosting`.

---

## Reused Existing Functions (do not reimplement)

| Function | File | Used by |
|---|---|---|
| `_buildBalanceGrid` | `UIMenu.gs` | `_flushBalanceUpdates` (reused from Unpaid path) |
| `flushBackgroundUpdates` | `_Utils.gs` | Already inside `_flushBatchStatusUpdates` |
| `buildStatusGrid` | `_Utils.gs` | Already inside `_flushBatchStatusUpdates` |
| `IDGenerator.generateUUID` | `_Utils.gs` | `_ensureSysId` |
| `BalanceCalculator.getSupplierOutstanding` | `BalanceCalculator.gs` | `_queueBalanceUpdate` |
| `PaymentManager.processPayment` | `PaymentManager.gs` | `_executeInvoiceAndPayment`, `_executeDuePayment` |

---

## Verification

1. **Benchmarks — run from Script Editor:**
   - `runAllBenchmarks()` — confirm API call count drops on Regular/Due/Partial batches
   - `runQuickBenchmark()` — spot-check latency on 10-row batch

2. **Existing test suites — all must pass unchanged:**
   - All `Test.*.gs` files run from Script Editor

3. **Manual checklist (one row per payment type):**
   - Regular: SysID appears, balance updates, status = POSTED, background = success colour
   - Partial: same as Regular; balance reflects remaining amount
   - Due: no invoice created; payment applies to `prevInvoice`; paid date written to InvoiceDatabase if fully settled
   - Invalid data: ERROR status in sheet, AuditLog entry, no domain writes
   - Unsupported payment type string: ERROR status in sheet, AuditLog entry
   - 50+ mixed-type rows: confirm exactly 3 setValues + ~2–3 setBackground calls total (instrument with `Logger.log` temporarily)

4. **Regression — Unpaid path:**
   - `_handleUnpaidBatchPosting` is completely unchanged — verify it still posts correctly end-to-end
