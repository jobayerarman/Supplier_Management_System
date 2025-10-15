// ==================== PERFORMANCE TEST SUITE ====================
/**
 * Performance testing utilities for InvoiceManager cache optimization
 * Run these tests to verify cache behavior and performance improvements
 */

const PerformanceTests = {
  
  /**
   * Test cache hit/miss performance
   */
  testCachePerformance: function() {
    Logger.log('=== CACHE PERFORMANCE TEST ===');
    
    // Clear cache to start fresh
    clearInvoiceCache();
    
    // Test 1: Cold start (cache miss)
    const start1 = Date.now();
    const invoice1 = InvoiceManager.find('HEALTHCARE', '9252142078');
    const time1 = Date.now() - start1;
    Logger.log(`Cold start (cache miss): ${time1}ms`);
    
    // Test 2: Warm cache (cache hit)
    const start2 = Date.now();
    const invoice2 = InvoiceManager.find('HEALTHCARE', '9252142078');
    const time2 = Date.now() - start2;
    Logger.log(`Warm cache (cache hit): ${time2}ms`);
    
    // Test 3: Multiple queries on same cache
    const start3 = Date.now();
    for (let i = 0; i < 10; i++) {
      InvoiceManager.getUnpaidForSupplier('HEALTHCARE');
    }
    const time3 = Date.now() - start3;
    Logger.log(`10 queries (cached): ${time3}ms (avg: ${time3/10}ms)`);
    
    // Results
    const speedup = time1 / time2;
    Logger.log(`\nSpeedup: ${speedup.toFixed(1)}x faster with cache`);
    
    return {
      coldStart: time1,
      warmCache: time2,
      speedup: speedup,
      passed: speedup > 2 // Cache should be at least 2x faster
    };
  },
  
  /**
   * Test cache invalidation behavior
   */
  testCacheInvalidation: function() {
    Logger.log('\n=== CACHE INVALIDATION TEST ===');
    
    // Clear and load cache
    clearInvoiceCache();
    InvoiceManager.find('TestSupplier', 'TEST-001');
    
    // Check cache exists
    const cached1 = InvoiceCache.get();
    Logger.log(`Cache loaded: ${cached1 !== null ? 'YES' : 'NO'}`);
    
    // Test selective invalidation
    Logger.log('\nTesting selective invalidation...');
    
    // updatePaidDate should NOT invalidate
    InvoiceManager.updatePaidDate('TEST-001', 'TestSupplier', new Date());
    const cached2 = InvoiceCache.get();
    Logger.log(`After updatePaidDate: ${cached2 !== null ? 'PRESERVED ✓' : 'CLEARED ✗'}`);
    
    // create should invalidate
    InvoiceManager.create({
      supplier: 'NewSupplier',
      invoiceNo: 'NEW-001',
      receivedAmt: 1000,
      timestamp: new Date(),
      sheetName: 'TestSheet',
      sysId: IDGenerator.generateUUID()
    });
    const cached3 = InvoiceCache.get();
    Logger.log(`After create: ${cached3 === null ? 'CLEARED ✓' : 'PRESERVED ✗'}`);
    
    return {
      paidDatePreserved: cached2 !== null,
      createCleared: cached3 === null,
      passed: (cached2 !== null) && (cached3 === null)
    };
  },
  
  /**
   * Test dropdown build performance
   */
  testDropdownPerformance: function() {
    Logger.log('\n=== DROPDOWN PERFORMANCE TEST ===');
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const testSheet = ss.getSheetByName('TestSheet') || ss.getActiveSheet();
    const testRow = 10;
    
    // Clear cache
    clearInvoiceCache();
    
    // Test 1: Cold cache
    const start1 = Date.now();
    InvoiceManager.buildUnpaidDropdown(testSheet, testRow, 'HEALTHCARE', 'Due');
    const time1 = Date.now() - start1;
    Logger.log(`Dropdown build (cold cache): ${time1}ms`);
    
    // Test 2: Warm cache
    const start2 = Date.now();
    InvoiceManager.buildUnpaidDropdown(testSheet, testRow, 'HEALTHCARE', 'Due');
    const time2 = Date.now() - start2;
    Logger.log(`Dropdown build (warm cache): ${time2}ms`);
    
    // Test 3: Different supplier (same cache)
    const start3 = Date.now();
    InvoiceManager.buildUnpaidDropdown(testSheet, testRow, 'INCEPTA', 'Due');
    const time3 = Date.now() - start3;
    Logger.log(`Dropdown build (different supplier, cached): ${time3}ms`);
    
    const speedup = time1 / time2;
    Logger.log(`\nSpeedup: ${speedup.toFixed(1)}x faster with cache`);
    
    return {
      coldCache: time1,
      warmCache: time2,
      speedup: speedup,
      passed: time2 < 200 // Should be under 200ms with cache
    };
  },
  
  /**
   * Test posting workflow performance
   */
  testPostingWorkflow: function() {
    Logger.log('\n=== POSTING WORKFLOW TEST ===');
    
    clearInvoiceCache();
    
    const testData = {
      supplier: 'TestSupplier',
      invoiceNo: 'PERF-' + Date.now(),
      receivedAmt: 5000,
      paymentAmt: 5000,
      paymentType: 'Regular',
      prevInvoice: '',
      notes: 'Performance test',
      timestamp: new Date(),
      sheetName: 'TEST',
      sysId: IDGenerator.generateUUID(),
      invoiceDate: new Date(),
      enteredBy: 'test@example.com',
      rowNum: 10
    };
    
    const start = Date.now();
    
    // Simulate posting workflow
    const invoiceResult = InvoiceManager.process(testData);
    
    if (invoiceResult.success) {
      const balance = BalanceCalculator.getSupplierOutstanding(testData.supplier);
      const unpaid = InvoiceManager.getUnpaidForSupplier(testData.supplier);
    }
    
    const totalTime = Date.now() - start;
    Logger.log(`Complete posting workflow: ${totalTime}ms`);
    
    return {
      totalTime: totalTime,
      invoiceSuccess: invoiceResult.success,
      passed: totalTime < 2000 // Should complete under 2 seconds
    };
  },
  
  /**
   * Test cache TTL expiration
   */
  testCacheTTL: function() {
    Logger.log('\n=== CACHE TTL TEST ===');
    
    clearInvoiceCache();
    
    // Load cache
    InvoiceManager.find('INCEPTA', 'TEST-001');
    Logger.log('Cache loaded');
    
    // Check immediate
    const cached1 = InvoiceCache.get();
    Logger.log(`Immediate check: ${cached1 !== null ? 'VALID ✓' : 'EXPIRED ✗'}`);
    
    // Wait for TTL + 1 second
    Logger.log(`Waiting ${InvoiceCache.TTL + 1000}ms for cache expiration...`);
    Utilities.sleep(InvoiceCache.TTL + 1000);
    
    // Check after TTL
    const cached2 = InvoiceCache.get();
    Logger.log(`After TTL: ${cached2 === null ? 'EXPIRED ✓' : 'STILL VALID ✗'}`);
    
    return {
      immediateValid: cached1 !== null,
      expiredAfterTTL: cached2 === null,
      passed: (cached1 !== null) && (cached2 === null)
    };
  },
  
  /**
   * Run all performance tests
   */
  runAllTests: function() {
    Logger.log('╔════════════════════════════════════════════╗');
    Logger.log('║  INVOICE MANAGER PERFORMANCE TEST SUITE   ║');
    Logger.log('╚════════════════════════════════════════════╝\n');
    
    const results = {
      cache: this.testCachePerformance(),
      invalidation: this.testCacheInvalidation(),
      dropdown: this.testDropdownPerformance(),
      posting: this.testPostingWorkflow(),
      ttl: this.testCacheTTL()
    };
    
    // Summary
    Logger.log('\n╔════════════════════════════════════════════╗');
    Logger.log('║              TEST SUMMARY                  ║');
    Logger.log('╚════════════════════════════════════════════╝');
    
    const allPassed = Object.values(results).every(r => r.passed);
    
    Logger.log(`Cache Performance: ${results.cache.passed ? '✓ PASS' : '✗ FAIL'}`);
    Logger.log(`Cache Invalidation: ${results.invalidation.passed ? '✓ PASS' : '✗ FAIL'}`);
    Logger.log(`Dropdown Performance: ${results.dropdown.passed ? '✓ PASS' : '✗ FAIL'}`);
    Logger.log(`Posting Workflow: ${results.posting.passed ? '✓ PASS' : '✗ FAIL'}`);
    Logger.log(`Cache TTL: ${results.ttl.passed ? '✓ PASS' : '✗ FAIL'}`);
    
    Logger.log(`\n${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
    
    return results;
  },
  
  /**
   * Compare performance with/without cache
   */
  compareWithoutCache: function() {
    Logger.log('\n=== CACHE vs NO CACHE COMPARISON ===');
    
    const testSupplier = 'HEALTHCARE';
    
    // Test WITH cache
    clearInvoiceCache();
    const start1 = Date.now();
    for (let i = 0; i < 20; i++) {
      InvoiceManager.getUnpaidForSupplier(testSupplier);
    }
    const withCache = Date.now() - start1;
    Logger.log(`20 queries WITH cache: ${withCache}ms`);
    
    // Test WITHOUT cache (force clear each time)
    const start2 = Date.now();
    for (let i = 0; i < 20; i++) {
      clearInvoiceCache();
      InvoiceManager.getUnpaidForSupplier(testSupplier);
    }
    const withoutCache = Date.now() - start2;
    Logger.log(`20 queries WITHOUT cache: ${withoutCache}ms`);
    
    const improvement = ((withoutCache - withCache) / withoutCache * 100).toFixed(1);
    Logger.log(`\nPerformance improvement: ${improvement}% faster with cache`);
    
    return {
      withCache: withCache,
      withoutCache: withoutCache,
      improvement: improvement
    };
  }
};

// ==================== MENU FUNCTIONS ====================

/**
 * Add performance testing menu
 */
function addPerformanceTestMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🔬 Performance Tests')
    .addItem('Run All Tests', 'runAllPerformanceTests')
    .addSeparator()
    .addItem('Test Cache Performance', 'testCachePerformance')
    .addItem('Test Dropdown Performance', 'testDropdownPerformance')
    .addItem('Test Posting Workflow', 'testPostingWorkflow')
    .addItem('Compare With/Without Cache', 'comparePerformance')
    .addSeparator()
    .addItem('Clear Cache Manually', 'clearCacheManually')
    .addToUi();
}

function runAllPerformanceTests() {
  const results = PerformanceTests.runAllTests();
  // SpreadsheetApp.getUi().alert(
    'Performance Tests Complete',
    'Check the Execution Log (View > Execution Log) for detailed results.',
    SpreadsheetApp.getUi().ButtonSet.OK
  // );
}

function testCachePerformance() {
  PerformanceTests.testCachePerformance();
  // SpreadsheetApp.getUi().alert('Test complete. Check execution log.');
}

function testDropdownPerformance() {
  PerformanceTests.testDropdownPerformance();
  // SpreadsheetApp.getUi().alert('Test complete. Check execution log.');
}

function testPostingWorkflow() {
  PerformanceTests.testPostingWorkflow();
  // SpreadsheetApp.getUi().alert('Test complete. Check execution log.');
}

function comparePerformance() {
  PerformanceTests.compareWithoutCache();
  // SpreadsheetApp.getUi().alert('Comparison complete. Check execution log.');
}

function clearCacheManually() {
  clearInvoiceCache();
  // SpreadsheetApp.getUi().alert('Cache cleared successfully!');
}