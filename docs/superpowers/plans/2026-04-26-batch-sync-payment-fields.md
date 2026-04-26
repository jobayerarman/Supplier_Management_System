# Batch Sync Payment Fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `🔄 Batch Sync Payment Fields` menu action that populates cols F (prevInvoice) and G (paymentAmt) for all unprocessed IMPORTRANGE-populated rows on the active daily sheet, using a single `setValues()` write for Regular/Partial rows and per-row `buildDuePaymentDropdown()` for Due rows.

**Architecture:** A new `UIMenuBatchSync` object in `UIMenu.BatchSync.gs` owns the bulk read → partition → batch write → per-row Due dropdowns → balance update flow. `UIMenu.gs` gets a global wrapper, a UIMenu method, and a new first menu item in `📋 FP - Operations`. A `Test.BatchSync.gs` file provides manual test helpers runnable from Script Editor.

**Tech Stack:** Google Apps Script (V8 runtime), SpreadsheetApp, existing CONFIG / BalanceCalculator / InvoiceManager / AuditLogger / UIUtils

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `UIMenu.BatchSync.gs` | **Create** | `UIMenuBatchSync` object: core batch logic + results dialog |
| `UIMenu.gs` | **Modify** | Global wrapper function, UIMenu method, first menu item |
| `Test.BatchSync.gs` | **Create** | Manual test helpers: happy path, empty sheet, idempotency |

---

## Key Constants (from _Config.gs)

```
CONFIG.cols.supplier    = 1   (col B, 0-based)
CONFIG.cols.invoiceNo   = 2   (col C, 0-based)
CONFIG.cols.receivedAmt = 3   (col D, 0-based)
CONFIG.cols.paymentType = 4   (col E, 0-based)
CONFIG.cols.prevInvoice = 5   (col F, 0-based)
CONFIG.cols.paymentAmt  = 6   (col G, 0-based)
CONFIG.dataStartRow     = 7
CONFIG.totalColumns.daily = 14
CONFIG.colors.warning   = '#FFF4E6'
```

Sheet ranges use 1-based columns: `cols.prevInvoice + 1 = 6`, `cols.paymentAmt + 1 = 7`.

---

### Task 1: Create UIMenu.BatchSync.gs

**Files:**
- Create: `UIMenu.BatchSync.gs`

- [ ] **Step 1: Create UIMenu.BatchSync.gs**

Create `UIMenu.BatchSync.gs` in the project root with this exact content:

```javascript
var UIMenuBatchSync = {

  handleBatchSync: function(sheet) {
    const cols         = CONFIG.cols;
    const firstDataRow = CONFIG.dataStartRow;
    const lastRow      = sheet.getLastRow();

    if (lastRow < firstDataRow) {
      return { regularPartial: 0, due: 0, skipped: 0, failed: 0 };
    }

    const numDataRows = lastRow - firstDataRow + 1;
    const allValues   = sheet
      .getRange(firstDataRow, 1, numDataRows, CONFIG.totalColumns.daily)
      .getValues();

    const regularPartialRows = [];
    const dueRows            = [];
    let   skipped            = 0;

    for (let i = 0; i < allValues.length; i++) {
      const row         = allValues[i];
      const paymentType = row[cols.paymentType];
      const paymentAmt  = row[cols.paymentAmt];
      const prevInvoice = row[cols.prevInvoice];

      // Skip rows with no payment type, or already processed (either field populated)
      if (!paymentType || paymentType === '') continue;
      if (paymentAmt  !== '' && paymentAmt  !== null) continue;
      if (prevInvoice !== '' && prevInvoice !== null) continue;

      const invoiceNo   = row[cols.invoiceNo];
      const receivedAmt = row[cols.receivedAmt];
      const supplier    = row[cols.supplier];

      if (paymentType === 'Regular' || paymentType === 'Partial') {
        // IMPORTRANGE hasn't finished loading yet — skip
        if (!invoiceNo || invoiceNo === '' || !receivedAmt || receivedAmt === '') {
          skipped++;
          continue;
        }
        regularPartialRows.push({
          i:           i,
          paymentType: paymentType,
          invoiceNo:   invoiceNo,
          receivedAmt: receivedAmt,
          rowValues:   row.slice()
        });
      } else if (paymentType === 'Due') {
        if (!supplier || String(supplier).trim() === '') {
          skipped++;
          continue;
        }
        dueRows.push({
          i:         i,
          supplier:  supplier,
          rowValues: row.slice()
        });
      }
    }

    let failed = 0;

    // ── Regular / Partial ── single setValues for cols F+G ──────────────────
    if (regularPartialRows.length > 0) {
      // Build full-height write array; non-qualifying rows keep existing values
      const writeArray = allValues.map(row => [row[cols.prevInvoice], row[cols.paymentAmt]]);
      for (const r of regularPartialRows) {
        writeArray[r.i][0] = r.invoiceNo;
        writeArray[r.i][1] = r.receivedAmt;
      }
      sheet
        .getRange(firstDataRow, cols.prevInvoice + 1, numDataRows, 2)
        .setValues(writeArray);

      // Partial background + balance update (per row — small N)
      for (const r of regularPartialRows) {
        try {
          if (r.paymentType === 'Partial') {
            sheet.getRange(firstDataRow + r.i, cols.paymentAmt + 1)
              .setBackground(CONFIG.colors.warning);
          }
          r.rowValues[cols.prevInvoice] = r.invoiceNo;
          r.rowValues[cols.paymentAmt]  = r.receivedAmt;
          BalanceCalculator.updateBalanceCell(sheet, firstDataRow + r.i, false, r.rowValues);
        } catch (err) {
          AuditLogger.logError('batchSyncPaymentFields',
            'Row ' + (firstDataRow + r.i) + ': ' + err.toString());
          failed++;
        }
      }
    }

    // ── Due ── per-row dropdown (cannot be batched) ─────────────────────────
    for (const d of dueRows) {
      try {
        InvoiceManager.buildDuePaymentDropdown(
          sheet,
          firstDataRow + d.i,
          d.supplier,
          'Due',
          d.rowValues[cols.prevInvoice]
        );
      } catch (err) {
        AuditLogger.logError('batchSyncPaymentFields',
          'Row ' + (firstDataRow + d.i) + ': ' + err.toString());
        failed++;
      }
    }

    return {
      regularPartial: regularPartialRows.length,
      due:            dueRows.length,
      skipped:        skipped,
      failed:         failed
    };
  },

  _showSyncResults: function(results) {
    const ui    = SpreadsheetApp.getUi();
    const lines = [
      '✅ Regular/Partial populated:  ' + results.regularPartial,
      '🔄 Due dropdowns built:        ' + results.due,
      '⚠️  Skipped (incomplete data): ' + results.skipped,
      '❌ Errors:                      ' + results.failed
    ];
    ui.alert('Payment Fields Synced', lines.join('\n'), ui.ButtonSet.OK);
  }

};
```

- [ ] **Step 2: Verify syntax in Script Editor**

Open the Script Editor (Extensions → Apps Script). `UIMenu.BatchSync.gs` should appear in the Files panel. Click it — confirm no red syntax errors in the gutter.

- [ ] **Step 3: Commit**

```bash
git add UIMenu.BatchSync.gs
git commit -m "feat(UIMenuBatchSync): add batch sync payment fields core logic"
```

---

### Task 2: Create Test.BatchSync.gs

**Files:**
- Create: `Test.BatchSync.gs`

- [ ] **Step 1: Create Test.BatchSync.gs**

Create `Test.BatchSync.gs` in the project root:

```javascript
// Run each function from the Script Editor function dropdown.

function testBatchSync_happyPath() {
  const sheet   = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const results = UIMenuBatchSync.handleBatchSync(sheet);
  Logger.log('regularPartial=' + results.regularPartial +
             ' due=' + results.due +
             ' skipped=' + results.skipped +
             ' failed=' + results.failed);
  SpreadsheetApp.getUi().alert(
    'testBatchSync_happyPath',
    'regularPartial: ' + results.regularPartial +
    '\ndue: '           + results.due            +
    '\nskipped: '       + results.skipped        +
    '\nfailed: '        + results.failed,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function testBatchSync_emptySheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getLastRow() >= CONFIG.dataStartRow) {
    SpreadsheetApp.getUi().alert('testBatchSync_emptySheet',
      'Navigate to an empty daily sheet first, then re-run.',
      SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  const results = UIMenuBatchSync.handleBatchSync(sheet);
  const pass = results.regularPartial === 0 && results.due === 0 &&
               results.skipped === 0        && results.failed === 0;
  Logger.log((pass ? 'PASS' : 'FAIL') + ' ' + JSON.stringify(results));
  SpreadsheetApp.getUi().alert('testBatchSync_emptySheet',
    pass ? 'PASS' : ('FAIL: ' + JSON.stringify(results)),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function testBatchSync_idempotent() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const r1    = UIMenuBatchSync.handleBatchSync(sheet);
  const r2    = UIMenuBatchSync.handleBatchSync(sheet);
  // Second run must find zero qualifying rows — all already processed
  const pass  = r2.regularPartial === 0 && r2.due === 0;
  Logger.log('run1=' + JSON.stringify(r1));
  Logger.log('run2=' + JSON.stringify(r2));
  SpreadsheetApp.getUi().alert(
    'testBatchSync_idempotent',
    (pass ? 'PASS' : 'FAIL') +
    '\nRun1: rp=' + r1.regularPartial + ' due=' + r1.due +
    '\nRun2: rp=' + r2.regularPartial + ' due=' + r2.due,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
```

- [ ] **Step 2: Run testBatchSync_emptySheet**

Navigate to an empty daily sheet. In Script Editor, select `testBatchSync_emptySheet` and click Run.

Expected: Alert shows **PASS**.

- [ ] **Step 3: Commit**

```bash
git add Test.BatchSync.gs
git commit -m "test(BatchSync): add manual test helpers for batch sync"
```

---

### Task 3: Modify UIMenu.gs

**Files:**
- Modify: `UIMenu.gs`

- [ ] **Step 1: Add global wrapper function**

In `UIMenu.gs`, find the global wrapper functions near the top. Insert `batchSyncPaymentFields` immediately before `batchValidateAllRows`:

Find:
```javascript
function batchValidateAllRows() {
  UIMenu.batchValidateAllRows();
}
```

Replace with:
```javascript
function batchSyncPaymentFields() {
  UIMenu.batchSyncPaymentFields();
}

function batchValidateAllRows() {
  UIMenu.batchValidateAllRows();
}
```

- [ ] **Step 2: Add batchSyncPaymentFields method to UIMenu object**

In `UIMenu.gs`, find the `batchValidateAllRows` method on the UIMenu object. Insert `batchSyncPaymentFields` immediately before it:

Find:
```javascript
  batchValidateAllRows: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    if (!this._validateDailySheet(sheet)) return;
    if (!UIUtils.confirmOperation('Batch Validate All Rows',
      'This will validate all rows in the current sheet. Continue?')) return;
    const results = UIMenuBatchPosting.handleBatchValidation(sheet);
    UIMenuBatchPosting.showValidationResults(results, false);
  },
```

Replace with:
```javascript
  batchSyncPaymentFields: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    if (!this._validateDailySheet(sheet)) return;
    if (!UIUtils.confirmOperation('Batch Sync Payment Fields',
      'This will populate payment fields for all unprocessed rows on this sheet.\n\nContinue?')) return;
    const results = UIMenuBatchSync.handleBatchSync(sheet);
    UIMenuBatchSync._showSyncResults(results);
  },

  batchValidateAllRows: function() {
    const sheet = SpreadsheetApp.getActiveSheet();
    if (!this._validateDailySheet(sheet)) return;
    if (!UIUtils.confirmOperation('Batch Validate All Rows',
      'This will validate all rows in the current sheet. Continue?')) return;
    const results = UIMenuBatchPosting.handleBatchValidation(sheet);
    UIMenuBatchPosting.showValidationResults(results, false);
  },
```

