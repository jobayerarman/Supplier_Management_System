# Unpaid Batch Fast-Path

## Context

**Problem:** Posting 20 Unpaid rows via "Post Selected Rows" takes ~4,100ms in MASTER mode.
The dominant cost is 20 individual remote writes to `00_SUPPLIER_ACCOUNTS_DATABASE_MASTER`
(InvoiceDatabase), each costing ~150ms. The existing batch path is already optimised for
mixed payment types — it holds one lock, pre-fetches the Master DB sheet, and batches
status column writes — but the per-row InvoiceDatabase write and per-row balance cell write
remain unbatched.

**Why Unpaid is a special case:**
- User always batch-posts Unpaid rows separately (selects only Unpaid rows → Post Selected Rows)
- Unpaid = `paymentAmt = 0` → PaymentLog is never touched
- Only two data surfaces are written: InvoiceDatabase (remote Master) + daily sheet (local)
- No payment processing, no PaymentLog row, no `_shouldProcessPayment` check needed

**Goal:** Auto-detect an all-Unpaid selection and route it through a lean fast-path that:
1. Buffers all InvoiceDatabase rows → **1 remote write** after the loop (was 20)
2. Buffers balance column values → **1 local write** after the loop (was 20)
3. Folds sysId into the existing status grid → **1 local write** for J-N (was 20 + status grid)
4. Sets row backgrounds in one range call (was per-row)

**Expected result:** ~775ms for 20 rows vs ~4,100ms today (~5× speedup).

---

## Architecture

### Detection and routing

`_handleBatchPosting` already calls `_initBatchPostSetup` which reads all row data into
`allData` in one API call. After setup, scan `allData` to check if all rows with a supplier
value have `paymentType === 'Unpaid'`. If yes, create an Unpaid-specific batchContext and
delegate to `_handleUnpaidBatchPosting`. The existing path is completely untouched.

```
batchPostSelectedRows()
  └─ _handleBatchPosting(sheet, startRow, endRow)
       ├─ _initBatchPostSetup()          — reads allData (1 API call, unchanged)
       ├─ _isAllUnpaidBatch(allData)?
       │    ├─ YES → context.batchContext = _initUnpaidBatchContext()
       │    │         _handleUnpaidBatchPosting(context)
       │    └─ NO  → context.batchContext = _initBatchContext()   [unchanged]
       │              _runBatchPostLoop(context)                   [unchanged]
       │              _flushBatchStatusUpdates(context)            [unchanged]
       └─ _invalidateBatchCaches(context)   [shared]
          _reportBatchPostResults(context)  [shared]
```

### Unpaid fast-path loop (per row — pure JS, zero API calls)

```
for each row in allData:
  skip if no supplier
  skip if status == 'POSTED'
  _buildDataObject(rowData, rowNum, sheetName, enteredBy)
  validatePostData(data)
  → fail: queue error status update, continue
  generate sysId if missing (IDGenerator.generateUUID — no write)
  InvoiceManager.createOrUpdateInvoice(data, batchContext)
    → createInvoice (deferred-write mode):
        build newRowData via _buildInvoiceRowData (includes invoiceId)
        push newRowData to batchContext.pendingInvoiceRows[]
        record batchContext.invoiceFirstRow (first time only)
        CacheManager.addInvoiceToCache(newRow, newRowData)   ← immediate
        return {success, invoiceId, row}
  balance = BalanceCalculator.getSupplierOutstanding(supplier)  ← reads cache
  pendingBalanceUpdates.push({ rowNum, balance })
  pendingStatusUpdates.push({ rowNum, keepChecked:true, status:'POSTED',
                               user, time, bgColor:success, sysId:data.sysId })
  suppliersToInvalidate.add(supplier)
  results.posted++
```

### Post-loop flush (4 API calls total)

```
1. InvoiceManager.flushPendingInvoiceRows(batchContext)
   invoiceSh.getRange(invoiceFirstRow, 1, count, cols).setValues(pendingInvoiceRows)
   → 1 remote write to Master DB

2. sheet.getRange(startRow, balanceCol, numRows, 1).setValues(balanceGrid)
   → 1 local write, col H only
   → skipped rows: keep original value from allData (no overwrite)
   → setNote skipped entirely (note is "" for afterPost Unpaid)

3. sheet.getRange(startRow, postCol, numRows, 5).setValues(statusGrid)
   → 1 local write, cols J-N (post, status, user, time, sysId)
   → extends existing 4-col grid to 5 cols (adds sysId at col N)

4. _applyUnpaidBatchBackgrounds(sheet, startRow, allData, pendingStatusUpdates)
   → sets success background for posted rows; error background for failed rows
   → groups contiguous same-color rows into single setBackground calls
```

### Cache correctness with deferred writes

