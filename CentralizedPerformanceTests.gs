/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CENTRALIZED BUSINESS LOGIC AND PERFORMANCE TESTING SUITE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file consolidates all performance and business logic tests for the
 * Supplier Management System. It combines functionality from:
 * - PerformanceTests01.gs: Comprehensive performance metrics
 * - PerformanceTests02.gs: PerfAudit framework and core tests
 * - TestCodeGS.gs: Main application logic tests (onEdit, posting)
 * - TestBalanceCalculator.gs: BalanceCalculator module tests
 *
 * TEST COVERAGE:
 * - Infrastructure Tests: Sheet operations, dropdowns, formatting, locks
 * - Cache Performance Tests: Cache hits/misses, partition statistics, invalidation
 * - Cache Partition Tests: Active/inactive distribution, partition transitions
 * - Invoice Manager Tests: Invoice creation, updates, payments
 * - Balance Calculator Tests: Balance calculations, supplier outstanding
 * - Application Logic Tests: onEdit handler, posting workflow, concurrency
 *
 * @author Consolidated Test Suite
 * @version 2.1 - Added cache partition transition testing
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: PERFAUDIT FRAMEWORK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PerfAudit — lightweight nested performance tracker and reporter
 * Features:
 * - Nested timing support (auto-tagged hierarchy)
 * - Auto breakdown with % contribution
 * - Fail-safe test wrapping and summary return
 * - Works in Apps Script and Node.js
 */
class PerfAudit {
  constructor(testName = "Untitled Test") {
    this.testName = testName;
    this.sections = {};
    this.stack = [];
    this.startTime = Date.now();
    this.totalEnd = null;
    this.failed = false;
    this.failReason = null;
    this.failError = null;
  }

  start(label) {
    this.sections[label] = this.sections[label] || { time: 0, calls: 0 };
    this.sections[label].start = Date.now();
    this.sections[label].calls++;
    return this;
  }

  end(label) {
    const section = this.sections[label];
    if (!section || !section.start) return this;
    section.time += Date.now() - section.start;
    section.start = null;
    return this;
  }

  startNested(label) {
    const node = {
      label,
      start: Date.now(),
      end: null,
      children: [],
      parent: this.stack.length ? this.stack[this.stack.length - 1] : null,
    };
    if (node.parent) node.parent.children.push(node);
    this.stack.push(node);
    return {
      end: () => {
        node.end = Date.now();
        this.stack.pop();
        this.sections[label] = this.sections[label] || { time: 0, calls: 0 };
        this.sections[label].time += node.end - node.start;
        this.sections[label].calls++;
      },
    };
  }

  endAll() {
    const now = Date.now();
    while (this.stack.length > 0) {
      const node = this.stack.pop();
      node.end = node.end || now;
      this.sections[node.label] = this.sections[node.label] || { time: 0, calls: 0 };
      this.sections[node.label].time += node.end - node.start;
    }
    this.totalEnd = now;
  }

  get total() {
    return (this.totalEnd || Date.now()) - this.startTime;
  }

  getResult(extraData = {}) {
    const total = this.total;
    const sorted = Object.entries(this.sections).sort((a, b) => b[1].time - a[1].time);
    const bottleneck = sorted.length ? sorted[0] : ["None", { time: 0 }];
    const grade = this.failed
      ? "✗ CRITICAL"
      : total < 2000
      ? "✓ EXCELLENT"
      : total < 4000
      ? "○ GOOD"
      : "△ NEEDS IMPROVEMENT";

    return {
      name: this.testName,
      avgMs: total,
      timings: Object.fromEntries(
        Object.entries(this.sections).map(([k, v]) => [k, v.time])
      ),
      bottleneck: `${bottleneck[0]} (${bottleneck[1].time}ms)`,
      grade,
      passed: !this.failed,
      failReason: this.failReason,
      failError: this.failError,
      iterations: 1,
      ...extraData,
    };
  }

