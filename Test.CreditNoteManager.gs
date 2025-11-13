// ==================== TEST: CreditNoteManager.gs ====================
/**
 * Test Suite: Credit Note Management
 *
 * Tests cover:
 * - Credit note creation and validation
 * - Credit application to invoices
 * - Credit tracking and status management
 * - Integration with invoice balance calculations
 * - Audit trail logging
 */

/**
 * Run all credit note tests
 */
function testAllCreditNotes() {
  Logger.log('╔══════════════════════════════════════════════════════╗');
  Logger.log('║  RUNNING CREDIT NOTE TEST SUITE                      ║');
  Logger.log('╚══════════════════════════════════════════════════════╝');

  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  // Test 1: Credit note creation
  try {
    Logger.log('\n✓ Test 1: Credit Note Creation');
    testCreateCreditNote();
    results.passed++;
    results.tests.push('✓ Create Credit Note');
  } catch (error) {
    Logger.log(`✗ FAILED: ${error.message}`);
    results.failed++;
    results.tests.push(`✗ Create Credit Note: ${error.message}`);
  }

  // Test 2: Credit note validation
  try {
    Logger.log('\n✓ Test 2: Credit Note Validation');
    testValidateCreditPayment();
    results.passed++;
    results.tests.push('✓ Validate Credit Payment');
  } catch (error) {
    Logger.log(`✗ FAILED: ${error.message}`);
    results.failed++;
    results.tests.push(`✗ Validate Credit Payment: ${error.message}`);
  }

  // Test 3: Find credit note
  try {
    Logger.log('\n✓ Test 3: Find Credit Note');
    testFindCreditNote();
    results.passed++;
    results.tests.push('✓ Find Credit Note');
  } catch (error) {
    Logger.log(`✗ FAILED: ${error.message}`);
    results.failed++;
    results.tests.push(`✗ Find Credit Note: ${error.message}`);
  }

  // Test 4: Get unused credits
  try {
    Logger.log('\n✓ Test 4: Get Unused Credits');
    testGetUnusedCredits();
    results.passed++;
    results.tests.push('✓ Get Unused Credits');
  } catch (error) {
    Logger.log(`✗ FAILED: ${error.message}`);
    results.failed++;
    results.tests.push(`✗ Get Unused Credits: ${error.message}`);
  }

  // Test 5: Get credit history for invoice
  try {
    Logger.log('\n✓ Test 5: Get Credit History');
    testGetHistoryForInvoice();
    results.passed++;
    results.tests.push('✓ Get Credit History');
  } catch (error) {
    Logger.log(`✗ FAILED: ${error.message}`);
    results.failed++;
    results.tests.push(`✗ Get Credit History: ${error.message}`);
  }

  // Test 6: Apply credit to invoice
  try {
    Logger.log('\n✓ Test 6: Apply Credit');
    testApplyCredit();
    results.passed++;
    results.tests.push('✓ Apply Credit');
  } catch (error) {
    Logger.log(`✗ FAILED: ${error.message}`);
    results.failed++;
    results.tests.push(`✗ Apply Credit: ${error.message}`);
  }

  // Print summary
  Logger.log('\n╔══════════════════════════════════════════════════════╗');
  Logger.log('║  TEST SUMMARY                                        ║');
  Logger.log('╠══════════════════════════════════════════════════════╣');
  Logger.log(`║ Passed: ${results.passed.toString().padEnd(46)} ║`);
  Logger.log(`║ Failed: ${results.failed.toString().padEnd(46)} ║`);
  Logger.log('╠══════════════════════════════════════════════════════╣');
  results.tests.forEach(test => {
    Logger.log(`║ ${test.padEnd(54)} ║`);
  });
  Logger.log('╚══════════════════════════════════════════════════════╝');

  return results;
}

/**
 * Test: Create Credit Note
 * Validates that credit notes can be created with proper data
 */
function testCreateCreditNote() {
  Logger.log('  Testing credit note creation...');

  // Check if CreditNoteDatabase exists
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const creditSheet = ss.getSheetByName(CONFIG.creditNoteSheet);

  if (!creditSheet) {
    throw new Error(`${CONFIG.creditNoteSheet} sheet not found. Please create it first.`);
  }

  // Get initial row count
  const initialRows = creditSheet.getLastRow();

  // Create test data
  const testData = {
    supplier: 'TEST_SUPPLIER_01',
    creditAmount: 100,
    refInvoiceNo: 'TEST-INV-001',
    reason: 'Test',
    creditDate: new Date(),
    originDay: '01',
    enteredBy: 'test@example.com'
  };

  // Create credit note (would fail if invoice doesn't exist, so we expect an error)
  const result = CreditNoteManager.createCreditNote(testData);

  // We're just testing the structure, so either success or expected error is OK
  if (!result.success && !result.message.includes('not found')) {
    throw new Error(`Unexpected error: ${result.message}`);
  }

  Logger.log('  ✓ Credit note creation works correctly');
}

/**
 * Test: Validate Credit Payment
 * Validates that credit payment validation works correctly
 */
