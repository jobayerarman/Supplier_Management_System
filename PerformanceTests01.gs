// ==================== PERFORMANCE TEST SUITE ====================
/**
 * Performance testing utilities for InvoiceManager cache optimization
 * Run these tests to verify cache behavior and performance improvements
 */

// ============================================================================
// SIMPLE TIMER UTILITY
// ============================================================================

class PerfTest {
  constructor(name) {
    this.name = name;
    this.times = [];
  }

  run(iterations, fn) {
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      fn();
      const duration = Date.now() - start;
      this.times.push(duration);
    }
    return this.report();
  }

  report() {
    const avg = (this.times.reduce((a, b) => a + b, 0) / this.times.length).toFixed(0);
    const min = Math.min(...this.times);
    const max = Math.max(...this.times);
    const sorted = this.times.sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];

    const grade = avg < 1000 ? '✓ EXCELLENT' : avg < 3000 ? '○ GOOD' : avg < 6000 ? '△ NEEDS IMPROVEMENT' : '✗ CRITICAL';

    return {
      name: this.name,
      iterations: this.times.length,
      avgMs: parseInt(avg),
      minMs: min,
      maxMs: max,
      p95Ms: p95,
      grade: grade
    };
  }
}

// ============================================================================
// SECTION A: SHEET READ OPERATIONS
// ============================================================================

function testSheetReads() {
  console.log('\n=== SHEET READ PERFORMANCE ===');
  
  const sheet = SpreadsheetApp.getActiveSheet();
  const testRow = 10;
  const numCols = 15;

  const batchReadTest = new PerfTest('Batch Read (1 call)');
  batchReadTest.run(10, () => {
    const range = sheet.getRange(testRow, 1, 1, numCols);
    const values = range.getValues()[0];
  });

  const individualReadTest = new PerfTest('Individual Reads (15 calls)');
  individualReadTest.run(10, () => {
    for (let col = 1; col <= numCols; col++) {
      const value = sheet.getRange(testRow, col).getValue();
    }
  });

  const mixedReadTest = new PerfTest('Mixed Reads (3 calls)');
  mixedReadTest.run(10, () => {
    const batch1 = sheet.getRange(testRow, 1, 1, 5).getValues()[0];
    const batch2 = sheet.getRange(testRow, 6, 1, 5).getValues()[0];
    const batch3 = sheet.getRange(testRow, 11, 1, 5).getValues()[0];
  });

  return [batchReadTest.report(), individualReadTest.report(), mixedReadTest.report()];
}

// ============================================================================
// SECTION B: CACHE PERFORMANCE (InvoiceManager)
// ============================================================================

function testCachePerformance() {
  console.log('\n=== CACHE PERFORMANCE TEST ===');
  
  clearInvoiceCache();
  
  // Test 1: Cold start (cache miss)
  const start1 = Date.now();
  const invoice1 = InvoiceManager.find('HEALTHCARE', '9252142078');
  const time1 = Date.now() - start1;
  console.log(`Cold start (cache miss): ${time1}ms`);
  
  // Test 2: Warm cache (cache hit)
  const start2 = Date.now();
  const invoice2 = InvoiceManager.find('HEALTHCARE', '9252142078');
  const time2 = Date.now() - start2;
  console.log(`Warm cache (cache hit): ${time2}ms`);
  
  // Test 3: Multiple queries on same cache
  const start3 = Date.now();
  for (let i = 0; i < 10; i++) {
    InvoiceManager.getUnpaidForSupplier('HEALTHCARE');
  }
  const time3 = Date.now() - start3;
  console.log(`10 queries (cached): ${time3}ms (avg: ${(time3/10).toFixed(1)}ms)`);
  
  const speedup = time1 / time2;
  console.log(`\nSpeedup: ${speedup.toFixed(1)}x faster with cache`);
  
  return {
    name: 'Cache Performance',
    coldStart: time1,
    warmCache: time2,
    speedup: speedup.toFixed(1),
    avgMs: time2,
    grade: speedup > 2 ? '✓ EXCELLENT' : '○ GOOD',
    passed: speedup > 2,
    iterations: 1
  };
}

function testCacheInvalidation() {
  console.log('\n=== CACHE INVALIDATION TEST ===');
  
  clearInvoiceCache();
  InvoiceManager.find('TestSupplier', 'TEST-001');
  
  const cached1 = InvoiceCache.get();
  console.log(`Cache loaded: ${cached1 !== null ? 'YES' : 'NO'}`);
  
  // updatePaidDate should NOT invalidate
  InvoiceManager.updatePaidDate('TEST-001', 'TestSupplier', new Date());
  const cached2 = InvoiceCache.get();
  console.log(`After updatePaidDate: ${cached2 !== null ? 'PRESERVED ✓' : 'CLEARED ✗'}`);
  
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
  console.log(`After create: ${cached3 === null ? 'CLEARED ✓' : 'PRESERVED ✗'}`);
  
  const passed = (cached2 !== null) && (cached3 === null);
  return {
    name: 'Cache Invalidation',
    paidDatePreserved: cached2 !== null,
    createCleared: cached3 === null,
    avgMs: 0,
    grade: passed ? '✓ EXCELLENT' : '✗ CRITICAL',
    passed: passed,
    iterations: 1
  };
}

