/**
 * PerfAudit — lightweight nested performance tracker and reporter
 * ---------------------------------------------------------------
 * Features:
 * - Nested timing support (auto-tagged hierarchy)
 * - Auto breakdown with % contribution
 * - Fail-safe test wrapping and summary return
 * - Works in Apps Script and Node.js
 *
 * Example:
 * const audit = new PerfAudit("Regular Payment Flow");
 * audit.start("Cache Invalidation");
 * InvoiceCache.invalidateGlobal();
 * audit.end("Cache Invalidation");
 *
 * const nested = audit.startNested("Invoice Creation");
 * InvoiceManager.create(...);
 * nested.end();
 *
 * audit.endAll();
 * audit.printSummary();
 * return audit.getResult();
 */
class PerfAudit {
  constructor(testName = "Untitled Test") {
    this.testName = testName;
    this.sections = {};
    this.stack = []; // for nested tracking
    this.startTime = Date.now();
    this.totalEnd = null;
    this.failed = false;
    this.failReason = null;
    this.failError = null;
  }

  /** Start a timer for a section or operation */
  start(label) {
    this.sections[label] = this.sections[label] || { time: 0, calls: 0 };
    this.sections[label].start = Date.now();
    this.sections[label].calls++;
    return this;
  }

  /** End a timer for a section */
  end(label) {
    const section = this.sections[label];
    if (!section || !section.start) return this;
    section.time += Date.now() - section.start;
    section.start = null;
    return this;
  }

  /**
   * Start a nested operation (returns a scoped sub-audit)
   * Usage:
   * const sub = audit.startNested("Subtask");
   * ...
   * sub.end();
   */
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

  /** Mark the end of all active nested audits */
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

  /** Internal helper: total elapsed time */
  get total() {
    return (this.totalEnd || Date.now()) - this.startTime;
  }

  /** Return result summary for programmatic use */
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
      // NOTE: We add timestamp here so it can be added by the export function
      // timestamp: new Date(), 
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
  
  /** Print formatted performance summary */
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
        `${label.padEnd(20)}: ${info.time.toString().padStart(5)}ms (${pct}%)  calls:${info.calls}`
      );
    });

    console.log("  " + "-".repeat(58));
    console.log(`TOTAL`.padEnd(20) + `: ${total.toString().padStart(5)}ms (100%)`);
    console.log("═".repeat(60));

    const bottleneck = sorted[0];
    if (bottleneck && total > 0)
      console.log(`🔍 BOTTLENECK: ${bottleneck[0]} (${bottleneck[1].time}ms, ${(bottleneck[1].time / total * 100).toFixed(1)}%)`);
  }

  /** Mark the test as failed and return structured result */
  fail(reason, error = null) {
    this.failed = true;
    this.failReason = reason;
    this.failError = error ? error.toString() : null;
    this.endAll();
    console.error(`✗ ${reason}`);
    if (error) console.error(error.stack || error);
    return this.getResult();
  }

  /**
   * Export results into "PerfLogs" sheet
   */
  exportToSheet(resultsArray) {
    // Ensure it's always an array
    if (!Array.isArray(resultsArray)) {
        console.error("Export failed: Input was not an array.");
        return;
    }
    // Flatten the array in case results are passed as [[...], [...]]
    const flatResults = resultsArray.flat();

    if (flatResults.length === 0) {
        console.log("No results to export.");
        return;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("PerfLogs") || ss.insertSheet("PerfLogs");

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Timestamp", "Test Name", "Average (ms)", "Grade", "Passed", "Bottleneck"]);
      sheet.getRange("A1:F1").setFontWeight("bold");
    }

    const now = new Date(); // Use a single timestamp for the entire batch
    const rows = flatResults.map(result => [
        now,
        result.name,
        result.avgMs,
        result.grade,
        result.passed ? "YES" : "NO",
        result.bottleneck,
    ]);

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

    console.log(`✓ Exported ${flatResults.length} test results to 'PerfLogs'`);
  }
}

function testSheetReads() {
  const results = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("99") || ss.getActiveSheet();
  const testRow = 10;
  const numCols = 15;

  const batchAudit = new PerfAudit("Batch Read (1 call)");
  batchAudit.start("Batch");
  for (let i = 0; i < 10; i++) {
    const range = sheet.getRange(testRow, 1, 1, numCols);
    range.getValues()[0];
  }
  batchAudit.end("Batch");
  batchAudit.endAll();
  results.push(batchAudit.getResult());

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

  // REMOVED: batchAudit.exportToSheet(results);
  // Let the main test runner handle exporting.
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

  // REMOVED: const exportAudit = new PerfAudit("Dropdown Creation Performance");
  // REMOVED: exportAudit.exportToSheet(results);
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

  // REMOVED: single.exportToSheet(results);
  return results;
}

