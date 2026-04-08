# InvoiceManager.gs — Refactor & Optimize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use plan-driven-file-refactoring to implement this plan.

**Goal:** Compress the oversized header, restore canonical section order, eliminate two DRY violations, and remove four confirmed-dead result builders — zero functional changes throughout.  
**Architecture:** In-place cleanup of the single `InvoiceManager` object literal; no new files, no API surface changes.  
**Tech Stack:** ES5-compatible Google Apps Script; spread `...` and default parameters are already in use (safe).

---

## Self-test: 2026-04-07

Audited against current `InvoiceManager.gs` (1,194 lines).

| Task | Status | Notes |
|------|--------|-------|
| T1 — Compress header | ✅ done | Commit 109cca2 |
| T2 — Reorder sections | ✅ done | Commit 95aa4d0 |
| T3 — DRY applyInvoiceFormulas | ✅ done | Commit 04f0d7d |
| T4 — DRY getInvoicesForSupplier | ✅ done | Commit c75417a |
| T5 — Remove dead result builders | ✅ done | Commit 3491504 |

## Task Sequence

| Order | Task | Type | Rationale |
|-------|------|------|-----------|
| 1 | Compress 230-line header to ~43 lines | polish | Independent; clean baseline for all diffs |
| 2 | Reorder sections from 1,2,5,6,3,4,7 → 1,2,3,4,5,6,7 | polish | Must precede DRY tasks so line numbers stabilise |
| 3 | DRY: `applyInvoiceFormulas` → delegate to `_buildInvoiceFormulas` | DRY | Single source of truth for formula strings |
| 4 | DRY: extract `_rowToInvoiceObject`, collapse `getInvoicesForSupplier` | extract + DRY | Same commit: helper + call-sites (helper has no value alone) |
| 5 | Delete 4 dead result builders | polish | Confirmed no callers anywhere in codebase |

> **Rule:** Polish/reorder before DRY. DRY before dead-code removal.

---

## Files

| Action | File | What changes |
|--------|------|--------------|
| Modify | `InvoiceManager.gs` | All 5 tasks |

---

## Verification Checklist

Run after all tasks complete.

- [ ] Zero parse errors (paste file into Apps Script editor, check for red underlines / V8 parse errors)
- [ ] No hardcoded formula strings outside `CONSTANTS.FORMULA` (grep `SUMIFS\|Balance Due\|IFS(F` in `InvoiceManager.gs`)
- [ ] `_rowToInvoiceObject` is the only place that builds invoice summary objects in `getInvoicesForSupplier`
- [ ] Dead builders gone: grep `_buildCreationResult\|_buildUpdateResult\|_buildDuplicateError\|_buildValidationError` → zero hits
- [ ] Section order in file: banner numbers read 1 → 2 → 3 → 4 → 5 → 6 → 7 top-to-bottom
- [ ] `createInvoice` `try/finally` block intact: `LockManager.releaseLock(ownLock)` still in `finally`
- [ ] Smoke test A: trigger `createOrUpdateInvoice` from a daily sheet row → invoice appears in InvoiceDatabase, cache populated
- [ ] Smoke test B: trigger `repairAllFormulas()` from the Script Editor → formulas restored without error

---

## Task 1: Compress Header Comment (Lines 1–230)

**Files:**
- Modify: `InvoiceManager.gs:1-230`

- [ ] **Step 1: Replace lines 1–230 with the compressed header**

Delete everything from line 1 through line 230 (the closing `*/`) inclusive, and replace with:

```js
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * InvoiceManager — Supplier Invoice Management System
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Central module for all invoice CRUD operations. Handles creation, updates,
 * queries, and batch operations with write-through caching and lock safety.
 *
 * PUBLIC API
 * ──────────
 * createOrUpdateInvoice(data, batchContext?)   UPSERT: delegates to create or update
 * createInvoice(data, invoice?, batchContext?) Create with lock + write-through cache
 * flushPendingInvoiceRows(batchContext)         Deferred-write batch flush
 * updateInvoiceIfChanged(existing, data)        Conditional update (skips no-ops)
 * findInvoice(supplier, invoiceNo)              O(1) cached cross-partition lookup
 * getUnpaidForSupplier(supplier)                Active partition only (10× faster)
 * getInvoicesForSupplier(supplier, includePaid?) All invoices for a supplier
 * getInvoiceStatistics()                        Counts + totalOutstanding
 * buildDuePaymentDropdown(sheet, row, ...)      Due-payment validation dropdown
 * repairAllFormulas()                           Maintenance: re-apply missing formulas
 * applyInvoiceFormulas(sheet, row)              Apply formula set to a single row
 *
 * ARCHITECTURE
 * ────────────
 * 1. CONSTANTS & CONFIGURATION  — formula templates, status/payment-type enums
 * 2. PUBLIC API - CORE OPERATIONS — create, update, flush
 * 3. PUBLIC API - QUERIES & ANALYSIS — find, list, statistics
 * 4. PUBLIC API - BATCH & UTILITY — dropdown, repairAllFormulas
 * 5. INTERNAL HELPERS - DATA BUILDING — _buildInvoiceFormulas, _buildInvoiceRowData
 * 6. INTERNAL HELPERS - UTILITIES — _withLock, applyInvoiceFormulas, dropdown helpers
 * 7. RESULT BUILDERS — _buildLockError, _buildGenericError
 *
 * CACHING: write-through, 60 s TTL, two partitions (active = unpaid/partial,
 *          inactive = paid). O(1) lookup via globalIndexMap.
 * LOCKING: script lock in createInvoice; batch callers pass batchContext.batchLock
 *          to skip per-row acquisition.
 * MASTER DB: MasterDatabaseUtils.getTargetSheet() routes writes automatically.
 *
 * @see CacheManager.gs, PaymentManager.gs, AuditLogger.gs, _Config.gs
 */
```

- [ ] **Step 2b: Verify**

File now starts at the `═══` banner. Line count drops by ~187 lines (from 1194 to ~1007). Check that line 1 is `/**` and that `// ==================== INVOICE MANAGER MODULE ====================` follows immediately after the closing `*/`.

- [ ] **Step 3: Commit**

```
git add InvoiceManager.gs
git commit -m "docs(InvoiceManager): compress 230-line header to ~43 lines"
```

---

## Task 2: Reorder Sections (Mechanical Move)

**Files:**
- Modify: `InvoiceManager.gs` (lines ~252–900 after T1)

The current section order after T1 will be:

| Block | Content | Target position |
|-------|---------|-----------------|
| A | Section 1 — CONSTANTS | 1st (stays) |
| B | Section 2 — CORE OPERATIONS | 2nd (stays) |
| C | Section 5 — INTERNAL HELPERS DATA BUILDING | currently 3rd → move to 5th |
| D | Section 6 — INTERNAL HELPERS UTILITIES | currently 4th → move to 6th |
| E | Section 3 — QUERIES & ANALYSIS | currently 5th → move to 3rd |
| F | Section 4 — BATCH & UTILITY | currently 6th → move to 4th |
| G | Section 7 — RESULT BUILDERS | 7th (stays) |

Target order: A → B → E → F → C → D → G

- [ ] **Step 1: Move blocks E and F above blocks C and D**

Identify the exact start/end lines of each block in the post-T1 file by locating their section banner comments. Then cut blocks C+D as a unit and paste them after block F (before block G). The section banner text already carries the correct numbers — no text edits needed inside the banners.

Comma hygiene: verify that the last function of each block ends with `},` (trailing comma), and that `_buildGenericError` — the last function in block G — ends with `}` (no trailing comma, closing the object literal).

- [ ] **Step 2b: Verify**