function compareWithoutCache() {
  console.log('\n=== CACHE vs NO CACHE COMPARISON ===');
  
  const testSupplier = 'HEALTHCARE';
  
  // Test WITH cache
  clearInvoiceCache();
  const start1 = Date.now();
  for (let i = 0; i < 50; i++) {
    InvoiceManager.getUnpaidForSupplier(testSupplier);
  }
  const withCache = Date.now() - start1;
  console.log(`50 queries WITH cache: ${withCache}ms`);
  
  // Test WITHOUT cache (force clear each time)
  const start2 = Date.now();
  for (let i = 0; i < 50; i++) {
    clearInvoiceCache();
    InvoiceManager.getUnpaidForSupplier(testSupplier);
  }
  const withoutCache = Date.now() - start2;
  console.log(`50 queries WITHOUT cache: ${withoutCache}ms`);
  
  const improvement = ((withoutCache - withCache) / withoutCache * 100).toFixed(1);
  console.log(`\nPerformance improvement: ${improvement}% faster with cache`);
  
  return {
    name: 'Cache Impact (50 queries)',
    withCache: withCache,
    withoutCache: withoutCache,
    improvement: improvement,
    avgMs: withCache,
    grade: improvement > 50 ? '✓ EXCELLENT' : '○ GOOD',
    passed: true,
    iterations: 50
  };
}

// ============================================================================
// SECTION C: DROPDOWN CREATION PERFORMANCE
// ============================================================================

function testDropdownCreation() {
  console.log('\n=== DROPDOWN CREATION PERFORMANCE ===');
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('TestSheet') || ss.getActiveSheet();
  
  const suppliers = {
    small: ['Supplier A', 'Supplier B', 'Supplier C'],
    medium: Array.from({length: 20}, (_, i) => `Supplier ${i}`),
    large: Array.from({length: 100}, (_, i) => `Supplier ${i}`)
  };

  const smallTest = new PerfTest('Dropdown: 3 items');
  smallTest.run(5, () => {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(suppliers.small, true)
      .build();
    sheet.getRange(100, 1).setDataValidation(rule);
  });

  const mediumTest = new PerfTest('Dropdown: 20 items');
  mediumTest.run(5, () => {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(suppliers.medium, true)
      .build();
    sheet.getRange(101, 1).setDataValidation(rule);
  });

  const largeTest = new PerfTest('Dropdown: 100 items');
  largeTest.run(5, () => {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(suppliers.large, true)
      .build();
    sheet.getRange(102, 1).setDataValidation(rule);
  });

  return [smallTest.report(), mediumTest.report(), largeTest.report()];
}

function testDropdownPerformance() {
  console.log('\n=== DROPDOWN BUILD PERFORMANCE ===');
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const testSheet = ss.getSheetByName('TestSheet') || ss.getActiveSheet();
  const testRow = 10;
  
  clearInvoiceCache();
  
  // Test 1: Cold cache
  const start1 = Date.now();
  InvoiceManager.buildUnpaidDropdown(testSheet, testRow, 'HEALTHCARE', 'Due');
  const time1 = Date.now() - start1;
  console.log(`Dropdown build (cold cache): ${time1}ms`);
  
  // Test 2: Warm cache
  const start2 = Date.now();
  InvoiceManager.buildUnpaidDropdown(testSheet, testRow, 'HEALTHCARE', 'Due');
  const time2 = Date.now() - start2;
  console.log(`Dropdown build (warm cache): ${time2}ms`);
  
  // Test 3: Different supplier (same cache)
  const start3 = Date.now();
  InvoiceManager.buildUnpaidDropdown(testSheet, testRow, 'INCEPTA', 'Due');
  const time3 = Date.now() - start3;
  console.log(`Dropdown build (different supplier, cached): ${time3}ms`);
  
  const speedup = time1 / time2;
  console.log(`\nSpeedup: ${speedup.toFixed(1)}x faster with cache`);
  
  return {
    name: 'Dropdown Build Performance',
    coldCache: time1,
    warmCache: time2,
    speedup: speedup.toFixed(1),
    avgMs: time2,
    grade: time2 < 200 ? '✓ EXCELLENT' : time2 < 500 ? '○ GOOD' : '△ NEEDS IMPROVEMENT',
    passed: time2 < 200,
    iterations: 1
  };
}

// ============================================================================
// SECTION D: CELL FORMATTING OPERATIONS
// ============================================================================

