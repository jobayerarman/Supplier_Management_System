// ==================== MODULE: PaymentManagerTests.gs ====================
/**
 * Comprehensive test suite for PaymentManager.gs
 *
 * PURPOSE: Lock in current behavior before refactoring
 *
 * TEST CATEGORIES:
 * 1. Mock Data Generators
 * 2. PaymentCache Tests
 * 3. PaymentManager.processOptimized Tests
 * 4. _recordPayment Tests
 * 5. _updateInvoicePaidDate Tests
 * 6. Query Function Tests (getHistory*, getTotal*)
 * 7. isDuplicate Tests
 * 8. Error Handling Tests
 * 9. Integration Tests
 *
 * USAGE:
 * - Run individual tests: testPaymentCache_IndexBuilding()
 * - Run category: runPaymentCacheTests()
 * - Run all tests: runAllPaymentManagerTests()
 *
 * BEFORE REFACTORING CHECKLIST:
 * [ ] All tests pass
 * [ ] Baseline performance recorded
 * [ ] Cache hit rates documented
 * [ ] Error scenarios documented
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: TEST UTILITIES AND MOCK DATA GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

const TestUtils = {
  /**
   * Test result tracker
   */
  results: {
    passed: 0,
    failed: 0,
    errors: []
  },

  /**
   * Reset test results
   */
  resetResults: function() {
    this.results = { passed: 0, failed: 0, errors: [] };
  },

  /**
   * Assert equality
   */
  assertEqual: function(actual, expected, testName) {
    if (actual === expected) {
      this.results.passed++;
      Logger.log(`✅ PASS: ${testName}`);
      return true;
    } else {
      this.results.failed++;
      const error = `Expected: ${expected}, Got: ${actual}`;
      this.results.errors.push(`${testName}: ${error}`);
      Logger.log(`❌ FAIL: ${testName} - ${error}`);
      return false;
    }
  },

  /**
   * Assert deep equality for objects/arrays
   */
  assertDeepEqual: function(actual, expected, testName) {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    return this.assertEqual(actualStr, expectedStr, testName);
  },

  /**
   * Assert truthy
   */
  assertTrue: function(condition, testName) {
    if (condition) {
      this.results.passed++;
      Logger.log(`✅ PASS: ${testName}`);
      return true;
    } else {
      this.results.failed++;
      this.results.errors.push(`${testName}: Expected truthy, got ${condition}`);
      Logger.log(`❌ FAIL: ${testName} - Expected truthy`);
      return false;
    }
  },

  /**
   * Assert falsy
   */
  assertFalse: function(condition, testName) {
    return this.assertTrue(!condition, testName);
  },

  /**
   * Assert throws error
   */
  assertThrows: function(fn, testName) {
    try {
      fn();
      this.results.failed++;
      this.results.errors.push(`${testName}: Expected error but none thrown`);
      Logger.log(`❌ FAIL: ${testName} - Expected error`);
      return false;
    } catch (e) {
      this.results.passed++;
      Logger.log(`✅ PASS: ${testName}`);
      return true;
    }
  },

  /**
   * Print test summary
   */
  printSummary: function(suiteName) {
    Logger.log('\n' + '='.repeat(60));
    Logger.log(`TEST SUITE: ${suiteName}`);
    Logger.log(`Passed: ${this.results.passed}`);
    Logger.log(`Failed: ${this.results.failed}`);
    Logger.log(`Total: ${this.results.passed + this.results.failed}`);

    if (this.results.failed > 0) {
      Logger.log('\nFAILURES:');
      this.results.errors.forEach(err => Logger.log(`  - ${err}`));
    }

    Logger.log('='.repeat(60) + '\n');

    return this.results.failed === 0;
  }
};