Grep for `SECTION` banners top-to-bottom. Output must read:
```
SECTION 1: CONSTANTS & CONFIGURATION
SECTION 2: PUBLIC API - CORE OPERATIONS
SECTION 3: PUBLIC API - QUERIES & ANALYSIS
SECTION 4: PUBLIC API - BATCH & UTILITY OPERATIONS
SECTION 5: INTERNAL HELPERS - DATA BUILDING
SECTION 6: INTERNAL HELPERS - UTILITIES
SECTION 7: RESULT BUILDERS
```

- [ ] **Step 3: Commit**

```
git add InvoiceManager.gs
git commit -m "refactor(InvoiceManager): restore canonical section order (1→2→3→4→5→6→7)"
```

---

## Task 3: DRY — `applyInvoiceFormulas` (Section 6, post-reorder)

**Files:**
- Modify: `InvoiceManager.gs` — `applyInvoiceFormulas` function body

**Problem:** The function makes 4 individual `getRange().setFormula()` calls with hardcoded template literals. `_buildInvoiceFormulas(row)` already produces these same formulas from `CONSTANTS.FORMULA`. The strings are functionally identical after Google Sheets whitespace normalisation.

- [ ] **Step 1: Replace the function body**

Replace the entire body of `applyInvoiceFormulas` (from `try {` through the closing `},`) with:

```js
  applyInvoiceFormulas: function (sheet, row) {
    try {
      const col      = CONFIG.invoiceCols;
      const formulas = this._buildInvoiceFormulas(row);

      sheet.getRange(row, col.totalPaid       + 1).setFormula(formulas.totalPaid);
      sheet.getRange(row, col.balanceDue      + 1).setFormula(formulas.balanceDue);
      sheet.getRange(row, col.status          + 1).setFormula(formulas.status);
      sheet.getRange(row, col.daysOutstanding + 1).setFormula(formulas.daysOutstanding);

    } catch (error) {
      AuditLogger.logError('InvoiceManager.applyInvoiceFormulas',
        `Failed to set formulas for row ${row}: ${error.toString()}`);
      throw error;
    }
  },
```

- [ ] **Step 2a: Spot-check**

Formula equivalence: `CONSTANTS.FORMULA.BALANCE_DUE` is `=IF(D{row}="","",D{row}-E{row})` and the original hardcoded string was `=IF(D${row}="","", D${row} - E${row})`. Google Sheets strips whitespace during formula parsing — these produce identical cell behaviour. Verify the same holds for the other three formulas.

- [ ] **Step 2b: Verify**

Grep `InvoiceManager.gs` for `setFormula` inside `applyInvoiceFormulas` — should show only the 4 `setFormula(formulas.*)` calls, no hardcoded template literals.

- [ ] **Step 3: Commit**

```
git add InvoiceManager.gs
git commit -m "refactor(InvoiceManager): applyInvoiceFormulas delegates to _buildInvoiceFormulas"
```

---

## Task 4: DRY — Extract `_rowToInvoiceObject`, collapse `getInvoicesForSupplier`

**Files:**
- Modify: `InvoiceManager.gs` — end of Section 5 (insert helper) + Section 3 `getInvoicesForSupplier` body

**Problem:** The active-partition and inactive-partition loops in `getInvoicesForSupplier` each construct an identical 13-field invoice object. Only the `partition:` literal differs.

- [ ] **Step 1: Insert `_rowToInvoiceObject` helper at end of Section 5**

Place immediately before the Section 6 banner, after `_buildInvoiceRowData`'s closing `},`:

```js
  /**
   * Build an invoice summary object from a raw cache row.
   *
   * @private
   * @param {Array}  row       - Raw cache row array
   * @param {Object} col       - CONFIG.invoiceCols column-index map
   * @param {string} partition - 'active' or 'inactive'
   * @returns {Object} Structured invoice summary object
   */
  _rowToInvoiceObject: function(row, col, partition) {
    return {
      invoiceNo:       row[col.invoiceNo],
      invoiceDate:     row[col.invoiceDate],
      totalAmount:     row[col.totalAmount],
      totalPaid:       row[col.totalPaid],
      balanceDue:      Number(row[col.balanceDue]) || 0,
      status:          row[col.status],
      paidDate:        row[col.paidDate],
      daysOutstanding: row[col.daysOutstanding],
      originDay:       row[col.originDay],
      enteredBy:       row[col.enteredBy],
      timestamp:       row[col.timestamp],
      sysId:           row[col.sysId],
      partition:       partition,
    };
  },
```

