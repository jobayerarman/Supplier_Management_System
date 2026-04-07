/**
 * Test.UnpaidBatch.gs
 *
 * Unit tests for the Unpaid Batch Fast-Path helpers added in UIMenu.gs.
 * All four functions under test are pure JS (no Sheet API calls), so they
 * can be run directly against the live UIMenu object from the Script Editor.
 *
 * Run: call testUnpaidBatchFastPath() from the Script Editor Run menu.
 *
 * Helpers tested:
 *   _isAllUnpaidBatch(allData)
 *   _buildBalanceGrid(allData, startRow, numRows, pendingBalanceUpdates)
 *   _buildUnpaidStatusGrid(allData, startRow, numRows, pendingStatusUpdates)
 *   _applyUnpaidBatchBackgrounds(sheet, startRow, numRows, pendingStatusUpdates)
 */

// ═══════════════════════════════════════════════════════════════════════════
// MOCK SHEET — captures setBackground calls without touching any real sheet
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a minimal mock sheet whose getRange().setBackground() records calls.
 * Returns { sheet, calls } where calls is the array of recorded invocations.
 *
 * Each recorded call is: { row, col, numRows, numCols, color }
 */
function _buildMockSheet() {
  const calls = [];
  const sheet = {
    getRange: function(row, col, numRows, numCols) {
      return {
        setBackground: function(color) {
          calls.push({ row: row, col: col, numRows: numRows, numCols: numCols, color: color });
        }
      };
    }
  };
  return { sheet: sheet, calls: calls };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS — build allData rows in the shape getValues() returns
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a minimal allData row matching the daily-sheet column layout.
 * CONFIG.cols (0-based): supplier=1, paymentType=4, balance=7,
 *   post=9, status=10, enteredBy=11, timestamp=12, sysId=13
 * We use 14 columns (indices 0-13) to cover all referenced positions.
 */
function _buildAllDataRow(overrides) {
  // Default: a blank row
  const row = ['', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  if (overrides) {
    Object.keys(overrides).forEach(function(key) {
      row[parseInt(key, 10)] = overrides[key];
    });
  }
  return row;
}

// Column index shortcuts (mirrors CONFIG.cols)
var _COLS = {
  supplier:    1,
  paymentType: 4,
  balance:     7,
  post:        9,
  status:      10,
  enteredBy:   11,
  timestamp:   12,
  sysId:       13
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: _isAllUnpaidBatch
// ═══════════════════════════════════════════════════════════════════════════

function _testIsAllUnpaidBatch() {
  Logger.log('\n--- _isAllUnpaidBatch ---');

  // 1a. All rows Unpaid → true
  (function() {
    const allData = [
      _buildAllDataRow({ 1: 'SupplierA', 4: 'Unpaid' }),
      _buildAllDataRow({ 1: 'SupplierB', 4: 'Unpaid' }),
      _buildAllDataRow({ 1: 'SupplierC', 4: 'Unpaid' })
    ];
    const result = UIMenu._isAllUnpaidBatch(allData);
    InvoiceTestUtils.assertTrue(result === true,
      '_isAllUnpaidBatch: all-Unpaid batch returns true');
  })();

  // 1b. Mixed types (one Regular) → false
  (function() {
    const allData = [
      _buildAllDataRow({ 1: 'SupplierA', 4: 'Unpaid'  }),
      _buildAllDataRow({ 1: 'SupplierB', 4: 'Regular' }),
      _buildAllDataRow({ 1: 'SupplierC', 4: 'Unpaid'  })
    ];
    const result = UIMenu._isAllUnpaidBatch(allData);
    InvoiceTestUtils.assertTrue(result === false,
      '_isAllUnpaidBatch: mixed types returns false');
  })();

  // 1c. All rows empty (no supplier) → false (no data to post, don't take fast path)
  (function() {
    const allData = [
      _buildAllDataRow({}),
      _buildAllDataRow({})
    ];
    const result = UIMenu._isAllUnpaidBatch(allData);
    InvoiceTestUtils.assertTrue(result === false,
      '_isAllUnpaidBatch: all-empty rows returns false (avoid unnecessary lock + sheet fetch)');
  })();

  // 1d. Single Unpaid row → true
  (function() {
    const allData = [
      _buildAllDataRow({ 1: 'SupplierA', 4: 'Unpaid' })
    ];
    const result = UIMenu._isAllUnpaidBatch(allData);
    InvoiceTestUtils.assertTrue(result === true,
      '_isAllUnpaidBatch: single Unpaid row returns true');
  })();

  // 1e. Single non-Unpaid row → false
  (function() {
    const allData = [
      _buildAllDataRow({ 1: 'SupplierA', 4: 'Partial' })
    ];
    const result = UIMenu._isAllUnpaidBatch(allData);
    InvoiceTestUtils.assertTrue(result === false,
      '_isAllUnpaidBatch: single Partial row returns false');
  })();

  // 1f. Empty rows interspersed with Unpaid rows → true (empty rows skipped)
  (function() {
    const allData = [
      _buildAllDataRow({ 1: 'SupplierA', 4: 'Unpaid' }),
      _buildAllDataRow({}),
      _buildAllDataRow({ 1: 'SupplierB', 4: 'Unpaid' })
    ];
    const result = UIMenu._isAllUnpaidBatch(allData);
    InvoiceTestUtils.assertTrue(result === true,
      '_isAllUnpaidBatch: empty rows interspersed with Unpaid → true');
  })();

  // 1g. Partial payment type at position 0 → false immediately
  (function() {
    const allData = [
      _buildAllDataRow({ 1: 'SupplierA', 4: 'Due'    }),
      _buildAllDataRow({ 1: 'SupplierB', 4: 'Unpaid' })
    ];
    const result = UIMenu._isAllUnpaidBatch(allData);
    InvoiceTestUtils.assertTrue(result === false,
      '_isAllUnpaidBatch: Due at first position returns false');
  })();
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: _buildBalanceGrid
// ═══════════════════════════════════════════════════════════════════════════

function _testBuildBalanceGrid() {
  Logger.log('\n--- _buildBalanceGrid ---');

  const startRow = 7;

  // 2a. 3 rows; rows 0 and 2 posted, row 1 skipped (empty supplier / no update)
  (function() {
    const allData = [
      _buildAllDataRow({ 1: 'SupplierA', 7: 1000 }),  // row 7 — will be overwritten
      _buildAllDataRow({ 7: 500 }),                    // row 8 — skipped, original preserved
      _buildAllDataRow({ 1: 'SupplierC', 7: 750 })    // row 9 — will be overwritten
    ];
    const pendingBalanceUpdates = [
      { rowNum: 7, balance: 1200 },
      { rowNum: 9, balance: 300  }
    ];

    const grid = UIMenu._buildBalanceGrid(allData, startRow, 3, pendingBalanceUpdates);

    InvoiceTestUtils.assertEqual(grid.length, 3,
      '_buildBalanceGrid: result has 3 rows');
    InvoiceTestUtils.assertEqual(grid[0].length, 1,
      '_buildBalanceGrid: each row has 1 column');
    InvoiceTestUtils.assertEqual(grid[1].length, 1,
      '_buildBalanceGrid: skipped row has 1 column');

    InvoiceTestUtils.assertEqual(grid[0][0], 1200,
      '_buildBalanceGrid: row 0 (posted) has computed balance 1200');
    InvoiceTestUtils.assertEqual(grid[1][0], 500,
      '_buildBalanceGrid: row 1 (skipped) retains original balance 500');
    InvoiceTestUtils.assertEqual(grid[2][0], 300,
      '_buildBalanceGrid: row 2 (posted) has computed balance 300');
  })();

  // 2b. No updates at all → entire grid is original values
  (function() {
    const allData = [
      _buildAllDataRow({ 7: 100 }),
      _buildAllDataRow({ 7: 200 })
    ];
    const grid = UIMenu._buildBalanceGrid(allData, startRow, 2, []);

    InvoiceTestUtils.assertEqual(grid[0][0], 100,
      '_buildBalanceGrid: no updates preserves original value row 0');
    InvoiceTestUtils.assertEqual(grid[1][0], 200,
      '_buildBalanceGrid: no updates preserves original value row 1');
  })();

  // 2c. Single row posted
  (function() {
    const allData = [ _buildAllDataRow({ 7: 999 }) ];
    const grid = UIMenu._buildBalanceGrid(allData, startRow, 1, [{ rowNum: 7, balance: 42 }]);
    InvoiceTestUtils.assertEqual(grid[0][0], 42,
      '_buildBalanceGrid: single posted row has new balance');
  })();

  // 2d. Balance value of 0 is preserved (not falsy-ignored)
  (function() {
    const allData = [ _buildAllDataRow({ 7: 999 }) ];
    const grid = UIMenu._buildBalanceGrid(allData, startRow, 1, [{ rowNum: 7, balance: 0 }]);
    InvoiceTestUtils.assertEqual(grid[0][0], 0,
      '_buildBalanceGrid: balance of 0 is correctly written (not falsy-dropped)');
  })();
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: _buildUnpaidStatusGrid
// ═══════════════════════════════════════════════════════════════════════════

function _testBuildUnpaidStatusGrid() {
  Logger.log('\n--- _buildUnpaidStatusGrid ---');

  const startRow = 7;
  const fixedTime = new Date(2026, 3, 7, 10, 30, 0); // 2026-04-07 10:30:00

  // We need DateUtils.formatTime to produce a deterministic string.
  // Use the real implementation — it is available in the GAS runtime.

  // 3a. 3 rows: row 0 success (sysId present), row 1 error (sysId null → fallback),
  //             row 2 skipped (no update entry)
  (function() {
    const allData = [
      _buildAllDataRow({ 9: true,  10: 'POSTED',  11: 'old_user', 12: 'old_time', 13: 'SYS-OLD-1' }),
      _buildAllDataRow({ 9: false, 10: 'ERROR:x', 11: 'old_user', 12: 'old_time', 13: 'SYS-OLD-2' }),
      _buildAllDataRow({ 9: true,  10: 'POSTED',  11: 'old_user', 12: 'old_time', 13: 'SYS-OLD-3' })
    ];

    const pendingStatusUpdates = [
      {
        rowNum: 7, keepChecked: true, status: 'POSTED',
        user: 'alice', time: fixedTime, bgColor: '#d9ead3', sysId: 'SYS-NEW-1'
      },
      {
        rowNum: 8, keepChecked: false, status: 'ERROR: bad data',
        user: 'alice', time: fixedTime, bgColor: '#f4cccc', sysId: null   // null → fallback to allData
      }
      // row 9 (index 2) has no entry → pass-through from allData
    ];

    const grid = UIMenu._buildUnpaidStatusGrid(allData, startRow, 3, pendingStatusUpdates);

    // Shape checks
    InvoiceTestUtils.assertEqual(grid.length, 3,
      '_buildUnpaidStatusGrid: result has 3 rows');
    InvoiceTestUtils.assertEqual(grid[0].length, 5,
      '_buildUnpaidStatusGrid: each row has 5 columns');
    InvoiceTestUtils.assertEqual(grid[1].length, 5,
      '_buildUnpaidStatusGrid: error row has 5 columns');
    InvoiceTestUtils.assertEqual(grid[2].length, 5,
      '_buildUnpaidStatusGrid: skipped row has 5 columns');

    // Row 0 — success, new sysId
    InvoiceTestUtils.assertEqual(grid[0][0], true,
      '_buildUnpaidStatusGrid: success row keepChecked=true');
    InvoiceTestUtils.assertEqual(grid[0][1], 'POSTED',
      '_buildUnpaidStatusGrid: success row status=POSTED');
    InvoiceTestUtils.assertEqual(grid[0][2], 'alice',
      '_buildUnpaidStatusGrid: success row user=alice');
    InvoiceTestUtils.assertEqual(grid[0][4], 'SYS-NEW-1',
      '_buildUnpaidStatusGrid: success row sysId=SYS-NEW-1 (from update)');

    // Row 1 — error, sysId falls back to allData value
    InvoiceTestUtils.assertEqual(grid[1][0], false,
      '_buildUnpaidStatusGrid: error row keepChecked=false');
    InvoiceTestUtils.assertEqual(grid[1][1], 'ERROR: bad data',
      '_buildUnpaidStatusGrid: error row status=ERROR: bad data');
    InvoiceTestUtils.assertEqual(grid[1][4], 'SYS-OLD-2',
      '_buildUnpaidStatusGrid: error row sysId falls back to allData SYS-OLD-2');

    // Row 2 — skipped, entirely from allData
    InvoiceTestUtils.assertEqual(grid[2][0], true,
      '_buildUnpaidStatusGrid: skipped row post preserved from allData');
    InvoiceTestUtils.assertEqual(grid[2][1], 'POSTED',
      '_buildUnpaidStatusGrid: skipped row status preserved from allData');
    InvoiceTestUtils.assertEqual(grid[2][2], 'old_user',
      '_buildUnpaidStatusGrid: skipped row enteredBy preserved from allData');
    InvoiceTestUtils.assertEqual(grid[2][4], 'SYS-OLD-3',
      '_buildUnpaidStatusGrid: skipped row sysId preserved from allData');
  })();

  // 3b. All rows posted — verify no allData bleed-through
  (function() {
    const allData = [
      _buildAllDataRow({ 9: false, 10: '', 11: '', 12: '', 13: '' }),
      _buildAllDataRow({ 9: false, 10: '', 11: '', 12: '', 13: '' })
    ];
    const pendingStatusUpdates = [
      { rowNum: 7, keepChecked: true, status: 'POSTED', user: 'bob', time: fixedTime,
        bgColor: '#d9ead3', sysId: 'S1' },
      { rowNum: 8, keepChecked: true, status: 'POSTED', user: 'bob', time: fixedTime,
        bgColor: '#d9ead3', sysId: 'S2' }
    ];
    const grid = UIMenu._buildUnpaidStatusGrid(allData, startRow, 2, pendingStatusUpdates);
    InvoiceTestUtils.assertEqual(grid[0][4], 'S1',
      '_buildUnpaidStatusGrid: all-posted row 0 sysId=S1');
    InvoiceTestUtils.assertEqual(grid[1][4], 'S2',
      '_buildUnpaidStatusGrid: all-posted row 1 sysId=S2');
  })();
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: _applyUnpaidBatchBackgrounds
// ═══════════════════════════════════════════════════════════════════════════

function _testApplyUnpaidBatchBackgrounds() {
  Logger.log('\n--- _applyUnpaidBatchBackgrounds ---');

  const GREEN = '#d9ead3';
  const RED   = '#f4cccc';
  const startRow = 7;

  // 4a. 3 rows all green → 1 setBackground call (single contiguous group)
  (function() {
    const mock = _buildMockSheet();
    const pendingStatusUpdates = [
      { rowNum: 7, bgColor: GREEN },
      { rowNum: 8, bgColor: GREEN },
      { rowNum: 9, bgColor: GREEN }
    ];
    UIMenu._applyUnpaidBatchBackgrounds(mock.sheet, startRow, 3, pendingStatusUpdates);
    InvoiceTestUtils.assertEqual(mock.calls.length, 1,
      '_applyUnpaidBatchBackgrounds: 3 contiguous green rows → 1 setBackground call');
    InvoiceTestUtils.assertEqual(mock.calls[0].row, 7,
      '_applyUnpaidBatchBackgrounds: group starts at row 7');
    InvoiceTestUtils.assertEqual(mock.calls[0].numRows, 3,
      '_applyUnpaidBatchBackgrounds: group covers 3 rows');
    InvoiceTestUtils.assertEqual(mock.calls[0].color, GREEN,
      '_applyUnpaidBatchBackgrounds: group color is green');
  })();

  // 4b. 2 green + 1 red → 2 setBackground calls
  (function() {
    const mock = _buildMockSheet();
    const pendingStatusUpdates = [
      { rowNum: 7, bgColor: GREEN },
      { rowNum: 8, bgColor: GREEN },
      { rowNum: 9, bgColor: RED   }
    ];
    UIMenu._applyUnpaidBatchBackgrounds(mock.sheet, startRow, 3, pendingStatusUpdates);
    InvoiceTestUtils.assertEqual(mock.calls.length, 2,
      '_applyUnpaidBatchBackgrounds: 2 green + 1 red → 2 setBackground calls');
    InvoiceTestUtils.assertEqual(mock.calls[0].color, GREEN,
      '_applyUnpaidBatchBackgrounds: first call is green');
    InvoiceTestUtils.assertEqual(mock.calls[0].numRows, 2,
      '_applyUnpaidBatchBackgrounds: green group has 2 rows');
    InvoiceTestUtils.assertEqual(mock.calls[1].color, RED,
      '_applyUnpaidBatchBackgrounds: second call is red');
    InvoiceTestUtils.assertEqual(mock.calls[1].numRows, 1,
      '_applyUnpaidBatchBackgrounds: red group has 1 row');
  })();

  // 4c. Alternating green/red (3 rows) → 3 setBackground calls
  (function() {
    const mock = _buildMockSheet();
    const pendingStatusUpdates = [
      { rowNum: 7, bgColor: GREEN },
      { rowNum: 8, bgColor: RED   },
      { rowNum: 9, bgColor: GREEN }
    ];
    UIMenu._applyUnpaidBatchBackgrounds(mock.sheet, startRow, 3, pendingStatusUpdates);
    InvoiceTestUtils.assertEqual(mock.calls.length, 3,
      '_applyUnpaidBatchBackgrounds: alternating colors → 3 setBackground calls');
  })();

  // 4d. All rows skipped (no entries in pendingStatusUpdates) → 0 setBackground calls
  (function() {
    const mock = _buildMockSheet();
    UIMenu._applyUnpaidBatchBackgrounds(mock.sheet, startRow, 3, []);
    InvoiceTestUtils.assertEqual(mock.calls.length, 0,
      '_applyUnpaidBatchBackgrounds: no updates → 0 setBackground calls');
  })();

  // 4e. Rows with null bgColor (skipped rows mixed in) → only colored rows produce calls
  //     Layout: row 7=green, row 8=no entry (null), row 9=green
  //     Rows 7 and 9 are not contiguous in color-run terms (null breaks the run).
  (function() {
    const mock = _buildMockSheet();
    const pendingStatusUpdates = [
      { rowNum: 7, bgColor: GREEN },
      // row 8 has no entry → color resolves to null via updateMap.get(rowNum) ?? null
      { rowNum: 9, bgColor: GREEN }
    ];
    UIMenu._applyUnpaidBatchBackgrounds(mock.sheet, startRow, 3, pendingStatusUpdates);
    // rows 7 and 9 are the same color but separated by a null-color gap → 2 calls
    InvoiceTestUtils.assertEqual(mock.calls.length, 2,
      '_applyUnpaidBatchBackgrounds: same color separated by null gap → 2 setBackground calls');
    InvoiceTestUtils.assertEqual(mock.calls[0].row, 7,
      '_applyUnpaidBatchBackgrounds: first call covers row 7');
    InvoiceTestUtils.assertEqual(mock.calls[0].numRows, 1,
      '_applyUnpaidBatchBackgrounds: first call has numRows=1');
    InvoiceTestUtils.assertEqual(mock.calls[1].row, 9,
      '_applyUnpaidBatchBackgrounds: second call covers row 9');
  })();

  // 4f. Single row
  (function() {
    const mock = _buildMockSheet();
    const pendingStatusUpdates = [{ rowNum: 7, bgColor: GREEN }];
    UIMenu._applyUnpaidBatchBackgrounds(mock.sheet, startRow, 1, pendingStatusUpdates);
    InvoiceTestUtils.assertEqual(mock.calls.length, 1,
      '_applyUnpaidBatchBackgrounds: single row → 1 setBackground call');
    InvoiceTestUtils.assertEqual(mock.calls[0].numRows, 1,
      '_applyUnpaidBatchBackgrounds: single row call has numRows=1');
  })();
}

// ═══════════════════════════════════════════════════════════════════════════
// TOP-LEVEL RUNNER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run all Unpaid Batch Fast-Path tests.
 * Call this function from the Script Editor Run menu.
 */
function testUnpaidBatchFastPath() {
  InvoiceTestUtils.resetResults();

  Logger.log('');
  Logger.log('═'.repeat(80));
  Logger.log('TEST SUITE: Unpaid Batch Fast-Path');
  Logger.log('═'.repeat(80));

  _testIsAllUnpaidBatch();
  _testBuildBalanceGrid();
  _testBuildUnpaidStatusGrid();
  _testApplyUnpaidBatchBackgrounds();

  InvoiceTestUtils.printSummary('testUnpaidBatchFastPath');
}