function testCellFormatting() {
  console.log('\n=== CELL FORMATTING PERFORMANCE ===');
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('TestSheet') || ss.getActiveSheet();
  
  const singleFormatTest = new PerfTest('Format: 1 cell');
  singleFormatTest.run(10, () => {
    sheet.getRange(50, 1)
      .setValue('Test')
      .setBackground('#00FF00')
      .setNote('Test note');
  });

  const batchFormatTest = new PerfTest('Format: Batch 5 cells');
  batchFormatTest.run(10, () => {
    const range = sheet.getRange(51, 1, 5, 1);
    range.setBackground('#FF0000').setNote('Batch note');
  });

  const complexFormatTest = new PerfTest('Format: Complex (6 operations)');
  complexFormatTest.run(5, () => {
    sheet.getRange(56, 1)
      .clearContent()
      .clearNote()
      .setBackground(null);
    sheet.getRange(56, 2)
      .clearContent()
      .clearNote()
      .setBackground(null);
  });

  return [singleFormatTest.report(), batchFormatTest.report(), complexFormatTest.report()];
}

// ============================================================================
// SECTION E: LOCK PERFORMANCE
// ============================================================================

function testLockPerformance() {
  console.log('\n=== LOCK PERFORMANCE ===');
  
  const fastLockTest = new PerfTest('Lock: Quick acquisition');
  fastLockTest.run(5, () => {
    const lock = LockManager.acquireDocumentLock(3000);
    if (lock) LockManager.releaseLock(lock);
  });

  const contentionTest = new PerfTest('Lock: With Utilities.sleep(100ms)');
  contentionTest.run(3, () => {
    const lock = LockManager.acquireDocumentLock(5000);
    if (lock) {
      Utilities.sleep(100);
      LockManager.releaseLock(lock);
    }
  });

  return [fastLockTest.report(), contentionTest.report()];
}

// ============================================================================
// SECTION F: DATA PROCESSING
// ============================================================================

function testDataProcessing() {
  console.log('\n=== DATA PROCESSING PERFORMANCE ===');
  
  const mockData = {
    sheetName: 'Daily_2024_10_17',
    rowNum: 10,
    supplier: 'Supplier A',
    invoiceNo: 'INV-001',
    invoiceDate: new Date(),
    receivedAmt: 1000,
    paymentAmt: 1000,
    paymentType: 'Regular',
    prevInvoice: '',
    notes: 'Test transaction',
    enteredBy: 'user@example.com',
    timestamp: new Date(),
    sysId: 'UUID-12345'
  };

  const validationTest = new PerfTest('Validation: Basic checks');
  validationTest.run(100, () => {
    const isValid = mockData.supplier && 
                   mockData.invoiceNo && 
                   mockData.receivedAmt > 0;
  });

  const balanceCalcTest = new PerfTest('Balance: Calculate preview');
  balanceCalcTest.run(20, () => {
    const balance = mockData.paymentType === 'Regular' 
      ? mockData.receivedAmt - mockData.paymentAmt
      : mockData.receivedAmt;
    const note = balance === 0 ? 'Paid in full' : `Outstanding: ${balance}`;
  });

  const stringComparisonTest = new PerfTest('String: Type comparisons (3 checks)');
  stringComparisonTest.run(50, () => {
    const type = mockData.paymentType;
    const isRegular = type === 'Regular';
    const isPartial = type === 'Partial';
    const isDue = type === 'Due';
  });

  return [validationTest.report(), balanceCalcTest.report(), stringComparisonTest.report()];
}

// ============================================================================
// SECTION G: SPREADSHEET FLUSH IMPACT
// ============================================================================

function testFlushPerformance() {
  console.log('\n=== SPREADSHEET.FLUSH() IMPACT ===');
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('TestSheet') || ss.getActiveSheet();
  
  const noFlushTest = new PerfTest('Multiple writes: NO flush');
  noFlushTest.run(3, () => {
    for (let i = 0; i < 10; i++) {
      sheet.getRange(200 + i, 1).setValue(`Data ${i}`);
    }
  });

  const flushTest = new PerfTest('Multiple writes: WITH flush');
  flushTest.run(3, () => {
    for (let i = 0; i < 10; i++) {
      sheet.getRange(210 + i, 1).setValue(`Data ${i}`);
    }
    SpreadsheetApp.flush();
  });

  return [noFlushTest.report(), flushTest.report()];
}

// ============================================================================
// SECTION I: INVOICE CACHE CORRECTNESS TESTS
// ============================================================================

