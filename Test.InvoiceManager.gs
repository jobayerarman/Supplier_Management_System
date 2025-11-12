/**
 * InvoiceManager Unit Tests
 *
 * Comprehensive test suite for InvoiceManager module
 * Tests all invoice-related operations:
 * - Invoice creation with write-through cache
 * - Invoice updates (optimized and standard)
 * - Paid date updates
 * - Invoice lookups (cached)
 * - Unpaid invoice retrieval with partition awareness
 * - Invoice statistics and aggregations
 * - Formula management and repair
 * - Batch operations
 *
 * Test Framework: Custom TestUtils with assertions
 * Coverage: All public functions and critical paths
 */

// ═══════════════════════════════════════════════════════════════════════════
// TEST UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

const InvoiceTestUtils = {
  testResults: {
    passed: 0,
    failed: 0,
    errors: []
  },

  /**
   * Reset test results
   */
  resetResults: function() {
    this.testResults = {
      passed: 0,
      failed: 0,
      errors: []
    };
  },

  /**
   * Assert condition is true
   */
  assertTrue: function(condition, message) {
    if (condition) {
      this.testResults.passed++;
      Logger.log(`  ✅ ${message}`);
    } else {
      this.testResults.failed++;
      this.testResults.errors.push(message);
      Logger.log(`  ❌ FAILED: ${message}`);
    }
  },

  /**
   * Assert condition is false
   */
  assertFalse: function(condition, message) {
    this.assertTrue(!condition, message);
  },

  /**
   * Assert values are equal
   */
  assertEqual: function(actual, expected, message) {
    const passed = actual === expected;
    if (passed) {
      this.testResults.passed++;
      Logger.log(`  ✅ ${message} (expected: ${expected}, got: ${actual})`);
    } else {
      this.testResults.failed++;
      this.testResults.errors.push(`${message} - Expected ${expected} but got ${actual}`);
      Logger.log(`  ❌ FAILED: ${message} - Expected ${expected} but got ${actual}`);
    }
  },

  /**
   * Assert object is not null
   */
  assertNotNull: function(obj, message) {
    this.assertTrue(obj !== null && obj !== undefined, message);
  },

  /**
   * Print test summary
   */
  printSummary: function(testName) {
    Logger.log('\n' + '─'.repeat(80));
    Logger.log(`TEST SUMMARY: ${testName}`);
    Logger.log('─'.repeat(80));
    Logger.log(`✅ Passed: ${this.testResults.passed}`);
    Logger.log(`❌ Failed: ${this.testResults.failed}`);

    if (this.testResults.errors.length > 0) {
      Logger.log('\nErrors:');
      this.testResults.errors.forEach((err, i) => {
        Logger.log(`  ${i + 1}. ${err}`);
      });
    }
    Logger.log('');
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// MOCK DATA GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

const InvoiceTestData = {
  /**
   * Generate mock invoice data
   */
  createMockInvoiceData: function(overrides = {}) {
    return {
      supplier: 'TEST_SUPPLIER',
      invoiceNo: `INV-${Date.now()}`,
      receivedAmt: 1500,
      paymentType: 'Unpaid',
      paymentAmt: 0,
      sheetName: '01',
      rowNum: 10,
      enteredBy: 'TEST_USER',
      timestamp: new Date(),
      sysId: `test_${Date.now()}`,
      ...overrides
    };
  },

  /**
   * Generate mock existing invoice record
   */
  createMockInvoiceRecord: function(overrides = {}) {
    return {
      row: 5,
      data: [
        new Date(), // invoiceDate (A)
        'TEST_SUPPLIER', // supplier (B)
        'INV-TEST-001', // invoiceNo (C)
        1500, // totalAmount (D)
        500, // totalPaid (E)
        1000, // balanceDue (F)
        'Partial', // status (G)
        '', // paidDate (H)
        15, // daysOutstanding (I)
        '01', // originDay (J)
        'TEST_USER', // enteredBy (K)
        new Date(), // timestamp (L)
        'SYS-123' // sysId (M)
      ],
      partition: 'active',
      ...overrides
    };
  },

  /**
   * Create multiple mock invoices
   */
  createMultipleMockInvoices: function(count = 5) {
    const invoices = [];
    for (let i = 0; i < count; i++) {
      invoices.push(this.createMockInvoiceData({
        invoiceNo: `INV-MULTI-${String(i + 1).padStart(3, '0')}`,
        receivedAmt: (i + 1) * 1000
      }));
    }
    return invoices;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: INVOICE CREATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: Invoice creation returns success with invoiceId
 */
function testInvoiceCreate_Success() {
  Logger.log('\n▶️ TEST: Invoice creation returns success with invoiceId');
  InvoiceTestUtils.resetResults();

  try {
    const data = InvoiceTestData.createMockInvoiceData();
    const result = InvoiceManager.createInvoice(data);

    InvoiceTestUtils.assertTrue(result.success, 'Creation should succeed');
    InvoiceTestUtils.assertNotNull(result.invoiceId, 'Should return invoiceId');
    InvoiceTestUtils.assertEqual(result.action, 'created', 'Action should be "created"');
    InvoiceTestUtils.assertTrue(result.row > 0, 'Should return row number');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Invoice Creation - Success');
}

/**
 * Test: Duplicate invoice creation is prevented
 */
function testInvoiceCreate_DuplicatePrevention() {
  Logger.log('\n▶️ TEST: Duplicate invoice creation is prevented');
  InvoiceTestUtils.resetResults();

  try {
    const data = InvoiceTestData.createMockInvoiceData({
      invoiceNo: `INV-DUP-${Date.now()}`
    });

    // First create
    const result1 = InvoiceManager.createInvoice(data);
    InvoiceTestUtils.assertTrue(result1.success, 'First creation should succeed');

    // Second create (duplicate)
    const result2 = InvoiceManager.createInvoice(data);
    InvoiceTestUtils.assertFalse(result2.success, 'Duplicate creation should fail');
    InvoiceTestUtils.assertTrue(
      result2.error.includes('already exists'),
      'Should indicate duplicate exists'
    );

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Invoice Creation - Duplicate Prevention');
}

/**
 * Test: Invoice creation adds to cache
 */
function testInvoiceCreate_CacheWriteThrough() {
  Logger.log('\n▶️ TEST: Invoice creation adds to cache (write-through)');
  InvoiceTestUtils.resetResults();

  try {
    const supplier = 'CACHE_TEST_SUPPLIER';
    const invoiceNo = `INV-CACHE-${Date.now()}`;

    const data = InvoiceTestData.createMockInvoiceData({
      supplier: supplier,
      invoiceNo: invoiceNo
    });

    // Clear cache first
    CacheManager.clear();

    // Create invoice
    const result = InvoiceManager.createInvoice(data);
    InvoiceTestUtils.assertTrue(result.success, 'Creation should succeed');

    // Verify in cache
    const found = InvoiceManager.findInvoice(supplier, invoiceNo);
    InvoiceTestUtils.assertNotNull(found, 'Invoice should be findable in cache');
    InvoiceTestUtils.assertEqual(found.data[CONFIG.invoiceCols.invoiceNo], invoiceNo,
      'Cached invoice number should match');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Invoice Creation - Cache Write-Through');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: INVOICE LOOKUP TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: Find invoice by supplier and invoice number
 */
function testInvoiceFind_ExistingInvoice() {
  Logger.log('\n▶️ TEST: Find invoice by supplier and invoice number');
  InvoiceTestUtils.resetResults();

  try {
    const supplier = 'FIND_TEST_SUPPLIER';
    const invoiceNo = `INV-FIND-${Date.now()}`;

    // Create test invoice
    const data = InvoiceTestData.createMockInvoiceData({
      supplier: supplier,
      invoiceNo: invoiceNo
    });
    InvoiceManager.createInvoice(data);

    // Find it
    const found = InvoiceManager.findInvoice(supplier, invoiceNo);
    InvoiceTestUtils.assertNotNull(found, 'Should find existing invoice');
    InvoiceTestUtils.assertTrue(found.row > 0, 'Should return row number');
    InvoiceTestUtils.assertNotNull(found.data, 'Should return invoice data');
    InvoiceTestUtils.assertTrue(['active', 'inactive'].includes(found.partition),
      'Should indicate partition');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Invoice Find - Existing Invoice');
}

/**
 * Test: Find returns null for non-existent invoice
 */
function testInvoiceFind_NonExistentInvoice() {
  Logger.log('\n▶️ TEST: Find returns null for non-existent invoice');
  InvoiceTestUtils.resetResults();

  try {
    const found = InvoiceManager.findInvoice('NONEXISTENT_SUPPLIER', 'NONEXISTENT_INV');
    InvoiceTestUtils.assertTrue(found === null, 'Should return null for non-existent invoice');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Invoice Find - Non-Existent Invoice');
}

/**
 * Test: Find handles empty parameters
 */
function testInvoiceFind_EmptyParameters() {
  Logger.log('\n▶️ TEST: Find handles empty parameters');
  InvoiceTestUtils.resetResults();

  try {
    InvoiceTestUtils.assertTrue(InvoiceManager.findInvoice('', 'INV-001') === null,
      'Should return null for empty supplier');
    InvoiceTestUtils.assertTrue(InvoiceManager.findInvoice('SUPPLIER', '') === null,
      'Should return null for empty invoiceNo');
    InvoiceTestUtils.assertTrue(InvoiceManager.findInvoice('', '') === null,
      'Should return null for both empty');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Invoice Find - Empty Parameters');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: INVOICE UPDATE TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: Update invoice with amount change
 */
function testInvoiceUpdate_AmountChange() {
  Logger.log('\n▶️ TEST: Update invoice with amount change');
  InvoiceTestUtils.resetResults();

  try {
    const supplier = 'UPDATE_TEST_SUPPLIER';
    const invoiceNo = `INV-UPD-${Date.now()}`;

    // Create invoice
    const data = InvoiceTestData.createMockInvoiceData({
      supplier: supplier,
      invoiceNo: invoiceNo,
      receivedAmt: 1000
    });
    InvoiceManager.createInvoice(data);

    // Find it
    const existingInvoice = InvoiceManager.findInvoice(supplier, invoiceNo);
    InvoiceTestUtils.assertNotNull(existingInvoice, 'Invoice should exist');

    // Update with new amount
    const updateData = InvoiceTestData.createMockInvoiceData({
      supplier: supplier,
      receivedAmt: 2000
    });
    const result = InvoiceManager.updateInvoiceIfChanged(existingInvoice, updateData);

    InvoiceTestUtils.assertTrue(result.success, 'Update should succeed');
    InvoiceTestUtils.assertEqual(result.action, 'updated', 'Action should be "updated"');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Invoice Update - Amount Change');
}

/**
 * Test: Update with no changes returns no_change
 */
function testInvoiceUpdate_NoChanges() {
  Logger.log('\n▶️ TEST: Update with no changes returns no_change');
  InvoiceTestUtils.resetResults();

  try {
    const existingInvoice = InvoiceTestData.createMockInvoiceRecord();
    const data = InvoiceTestData.createMockInvoiceData({
      supplier: existingInvoice.data[CONFIG.invoiceCols.supplier],
      receivedAmt: existingInvoice.data[CONFIG.invoiceCols.totalAmount],
      sheetName: existingInvoice.data[CONFIG.invoiceCols.originDay]
    });

    const result = InvoiceManager.updateInvoiceIfChanged(existingInvoice, data);
    InvoiceTestUtils.assertTrue(result.success, 'Update should succeed');
    InvoiceTestUtils.assertEqual(result.action, 'no_change', 'Action should be "no_change"');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Invoice Update - No Changes');
}

/**
 * Test: Update optimized version
 */
function testInvoiceUpdate_Optimized() {
  Logger.log('\n▶️ TEST: Update optimized version');
  InvoiceTestUtils.resetResults();

  try {
    const existingInvoice = InvoiceTestData.createMockInvoiceRecord();
    const data = InvoiceTestData.createMockInvoiceData({
      receivedAmt: 2000, // Different amount
      sheetName: existingInvoice.data[CONFIG.invoiceCols.originDay]
    });

    const result = InvoiceManager.updateInvoiceIfChanged(existingInvoice, data);
    InvoiceTestUtils.assertTrue(result.success, 'Optimized update should succeed');
    InvoiceTestUtils.assertTrue(['updated', 'no_change'].includes(result.action),
      'Action should be updated or no_change');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Invoice Update - Optimized');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: INVOICE QUERY TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: Get unpaid invoices for supplier
 */
function testInvoiceGetUnpaid_PartitionAware() {
  Logger.log('\n▶️ TEST: Get unpaid invoices for supplier (partition-aware)');
  InvoiceTestUtils.resetResults();

  try {
    const supplier = 'UNPAID_TEST_SUPPLIER';

    // Create multiple invoices
    for (let i = 1; i <= 3; i++) {
      const data = InvoiceTestData.createMockInvoiceData({
        supplier: supplier,
        invoiceNo: `INV-UNPAID-${i}`,
        receivedAmt: i * 1000
      });
      InvoiceManager.createInvoice(data);
    }

    // Get unpaid invoices
    const unpaid = InvoiceManager.getUnpaidForSupplier(supplier);
    InvoiceTestUtils.assertTrue(Array.isArray(unpaid), 'Should return array');
    InvoiceTestUtils.assertTrue(unpaid.length > 0, 'Should return unpaid invoices');

    // Verify structure
    if (unpaid.length > 0) {
      InvoiceTestUtils.assertNotNull(unpaid[0].invoiceNo, 'Should have invoiceNo');
      InvoiceTestUtils.assertTrue(unpaid[0].amount > 0, 'Should have amount > 0');
    }

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Invoice Query - Get Unpaid');
}

/**
 * Test: Get unpaid returns empty for non-existent supplier
 */
function testInvoiceGetUnpaid_EmptyResult() {
  Logger.log('\n▶️ TEST: Get unpaid returns empty for non-existent supplier');
  InvoiceTestUtils.resetResults();

  try {
    const unpaid = InvoiceManager.getUnpaidForSupplier('NONEXISTENT_SUPPLIER_XYZ');
    InvoiceTestUtils.assertTrue(Array.isArray(unpaid), 'Should return array');
    InvoiceTestUtils.assertEqual(unpaid.length, 0, 'Should return empty array');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Invoice Query - Get Unpaid Empty');
}

/**
 * Test: Get all invoices for supplier
 */
function testInvoiceGetAll_IncludePaid() {
  Logger.log('\n▶️ TEST: Get all invoices for supplier (includePaid=true)');
  InvoiceTestUtils.resetResults();

  try {
    const supplier = 'ALL_INV_TEST_SUPPLIER';

    // Create invoices
    const data = InvoiceTestData.createMockInvoiceData({
      supplier: supplier,
      invoiceNo: `INV-ALL-${Date.now()}`
    });
    InvoiceManager.createInvoice(data);

    // Get all
    const invoices = InvoiceManager.getInvoicesForSupplier(supplier, true);
    InvoiceTestUtils.assertTrue(Array.isArray(invoices), 'Should return array');
    InvoiceTestUtils.assertTrue(invoices.length >= 1, 'Should return all invoices');

    // Verify structure
    if (invoices.length > 0) {
      InvoiceTestUtils.assertNotNull(invoices[0].invoiceNo, 'Should have invoiceNo');
      InvoiceTestUtils.assertNotNull(invoices[0].status, 'Should have status');
      InvoiceTestUtils.assertTrue(['active', 'inactive'].includes(invoices[0].partition),
        'Should have partition');
    }

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Invoice Query - Get All');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: INVOICE STATISTICS TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: Get invoice statistics
 */
function testInvoiceGetStatistics() {
  Logger.log('\n▶️ TEST: Get invoice statistics');
  InvoiceTestUtils.resetResults();

  try {
    const stats = InvoiceManager.getInvoiceStatistics();
    InvoiceTestUtils.assertNotNull(stats, 'Should return statistics object');
    InvoiceTestUtils.assertTrue(typeof stats.total === 'number', 'Should have total count');
    InvoiceTestUtils.assertTrue(typeof stats.unpaid === 'number', 'Should have unpaid count');
    InvoiceTestUtils.assertTrue(typeof stats.partial === 'number', 'Should have partial count');
    InvoiceTestUtils.assertTrue(typeof stats.paid === 'number', 'Should have paid count');
    InvoiceTestUtils.assertTrue(typeof stats.totalOutstanding === 'number',
      'Should have totalOutstanding');
    InvoiceTestUtils.assertEqual(
      stats.unpaid + stats.partial + stats.paid,
      stats.total,
      'Counts should sum to total'
    );

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Invoice Statistics');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: BATCH OPERATIONS TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: Batch create multiple invoices
 */
function testBatchCreate_Success() {
  Logger.log('\n▶️ TEST: Batch create multiple invoices');
  InvoiceTestUtils.resetResults();

  try {
    const invoiceArray = InvoiceTestData.createMultipleMockInvoices(3);
    const result = InvoiceManager.batchCreateInvoices(invoiceArray);

    InvoiceTestUtils.assertTrue(result.success, 'Batch create should succeed');
    InvoiceTestUtils.assertTrue(result.created > 0, 'Should create invoices');
    InvoiceTestUtils.assertEqual(result.created + result.failed, 3,
      'Created + Failed should equal total');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Batch Create - Success');
}

/**
 * Test: Batch create with duplicates
 */
function testBatchCreate_DuplicateHandling() {
  Logger.log('\n▶️ TEST: Batch create with duplicate handling');
  InvoiceTestUtils.resetResults();

  try {
    const invoiceNo = `INV-BATCH-DUP-${Date.now()}`;
    const invoiceArray = [
      InvoiceTestData.createMockInvoiceData({
        invoiceNo: invoiceNo,
        supplier: 'BATCH_SUPPLIER'
      }),
      InvoiceTestData.createMockInvoiceData({
        invoiceNo: invoiceNo, // Duplicate
        supplier: 'BATCH_SUPPLIER'
      })
    ];

    const result = InvoiceManager.batchCreateInvoices(invoiceArray);
    InvoiceTestUtils.assertTrue(result.success, 'Batch should complete');
    InvoiceTestUtils.assertTrue(result.failed > 0, 'Should fail duplicate');
    InvoiceTestUtils.assertTrue(result.errors.length > 0, 'Should have error messages');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Batch Create - Duplicate Handling');
}

/**
 * Test: Batch create with empty array
 */
function testBatchCreate_EmptyArray() {
  Logger.log('\n▶️ TEST: Batch create with empty array');
  InvoiceTestUtils.resetResults();

  try {
    const result = InvoiceManager.batchCreateInvoices([]);
    InvoiceTestUtils.assertTrue(result.success, 'Should succeed with empty array');
    InvoiceTestUtils.assertEqual(result.created, 0, 'Should create 0 invoices');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Batch Create - Empty Array');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: PROCESS FUNCTION TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: Process creates new invoice
 */
function testProcessInvoice_Create() {
  Logger.log('\n▶️ TEST: Process creates new invoice');
  InvoiceTestUtils.resetResults();

  try {
    const data = InvoiceTestData.createMockInvoiceData({
      invoiceNo: `INV-PROC-NEW-${Date.now()}`
    });
    const result = InvoiceManager.process(data);

    InvoiceTestUtils.assertTrue(result.success, 'Process should succeed');
    InvoiceTestUtils.assertEqual(result.action, 'created', 'Should create new invoice');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Process Invoice - Create');
}

/**
 * Test: Process updates existing invoice
 */
function testProcessInvoice_Update() {
  Logger.log('\n▶️ TEST: Process updates existing invoice');
  InvoiceTestUtils.resetResults();

  try {
    const supplier = 'PROC_UPD_SUPPLIER';
    const invoiceNo = `INV-PROC-UPD-${Date.now()}`;

    // Create initial invoice
    const data1 = InvoiceTestData.createMockInvoiceData({
      supplier: supplier,
      invoiceNo: invoiceNo,
      receivedAmt: 1000
    });
    InvoiceManager.process(data1);

    // Process same invoice with different amount
    const data2 = InvoiceTestData.createMockInvoiceData({
      supplier: supplier,
      invoiceNo: invoiceNo,
      receivedAmt: 2000
    });
    const result = InvoiceManager.process(data2);

    InvoiceTestUtils.assertTrue(result.success, 'Process should succeed');
    InvoiceTestUtils.assertTrue(['updated', 'no_change'].includes(result.action),
      'Should update or return no_change');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Process Invoice - Update');
}

/**
 * Test: Process optimized version
 */
function testProcessInvoice_Optimized() {
  Logger.log('\n▶️ TEST: Process optimized version');
  InvoiceTestUtils.resetResults();

  try {
    const data = InvoiceTestData.createMockInvoiceData({
      invoiceNo: `INV-PROC-OPT-${Date.now()}`
    });
    const result = InvoiceManager.processOptimized(data);

    InvoiceTestUtils.assertTrue(result.success, 'Optimized process should succeed');
    InvoiceTestUtils.assertNotNull(result.invoiceId, 'Should return invoiceId immediately');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Process Invoice - Optimized');
}

/**
 * Test: Process Due payment without invoice
 */
function testProcessInvoice_DuePaymentNoInvoice() {
  Logger.log('\n▶️ TEST: Process Due payment without invoice');
  InvoiceTestUtils.resetResults();

  try {
    const data = InvoiceTestData.createMockInvoiceData({
      paymentType: 'Due',
      invoiceNo: '' // Empty invoice number
    });
    const result = InvoiceManager.process(data);

    InvoiceTestUtils.assertTrue(result.success, 'Should succeed');
    InvoiceTestUtils.assertEqual(result.action, 'none', 'Should take no action');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Process Invoice - Due No Invoice');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: PAID DATE UPDATE TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: Update paid date when fully paid
 */
function testUpdatePaidDate() {
  Logger.log('\n▶️ TEST: Update paid date when fully paid');
  InvoiceTestUtils.resetResults();

  try {
    const supplier = 'PAID_TEST_SUPPLIER';
    const invoiceNo = `INV-PAID-${Date.now()}`;

    // Create invoice
    const data = InvoiceTestData.createMockInvoiceData({
      supplier: supplier,
      invoiceNo: invoiceNo
    });
    InvoiceManager.createInvoice(data);

    // Test updatePaidDate (will only update if balance = 0, which requires payment)
    const paymentDate = new Date();
    InvoiceManager.updatePaidDate(invoiceNo, supplier, paymentDate);

    InvoiceTestUtils.assertTrue(true, 'updatePaidDate should complete without error');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Paid Date Update');
}

/**
 * Test: Update paid date optimized
 */
function testUpdatePaidDateOptimized() {
  Logger.log('\n▶️ TEST: Update paid date optimized');
  InvoiceTestUtils.resetResults();

  try {
    const supplier = 'PAID_OPT_SUPPLIER';
    const invoiceNo = `INV-PAID-OPT-${Date.now()}`;

    // Create invoice
    const data = InvoiceTestData.createMockInvoiceData({
      supplier: supplier,
      invoiceNo: invoiceNo
    });
    InvoiceManager.createInvoice(data);

    // Test optimized version
    const paymentDate = new Date();
    InvoiceManager.updatePaidDateOptimized(invoiceNo, supplier, paymentDate);

    InvoiceTestUtils.assertTrue(true, 'updatePaidDateOptimized should complete without error');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Paid Date Update - Optimized');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 9: FORMULA MANAGEMENT TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: Set formulas for invoice row
 */
function testSetFormulas() {
  Logger.log('\n▶️ TEST: Set formulas for invoice row');
  InvoiceTestUtils.resetResults();

  try {
    const testSheet = SpreadsheetApp.getActiveSheet();
    const rowNum = 100; // Test row

    // setFormulas should not throw error
    InvoiceManager.setFormulas(testSheet, rowNum);

    InvoiceTestUtils.assertTrue(true, 'setFormulas should complete without error');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Set Formulas');
}

/**
 * Test: Repair all formulas
 */
function testRepairAllFormulas() {
  Logger.log('\n▶️ TEST: Repair all formulas');
  InvoiceTestUtils.resetResults();

  try {
    const result = InvoiceManager.repairAllFormulas();

    InvoiceTestUtils.assertTrue(result.success, 'Repair should succeed');
    InvoiceTestUtils.assertTrue(typeof result.repairedCount === 'number',
      'Should return repaired count');
    InvoiceTestUtils.assertNotNull(result.message, 'Should return message');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Repair All Formulas');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 10: DROPDOWN BUILDING TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: Build unpaid dropdown for Due payment
 */
function testBuildUnpaidDropdown_DuePayment() {
  Logger.log('\n▶️ TEST: Build unpaid dropdown for Due payment');
  InvoiceTestUtils.resetResults();

  try {
    const supplier = 'DROPDOWN_TEST_SUPPLIER';

    // Create unpaid invoice
    const data = InvoiceTestData.createMockInvoiceData({
      supplier: supplier,
      invoiceNo: `INV-DROPDOWN-${Date.now()}`
    });
    InvoiceManager.createInvoice(data);

    // Build dropdown
    const testSheet = SpreadsheetApp.getActiveSheet();
    const result = InvoiceManager.buildDuePaymentDropdown(testSheet, 50, supplier, 'Due');

    InvoiceTestUtils.assertTrue(typeof result === 'boolean', 'Should return boolean');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Build Unpaid Dropdown');
}

/**
 * Test: Clear dropdown for non-Due payment
 */
function testBuildUnpaidDropdown_ClearForNonDue() {
  Logger.log('\n▶️ TEST: Clear dropdown for non-Due payment');
  InvoiceTestUtils.resetResults();

  try {
    const testSheet = SpreadsheetApp.getActiveSheet();
    const result = InvoiceManager.buildDuePaymentDropdown(testSheet, 50, 'SUPPLIER', 'Regular');

    InvoiceTestUtils.assertTrue(result === false, 'Should return false for non-Due payment');

  } catch (error) {
    InvoiceTestUtils.assertTrue(false, `Unexpected error: ${error.toString()}`);
  }

  InvoiceTestUtils.printSummary('Build Unpaid Dropdown - Clear Non-Due');
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST RUNNERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run all InvoiceManager tests
 */
function runAllInvoiceManagerTests() {
  Logger.log('\n\n' + '═'.repeat(80));
  Logger.log('INVOICE MANAGER COMPREHENSIVE TEST SUITE');
  Logger.log('═'.repeat(80) + '\n');

  const startTime = Date.now();

  // Creation Tests
  testInvoiceCreate_Success();
  testInvoiceCreate_DuplicatePrevention();
  testInvoiceCreate_CacheWriteThrough();

  // Lookup Tests
  testInvoiceFind_ExistingInvoice();
  testInvoiceFind_NonExistentInvoice();
  testInvoiceFind_EmptyParameters();

  // Update Tests
  testInvoiceUpdate_AmountChange();
  testInvoiceUpdate_NoChanges();
  testInvoiceUpdate_Optimized();

  // Query Tests
  testInvoiceGetUnpaid_PartitionAware();
  testInvoiceGetUnpaid_EmptyResult();
  testInvoiceGetAll_IncludePaid();

  // Statistics Tests
  testInvoiceGetStatistics();

  // Batch Tests
  testBatchCreate_Success();
  testBatchCreate_DuplicateHandling();
  testBatchCreate_EmptyArray();

  // Process Tests
  testProcessInvoice_Create();
  testProcessInvoice_Update();
  testProcessInvoice_Optimized();
  testProcessInvoice_DuePaymentNoInvoice();

  // Paid Date Tests
  testUpdatePaidDate();
  testUpdatePaidDateOptimized();

  // Formula Tests
  testSetFormulas();
  testRepairAllFormulas();

  // Dropdown Tests
  testBuildUnpaidDropdown_DuePayment();
  testBuildUnpaidDropdown_ClearForNonDue();

  const duration = Date.now() - startTime;

  // Final Summary
  Logger.log('\n' + '═'.repeat(80));
  Logger.log('FINAL TEST SUMMARY');
  Logger.log('═'.repeat(80));
  Logger.log(`Total execution time: ${(duration / 1000).toFixed(2)} seconds`);
  Logger.log(`✅ Total Passed: ${InvoiceTestUtils.testResults.passed}`);
  Logger.log(`❌ Total Failed: ${InvoiceTestUtils.testResults.failed}`);

  if (InvoiceTestUtils.testResults.failed === 0) {
    Logger.log('\n🎉 ALL TESTS PASSED!');
  } else {
    Logger.log(`\n⚠️ ${InvoiceTestUtils.testResults.failed} test(s) failed`);
  }

  Logger.log('═'.repeat(80) + '\n\n');
}

/**
 * Quick smoke test (essential tests only)
 */
function quickInvoiceManagerTest() {
  Logger.log('\n' + '═'.repeat(80));
  Logger.log('QUICK INVOICE MANAGER SMOKE TEST');
  Logger.log('═'.repeat(80) + '\n');

  testInvoiceCreate_Success();
  testInvoiceFind_ExistingInvoice();
  testInvoiceGetStatistics();
  testBatchCreate_Success();
  testProcessInvoice_Create();

  Logger.log('\n' + '═'.repeat(80));
  Logger.log(`Quick test complete: ${InvoiceTestUtils.testResults.passed} passed, ${InvoiceTestUtils.testResults.failed} failed`);
  Logger.log('═'.repeat(80) + '\n');
}
