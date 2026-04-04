# UIMenu.gs — Refactor & Optimize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor UIMenu.gs for readability and maintainability with zero functional changes — compress the 156-line header, decompose four large functions into focused phase helpers, and eliminate eleven repeated confirmation-dialog blocks.

**Architecture:** Single-file refactor. Large handlers become ~25–30 line orchestrators that delegate to co-located phase helper functions. Two DRY utility helpers (`_confirmOperation`, `_toast`) replace repeated inline patterns. No behavior changes anywhere.

**Tech Stack:** Google Apps Script (ES5-compatible JS, no module system, no test runner)

---

## Files

| Action | File | What changes |
|---|---|---|
| Modify | `UIMenu.gs` | Only file touched — all 8 tasks |

---

## Task 1: Compress Section 01 (Lines 1–156 → ~40 lines)

**Files:**
- Modify: `UIMenu.gs:1-156`

- [ ] **Step 1: Replace lines 1–156 with the compressed header below**

Delete everything from line 1 through line 155 (the closing `*/`) and replace with:

```js
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UIMenu.gs - Batch Operations and Custom Menu System
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * OVERVIEW:
 * Batch operations system for end-of-day workflow processing. Provides a
 * custom menu for bulk validation and posting with progress tracking and
 * comprehensive error reporting.
 *
 * CORE RESPONSIBILITIES:
 * - Menu management      : onOpen(), custom menu structure and delegates
 * - Batch validation     : validateAllRows, validateSelectedRows, error collection
 * - Batch posting        : postAllRows, postSelectedRows, cache invalidation, status updates
 * - Utility operations   : clearCheckboxes, sheet management, reset operations
 *
 * DATA STRUCTURES:
 *
 * Validation Results:
 *   { total, valid, invalid, skipped,
 *     errors: [{ row, supplier, invoiceNo, error }] }
 *
 * Posting Results (extends Validation Results):
 *   { ...validationResults, posted, failed,
 *     connectionMode,   // 'LOCAL' or 'MASTER'
 *     duration,         // total ms
 *     avgTimePerRow }   // ms per posted row
 *
 * @see agent_docs/caching_architecture.md  — batch read + cache invalidation strategy
 * @see agent_docs/master_database.md       — LOCAL/MASTER mode behaviour
 * @see agent_docs/coding_patterns.md       — naming conventions, error handling patterns
 *
 * Dependencies: _Config.gs, _Utils.gs, _UserResolver.gs, ValidationEngine.gs,
 *               InvoiceManager.gs, PaymentManager.gs, BalanceCalculator.gs,
 *               CacheManager.gs, AuditLogger.gs
 */
```

- [ ] **Step 2: Verify the new header**

Count lines from `/**` to the closing `*/` — should be 38–42 lines.
Confirm the section 2 divider (`SECTION 2: GLOBAL MENU FUNCTIONS`) still follows immediately after.

- [ ] **Step 3: Commit**

```
git add UIMenu.gs
git commit -m "refactor(UIMenu): compress 156-line header to ~40 lines"
```

---

## Task 2: Decompose `_handleBatchPosting` (Lines 862–1086)

**Files:**
- Modify: `UIMenu.gs:862-1086`

The 234-line function splits into a ~30-line orchestrator + 5 co-located phase helpers.
The helpers are placed **immediately below** the orchestrator, before `_handleClearCheckboxes`.

- [ ] **Step 1: Replace `_handleBatchPosting` with the orchestrator + 5 phase helpers**

Replace the entire `_handleBatchPosting` function (from its opening `/**` comment through its closing `},`) with the following block. Keep the original JSDoc comment that precedes it.

