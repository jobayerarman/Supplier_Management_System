// Unit tests for batch flush methods (Regular/Partial/Due deferred writes)
// Run from Script Editor: TestBatchFlush.runAll()

var TestBatchFlush = {

  runAll: function() {
    var results = [];
    results.push(this.testFlushInvoices_emptyGuard());
    results.push(this.testFlushInvoices_success());
    results.push(this.testFlushInvoices_failure());

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
  }

};