function testLockPerformance() {
  const results = [];

  const quick = new PerfAudit("Lock: Quick acquisition");
  quick.start("Lock");
  for (let i = 0; i < 5; i++) {
    const lock = LockManager.getScriptLock(); // Use getScriptLock() for more reliable testing
    lock.waitLock(3000);
    lock.releaseLock();
  }
  quick.end("Lock");
  quick.endAll();
  results.push(quick.getResult());

  const contention = new PerfAudit("Lock: With Sleep");
  contention.start("SleepLock");
  for (let i = 0; i < 3; i++) {
    const lock = LockManager.getScriptLock();
    lock.waitLock(5000);
    Utilities.sleep(100);
    lock.releaseLock();
  }
  contention.end("SleepLock");
  contention.endAll();
  results.push(contention.getResult());

  // REMOVED: quick.exportToSheet(results);
  return results;
}

function testDataProcessing() {
  const results = [];
  const mockData = {
    supplier: "Supplier A",
    invoiceNo: "INV-001",
    receivedAmt: 1000,
    paymentAmt: 1000,
    paymentType: "Regular",
  };

  const validation = new PerfAudit("Validation Checks");
  validation.start("Validation");
  for (let i = 0; i < 100; i++) {
    mockData.supplier && mockData.invoiceNo && mockData.receivedAmt > 0;
  }
  validation.end("Validation");
  validation.endAll();
  results.push(validation.getResult());

  const balance = new PerfAudit("Balance Calculation");
  balance.start("Balance");
  for (let i = 0; i < 20; i++) {
    const balance = mockData.paymentType === "Regular" ? mockData.receivedAmt - mockData.paymentAmt : mockData.receivedAmt;
    const note = balance === 0 ? "Paid in full" : `Outstanding: ${balance}`;
  }
  balance.end("Balance");
  balance.endAll();
  results.push(balance.getResult());

  // REMOVED: validation.exportToSheet(results);
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

  // REMOVED: noFlush.exportToSheet(results);
  return results;
}


function testRegularPaymentFlow() {
  console.log('\n=== REGULAR PAYMENT FLOW TEST (PerfAudit Enhanced) ===');

  const audit = new PerfAudit('Regular Payment Flow');
  
  // Mock objects for standalone testing if needed
  // @ts-ignore
  const InvoiceCache = globalThis.InvoiceCache || { invalidateGlobal: () => {} };
  // @ts-ignore
  const IDGenerator = globalThis.IDGenerator || { generateUUID: () => 'mock-uuid' };
  // @ts-ignore
  const InvoiceManager = globalThis.InvoiceManager || { 
    create: () => ({ success: true, row: 1, invoiceId: 'mock-inv-id' }),
    find: () => ({ row: 1 }) 
  };
  // @ts-ignore
  const PaymentManager = globalThis.PaymentManager || { 
    processOptimized: () => ({ success: true, paymentId: 'mock-pay-id', fullyPaid: true, paidDateUpdated: true }) 
  };
  // @ts-ignore
  const CONFIG = globalThis.CONFIG || { invoiceSheet: 'Invoices', paymentSheet: 'Payments' };
  // @ts-ignore
  const getSheet = globalThis.getSheet || (() => ({ 
    deleteRow: () => {}, 
    // @ts-ignore
    getRange: () => ({ setValues: () => {}, getValue: () => {}, getValues: () => [[]] })
  }));

  const testSupplier = 'TEST_SUPPLIER_REGULAR';
  const testInvoice = `INV-REG-${Date.now()}`;

  try {
    // ════════════════════════════════
    // STEP 0: Cache Invalidation
    // ════════════════════════════════
    audit.start('Cache Invalidation');
    InvoiceCache.invalidateGlobal();
    audit.end('Cache Invalidation');

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

    // ════════════════════════════════
    // STEP 1: Invoice Creation
    // ════════════════════════════════
    const createAudit = audit.startNested('Invoice Creation');
    const invoiceResult = InvoiceManager.create(data);
    createAudit.end();

    if (!invoiceResult.success) {
      return audit.fail('Invoice creation failed', invoiceResult.error);
    }
    console.log(`✓ Invoice created at row ${invoiceResult.row}`);

    // ════════════════════════════════
    // STEP 2: Invoice Findability
    // ════════════════════════════════
    const findAudit = audit.startNested('Invoice Findability');
    const foundInvoice = InvoiceManager.find(testSupplier, testInvoice);
    findAudit.end();

    if (!foundInvoice) {
      return audit.fail('Invoice not found after creation (cache write-through failure)');
    }
    console.log(`✓ Invoice found at row ${foundInvoice.row}`);

    // ════════════════════════════════
    // STEP 3: Payment Processing
    // ════════════════════════════════
    const payAudit = audit.startNested('Payment Processing');
    const paymentResult = PaymentManager.processOptimized(data, invoiceResult.invoiceId);
    payAudit.end();

    if (!paymentResult.success) {
      try {
        const invoiceSh = getSheet(CONFIG.invoiceSheet);
        invoiceSh.deleteRow(invoiceResult.row);
      } catch (e) {}
      return audit.fail('Payment processing failed', paymentResult.error);
    }

    console.log(`✓ Payment processed: ${paymentResult.paymentId}`);
    console.log(`✓ Fully paid: ${paymentResult.fullyPaid}`);
    console.log(`✓ Paid date updated: ${paymentResult.paidDateUpdated}`);

    // ════════════════════════════════
    // STEP 4: Cleanup
    // ════════════════════════════════
    const cleanupAudit = audit.startNested('Cleanup');
    try {
      const invoiceSh = getSheet(CONFIG.invoiceSheet);
      invoiceSh.deleteRow(invoiceResult.row);

      const paymentSh = getSheet(CONFIG.paymentSheet);
      // @ts-ignore
      paymentSh.deleteRow(paymentResult.row);

      InvoiceCache.invalidateGlobal();
      cleanupAudit.end();
      console.log(`✓ Test data cleaned up`);
    } catch (e) {
      cleanupAudit.end();
      console.warn(`⚠ Cleanup failed: ${e}`);
    }

    // ════════════════════════════════
    // PERFORMANCE SUMMARY
    // ════════════════════════════════
    audit.endAll();
    audit.printSummary();

    // ════════════════════════════════
    // RESULT RETURN
    // ════════════════════════════════
    const result = audit.getResult({
      fullyPaid: paymentResult.fullyPaid,
      paidDateUpdated: paymentResult.paidDateUpdated
    });

    return result;

  } catch (error) {
    return audit.fail('Test failed', error);
  }
}

