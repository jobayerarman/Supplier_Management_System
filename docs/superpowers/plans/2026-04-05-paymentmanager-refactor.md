# PaymentManager.gs — Refactor & Optimize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use plan-driven-file-refactoring to implement this plan.

**Goal:** Remove three dead-code helpers orphaned by a removed "already paid" guard step, fix the stale workflow comment and step labels that reference the removed step, and correct section numbering in the module header and section dividers. Zero functional changes throughout.

**Architecture:** Single-file cleanup. All three tasks are pure delete/renumber operations within `PaymentManager.gs`. No new code, no extraction, no DRY changes.

**Tech Stack:** Google Apps Script (ES5-compatible JS, no module system, no test runner)

---

## Self-test: 2026-04-05

Audited against current `PaymentManager.gs` (1170 lines).

| Task | Status | Notes |
|------|--------|-------|
| Task 1 | ⬜ pending | `_isPaidDateAlreadySet` at line 885, `_isPaidDateAlreadySetInSheet` at line 899, `_buildAlreadyPaidResult` at line 1119 — all present, none called from outside themselves |
| Task 2 | ⬜ pending | Workflow comment still lists step 4 "Check if paid date already set" (line 601); step labels in body jump STEP 4 → STEP 6 (line 673) → STEP 7 (~line 687) |
| Task 3 | ⬜ pending | "6. Backward Compatibility Functions" at line 23; section banners at SECTION 3 (line 249), SECTION 4 (line 502), SECTION 5 (line 729), SECTION 6 (line 1062) |

---

## Task Sequence

| Order | Task | Type | Rationale |
|-------|------|------|-----------|
| 1 | Remove dead already-paid helpers | Delete | Remove first so Task 2 verification grep confirms zero references |
| 2 | Fix stale workflow comment + step labels | Update | Comment still references the now-deleted `_isPaidDateAlreadySet` |
| 3 | Fix section numbering | Polish | Pure cosmetic — no dependencies |

---

## Files

| Action | File | What changes |
|--------|------|--------------|
| Modify | `PaymentManager.gs` | Only file touched — all 3 tasks |

---

## Verification Checklist

Run after all tasks complete.

- [ ] File has no parse errors (copy into GAS editor; check for red underlines)
- [ ] `grep` for `_isPaidDateAlreadySet`, `_isPaidDateAlreadySetInSheet`, `_buildAlreadyPaidResult` → zero matches
- [ ] WORKFLOW comment in `_updateInvoicePaidDate` lists exactly 6 steps (1–6) with no step referencing `_isPaidDateAlreadySet`
- [ ] Body step labels in `_updateInvoicePaidDate`: STEP 1, 2, 3, 4, 5, 6 — no gaps
- [ ] Module header ORGANIZATION list has exactly 5 entries (1–5); no entry 6
- [ ] Section banners read SECTION 1, 2, 3, 4, 5 — no gaps, no SECTION 6
- [ ] Final line count ≈ 1119 (1170 − 49 Task 1 − 1 Task 2 − 1 Task 3)
- [ ] All `try/finally` resource guards intact: `_recordPayment` (lock release) and `_withLock` (lock release)
- [ ] Smoke test: open a monthly sheet, post a row with a Regular payment → `processPayment` completes without error

---

## Task 1: Remove Dead Code (Lines 878–911 and 1111–1125)

**Files:**
- Modify: `PaymentManager.gs:878-911` (block 1)
- Modify: `PaymentManager.gs:1111-1125` (block 2 — line numbers shift 34 after block 1)

**Background:** When the "already paid" guard step was removed from `_updateInvoicePaidDate`, three private helpers became unreachable: `_isPaidDateAlreadySet` is only called by `_isPaidDateAlreadySetInSheet`'s error fallback; `_isPaidDateAlreadySetInSheet` itself is never called from outside; `_buildAlreadyPaidResult` has no callers at all. No test file references any of the three.

- [ ] **Step 1: Delete block 1 — `_isPaidDateAlreadySet` and `_isPaidDateAlreadySetInSheet` (lines 878–911)**

Delete the blank line at 878 through `_isPaidDateAlreadySetInSheet`'s closing `},` at line 911 (34 lines). The line before the deletion is `_calculateBalanceInfo`'s closing `},` at line 877. After deletion, one blank line (originally line 912) separates `_calculateBalanceInfo` from `_writePaidDateToSheet`.

