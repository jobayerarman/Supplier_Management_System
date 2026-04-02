// @ts-nocheck
// ==================== MODULE: Test.ValidationEngine.gs ====================
/**
 * Tests for ValidationEngine module
 * Run from Script Editor: select runAllValidationEngineTests → Run → View Logs
 */

function runAllValidationEngineTests() {
  const results = { passed: 0, failed: 0, errors: [] };
  Logger.log('═'.repeat(60));
  Logger.log('VALIDATION ENGINE TEST SUITE');
  Logger.log('═'.repeat(60));

  testValidation_InvoiceNoFormat(results);
  testValidation_MaxTransactionAmount(results);

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

function _vePass(results, msg) { Logger.log(`  ✅ PASS: ${msg}`); results.passed++; }
function _veFail(results, msg) { Logger.log(`  ❌ FAIL: ${msg}`); results.failed++; results.errors.push(msg); }

/**
 * Test: validatePostData rejects invoice numbers with illegal characters.
 */
function testValidation_InvoiceNoFormat(results) {
  Logger.log('\n--- testValidation_InvoiceNoFormat ---');

  const baseData = {
    supplier: 'Test Supplier',
    paymentType: 'Unpaid',
    receivedAmt: 1000,
    paymentAmt: 0,
    sheetName: '01',
    rowNum: 7,
    enteredBy: 'test@example.com',
    timestamp: new Date(),
    sysId: 'inv_test001'
  };

  // Invoice with spaces should be rejected
  const r1 = validatePostData({ ...baseData, invoiceNo: 'INV 001' });
  if (!r1.valid) {
    _vePass(results, 'Invoice with spaces "INV 001" rejected by validatePostData');
  } else {
    _veFail(results, 'Invoice with spaces "INV 001" should be invalid but passed validation');
  }

  // Invoice with slash should be rejected
  const r2 = validatePostData({ ...baseData, invoiceNo: 'INV/001' });
  if (!r2.valid) {
    _vePass(results, 'Invoice with slash "INV/001" rejected by validatePostData');
  } else {
    _veFail(results, 'Invoice with slash "INV/001" should be invalid but passed validation');
  }

  // Valid invoice number should pass
  const r3 = validatePostData({ ...baseData, invoiceNo: 'INV-001_A' });
  if (r3.valid) {
    _vePass(results, 'Valid invoice number "INV-001_A" accepted');
  } else {
    _veFail(results, `Valid invoice "INV-001_A" rejected: ${r3.error}`);
  }
}

/**
 * Test: validatePostData rejects amounts exceeding MAX_TRANSACTION_AMOUNT.
 */
function testValidation_MaxTransactionAmount(results) {
  Logger.log('\n--- testValidation_MaxTransactionAmount ---');

  const maxAllowed = CONFIG.rules.MAX_TRANSACTION_AMOUNT;
  const baseData = {
    supplier: 'Test Supplier',
    invoiceNo: 'INV-001',
    paymentType: 'Unpaid',
    paymentAmt: 0,
    sheetName: '01',
    rowNum: 7,
    enteredBy: 'test@example.com',
    timestamp: new Date(),
    sysId: 'inv_test002'
  };

  // Amount exactly at max should pass
  const r1 = validatePostData({ ...baseData, receivedAmt: maxAllowed });
  if (r1.valid) {
    _vePass(results, `Amount at MAX_TRANSACTION_AMOUNT (${maxAllowed}) accepted`);
  } else {
    _veFail(results, `Amount at max ${maxAllowed} should be valid but rejected: ${r1.error}`);
  }

  // Amount exceeding max should be rejected
  const r2 = validatePostData({ ...baseData, receivedAmt: maxAllowed + 1 });
  if (!r2.valid) {
    _vePass(results, `Amount over MAX_TRANSACTION_AMOUNT (${maxAllowed + 1}) rejected`);
  } else {
    _veFail(results, `Amount ${maxAllowed + 1} exceeds MAX_TRANSACTION_AMOUNT but passed validation`);
  }
}