```js
  _handleBatchPosting: function(sheet, startRow = null, endRow = null) {
    const context = this._initBatchPostSetup(sheet, startRow, endRow);
    if (!context) return this._createEmptyPostResults(CONFIG.isMasterMode() ? 'MASTER' : 'LOCAL');
    this._runBatchPostLoop(context);
    this._invalidateBatchCaches(context);
    this._flushBatchStatusUpdates(context);
    return this._reportBatchPostResults(context);
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

    SpreadsheetApp.getActiveSpreadsheet().toast(
      `Starting batch post of ${numRows} rows (${connectionMode} mode)...`,
      'Processing', 3
    );

    const allData = sheet.getRange(startRow, 1, numRows, CONFIG.totalColumns.daily).getValues();

    const results = {
      total: numRows, posted: 0, failed: 0, skipped: 0,
      errors: [], connectionMode: connectionMode, duration: 0, avgTimePerRow: 0
    };

    return {
      sheet, sheetName, connectionMode,
      startRow, endRow, numRows, allData,
      results,
      suppliersToInvalidate: new Set(),
      pendingStatusUpdates:  [],
      progressInterval: this._calculateProgressInterval(numRows),
      enteredBy:    UserResolver.getCurrentUser(),
      batchContext: this._initBatchContext(),
      startTime
    };
  },

  /** @private Phase 2: iterate rows, validate, invoice, payment, queue status updates. */
  _runBatchPostLoop: function(context) {
    const { sheet, sheetName, allData, startRow, numRows,
            results, suppliersToInvalidate, pendingStatusUpdates,
            progressInterval, enteredBy, batchContext } = context;

    for (let i = 0; i < allData.length; i++) {
      const rowNum  = startRow + i;
      const rowData = allData[i];

      if ((i + 1) % progressInterval === 0) {
        SpreadsheetApp.getActiveSpreadsheet().toast(
          `Processed ${i + 1} of ${numRows} rows...`, 'Progress', 2
        );
      }

      if (!rowData[CONFIG.cols.supplier]) { results.skipped++; continue; }

      const status = rowData[CONFIG.cols.status];
      if (status && status.toString().toUpperCase() === 'POSTED') { results.skipped++; continue; }

      try {
        const data = this._buildDataObject(rowData, rowNum, sheetName, enteredBy);
        const validation = validatePostData(data);

        if (!validation.valid) {
          results.failed++;
          const errorMsg = validation.error ||
            (validation.errors && validation.errors.length > 0 ? validation.errors[0] : 'Validation failed');
          results.errors.push({ row: rowNum, supplier: data.supplier,
                                invoiceNo: data.invoiceNo || 'N/A', error: errorMsg });
          pendingStatusUpdates.push({
            rowNum, keepChecked: false,
            status:  `ERROR: ${errorMsg.substring(0, 100)}`,
            user:    UserResolver.extractUsername(data.enteredBy),
            time:    data.timestamp, bgColor: CONFIG.colors.error
          });
          AuditLogger.log('VALIDATION_FAILED', data, errorMsg);
          continue;
        }

        if (!data.sysId) {
          data.sysId = IDGenerator.generateUUID();
          sheet.getRange(rowNum, CONFIG.cols.sysId + 1, 1, 1).setValue(data.sysId);
        }

        const invoiceResult = InvoiceManager.createOrUpdateInvoice(data, batchContext);
        data.invoiceId = invoiceResult.invoiceId;

        if (this._shouldProcessPayment(data)) {
          PaymentManager.processPayment(data, invoiceResult.invoiceId, batchContext);
        }

        BalanceCalculator.updateBalanceCell(sheet, rowNum, true, rowData);

        pendingStatusUpdates.push({
          rowNum, keepChecked: true, status: 'POSTED',
          user:    UserResolver.extractUsername(data.enteredBy),
          time:    data.timestamp, bgColor: CONFIG.colors.success
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
          status:  `ERROR: ${error.message.substring(0, 100)}`,
          user:    UserResolver.extractUsername(enteredBy),
          time:    DateUtils.formatTimestamp(), bgColor: CONFIG.colors.error
        });
        AuditLogger.logError('BATCH_POST_FAILED', error, { row: rowNum });
      }
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

  /** @private Phase 5: calculate metrics, show completion toast, return results. */
  _reportBatchPostResults: function(context) {
    const { results, startTime, connectionMode } = context;
    results.duration = Date.now() - startTime;
    results.avgTimePerRow = results.posted > 0
      ? Math.round(results.duration / results.posted) : 0;

    SpreadsheetApp.getActiveSpreadsheet().toast(
      `Completed in ${(results.duration / 1000).toFixed(1)}s (${connectionMode} mode): ` +
      `${results.posted} posted, ${results.failed} failed, ${results.skipped} skipped`,
      'Success', 5
    );
    return results;
  },
```

