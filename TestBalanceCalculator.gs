/**
 * Performance Tests for BalanceCalculator Module
 * Uses PerfAudit for nested performance tracking and reporting
 */

function testBalanceCalculatorPerformance() {
  const testResults = [];
  
  // Test 1: Core Calculation Performance
  testResults.push(testCalculationPerformance());
  
  // Test 2: Supplier Outstanding Lookup Performance
  testResults.push(testSupplierOutstandingPerformance());
  
  // Test 3: Balance Preview Performance
  testResults.push(testBalancePreviewPerformance());
  
  // Test 4: End-to-End Transaction Flow
  testResults.push(testEndToEndPerformance());
  
  // Test 5: Edge Cases and Error Handling Performance
  testResults.push(testEdgeCasesPerformance());
  
  // Export all results to sheet
  const audit = new PerfAudit("BalanceCalculator Performance Suite");
  audit.exportToSheet(testResults);
  
  return testResults;
}

function testCalculationPerformance() {
  const audit = new PerfAudit("Core Calculation Performance");
  
  try {
    // Test data for different payment types
    const testCases = [
      {
        type: "Unpaid",
        data: {
          supplier: "Test Supplier A",
          paymentType: "Unpaid",
          receivedAmt: 1000,
          paymentAmt: 0,
          prevInvoice: ""
        }
      },
      {
        type: "Regular", 
        data: {
          supplier: "Test Supplier B",
          paymentType: "Regular",
          receivedAmt: 1500,
          paymentAmt: 1500,
          prevInvoice: ""
        }
      },
      {
        type: "Partial",
        data: {
          supplier: "Test Supplier C", 
          paymentType: "Partial",
          receivedAmt: 2000,
          paymentAmt: 1000,
          prevInvoice: ""
        }
      },
      {
        type: "Due",
        data: {
          supplier: "Test Supplier D",
          paymentType: "Due", 
          receivedAmt: 0,
          paymentAmt: 500,
          prevInvoice: "INV-001"
        }
      }
    ];

    // Warm up cache
    audit.start("Cache Warmup");
    InvoiceCache.getInvoiceData();
    audit.end("Cache Warmup");

    // Test individual calculation performance
    testCases.forEach(testCase => {
      const nested = audit.startNested(`${testCase.type} Payment Calculation`);
      
      // Test multiple iterations
      for (let i = 0; i < 10; i++) {
        BalanceCalculator.calculate(testCase.data);
      }
      
      nested.end();
    });

    // Test transaction impact calculation
    audit.start("Transaction Impact Core Logic");
    for (let i = 0; i < 50; i++) {
      BalanceCalculator._calculateTransactionImpact(
        "Partial", 
        1000 + i, 
        500 + i, 
        "INV-TEST"
      );
    }
    audit.end("Transaction Impact Core Logic");

    audit.endAll();
    audit.printSummary();
    return audit.getResult({ iterations: testCases.length * 10 });

  } catch (error) {
    return audit.fail("Calculation test failed", error);
  }
}