/**
 * --- THIS IS THE MAIN TEST RUNNER ---
 * It calls all individual tests, collects their results,
 * and performs a single, clean export to the "PerfLogs" sheet.
 */
function runAllPerformanceTests() {
  console.log('\n=== RUNNING ALL PERFORMANCE TESTS ===');
  
  // Clear the log sheet once at the beginning
  const summarySheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName('PerfLogs') ||
    SpreadsheetApp.getActiveSpreadsheet().insertSheet('PerfLogs');
  
  summarySheet.clear();
  summarySheet.appendRow(["Timestamp", "Test Name", "Average (ms)", "Grade", "Passed", "Bottleneck"]);
  summarySheet.getRange("A1:F1").setFontWeight("bold");
  SpreadsheetApp.flush(); // Ensure header is written

  const allResults = [];
  
  try { allResults.push(testSheetReads()); } catch (e) { console.error("testSheetReads failed", e); }
  try { allResults.push(testDropdownCreation()); } catch (e) { console.error("testDropdownCreation failed", e); }
  try { allResults.push(testCellFormatting()); } catch (e) { console.error("testCellFormatting failed", e); }
  try { allResults.push(testLockPerformance()); } catch (e) { console.error("testLockPerformance failed", e); }
  try { allResults.push(testDataProcessing()); } catch (e) { console.error("testDataProcessing failed", e); }
  try { allResults.push(testFlushPerformance()); } catch (e) { console.error("testFlushPerformance failed", e); }
  
  // FIXME: testImmediateFindability() is called in the original but not defined.
  // try { allResults.push(testImmediateFindability()); } catch (e) { console.error("testImmediateFindability failed", e); }
  
  // testRegularPaymentFlow() is a complex integration test.
  // We'll run it and add its single result object.
  // try { 
  //   const flowResult = testRegularPaymentFlow();
  //   allResults.push(flowResult); // This adds a single object, not an array
  // } catch (e) { console.error("testRegularPaymentFlow failed", e); }

  // Flatten the array (most results are arrays, but flowResult is a single object)
  const flatResults = allResults.flat();

  // Export all collected results in one batch
  // We can use a new PerfAudit instance just to access the export method.
  if (flatResults.length > 0) {
    new PerfAudit().exportToSheet(flatResults);
  } else {
    console.warn("No test results were collected.");
  }

  console.log(`✅ All performance tests completed. ${flatResults.length} results exported.`);
  return flatResults;
}

