/**
 * Performance Tests for Main Application Logic (Code.gs)
 * Tests onEdit() and processPostedRowWithLock() performance
 */

function testMainApplicationPerformance() {
  const testResults = [];
  
  // Test 1: onEdit Performance under various scenarios
  testResults.push(testOnEditPerformance());
  
  // Test 2: processPostedRowWithLock Performance
  testResults.push(testProcessPostedRowPerformance());
  
  // Test 3: End-to-End Posting Flow
  testResults.push(testCompletePostingFlow());
  
  // Test 4: Concurrent Editing Simulation
  testResults.push(testConcurrentEditingPerformance());
  
  // Export all results to sheet
  const audit = new PerfAudit("Main Application Performance Suite");
  audit.exportToSheet(testResults);
  
  return testResults;
}

function testOnEditPerformance() {
  const audit = new PerfAudit("onEdit Performance - Various Scenarios");
  
  try {
    // Mock event objects for different edit scenarios
    const editScenarios = [
      {
        name: "Post Column Edit (True)",
        mockEvent: createMockEditEvent(CONFIG.cols.post + 1, 10, "TRUE"),
        description: "User checks post checkbox"
      },
      {
        name: "Supplier Column Edit",
        mockEvent: createMockEditEvent(CONFIG.cols.supplier + 1, 10, "Test Supplier A"),
        description: "User changes supplier"
      },
      {
        name: "Invoice No Edit (Regular)",
        mockEvent: createMockEditEvent(CONFIG.cols.invoiceNo + 1, 10, "INV-001"),
        description: "User enters invoice number for Regular payment"
      },
      {
        name: "Received Amount Edit",
        mockEvent: createMockEditEvent(CONFIG.cols.receivedAmt + 1, 10, "1500"),
        description: "User enters received amount"
      },
      {
        name: "Payment Type Change to Due",
        mockEvent: createMockEditEvent(CONFIG.cols.paymentType + 1, 10, "Due"),
        description: "User changes payment type to Due"
      },
      {
        name: "Previous Invoice Selection",
        mockEvent: createMockEditEvent(CONFIG.cols.prevInvoice + 1, 10, "INV-EXISTING"),
        description: "User selects previous invoice for Due payment"
      },
      {
        name: "Payment Amount Edit",
        mockEvent: createMockEditEvent(CONFIG.cols.paymentAmt + 1, 10, "500"),
        description: "User edits payment amount"
      },
      {
        name: "Header Row Edit (Should Skip)",
        mockEvent: createMockEditEvent(CONFIG.cols.supplier + 1, 3, "Test Supplier"),
        description: "Edit in header row - should exit early"
      },
      {
        name: "Non-Daily Sheet Edit (Should Skip)",
        mockEvent: createMockEditEvent(CONFIG.cols.supplier + 1, 10, "Test Supplier", "Summary"),
        description: "Edit in non-daily sheet - should exit early"
      }
    ];

    // Warm up caches and initialize dependencies
    audit.start("System Warmup");
    InvoiceCache.getInvoiceData();
    const testSheet = getTestDailySheet();
    audit.end("System Warmup");

    // Test each edit scenario
    editScenarios.forEach(scenario => {
      const scenarioAudit = audit.startNested(`Scenario: ${scenario.name}`);
      
      // Test multiple iterations to measure consistency
      for (let i = 0; i < 8; i++) {
        try {
          // Mock the global dependencies that onEdit relies on
          mockGlobalDependencies();
          
          // Execute onEdit with mocked event
          onEdit(scenario.mockEvent);
        } catch (error) {
          // Some scenarios might fail due to missing data - that's expected
          console.log(`Expected error in ${scenario.name}:`, error.message);
        }
      }
      
      scenarioAudit.end();
    });

    // Test batch edit performance (simulating rapid user input)
    audit.start("Rapid Sequential Edits");
    const rapidEdits = [
      createMockEditEvent(CONFIG.cols.supplier + 1, 15, "Test Supplier Rapid"),
      createMockEditEvent(CONFIG.cols.paymentType + 1, 15, "Regular"),
      createMockEditEvent(CONFIG.cols.invoiceNo + 1, 15, "INV-RAPID"),
      createMockEditEvent(CONFIG.cols.receivedAmt + 1, 15, "2000"),
      createMockEditEvent(CONFIG.cols.paymentAmt + 1, 15, "2000")
    ];
    
    rapidEdits.forEach(edit => {
      onEdit(edit);
    });
    audit.end("Rapid Sequential Edits");

    audit.endAll();
    audit.printSummary();
    return audit.getResult({ 
      scenariosTested: editScenarios.length,
      description: "Tests onEdit performance across different user interaction scenarios"
    });

  } catch (error) {
    return audit.fail("onEdit performance test failed", error);
  }
}