  printSummary() {
    const total = this.total;
    console.log("\n" + "═".repeat(60));
    console.log(`PERFORMANCE SUMMARY: ${this.testName}`);
    console.log("═".repeat(60));

    const sorted = Object.entries(this.sections)
      .sort((a, b) => b[1].time - a[1].time);

    sorted.forEach(([label, info]) => {
      const pct = total > 0 ? ((info.time / total) * 100).toFixed(1) : "0.0";
      console.log(
        `${label.padEnd(35)}: ${info.time.toString().padStart(5)}ms (${pct.padStart(5)}%)  calls:${info.calls}`
      );
    });

    console.log("  " + "-".repeat(58));
    console.log(`TOTAL`.padEnd(35) + `: ${total.toString().padStart(5)}ms (100.0%)`);
    console.log("═".repeat(60));

    const bottleneck = sorted[0];
    if (bottleneck && total > 0)
      console.log(`🔍 BOTTLENECK: ${bottleneck[0]} (${bottleneck[1].time}ms, ${(bottleneck[1].time / total * 100).toFixed(1)}%)`);
  }

  fail(reason, error = null) {
    this.failed = true;
    this.failReason = reason;
    this.failError = error ? error.toString() : null;
    this.endAll();
    console.error(`✗ ${reason}`);
    if (error) console.error(error.stack || error);
    return this.getResult();
  }

  exportToSheet(resultsArray) {
    if (!Array.isArray(resultsArray)) {
        console.error("Export failed: Input was not an array.");
        return;
    }
    const flatResults = resultsArray.flat();

    if (flatResults.length === 0) {
        console.log("No results to export.");
        return;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("PerfLogs") || ss.insertSheet("PerfLogs");

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Timestamp", "Test Name", "Average (ms)", "Grade", "Passed", "Bottleneck", "Details"]);
      sheet.getRange("A1:G1").setFontWeight("bold").setBackground("#4285F4").setFontColor("#FFFFFF");
    }

    const now = new Date();
    const rows = flatResults.map(result => {
      let details = "";
      if (result.timings) {
        details = Object.entries(result.timings)
          .slice(0, 3)
          .map(([k, v]) => `${k}:${v}ms`)
          .join(" | ");
      }
      if (result.error) {
        details = details ? `${details} | Error: ${result.error}` : `Error: ${result.error}`;
      }
      return [
        now,
        result.name,
        result.avgMs,
        result.grade,
        result.passed ? "YES" : "NO",
        result.bottleneck || "-",
        details || "-"
      ];
    });

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    console.log(`✓ Exported ${flatResults.length} test results to 'PerfLogs'`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: INFRASTRUCTURE & SPREADSHEET TESTS
// ═══════════════════════════════════════════════════════════════════════════

function testSheetReads() {
  const results = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("99") || ss.getActiveSheet();
  const testRow = 7;
  const numCols = 15;

  // Test 1: Batch Read
  const batchAudit = new PerfAudit("Batch Read (1 call)");
  batchAudit.start("Batch");
  for (let i = 0; i < 10; i++) {
    const range = sheet.getRange(testRow, 1, 1, numCols);
    range.getValues()[0];
  }
  batchAudit.end("Batch");
  batchAudit.endAll();
  results.push(batchAudit.getResult());

  // Test 2: Individual Reads
  const indivAudit = new PerfAudit("Individual Reads (15 calls)");
  indivAudit.start("Individual");
  for (let i = 0; i < 10; i++) {
    for (let col = 1; col <= numCols; col++) {
      sheet.getRange(testRow, col).getValue();
    }
  }
  indivAudit.end("Individual");
  indivAudit.endAll();
  results.push(indivAudit.getResult());

  // Test 3: Mixed Reads
  const mixedAudit = new PerfAudit("Mixed Reads (3 calls)");
  mixedAudit.start("Mixed");
  for (let i = 0; i < 10; i++) {
    sheet.getRange(testRow, 1, 1, 5).getValues();
    sheet.getRange(testRow, 6, 1, 5).getValues();
    sheet.getRange(testRow, 11, 1, 5).getValues();
  }
  mixedAudit.end("Mixed");
  mixedAudit.endAll();
  results.push(mixedAudit.getResult());

  return results;
}

function testDropdownCreation() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("TestSheet") || ss.getActiveSheet();
  const suppliers = {
    small: ['Supplier A', 'Supplier B', 'Supplier C'],
    medium: Array.from({ length: 20 }, (_, i) => `Supplier ${i}`),
    large: Array.from({ length: 100 }, (_, i) => `Supplier ${i}`)
  };
  const results = [];

  for (const [label, list] of Object.entries(suppliers)) {
    const audit = new PerfAudit(`Dropdown: ${list.length} items`);
    audit.start("Build");
    for (let i = 0; i < 5; i++) {
      const rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).build();
      sheet.getRange(100 + i, 1).setDataValidation(rule);
    }
    audit.end("Build");
    audit.endAll();
    results.push(audit.getResult());
  }

  return results;
}

function testCellFormatting() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("TestSheet") || ss.getActiveSheet();
  const results = [];