`CacheManager.addInvoiceToCache` is called **immediately** per row (not deferred).
`BalanceCalculator.getSupplierOutstanding` reads from cache. So balance is computed
correctly from the live cache even though the InvoiceDatabase sheet write is deferred.
Subsequent `findInvoice` calls within the same batch also work correctly.

`CacheManager.invalidateSupplierCache` is called after the loop (unchanged — already
batched per unique supplier in `_invalidateBatchCaches`).

---

## Files to Modify

### `UIMenu.gs` — primary changes

| Function | Change |
|---|---|
| `_initBatchPostSetup` | Move `batchContext: this._initBatchContext()` out — caller assigns it |
| `_handleBatchPosting` | After setup: detect all-Unpaid, assign correct batchContext, branch |
| NEW `_isAllUnpaidBatch(allData)` | Scan paymentType col; return true if all non-empty rows are 'Unpaid' |
| NEW `_initUnpaidBatchContext()` | Lock + invoiceSheet + invoiceNextRow + invoiceFirstRow:null + pendingInvoiceRows:[] — no paymentSheet |
| NEW `_handleUnpaidBatchPosting(context)` | Orchestrator: loop → flushInvoices → flushDailySheet → (caches/report shared) |
| NEW `_runUnpaidBatchPostLoop(context)` | Lean loop — no payment check, queues invoice rows + balance + status |
| NEW `_flushUnpaidDailySheetUpdates(context)` | Builds + writes balance grid, status grid (J-N), backgrounds |
| NEW `_buildBalanceGrid(allData, startRow, numRows, pendingBalanceUpdates)` | Sparse grid: computed balance for posted rows, original value for skipped |
| NEW `_buildUnpaidStatusGrid(allData, startRow, numRows, pendingStatusUpdates)` | 5-col grid: post, status, user, time, sysId (extends existing buildStatusGrid) |
| NEW `_applyUnpaidBatchBackgrounds(sheet, startRow, numRows, updates)` | Groups contiguous same-color rows → minimal setBackground calls |

### `InvoiceManager.gs` — deferred-write mode

| Function | Change |
|---|---|
| `createInvoice` | If `batchContext.pendingInvoiceRows !== undefined`: push to buffer + set invoiceFirstRow, skip immediate setValues; else write immediately (unchanged) |
| NEW `flushPendingInvoiceRows(batchContext)` | `invoiceSh.getRange(invoiceFirstRow, 1, count, cols).setValues(rows)` — no-op if buffer empty |

### `BalanceCalculator.gs` — no changes needed

`getSupplierOutstanding(supplier)` is already a public method called directly.
The fast-path calls it directly from `_runUnpaidBatchPostLoop` — no new API needed.

---

## Implementation Steps

### Step 1 — Refactor `_initBatchPostSetup` to not create batchContext

Move `batchContext: this._initBatchContext()` out of `_initBatchPostSetup`.
The returned context object omits `batchContext` (set to null temporarily).
`_handleBatchPosting` assigns it after the all-Unpaid check.

**Why first:** Every subsequent step depends on this decoupling.

**File:** [UIMenu.gs](../../../UIMenu.gs) — `_initBatchPostSetup`

---

### Step 2 — Update `_handleBatchPosting` to assign batchContext and branch

After calling `_initBatchPostSetup`:
```js
const isUnpaid = this._isAllUnpaidBatch(context.allData);
context.batchContext = isUnpaid
  ? this._initUnpaidBatchContext()
  : this._initBatchContext();

if (isUnpaid) {
  this._handleUnpaidBatchPosting(context);
} else {
  this._runBatchPostLoop(context);          // unchanged
  this._flushBatchStatusUpdates(context);   // unchanged
  flushBackgroundUpdates(context.sheet, context.pendingStatusUpdates);
}
// shared post-loop work unchanged:
this._invalidateBatchCaches(context);
return this._reportBatchPostResults(context);
```

**File:** [UIMenu.gs](../../../UIMenu.gs) — `_handleBatchPosting`

---

### Step 3 — Add `_isAllUnpaidBatch(allData)`

```js
_isAllUnpaidBatch: function(allData) {
  const supplierCol    = CONFIG.cols.supplier;
  const paymentTypeCol = CONFIG.cols.paymentType;
  for (let i = 0; i < allData.length; i++) {
    if (!allData[i][supplierCol]) continue;           // skip empty rows
    if (allData[i][paymentTypeCol] !== 'Unpaid') return false;
  }
  return true;
},
```

**File:** [UIMenu.gs](../../../UIMenu.gs) — new private helper

---

### Step 4 — Add `_initUnpaidBatchContext()`