function testProcessPostedRowPerformance() {
  const audit = new PerfAudit("processPostedRowWithLock Performance");
  
  try {
    // Test data for different posting scenarios
    const postingScenarios = [
      {
        name: "New Unpaid Invoice",
        rowData: createMockRowData({
          supplier: "Test Supplier A",
          paymentType: "Unpaid",
          invoiceNo: "INV-NEW-UNPAID",
          receivedAmt: 3000,
          paymentAmt: 0,
          prevInvoice: ""
        })
      },
      {
        name: "Regular Payment",
        rowData: createMockRowData({
          supplier: "Test Supplier B", 
          paymentType: "Regular",
          invoiceNo: "INV-NEW-REGULAR",
          receivedAmt: 2500,
          paymentAmt: 2500,
          prevInvoice: ""
        })
      },
      {
        name: "Partial Payment",
        rowData: createMockRowData({
          supplier: "Test Supplier C",
          paymentType: "Partial", 
          invoiceNo: "INV-NEW-PARTIAL",
          receivedAmt: 4000,
          paymentAmt: 2000,
          prevInvoice: ""
        })
      },
      {
        name: "Due Payment",
        rowData: createMockRowData({
          supplier: "Test Supplier A",
          paymentType: "Due",
          invoiceNo: "",
          receivedAmt: 0,
          paymentAmt: 1500,
          prevInvoice: "INV-EXISTING"
        })
      },
      {
        name: "Invalid Data (Should Fail Validation)",
        rowData: createMockRowData({
          supplier: "",
          paymentType: "Regular", 
          invoiceNo: "INV-INVALID",
          receivedAmt: 1000,
          paymentAmt: 1000,
          prevInvoice: ""
        })
      }
    ];

    const testSheet = getTestDailySheet();
    
    // Test each posting scenario
    postingScenarios.forEach((scenario, index) => {
      const rowNum = 20 + index; // Use different rows to avoid conflicts
      const scenarioAudit = audit.startNested(`Post: ${scenario.name}`);
      
      // Test with pre-read data (optimized path)
      audit.start(`${scenario.name} - With Pre-read Data`);
      processPostedRowWithLock(testSheet, rowNum, scenario.rowData);
      audit.end(`${scenario.name} - With Pre-read Data`);
      
      // Test without pre-read data (fallback path)
      audit.start(`${scenario.name} - Without Pre-read Data`);
      // Write test data to sheet first
      writeMockDataToSheet(testSheet, rowNum, scenario.rowData);
      processPostedRowWithLock(testSheet, rowNum); // No pre-read data
      audit.end(`${scenario.name} - Without Pre-read Data`);
      
      scenarioAudit.end();
    });

    // Test batch posting performance
    audit.start("Batch Posting Performance");
    const batchSize = 5;
    for (let i = 0; i < batchSize; i++) {
      const rowNum = 30 + i;
      const rowData = createMockRowData({
        supplier: `Batch Supplier ${i}`,
        paymentType: "Regular",
        invoiceNo: `INV-BATCH-${i}`,
        receivedAmt: 1000 + (i * 100),
        paymentAmt: 1000 + (i * 100),
        prevInvoice: ""
      });
      
      writeMockDataToSheet(testSheet, rowNum, rowData);
      processPostedRowWithLock(testSheet, rowNum, rowData);
    }
    audit.end("Batch Posting Performance");

    // Test cache impact on posting performance
    audit.start("Cache Impact - Cold vs Warm");
    
    // Cold cache (after invalidation)
    InvoiceCache.invalidateGlobal();
    const coldStartData = createMockRowData({
      supplier: "Cold Cache Supplier",
      paymentType: "Regular",
      invoiceNo: "INV-COLD",
      receivedAmt: 1500,
      paymentAmt: 1500,
      prevInvoice: ""
    });
    writeMockDataToSheet(testSheet, 40, coldStartData);
    processPostedRowWithLock(testSheet, 40, coldStartData);
    
    // Warm cache (immediate second post)
    const warmCacheData = createMockRowData({
      supplier: "Warm Cache Supplier", 
      paymentType: "Regular",
      invoiceNo: "INV-WARM",
      receivedAmt: 1500,
      paymentAmt: 1500,
      prevInvoice: ""
    });
    writeMockDataToSheet(testSheet, 41, warmCacheData);
    processPostedRowWithLock(testSheet, 41, warmCacheData);
    
    audit.end("Cache Impact - Cold vs Warm");

    audit.endAll();
    audit.printSummary();
    return audit.getResult({ 
      scenariosTested: postingScenarios.length,
      description: "Tests processPostedRowWithLock performance across different transaction types and conditions"
    });

  } catch (error) {
    return audit.fail("processPostedRow performance test failed", error);
  }
}

