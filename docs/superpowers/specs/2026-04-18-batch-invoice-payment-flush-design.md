# Batch Invoice & Payment Flush — Design Spec
**Date:** 2026-04-18

---

## Context

**Problem:** Regular/Partial/Due batch posting is sluggish for 20–50 row batches. Each row triggers
an immediate `setValues()` for both invoice creation and payment recording — N rows = ~2N API calls.
Users wait noticeably longer as batch size grows.

**Solution:** Defer all invoice and payment writes during the batch loop, flush both in a single
`setValues()` call each after the loop completes. Mirror the pattern already used for Unpaid batches
(`flushPendingInvoiceRows`).

**Scope:** Batch post flow only (`batchPostAllRows` / `batchPostSelectedRows` via UIMenu).
Single-row posting (`Code.processPostedRow`) is unchanged. All three payment types
(Regular, Partial, Due) are included.

---

## Architecture & Data Flow

### batchContext shape (after extension)

```javascript
{
  batchLock,                        // script lock held for entire batch

  // Invoice buffer (NEW fields)
  invoiceSheet,                     // pre-fetched Sheet reference
  invoiceNextRow,                   // integer, incremented per deferred row
  invoiceFirstRow:      null,       // set on first push
  pendingInvoiceRows:   [],         // Array<Array[13]>

  // Payment buffer (NEW fields)
  paymentSheet,                     // pre-fetched Sheet reference
  paymentNextRow,                   // integer, incremented per deferred row
  paymentFirstRow:      null,       // set on first push
  pendingPaymentRows:   [],         // Array<Array[12]>
  pendingPaidDateChecks: [],        // Array<{invoiceRow, invoiceNo, supplier}>
}
```

### LOOP — per-row accumulation (no sheet writes)

```
For each row:
  createOrUpdateInvoice(data, batchContext) → pendingInvoiceRows[]   ← deferred
  processPayment(data, invoiceId, batchContext) → pendingPaymentRows[] ← deferred
                                               → pendingPaidDateChecks[] if applicable
  pendingStatusUpdates[].push(POSTED)
  pendingBalanceRows[].push({ rowNum, supplier })                     ← deferred
AFTER LOOP: release batchLock
```

### POST-LOOP FLUSH SEQUENCE

```
STEP 1 — Invoice flush (1 API call)
  InvoiceManager.flushPendingRegularInvoices(batchContext)
  → failure: mark all FAILED, skip 2-4, run 5-6

STEP 2 — Payment flush (1 API call)
  PaymentManager.flushPendingPaymentRows(batchContext)
  → failure: mark all FAILED, log PARTIAL_FLUSH_STATE, skip 3-4, run 5-6

STEP 3 — paidDate pass
  For each pendingPaidDateChecks[]: read SUMIFS, setValue paidDate if balance ≤ $0.01

STEP 4 — Balance pass
  For each unique supplier in pendingBalanceRows[]: getSupplierOutstanding() once

STEP 5 — Apply pendingBalanceUpdates[] → daily sheet
STEP 6 — Apply pendingStatusUpdates[] → daily sheet + summary dialog
```

### Failure state matrix

| Invoice flush | Payment flush | Steps skipped | Net state |
|---|---|---|---|
| ✓ | ✓ | none | All rows POSTED |
| ✗ | skipped | 2, 3, 4 | All rows FAILED; InvoiceDatabase + PaymentLog unchanged |
| ✓ | ✗ | 3, 4 | All rows FAILED; invoices written, payments not (PARTIAL_FLUSH_STATE logged) |
| ✓ | ✓, paidDate ✗ | none | Row still POSTED; paidDate empty; logWarning |

---

## Component Changes

### New functions

| File | Function | Purpose |
|------|----------|---------|
| `InvoiceManager.gs` | `flushPendingRegularInvoices(batchContext)` | Deferred invoice flush for Regular/Partial/Due batch; separate from Unpaid's `flushPendingInvoiceRows` |
| `PaymentManager.gs` | `flushPendingPaymentRows(batchContext)` | Deferred payment flush; mirrors above |
| `UIMenu.gs` | `_markAllPendingAsFailed(context, result)` | Flips all POSTED status updates to FAILED |
| `UIMenu.gs` | `_runPaidDatePass(batchContext)` | Post-flush paidDate writes |
| `UIMenu.gs` | `_runBalancePass(context)` | Post-flush balance calculations |

### Modified functions

| File | Function | Lines | Change |
|------|----------|-------|--------|
| `UIMenu.gs` | `_initBatchContext()` | 1555–1583 | Remove local-mode early return; add 5 buffer fields; always fetch sheets |
| `UIMenu.gs` | `_initBatchPostSetup()` return | ~731–747 | Add `pendingBalanceRows: []` |
| `UIMenu.gs` | `_runBatchPostLoop()` | 777 | Replace `_queueBalanceUpdate` with `pendingBalanceRows.push` |
| `UIMenu.gs` | `_handleRegularBatchPosting()` | 692–696 | Add post-flush sequence (Steps 1–6) |
| `InvoiceManager.gs` | `createInvoice()` | 215 | Guard `CacheManager.addInvoiceToCache()` in deferred mode |
| `PaymentManager.gs` | `_recordPayment()` | 341–346 | Defer write + skip PaymentCache when `pendingPaymentRows` present |
| `PaymentManager.gs` | `processPayment()` | 65–102 | Skip steps 3–4, push to `pendingPaidDateChecks` in deferred mode |

---

## Error Handling

| Scenario | Severity | Steps skipped | Row status | AuditLogger |
|----------|----------|--------------|------------|-------------|
| Invoice flush fails | Critical | 2, 3, 4 | All → FAILED | `logError` |
| Payment flush fails | High | 3, 4 | All → FAILED | `logError` + `logWarning` (PARTIAL_FLUSH_STATE) |
| paidDate write fails | Low | none | Unchanged (POSTED) | `logWarning` |
| Balance pass fails | Low | none | Unchanged | `logWarning` |

---

## Testing

### Unit tests — `Test.BatchFlush.gs` (new)
- `flushPendingRegularInvoices`: empty guard, success path, failure path
- `flushPendingPaymentRows`: same three tests
- `createInvoice` cache guard: non-deferred calls cache; deferred does not
- `processPayment` deferred path: no immediate write; paidDate check queued

### Integration tests — extend `Test.Integration.gs`
- Happy path 10 Regular rows: InvoiceDatabase +10, PaymentLog +10, all POSTED, paidDate + balance correct
- Invoice flush failure: all rows FAILED, PaymentLog unchanged, Steps 2–4 skipped
- Payment flush failure: InvoiceDatabase written, PaymentLog unchanged, PARTIAL_FLUSH_STATE logged

### Benchmark — extend `Benchmark.Performance.gs`
- 30 Regular rows BEFORE: ~60 `setValues()` calls
- 30 Regular rows AFTER:  2 `setValues()` calls + ≤30 individual paidDate writes
- Target: ≥ 40% reduction in execution time
