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
  // Second run must find zero qualifying rows and no failures
  const pass  = r2.regularPartial === 0 && r2.due === 0 && r2.failed === 0;
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
