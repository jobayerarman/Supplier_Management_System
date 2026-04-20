// Unit tests for batch flush methods (Regular/Partial/Due deferred writes)
// Run from Script Editor: TestBatchFlush.runAll()

var TestBatchFlush = {

  runAll: function() {
    var results = [];
    // Invoice flush unit tests
    results.push(this.testFlushInvoices_emptyGuard());
    results.push(this.testFlushInvoices_success());
    results.push(this.testFlushInvoices_failure());
    // Payment flush unit tests
    results.push(this.testFlushPayments_emptyGuard());
    results.push(this.testFlushPayments_success());
    results.push(this.testFlushPayments_failure());
    // Helper method unit tests
    results.push(this.testMarkAllPendingAsFailed_flipsPostedOnly());
    results.push(this.testMarkAllPendingAsFailed_updatesCounters());
    results.push(this.testRunPaidDatePass_emptyGuard());
    results.push(this.testRunPaidDatePass_writesWhenBelowTolerance());
    results.push(this.testRunPaidDatePass_skipsWhenAboveTolerance());
    results.push(this.testRunPaidDatePass_continuesOnError());
    results.push(this.testRunBalancePass_deduplicatesSuppliers());
    results.push(this.testRunBalancePass_skipsNullBalance());

    var passed = results.filter(function(r) { return r.passed; }).length;
    Logger.log('TestBatchFlush: ' + passed + '/' + results.length + ' passed');
    results.forEach(function(r) {
      Logger.log((r.passed ? '  ✓' : '  ✗') + ' ' + r.name + (r.error ? ': ' + r.error : ''));
    });
    return results;
  },

  // flushPendingRegularInvoices — empty buffer guard
  testFlushInvoices_emptyGuard: function() {
    var name = 'flushPendingRegularInvoices: empty buffer returns success without writing';
    try {
      var sheetWritten = false;
      var ctx = {
        pendingInvoiceRows: [],
        invoiceFirstRow: null,
        invoiceSheet: { getRange: function() { sheetWritten = true; return { setValues: function() {} }; } }
      };
      var result = InvoiceManager.flushPendingRegularInvoices(ctx);
      if (!result.success) throw new Error('Expected success:true');
      if (result.failedCount !== 0) throw new Error('Expected failedCount:0');
      if (sheetWritten) throw new Error('Sheet should not be written for empty buffer');
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  },

  // flushPendingRegularInvoices — success path
  testFlushInvoices_success: function() {
    var name = 'flushPendingRegularInvoices: writes all rows in one setValues call';
    try {
      var capturedValues = null;
      var capturedRange = null;
      var fakeSheet = {
        getRange: function(row, col, numRows, numCols) {
          capturedRange = { row: row, col: col, numRows: numRows, numCols: numCols };
          return { setValues: function(vals) { capturedValues = vals; } };
        }
      };
      var rows = [
        ['2026-04-18', 'Supplier A', 'INV-001', 100],
        ['2026-04-18', 'Supplier B', 'INV-002', 200]
      ];
      var ctx = {
        pendingInvoiceRows: rows,
        invoiceFirstRow: 5,
        invoiceSheet: fakeSheet
      };
      var result = InvoiceManager.flushPendingRegularInvoices(ctx);
      if (!result.success) throw new Error('Expected success:true');
      if (result.failedCount !== 0) throw new Error('Expected failedCount:0');
      if (!capturedValues) throw new Error('setValues was not called');
      if (capturedRange.row !== 5) throw new Error('Wrong start row: ' + capturedRange.row);
      if (capturedRange.numRows !== 2) throw new Error('Wrong row count: ' + capturedRange.numRows);
      if (capturedRange.numCols !== 4) throw new Error('Wrong col count: ' + capturedRange.numCols);
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  },

  // flushPendingRegularInvoices — failure path
  testFlushInvoices_failure: function() {
    var name = 'flushPendingRegularInvoices: returns failedCount and does not rethrow on sheet error';
    try {
      var fakeSheet = {
        getRange: function() {
          return { setValues: function() { throw new Error('Simulated sheet write failure'); } };
        }
      };
      var rows = [['row1col1', 'row1col2'], ['row2col1', 'row2col2']];
      var ctx = {
        pendingInvoiceRows: rows,
        invoiceFirstRow: 10,
        invoiceSheet: fakeSheet
      };
      var result = InvoiceManager.flushPendingRegularInvoices(ctx);
      if (result.success) throw new Error('Expected success:false on sheet error');
      if (result.failedCount !== 2) throw new Error('Expected failedCount:2, got ' + result.failedCount);
      if (!result.error) throw new Error('Expected error string in result');
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  },

  // flushPendingPaymentRows — empty buffer guard
  testFlushPayments_emptyGuard: function() {
    var name = 'flushPendingPaymentRows: empty buffer returns success without writing';
    try {
      var sheetWritten = false;
      var ctx = {
        pendingPaymentRows: [],
        paymentFirstRow: null,
        paymentSheet: { getRange: function() { sheetWritten = true; return { setValues: function() {} }; } }
      };
      var result = PaymentManager.flushPendingPaymentRows(ctx);
      if (!result.success) throw new Error('Expected success:true');
      if (result.failedCount !== 0) throw new Error('Expected failedCount:0');
      if (sheetWritten) throw new Error('Sheet should not be written for empty buffer');
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  },

  // flushPendingPaymentRows — success path
  testFlushPayments_success: function() {
    var name = 'flushPendingPaymentRows: writes all rows in one setValues call';
    try {
      var capturedValues = null;
      var capturedRange = null;
      var fakeSheet = {
        getRange: function(row, col, numRows, numCols) {
          capturedRange = { row: row, col: col, numRows: numRows, numCols: numCols };
          return { setValues: function(vals) { capturedValues = vals; } };
        }
      };
      var rows = [
        ['2026-04-18', 'Supplier A', 'INV-001', 'Regular', 100],
        ['2026-04-18', 'Supplier B', 'INV-002', 'Due',     200]
      ];
      var ctx = {
        pendingPaymentRows: rows,
        paymentFirstRow: 8,
        paymentSheet: fakeSheet
      };
      var result = PaymentManager.flushPendingPaymentRows(ctx);
      if (!result.success) throw new Error('Expected success:true');
      if (result.failedCount !== 0) throw new Error('Expected failedCount:0');
      if (!capturedValues) throw new Error('setValues was not called');
      if (capturedRange.row !== 8) throw new Error('Wrong start row: ' + capturedRange.row);
      if (capturedRange.numRows !== 2) throw new Error('Wrong row count: ' + capturedRange.numRows);
      if (capturedRange.numCols !== 5) throw new Error('Wrong col count: ' + capturedRange.numCols);
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  },

  // flushPendingPaymentRows — failure path
  testFlushPayments_failure: function() {
    var name = 'flushPendingPaymentRows: returns failedCount and does not rethrow on sheet error';
    try {
      var fakeSheet = {
        getRange: function() {
          return { setValues: function() { throw new Error('Simulated sheet write failure'); } };
        }
      };
      var rows = [['col1', 'col2'], ['col3', 'col4'], ['col5', 'col6']];
      var ctx = {
        pendingPaymentRows: rows,
        paymentFirstRow: 15,
        paymentSheet: fakeSheet
      };
      var result = PaymentManager.flushPendingPaymentRows(ctx);
      if (result.success) throw new Error('Expected success:false on sheet error');
      if (result.failedCount !== 3) throw new Error('Expected failedCount:3, got ' + result.failedCount);
      if (!result.error) throw new Error('Expected error string in result');
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  },

  // _markAllPendingAsFailed — only flips POSTED entries
  testMarkAllPendingAsFailed_flipsPostedOnly: function() {
    var name = '_markAllPendingAsFailed: flips POSTED entries only, leaves ERROR unchanged';
    try {
      var context = {
        results: { posted: 3, failed: 1 },
        pendingStatusUpdates: [
          { status: 'POSTED',       bgColor: 'green', keepChecked: true },
          { status: 'ERROR: bad',   bgColor: 'red',   keepChecked: false },
          { status: 'POSTED',       bgColor: 'green', keepChecked: true }
        ]
      };
      UIMenu._markAllPendingAsFailed(context, { failedCount: 2 });
      var e0 = context.pendingStatusUpdates[0];
      var e1 = context.pendingStatusUpdates[1];
      var e2 = context.pendingStatusUpdates[2];
      if (e0.status !== 'FAILED') throw new Error('Entry 0 not flipped: ' + e0.status);
      if (e0.keepChecked !== false) throw new Error('Entry 0 keepChecked not false');
      if (e1.status !== 'ERROR: bad') throw new Error('Entry 1 (ERROR) should not change');
      if (e2.status !== 'FAILED') throw new Error('Entry 2 not flipped: ' + e2.status);
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  },

  // _markAllPendingAsFailed — updates results counters
  testMarkAllPendingAsFailed_updatesCounters: function() {
    var name = '_markAllPendingAsFailed: decrements posted, increments failed by flipped count';
    try {
      var context = {
        results: { posted: 5, failed: 0 },
        pendingStatusUpdates: [
          { status: 'POSTED', bgColor: 'green', keepChecked: true },
          { status: 'POSTED', bgColor: 'green', keepChecked: true },
          { status: 'POSTED', bgColor: 'green', keepChecked: true }
        ]
      };
      UIMenu._markAllPendingAsFailed(context, { failedCount: 3 });
      if (context.results.posted !== 2) throw new Error('Expected posted:2, got ' + context.results.posted);
      if (context.results.failed !== 3) throw new Error('Expected failed:3, got ' + context.results.failed);
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  },

  // _runPaidDatePass — empty guard
  testRunPaidDatePass_emptyGuard: function() {
    var name = '_runPaidDatePass: returns early when pendingPaidDateChecks is empty';
    try {
      var sheetAccessed = false;
      var batchCtx = {
        pendingPaidDateChecks: [],
        invoiceSheet: { getRange: function() { sheetAccessed = true; return { getValue: function() { return 0; }, setValue: function() {} }; } }
      };
      UIMenu._runPaidDatePass(batchCtx);
      if (sheetAccessed) throw new Error('Sheet should not be accessed for empty checks');
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  },

  // _runPaidDatePass — writes paidDate for Due entry when balance below tolerance
  testRunPaidDatePass_writesWhenBelowTolerance: function() {
    var name = '_runPaidDatePass: writes paidDate when Due balance < BALANCE_TOLERANCE';
    try {
      var paidDateWritten = false;
      var balanceReadRow  = null;
      var fakeSheet = {
        getRange: function(row, col, height, width) {
          balanceReadRow = row;
          return {
            getValues: function() { return [[0.005]]; },  // single-row window, below tolerance
            setValues: function(v) { paidDateWritten = true; }
          };
        }
      };
      var batchCtx = {
        pendingPaidDateChecks: [
          { invoiceRow: 12, invoiceNo: 'INV-001', supplier: 'SupA',
            paymentDate: new Date(), paymentType: 'Due' }
        ],
        invoiceSheet: fakeSheet
      };
      UIMenu._runPaidDatePass(batchCtx);
      if (!paidDateWritten) throw new Error('paidDate should have been written for Due balance 0.005');
      if (balanceReadRow !== 12) throw new Error('Balance read from wrong row: ' + balanceReadRow);
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  },

  // _runPaidDatePass — skips Due entry when balance above tolerance
  testRunPaidDatePass_skipsWhenAboveTolerance: function() {
    var name = '_runPaidDatePass: skips paidDate write when Due balance >= BALANCE_TOLERANCE';
    try {
      var paidDateWritten = false;
      var fakeSheet = {
        getRange: function(row, col, height, width) {
          return {
            getValues: function() { return [[50.00]]; },
            setValues: function(v) { paidDateWritten = true; }
          };
        }
      };
      var batchCtx = {
        pendingPaidDateChecks: [
          { invoiceRow: 7, invoiceNo: 'INV-002', supplier: 'SupB',
            paymentDate: new Date(), paymentType: 'Due' }
        ],
        invoiceSheet: fakeSheet
      };
      UIMenu._runPaidDatePass(batchCtx);
      if (paidDateWritten) throw new Error('paidDate should NOT be written when balance is 50.00');
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  },

  // _runPaidDatePass — continues on per-entry balance window error, writes qualifying entry
  testRunPaidDatePass_continuesOnError: function() {
    var name = '_runPaidDatePass: continues processing after per-entry balance parse error';
    try {
      var successWritten = false;
      var balanceCol = CONFIG.invoiceCols.balanceDue + 1;
      var paidDateCol = CONFIG.invoiceCols.paidDate  + 1;
      // Two Due entries: rows 5 and 9. Window spans rows 5-9 (height 5).
      // Index 0 (row 5) = null → balanceWindow[0][0] throws TypeError → per-entry catch fires.
      // Index 4 (row 9) = [0]  → qualifies → paidDate written.
      var fakeSheet = {
        getRange: function(row, col, height, width) {
          if (col === balanceCol) {
            return { getValues: function() { return [null, [0], [0], [0], [0]]; } };
          }
          return { setValues: function(v) { successWritten = true; } };
        }
      };
      var batchCtx = {
        pendingPaidDateChecks: [
          { invoiceRow: 5, invoiceNo: 'INV-ERR', supplier: 'SupErr',
            paymentDate: new Date(), paymentType: 'Due' },
          { invoiceRow: 9, invoiceNo: 'INV-OK',  supplier: 'SupOK',
            paymentDate: new Date(), paymentType: 'Due' }
        ],
        invoiceSheet: fakeSheet
      };
      UIMenu._runPaidDatePass(batchCtx);
      if (!successWritten) throw new Error('Second entry paidDate should have been written');
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  },

  // _runBalancePass — deduplicates suppliers
  testRunBalancePass_deduplicatesSuppliers: function() {
    var name = '_runBalancePass: calls getSupplierOutstanding once per unique supplier';
    try {
      var callsBySupplier = {};
      var origFn = BalanceCalculator.getSupplierOutstanding;
      BalanceCalculator.getSupplierOutstanding = function(supplier) {
        callsBySupplier[supplier] = (callsBySupplier[supplier] || 0) + 1;
        return 100;
      };
      try {
        var context = {
          pendingBalanceRows: [
            { rowNum: 1, supplier: 'SupA' },
            { rowNum: 2, supplier: 'SupB' },
            { rowNum: 3, supplier: 'SupA' }   // duplicate SupA
          ],
          pendingBalanceUpdates: []
        };
        UIMenu._runBalancePass(context);
        if (callsBySupplier['SupA'] !== 1) throw new Error('SupA called ' + callsBySupplier['SupA'] + ' times, expected 1');
        if (callsBySupplier['SupB'] !== 1) throw new Error('SupB called ' + callsBySupplier['SupB'] + ' times, expected 1');
        if (context.pendingBalanceUpdates.length !== 3) throw new Error('Expected 3 balance updates, got ' + context.pendingBalanceUpdates.length);
      } finally {
        BalanceCalculator.getSupplierOutstanding = origFn;
      }
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  },

  // _runBalancePass — skips null balance from failed lookup
  testRunBalancePass_skipsNullBalance: function() {
    var name = '_runBalancePass: skips pendingBalanceUpdates push when supplier lookup fails';
    try {
      var origFn = BalanceCalculator.getSupplierOutstanding;
      BalanceCalculator.getSupplierOutstanding = function(supplier) {
        if (supplier === 'BadSup') throw new Error('Lookup failed');
        return 250;
      };
      try {
        var context = {
          pendingBalanceRows: [
            { rowNum: 1, supplier: 'GoodSup' },
            { rowNum: 2, supplier: 'BadSup'  }
          ],
          pendingBalanceUpdates: []
        };
        UIMenu._runBalancePass(context);
        if (context.pendingBalanceUpdates.length !== 1) throw new Error('Expected 1 update (BadSup skipped), got ' + context.pendingBalanceUpdates.length);
        if (context.pendingBalanceUpdates[0].rowNum !== 1) throw new Error('Wrong rowNum in update');
        if (context.pendingBalanceUpdates[0].balance !== 250) throw new Error('Wrong balance in update');
      } finally {
        BalanceCalculator.getSupplierOutstanding = origFn;
      }
      return { passed: true, name: name };
    } catch(e) { return { passed: false, name: name, error: e.toString() }; }
  }

};