function testCompletePostingFlow() {
  const audit = new PerfAudit("Complete Posting Flow Performance");
  
  try {
    const testSheet = getTestDailySheet();
    
    // Test complete workflow: onEdit → processPostedRowWithLock
    const completeWorkflows = [
      {
        name: "Complete Regular Payment Flow",
        steps: [
          {
            action: "Set Supplier",
            col: CONFIG.cols.supplier + 1,
            value: "Complete Flow Supplier A"
          },
          {
            action: "Set Payment Type", 
            col: CONFIG.cols.paymentType + 1,
            value: "Regular"
          },
          {
            action: "Set Invoice No",
            col: CONFIG.cols.invoiceNo + 1, 
            value: "INV-COMPLETE-A"
          },
          {
            action: "Set Received Amount",
            col: CONFIG.cols.receivedAmt + 1,
            value: "3500"
          },
          {
            action: "Trigger Post",
            col: CONFIG.cols.post + 1,
            value: true
          }
        ]
      },
      {
        name: "Complete Due Payment Flow", 
        steps: [
          {
            action: "Set Supplier",
            col: CONFIG.cols.supplier + 1,
            value: "Complete Flow Supplier B"
          },
          {
            action: "Set Payment Type",
            col: CONFIG.cols.paymentType + 1, 
            value: "Due"
          },
          {
            action: "Set Previous Invoice",
            col: CONFIG.cols.prevInvoice + 1,
            value: "INV-EXISTING"
          },
          {
            action: "Trigger Post", 
            col: CONFIG.cols.post + 1,
            value: true
          }
        ]
      }
    ];

    completeWorkflows.forEach((workflow, workflowIndex) => {
      const workflowAudit = audit.startNested(`Workflow: ${workflow.name}`);
      const baseRow = 50 + (workflowIndex * 10);
      
      workflow.steps.forEach((step, stepIndex) => {
        const stepRow = baseRow + stepIndex;
        const stepAudit = audit.startNested(`Step: ${step.action}`);
        
        // Create mock edit event for this step
        const mockEvent = createMockEditEvent(step.col, stepRow, step.value);
        
        // Execute onEdit for this step
        onEdit(mockEvent);
        
        stepAudit.end();
      });
      
      workflowAudit.end();
    });

    // Test error recovery performance
    audit.start("Error Recovery Flow");
    const errorRow = 70;
    
    // Step 1: Try to post invalid data (should fail validation)
    const invalidEvent = createMockEditEvent(CONFIG.cols.post + 1, errorRow, true);
    writeMockDataToSheet(testSheet, errorRow, createMockRowData({
      supplier: "", // Invalid - missing supplier
      paymentType: "Regular",
      invoiceNo: "INV-ERROR",
      receivedAmt: 1000,
      paymentAmt: 1000,
      prevInvoice: ""
    }));
    onEdit(invalidEvent);
    
    // Step 2: Fix the data and retry (should succeed)
    const fixSupplierEvent = createMockEditEvent(CONFIG.cols.supplier + 1, errorRow, "Error Recovery Supplier");
    onEdit(fixSupplierEvent);
    
    const retryPostEvent = createMockEditEvent(CONFIG.cols.post + 1, errorRow, true);
    onEdit(retryPostEvent);
    
    audit.end("Error Recovery Flow");

    audit.endAll();
    audit.printSummary();
    return audit.getResult({
      workflowsTested: completeWorkflows.length,
      description: "Tests complete user workflow performance from initial edit through final posting"
    });

  } catch (error) {
    return audit.fail("Complete posting flow test failed", error);
  }
}