function testImmediateFindability() {
  console.log('\n=== IMMEDIATE FINDABILITY TEST ===');
  
  const testSupplier = 'TEST_SUPPLIER_CACHE';
  const testInvoice = `INV-TEST-${Date.now()}`;
  
  try {
    InvoiceCache.invalidateGlobal();
    console.log('✓ Cache cleared');
    
    const createData = {
      supplier: testSupplier,
      invoiceNo: testInvoice,
      sheetName: '99',
      sysId: IDGenerator.generateUUID(),
      receivedAmt: 1000,
      timestamp: new Date()
    };
    
    console.log('Creating invoice...');
    const start = Date.now();
    const createResult = InvoiceManager.create(createData);
    const createTime = Date.now() - start;
    
    if (!createResult.success) {
      return {
        name: 'Immediate Findability',
        avgMs: createTime,
        grade: '✗ CRITICAL',
        passed: false,
        error: createResult.error,
        iterations: 1
      };
    }
    
    console.log(`✓ Invoice created at row ${createResult.row} (${createTime}ms)`);
    
    // CRITICAL TEST: Find immediately
    const findStart = Date.now();
    const foundInvoice = InvoiceManager.find(testSupplier, testInvoice);
    const findTime = Date.now() - findStart;
    
    const success = foundInvoice && foundInvoice.row === createResult.row;
    
    // Cleanup
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      invoiceSh.deleteRow(createResult.row);
      InvoiceCache.invalidateGlobal();
    } catch (e) {
      console.warn(`Cleanup failed: ${e}`);
    }
    
    return {
      name: 'Immediate Findability',
      avgMs: findTime,
      createTime: createTime,
      findTime: findTime,
      grade: success ? '✓ EXCELLENT' : '✗ CRITICAL',
      passed: success,
      iterations: 1
    };
    
  } catch (error) {
    console.error(`Test failed: ${error}`);
    return {
      name: 'Immediate Findability',
      avgMs: 0,
      grade: '✗ CRITICAL',
      passed: false,
      error: error.toString(),
      iterations: 1
    };
  }
}