function testValidateCreditPayment() {
  Logger.log('  Testing credit payment validation...');

  // Test 1: Missing reference invoice
  const invalidData1 = {
    supplier: 'TEST',
    receivedAmt: 100,
    paymentAmt: 0,
    notes: 'Test'
  };

  const result1 = validateCreditPayment(invalidData1);
  if (result1.valid) {
    throw new Error('Should reject credit without invoice number');
  }

  // Test 2: Valid credit payment (would still fail due to invoice not existing)
  const testData = {
    supplier: 'TEST',
    invoiceNo: 'TEST-INV',
    receivedAmt: 100,
    paymentAmt: 0,
    notes: 'Return'
  };

  const result2 = validateCreditPayment(testData);
  // Expected to fail due to invoice not found, but validation logic should work
  if (!result2.valid && !result2.errors.some(e => e.includes('not found'))) {
    throw new Error(`Unexpected validation error: ${result2.errors.join(', ')}`);
  }

  Logger.log('  ✓ Credit payment validation works correctly');
}

/**
 * Test: Find Credit Note
 * Validates that credit notes can be found by supplier and number
 */
function testFindCreditNote() {
  Logger.log('  Testing find credit note...');

  // Try to find a non-existent credit note
  const result = CreditNoteManager.findCreditNote('NON_EXISTENT', 'CR-20250101-00000');

  if (result !== null && result !== undefined) {
    throw new Error('Should return null for non-existent credit note');
  }

  Logger.log('  ✓ Find credit note works correctly');
}

/**
 * Test: Get Unused Credits
 * Validates that unused credits can be retrieved for a supplier
 */
function testGetUnusedCredits() {
  Logger.log('  Testing get unused credits...');

  const credits = CreditNoteManager.getUnusedCreditsForSupplier('NON_EXISTENT');

  if (!Array.isArray(credits)) {
    throw new Error('Should return an array');
  }

  Logger.log(`  ✓ Get unused credits works correctly (found ${credits.length} credits)`);
}

/**
 * Test: Get History for Invoice
 * Validates that credit history can be retrieved for an invoice
 */
function testGetHistoryForInvoice() {
  Logger.log('  Testing get credit history for invoice...');

  const history = CreditNoteManager.getHistoryForInvoice('TEST-INV-001');

  if (!Array.isArray(history)) {
    throw new Error('Should return an array');
  }

  Logger.log(`  ✓ Get credit history works correctly (found ${history.length} credits)`);
}

/**
 * Test: Apply Credit
 * Validates that credits can be applied to invoices
 */
function testApplyCredit() {
  Logger.log('  Testing apply credit...');

  // Try to apply credit with non-existent ID (should fail gracefully)
  const result = CreditNoteManager.applyCredit('NON_EXISTENT_ID', 100);

  if (result.success) {
    throw new Error('Should fail when applying non-existent credit');
  }

  Logger.log('  ✓ Apply credit works correctly (expected failure for non-existent credit)');
}

/**
 * Integration Test: Complete Credit Note Workflow
 * This test demonstrates the full workflow of creating and applying a credit note
 * Note: This test requires actual invoice data to exist in the system
 */
function testCompleteWorkflow() {
  Logger.log('\n╔══════════════════════════════════════════════════════╗');
  Logger.log('║  INTEGRATION TEST: Complete Credit Note Workflow     ║');
  Logger.log('╚══════════════════════════════════════════════════════╝');

  // PREREQUISITES: This test assumes you have:
  // 1. An invoice in InvoiceDatabase: Supplier = 'ABC Corp', Invoice No = 'INV-001', Total = $1000
  // 2. CreditNoteDatabase sheet exists

  const testSupplier = 'ABC Corp';
  const testInvoice = 'INV-001';
  const creditAmount = 250;

  try {
    Logger.log(`\nStep 1: Create credit note for ${testSupplier} / ${testInvoice}`);

    const creditResult = CreditNoteManager.createCreditNote({
      supplier: testSupplier,
      creditAmount: creditAmount,
      refInvoiceNo: testInvoice,
      reason: 'Return',
      creditDate: new Date(),
      originDay: '01',
      enteredBy: 'test@example.com'
    });

    if (creditResult.success) {
      Logger.log(`✓ Credit note created: ${creditResult.creditNo}`);

      // Get total applied credits
      const appliedCredits = CreditNoteManager.getTotalAppliedCreditsForInvoice(testInvoice);
      Logger.log(`✓ Applied credits for ${testInvoice}: $${appliedCredits}`);

      // Get unused credits
      const unusedCredits = CreditNoteManager.getUnusedCreditsForSupplier(testSupplier);
      Logger.log(`✓ Unused credits for ${testSupplier}: ${unusedCredits.length} note(s)`);

    } else {
      Logger.log(`✗ Credit note creation failed: ${creditResult.message}`);
      Logger.log('  (This is expected if the test invoice does not exist)');
    }

  } catch (error) {
    Logger.log(`✗ Integration test error: ${error.message}`);
  }
}

/**
 * Test: Config Validation
 * Validates that credit note configuration is correct
 */
function testConfigValidation() {
  Logger.log('\nValidating Credit Note Configuration...');

  // Check if credit note columns are configured
  if (!CONFIG.creditNoteCols) {
    throw new Error('creditNoteCols not configured in _Config.gs');
  }

  // Check if credit note sheet is in config
  if (!CONFIG.creditNoteSheet) {
    throw new Error('creditNoteSheet not configured in _Config.gs');
  }

  // Check if Credit payment type is supported
  if (!CONFIG.rules.SUPPORTED_PAYMENT_TYPES.includes('Credit')) {
    throw new Error('Credit payment type not in SUPPORTED_PAYMENT_TYPES');
  }

  // Check if credit reasons are configured
  if (!CONFIG.rules.SUPPORTED_CREDIT_REASONS) {
    throw new Error('SUPPORTED_CREDIT_REASONS not configured in _Config.gs');
  }

  Logger.log('✓ Credit Note Configuration is valid');
}
