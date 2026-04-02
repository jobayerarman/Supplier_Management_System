// @ts-nocheck
// ==================== MODULE: Test.AuditLogger.gs ====================
/**
 * Tests for AuditLogger module
 * Run from Script Editor: select runAllAuditLoggerTests → Run → View Logs
 */

function runAllAuditLoggerTests() {
  const results = { passed: 0, failed: 0, errors: [] };
  Logger.log('═'.repeat(60));
  Logger.log('AUDIT LOGGER TEST SUITE');
  Logger.log('═'.repeat(60));

  testAuditLogger_SanitizeDetails(results);
  testAuditLogger_ImmediateWrite(results);
  testAuditLogger_LogFiltersBySideEffect(results);

  const passRate = results.passed + results.failed > 0
    ? ((results.passed / (results.passed + results.failed)) * 100).toFixed(1)
    : 0;

  Logger.log('═'.repeat(60));
  Logger.log(`✅ Passed: ${results.passed}`);
  Logger.log(`❌ Failed: ${results.failed}`);
  Logger.log(`Pass Rate: ${passRate}%`);
  if (results.errors.length > 0) {
    Logger.log('Errors: ' + results.errors.join('; '));
  }
}

function _alPass(results, msg) { Logger.log(`  ✅ PASS: ${msg}`); results.passed++; }
function _alFail(results, msg) { Logger.log(`  ❌ FAIL: ${msg}`); results.failed++; results.errors.push(msg); }

/**
 * Test: _sanitizeDetails returns a proper JSON string, not a literal placeholder.
 */
function testAuditLogger_SanitizeDetails(results) {
  Logger.log('\n--- testAuditLogger_SanitizeDetails ---');

  const validData = {
    supplier: 'Test Supplier',
    invoiceNo: 'INV-001',
    prevInvoice: 'INV-000',
    receivedAmt: 1000,
    paymentAmt: 500,
    paymentType: 'Partial',
    sysId: 'inv_abc123'
  };

  const result = AuditLogger._sanitizeDetails(validData);

  if (typeof result !== 'string') {
    _alFail(results, '_sanitizeDetails should return a string');
    return;
  }
  _alPass(results, '_sanitizeDetails returns a string');

  try {
    const parsed = JSON.parse(result);
    _alPass(results, '_sanitizeDetails returns valid JSON');
    if (parsed.supplier === 'Test Supplier') {
      _alPass(results, '_sanitizeDetails preserves supplier field');
    } else {
      _alFail(results, `_sanitizeDetails supplier mismatch: got "${parsed.supplier}"`);
    }
    if (parsed.receivedAmt === 1000) {
      _alPass(results, '_sanitizeDetails preserves receivedAmt field');
    } else {
      _alFail(results, `_sanitizeDetails receivedAmt mismatch: got "${parsed.receivedAmt}"`);
    }
  } catch (e) {
    _alFail(results, `_sanitizeDetails returned invalid JSON: ${result}`);
  }

  // Error case must NOT return literal "${error.message}" string
  const circularData = {};
  circularData.self = circularData; // circular reference forces JSON.stringify to throw

  const errorResult = AuditLogger._sanitizeDetails(circularData);
  const errorStr = typeof errorResult === 'string' ? errorResult : JSON.stringify(errorResult);
  if (errorStr.includes('${error.message}')) {
    _alFail(results, '_sanitizeDetails error path returns un-interpolated "${error.message}" literal');
  } else {
    _alPass(results, '_sanitizeDetails error path returns proper string (no placeholder)');
  }
}

/**
 * Test: AuditLogger has no batch state fields after simplification.
 */
function testAuditLogger_ImmediateWrite(results) {
  Logger.log('\n--- testAuditLogger_ImmediateWrite ---');

  if (typeof AuditLogger._batchingEnabled !== 'undefined') {
    _alFail(results, '_batchingEnabled still exists — batch system not removed');
  } else {
    _alPass(results, '_batchingEnabled removed (immediate-write-only mode)');
  }

  if (typeof AuditLogger._queue !== 'undefined') {
    _alFail(results, '_queue still exists — batch queue not removed');
  } else {
    _alPass(results, '_queue removed');
  }

  if (typeof AuditLogger.flush === 'function') {
    _alFail(results, 'flush() still exists — should be removed');
  } else {
    _alPass(results, 'flush() removed');
  }

  if (typeof AuditLogger.setBatchMode === 'function') {
    _alFail(results, 'setBatchMode() still exists — should be removed');
  } else {
    _alPass(results, 'setBatchMode() removed');
  }
}

/**
 * Test: log() with non-VALIDATION_FAILED action does NOT write to the audit sheet.
 * log() with VALIDATION_FAILED DOES write to the audit sheet.
 */
function testAuditLogger_LogFiltersBySideEffect(results) {
  Logger.log('\n--- testAuditLogger_LogFiltersBySideEffect ---');

  try {
    const auditSh = MasterDatabaseUtils.getSourceSheet('audit');
    const rowsBefore = auditSh.getLastRow();

    // Call log() with a non-VALIDATION_FAILED action — should NOT write
    AuditLogger.log('POST', { enteredBy: 'test', sheetName: '01', rowNum: 7 }, 'test audit filter');

    const rowsAfter = auditSh.getLastRow();

    if (rowsAfter === rowsBefore) {
      _alPass(results, 'log("POST", ...) did NOT write to audit sheet (console-only)');
    } else {
      _alFail(results, `log("POST", ...) wrote ${rowsAfter - rowsBefore} row(s) to audit sheet — should be console-only`);
    }

    // VALIDATION_FAILED SHOULD write
    const rowsBefore2 = auditSh.getLastRow();
    AuditLogger.log('VALIDATION_FAILED', { enteredBy: 'test', sheetName: '01', rowNum: 7 }, 'test validation fail write');
    const rowsAfter2 = auditSh.getLastRow();

    if (rowsAfter2 > rowsBefore2) {
      _alPass(results, 'log("VALIDATION_FAILED", ...) DID write to audit sheet');
    } else {
      _alFail(results, 'log("VALIDATION_FAILED", ...) did NOT write to audit sheet — should write');
    }

  } catch (e) {
    Logger.log(`  ⚠️  SKIP: Could not access audit sheet for side-effect test: ${e.message}`);
  }
}
