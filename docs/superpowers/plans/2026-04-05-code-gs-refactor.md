# Code.gs — Refactor & Optimize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use plan-driven-file-refactoring to implement this plan.

**Goal:** Compress the oversized header, eliminate redundant public-wrapper indirection, and decompose the 100-line `processPostedRow` into a data-prep helper + orchestrator — zero functional changes throughout.
**Architecture:** Orchestrator (`processPostedRow`) + extracted `_buildTransactionData` helper; public methods collapse into single implementations (no `_private` counterparts).
**Tech Stack:** Google Apps Script (ES5-compatible, no module system, no imports).

---

## Self-test: 2026-04-05

Audited against current `Code.gs` (883 lines).

| Task | Status | Notes |
|------|--------|-------|
| Task 1: Compress header | ✅ done | Compressed 136-line header to 27 lines; committed 1189248 |
| Task 2: Collapse wrapper methods | ✅ done | Removed 4 thin wrappers + renamed `_private` impls to public names; committed 96923e0 |
| Task 3: Extract `_buildTransactionData` | ✅ done | processPostedRow 70 lines, _buildTransactionData 27 lines; committed 40f6d55 |

## Task Sequence

| Order | Task | Type | Rationale |
|-------|------|------|-----------|
| 1 | Compress header | polish | Independent; largest single line saving (~96 lines) |
| 2 | Collapse public wrapper methods | extract | Removes 4 thin wrappers + renames 4 `_private` impls to public names |
| 3 | Extract `_buildTransactionData` | decompose | Must happen after Task 2 so the target function has its final name |
| 4 | Final size spot-check | polish | Confirm all functions within target sizes |

> **Rule:** Decompose before extract. Extract before DRY. DRY before polish.

---

## Files

| Action | File | What changes |
|--------|------|--------------|
| Modify | `Code.gs` | All tasks |

---

## Verification Checklist

Run after all tasks complete.

- [ ] Zero parse errors (paste Code.gs into the Script Editor; check for syntax errors before saving)
- [ ] No function exceeds 80 lines: `processPostedRow`, `_handleInstallableTrigger`, `_handleSimpleTrigger`, `_handlePostCheckbox`
- [ ] `_processPostedRowInternal` no longer exists anywhere in Code.gs (`grep _processPostedRowInternal`)
- [ ] `_clearPaymentFieldsForTypeChange`, `_populateDuePaymentAmount`, `_populatePaymentFields` no longer exist
- [ ] `try/finally` lock release preserved in `_handlePostCheckbox` (lines currently 481–485)
- [ ] Smoke test A: Edit Invoice No on a daily sheet → Prev Invoice auto-fills (simple trigger path)
- [ ] Smoke test B: Click POST checkbox on a valid row → transaction posts with POSTED status (installable trigger + `processPostedRow` path)

---

## Task 1: Compress Header (Lines 1–136)

**Files:**
- Modify: `Code.gs:1-136`

- [ ] **Step 1: Replace the 136-line header with a ~27-line version**

Replace the entire block from `/**` on line 1 through the closing `*/` on line 136 (the long module header) with the compressed version below. The section-2 divider comment starting on line 138 is **not** part of this replacement.

```js
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Code.gs - Main Application Entry Point and Event Handlers
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Central event handler for all spreadsheet interactions.
 * Manages edit triggers, field auto-population, and transaction workflow.
 *
 * CORE RESPONSIBILITIES:
 * 1. EVENT HANDLING — onEdit() simple trigger (UI only), onEditInstallable() (full DB access)
 * 2. FIELD AUTO-POPULATION — Invoice No, Received Amt, Due payment balance population
 * 3. TRANSACTION PROCESSING — Lock-guarded POST workflow: validate → invoice → payment → balance
 *
 * DUAL TRIGGER SYSTEM:
 * - Simple (onEdit): Invoice No/Received Amt edits; ~5-10ms; no lock; no Master DB access
 * - Installable (onEditInstallable): Payment Type/Post/Due edits; ~50-150ms; lock on POST only
 * - Run setupInstallableEditTrigger() once per monthly file for Master Database mode
 *
 * MODULE ORGANIZATION:
 *   1. MODULE HEADER — This documentation
 *   2. GLOBAL TRIGGER FUNCTIONS — onEdit, onEditInstallable (entry points)
 *   3. CODE MODULE — Public API + trigger handlers + column handlers + helpers
 *   4. TRIGGER SETUP/TEARDOWN — Master Database trigger configuration
 *
 * See agent_docs/ for architecture, caching, coding patterns, and testing details.
 */
```