- [ ] **Step 3: Add menu item as first entry in createMenus()**

Find:
```javascript
  ui.createMenu('📋 FP - Operations')

    // ═══ DAILY ═══
    .addItem('✅ Validate Selected Rows', 'batchValidateSelectedRows')
```

Replace with:
```javascript
  ui.createMenu('📋 FP - Operations')
    .addItem('🔄 Batch Sync Payment Fields', 'batchSyncPaymentFields')

    // ═══ DAILY ═══
    .addItem('✅ Validate Selected Rows', 'batchValidateSelectedRows')
```

- [ ] **Step 4: Reload menu and confirm order**

In Script Editor, run `onOpen()` manually (or close and reopen the spreadsheet). Open `📋 FP - Operations` and confirm:

```
🔄 Batch Sync Payment Fields    ← first item
✅ Validate Selected Rows
📤 Post Selected Rows
────────────────────────────────
✅ Batch Validate All Rows
📤 Batch Post All Valid Rows
...
```

- [ ] **Step 5: Run testBatchSync_happyPath**

Navigate to a daily sheet that has IMPORTRANGE-populated rows (col E filled, cols F+G blank). Select `testBatchSync_happyPath` in Script Editor and click Run.

Expected:
- `regularPartial` > 0 if Regular/Partial rows were present → cols F+G now populated
- `due` > 0 if Due rows were present → col F has dropdown of unpaid invoices
- `failed` = 0

Verify manually in the sheet: Regular rows get col F = col C value, col G = col D value, no yellow background. Partial rows get the same plus col G background = `#FFF4E6` (warning yellow). Due rows get a data-validation dropdown in col F.

- [ ] **Step 6: Run testBatchSync_idempotent**

On the same now-processed sheet, run `testBatchSync_idempotent`.

Expected: Alert shows **PASS** — second run processes 0 rows because all qualifying rows were already populated in step 5.

- [ ] **Step 7: Test via the actual menu**

On a fresh daily sheet with unprocessed IMPORTRANGE rows, use the menu: `📋 FP - Operations → 🔄 Batch Sync Payment Fields`. Dismiss the confirmation dialog → confirm. Verify the summary dialog shows correct counts and cells are populated as in Step 5.

- [ ] **Step 8: Commit**

```bash
git add UIMenu.gs
git commit -m "feat(UIMenu): add Batch Sync Payment Fields menu item and method"
```

---

## Spec Coverage Check

| Spec Requirement | Covered In |
|-----------------|------------|
| Menu item first in FP-Operations (sync→validate→post) | Task 3, Step 3 |
| Only rows: paymentType set + paymentAmt blank + prevInvoice blank | Task 1, Step 1 — filter loop |
| Skip rows where invoiceNo/receivedAmt not loaded (IMPORTRANGE pending) | Task 1, Step 1 — `skipped++` branch |
| Single `setValues()` for Regular/Partial writing F+G | Task 1, Step 1 — `writeArray` + `setValues` |
| Partial background = `CONFIG.colors.warning` on col G | Task 1, Step 1 — `setBackground` inside loop |
| Per-row `buildDuePaymentDropdown` for Due rows | Task 1, Step 1 — `dueRows` loop |
| `updateBalanceCell` after Regular/Partial write (matches manual trigger) | Task 1, Step 1 — `BalanceCalculator` call |
| Row-level error isolation + AuditLogger | Task 1, Step 1 — try/catch + `logError` |
| Sheet guard (`_validateDailySheet`) | Task 3, Step 2 |
| Confirmation dialog | Task 3, Step 2 |
| Summary dialog with all four counts | Task 1, Step 1 — `_showSyncResults` |
| Test: empty sheet → all zeros | Task 2, Step 2 |
| Test: second run processes 0 rows (idempotent) | Task 3, Step 6 |