Replace the following with nothing (empty string):

```js

  /**
   * Helper: Check if paid date is already set on invoice
   * @private
   * @param {Object} invoice - Invoice object from InvoiceManager.findInvoice()
   * @returns {boolean} True if paid date is already set
   */
  _isPaidDateAlreadySet: function(invoice) {
    const col = CONFIG.invoiceCols;
    return !!invoice.data[col.paidDate];
  },

  /**
   * Helper: Check if paid date is already set in actual InvoiceDatabase sheet
   * Reads the sheet directly to avoid stale cache data.
   * Critical for accurate INVOICE_ALREADY_PAID detection.
   *
   * @private
   * @param {Object} invoice - Invoice object with row number
   * @returns {boolean} True if column H (paidDate) contains a value in the actual sheet
   */
  _isPaidDateAlreadySetInSheet: function(invoice) {
    try {
      const invoiceSh = MasterDatabaseUtils.getSourceSheet('invoice');
      const col = CONFIG.invoiceCols;
      const paidDateValue = invoiceSh.getRange(invoice.row, col.paidDate + 1).getValue();
      return !!paidDateValue; // True if column H is not empty
    } catch (error) {
      AuditLogger.logWarning('PaymentManager._isPaidDateAlreadySetInSheet',
        `Failed to read paid date from sheet: ${error.toString()}`);
      // On error, fall back to cached data to avoid blocking the operation
      return this._isPaidDateAlreadySet(invoice);
    }
  },
```

- [ ] **Step 2: Delete block 2 — `_buildAlreadyPaidResult` (original lines 1111–1125)**

After block 1 deletion, locate `_buildAlreadyPaidResult` by searching for the function name. Delete from the blank line before its JSDoc through its closing `},` (15 lines). The line before the deletion is `_buildPartialPaymentResult`'s closing `},`. After deletion, one blank line separates `_buildPartialPaymentResult` from `_buildPaidDateSuccessResult`.

Replace the following with nothing (empty string):

```js

  /**
   * Result Builder: Already paid result
   * @private
   * @param {string} invoiceNo - Invoice number
   * @param {string} currentPaidDate - Existing paid date
   * @returns {PaidStatusResult} Result indicating already paid
   */
  _buildAlreadyPaidResult: function(invoiceNo, currentPaidDate) {
    const result = this._createBasePaidStatusResult();
    result.fullyPaid = true;
    result.reason = 'already_set';
    result.message = `Invoice ${invoiceNo} already marked as paid on ${currentPaidDate}`;
    return result;
  },
```

- [ ] **Step 2b: Verify**

1. `grep` for `_isPaidDateAlreadySet` and `_buildAlreadyPaidResult` → zero matches anywhere in `*.gs` files.
2. `_writePaidDateToSheet` JSDoc follows `_calculateBalanceInfo`'s closing `},` with exactly one blank line.
3. `_buildPaidDateSuccessResult` JSDoc follows `_buildPartialPaymentResult`'s closing `},` with exactly one blank line.
4. File line count is 1121 (1170 − 49).

- [ ] **Step 3: Commit**

```
git add PaymentManager.gs
git commit -m "refactor(PaymentManager): remove dead already-paid helpers (_isPaidDateAlreadySet, _isPaidDateAlreadySetInSheet, _buildAlreadyPaidResult)"
```

---

## Task 2: Fix Stale `_updateInvoicePaidDate` Workflow Comment and Step Labels

**Files:**
- Modify: `PaymentManager.gs` — locate by searching `WORKFLOW:` (in `_updateInvoicePaidDate` JSDoc)

**Background:** The 7-step workflow comment still documents step 4 "Check if paid date already set (via `_isPaidDateAlreadySet`)" which no longer exists in the code. As a result the inline step labels in the body jump from STEP 4 (write to sheet) directly to STEP 6 (update cache) to STEP 7 (return success), skipping 5.

- [ ] **Step 1: Replace the WORKFLOW comment block**

Old (7 steps — step 4 is stale):
```
   * WORKFLOW:
   * 1. Find invoice (uses cached if provided)
   * 2. Calculate balance (via _calculateBalanceInfo)
   * 3. Check if fully paid (early return if partial)
   * 4. Check if paid date already set (via _isPaidDateAlreadySet)
   * 5. Write paid date (via _writePaidDateToSheet with lock management)
   * 6. Update cache if written
   * 7. Return result with audit logging
```