- [ ] **Step 2b: Verify**

Line 1 should now start with `/**` and line ~27 should contain `*/`, immediately followed by the blank line and `/**` that opens the Section 2 divider. Total file length should be approximately 774 lines (883 − 109 removed + 27 added ≈ 801; accept ±5).

- [ ] **Step 3: Commit**

```
git add Code.gs
git commit -m "refactor(Code): compress verbose 136-line header to 27 lines"
```

---

## Task 2: Collapse Public Wrapper Methods (Lines 193–261 + private impls)

**Files:**
- Modify: `Code.gs` (multiple locations)

This task has four atomic steps. All four are in the same commit — they form one logical change (eliminating the double-method pattern).

- [ ] **Step 1: Remove all four thin wrapper methods and their section header from the PUBLIC API section**

Locate and delete the following block in its entirety (lines ~193–261 after Task 1's line shift). The block starts with the section divider and ends after the last wrapper's closing `},`:

```js
  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API - CORE TRANSACTION PROCESSING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Process Posted Row - Full Transaction Workflow
   *
   * Orchestrates the complete transaction workflow for a posted row:
   *   1. Validates post data (early exit if invalid - no lock acquired)
   *   2. Creates or updates invoice
   *   3. Records payment (if applicable)
   *   4. Updates balance
   *   5. Invalidates cache
   *   6. Batches all writes (minimum API calls)
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet object
   * @param {number} rowNum - Row number to process (1-based)
   * @param {Array} rowData - Pre-read row values from sheet.getRange().getValues()[0]
   * @param {Date} invoiceDate - Invoice date for transaction
   * @param {string} enteredBy - User email of person posting transaction
   * @returns {void} Updates sheet in-place, logs to AuditLog
   */
  processPostedRow: function(sheet, rowNum, rowData, invoiceDate, enteredBy) {
    this._processPostedRowInternal(sheet, rowNum, rowData, invoiceDate, enteredBy);
  },

  /**
   * Clear Payment Fields for Type Change
   *
   * Clears only necessary fields based on payment type selection.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet object
   * @param {number} row - Row number (1-based)
   * @param {string} newPaymentType - New payment type selected
   * @returns {void} Updates sheet in-place
   */
  clearPaymentFieldsForTypeChange: function(sheet, row, newPaymentType) {
    this._clearPaymentFieldsForTypeChange(sheet, row, newPaymentType);
  },

  /**
   * Populate Due Payment Amount
   *
   * Fills payment amount with the outstanding balance of selected invoice.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet object
   * @param {number} row - Row number (1-based)
   * @param {string} supplier - Supplier name for invoice lookup
   * @param {string} prevInvoice - Previous invoice number selected
   * @returns {number|string} Outstanding balance or empty string
   */
  populateDuePaymentAmount: function(sheet, row, supplier, prevInvoice) {
    return this._populateDuePaymentAmount(sheet, row, supplier, prevInvoice);
  },

  /**
   * Populate Payment Fields
   *
   * Fills payment fields for Regular and Partial payment types.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet object
   * @param {number} row - Row number (1-based)
   * @param {string} paymentType - Payment type (Regular or Partial)
   * @param {Array} rowData - Pre-read row values
   * @returns {Object} Result object with {paymentAmt, prevInvoice}
   */
  populatePaymentFields: function(sheet, row, paymentType, rowData) {
    return this._populatePaymentFields(sheet, row, paymentType, rowData);
  },
```

Replace with: *(nothing — delete the entire block)*

- [ ] **Step 2: Rename `_processPostedRowInternal` section header and method signature, restoring its JSDoc**

Locate:

```js
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: TRANSACTION PROCESSING INTERNALS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * PRIVATE: Main transaction processing logic
   * @private
   */
  _processPostedRowInternal: function(sheet, rowNum, rowData, invoiceDate, enteredBy) {
```

Replace with:

```js
  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSACTION PROCESSING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Process Posted Row - Full Transaction Workflow
   *
   * Orchestrates the complete transaction workflow for a posted row:
   *   1. Validates post data (early exit if invalid - no lock acquired)
   *   2. Creates or updates invoice
   *   3. Records payment (if applicable)
   *   4. Updates balance
   *   5. Invalidates cache
   *   6. Batches all writes (minimum API calls)
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet object
   * @param {number} rowNum - Row number to process (1-based)
   * @param {Array} rowData - Pre-read row values from sheet.getRange().getValues()[0]
   * @param {Date} invoiceDate - Invoice date for transaction
   * @param {string} enteredBy - User email of person posting transaction
   * @returns {void} Updates sheet in-place, logs to AuditLog
   */
  processPostedRow: function(sheet, rowNum, rowData, invoiceDate, enteredBy) {
```

- [ ] **Step 3: Rename field population section header and all three private method signatures, restoring their JSDoc**

Locate the field population section opening:

```js
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: FIELD POPULATION INTERNALS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * PRIVATE: Clear payment fields implementation
   * @private
   */
  _clearPaymentFieldsForTypeChange: function(sheet, row, newPaymentType) {
```

Replace with:

```js
  // ═══════════════════════════════════════════════════════════════════════════
  // FIELD POPULATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clear Payment Fields for Type Change
   *
   * Clears only necessary fields based on payment type selection.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet object
   * @param {number} row - Row number (1-based)
   * @param {string} newPaymentType - New payment type selected
   * @returns {void} Updates sheet in-place
   */
  clearPaymentFieldsForTypeChange: function(sheet, row, newPaymentType) {
```

Then locate:

```js
  /**
   * PRIVATE: Populate due payment amount implementation
   * @private
   */
  _populateDuePaymentAmount: function(sheet, row, supplier, prevInvoice) {
```

Replace with:

```js
  /**
   * Populate Due Payment Amount
   *
   * Fills payment amount with the outstanding balance of selected invoice.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet object
   * @param {number} row - Row number (1-based)
   * @param {string} supplier - Supplier name for invoice lookup
   * @param {string} prevInvoice - Previous invoice number selected
   * @returns {number|string} Outstanding balance or empty string
   */
  populateDuePaymentAmount: function(sheet, row, supplier, prevInvoice) {
```

Then locate:

```js
  /**
   * PRIVATE: Populate payment fields implementation
   * @private
   */
  _populatePaymentFields: function(sheet, row, paymentType, rowData) {
```

Replace with:

```js
  /**
   * Populate Payment Fields
   *
   * Fills payment fields for Regular and Partial payment types.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Active sheet object
   * @param {number} row - Row number (1-based)
   * @param {string} paymentType - Payment type (Regular or Partial)
   * @param {Array} rowData - Pre-read row values
   * @returns {Object} Result object with {paymentAmt, prevInvoice}
   */
  populatePaymentFields: function(sheet, row, paymentType, rowData) {
```

- [ ] **Step 2a: Spot-check**

Confirm that `this.clearPaymentFieldsForTypeChange(...)`, `this.populatePaymentFields(...)`, and `this.populateDuePaymentAmount(...)` in the column-handler section still resolve correctly (their call sites are unchanged; only the implementation names changed). Confirm `this.processPostedRow(...)` in `_handlePostCheckbox` still resolves. Search for `_processPostedRowInternal`, `_clearPaymentFieldsForTypeChange`, `_populateDuePaymentAmount`, `_populatePaymentFields` — all should return zero matches.

- [ ] **Step 4b: Verify**

File length should be approximately 735 lines (801 from Task 1 − ~66 wrapper lines removed + ~20 JSDoc lines restored in impls). No function named with a leading `_` should exist in the TRANSACTION PROCESSING or FIELD POPULATION sections.

- [ ] **Step 5: Commit**

```
git add Code.gs
git commit -m "refactor(Code): collapse 4 public wrappers into single implementations"
```

---

## Task 3: Extract `_buildTransactionData` from `processPostedRow` (Lines ~after Task 2)

**Files:**
- Modify: `Code.gs` — `processPostedRow` function body and the TRANSACTION PROCESSING section

`processPostedRow` is ~100 lines. The first ~35 lines inside its `try` block are data extraction (field reads, type coercions, `data` object construction) with no side effects. Extract those into `_buildTransactionData`.

- [ ] **Step 1: Replace the data-prep block inside `processPostedRow`'s try**

Locate this exact block (it starts after `try {` inside `processPostedRow`):

```js
      if (!rowData) {
        rowData = sheet.getRange(rowNum, 1, 1, totalCols).getValues()[0];
      }

      const supplier = rowData[cols.supplier];
      const invoiceNo = rowData[cols.invoiceNo];
      const receivedAmt = parseFloat(rowData[cols.receivedAmt]) || 0;
      const paymentType = rowData[cols.paymentType];
      const prevInvoice = rowData[cols.prevInvoice];
      const paymentAmt = parseFloat(rowData[cols.paymentAmt]) || 0;
      const sysId = rowData[cols.sysId] || IDGenerator.generateUUID();

      const finalInvoiceDate = invoiceDate || getDailySheetDate(sheetName) || now;
      const paymentDate = getDailySheetDate(sheetName) || now;
      const finalEnteredBy = enteredBy || UserResolver.getCurrentUser();

      const data = {
        sheetName,
        rowNum,
        supplier,
        invoiceNo,
        invoiceDate: finalInvoiceDate,
        receivedAmt,
        paymentAmt,
        paymentType,
        paymentDate: paymentDate,
        prevInvoice,
        notes: rowData[cols.notes],
        enteredBy: finalEnteredBy,
        timestamp: now,
        sysId
      };
```

Replace with:

```js
      const built = this._buildTransactionData(sheet, rowNum, rowData, invoiceDate, enteredBy, sheetName, now);
      rowData = built.rowData;
      const data = built.data;
```

Also remove `const totalCols = CONFIG.totalColumns.daily;` from the outer variable declarations (line ~552) since `totalCols` is no longer used in `processPostedRow` itself — it moves into the helper.

- [ ] **Step 2: Insert `_buildTransactionData` immediately after the closing `},` of `processPostedRow`**

Insert the following new method between `processPostedRow`'s closing `},` and the `// ═══` divider of the next section (FIELD POPULATION):

```js
  /**
   * Build transaction data object from row
   *
   * Reads missing rowData from sheet if not supplied, coerces field types,
   * and assembles the canonical `data` payload used throughout the POST workflow.
   *
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {number} rowNum
   * @param {Array|null} rowData - Pre-read row values, or null to read from sheet
   * @param {Date|null} invoiceDate
   * @param {string|null} enteredBy
   * @param {string} sheetName
   * @param {Date} now
   * @returns {{rowData: Array, data: Object}}
   */
  _buildTransactionData: function(sheet, rowNum, rowData, invoiceDate, enteredBy, sheetName, now) {
    const cols = CONFIG.cols;
    if (!rowData) {
      rowData = sheet.getRange(rowNum, 1, 1, CONFIG.totalColumns.daily).getValues()[0];
    }
    const finalInvoiceDate = invoiceDate || getDailySheetDate(sheetName) || now;
    const finalEnteredBy = enteredBy || UserResolver.getCurrentUser();
    return {
      rowData: rowData,
      data: {
        sheetName,
        rowNum,
        supplier:    rowData[cols.supplier],
        invoiceNo:   rowData[cols.invoiceNo],
        invoiceDate: finalInvoiceDate,
        receivedAmt: parseFloat(rowData[cols.receivedAmt]) || 0,
        paymentAmt:  parseFloat(rowData[cols.paymentAmt]) || 0,
        paymentType: rowData[cols.paymentType],
        paymentDate: getDailySheetDate(sheetName) || now,
        prevInvoice: rowData[cols.prevInvoice],
        notes:       rowData[cols.notes],
        enteredBy:   finalEnteredBy,
        timestamp:   now,
        sysId:       rowData[cols.sysId] || IDGenerator.generateUUID()
      }
    };
  },
```

- [ ] **Step 2a: Spot-check**

Manually trace: after calling `_buildTransactionData`, `data.supplier`, `data.receivedAmt`, `data.sysId`, and `data.paymentDate` should match what the inline code produced. In particular verify `data.sysId` uses `rowData[cols.sysId]` (not the old local `sysId` variable) and `data.paymentDate` uses the same expression as before (`getDailySheetDate(sheetName) || now`).

- [ ] **Step 3b: Verify**

`processPostedRow` should now be ≤ 70 lines. `_buildTransactionData` should be ≤ 40 lines. Grep for `totalCols` inside `processPostedRow` — should return zero matches (it was removed).

- [ ] **Step 4: Commit**

```
git add Code.gs
git commit -m "refactor(Code): extract _buildTransactionData from processPostedRow"
```

---

## Task 4: Final Size Spot-Check

- [ ] **Step 1: Verify all function sizes are within targets**

Count lines for each function:
- `processPostedRow` → target < 80 lines
- `_buildTransactionData` → target < 40 lines
- `_handleInstallableTrigger` → target < 80 lines (was ~70 lines, unchanged)
- `_handlePostCheckbox` → target < 80 lines (was ~61 lines, unchanged)

Confirm final file length is approximately 710–740 lines (down from 883).

- [ ] **Step 2: Commit**

No code changes — if only the plan file was updated, skip this commit.