- [ ] **Step 2: Replace `getInvoicesForSupplier` try-block interior**

Keep the function signature, catch block, and error return unchanged. Replace only the `try { ... }` interior with:

```js
    try {
      const cacheData          = CacheManager.getInvoiceData();
      const col                = CONFIG.invoiceCols;
      const normalizedSupplier = StringUtils.normalize(supplier);

      const activeRows   = cacheData.activeSupplierIndex?.get(normalizedSupplier)   || [];
      const inactiveRows = cacheData.inactiveSupplierIndex?.get(normalizedSupplier) || [];

      const invoices = [];

      // Process active partition (unpaid/partial invoices)
      for (const i of activeRows) {
        const row = cacheData.activeData[i];
        if (!row) continue;
        invoices.push(this._rowToInvoiceObject(row, col, 'active'));
      }

      // Process inactive partition (paid invoices) if requested
      if (includePaid) {
        for (const i of inactiveRows) {
          const row = cacheData.inactiveData[i];
          if (!row) continue;
          invoices.push(this._rowToInvoiceObject(row, col, 'inactive'));
        }
      }

      return invoices;

    } catch (error) {
      AuditLogger.logError('InvoiceManager.getInvoicesForSupplier',
        `Failed to get invoices for ${supplier}: ${error.toString()}`);
      return [];
    }
```

- [ ] **Step 2a: Spot-check**

Count fields in `_rowToInvoiceObject`: invoiceNo, invoiceDate, totalAmount, totalPaid, balanceDue, status, paidDate, daysOutstanding, originDay, enteredBy, timestamp, sysId, partition — 13 fields, matching both original push blocks. `balanceDue: Number(row[col.balanceDue]) || 0` matches the original `const balanceDue = Number(row[col.balanceDue]) || 0` that fed each push.

- [ ] **Step 2b: Verify**

Grep `InvoiceManager.gs` for `invoices.push({` → zero hits (only `invoices.push(this._rowToInvoiceObject` remains). `getInvoicesForSupplier` body is now ~20 lines (down from ~70).

- [ ] **Step 3: Commit**

```
git add InvoiceManager.gs
git commit -m "refactor(InvoiceManager): extract _rowToInvoiceObject, eliminate push duplication in getInvoicesForSupplier"
```

---

## Task 5: Remove Dead Result Builders

**Files:**
- Modify: `InvoiceManager.gs` — Section 7

**Confirmed dead** (zero callers found anywhere in the codebase, including test files):
- `_buildCreationResult` + its JSDoc (lines ~1099–1107)
- `_buildUpdateResult` + its JSDoc (lines ~1118–1125)
- `_buildDuplicateError` + its JSDoc (lines ~1136–1143)
- `_buildValidationError` + its JSDoc (lines ~1170–1176)

**Confirmed live** (called inside `_withLock`):
- `_buildLockError` — keep
- `_buildGenericError` — keep (last method in object literal — **no trailing comma**)

- [ ] **Step 1: Delete the four dead builders and their JSDoc blocks**

After deletion, Section 7 contains only `_buildLockError` and `_buildGenericError`.

- [ ] **Step 2b: Verify**

Grep `InvoiceManager.gs` for `_buildCreationResult\|_buildUpdateResult\|_buildDuplicateError\|_buildValidationError` → zero hits. Confirm file ends with `  }\n};` (no trailing comma on `_buildGenericError`).

- [ ] **Step 3: Commit**

```
git add InvoiceManager.gs
git commit -m "refactor(InvoiceManager): remove 4 dead result builders (Creation/Update/Duplicate/Validation)"
```