- [ ] **Step 2: Verify the orchestrator reads correctly**

`_handleBatchPosting` body should be exactly 6 lines (const context, if !context, 4 phase calls + return).
Confirm `_initBatchPostSetup`, `_runBatchPostLoop`, `_invalidateBatchCaches`, `_flushBatchStatusUpdates`, `_reportBatchPostResults` all appear **before** `_handleClearCheckboxes` in the file.

- [ ] **Step 3: Commit**

```
git add UIMenu.gs
git commit -m "refactor(UIMenu): decompose _handleBatchPosting into 5 phase helpers"
```

---

## Task 3: Decompose `_handleBatchValidation` (Lines 731–840)

**Files:**
- Modify: `UIMenu.gs:731-840`

Splits into a ~10-line orchestrator + 2 phase helpers.
Place helpers **immediately below** the orchestrator.

**Note:** Unlike the posting handler, validation has no flush or report phase — it simply returns results. The outer `try` block wraps both the batch read and loop together, so `_runBatchValidationLoop` preserves that structure.

- [ ] **Step 1: Replace `_handleBatchValidation` with orchestrator + 2 phase helpers**

Replace the entire function body (keeping the existing JSDoc comment) with:

```js
  _handleBatchValidation: function(sheet, startRow = null, endRow = null) {
    const context = this._initBatchValidationSetup(sheet, startRow, endRow);
    if (!context) return this._createEmptyResults();
    this._runBatchValidationLoop(context);
    return context.results;
  },

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

    SpreadsheetApp.getActiveSpreadsheet().toast(
      `Starting validation of ${numRows} rows...`, 'Validating', 3
    );

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
          SpreadsheetApp.getActiveSpreadsheet().toast(
            `Validated ${i + 1} of ${numRows} rows...`, 'Progress', 2
          );
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
```

- [ ] **Step 2: Verify orchestrator**

`_handleBatchValidation` body should be 4 lines. Confirm `_initBatchValidationSetup` and `_runBatchValidationLoop` appear immediately after it, before `_handleBatchPosting`.

- [ ] **Step 3: Commit**

```
git add UIMenu.gs
git commit -m "refactor(UIMenu): decompose _handleBatchValidation into 2 phase helpers"
```

---

## Task 4: Decompose `_handleDeleteDailySheets` (Lines 1342–1415)

**Files:**
- Modify: `UIMenu.gs:1342-1415`

Splits into a ~20-line orchestrator + 2 co-located helpers.

- [ ] **Step 1: Replace `_handleDeleteDailySheets` with orchestrator + 2 helpers**

Replace the entire function (keeping its existing JSDoc if any) with:

```js
  _handleDeleteDailySheets: function() {
    const ui = SpreadsheetApp.getUi();
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const response = ui.alert(
      '🗑️ DELETE DAILY SHEETS (SAFE MODE)',
      'This will delete ONLY daily transaction sheets (02-31).\n\n' +
      'Protected sheets (01, InvoiceDatabase, etc.) will not be affected.\n\nContinue?',
      ui.ButtonSet.YES_NO
    );
    if (response !== ui.Button.YES) return;

    try {
      const sheetsToDelete = this._collectSheetsToDelete(ss);

      if (sheetsToDelete.length === 0) {
        ui.alert('No daily sheets (02-31) found to delete.');
        return;
      }

      const confirmResponse = ui.alert(
        'CONFIRM DELETION',
        `The following ${sheetsToDelete.length} sheets will be deleted:\n\n• ${sheetsToDelete.join('\n• ')}\n\nContinue?`,
        ui.ButtonSet.YES_NO
      );
      if (confirmResponse !== ui.Button.YES) {
        ui.alert('Deletion cancelled.');
        return;
      }

      const { deletedCount, errors } = this._deleteSheetsWithFeedback(sheetsToDelete, ss);

      let resultMessage = `✅ Deleted ${deletedCount} daily sheets.`;
      if (errors.length > 0) {
        resultMessage += `\n\n❌ ${errors.length} errors:\n• ${errors.join('\n• ')}`;
      }
      ui.alert('DELETION COMPLETE', resultMessage, ui.ButtonSet.OK);

    } catch (error) {
      ui.alert(`Critical Error: ${error.message}`);
    }
  },

  /** @private Collect names of deletable daily sheets (02-31, not in protectedSheets). */
  _collectSheetsToDelete: function(ss) {
    const protectedSheets = ['01', 'MonthlySummary', 'SupplierList', 'Dashboard',
                             'Config', 'InvoiceDatabase', 'PaymentLog', 'AuditLog'];
    const sheetsToDelete = [];
    ss.getSheets().forEach(function(sheet) {
      const name = sheet.getName();
      if (CONFIG.dailySheets.includes(name) &&
          name !== '01' &&
          !protectedSheets.includes(name)) {
        sheetsToDelete.push(name);
      }
    });
    return sheetsToDelete;
  },

  /** @private Delete each sheet in the list, collect errors. Returns {deletedCount, errors}. */
  _deleteSheetsWithFeedback: function(sheetsToDelete, ss) {
    let deletedCount = 0;
    const errors = [];
    sheetsToDelete.forEach(function(sheetName) {
      try {
        const sheet = ss.getSheetByName(sheetName);
        if (sheet) { ss.deleteSheet(sheet); deletedCount++; }
      } catch (error) {
        errors.push(`Failed to delete ${sheetName}: ${error.message}`);
      }
    });
    return { deletedCount, errors };
  },
```

- [ ] **Step 2: Verify**

`_handleDeleteDailySheets` should be ~25 lines.
Confirm `_collectSheetsToDelete` and `_deleteSheetsWithFeedback` appear immediately after it.

- [ ] **Step 3: Commit**

```
git add UIMenu.gs
git commit -m "refactor(UIMenu): decompose _handleDeleteDailySheets into 2 helpers"
```

---

## Task 5: Decompose `_showValidationResults` (Lines 1549–1601)

**Files:**
- Modify: `UIMenu.gs:1549-1601`

Splits into a ~15-line display function + 1 string-building helper.

- [ ] **Step 1: Replace `_showValidationResults` with the two functions below**

Replace the entire function with:

```js
  _showValidationResults: function(results, isPosting) {
    const message = this._buildValidationMessage(results, isPosting, 10);
    const title   = isPosting ? 'Batch Posting Results' : 'Batch Validation Results';
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  },

  /** @private Build the text body for the validation/posting results dialog. */
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
```

- [ ] **Step 2: Verify**

`_showValidationResults` should be 4 lines. `_buildValidationMessage` should appear immediately after it.

- [ ] **Step 3: Commit**

```
git add UIMenu.gs
git commit -m "refactor(UIMenu): extract _buildValidationMessage from _showValidationResults"
```

---

## Task 6: Extract `_confirmOperation` — Replace 11 Dialog Blocks

**Files:**
- Modify: `UIMenu.gs` — PRIVATE UTILITIES section + 11 public API call sites

- [ ] **Step 1: Add `_confirmOperation` to PRIVATE UTILITIES**

Find the `_validateDailySheet` function in the PRIVATE UTILITIES section. Insert `_confirmOperation` **before** it:

```js
  /**
   * PRIVATE: Show a YES/NO confirmation dialog. Returns true if the user clicked YES.
   * @param {string} title - Dialog title
   * @param {string} message - Dialog body text
   * @return {boolean}
   * @private
   */
  _confirmOperation: function(title, message) {
    const ui = SpreadsheetApp.getUi();
    return ui.alert(title, message, ui.ButtonSet.YES_NO) === ui.Button.YES;
  },
```

- [ ] **Step 2: Replace the 11 inline dialog blocks**

For each call site below, replace the multi-line `ui.alert` + `if (response !== ...)` block with the one-liner shown. Also remove the `const ui = SpreadsheetApp.getUi()` declaration if it is no longer used anywhere else in that function after the replacement.

**Site 1 — `batchValidateAllRows`** (≈ line 346)
```js
// BEFORE (6 lines):
const ui = SpreadsheetApp.getUi();
// ...
const response = ui.alert(
  'Batch Validate All Rows',
  'This will validate all rows in the current sheet. Continue?',
  ui.ButtonSet.YES_NO
);
if (response !== ui.Button.YES) { return; }

// AFTER (1 line — also remove the `const ui` declaration):
if (!this._confirmOperation('Batch Validate All Rows', 'This will validate all rows in the current sheet. Continue?')) return;
```

**Site 2 — `batchPostAllRows`** (≈ line 382)
```js
// AFTER (1 line — also remove `const ui`):
if (!this._confirmOperation('Batch Post All Valid Rows',
  'This will validate and post all valid rows in the current sheet.\n\nWARNING: This action cannot be undone. Continue?')) return;
```

**Site 3 — `batchPostSelectedRows`** (≈ line 451)
```js
// NOTE: batchPostSelectedRows also uses ui.alert for selection validation — KEEP `const ui`.
// Replace only the confirmation block:
if (!this._confirmOperation('Batch Post Selected Rows',
  `This will validate and post ${numRows} selected row(s).\n\nWARNING: This action cannot be undone. Continue?`)) return;
```

**Site 4 — `clearAllPostCheckboxes`** (≈ line 498)
```js
// AFTER (1 line — also remove `const ui`):
if (!this._confirmOperation('Clear All Post Checkboxes',
  'This will uncheck all post checkboxes (Column J) in the current sheet. Continue?')) return;
```

**Site 5 — `createDailySheets`** (≈ line 530)
```js
// AFTER (1 line — also remove `const ui`):
if (!this._confirmOperation('Create All Daily Sheets (02-31)',
  'This will create sheets 02-31 using sheet 01 as a template and update all formulas.\n\nContinue?')) return;
```

**Site 6 — `createMissingSheets`** (≈ line 555)
```js
// AFTER (1 line — also remove `const ui`):
if (!this._confirmOperation('Create Missing Sheets Only',
  'This will create only missing daily sheets (02-31) that don\'t already exist.\n\nContinue?')) return;
```

**Site 7 — `organizeSheets`** (≈ line 580)
```js
// AFTER (1 line — also remove `const ui`):
if (!this._confirmOperation('Reorganize Sheets',
  'This will reorder all sheets to place daily sheets (01-31) first in numerical order.\n\nContinue?')) return;
```

**Site 8 — `fixDateFormulasOnly`** (≈ line 605)
```js
// AFTER (1 line — also remove `const ui`):
if (!this._confirmOperation('Fix Date Formulas Only',
  'This will update all date formulas in daily sheets (02-31) to correctly reference sheet 01.\n\nContinue?')) return;
```

**Site 9 — `resetInputCellsToZero`** (≈ line 631)
```js
// AFTER (1 line — also remove `const ui`):
if (!this._confirmOperation('Reset Current Sheet to Zero',
  `This will clear all transaction data from sheet "${sheet.getName()}" while preserving formulas and formatting.\n\nContinue?`)) return;
```

**Site 10 — `resetAllDailySheetsToZero`** (≈ line 661)
```js
// AFTER (1 line — also remove `const ui`):
if (!this._confirmOperation('Reset All Daily Sheets to Zero',
  'This will clear all transaction data from ALL daily sheets (01-31) while preserving formulas and formatting.\n\nWARNING: This cannot be undone. Continue?')) return;
```