function testSupplierOutstandingPerformance() {
  const audit = new PerfAudit("Supplier Outstanding Lookup Performance");
  
  try {
    // Test suppliers with different invoice volumes
    const testSuppliers = [
      "Test Supplier A",  // Few invoices
      "Test Supplier B",  // Medium invoices  
      "Test Supplier C",  // Many invoices
      "Non-Existent Supplier" // Edge case
    ];

    // Warm up cache and build index
    audit.start("Cache and Index Initialization");
    const cacheData = InvoiceCache.getInvoiceData();
    audit.end("Cache and Index Initialization");

    // Test individual supplier lookups
    testSuppliers.forEach(supplier => {
      const nested = audit.startNested(`Lookup: ${supplier}`);
      
      // Multiple iterations to measure consistency
      for (let i = 0; i < 15; i++) {
        BalanceCalculator.getSupplierOutstanding(supplier);
      }
      
      nested.end();
    });

    // Test batch lookups (simulating report generation)
    audit.start("Batch Supplier Lookups");
    for (let i = 0; i < 20; i++) {
      testSuppliers.forEach(supplier => {
        BalanceCalculator.getSupplierOutstanding(supplier);
      });
    }
    audit.end("Batch Supplier Lookups");

    // Test supplier summary performance
    audit.start("Supplier Summary Generation");
    testSuppliers.forEach(supplier => {
      BalanceCalculator.getSupplierSummary(supplier);
    });
    audit.end("Supplier Summary Generation");

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

function testBalancePreviewPerformance() {
  const audit = new PerfAudit("Balance Preview Performance");
  
  try {
    const previewScenarios = [
      {
        name: "New Unpaid Invoice",
        args: ["Test Supplier A", "Unpaid", 2500, 0, ""]
      },
      {
        name: "Partial Payment", 
        args: ["Test Supplier B", "Partial", 3000, 1500, ""]
      },
      {
        name: "Due Payment",
        args: ["Test Supplier C", "Due", 0, 800, "INV-EXISTING"]
      },
      {
        name: "Invalid Input",
        args: ["", "Unpaid", 1000, 0, ""]
      }
    ];

    // Test individual preview calculations
    previewScenarios.forEach(scenario => {
      const nested = audit.startNested(`Preview: ${scenario.name}`);
      
      for (let i = 0; i < 12; i++) {
        BalanceCalculator.calculatePreview(...scenario.args);
      }
      
      nested.end();
    });

    // Test preview accuracy validation
    audit.start("Preview Accuracy Validation");
    const testData = {
      supplier: "Test Supplier A",
      paymentType: "Partial", 
      receivedAmt: 2000,
      paymentAmt: 1000,
      prevInvoice: ""
    };
    
    for (let i = 0; i < 10; i++) {
      BalanceCalculator.validatePreviewAccuracy(testData);
    }
    audit.end("Preview Accuracy Validation");

    audit.endAll();
    audit.printSummary();
    return audit.getResult({ scenariosTested: previewScenarios.length });

  } catch (error) {
    return audit.fail("Balance preview test failed", error);
  }
}

function testEndToEndPerformance() {
  const audit = new PerfAudit("End-to-End Transaction Flow");
  
  try {
    const transactions = [
      { type: "Invoice Receipt", supplier: "Test Supplier A", paymentType: "Unpaid", amount: 5000 },
      { type: "Immediate Payment", supplier: "Test Supplier B", paymentType: "Regular", amount: 3000 },
      { type: "Partial Payment", supplier: "Test Supplier C", paymentType: "Partial", amount: 4000 },
      { type: "Due Payment", supplier: "Test Supplier A", paymentType: "Due", amount: 2000 }
    ];

    // Test complete flow for each transaction type
    transactions.forEach((transaction, index) => {
      const flowLabel = `Transaction ${index + 1}: ${transaction.type}`;
      const flow = audit.startNested(flowLabel);
      
      // Calculate preview
      audit.start(`${flowLabel} - Preview`);
      BalanceCalculator.calculatePreview(
        transaction.supplier,
        transaction.paymentType,
        transaction.paymentType === "Due" ? 0 : transaction.amount,
        transaction.paymentType === "Unpaid" ? 0 : transaction.amount,
        transaction.paymentType === "Due" ? "INV-PREVIOUS" : ""
      );
      audit.end(`${flowLabel} - Preview`);
      
      // Calculate actual
      audit.start(`${flowLabel} - Actual`);
      BalanceCalculator.calculate({
        supplier: transaction.supplier,
        paymentType: transaction.paymentType,
        receivedAmt: transaction.paymentType === "Due" ? 0 : transaction.amount,
        paymentAmt: transaction.paymentType === "Unpaid" ? 0 : transaction.amount,
        prevInvoice: transaction.paymentType === "Due" ? "INV-PREVIOUS" : ""
      });
      audit.end(`${flowLabel} - Actual`);

      // Validate accuracy
      audit.start(`${flowLabel} - Validation`);
      BalanceCalculator.validatePreviewAccuracy({
        supplier: transaction.supplier,
        paymentType: transaction.paymentType,
        receivedAmt: transaction.paymentType === "Due" ? 0 : transaction.amount,
        paymentAmt: transaction.paymentType === "Unpaid" ? 0 : transaction.amount,
        prevInvoice: transaction.paymentType === "Due" ? "INV-PREVIOUS" : ""
      });
      audit.end(`${flowLabel} - Validation`);

      // Get supplier summary
      audit.start(`${flowLabel} - Summary`);
      BalanceCalculator.getSupplierSummary(transaction.supplier);
      audit.end(`${flowLabel} - Summary`);

      flow.end();
    });

    // Test batch processing
    audit.start("Batch Processing");
    for (let i = 0; i < 5; i++) {
      transactions.forEach(transaction => {
        BalanceCalculator.calculate({
          supplier: transaction.supplier,
          paymentType: transaction.paymentType,
          receivedAmt: transaction.paymentType === "Due" ? 0 : transaction.amount,
          paymentAmt: transaction.paymentType === "Unpaid" ? 0 : transaction.amount,
          prevInvoice: transaction.paymentType === "Due" ? "INV-PREVIOUS" : ""
        });
      });
    }
    audit.end("Batch Processing");

    audit.endAll();
    audit.printSummary();
    return audit.getResult({ transactionsProcessed: transactions.length });

  } catch (error) {
    return audit.fail("End-to-end test failed", error);
  }
}

function testEdgeCasesPerformance() {
  const audit = new PerfAudit("Edge Cases and Error Handling");
  
  try {
    const edgeCases = [
      {
        name: "Empty Supplier",
        test: () => BalanceCalculator.getSupplierOutstanding("")
      },
      {
        name: "Non-Existent Supplier", 
        test: () => BalanceCalculator.getSupplierOutstanding("Non-Existent Supplier XYZ")
      },
      {
        name: "Invalid Payment Type",
        test: () => BalanceCalculator._calculateTransactionImpact("InvalidType", 1000, 500, "")
      },
      {
        name: "Due Payment Missing Invoice",
        test: () => BalanceCalculator._calculateTransactionImpact("Due", 0, 1000, "")
      },
      {
        name: "Negative Amounts",
        test: () => BalanceCalculator._calculateTransactionImpact("Regular", -500, -200, "")
      },
      {
        name: "Zero Amounts", 
        test: () => BalanceCalculator._calculateTransactionImpact("Regular", 0, 0, "")
      },
      {
        name: "Large Amounts",
        test: () => BalanceCalculator._calculateTransactionImpact("Regular", 9999999, 9999999, "")
      }
    ];

    // Test error handling performance
    edgeCases.forEach(edgeCase => {
      const nested = audit.startNested(`Edge: ${edgeCase.name}`);
      
      // Multiple iterations to measure error handling overhead
      for (let i = 0; i < 8; i++) {
        try {
          edgeCase.test();
        } catch (error) {
          // Expected for some edge cases
        }
      }
      
      nested.end();
    });

    // Test cache miss scenario
    audit.start("Cache Miss Performance");
    // Force cache refresh to test cold start
    InvoiceCache.invalidateGlobal();
    BalanceCalculator.getSupplierOutstanding("Test Supplier A");
    InvoiceCache.getInvoiceData(); // Rebuild cache
    audit.end("Cache Miss Performance");

    audit.endAll();
    audit.printSummary();
    return audit.getResult({ edgeCasesTested: edgeCases.length });

  } catch (error) {
    return audit.fail("Edge cases test failed", error);
  }
}

/**
 * Run specific performance test based on need
 */
function runFocusedPerformanceTest(testName) {
  const tests = {
    'calculation': testCalculationPerformance,
    'supplier': testSupplierOutstandingPerformance, 
    'preview': testBalancePreviewPerformance,
    'endtoend': testEndToEndPerformance,
    'edgecases': testEdgeCasesPerformance
  };

  const testFunction = tests[testName.toLowerCase()];
  if (testFunction) {
    return testFunction();
  } else {
    console.error(`Unknown test: ${testName}. Available tests: ${Object.keys(tests).join(', ')}`);
    return null;
  }
}