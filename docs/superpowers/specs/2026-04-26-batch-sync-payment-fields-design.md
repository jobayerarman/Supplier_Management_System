# Batch Sync Payment Fields — Design Spec

**Date:** 2026-04-26
**Status:** Approved

---

## Context

Daily sheets are populated by IMPORTRANGE formulas that silently fill:
- Col C — Invoice No
- Col D — Received Amount
- Col E — Payment Type

Because IMPORTRANGE writes via formula recalculation (not a user edit event), `onEditInstallable` never fires. Cols F (Prev Invoice) and G (Payment Amt) remain blank until the user manually re-edits col E for each row, faking an edit event that triggers `_handlePaymentTypeEdit`.

This manual row-by-row touch is time-consuming and error-prone, especially when IMPORTRANGE populates rows in batches across a full daily sheet.

**Goal:** Add a single menu action that programmatically runs the same field-population logic across all qualifying rows in the active sheet — eliminating the need to manually touch each row.

---

## Menu Placement

Top of `📋 FP - Operations` (logical workflow: sync → validate → post):

```
🔄 Batch Sync Payment Fields    ← NEW (first item)
✅ Validate Selected Rows
📤 Post Selected Rows
────────────────────────
✅ Batch Validate All Rows
📤 Batch Post All Valid Rows
```

---

## Row Filter

A row qualifies for sync if **all** conditions are met:

| Condition | Reason |
|-----------|--------|
| `paymentType` is set (Regular / Partial / Due) | Nothing to sync without a type |
| `paymentAmt` is blank | Already-processed rows are skipped (non-destructive) |
| `prevInvoice` is blank | Already-processed rows are skipped (non-destructive) |
| For Regular/Partial: `invoiceNo` AND `receivedAmt` present | Source data must be loaded before copying |
| For Due: `supplier` present | Needed by `buildDuePaymentDropdown` |

Rows where IMPORTRANGE has not yet finished populating are skipped silently and counted as `skipped`.

---

## Algorithm

### Phase 1 — Single bulk read
```
allValues = sheet.getRange(dataStartRow, 1, numDataRows, totalColumns).getValues()
```

### Phase 2 — Partition qualifying rows
```
regularPartial[] — type Regular or Partial, filter conditions met
due[]            — type Due, filter conditions met
```

### Phase 3 — Regular/Partial: single setValues()
Build a `numDataRows × 2` write array for cols F+G (prevInvoice, paymentAmt):
- Qualifying rows → `[invoiceNo, receivedAmt]`
- Non-qualifying rows → existing values from Phase 1 (preserves current state; safe because F+G are value cells, not formula cells)

```
sheet.getRange(dataStartRow, prevInvoiceCol, numRows, 2).setValues(writeArray)
```

### Phase 4 — Partial background (per Partial row)
```
sheet.getRange(row, paymentAmtCol).setBackground(CONFIG.colors.warning)
```
Per-row because `setBackgrounds()` on the full range would require reading existing backgrounds first. Partial rows are a small subset; per-row cost is acceptable.

### Phase 5 — Due rows (per row)
```
InvoiceManager.buildDuePaymentDropdown(sheet, row, supplier, 'Due', prevInvoice)
```
Cannot be batched — each row requires its own data-validation object.

### Phase 6 — Balance update (per Regular/Partial row)
Update `rowValues` in-memory, then:
```
BalanceCalculator.updateBalanceCell(sheet, row, false, rowValues)
```
Consistent with the manual trigger path which returns `updateBalance = true` for Regular/Partial.

### Phase 7 — Return results
```
{ regularPartial: N, due: N, skipped: N, failed: N }
```

---

## Error Handling

- **Sheet guard:** `_validateDailySheet(sheet)` runs first; exits silently if not a daily sheet (01–31).
- **Confirmation dialog:** shown before processing — mirrors `batchPostAllRows` UX.
- **Row-level isolation:** each row wrapped in try/catch; failure logs via `AuditLogger.logError` and increments `failed` counter without aborting the batch.
- **AuditLogger:** logs the batch operation with row count summary on completion.

---

## Summary Dialog

```
Payment Fields Synced

✅ Regular/Partial populated:   8
🔄 Due dropdowns built:         3
⚠️  Skipped (incomplete data):  2
❌ Errors:                       0
```

---

## Files to Create / Modify

| File | Action | Change |
|------|--------|--------|
| `UIMenu.BatchSync.gs` | **Create** | `UIMenuBatchSync` object with `handleBatchSync(sheet)` returning results object |
| `UIMenu.gs` | **Modify** | Add `batchSyncPaymentFields()` global wrapper; add menu item as first entry in `📋 FP - Operations` |

---

## Key Reuse (existing functions)

| Function | Location | Used for |
|----------|----------|---------|
| `UIMenu._validateDailySheet(sheet)` | `UIMenu.gs` | Sheet guard |
| `UIUtils.confirmOperation(title, msg)` | `UIMenu.gs` / utils | Confirmation dialog |
| `InvoiceManager.buildDuePaymentDropdown(sheet, row, supplier, type, prevInvoice)` | `InvoiceManager.gs` | Due row dropdown |
| `BalanceCalculator.updateBalanceCell(sheet, row, false, rowValues)` | `BalanceCalculator.gs` | Balance update after Regular/Partial write |
| `AuditLogger.logError(context, message)` | `AuditLogger.gs` | Row-level error logging |
| `CONFIG.cols`, `CONFIG.dataStartRow`, `CONFIG.totalColumns.daily`, `CONFIG.colors.warning` | `_Config.gs` | Column indices, constants |

---

## Verification

1. Open a daily sheet with IMPORTRANGE-populated rows (C, D, E filled; F, G blank)
2. Run `📋 FP - Operations → 🔄 Batch Sync Payment Fields`
3. Confirm dialog → proceed
4. Verify:
   - Regular rows: col F = col C value, col G = col D value, no background
   - Partial rows: col F = col C value, col G = col D value, col G background = warning yellow
   - Due rows: col F has data-validation dropdown of unpaid invoices for that supplier
   - Already-populated rows (F or G non-blank): untouched
   - Rows with blank invoiceNo/receivedAmt: counted as skipped, untouched
5. Summary dialog shows correct counts
6. AuditLog shows batch sync entry