```js
_initUnpaidBatchContext: function() {
  const batchLock    = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
  const invoiceSheet = MasterDatabaseUtils.getTargetSheet('invoice');
  return {
    batchLock,
    invoiceSheet,
    paymentSheet:       null,   // Unpaid never writes PaymentLog
    invoiceNextRow:     invoiceSheet.getLastRow() + 1,
    invoiceFirstRow:    null,   // set on first push in createInvoice
    pendingInvoiceRows: [],
    paymentNextRow:     null,
  };
},
```

**File:** [UIMenu.gs](../../../UIMenu.gs) — co-locate with `_initBatchContext`

---

### Step 5 — Add `InvoiceManager.flushPendingInvoiceRows(batchContext)`

```js
flushPendingInvoiceRows: function(batchContext) {
  if (!batchContext?.pendingInvoiceRows?.length) return;
  const rows      = batchContext.pendingInvoiceRows;
  const firstRow  = batchContext.invoiceFirstRow;
  const invoiceSh = batchContext.invoiceSheet;
  invoiceSh.getRange(firstRow, 1, rows.length, rows[0].length).setValues(rows);
},
```

**File:** [InvoiceManager.gs](../../../InvoiceManager.gs) — public API section (Section 2)

---

### Step 6 — Modify `InvoiceManager.createInvoice` to support deferred-write mode

Replace the immediate write block:
```js
// ═══ WRITE TO SHEET ═══
invoiceSh.getRange(newRow, 1, 1, newRowData.length).setValues([newRowData]);
```

With:
```js
// ═══ WRITE TO SHEET (or defer to batch flush) ═══
if (batchContext && Array.isArray(batchContext.pendingInvoiceRows)) {
  if (batchContext.invoiceFirstRow === null) batchContext.invoiceFirstRow = newRow;
  batchContext.pendingInvoiceRows.push(newRowData);
} else {
  invoiceSh.getRange(newRow, 1, 1, newRowData.length).setValues([newRowData]);
}
```

Cache line immediately after is unchanged:
```js
CacheManager.addInvoiceToCache(newRow, newRowData);
```

**File:** [InvoiceManager.gs](../../../InvoiceManager.gs) — `createInvoice` (~line 397)

---

### Step 7 — Add `_runUnpaidBatchPostLoop(context)`

Lean loop. Key differences from `_runBatchPostLoop`:
- No `_shouldProcessPayment` / `PaymentManager.processPayment` calls
- SysId generated in-memory, not written immediately (queued via status update)
- `BalanceCalculator.getSupplierOutstanding(supplier)` called directly after cache update
- `pendingBalanceUpdates` array added to context
- Added `invoiceResult.success` check (correctness fix absent in normal loop)

```js
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
        this._toast(`Processed ${i + 1} of ${numRows} rows...`, 'Progress', 2);
      }

      if (!rowData[CONFIG.cols.supplier]) { results.skipped++; continue; }

      const status = rowData[CONFIG.cols.status];
      if (status && status.toString().toUpperCase() === 'POSTED') {
        results.skipped++; continue;
      }

      try {
        const data = this._buildDataObject(rowData, rowNum, sheetName, enteredBy);

        // Ensure sysId exists (generate in-memory, no write yet)
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

        // createInvoice defers the sheet write; updates cache immediately
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

        // Balance from cache (updated immediately by createInvoice)
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
    LockManager.releaseLock(batchContext?.batchLock);
  }
},
```

**File:** [UIMenu.gs](../../../UIMenu.gs) — co-locate with `_runBatchPostLoop`

---

### Step 8 — Add `_handleUnpaidBatchPosting(context)`

```js
_handleUnpaidBatchPosting: function(context) {
  this._runUnpaidBatchPostLoop(context);
  InvoiceManager.flushPendingInvoiceRows(context.batchContext);  // 1 remote write
  this._flushUnpaidDailySheetUpdates(context);                   // 3 local writes
},
```

**File:** [UIMenu.gs](../../../UIMenu.gs) — co-locate with `_handleBatchPosting`

---

### Step 9 — Add `_flushUnpaidDailySheetUpdates(context)`

```js
_flushUnpaidDailySheetUpdates: function(context) {
  const { sheet, allData, startRow, numRows,
          pendingStatusUpdates, pendingBalanceUpdates } = context;
  if (pendingStatusUpdates.length === 0) return;

  // 1. Balance column (col H) — one setValues call
  const balanceGrid = this._buildBalanceGrid(allData, startRow, numRows, pendingBalanceUpdates);
  sheet.getRange(startRow, CONFIG.cols.balance + 1, numRows, 1).setValues(balanceGrid);
  // setNote skipped — _buildPostedBalanceInfo returns note:"" for Unpaid afterPost

  // 2. Status + sysId grid (cols J-N, 5 columns) — one setValues call
  const statusGrid = this._buildUnpaidStatusGrid(allData, startRow, numRows, pendingStatusUpdates);
  sheet.getRange(startRow, CONFIG.cols.post + 1, numRows, 5).setValues(statusGrid);

  // 3. Row backgrounds — grouped by color, minimal setBackground calls
  this._applyUnpaidBatchBackgrounds(sheet, startRow, numRows, pendingStatusUpdates);
},
```