function testRegularPaymentFlow() {
  console.log('\n=== REGULAR PAYMENT FLOW TEST (DETAILED) ===');
  
  const testSupplier = 'TEST_SUPPLIER_REGULAR';
  const testInvoice = `INV-REG-${Date.now()}`;
  
  const timings = {
    cacheInvalidate: 0,
    invoiceCreate: 0,
    invoiceFind: 0,
    paymentProcess: 0,
    cleanup: 0,
    total: 0
  };
  
  try {
    // Timing: Cache invalidation
    const t0 = Date.now();
    InvoiceCache.invalidateGlobal();
    timings.cacheInvalidate = Date.now() - t0;
    console.log(`⏱ Cache invalidation: ${timings.cacheInvalidate}ms`);
    
    const data = {
      supplier: testSupplier,
      invoiceNo: testInvoice,
      sheetName: '99',
      sysId: IDGenerator.generateUUID(),
      receivedAmt: 1000,
      paymentAmt: 1000,
      paymentType: 'Regular',
      timestamp: new Date(),
      invoiceDate: new Date(),
      enteredBy: 'test@example.com',
      notes: 'Test regular payment'
    };
    
    const testStart = Date.now();
    
    // Step 1: Create invoice (DETAILED TIMING)
    console.log('\n[Step 1: Invoice Creation]');
    const t1 = Date.now();
    const invoiceResult = InvoiceManager.create(data);
    timings.invoiceCreate = Date.now() - t1;
    
    if (!invoiceResult.success) {
      return {
        name: 'Regular Payment Flow',
        avgMs: Date.now() - testStart,
        timings: timings,
        grade: '✗ CRITICAL',
        passed: false,
        error: `Invoice creation failed: ${invoiceResult.error}`,
        iterations: 1
      };
    }
    console.log(`✓ Invoice created at row ${invoiceResult.row}`);
    console.log(`⏱ Invoice creation time: ${timings.invoiceCreate}ms`);
    
    // Step 2: Verify findability (DETAILED TIMING)
    console.log('\n[Step 2: Invoice Findability]');
    const t2 = Date.now();
    const foundInvoice = InvoiceManager.find(testSupplier, testInvoice);
    timings.invoiceFind = Date.now() - t2;
    
    if (!foundInvoice) {
      return {
        name: 'Regular Payment Flow',
        avgMs: Date.now() - testStart,
        timings: timings,
        grade: '✗ CRITICAL',
        passed: false,
        error: 'Invoice not found after creation (cache write-through failure)',
        iterations: 1
      };
    }
    console.log(`✓ Invoice found at row ${foundInvoice.row}`);
    console.log(`⏱ Invoice find time: ${timings.invoiceFind}ms`);
    
    // Step 3: Process payment (DETAILED TIMING)
    console.log('\n[Step 3: Payment Processing]');
    const t3 = Date.now();
    const paymentResult = PaymentManager.processOptimized(data, invoiceResult.invoiceId);
    timings.paymentProcess = Date.now() - t3;
    
    if (!paymentResult.success) {
      // Quick cleanup before returning
      try {
        const invoiceSh = getSheet(CONFIG.invoiceSheet);
        invoiceSh.deleteRow(invoiceResult.row);
      } catch (e) {}
      
      return {
        name: 'Regular Payment Flow',
        avgMs: Date.now() - testStart,
        timings: timings,
        grade: '✗ CRITICAL',
        passed: false,
        error: `Payment processing failed: ${paymentResult.error}`,
        iterations: 1
      };
    }
    
    console.log(`✓ Payment processed: ${paymentResult.paymentId}`);
    console.log(`✓ Fully paid: ${paymentResult.fullyPaid}`);
    console.log(`✓ Paid date updated: ${paymentResult.paidDateUpdated}`);
    console.log(`⏱ Payment processing time: ${timings.paymentProcess}ms`);
    
    // Step 4: Cleanup (DETAILED TIMING)
    console.log('\n[Step 4: Cleanup]');
    const t4 = Date.now();
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      invoiceSh.deleteRow(invoiceResult.row);
      
      const paymentSh = getSheet(CONFIG.paymentSheet);
      paymentSh.deleteRow(paymentResult.row);
      
      InvoiceCache.invalidateGlobal();
      timings.cleanup = Date.now() - t4;
      console.log(`✓ Test data cleaned up`);
      console.log(`⏱ Cleanup time: ${timings.cleanup}ms`);
    } catch (e) {
      timings.cleanup = Date.now() - t4;
      console.warn(`⚠ Cleanup failed: ${e}`);
    }
    
    timings.total = Date.now() - testStart;
    
    // Performance analysis
    console.log('\n' + '═'.repeat(60));
    console.log('PERFORMANCE BREAKDOWN:');
    console.log('═'.repeat(60));
    console.log(`  Cache Invalidation:  ${timings.cacheInvalidate.toString().padStart(5)}ms  (${((timings.cacheInvalidate/timings.total)*100).toFixed(1)}%)`);
    console.log(`  Invoice Creation:    ${timings.invoiceCreate.toString().padStart(5)}ms  (${((timings.invoiceCreate/timings.total)*100).toFixed(1)}%)`);
    console.log(`  Invoice Find:        ${timings.invoiceFind.toString().padStart(5)}ms  (${((timings.invoiceFind/timings.total)*100).toFixed(1)}%)`);
    console.log(`  Payment Processing:  ${timings.paymentProcess.toString().padStart(5)}ms  (${((timings.paymentProcess/timings.total)*100).toFixed(1)}%)`);
    console.log(`  Cleanup:             ${timings.cleanup.toString().padStart(5)}ms  (${((timings.cleanup/timings.total)*100).toFixed(1)}%)`);
    console.log('  ' + '-'.repeat(58));
    console.log(`  TOTAL:               ${timings.total.toString().padStart(5)}ms  (100.0%)`);
    console.log('═'.repeat(60));
    
    // Identify bottleneck
    const bottleneck = Object.entries(timings)
      .filter(([key]) => key !== 'total')
      .reduce((max, [key, val]) => val > max[1] ? [key, val] : max, ['', 0]);
    
    console.log(`\n🔍 BOTTLENECK: ${bottleneck[0]} (${bottleneck[1]}ms - ${((bottleneck[1]/timings.total)*100).toFixed(1)}%)`);
    
    // Success validation
    const success = paymentResult.fullyPaid && paymentResult.paidDateUpdated;
    
    return {
      name: 'Regular Payment Flow',
      avgMs: timings.total,
      timings: timings,
      bottleneck: `${bottleneck[0]} (${bottleneck[1]}ms)`,
      grade: success ? (timings.total < 2000 ? '✓ EXCELLENT' : timings.total < 4000 ? '○ GOOD' : '△ NEEDS IMPROVEMENT') : '✗ CRITICAL',
      passed: success,
      fullyPaid: paymentResult.fullyPaid,
      paidDateUpdated: paymentResult.paidDateUpdated,
      iterations: 1
    };
    
  } catch (error) {
    console.error(`✗ Test failed: ${error}`);
    console.error(error.stack);
    return {
      name: 'Regular Payment Flow',
      avgMs: timings.total || 0,
      timings: timings,
      grade: '✗ CRITICAL',
      passed: false,
      error: error.toString(),
      iterations: 1
    };
  }
}