**Site 11 — `_handleDeleteDailySheets`** (initial confirmation only, ≈ line 1342)
```js
// NOTE: _handleDeleteDailySheets still uses ui for other alerts — KEEP `const ui`.
// The _handleDeleteDailySheets function was already rewritten in Task 4 with an inline
// ui.alert for the first confirmation. Replace it now:
if (!this._confirmOperation('🗑️ DELETE DAILY SHEETS (SAFE MODE)',
  'This will delete ONLY daily transaction sheets (02-31).\n\nProtected sheets (01, InvoiceDatabase, etc.) will not be affected.\n\nContinue?')) return;
// And remove the `const response =` declaration that preceded it.
```

- [ ] **Step 3: Verify**

Search for `ui.alert(` in UIMenu.gs. It should now only appear:
- Inside `_confirmOperation` itself (1 occurrence)
- Inside `_handleDeleteDailySheets` for the "No sheets found" and "Deletion cancelled" alerts (2 occurrences — these are NOT confirmation dialogs, they have no YES/NO choice)
- Inside `batchValidateSelectedRows` and `batchPostSelectedRows` for the "Invalid Selection" alert (these are NOT confirmation dialogs)
- Inside `_validateDailySheet` for its error alert
- Inside `_showValidationResults` for the results dialog

All YES/NO confirmation patterns should be gone from call sites.

- [ ] **Step 4: Commit**

```
git add UIMenu.gs
git commit -m "refactor(UIMenu): extract _confirmOperation, replace 11 inline dialog blocks"
```

---

## Task 7: Extract `_toast` — Shorten All Toast Calls

**Files:**
- Modify: `UIMenu.gs` — PRIVATE UTILITIES section + all toast call sites

This task shortens the verbose `SpreadsheetApp.getActiveSpreadsheet().toast(...)` chain
to a single-line `this._toast(...)` call across the file.

- [ ] **Step 1: Add `_toast` to PRIVATE UTILITIES (before `_validateDailySheet`)**

```js
  /**
   * PRIVATE: Convenience wrapper for spreadsheet toast notifications.
   * @param {string} message - Toast body
   * @param {string} title   - Toast title
   * @param {number} [duration=3] - Display duration in seconds
   * @private
   */
  _toast: function(message, title, duration) {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, title, duration || 3);
  },
```

- [ ] **Step 2: Replace all `SpreadsheetApp.getActiveSpreadsheet().toast(...)` calls**

Do a global search for `SpreadsheetApp.getActiveSpreadsheet().toast(` in UIMenu.gs.
Replace **every** occurrence with `this._toast(`. Keep all arguments identical.

Example — single-line calls (no change to args):
```js
// BEFORE:
SpreadsheetApp.getActiveSpreadsheet().toast('Done.', 'Complete', 3);

// AFTER:
this._toast('Done.', 'Complete', 3);
```

Example — multi-line calls (collapse to one line if the arguments fit, or keep split):
```js
// BEFORE (3 lines):
SpreadsheetApp.getActiveSpreadsheet().toast(
  `Starting validation of ${numRows} rows...`,
  'Validating', 3
);

// AFTER (1 line):
this._toast(`Starting validation of ${numRows} rows...`, 'Validating', 3);
```

- [ ] **Step 3: Verify**

Search for `SpreadsheetApp.getActiveSpreadsheet().toast(` — zero results expected.
Search for `this._toast(` — should find approximately 13 occurrences.

- [ ] **Step 4: Commit**

```
git add UIMenu.gs
git commit -m "refactor(UIMenu): extract _toast helper, replace all getActiveSpreadsheet().toast() chains"
```

---

## Task 8: Final Reorganization Pass

**Files:**
- Modify: `UIMenu.gs` — section comment headers only

- [ ] **Step 1: Verify co-location of all new helpers**