function testConcurrentEditingPerformance() {
  const audit = new PerfAudit("Concurrent Editing Performance");
  
  try {
    const testSheet = getTestDailySheet();
    
    // Test lock acquisition performance
    audit.start("Lock Acquisition Under Load");
    
    const concurrentAttempts = 10;
    const lockResults = [];
    
    for (let i = 0; i < concurrentAttempts; i++) {
      const lockStart = Date.now();
      const lock = LockManager.acquireDocumentLock(CONFIG.rules.LOCK_TIMEOUT_MS);
      const lockTime = Date.now() - lockStart;
      
      lockResults.push({
        attempt: i + 1,
        acquired: !!lock,
        timeMs: lockTime
      });
      
      if (lock) {
        LockManager.releaseLock(lock);
      }
    }
    
    audit.end("Lock Acquisition Under Load");
    
    // Test simulated concurrent edits
    audit.start("Simulated Concurrent Edits");
    const concurrentRows = [80, 81, 82, 83, 84];
    const suppliers = ["Concurrent A", "Concurrent B", "Concurrent C", "Concurrent D", "Concurrent E"];
    
    // Simulate multiple users editing different rows simultaneously
    concurrentRows.forEach((row, index) => {
      const editEvent = createMockEditEvent(
        CONFIG.cols.supplier + 1, 
        row, 
        suppliers[index]
      );
      onEdit(editEvent);
    });
    audit.end("Simulated Concurrent Edits");
    
    // Test lock timeout handling
    audit.start("Lock Timeout Handling");
    
    // Acquire a lock and then try to acquire another (should timeout)
    const firstLock = LockManager.acquireDocumentLock(5000); // 5 second lock
    if (firstLock) {
      const timeoutStart = Date.now();
      const secondLock = LockManager.acquireDocumentLock(1000); // 1 second timeout
      const timeoutDuration = Date.now() - timeoutStart;
      
      lockResults.push({
        attempt: "timeout_test",
        acquired: !!secondLock,
        timeMs: timeoutDuration,
        expected: "Should fail to acquire due to existing lock"
      });
      
      LockManager.releaseLock(firstLock);
    }
    
    audit.end("Lock Timeout Handling");

    audit.endAll();
    audit.printSummary();
    return audit.getResult({
      concurrentAttempts: concurrentAttempts,
      lockStats: {
        successful: lockResults.filter(r => r.acquired).length,
        failed: lockResults.filter(r => !r.acquired).length,
        averageTime: lockResults.reduce((sum, r) => sum + r.timeMs, 0) / lockResults.length
      },
      description: "Tests performance under concurrent editing conditions and lock management"
    });

  } catch (error) {
    return audit.fail("Concurrent editing test failed", error);
  }
}

// ==================== TEST HELPER FUNCTIONS ====================

/**
 * Create mock edit event for testing
 */
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

/**
 * Create mock row data for testing
 */
function createMockRowData(overrides = {}) {
  const cols = CONFIG.cols;
  const rowData = new Array(CONFIG.totalColumns.daily).fill("");
  
  // Set default values
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

/**
 * Get test daily sheet for performance testing
 */
function getTestDailySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let testSheet = ss.getSheetByName("99");
  
  if (!testSheet) {
    testSheet = ss.insertSheet("TEST_Performance");
    // Add basic header structure to make it resemble a daily sheet
    const headers = ["Supplier", "Payment Type", "Invoice No", "Received Amt", "Payment Amt", "Prev Invoice", "Balance", "Post", "SysId"];
    testSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  
  return testSheet;
}

/**
 * Write mock data to sheet for testing
 */
function writeMockDataToSheet(sheet, rowNum, rowData) {
  const numCols = Math.min(rowData.length, CONFIG.totalColumns.daily);
  sheet.getRange(rowNum, 1, 1, numCols).setValues([rowData.slice(0, numCols)]);
}

/**
 * Mock global dependencies for isolated testing
 */
function mockGlobalDependencies() {
  // Mock session if needed
  if (typeof Session === 'undefined') {
    global.Session = {
      getEffectiveUser: () => ({
        getEmail: () => "test@example.com"
      })
    };
  }
  
  // Mock console if needed
  if (typeof console === 'undefined') {
    global.console = {
      log: () => {},
      error: () => {}
    };
  }
}

/**
 * Run specific main application test
 */
function runMainAppPerformanceTest(testName) {
  const tests = {
    'onedit': testOnEditPerformance,
    'posting': testProcessPostedRowPerformance, 
    'workflow': testCompletePostingFlow,
    'concurrent': testConcurrentEditingPerformance
  };

  const testFunction = tests[testName.toLowerCase()];
  if (testFunction) {
    return testFunction();
  } else {
    console.error(`Unknown test: ${testName}. Available tests: ${Object.keys(tests).join(', ')}`);
    return null;
  }
}