function testCacheDataTypes() {
  console.log('\n=== CACHE DATA TYPE INTEGRITY TEST ===');
  
  const testSupplier = 'TEST_SUPPLIER_TYPES';
  const testInvoice = `INV-TYPE-${Date.now()}`;
  
  try {
    InvoiceCache.invalidateGlobal();
    
    const createData = {
      supplier: testSupplier,
      invoiceNo: testInvoice,
      sheetName: '01',
      sysId: IDGenerator.generateUUID(),
      receivedAmt: 5000,
      timestamp: new Date()
    };
    
    console.log('Creating invoice...');
    const start = Date.now();
    const createResult = InvoiceManager.create(createData);
    
    if (!createResult.success) {
      return {
        name: 'Cache Data Type Integrity',
        avgMs: Date.now() - start,
        grade: '✗ CRITICAL',
        passed: false,
        error: createResult.error,
        iterations: 1
      };
    }
    
    console.log(`✓ Invoice created at row ${createResult.row}`);
    
    // Find and validate data types
    console.log('Reading from cache and validating data types...');
    const foundInvoice = InvoiceManager.find(testSupplier, testInvoice);
    
    if (!foundInvoice) {
      return {
        name: 'Cache Data Type Integrity',
        avgMs: Date.now() - start,
        grade: '✗ CRITICAL',
        passed: false,
        error: 'Invoice not found in cache',
        iterations: 1
      };
    }
    
    const col = CONFIG.invoiceCols;
    const checks = [
      { name: 'Total Amount', value: foundInvoice.data[col.totalAmount], expected: 'number' },
      { name: 'Total Paid', value: foundInvoice.data[col.totalPaid], expected: 'number' },
      { name: 'Balance Due', value: foundInvoice.data[col.balanceDue], expected: 'number' },
      { name: 'Status', value: foundInvoice.data[col.status], expected: 'string' }
    ];
    
    let allPassed = true;
    const errors = [];
    
    checks.forEach(check => {
      const actualType = typeof check.value;
      const isFormula = typeof check.value === 'string' && check.value.toString().startsWith('=');
      
      if (isFormula) {
        console.log(`  ✗ ${check.name}: FORMULA STRING DETECTED`);
        errors.push(`${check.name}: Formula string detected`);
        allPassed = false;
      } else if (actualType !== check.expected) {
        console.log(`  ✗ ${check.name}: Expected ${check.expected}, got ${actualType}`);
        errors.push(`${check.name}: Type mismatch`);
        allPassed = false;
      } else {
        console.log(`  ✓ ${check.name}: ${actualType} (valid)`);
      }
    });
    
    const totalTime = Date.now() - start;
    
    // Cleanup
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      invoiceSh.deleteRow(createResult.row);
      InvoiceCache.invalidateGlobal();
    } catch (e) {
      console.warn(`Cleanup failed: ${e}`);
    }
    
    return {
      name: 'Cache Data Type Integrity',
      avgMs: totalTime,
      grade: allPassed ? '✓ EXCELLENT' : '✗ CRITICAL',
      passed: allPassed,
      errors: errors.length > 0 ? errors.join(', ') : undefined,
      iterations: 1
    };
    
  } catch (error) {
    console.error(`Test failed: ${error}`);
    return {
      name: 'Cache Data Type Integrity',
      avgMs: 0,
      grade: '✗ CRITICAL',
      passed: false,
      error: error.toString(),
      iterations: 1
    };
  }
}

function debugCacheState() {
  console.log('\n=== CACHE STATE DEBUG ===');
  
  const cacheData = InvoiceCache.get();
  
  if (!cacheData) {
    console.log('Cache is EMPTY or EXPIRED');
    return {
      name: 'Cache State Debug',
      status: 'EMPTY/EXPIRED',
      avgMs: 0,
      grade: '○ INFO',
      passed: true,
      iterations: 1
    };
  }
  
  console.log(`Cache timestamp: ${new Date(InvoiceCache.timestamp)}`);
  console.log(`Cache age: ${Date.now() - InvoiceCache.timestamp}ms`);
  console.log(`Cache TTL: ${InvoiceCache.TTL}ms`);
  console.log(`Data rows: ${cacheData.data.length}`);
  console.log(`Index entries: ${cacheData.indexMap.size}`);
  console.log(`Suppliers indexed: ${cacheData.supplierIndex.size}`);
  
  console.log('\nSupplier Index:');
  let supplierCount = 0;
  for (const [supplier, rows] of cacheData.supplierIndex) {
    console.log(`  ${supplier}: ${rows.length} invoices`);
    supplierCount++;
    if (supplierCount >= 10) {
      console.log(`  ... and ${cacheData.supplierIndex.size - 10} more suppliers`);
      break;
    }
  }
  
  return {
    name: 'Cache State Debug',
    status: 'ACTIVE',
    dataRows: cacheData.data.length,
    indexEntries: cacheData.indexMap.size,
    suppliers: cacheData.supplierIndex.size,
    avgMs: 0,
    grade: '○ INFO',
    passed: true,
    iterations: 1
  };
}

function testOnEditSimulation() {
  console.log('\n=== onEdit BOTTLENECK SIMULATION ===');
  
  // Use sheet '01' (or modify to use your preferred test sheet)
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('99') || ss.getActiveSheet();
  const row = 10; // Test row (modify if needed)
  const cols = CONFIG.cols;

  const onEditPathTest = new PerfTest('onEdit: Full critical path');
  onEditPathTest.run(10, () => {
    const rowValues = sheet.getRange(row, 1, 1, CONFIG.totalColumns.daily).getValues()[0];
    
    const supplier = rowValues[cols.supplier];
    const paymentType = rowValues[cols.paymentType];
    const invoiceNo = rowValues[cols.invoiceNo];
    
    if (paymentType === 'Regular') {
      sheet.getRange(row, cols.paymentAmt + 1).clearContent();
      
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['Invoice1', 'Invoice2'], true)
        .build();
      sheet.getRange(row, cols.prevInvoice + 1).setDataValidation(rule);
      
      sheet.getRange(row, cols.balance + 1).setValue(0).setNote('Test');
    }
  });

  return [onEditPathTest.report()];
}