**File:** [UIMenu.gs](../../../UIMenu.gs)

---

### Step 10 — Add `_buildBalanceGrid`, `_buildUnpaidStatusGrid`, `_applyUnpaidBatchBackgrounds`

**`_buildBalanceGrid`** — sparse: computed balance for posted rows, original for all others:
```js
_buildBalanceGrid: function(allData, startRow, numRows, pendingBalanceUpdates) {
  const balanceCol = CONFIG.cols.balance;
  const updateMap  = new Map(pendingBalanceUpdates.map(u => [u.rowNum, u.balance]));
  return Array.from({ length: numRows }, (_, i) => {
    const rowNum = startRow + i;
    return updateMap.has(rowNum)
      ? [updateMap.get(rowNum)]
      : [allData[i][balanceCol]];   // preserve existing (skipped/failed rows)
  });
},
```

**`_buildUnpaidStatusGrid`** — 5-col version of existing `buildStatusGrid`:
```js
_buildUnpaidStatusGrid: function(allData, startRow, numRows, pendingStatusUpdates) {
  const cols      = CONFIG.cols;
  const updateMap = new Map(pendingStatusUpdates.map(u => [u.rowNum, u]));
  return Array.from({ length: numRows }, (_, i) => {
    const rowNum = startRow + i;
    const u      = updateMap.get(rowNum);
    if (u) {
      const timeStr = DateUtils.formatTime(u.time);
      return [u.keepChecked, u.status, u.user, timeStr, u.sysId ?? allData[i][cols.sysId]];
    }
    // No update — preserve existing values
    return [allData[i][cols.post],      allData[i][cols.status],
            allData[i][cols.enteredBy], allData[i][cols.timestamp],
            allData[i][cols.sysId]];
  });
},
```

**`_applyUnpaidBatchBackgrounds`** — group contiguous same-color rows, one call per group:
```js
_applyUnpaidBatchBackgrounds: function(sheet, startRow, numRows, pendingStatusUpdates) {
  const updateMap = new Map(pendingStatusUpdates.map(u => [u.rowNum, u.bgColor]));
  let groupStart = null, groupColor = null;

  const flushGroup = (endRow) => {
    if (groupStart !== null) {
      sheet.getRange(groupStart, 2, endRow - groupStart + 1, CONFIG.totalColumns.daily - 1)
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
```

**File:** [UIMenu.gs](../../../UIMenu.gs) — private helpers section

---

## Verification

### Manual test — 20 Unpaid rows

1. Open a daily sheet, enter 20 Unpaid rows across different suppliers (no sysIds yet)
2. Select all 20 rows → Menu → Post Selected Rows
3. Verify toast shows "Processing…" then completion with correct counts
4. **InvoiceDatabase:** all 20 rows written, SUMIFS formulas intact, invoiceId populated
5. **Daily sheet:** col H (balance) = supplier outstanding, cols J-N filled, rows green, col N sysIds populated
6. **AuditLog:** 20 `INVOICE_CREATED` entries, zero `PAYMENT` entries
7. **PaymentLog:** no new rows (Unpaid touches nothing there)
8. Time the operation: expect <1,000ms for 20 rows

### Regression test — mixed payment types

1. Enter rows with mixed types (Regular, Partial, Due, Unpaid) in one selection
2. Select all → Post Selected Rows
3. `_isAllUnpaidBatch` returns false → normal path runs, all types processed as before

### Edge cases

| Case | Expected behaviour |
|---|---|
| Selection has 1 Unpaid row | Fast path triggers, works correctly |
| All rows already POSTED | All skipped, posted:0, no writes to either sheet |
| One row fails validation | Error status queued for that row; others post normally |
| Supplier already has invoice in DB | `findInvoice` hits → `updateInvoiceIfChanged` (no buffer push); balance correct from cache |
| Mixed: 19 Unpaid + 1 Regular | `_isAllUnpaidBatch` → false → normal path |

---

## Performance Estimate

| Phase | Before | After |
|---|---|---|
| Setup + batch read | ~500ms | ~500ms |
| Loop (pure JS, zero API calls) | — | ~50ms |
| InvoiceDatabase writes (remote Master) | 20 × ~150ms = ~3,000ms | 1 × ~200ms |
| Daily sheet writes (local) | 20 × ~30ms = ~600ms | 3 × ~10ms = ~30ms |
| **Total for 20 rows** | **~4,100ms** | **~780ms** |