New (6 steps):
```
   * WORKFLOW:
   * 1. Find invoice (uses cached if provided)
   * 2. Calculate balance (via _calculateBalanceInfo)
   * 3. Check if fully paid (early return if partial)
   * 4. Write paid date (via _writePaidDateToSheet with lock management)
   * 5. Update cache if written
   * 6. Return result with audit logging
```

- [ ] **Step 2: Renumber STEP 6 → STEP 5 in the function body**

Old: `      // ═══ STEP 6: UPDATE CACHE ═══`
New: `      // ═══ STEP 5: UPDATE CACHE ═══`

- [ ] **Step 3: Renumber STEP 7 → STEP 6 in the function body**

Old: `      // ═══ STEP 7: RETURN SUCCESS ═══`
New: `      // ═══ STEP 6: RETURN SUCCESS ═══`

- [ ] **Step 4b: Verify**

1. WORKFLOW block has exactly 6 numbered entries; no line references `_isPaidDateAlreadySet`.
2. Step labels in `_updateInvoicePaidDate` body read sequentially: STEP 1, STEP 2, STEP 3, STEP 4, STEP 5, STEP 6 — no gaps.
3. No remaining `STEP 6: UPDATE CACHE` or `STEP 7: RETURN SUCCESS` in the file.

- [ ] **Step 5: Commit**

```
git add PaymentManager.gs
git commit -m "docs(PaymentManager): fix stale _updateInvoicePaidDate workflow comment and renumber step labels (6→5, 7→6)"
```

---

## Task 3: Fix Section Numbering in Module Header and Section Dividers

**Files:**
- Modify: `PaymentManager.gs` — 5 locations (module header + 4 section banners)

**Background:** The module header's ORGANIZATION list claims 6 sections and names "Backward Compatibility Functions" which was never implemented. The five actual section divider banners are numbered 1, 3, 4, 5, 6 — SECTION 2 label is absent because "PUBLIC API" was accidentally numbered as SECTION 3 when the structure was set up.

- [ ] **Step 1: Remove "6. Backward Compatibility Functions" from module header**

Old line (locate by searching `6. Backward Compatibility`):
```
 * 6. Backward Compatibility Functions (legacy support)
```

Delete this line entirely (replace with empty string, removing the newline).

- [ ] **Step 2: Renumber section banner — PUBLIC API (top-level, no indent)**

Old: `// SECTION 3: PAYMENT MANAGER - PUBLIC API`
New: `// SECTION 2: PAYMENT MANAGER - PUBLIC API`

- [ ] **Step 3: Renumber section banner — CORE WORKFLOW (2-space indent, inside PaymentManager object)**

Old: `  // SECTION 4: PAYMENT MANAGER - CORE WORKFLOW (PRIVATE)`
New: `  // SECTION 3: PAYMENT MANAGER - CORE WORKFLOW (PRIVATE)`

- [ ] **Step 4: Renumber section banner — HELPER FUNCTIONS (2-space indent)**

Old: `  // SECTION 5: PAYMENT MANAGER - HELPER FUNCTIONS (PRIVATE)`
New: `  // SECTION 4: PAYMENT MANAGER - HELPER FUNCTIONS (PRIVATE)`

- [ ] **Step 5: Renumber section banner — RESULT BUILDERS (2-space indent)**

Old: `  // SECTION 6: PAYMENT MANAGER - RESULT BUILDERS (PRIVATE)`
New: `  // SECTION 5: PAYMENT MANAGER - RESULT BUILDERS (PRIVATE)`

- [ ] **Step 6b: Verify**

1. Module header ORGANIZATION list has exactly 5 entries numbered 1–5; no entry 6.
2. No remaining `SECTION 6` or `Backward Compatibility` anywhere in the file.
3. Section banners in reading order: `SECTION 1`, `SECTION 2`, `SECTION 3`, `SECTION 4`, `SECTION 5`.
4. SECTION 2 banner is at top level (no leading spaces); SECTION 3–5 banners have 2-space indent.
5. File line count ≈ 1119.

- [ ] **Step 7: Commit**

```
git add PaymentManager.gs
git commit -m "docs(PaymentManager): fix section numbering — remove phantom section 6, renumber PUBLIC API/CORE/HELPERS/BUILDERS as 2-5"
```