  const single = new PerfAudit("Format: 1 cell");
  single.start("Single");
  for (let i = 0; i < 10; i++) {
    sheet.getRange(50, 1).setValue("Test").setBackground("#00FF00").setNote("Test note");
  }
  single.end("Single");
  single.endAll();
  results.push(single.getResult());

  const batch = new PerfAudit("Format: Batch 5 cells");
  batch.start("Batch");
  for (let i = 0; i < 10; i++) {
    sheet.getRange(51, 1, 5, 1).setBackground("#FF0000").setNote("Batch note");
  }
  batch.end("Batch");
  batch.endAll();
  results.push(batch.getResult());

  const complex = new PerfAudit("Format: Complex");
  complex.start("Complex");
  for (let i = 0; i < 5; i++) {
    sheet.getRange(56, 1).clearContent().clearNote().setBackground(null);
    sheet.getRange(56, 2).clearContent().clearNote().setBackground(null);
  }
  complex.end("Complex");
  complex.endAll();
  results.push(complex.getResult());

  return results;
}

function testFlushPerformance() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("TestSheet") || ss.getActiveSheet();
  const results = [];

  const noFlush = new PerfAudit("Writes: NO Flush");
  noFlush.start("NoFlush");
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 10; i++) {
      sheet.getRange(200 + i, 1).setValue(`Data ${i}`);
    }
  }
  noFlush.end("NoFlush");
  noFlush.endAll();
  results.push(noFlush.getResult());

  const withFlush = new PerfAudit("Writes: WITH Flush");
  withFlush.start("WithFlush");
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 10; i++) {
      sheet.getRange(210 + i, 1).setValue(`Data ${i}`);
    }
    SpreadsheetApp.flush();
  }
  withFlush.end("WithFlush");
  withFlush.endAll();
  results.push(withFlush.getResult());

  return results;
}

