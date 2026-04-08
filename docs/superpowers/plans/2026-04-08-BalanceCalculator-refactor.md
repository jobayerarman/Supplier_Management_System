# BalanceCalculator.gs — Refactor & Optimize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use plan-driven-file-refactoring to implement this plan.

**Goal:** Strip stale refactoring-history markers from JSDoc comments — zero functional changes.  
**Architecture:** Comment-only cleanup across 2 tasks; module header compression + inline `✓` marker removal.  
**Tech Stack:** Google Apps Script (ES6+, no module system, runs in GAS runtime).

---

## Profile Summary (2026-04-08)

Audited `BalanceCalculator.gs` — 781 lines.

| Metric | Finding |
|--------|---------|
| Functions > 80 lines | **0** — longest is `_sumInvoiceBalances` (39 lines) |
| DRY violations (≥ 3 copies) | None meaningful — `_validateSupplier` inconsistency minor, not worth changing |
| Stale ✓ progress markers | **8 lines** across 3 function JSDoc blocks |
| Module header history narrative | **11 lines** (Phase 2 + Phase 3 blocks, lines 12–22) |
| Resource guards (try/finally) | None — pure calculation module |
| Dead public API (no external callers) | 4 methods: `calculatePreview`, `getSupplierOutstandingDetailed`, `getSupplierSummary`, `validatePreviewAccuracy` — **flag only, do not remove** |

**Dead API note:** The 4 methods with no codebase callers are retained as-is. Removing them is a behavioral/API change — out of scope.

---

## Self-test: 2026-04-08

Audited against current `BalanceCalculator.gs` (781 lines).

| Task | Status | Notes |
|------|--------|-------|
| Task 1: Compress module header | ✅ completed | Removed Phase 2 + Phase 3 history blocks; header: 31→19 lines |
| Task 2: Strip ✓ markers from function JSDoc | ✅ completed | Removed markers from 3 locations; verified zero ✓ in file |

---

## Task Sequence

| Order | Task | Type | Rationale |
|-------|------|------|-----------|
| 1 | Compress module header | polish | Remove Phase 2/3 history narrative — no longer informative |
| 2 | Strip ✓ markers from function JSDoc | polish | Remove stale progress notes from 3 function blocks |

---

## Files

| Action | File | What changes |
|--------|------|--------------|
| Modify | `BalanceCalculator.gs` | Tasks 1–2 |

---

## Verification Checklist

Run after all tasks complete.

- [ ] Zero parse errors (paste into GAS Script Editor, check for syntax errors)
- [ ] No function exceeds 80 lines (all were under 40 before; spot-check `_sumInvoiceBalances`)
- [ ] Module header: Phase 2 and Phase 3 history blocks absent; Performance Optimizations and Organization sections intact
- [ ] `✓ REFACTORED`, `✓ REDUCED`, `✓ COMPLEXITY`, `✓ EXTENSIBLE` strings absent from all JSDoc blocks
- [ ] Smoke test: `getSupplierOutstanding()` still exposed with `@performance` note intact
- [ ] Smoke test: `updateBalanceCell` JSDoc still has all 4 `@param` entries

---

## Task 1: Compress Module Header (Lines 3–33)

**Files:**
- Modify: `BalanceCalculator.gs:3-33`

- [ ] **Step 1: Replace module JSDoc header**

Remove the `REFACTORED FOR MAINTAINABILITY (Phase 2)` block (lines 12–16) and the `CONFIGURATION-DRIVEN (Phase 3)` block (lines 18–22), keeping Performance Optimizations, Organization, and NOTE sections.

```js
/**
 * Balance calculation and supplier ledger management
 *
 * PERFORMANCE OPTIMIZATIONS:
 * - Partition-aware queries using active invoice cache (70-90% faster)
 * - O(m) complexity for supplier queries (m = supplier's active invoices)
 * - Centralized calculation logic reduces duplication
 * - Single source of truth for all balance operations
 *
 * ORGANIZATION:
 * 1. Payment Type Configuration (Internal)
 * 2. Helper Classes
 * 3. BalanceCalculator Public API
 * 4. BalanceCalculator Core Calculations (Private)
 * 5. BalanceCalculator Helper Functions (Private)
 * 6. BalanceCalculator Result Builders (Private)
 *
 * NOTE: Shared constants moved to CONFIG.constants in _Config.gs for centralization
 */
```