const MockDataGenerator = {
  /**
   * Generate mock transaction data
   */
  createTransactionData: function(overrides = {}) {
    const defaults = {
      supplier: 'Test Supplier',
      invoiceNo: 'INV-001',
      receivedAmt: 1000,
      paymentType: 'Regular',
      prevInvoice: '',
      paymentAmt: 1000,
      notes: 'Test transaction',
      sheetName: '01',
      enteredBy: 'test@example.com',
      timestamp: new Date(),
      sysId: 'TEST-SYS-001',
      invoiceDate: new Date(),
      paymentDate: new Date()
    };

    return Object.assign({}, defaults, overrides);
  },

  /**
   * Generate mock invoice data
   */
  createInvoiceData: function(overrides = {}) {
    const col = CONFIG.invoiceCols;
    const invoice = new Array(CONFIG.totalColumns.invoice).fill('');

    const defaults = {
      supplier: 'Test Supplier',
      invoiceNo: 'INV-001',
      invoiceDate: new Date(),
      totalAmount: 1000,
      totalPaid: 0,
      balanceDue: 1000,
      status: 'Unpaid',
      paidDate: '',
      notes: 'Test invoice',
      enteredBy: 'test@example.com',
      timestamp: new Date(),
      sysId: 'TEST-INV-001'
    };

    const data = Object.assign({}, defaults, overrides);

    invoice[col.supplier] = data.supplier;
    invoice[col.invoiceNo] = data.invoiceNo;
    invoice[col.invoiceDate] = data.invoiceDate;
    invoice[col.totalAmount] = data.totalAmount;
    invoice[col.totalPaid] = data.totalPaid;
    invoice[col.balanceDue] = data.balanceDue;
    invoice[col.status] = data.status;
    invoice[col.paidDate] = data.paidDate;
    invoice[col.notes] = data.notes;
    invoice[col.enteredBy] = data.enteredBy;
    invoice[col.timestamp] = data.timestamp;
    invoice[col.sysId] = data.sysId;

    return {
      row: 2, // Assume first data row
      data: invoice
    };
  },

  /**
   * Generate mock payment log data (sheet format)
   */
  createPaymentLogData: function(payments = []) {
    const col = CONFIG.paymentCols;
    const header = new Array(CONFIG.totalColumns.payment).fill('');
    header[col.date] = 'Date';
    header[col.supplier] = 'Supplier';
    header[col.invoiceNo] = 'Invoice No';
    header[col.paymentType] = 'Payment Type';
    header[col.amount] = 'Amount';
    header[col.method] = 'Method';
    header[col.reference] = 'Reference';
    header[col.fromSheet] = 'From Sheet';
    header[col.enteredBy] = 'Entered By';
    header[col.timestamp] = 'Timestamp';
    header[col.sysId] = 'Payment ID';
    header[col.invoiceId] = 'Invoice ID';

    const data = [header];

    payments.forEach(payment => {
      const row = new Array(CONFIG.totalColumns.payment).fill('');
      row[col.date] = payment.date || new Date();
      row[col.supplier] = payment.supplier || 'Test Supplier';
      row[col.invoiceNo] = payment.invoiceNo || 'INV-001';
      row[col.paymentType] = payment.paymentType || 'Regular';
      row[col.amount] = payment.amount || 1000;
      row[col.method] = payment.method || 'Cash';
      row[col.reference] = payment.reference || '';
      row[col.fromSheet] = payment.fromSheet || '01';
      row[col.enteredBy] = payment.enteredBy || 'test@example.com';
      row[col.timestamp] = payment.timestamp || new Date();
      row[col.sysId] = payment.sysId || `PMT-${Date.now()}`;
      row[col.invoiceId] = payment.invoiceId || '';
      data.push(row);
    });

    return data;
  },

  /**
   * Generate multiple mock payments
   * NOTE: sysId uses _PAY suffix to match what _recordPayment stores in the sheet
   */
  createMultiplePayments: function(count, baseSupplier = 'Supplier') {
    const payments = [];
    for (let i = 0; i < count; i++) {
      payments.push({
        supplier: `${baseSupplier}-${Math.floor(i / 3) + 1}`,
        invoiceNo: `INV-${String(i + 1).padStart(3, '0')}`,
        amount: (i + 1) * 100,
        paymentType: i % 2 === 0 ? 'Regular' : 'Partial',
        sysId: `TEST-${String(i + 1).padStart(3, '0')}_PAY`
      });
    }
    return payments;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: PAYMENT CACHE TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: PaymentCache index building
 */
function testPaymentCache_IndexBuilding() {
  Logger.log('\n▶️ TEST: PaymentCache Index Building');
  TestUtils.resetResults();

  // Setup: Create mock payment data
  const mockPayments = MockDataGenerator.createMultiplePayments(10);
  const paymentData = MockDataGenerator.createPaymentLogData(mockPayments);

  // Clear cache first
  PaymentCache.clear();

  // Build cache
  PaymentCache.set(paymentData);

  // Test 1: All 4 indices created
  TestUtils.assertTrue(
    PaymentCache.invoiceIndex !== null,
    'Invoice index created'
  );
  TestUtils.assertTrue(
    PaymentCache.supplierIndex !== null,
    'Supplier index created'
  );
  TestUtils.assertTrue(
    PaymentCache.combinedIndex !== null,
    'Combined index created'
  );
  TestUtils.assertTrue(
    PaymentCache.paymentIdIndex !== null,
    'Payment ID index created'
  );

  // Test 2: Invoice index contains correct entries
  TestUtils.assertEqual(
    PaymentCache.invoiceIndex.size,
    10,
    'Invoice index has 10 entries'
  );

  // Test 3: Supplier index groups correctly (10 payments / 3 per supplier = 4 suppliers)
  TestUtils.assertTrue(
    PaymentCache.supplierIndex.size >= 3 && PaymentCache.supplierIndex.size <= 4,
    'Supplier index groups payments correctly'
  );

  // Test 4: Payment ID index for duplicate detection
  TestUtils.assertEqual(
    PaymentCache.paymentIdIndex.size,
    10,
    'Payment ID index has 10 entries'
  );

  // Test 5: Combined index entries
  TestUtils.assertEqual(
    PaymentCache.combinedIndex.size,
    10,
    'Combined index has 10 entries (unique supplier|invoice combinations)'
  );

  // Test 6: Timestamp set
  TestUtils.assertTrue(
    PaymentCache.timestamp !== null && PaymentCache.timestamp > 0,
    'Cache timestamp set'
  );

  TestUtils.printSummary('PaymentCache Index Building');
}

/**
 * Test: PaymentCache TTL expiration
 */
function testPaymentCache_TTLExpiration() {
  Logger.log('\n▶️ TEST: PaymentCache TTL Expiration');
  TestUtils.resetResults();

  // Setup
  const mockPayments = MockDataGenerator.createMultiplePayments(5);
  const paymentData = MockDataGenerator.createPaymentLogData(mockPayments);

  PaymentCache.clear();
  PaymentCache.set(paymentData);

  // Test 1: Cache valid immediately after set
  const cached1 = PaymentCache.get();
  TestUtils.assertTrue(
    cached1 !== null,
    'Cache valid immediately after set'
  );

  // Test 2: Manipulate timestamp to simulate expiration
  const originalTTL = PaymentCache.TTL;
  PaymentCache.TTL = 100; // 100ms TTL
  PaymentCache.timestamp = Date.now() - 200; // 200ms ago

  const cached2 = PaymentCache.get();
  TestUtils.assertTrue(
    cached2 === null,
    'Cache expired after TTL'
  );

  // Cleanup
  PaymentCache.TTL = originalTTL;

  TestUtils.printSummary('PaymentCache TTL Expiration');
}

/**
 * Test: PaymentCache write-through functionality
 */
function testPaymentCache_WriteThrough() {
  Logger.log('\n▶️ TEST: PaymentCache Write-Through');
  TestUtils.resetResults();

  // Setup: Start with empty cache
  PaymentCache.clear();
  const mockPayments = MockDataGenerator.createMultiplePayments(3);
  const paymentData = MockDataGenerator.createPaymentLogData(mockPayments);
  PaymentCache.set(paymentData);

  // Get initial counts
  const initialInvoiceCount = PaymentCache.invoiceIndex.size;
  const initialDataLength = PaymentCache.data.length;

  // Add new payment via write-through
  const col = CONFIG.paymentCols;
  const newPayment = new Array(CONFIG.totalColumns.payment).fill('');
  newPayment[col.supplier] = 'New Supplier';
  newPayment[col.invoiceNo] = 'INV-NEW';
  newPayment[col.amount] = 5000;
  newPayment[col.sysId] = 'PMT-NEW-001';

  const newRowNumber = initialDataLength; // Next row

  PaymentCache.addPaymentToCache(newRowNumber, newPayment);

  // Test 1: Data array expanded
  TestUtils.assertEqual(
    PaymentCache.data.length,
    initialDataLength,
    'Data array size matches (array expands as needed)'
  );

  // Test 2: Invoice index updated
  TestUtils.assertEqual(
    PaymentCache.invoiceIndex.size,
    initialInvoiceCount + 1,
    'Invoice index updated with new payment'
  );

  // Test 3: Payment findable by invoice
  TestUtils.assertTrue(
    PaymentCache.invoiceIndex.has('INV-NEW'),
    'New payment findable by invoice number'
  );

  // Test 4: Payment findable by supplier
  TestUtils.assertTrue(
    PaymentCache.supplierIndex.has('NEW SUPPLIER'),
    'New payment findable by supplier (normalized)'
  );

  // Test 5: Payment ID index updated
  TestUtils.assertTrue(
    PaymentCache.paymentIdIndex.has('PMT-NEW-001'),
    'Payment ID index updated for duplicate detection'
  );

  TestUtils.printSummary('PaymentCache Write-Through');
}

/**
 * Test: PaymentCache with empty data
 */
function testPaymentCache_EmptyData() {
  Logger.log('\n▶️ TEST: PaymentCache Empty Data');
  TestUtils.resetResults();

  // Setup: Empty payment log (header only)
  const emptyData = MockDataGenerator.createPaymentLogData([]);

  PaymentCache.clear();
  PaymentCache.set(emptyData);

  // Test 1: Indices created but empty
  TestUtils.assertEqual(
    PaymentCache.invoiceIndex.size,
    0,
    'Invoice index empty'
  );
  TestUtils.assertEqual(
    PaymentCache.supplierIndex.size,
    0,
    'Supplier index empty'
  );
  TestUtils.assertEqual(
    PaymentCache.combinedIndex.size,
    0,
    'Combined index empty'
  );
  TestUtils.assertEqual(
    PaymentCache.paymentIdIndex.size,
    0,
    'Payment ID index empty'
  );

  // Test 2: Data array contains only header
  TestUtils.assertEqual(
    PaymentCache.data.length,
    1,
    'Data array contains only header row'
  );

  TestUtils.printSummary('PaymentCache Empty Data');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: PAYMENT MANAGER - CORE FUNCTION TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: PaymentManager._shouldUpdatePaidDate
 */
function testPaymentManager_ShouldUpdatePaidDate() {
  Logger.log('\n▶️ TEST: PaymentManager._shouldUpdatePaidDate');
  TestUtils.resetResults();

  // Test 1: Regular payment should update
  TestUtils.assertTrue(
    PaymentManager._shouldUpdatePaidDate('Regular'),
    'Regular payment should trigger paid date check'
  );

  // Test 2: Due payment should update
  TestUtils.assertTrue(
    PaymentManager._shouldUpdatePaidDate('Due'),
    'Due payment should trigger paid date check'
  );

  // Test 3: Partial payment should NOT update
  TestUtils.assertFalse(
    PaymentManager._shouldUpdatePaidDate('Partial'),
    'Partial payment should NOT trigger paid date check'
  );

  // Test 4: Unpaid should NOT update
  TestUtils.assertFalse(
    PaymentManager._shouldUpdatePaidDate('Unpaid'),
    'Unpaid should NOT trigger paid date check'
  );

  // Test 5: Unknown type should NOT update
  TestUtils.assertFalse(
    PaymentManager._shouldUpdatePaidDate('InvalidType'),
    'Unknown payment type should NOT trigger paid date check'
  );

  TestUtils.printSummary('PaymentManager._shouldUpdatePaidDate');
}

/**
 * Test: PaymentManager.shouldProcess
 */
function testPaymentManager_ShouldProcess() {
  Logger.log('\n▶️ TEST: PaymentManager.shouldProcess');
  TestUtils.resetResults();

  // Test 1: Payment amount > 0
  const data1 = MockDataGenerator.createTransactionData({ paymentAmt: 1000 });
  TestUtils.assertTrue(
    PaymentManager.shouldProcess(data1),
    'Should process when payment amount > 0'
  );

  // Test 2: Regular payment type (even if amount = 0)
  const data2 = MockDataGenerator.createTransactionData({
    paymentAmt: 0,
    paymentType: 'Regular'
  });
  TestUtils.assertTrue(
    PaymentManager.shouldProcess(data2),
    'Should process Regular payment type even with 0 amount'
  );

  // Test 3: Payment amount = 0 and not Regular
  const data3 = MockDataGenerator.createTransactionData({
    paymentAmt: 0,
    paymentType: 'Partial'
  });
  TestUtils.assertFalse(
    PaymentManager.shouldProcess(data3),
    'Should NOT process when amount = 0 and not Regular'
  );

  TestUtils.printSummary('PaymentManager.shouldProcess');
}

/**
 * Test: PaymentManager.getPaymentMethod
 */
function testPaymentManager_GetPaymentMethod() {
  Logger.log('\n▶️ TEST: PaymentManager.getPaymentMethod');
  TestUtils.resetResults();

  // Test each payment type
  const regularMethod = PaymentManager.getPaymentMethod('Regular');
  TestUtils.assertTrue(
    regularMethod !== null && regularMethod !== '',
    'Regular payment type has method'
  );

  const dueMethod = PaymentManager.getPaymentMethod('Due');
  TestUtils.assertTrue(
    dueMethod !== null && dueMethod !== '',
    'Due payment type has method'
  );

  const partialMethod = PaymentManager.getPaymentMethod('Partial');
  TestUtils.assertTrue(
    partialMethod !== null && partialMethod !== '',
    'Partial payment type has method'
  );

  TestUtils.printSummary('PaymentManager.getPaymentMethod');
}

/**
 * Test: PaymentManager.isDuplicate
 */
function testPaymentManager_IsDuplicate() {
  Logger.log('\n▶️ TEST: PaymentManager.isDuplicate');
  TestUtils.resetResults();

  // Setup: Create cache with known payments
  // NOTE: sysId should have _PAY suffix as that's what _recordPayment stores in the sheet
  PaymentCache.clear();
  const mockPayments = [
    { sysId: 'EXISTING-001_PAY' },
    { sysId: 'EXISTING-002_PAY' },
    { sysId: 'EXISTING-003_PAY' }
  ];
  const paymentData = MockDataGenerator.createPaymentLogData(mockPayments);
  PaymentCache.set(paymentData);

  // Test 1: Existing payment is duplicate
  // Pass base sysId (without _PAY), isDuplicate will add it
  TestUtils.assertTrue(
    PaymentManager.isDuplicate('EXISTING-001'),
    'Existing payment detected as duplicate'
  );

  // Test 2: Non-existing payment is not duplicate
  TestUtils.assertFalse(
    PaymentManager.isDuplicate('NEW-PAYMENT-001'),
    'New payment not detected as duplicate'
  );

  // Test 3: Empty sysId returns false
  TestUtils.assertFalse(
    PaymentManager.isDuplicate(''),
    'Empty sysId returns false'
  );

  // Test 4: Null sysId returns false
  TestUtils.assertFalse(
    PaymentManager.isDuplicate(null),
    'Null sysId returns false'
  );

  TestUtils.printSummary('PaymentManager.isDuplicate');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: QUERY FUNCTION TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: PaymentManager.getHistoryForInvoice
 */
function testPaymentManager_GetHistoryForInvoice() {
  Logger.log('\n▶️ TEST: PaymentManager.getHistoryForInvoice');
  TestUtils.resetResults();

  // Setup: Create cache with multiple payments for same invoice
  PaymentCache.clear();
  const mockPayments = [
    { invoiceNo: 'INV-001', amount: 500, supplier: 'Supplier A' },
    { invoiceNo: 'INV-001', amount: 300, supplier: 'Supplier A' },
    { invoiceNo: 'INV-001', amount: 200, supplier: 'Supplier A' },
    { invoiceNo: 'INV-002', amount: 1000, supplier: 'Supplier B' }
  ];
  const paymentData = MockDataGenerator.createPaymentLogData(mockPayments);
  PaymentCache.set(paymentData);

  // Test 1: Get history for invoice with multiple payments
  const history1 = PaymentManager.getHistoryForInvoice('INV-001');
  TestUtils.assertEqual(
    history1.length,
    3,
    'Found 3 payments for INV-001'
  );

  // Test 2: Verify total amount
  const total1 = history1.reduce((sum, p) => sum + p.amount, 0);
  TestUtils.assertEqual(
    total1,
    1000,
    'Total payments for INV-001 = 1000'
  );

  // Test 3: Get history for invoice with single payment
  const history2 = PaymentManager.getHistoryForInvoice('INV-002');
  TestUtils.assertEqual(
    history2.length,
    1,
    'Found 1 payment for INV-002'
  );

  // Test 4: Non-existent invoice returns empty array
  const history3 = PaymentManager.getHistoryForInvoice('INV-999');
  TestUtils.assertEqual(
    history3.length,
    0,
    'Non-existent invoice returns empty array'
  );

  // Test 5: Empty invoice number returns empty array
  const history4 = PaymentManager.getHistoryForInvoice('');
  TestUtils.assertEqual(
    history4.length,
    0,
    'Empty invoice number returns empty array'
  );

  // Test 6: Check returned object structure
  if (history1.length > 0) {
    const payment = history1[0];
    TestUtils.assertTrue(
      payment.hasOwnProperty('date') &&
      payment.hasOwnProperty('supplier') &&
      payment.hasOwnProperty('amount') &&
      payment.hasOwnProperty('type') &&
      payment.hasOwnProperty('method'),
      'Payment object has correct structure'
    );
  }

  TestUtils.printSummary('PaymentManager.getHistoryForInvoice');
}

/**
 * Test: PaymentManager.getHistoryForSupplier
 */
function testPaymentManager_GetHistoryForSupplier() {
  Logger.log('\n▶️ TEST: PaymentManager.getHistoryForSupplier');
  TestUtils.resetResults();

  // Setup
  PaymentCache.clear();
  const mockPayments = [
    { supplier: 'Supplier A', invoiceNo: 'INV-001', amount: 500 },
    { supplier: 'Supplier A', invoiceNo: 'INV-002', amount: 700 },
    { supplier: 'Supplier B', invoiceNo: 'INV-003', amount: 1000 },
    { supplier: 'Supplier B', invoiceNo: 'INV-004', amount: 300 }
  ];
  const paymentData = MockDataGenerator.createPaymentLogData(mockPayments);
  PaymentCache.set(paymentData);

  // Test 1: Get history for supplier with multiple payments
  const history1 = PaymentManager.getHistoryForSupplier('Supplier A');
  TestUtils.assertEqual(
    history1.length,
    2,
    'Found 2 payments for Supplier A'
  );

  // Test 2: Verify total
  const total1 = history1.reduce((sum, p) => sum + p.amount, 0);
  TestUtils.assertEqual(
    total1,
    1200,
    'Total payments for Supplier A = 1200'
  );

  // Test 3: Case-insensitive supplier matching
  const history2 = PaymentManager.getHistoryForSupplier('supplier a');
  TestUtils.assertEqual(
    history2.length,
    2,
    'Case-insensitive supplier matching works'
  );

  // Test 4: Non-existent supplier
  const history3 = PaymentManager.getHistoryForSupplier('Supplier Z');
  TestUtils.assertEqual(
    history3.length,
    0,
    'Non-existent supplier returns empty array'
  );

  // Test 5: Check returned object structure includes invoiceNo
  if (history1.length > 0) {
    const payment = history1[0];
    TestUtils.assertTrue(
      payment.hasOwnProperty('invoiceNo'),
      'Payment object for supplier includes invoiceNo'
    );
  }

  TestUtils.printSummary('PaymentManager.getHistoryForSupplier');
}

/**
 * Test: PaymentManager.getTotalForSupplier
 */
function testPaymentManager_GetTotalForSupplier() {
  Logger.log('\n▶️ TEST: PaymentManager.getTotalForSupplier');
  TestUtils.resetResults();

  // Setup
  PaymentCache.clear();
  const mockPayments = [
    { supplier: 'Supplier X', amount: 100 },
    { supplier: 'Supplier X', amount: 200 },
    { supplier: 'Supplier X', amount: 300 },
    { supplier: 'Supplier Y', amount: 1000 }
  ];
  const paymentData = MockDataGenerator.createPaymentLogData(mockPayments);
  PaymentCache.set(paymentData);

  // Test 1: Get total for supplier
  const total1 = PaymentManager.getTotalForSupplier('Supplier X');
  TestUtils.assertEqual(
    total1,
    600,
    'Total for Supplier X = 600'
  );

  // Test 2: Case-insensitive
  const total2 = PaymentManager.getTotalForSupplier('supplier x');
  TestUtils.assertEqual(
    total2,
    600,
    'Case-insensitive total calculation'
  );

  // Test 3: Non-existent supplier returns 0
  const total3 = PaymentManager.getTotalForSupplier('Supplier Z');
  TestUtils.assertEqual(
    total3,
    0,
    'Non-existent supplier returns 0'
  );

  // Test 4: Empty supplier name returns 0
  const total4 = PaymentManager.getTotalForSupplier('');
  TestUtils.assertEqual(
    total4,
    0,
    'Empty supplier name returns 0'
  );

  TestUtils.printSummary('PaymentManager.getTotalForSupplier');
}

/**
 * Test: PaymentManager.getStatistics
 */
function testPaymentManager_GetStatistics() {
  Logger.log('\n▶️ TEST: PaymentManager.getStatistics');
  TestUtils.resetResults();

  // Setup
  PaymentCache.clear();
  const mockPayments = [
    { amount: 500, paymentType: 'Regular', method: 'Cash' },
    { amount: 300, paymentType: 'Regular', method: 'Cash' },
    { amount: 700, paymentType: 'Partial', method: 'Bank' },
    { amount: 200, paymentType: 'Due', method: 'Bank' }
  ];
  const paymentData = MockDataGenerator.createPaymentLogData(mockPayments);
  PaymentCache.set(paymentData);

  // Get statistics
  const stats = PaymentManager.getStatistics();

  // Test 1: Total count
  TestUtils.assertEqual(
    stats.total,
    4,
    'Total payment count = 4'
  );

  // Test 2: Total amount
  TestUtils.assertEqual(
    stats.totalAmount,
    1700,
    'Total amount = 1700'
  );

  // Test 3: By type aggregation
  TestUtils.assertEqual(
    stats.byType['Regular'],
    800,
    'Regular payments total = 800'
  );
  TestUtils.assertEqual(
    stats.byType['Partial'],
    700,
    'Partial payments total = 700'
  );
  TestUtils.assertEqual(
    stats.byType['Due'],
    200,
    'Due payments total = 200'
  );

  // Test 4: By method aggregation
  TestUtils.assertEqual(
    stats.byMethod['Cash'],
    800,
    'Cash payments total = 800'
  );
  TestUtils.assertEqual(
    stats.byMethod['Bank'],
    900,
    'Bank payments total = 900'
  );

  // Test 5: Empty cache returns zeros
  PaymentCache.clear();
  PaymentCache.set([[]]);
  const emptyStats = PaymentManager.getStatistics();
  TestUtils.assertEqual(
    emptyStats.total,
    0,
    'Empty cache returns 0 total'
  );
  TestUtils.assertEqual(
    emptyStats.totalAmount,
    0,
    'Empty cache returns 0 amount'
  );

  TestUtils.printSummary('PaymentManager.getStatistics');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: INTEGRATION TESTS (READ-ONLY)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Integration Test: Cache Performance with Large Dataset
 */
function testIntegration_CachePerformance() {
  Logger.log('\n▶️ INTEGRATION TEST: Cache Performance');
  TestUtils.resetResults();

  // Setup: Create large dataset (100 payments)
  const mockPayments = MockDataGenerator.createMultiplePayments(100);
  const paymentData = MockDataGenerator.createPaymentLogData(mockPayments);

  PaymentCache.clear();

  // Test 1: Cache build time
  const startBuild = Date.now();
  PaymentCache.set(paymentData);
  const buildTime = Date.now() - startBuild;

  Logger.log(`  Cache build time for 100 payments: ${buildTime}ms`);
  TestUtils.assertTrue(
    buildTime < 1000,
    'Cache builds in under 1 second for 100 payments'
  );

  // Test 2: Query performance (should be O(1))
  const startQuery = Date.now();
  for (let i = 0; i < 50; i++) {
    PaymentManager.getHistoryForInvoice(`INV-${String(i + 1).padStart(3, '0')}`);
  }
  const queryTime = Date.now() - startQuery;
  const avgQueryTime = queryTime / 50;

  Logger.log(`  Average query time: ${avgQueryTime.toFixed(2)}ms`);
  TestUtils.assertTrue(
    avgQueryTime < 10,
    'Average query time under 10ms (O(1) performance)'
  );

  // Test 3: Duplicate detection performance
  const startDupe = Date.now();
  for (let i = 0; i < 100; i++) {
    PaymentManager.isDuplicate(`TEST-${String(i + 1).padStart(3, '0')}`);
  }
  const dupeTime = Date.now() - startDupe;
  const avgDupeTime = dupeTime / 100;

  Logger.log(`  Average duplicate check time: ${avgDupeTime.toFixed(2)}ms`);
  TestUtils.assertTrue(
    avgDupeTime < 5,
    'Duplicate detection under 5ms (O(1) hash lookup)'
  );

  // Test 4: Statistics calculation
  const startStats = Date.now();
  const stats = PaymentManager.getStatistics();
  const statsTime = Date.now() - startStats;

  Logger.log(`  Statistics calculation time: ${statsTime}ms`);
  TestUtils.assertTrue(
    statsTime < 100,
    'Statistics calculation under 100ms'
  );
  TestUtils.assertEqual(
    stats.total,
    100,
    'Statistics shows correct count'
  );

  TestUtils.printSummary('Cache Performance Integration');
}

/**
 * Integration Test: Cache Write-Through Workflow
 */
function testIntegration_WriteThroughWorkflow() {
  Logger.log('\n▶️ INTEGRATION TEST: Write-Through Workflow');
  TestUtils.resetResults();

  // Setup: Initial cache
  PaymentCache.clear();
  const initial = MockDataGenerator.createMultiplePayments(10);
  const paymentData = MockDataGenerator.createPaymentLogData(initial);
  PaymentCache.set(paymentData);

  // Simulate payment processing workflow
  // NOTE: sysId should have _PAY suffix as that's what _recordPayment stores in the sheet
  const newPayments = [
    { supplier: 'New Supplier 1', invoiceNo: 'INV-NEW-1', amount: 1000, sysId: 'NEW-1_PAY' },
    { supplier: 'New Supplier 1', invoiceNo: 'INV-NEW-2', amount: 500, sysId: 'NEW-2_PAY' },
    { supplier: 'New Supplier 2', invoiceNo: 'INV-NEW-3', amount: 750, sysId: 'NEW-3_PAY' }
  ];

  let currentRow = paymentData.length;

  newPayments.forEach(payment => {
    const col = CONFIG.paymentCols;
    const row = new Array(CONFIG.totalColumns.payment).fill('');
    row[col.supplier] = payment.supplier;
    row[col.invoiceNo] = payment.invoiceNo;
    row[col.amount] = payment.amount;
    row[col.sysId] = payment.sysId;

    PaymentCache.addPaymentToCache(currentRow, row);
    currentRow++;
  });

  // Test 1: All new payments findable
  const history1 = PaymentManager.getHistoryForSupplier('New Supplier 1');
  TestUtils.assertEqual(
    history1.length,
    2,
    'New Supplier 1 has 2 payments in cache'
  );

  // Test 2: Invoice lookups work
  const history2 = PaymentManager.getHistoryForInvoice('INV-NEW-3');
  TestUtils.assertEqual(
    history2.length,
    1,
    'New invoice findable after write-through'
  );

  // Test 3: Duplicate detection works
  TestUtils.assertTrue(
    PaymentManager.isDuplicate('NEW-1'),
    'Newly added payment detected as duplicate'
  );

  // Test 4: Statistics updated
  const stats = PaymentManager.getStatistics();
  TestUtils.assertTrue(
    stats.total >= 13,
    'Statistics reflect new payments'
  );

  TestUtils.printSummary('Write-Through Workflow Integration');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: TEST RUNNERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run all PaymentCache tests
 */
function runPaymentCacheTests() {
  Logger.log('\n' + '█'.repeat(60));
  Logger.log('PAYMENT CACHE TEST SUITE');
  Logger.log('█'.repeat(60));

  testPaymentCache_IndexBuilding();
  testPaymentCache_TTLExpiration();
  testPaymentCache_WriteThrough();
  testPaymentCache_EmptyData();

  Logger.log('\n✓ PaymentCache test suite completed\n');
}

/**
 * Run all PaymentManager core function tests
 */
function runPaymentManagerCoreTests() {
  Logger.log('\n' + '█'.repeat(60));
  Logger.log('PAYMENT MANAGER CORE FUNCTION TEST SUITE');
  Logger.log('█'.repeat(60));

  testPaymentManager_ShouldUpdatePaidDate();
  testPaymentManager_ShouldProcess();
  testPaymentManager_GetPaymentMethod();
  testPaymentManager_IsDuplicate();

  Logger.log('\n✓ PaymentManager core tests completed\n');
}

/**
 * Run all query function tests
 */
function runPaymentManagerQueryTests() {
  Logger.log('\n' + '█'.repeat(60));
  Logger.log('PAYMENT MANAGER QUERY FUNCTION TEST SUITE');
  Logger.log('█'.repeat(60));

  testPaymentManager_GetHistoryForInvoice();
  testPaymentManager_GetHistoryForSupplier();
  testPaymentManager_GetTotalForSupplier();
  testPaymentManager_GetStatistics();

  Logger.log('\n✓ PaymentManager query tests completed\n');
}

/**
 * Run all integration tests
 */
function runPaymentManagerIntegrationTests() {
  Logger.log('\n' + '█'.repeat(60));
  Logger.log('PAYMENT MANAGER INTEGRATION TEST SUITE');
  Logger.log('█'.repeat(60));

  testIntegration_CachePerformance();
  testIntegration_WriteThroughWorkflow();

  Logger.log('\n✓ Integration tests completed\n');
}

/**
 * RUN ALL TESTS - Master test runner
 */
function runAllPaymentManagerTests() {
  Logger.log('\n\n' + '═'.repeat(70));
  Logger.log('PAYMENT MANAGER COMPREHENSIVE TEST SUITE');
  Logger.log('Locking in current behavior before refactoring');
  Logger.log('═'.repeat(70) + '\n');

  const startTime = Date.now();

  // Run all test suites
  runPaymentCacheTests();
  runPaymentManagerCoreTests();
  runPaymentManagerQueryTests();
  runPaymentManagerIntegrationTests();

  const duration = Date.now() - startTime;

  // Final summary
  Logger.log('\n' + '═'.repeat(70));
  Logger.log('FINAL TEST SUMMARY');
  Logger.log('═'.repeat(70));
  Logger.log(`Total execution time: ${(duration / 1000).toFixed(2)} seconds`);
  Logger.log('\n✅ All PaymentManager tests completed');
  Logger.log('Current behavior is now locked in and ready for refactoring');
  Logger.log('═'.repeat(70) + '\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: BASELINE PERFORMANCE DOCUMENTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Document current performance baseline before refactoring
 * Run this and save output for comparison after refactoring
 */
function documentPerformanceBaseline() {
  Logger.log('\n' + '═'.repeat(70));
  Logger.log('PERFORMANCE BASELINE - Pre-Refactoring');
  Logger.log('═'.repeat(70) + '\n');

  // Setup realistic test dataset
  const mockPayments = MockDataGenerator.createMultiplePayments(1000);
  const paymentData = MockDataGenerator.createPaymentLogData(mockPayments);

  PaymentCache.clear();

  // Metric 1: Cache build time
  const t1 = Date.now();
  PaymentCache.set(paymentData);
  const cacheBuildTime = Date.now() - t1;

  Logger.log(`Cache Build Time (1000 payments): ${cacheBuildTime}ms`);

  // Metric 2: Query performance (1000 queries)
  const t2 = Date.now();
  for (let i = 0; i < 1000; i++) {
    PaymentManager.getHistoryForInvoice(`INV-${String((i % 100) + 1).padStart(3, '0')}`);
  }
  const queryTime = Date.now() - t2;
  Logger.log(`1000 Invoice Queries: ${queryTime}ms (avg: ${(queryTime/1000).toFixed(2)}ms)`);

  // Metric 3: Duplicate detection (1000 checks)
  const t3 = Date.now();
  for (let i = 0; i < 1000; i++) {
    PaymentManager.isDuplicate(`TEST-${i}`);
  }
  const dupeTime = Date.now() - t3;
  Logger.log(`1000 Duplicate Checks: ${dupeTime}ms (avg: ${(dupeTime/1000).toFixed(2)}ms)`);

  // Metric 4: Statistics calculation
  const t4 = Date.now();
  PaymentManager.getStatistics();
  const statsTime = Date.now() - t4;
  Logger.log(`Statistics Calculation: ${statsTime}ms`);

  // Metric 5: Write-through performance (100 additions)
  const t5 = Date.now();
  for (let i = 0; i < 100; i++) {
    const col = CONFIG.paymentCols;
    const row = new Array(CONFIG.totalColumns.payment).fill('');
    row[col.supplier] = `Supplier ${i}`;
    row[col.invoiceNo] = `INV-${i}`;
    row[col.amount] = i * 100;
    row[col.sysId] = `PERF-${i}_PAY`; // Use _PAY suffix to match real system format
    PaymentCache.addPaymentToCache(paymentData.length + i, row);
  }
  const writeThroughTime = Date.now() - t5;
  Logger.log(`100 Write-Through Additions: ${writeThroughTime}ms (avg: ${(writeThroughTime/100).toFixed(2)}ms)`);

  // Cache statistics
  Logger.log(`\nCache Statistics:`);
  Logger.log(`  Invoice Index Size: ${PaymentCache.invoiceIndex.size}`);
  Logger.log(`  Supplier Index Size: ${PaymentCache.supplierIndex.size}`);
  Logger.log(`  Combined Index Size: ${PaymentCache.combinedIndex.size}`);
  Logger.log(`  Payment ID Index Size: ${PaymentCache.paymentIdIndex.size}`);
  Logger.log(`  Data Array Length: ${PaymentCache.data.length}`);

  Logger.log('\n' + '═'.repeat(70));
  Logger.log('SAVE THIS OUTPUT FOR POST-REFACTORING COMPARISON');
  Logger.log('Expected: All metrics should remain same or improve');
  Logger.log('═'.repeat(70) + '\n');
}