function testPostingWorkflow() {
  console.log('\n=== POSTING WORKFLOW TEST ===');
  
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
  const invoiceResult = InvoiceManager.process(testData);
  
  if (invoiceResult.success) {
    const balance = BalanceCalculator.getSupplierOutstanding(testData.supplier);
    const unpaid = InvoiceManager.getUnpaidForSupplier(testData.supplier);
  }
  
  const totalTime = Date.now() - start;
  console.log(`Complete posting workflow: ${totalTime}ms`);
  
  return {
    name: 'Posting Workflow',
    totalTime: totalTime,
    invoiceSuccess: invoiceResult.success,
    avgMs: totalTime,
    grade: totalTime < 2000 ? '✓ EXCELLENT' : totalTime < 4000 ? '○ GOOD' : '△ NEEDS IMPROVEMENT',
    passed: totalTime < 2000,
    iterations: 1
  };
}

// ============================================================================
// FOCUSED TEST RUNNERS
// ============================================================================

function runFocusedTests() {
  console.clear();
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  FOCUSED PERFORMANCE TESTS (3 Critical Tests)             ║');
  console.log('║  Started: ' + new Date().toLocaleTimeString() + '                          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  const results = [];

  results.push(...testDataProcessing());
  results.push(...testOnEditSimulation());
  results.push(testPostingWorkflow());

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  RESULTS SUMMARY                                          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  results.forEach(result => {
    console.log(`${result.grade} ${result.name}`);
    console.log(`   Avg: ${result.avgMs}ms | Min: ${result.minMs || '-'}ms | Max: ${result.maxMs || '-'}ms | P95: ${result.p95Ms || '-'}ms`);
    console.log(`   Iterations: ${result.iterations}\n`);
  });

  const passed = results.filter(r => r.passed !== false).length;
  const failed = results.filter(r => r.passed === false).length;
  console.log(`\nTOTAL: ${passed} PASSED | ${failed} FAILED\n`);

  exportResultsToSheet(results);
  return results;
}

function runCacheTests() {
  
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  CACHE CORRECTNESS & PERFORMANCE TESTS               ║');
  console.log('║  Started: ' + new Date().toLocaleTimeString() + '    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  const results = [];

  // results.push(testCachePerformance());
  // results.push(testCacheInvalidation());
  // results.push(compareWithoutCache());
  // results.push(testImmediateFindability());
  results.push(testRegularPaymentFlow());
  // results.push(testCacheDataTypes());
  // results.push(debugCacheState());

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  CACHE TEST RESULTS                                    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  results.forEach(result => {
    console.log(`${result.grade} ${result.name}`);
    if (result.avgMs) {
      console.log(`   Avg: ${result.avgMs}ms`);
    }
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    console.log('');
  });

  const passed = results.filter(r => r.passed !== false).length;
  const failed = results.filter(r => r.passed === false).length;
  console.log(`\nTOTAL: ${passed} PASSED | ${failed} FAILED\n`);

  exportResultsToSheet(results);
  return results;
}

// ============================================================================
// MASTER TEST RUNNER (ALL TESTS)
// ============================================================================

function runAllPerformanceTests() {
  
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  INTEGRATED PERFORMANCE TEST SUITE                   ║');
  console.log('║  Code.gs Financial Management System                 ║');
  console.log('║  Started: ' + new Date().toLocaleTimeString() + '    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  const results = [];

  // Run all test categories
  // results.push(...testSheetReads());
  results.push(testCachePerformance());
  results.push(testCacheInvalidation());
  results.push(compareWithoutCache());
  results.push(...testDropdownCreation());
  results.push(testDropdownPerformance());
  results.push(...testCellFormatting());
  results.push(...testLockPerformance());
  // results.push(...testDataProcessing());
  results.push(...testFlushPerformance());
  // results.push(...testOnEditSimulation());
  // results.push(testPostingWorkflow());

  // Print results summary
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  RESULTS SUMMARY                                     ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  results.forEach(result => {
    console.log(`${result.grade} ${result.name}`);
    console.log(`   Avg: ${result.avgMs}ms | Min: ${result.minMs || '-'}ms | Max: ${result.maxMs || '-'}ms | P95: ${result.p95Ms || '-'}ms`);
    console.log(`   Iterations: ${result.iterations}\n`);
  });

  // Count test results
  const passed = results.filter(r => r.passed !== false).length;
  const failed = results.filter(r => r.passed === false).length;
  console.log(`\nTOTAL: ${passed} PASSED | ${failed} FAILED\n`);

  exportResultsToSheet(results);
  return results;
}

// ============================================================================
// EXPORT TO SHEET
// ============================================================================

function exportResultsToSheet(results) {
  try {
    const ss = SpreadsheetApp.getActive();
    let sheet = ss.getSheetByName('PerfResults');
    
    if (!sheet) {
      sheet = ss.insertSheet('PerfResults');
    }

    sheet.clearContents();
    
    // Header with detailed columns
    sheet.appendRow([
      'Test Name', 
      'Grade', 
      'Avg (ms)', 
      'Min (ms)', 
      'Max (ms)', 
      'P95 (ms)', 
      'Iterations', 
      'Bottleneck',
      'Details',
      'Timestamp'
    ]);
    
    // Data rows with conditional detail rendering
    results.forEach(result => {
      let details = '';
      
      // Add timing breakdown for detailed tests
      if (result.timings) {
        details = `Create:${result.timings.invoiceCreate}ms | Find:${result.timings.invoiceFind}ms | Payment:${result.timings.paymentProcess}ms | Cleanup:${result.timings.cleanup}ms`;
      }
      
      // Add error details if present
      if (result.error) {
        details = details ? `${details} | Error: ${result.error}` : `Error: ${result.error}`;
      }
      
      // Add extra info for cache tests
      if (result.speedup) {
        details = `Speedup: ${result.speedup}x`;
      }
      if (result.improvement) {
        details = `Improvement: ${result.improvement}%`;
      }
      
      sheet.appendRow([
        result.name,
        result.grade,
        result.avgMs,
        result.minMs || '-',
        result.maxMs || '-',
        result.p95Ms || '-',
        result.iterations,
        result.bottleneck || '-',
        details || '-',
        new Date().toLocaleString()
      ]);
    });

    // Format header
    const headerRange = sheet.getRange(1, 1, 1, 10);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4285F4');
    headerRange.setFontColor('#FFFFFF');
    
    // Auto-resize columns
    // for (let i = 1; i <= 10; i++) {
    //   sheet.autoResizeColumn(i);
    // }
    
    // Add summary section
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 2, 1).setValue('SUMMARY');
    sheet.getRange(lastRow + 2, 1).setFontWeight('bold');
    
    const passed = results.filter(r => r.passed !== false).length;
    const failed = results.filter(r => r.passed === false).length;
    const avgTime = (results.reduce((sum, r) => sum + (r.avgMs || 0), 0) / results.length).toFixed(0);
    
    sheet.getRange(lastRow + 3, 1, 4, 2).setValues([
      ['Total Tests:', results.length],
      ['Passed:', passed],
      ['Failed:', failed],
      ['Avg Time:', `${avgTime}ms`]
    ]);

    console.log('✓ Results exported to "PerfResults" sheet');
  } catch (e) {
    console.error('Failed to export results: ' + e);
  }
}

// ============================================================================
// QUICK TEST FUNCTIONS
// ============================================================================

function quickTestSheetReads() {
  const results = testSheetReads();
  results.forEach(r => console.log(`${r.grade} ${r.name} - ${r.avgMs}ms avg`));
}

function quickTestCache() {
  const result = testCachePerformance();
  console.log(`${result.grade} ${result.name} - ${result.speedup}x speedup`);
}

function quickTestDropdowns() {
  const results = testDropdownCreation();
  results.forEach(r => console.log(`${r.grade} ${r.name} - ${r.avgMs}ms avg`));
}

function quickTestFormatting() {
  const results = testCellFormatting();
  results.forEach(r => console.log(`${r.grade} ${r.name} - ${r.avgMs}ms avg`));
}

function quickTestOnEdit() {
  const results = testOnEditSimulation();
  results.forEach(r => console.log(`${r.grade} ${r.name} - ${r.avgMs}ms avg`));
}

function quickTestPosting() {
  const result = testPostingWorkflow();
  console.log(`${result.grade} ${result.name} - ${result.totalTime}ms`);
}

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

// function runAllPerformanceTests() {
//   const results = PerformanceTests.runAllTests();
//   // SpreadsheetApp.getUi().alert(
//     'Performance Tests Complete',
//     'Check the Execution Log (View > Execution Log) for detailed results.',
//     SpreadsheetApp.getUi().ButtonSet.OK
//   // );
// }

// function testCachePerformance() {
//   PerformanceTests.testCachePerformance();
//   // SpreadsheetApp.getUi().alert('Test complete. Check execution log.');
// }

// function testDropdownPerformance() {
//   PerformanceTests.testDropdownPerformance();
//   // SpreadsheetApp.getUi().alert('Test complete. Check execution log.');
// }

// function testPostingWorkflow() {
//   PerformanceTests.testPostingWorkflow();
//   // SpreadsheetApp.getUi().alert('Test complete. Check execution log.');
// }

// function comparePerformance() {
//   PerformanceTests.compareWithoutCache();
//   // SpreadsheetApp.getUi().alert('Comparison complete. Check execution log.');
// }

// function clearCacheManually() {
//   clearInvoiceCache();
//   // SpreadsheetApp.getUi().alert('Cache cleared successfully!');
// }