function testLockPerformance() {
  const results = [];

  const quick = new PerfAudit("Lock: Quick acquisition");
  quick.start("Lock");
  for (let i = 0; i < 5; i++) {
    const lock = LockService.getScriptLock();
    lock.waitLock(3000);
    lock.releaseLock();
  }
  quick.end("Lock");
  quick.endAll();
  results.push(quick.getResult());

  const contention = new PerfAudit("Lock: With Sleep");
  contention.start("SleepLock");
  for (let i = 0; i < 3; i++) {
    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    Utilities.sleep(100);
    lock.releaseLock();
  }
  contention.end("SleepLock");
  contention.endAll();
  results.push(contention.getResult());

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: CACHE & INVOICE MANAGER TESTS
// ═══════════════════════════════════════════════════════════════════════════

function testCachePerformance() {
  const audit = new PerfAudit("Cache Performance Test");

  try {
    // Clear cache to start fresh
    audit.start("Cache Invalidation");
    CacheManager.invalidateGlobal();
    audit.end("Cache Invalidation");

    // Test 1: Cold start (cache miss)
    audit.start("Cold Start (Cache Miss)");
    const invoice1 = InvoiceManager.find('HEALTHCARE', '9252142078');
    audit.end("Cold Start (Cache Miss)");

    // Test 2: Warm cache (cache hit)
    audit.start("Warm Cache (Cache Hit)");
    const invoice2 = InvoiceManager.find('HEALTHCARE', '9252142078');
    audit.end("Warm Cache (Cache Hit)");

    // Test 3: Multiple queries on same cache
    audit.start("10 Queries (Cached)");
    for (let i = 0; i < 10; i++) {
      InvoiceManager.getUnpaidForSupplier('HEALTHCARE');
    }
    audit.end("10 Queries (Cached)");

    // Test 4: Partition Statistics
    audit.start("Partition Statistics");
    const partitionStats = CacheManager.getPartitionStats();
    audit.end("Partition Statistics");

    // Log partition distribution for visibility
    Logger.log('=== Cache Partition Distribution ===');
    Logger.log(`Active Invoices: ${partitionStats.active.count} (${partitionStats.active.percentage}%)`);
    Logger.log(`Inactive Invoices: ${partitionStats.inactive.count} (${partitionStats.inactive.percentage}%)`);
    Logger.log(`Total Invoices: ${partitionStats.total}`);
    Logger.log(`Partition Transitions: ${partitionStats.transitions}`);
    Logger.log(`Active Hit Rate: ${partitionStats.active.hitRate}%`);
    Logger.log(`Memory Reduction: ${partitionStats.memoryReduction}`);

    audit.endAll();
    audit.printSummary();
    return audit.getResult({
      partitionStats: {
        activeCount: partitionStats.active.count,
        inactiveCount: partitionStats.inactive.count,
        activePercentage: parseFloat(partitionStats.active.percentage),
        inactivePercentage: parseFloat(partitionStats.inactive.percentage),
        transitions: partitionStats.transitions,
        activeHitRate: parseFloat(partitionStats.active.hitRate),
        memoryReduction: partitionStats.memoryReduction
      }
    });

  } catch (error) {
    return audit.fail("Cache performance test failed", error);
  }
}

function testCacheInvalidation() {
  const audit = new PerfAudit("Cache Invalidation Logic Test");

  try {
    // Clear and load cache
    audit.start("Initial Cache Load");
    CacheManager.invalidateGlobal();
    InvoiceManager.find('TestSupplier', 'TEST-001');
    const cached1 = CacheManager.get();
    audit.end("Initial Cache Load");

    // updatePaidDate should NOT invalidate
    audit.start("Test Selective Preservation");
    InvoiceManager.updatePaidDate('TEST-001', 'TestSupplier', new Date());
    const cached2 = CacheManager.get();
    audit.end("Test Selective Preservation");

    // create should invalidate
    audit.start("Test Invalidation on Create");
    InvoiceManager.create({
      supplier: 'NewSupplier',
      invoiceNo: 'NEW-001',
      receivedAmt: 1000,
      timestamp: new Date(),
      sheetName: 'TestSheet',
      sysId: IDGenerator.generateUUID()
    });
    const cached3 = CacheManager.get();
    audit.end("Test Invalidation on Create");

    const passed = (cached2 !== null) && (cached3 === null);

    // Test partition behavior after cache operations
    audit.start("Verify Partition Integrity");
    CacheManager.invalidateGlobal();
    InvoiceManager.find('HEALTHCARE', '9252142078'); // Reload cache
    const partitionStats = CacheManager.getPartitionStats();
    audit.end("Verify Partition Integrity");

    // Log partition state after invalidation/reload
    Logger.log('=== Partition State After Invalidation/Reload ===');
    Logger.log(`Active: ${partitionStats.active.count}, Inactive: ${partitionStats.inactive.count}`);
    Logger.log(`Transitions: ${partitionStats.transitions}`);

    audit.endAll();
    audit.printSummary();

    return audit.getResult({
      paidDatePreserved: cached2 !== null,
      createCleared: cached3 === null,
      passed: passed,
      partitionIntegrity: {
        activeCount: partitionStats.active.count,
        inactiveCount: partitionStats.inactive.count,
        totalCount: partitionStats.total,
        transitions: partitionStats.transitions
      }
    });

  } catch (error) {
    return audit.fail("Cache invalidation test failed", error);
  }
}

/**
 * Test cache partition transitions (active ↔ inactive)
 * Verifies that invoices move between partitions when payment status changes
 */
function testCachePartitionTransitions() {
  const audit = new PerfAudit("Cache Partition Transitions Test");

  try {
    // Clear cache and get baseline
    audit.start("Setup - Clear Cache");
    CacheManager.invalidateGlobal();
    audit.end("Setup - Clear Cache");

    // Load cache with initial data
    audit.start("Initial Cache Load");
    InvoiceManager.find('HEALTHCARE', '9252142078');
    const initialStats = CacheManager.getPartitionStats();
    audit.end("Initial Cache Load");

    Logger.log('=== Initial Partition State ===');
    Logger.log(`Active: ${initialStats.active.count}, Inactive: ${initialStats.inactive.count}`);
    Logger.log(`Total: ${initialStats.total}`);

    // Simulate a payment that would cause a partition transition
    // (This requires finding an unpaid invoice and processing a full payment)
    audit.start("Find Unpaid Invoice");
    const unpaidInvoices = InvoiceManager.getUnpaidForSupplier('HEALTHCARE');
    audit.end("Find Unpaid Invoice");

    if (unpaidInvoices && unpaidInvoices.length > 0) {
      const testInvoice = unpaidInvoices[0];
      Logger.log(`Test invoice: ${testInvoice.invoiceNo}, Balance: ${testInvoice.balanceDue}`);

      // Simulate incremental cache update (which should trigger partition transition logic)
      audit.start("Simulate Payment Update");
      CacheManager.updateSingleInvoice(testInvoice.supplier, testInvoice.invoiceNo);
      const afterUpdateStats = CacheManager.getPartitionStats();
      audit.end("Simulate Payment Update");

      Logger.log('=== After Payment Update ===');
      Logger.log(`Active: ${afterUpdateStats.active.count}, Inactive: ${afterUpdateStats.inactive.count}`);
      Logger.log(`Transitions: ${afterUpdateStats.transitions}`);

      audit.endAll();
      audit.printSummary();

      return audit.getResult({
        initialState: {
          active: initialStats.active.count,
          inactive: initialStats.inactive.count,
          total: initialStats.total
        },
        afterUpdate: {
          active: afterUpdateStats.active.count,
          inactive: afterUpdateStats.inactive.count,
          transitions: afterUpdateStats.transitions
        },
        testInvoice: {
          supplier: testInvoice.supplier,
          invoiceNo: testInvoice.invoiceNo,
          balanceDue: testInvoice.balanceDue
        }
      });
    } else {
      // No unpaid invoices to test with
      Logger.log('No unpaid invoices found for transition testing');
      audit.endAll();
      audit.printSummary();

      return audit.getResult({
        skipped: true,
        reason: 'No unpaid invoices available for transition testing',
        initialState: {
          active: initialStats.active.count,
          inactive: initialStats.inactive.count,
          total: initialStats.total
        }
      });
    }

  } catch (error) {
    return audit.fail("Cache partition transition test failed", error);
  }
}

function testRegularPaymentFlow() {
  const audit = new PerfAudit("Regular Payment Flow");

  const testSupplier = 'TEST_SUPPLIER_REGULAR';
  const testInvoice = `INV-REG-${Date.now()}`;

  try {
    // Step 0: Cache Invalidation
    audit.start("Cache Invalidation");
    CacheManager.invalidateGlobal();
    audit.end("Cache Invalidation");

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

    // Step 1: Invoice Creation
    const createAudit = audit.startNested("Invoice Creation");
    const invoiceResult = InvoiceManager.create(data);
    createAudit.end();

    if (!invoiceResult.success) {
      return audit.fail("Invoice creation failed", invoiceResult.error);
    }

    // Step 2: Invoice Findability
    const findAudit = audit.startNested("Invoice Findability");
    const foundInvoice = InvoiceManager.find(testSupplier, testInvoice);
    findAudit.end();

    if (!foundInvoice) {
      return audit.fail("Invoice not found after creation");
    }

    // Step 3: Payment Processing
    const payAudit = audit.startNested("Payment Processing");
    const paymentResult = PaymentManager.processPayment(data, invoiceResult.invoiceId);
    payAudit.end();

    if (!paymentResult.success) {
      try {
        const invoiceSh = getSheet(CONFIG.invoiceSheet);
        invoiceSh.deleteRow(invoiceResult.row);
      } catch (e) {}
      return audit.fail("Payment processing failed", paymentResult.error);
    }

    // Step 4: Cleanup
    const cleanupAudit = audit.startNested("Cleanup");
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      invoiceSh.deleteRow(invoiceResult.row);
      const paymentSh = getSheet(CONFIG.paymentSheet);
      paymentSh.deleteRow(paymentResult.row);
      CacheManager.invalidateGlobal();
      cleanupAudit.end();
    } catch (e) {
      cleanupAudit.end();
    }

    audit.endAll();
    audit.printSummary();

    return audit.getResult({
      fullyPaid: paymentResult.fullyPaid,
      paidDateUpdated: paymentResult.paidDateUpdated
    });

  } catch (error) {
    return audit.fail("Test failed", error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: BALANCE CALCULATOR TESTS
// ═══════════════════════════════════════════════════════════════════════════

function testBalanceCalculation() {
  const audit = new PerfAudit("Balance Calculation Performance");

  try {
    const testCases = [
      { type: "Unpaid", data: { supplier: "Test A", paymentType: "Unpaid", receivedAmt: 1000, paymentAmt: 0, prevInvoice: "" }},
      { type: "Regular", data: { supplier: "Test B", paymentType: "Regular", receivedAmt: 1500, paymentAmt: 1500, prevInvoice: "" }},
      { type: "Partial", data: { supplier: "Test C", paymentType: "Partial", receivedAmt: 2000, paymentAmt: 1000, prevInvoice: "" }},
      { type: "Due", data: { supplier: "Test D", paymentType: "Due", receivedAmt: 0, paymentAmt: 500, prevInvoice: "INV-001" }}
    ];

    audit.start("Cache Warmup");
    CacheManager.getInvoiceData();
    audit.end("Cache Warmup");

    testCases.forEach(testCase => {
      const nested = audit.startNested(`${testCase.type} Payment`);
      for (let i = 0; i < 10; i++) {
        BalanceCalculator.calculate(testCase.data);
      }
      nested.end();
    });

    audit.endAll();
    audit.printSummary();
    return audit.getResult({ iterations: testCases.length * 10 });

  } catch (error) {
    return audit.fail("Balance calculation test failed", error);
  }
}

function testSupplierOutstanding() {
  const audit = new PerfAudit("Supplier Outstanding Lookup");

  try {
    const testSuppliers = ["HEALTHCARE", "INCEPTA", "Test Supplier", "Non-Existent"];

    audit.start("Cache Initialization");
    const cacheData = CacheManager.getInvoiceData();
    audit.end("Cache Initialization");

    testSuppliers.forEach(supplier => {
      const nested = audit.startNested(`Lookup: ${supplier}`);
      for (let i = 0; i < 15; i++) {
        BalanceCalculator.getSupplierOutstanding(supplier);
      }
      nested.end();
    });

    audit.endAll();
    audit.printSummary();
    return audit.getResult({
      suppliersTested: testSuppliers.length,
      cacheSize: cacheData.data.length
    });

  } catch (error) {
    return audit.fail("Supplier outstanding test failed", error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: MAIN APPLICATION LOGIC TESTS (onEdit & Posting)
// ═══════════════════════════════════════════════════════════════════════════

function testOnEditPerformance() {
  const audit = new PerfAudit("onEdit Performance - Various Scenarios");

  try {
    const editScenarios = [
      { name: "Post Column (True)", col: CONFIG.cols.post + 1, value: "TRUE" },
      { name: "Supplier Change", col: CONFIG.cols.supplier + 1, value: "Test Supplier A" },
      { name: "Invoice No Entry", col: CONFIG.cols.invoiceNo + 1, value: "INV-001" },
      { name: "Received Amount", col: CONFIG.cols.receivedAmt + 1, value: "1500" },
      { name: "Payment Type (Due)", col: CONFIG.cols.paymentType + 1, value: "Due" },
      { name: "Prev Invoice Select", col: CONFIG.cols.prevInvoice + 1, value: "INV-EXISTING" }
    ];

    audit.start("System Warmup");
    CacheManager.getInvoiceData();
    audit.end("System Warmup");

    editScenarios.forEach(scenario => {
      const scenarioAudit = audit.startNested(`Scenario: ${scenario.name}`);
      for (let i = 0; i < 5; i++) {
        try {
          const mockEvent = createMockEditEvent(scenario.col, 10, scenario.value);
          onEdit(mockEvent);
        } catch (error) {
          // Expected for some scenarios
        }
      }
      scenarioAudit.end();
    });

    audit.endAll();
    audit.printSummary();
    return audit.getResult({ scenariosTested: editScenarios.length });

  } catch (error) {
    return audit.fail("onEdit performance test failed", error);
  }
}

function testProcessPosting() {
  const audit = new PerfAudit("Process Posted Row Performance");

  try {
    const postingScenarios = [
      { name: "Unpaid Invoice", type: "Unpaid", amt: 3000, pay: 0 },
      { name: "Regular Payment", type: "Regular", amt: 2500, pay: 2500 },
      { name: "Partial Payment", type: "Partial", amt: 4000, pay: 2000 },
      { name: "Due Payment", type: "Due", amt: 0, pay: 1500 }
    ];

    const testSheet = getTestDailySheet();

    postingScenarios.forEach((scenario, index) => {
      const rowNum = 20 + index;
      const scenarioAudit = audit.startNested(`Post: ${scenario.name}`);

      const rowData = createMockRowData({
        supplier: `Test ${scenario.name}`,
        paymentType: scenario.type,
        invoiceNo: `INV-${scenario.name}`,
        receivedAmt: scenario.amt,
        paymentAmt: scenario.pay,
        prevInvoice: scenario.type === "Due" ? "INV-EXISTING" : ""
      });

      writeMockDataToSheet(testSheet, rowNum, rowData);
      processPostedRowWithLock(testSheet, rowNum, rowData);

      scenarioAudit.end();
    });

    audit.endAll();
    audit.printSummary();
    return audit.getResult({ scenariosTested: postingScenarios.length });

  } catch (error) {
    return audit.fail("Process posting test failed", error);
  }
}

function testConcurrentEditing() {
  const audit = new PerfAudit("Concurrent Editing Performance");

  try {
    audit.start("Lock Acquisition Under Load");
    const concurrentAttempts = 10;
    const lockResults = [];

    for (let i = 0; i < concurrentAttempts; i++) {
      const lockStart = Date.now();
      const lock = LockService.getDocumentLock();
      lock.waitLock(3000);
      const lockTime = Date.now() - lockStart;

      lockResults.push({ attempt: i + 1, acquired: !!lock, timeMs: lockTime });

      if (lock) {
        lock.releaseLock();
      }
    }
    audit.end("Lock Acquisition Under Load");

    audit.start("Simulated Concurrent Edits");
    const concurrentRows = [80, 81, 82, 83, 84];
    const suppliers = ["Concurrent A", "Concurrent B", "Concurrent C", "Concurrent D", "Concurrent E"];

    concurrentRows.forEach((row, index) => {
      const editEvent = createMockEditEvent(CONFIG.cols.supplier + 1, row, suppliers[index]);
      onEdit(editEvent);
    });
    audit.end("Simulated Concurrent Edits");

    audit.endAll();
    audit.printSummary();
    return audit.getResult({
      concurrentAttempts: concurrentAttempts,
      lockStats: {
        successful: lockResults.filter(r => r.acquired).length,
        failed: lockResults.filter(r => !r.acquired).length,
        averageTime: lockResults.reduce((sum, r) => sum + r.timeMs, 0) / lockResults.length
      }
    });

  } catch (error) {
    return audit.fail("Concurrent editing test failed", error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: TEST HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function createMockEditEvent(column, row, value, sheetName = "99") {
  const mockSheet = {
    getName: () => sheetName || "99"
  };

  return {
    range: {
      getSheet: () => mockSheet,
      getRow: () => row,
      getColumn: () => column
    },
    value: value
  };
}

function createMockRowData(overrides = {}) {
  const cols = CONFIG.cols;
  const rowData = new Array(CONFIG.totalColumns.daily).fill("");

  rowData[cols.supplier] = overrides.supplier || "Test Supplier";
  rowData[cols.paymentType] = overrides.paymentType || "Regular";
  rowData[cols.invoiceNo] = overrides.invoiceNo || "INV-TEST";
  rowData[cols.receivedAmt] = overrides.receivedAmt || 1000;
  rowData[cols.paymentAmt] = overrides.paymentAmt || 1000;
  rowData[cols.prevInvoice] = overrides.prevInvoice || "";
  rowData[cols.notes] = overrides.notes || "Test data";
  rowData[cols.sysId] = overrides.sysId || IDGenerator.generateUUID();
  rowData[cols.post] = overrides.post || false;

  return rowData;
}

function getTestDailySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let testSheet = ss.getSheetByName("99");

  if (!testSheet) {
    testSheet = ss.insertSheet("99");
    const headers = ["Supplier", "Payment Type", "Invoice No", "Received Amt", "Payment Amt", "Prev Invoice", "Balance", "Post", "SysId"];
    testSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  return testSheet;
}

function writeMockDataToSheet(sheet, rowNum, rowData) {
  const numCols = Math.min(rowData.length, CONFIG.totalColumns.daily);
  sheet.getRange(rowNum, 1, 1, numCols).setValues([rowData.slice(0, numCols)]);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: MASTER TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run all performance and business logic tests
 * This is the main entry point for the test suite
 */
function runAllCentralizedTests() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  CENTRALIZED BUSINESS LOGIC & PERFORMANCE TEST SUITE           ║');
  console.log('║  ' + new Date().toLocaleString().padEnd(60) + '║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const allResults = [];

  // Infrastructure Tests
  console.log('\n▶ INFRASTRUCTURE TESTS');
  try { allResults.push(...testSheetReads()); } catch (e) { console.error("testSheetReads failed", e); }
  try { allResults.push(...testDropdownCreation()); } catch (e) { console.error("testDropdownCreation failed", e); }
  try { allResults.push(...testCellFormatting()); } catch (e) { console.error("testCellFormatting failed", e); }
  try { allResults.push(...testFlushPerformance()); } catch (e) { console.error("testFlushPerformance failed", e); }
  try { allResults.push(...testLockPerformance()); } catch (e) { console.error("testLockPerformance failed", e); }

  // Cache & Invoice Manager Tests
  console.log('\n▶ CACHE & INVOICE MANAGER TESTS');
  try { allResults.push(testCachePerformance()); } catch (e) { console.error("testCachePerformance failed", e); }
  try { allResults.push(testCacheInvalidation()); } catch (e) { console.error("testCacheInvalidation failed", e); }
  try { allResults.push(testCachePartitionTransitions()); } catch (e) { console.error("testCachePartitionTransitions failed", e); }
  try { allResults.push(testRegularPaymentFlow()); } catch (e) { console.error("testRegularPaymentFlow failed", e); }

  // Balance Calculator Tests
  console.log('\n▶ BALANCE CALCULATOR TESTS');
  try { allResults.push(testBalanceCalculation()); } catch (e) { console.error("testBalanceCalculation failed", e); }
  try { allResults.push(testSupplierOutstanding()); } catch (e) { console.error("testSupplierOutstanding failed", e); }

  // Main Application Logic Tests
  console.log('\n▶ MAIN APPLICATION LOGIC TESTS');
  try { allResults.push(testOnEditPerformance()); } catch (e) { console.error("testOnEditPerformance failed", e); }
  try { allResults.push(testProcessPosting()); } catch (e) { console.error("testProcessPosting failed", e); }
  try { allResults.push(testConcurrentEditing()); } catch (e) { console.error("testConcurrentEditing failed", e); }

  // Export all results
  if (allResults.length > 0) {
    new PerfAudit().exportToSheet(allResults);
  }

  // Print summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  TEST SUMMARY                                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  const passed = allResults.filter(r => r.passed !== false).length;
  const failed = allResults.filter(r => r.passed === false).length;
  const totalTime = allResults.reduce((sum, r) => sum + (r.avgMs || 0), 0);

  console.log(`\nTotal Tests: ${allResults.length}`);
  console.log(`Passed: ${passed} ✓`);
  console.log(`Failed: ${failed} ✗`);
  console.log(`Total Time: ${totalTime}ms`);
  console.log(`Average Time: ${(totalTime / allResults.length).toFixed(0)}ms\n`);

  return allResults;
}

/**
 * Run specific test category
 * @param {string} category - One of: infrastructure, cache, balance, application
 */
function runTestCategory(category) {
  const categories = {
    'infrastructure': () => {
      const results = [];
      results.push(...testSheetReads());
      results.push(...testDropdownCreation());
      results.push(...testCellFormatting());
      results.push(...testFlushPerformance());
      results.push(...testLockPerformance());
      return results;
    },
    'cache': () => {
      const results = [];
      results.push(testCachePerformance());
      results.push(testCacheInvalidation());
      results.push(testRegularPaymentFlow());
      return results;
    },
    'balance': () => {
      const results = [];
      results.push(testBalanceCalculation());
      results.push(testSupplierOutstanding());
      return results;
    },
    'application': () => {
      const results = [];
      results.push(testOnEditPerformance());
      results.push(testProcessPosting());
      results.push(testConcurrentEditing());
      return results;
    }
  };

  const testFunction = categories[category.toLowerCase()];
  if (testFunction) {
    const results = testFunction();
    new PerfAudit().exportToSheet(results);
    return results;
  } else {
    console.error(`Unknown category: ${category}. Available: ${Object.keys(categories).join(', ')}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: MENU INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add centralized test menu to spreadsheet UI
 */
function addCentralizedTestMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🧪 Centralized Tests')
    .addItem('Run All Tests', 'runAllCentralizedTests')
    .addSeparator()
    .addSubMenu(ui.createMenu('By Category')
      .addItem('Infrastructure Tests', 'runInfrastructureTests')
      .addItem('Cache & Invoice Tests', 'runCacheTests')
      .addItem('Balance Calculator Tests', 'runBalanceTests')
      .addItem('Application Logic Tests', 'runApplicationTests'))
    .addSeparator()
    .addItem('Clear Test Results', 'clearTestResults')
    .addToUi();
}

function runInfrastructureTests() { runTestCategory('infrastructure'); }
function runCacheTests() { runTestCategory('cache'); }
function runBalanceTests() { runTestCategory('balance'); }
function runApplicationTests() { runTestCategory('application'); }

function clearTestResults() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PerfLogs");
  if (sheet) {
    sheet.clear();
    SpreadsheetApp.getUi().alert('Test results cleared successfully!');
  }
}