Confirm this order in the file:
```
PRIVATE HANDLERS section
  _handleBatchValidation           ← orchestrator
    _initBatchValidationSetup      ← phase helper
    _runBatchValidationLoop        ← phase helper
  _handleBatchPosting              ← orchestrator
    _initBatchPostSetup            ← phase helper
    _runBatchPostLoop              ← phase helper
    _invalidateBatchCaches         ← phase helper
    _flushBatchStatusUpdates       ← phase helper
    _reportBatchPostResults        ← phase helper
  _handleClearCheckboxes
  _handleCreateDailySheets
  _handleCreateMissingSheets
  _handleOrganizeSheets
  _handleFixDateFormulas
  _handleResetCurrentSheet
  _handleResetAllSheets
  _handleQuickResetCurrentSheet
  _handleDeleteDailySheets         ← orchestrator
    _collectSheetsToDelete         ← helper
    _deleteSheetsWithFeedback      ← helper

PRIVATE UTILITIES section
  _confirmOperation                ← NEW
  _toast                           ← NEW
  _validateDailySheet
  _calculateProgressInterval
  _initBatchContext
  _buildDataObject
  _showValidationResults
    _buildValidationMessage        ← NEW (co-located)
  _shouldProcessPayment
  _createEmptyResults
  _createEmptyPostResults
  _clearSheetData
  _updateDateFormulas
  _getDayOffset
  _isDailySheet
  _organizeSheetOrder
```

- [ ] **Step 2: Update the PRIVATE HANDLERS section comment**

Find the decorative divider comment above the PRIVATE HANDLERS section and add one line:

```js
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * PRIVATE HANDLERS - Operation-Specific Logic
   * Each complex handler is an orchestrator followed by its co-located phase helpers.
   * ═══════════════════════════════════════════════════════════════════════════
   */
```

- [ ] **Step 3: Spot-check function sizes**

Scan the file and confirm no function exceeds 120 lines.
Expected largest functions after refactor:
- `_runBatchPostLoop` ≈ 70 lines
- `_initBatchPostSetup` ≈ 40 lines
- `_runBatchValidationLoop` ≈ 50 lines
- `_buildValidationMessage` ≈ 35 lines
- `createMenus` ≈ 52 lines (unchanged)

- [ ] **Step 4: Final commit**

```
git add UIMenu.gs
git commit -m "refactor(UIMenu): final reorganization pass, update section comments"
```

---

## Verification Checklist

Run after all 8 tasks are complete. No test runner — all checks are manual via Script Editor.

1. **Syntax:** Open `UIMenu.gs` in the Script Editor — confirm zero red underlines / parse errors.
2. **Header size:** Count lines 1 to closing `*/` — should be 38–42.
3. **Function size:** No function body exceeds 120 lines.
4. **DRY — confirm dialogs:** Search `ui.alert(` — only appears in `_confirmOperation`, `_validateDailySheet`, the two non-confirmation alerts in `_handleDeleteDailySheets`, and the selection-validation alerts in `batchValidateSelectedRows` / `batchPostSelectedRows`.
5. **DRY — toasts:** Search `getActiveSpreadsheet().toast(` — zero results.
6. **Smoke — batch validate:** Open a daily sheet with data rows → menu → Batch Validate All Rows → progress toast appears → results dialog shows correct counts.
7. **Smoke — batch post:** Run Batch Post All Rows on a test sheet → status columns update to POSTED, PaymentLog entry created, balance cell updated, completion toast shows duration.
8. **Smoke — delete sheets:** Run Delete Daily Sheets → first confirmation dialog appears → Cancel aborts with no changes.
9. **Smoke — confirm cancel:** Run Batch Post All Rows → click NO in the dialog → function exits with no changes to sheet.

---

## Constraints

- **Zero behavior changes** — control flow, side effects, error handling preserved exactly.
- **Preserve all non-obvious inline comments** — move them into the extracted helper where the code now lives.
- **No new abstractions** beyond the listed helpers.
- **Do not touch any file other than `UIMenu.gs`.**