- [ ] **Step 2b: Verify**

Header now 19 lines (was 31). Performance Optimizations section intact. Organization section intact. NOTE line intact. No Phase 2/3 history blocks present.

- [ ] **Step 3: Commit**

```
git add BalanceCalculator.gs
git commit -m "style(BalanceCalculator): remove stale phase-history blocks from module header

Phase 2 and Phase 3 refactoring narratives are now historical noise;
the resulting structure is self-evident from the code."
```

---

## Task 2: Strip ✓ Markers from Function JSDoc (3 Locations)

**Files:**
- Modify: `BalanceCalculator.gs` (3 JSDoc blocks)

All three replacements are in one task and committed together.

- [ ] **Step 1a: Replace `updateBalanceCell` JSDoc (lines ~213–222)**

Remove the two `✓ REFACTORED` / `✓ REDUCED` lines; keep description and all `@param` entries.

```js
  /**
   * Update balance cell in daily sheet
   * Shows preview before post, actual balance after post
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet
   * @param {number} row - Row number
   * @param {boolean} afterPost - Whether this is after posting
   * @param {Array} rowData - Pre-read row values (REQUIRED - no fallback reads)
   */
```

- [ ] **Step 1b: Replace `getSupplierOutstanding` JSDoc (lines ~241–252)**

Remove the three `✓ REFACTORED` / `✓ REDUCED` / `✓ COMPLEXITY` lines; keep `@performance` note, `@param`, and `@returns`.

```js
  /**
   * Get total outstanding balance for a supplier
   *
   * @performance Uses active partition cache for 70-90% faster iteration
   * See CLAUDE.md "Cache Partitioning" for optimization details
   *
   * @param {string} supplier - Supplier name
   * @returns {number} Total outstanding balance
   */
```

- [ ] **Step 1c: Replace `_calculateTransactionImpact` JSDoc (lines ~402–421)**

Remove the three `✓ REFACTORED` / `✓ REDUCED` / `✓ EXTENSIBLE` lines; keep description, `@private`, `@typedef`, and all `@param`/`@returns` entries.

```js
  /**
   * Calculate transaction impact on balance
   * INTERNAL: Core calculation logic used by both calculate() and calculatePreview()
   *
   * @private
   * @typedef {Object} TransactionImpact
   * @property {number} change - Balance change amount
   * @property {string} description - Human-readable description of the transaction
   * @property {string|null} error - Error message or null if successful
   *
   * @param {string} paymentType - Transaction payment type
   * @param {number} receivedAmt - Amount received
   * @param {number} paymentAmt - Amount paid
   * @param {string} prevInvoice - Previous invoice reference (for Due payments)
   * @returns {TransactionImpact} Impact calculation result
   */
```

- [ ] **Step 2b: Verify**

Grep for `✓` in `BalanceCalculator.gs` — zero results. All three function descriptions and parameter lists still intact.

- [ ] **Step 3: Commit**

```
git add BalanceCalculator.gs
git commit -m "style(BalanceCalculator): remove stale ✓ refactor markers from JSDoc

Progress markers in updateBalanceCell, getSupplierOutstanding, and
_calculateTransactionImpact were left over from a previous refactor session
and no longer carry informational value."
```

---

## Execution Order

1. ✅ Create plan doc at `docs/superpowers/plans/2026-04-08-BalanceCalculator-refactor.md`
2. ✅ Execute Task 1 → commit (cc5a5d1)
3. ✅ Execute Task 2 → commit (dfa9574)
4. ✅ Run verification checklist
5. ✅ Mark tasks ✅ in plan doc

**All tasks completed successfully.**
