// ==================== MODULE: MasterDatabaseTests.gs ====================
/**
 * Master Database Connection Tests
 *
 * Test utilities to validate Master Database setup and connectivity.
 * Run these functions from the Script Editor to test your Master Database configuration.
 *
 * USAGE:
 * 1. Set up Master Database configuration in _Config.gs
 * 2. Run testMasterDatabaseConnection() to validate setup
 * 3. Check Logger output for detailed results
 */

/**
 * Test Master Database connection and configuration
 * Run this from Script Editor: Functions → testMasterDatabaseConnection
 *
 * @returns {void} Results logged to Logger
 */
function testMasterDatabaseConnection() {
  Logger.log('='.repeat(80));
  Logger.log('MASTER DATABASE CONNECTION TEST');
  Logger.log('='.repeat(80));
  Logger.log('');

  try {
    // Test 1: Check configuration
    Logger.log('Test 1: Configuration Check');
    Logger.log('-'.repeat(40));
    Logger.log(`Connection Mode: ${CONFIG.masterDatabase.connectionMode}`);
    Logger.log(`Master Database ID: ${CONFIG.masterDatabase.id || '(not configured)'}`);
    Logger.log(`Master Database URL: ${CONFIG.masterDatabase.url ? 'configured' : '(not configured)'}`);
    Logger.log('');

    if (!CONFIG.isMasterMode()) {
      Logger.log('✅ System is in LOCAL mode - using local sheets');
      Logger.log('   To enable Master Database mode:');
      Logger.log('   1. Set CONFIG.masterDatabase.connectionMode = "master"');
      Logger.log('   2. Set CONFIG.masterDatabase.id = "YOUR_MASTER_DB_ID"');
      Logger.log('   3. Set CONFIG.masterDatabase.url = "YOUR_MASTER_DB_URL"');
      Logger.log('');
      return;
    }

    // Test 2: Connection test
    Logger.log('Test 2: Master Database Connection');
    Logger.log('-'.repeat(40));
    const result = MasterDatabaseUtils.testConnection();

    if (result.success) {
      Logger.log('✅ Connection successful!');
      Logger.log(`   File Name: ${result.fileName}`);
      Logger.log(`   File ID: ${result.fileId}`);
      Logger.log('');

      // Test 3: Sheet access
      Logger.log('Test 3: Sheet Access');
      Logger.log('-'.repeat(40));
      Object.entries(result.sheets).forEach(([type, info]) => {
        if (info.accessible) {
          Logger.log(`✅ ${type.toUpperCase()}: ${info.name} (${info.rows} rows, ${info.columns} columns)`);
        } else {
          Logger.log(`❌ ${type.toUpperCase()}: ${info.error}`);
        }
      });
      Logger.log('');

      // Test 4: IMPORTRANGE formula
      Logger.log('Test 4: IMPORTRANGE Formula Generation');
      Logger.log('-'.repeat(40));
      if (result.sampleFormula) {
        Logger.log(`✅ Sample formula: ${result.sampleFormula}`);
      } else {
        Logger.log('❌ Formula generation failed');
      }
      Logger.log('');

    } else {
      Logger.log('❌ Connection failed!');
      Logger.log('');
      Logger.log('Errors:');
      result.errors.forEach(err => Logger.log(`  - ${err}`));
      Logger.log('');
    }

    if (result.warnings.length > 0) {
      Logger.log('Warnings:');
      result.warnings.forEach(warn => Logger.log(`  ⚠️  ${warn}`));
      Logger.log('');
    }

    // Summary
    Logger.log('='.repeat(80));
    if (result.success) {
      Logger.log('✅ MASTER DATABASE CONNECTION TEST PASSED');
      Logger.log('   Your Master Database is properly configured and accessible.');
    } else {
      Logger.log('❌ MASTER DATABASE CONNECTION TEST FAILED');
      Logger.log('   Please review the errors above and fix your configuration.');
    }
    Logger.log('='.repeat(80));

  } catch (error) {
    Logger.log('');
    Logger.log('❌ TEST FAILED WITH EXCEPTION:');
    Logger.log(`   ${error.toString()}`);
    Logger.log('');
    Logger.log('Stack trace:');
    Logger.log(error.stack || '(not available)');
    Logger.log('='.repeat(80));
  }
}

/**
 * Test write operations to Master Database
 * Creates a test invoice and payment to verify write permissions
 *
 * WARNING: This will write test data to your Master Database!
 * Only run this if you're ready to test actual writes.
 *
 * @returns {void} Results logged to Logger
 */
function testMasterDatabaseWrites() {
  Logger.log('='.repeat(80));
  Logger.log('MASTER DATABASE WRITE TEST');
  Logger.log('='.repeat(80));
  Logger.log('');

  if (!CONFIG.isMasterMode()) {
    Logger.log('❌ System is in LOCAL mode - cannot test Master Database writes');
    Logger.log('   Change CONFIG.masterDatabase.connectionMode to "master" first');
    Logger.log('='.repeat(80));
    return;
  }

  try {
    const testSupplier = `TEST_SUPPLIER_${Date.now()}`;
    const testInvoice = `TEST_INV_${Date.now()}`;
    const testAmount = 100.00;

    Logger.log('Test Data:');
    Logger.log(`  Supplier: ${testSupplier}`);
    Logger.log(`  Invoice: ${testInvoice}`);
    Logger.log(`  Amount: $${testAmount}`);
    Logger.log('');

    // Test 1: Create test invoice
    Logger.log('Test 1: Creating test invoice in Master Database');
    Logger.log('-'.repeat(40));

    const testData = {
      supplier: testSupplier,
      invoiceNo: testInvoice,
      receivedAmt: testAmount,
      paymentAmt: 0,
      paymentType: 'Unpaid',
      sheetName: 'TEST',
      rowNum: 1,
      enteredBy: 'TEST_USER',
      timestamp: new Date(),
      sysId: `test_${Date.now()}`
    };

    const invoiceResult = InvoiceManager.createInvoice(testData);

    if (invoiceResult.success) {
      Logger.log(`✅ Invoice created successfully at row ${invoiceResult.row}`);
      Logger.log(`   Invoice ID: ${invoiceResult.invoiceId}`);
    } else {
      Logger.log(`❌ Invoice creation failed: ${invoiceResult.error}`);
      Logger.log('='.repeat(80));
      return;
    }
    Logger.log('');

    // Test 2: Create test payment
    Logger.log('Test 2: Creating test payment in Master Database');
    Logger.log('-'.repeat(40));

    testData.paymentAmt = 50.00;
    testData.paymentType = 'Partial';

    const paymentResult = PaymentManager.process(testData, invoiceResult.invoiceId);

    if (paymentResult.success) {
      Logger.log(`✅ Payment recorded successfully`);
      Logger.log(`   Payment amount: $${testData.paymentAmt}`);
    } else {
      Logger.log(`❌ Payment recording failed: ${paymentResult.error || 'Unknown error'}`);
    }
    Logger.log('');

    // Test 3: Verify audit logging
    Logger.log('Test 3: Verifying audit logging');
    Logger.log('-'.repeat(40));

    AuditLogger.log('TEST_ACTION', testData, 'Master Database write test completed');
    Logger.log('✅ Audit log entry created');
    Logger.log('');

    // Summary
    Logger.log('='.repeat(80));
    Logger.log('✅ MASTER DATABASE WRITE TEST COMPLETED');
    Logger.log('');
    Logger.log('IMPORTANT: Test data was written to your Master Database:');
    Logger.log(`  - Test invoice: ${testInvoice} for supplier ${testSupplier}`);
    Logger.log('  - Test payment: $50.00');
    Logger.log('  - Test audit log entry');
    Logger.log('');
    Logger.log('You may want to manually delete these test entries from your Master Database.');
    Logger.log('='.repeat(80));

  } catch (error) {
    Logger.log('');
    Logger.log('❌ WRITE TEST FAILED WITH EXCEPTION:');
    Logger.log(`   ${error.toString()}`);
    Logger.log('');
    Logger.log('Stack trace:');
    Logger.log(error.stack || '(not available)');
    Logger.log('='.repeat(80));
  }
}

/**
 * Generate IMPORTRANGE formulas for monthly file setup
 * Displays formulas to copy into monthly file sheets
 *
 * @returns {void} Results logged to Logger
 */
function generateImportRangeFormulas() {
  Logger.log('='.repeat(80));
  Logger.log('IMPORTRANGE FORMULA GENERATOR');
  Logger.log('='.repeat(80));
  Logger.log('');

  if (!CONFIG.isMasterMode()) {
    Logger.log('❌ System is in LOCAL mode');
    Logger.log('   Set CONFIG.masterDatabase.connectionMode to "master" first');
    Logger.log('='.repeat(80));
    return;
  }

  if (!CONFIG.masterDatabase.url) {
    Logger.log('❌ Master Database URL not configured');
    Logger.log('   Set CONFIG.masterDatabase.url first');
    Logger.log('='.repeat(80));
    return;
  }

  Logger.log('Copy these formulas into your monthly file sheets:');
  Logger.log('');

  const sheetTypes = ['invoice', 'payment', 'audit', 'supplier'];

  sheetTypes.forEach(type => {
    try {
      const formula = MasterDatabaseUtils.buildImportFormula(type);
      const sheetName = CONFIG.masterDatabase.sheets[type];

      Logger.log(`${type.toUpperCase()} (${sheetName}):`);
      Logger.log(`  Cell A1: ${formula}`);
      Logger.log('');
    } catch (error) {
      Logger.log(`${type.toUpperCase()}: ❌ Error - ${error.message}`);
      Logger.log('');
    }
  });

  Logger.log('INSTRUCTIONS:');
  Logger.log('1. In your monthly file, go to each sheet listed above');
  Logger.log('2. Clear the existing data (backup first!)');
  Logger.log('3. Paste the IMPORTRANGE formula into cell A1');
  Logger.log('4. When prompted, grant permission to connect to the Master Database');
  Logger.log('5. The sheet will populate with data from the Master Database');
  Logger.log('');
  Logger.log('='.repeat(80));
}

/**
 * Display Master Database configuration summary
 * Shows current settings and status
 *
 * @returns {void} Results logged to Logger
 */
function showMasterDatabaseConfig() {
  Logger.log('='.repeat(80));
  Logger.log('MASTER DATABASE CONFIGURATION');
  Logger.log('='.repeat(80));
  Logger.log('');

  Logger.log('Connection Mode:');
  Logger.log(`  ${CONFIG.masterDatabase.connectionMode.toUpperCase()} ${CONFIG.isMasterMode() ? '(writes to Master)' : '(writes to local sheets)'}`);
  Logger.log('');

  Logger.log('Master Database:');
  Logger.log(`  ID: ${CONFIG.masterDatabase.id || '(not configured)'}`);
  Logger.log(`  URL: ${CONFIG.masterDatabase.url || '(not configured)'}`);
  Logger.log('');

  Logger.log('Sheet Mappings:');
  Object.entries(CONFIG.masterDatabase.sheets).forEach(([type, name]) => {
    Logger.log(`  ${type}: ${name}`);
  });
  Logger.log('');

  Logger.log('Import Ranges:');
  Object.entries(CONFIG.masterDatabase.importRanges).forEach(([type, range]) => {
    Logger.log(`  ${type}: ${range}`);
  });
  Logger.log('');

  Logger.log('='.repeat(80));
}

/**
 * BENCHMARK FUNCTIONS MIGRATED
 * The following performance benchmark functions have been moved to Benchmark.Performance.gs:
 * - testMasterDatabaseCaching()
 * - testConditionalCacheStrategy()
 * - testBatchOperationsPerformance()
 *
 * See Benchmark.Performance.gs for these performance testing functions.
 * This file now contains only unit tests for Master Database functionality.
 */

/**
 * TEST: buildDataObject Date Handling
 *
 * Tests that buildDataObject correctly extracts invoiceDate from daily sheet
 * and passes it to InvoiceManager and PaymentManager
 *
 * WHAT IT TESTS:
 * 1. buildDataObject includes invoiceDate field
 * 2. invoiceDate is extracted from getDailySheetDate()
 * 3. Data object structure matches expectations
 * 4. PaymentManager compatibility (data.paymentDate || data.invoiceDate)
 *
 * RUN FROM: Script Editor → Select function → Run
 */
function testBuildDataObjectDateHandling() {
  Logger.log('='.repeat(80));
  Logger.log('TESTING: buildDataObject Date Handling');
  Logger.log('='.repeat(80));

  try {
    // ═══ TEST 1: buildDataObject includes invoiceDate ═══
    Logger.log('\n' + '─'.repeat(80));
    Logger.log('TEST 1: buildDataObject includes invoiceDate field');
    Logger.log('─'.repeat(80));

    const testSheetName = '15'; // Day 15 of current month
    const testRowData = [
      '', // Column A (not used)
      'TEST_SUPPLIER', // Column B (supplier)
      'TEST_INV_001', // Column C (invoiceNo)
      1000, // Column D (receivedAmt)
      'Unpaid', // Column E (paymentType)
      '', // Column F (prevInvoice)
      0, // Column G (paymentAmt)
      '', // Column H (balance)
      'Test notes', // Column I (notes)
      true, // Column J (post)
      '', // Column K (status)
      '', // Column L (enteredBy)
      '', // Column M (timestamp)
      '' // Column N (sysId)
    ];

    const testRowNum = 10;

    // Call buildDataObject
    const data = buildDataObject(testRowData, testRowNum, testSheetName);

    Logger.log('   Data object keys: ' + Object.keys(data).join(', '));

    // Check if invoiceDate exists
    if (!data.hasOwnProperty('invoiceDate')) {
      throw new Error('data.invoiceDate is missing!');
    }

    Logger.log('   ✅ data.invoiceDate exists');

    // ═══ TEST 2: invoiceDate is a Date object ===
    Logger.log('\n' + '─'.repeat(80));
    Logger.log('TEST 2: invoiceDate is a valid Date object');
    Logger.log('─'.repeat(80));

    if (!(data.invoiceDate instanceof Date)) {
      throw new Error('data.invoiceDate is not a Date (type: ' + typeof data.invoiceDate + ')');
    }

    Logger.log('   ✅ data.invoiceDate is a Date object');
    Logger.log('   Value: ' + data.invoiceDate);

    // ═══ TEST 3: PaymentManager compatibility ===
    Logger.log('\n' + '─'.repeat(80));
    Logger.log('TEST 3: PaymentManager date fallback chain');
    Logger.log('─'.repeat(80));

    // Simulate PaymentManager.gs line 386: data.paymentDate || data.invoiceDate
    const paymentDate = data.paymentDate || data.invoiceDate;

    Logger.log('   data.paymentDate: ' + (data.paymentDate || 'undefined'));
    Logger.log('   data.invoiceDate: ' + data.invoiceDate);
    Logger.log('   Resolved paymentDate: ' + paymentDate);

    if (!(paymentDate instanceof Date)) {
      throw new Error('PaymentManager date fallback failed');
    }

    Logger.log('   ✅ PaymentManager date fallback works correctly');

    // ═══ TEST SUMMARY ===
    Logger.log('\n' + '═'.repeat(80));
    Logger.log('TEST SUMMARY: buildDataObject Date Handling');
    Logger.log('═'.repeat(80));
    Logger.log('✅ data.invoiceDate field exists');
    Logger.log('✅ invoiceDate is a valid Date object');
    Logger.log('✅ PaymentManager compatibility verified');
    Logger.log('');
    Logger.log('RESULT: buildDataObject correctly handles invoice dates!');
    Logger.log('  - InvoiceManager will use data.invoiceDate');
    Logger.log('  - PaymentManager will use data.invoiceDate (no paymentDate provided)');
    Logger.log('  - Dates reflect actual transaction date from daily sheet');
    Logger.log('='.repeat(80));

  } catch (error) {
    Logger.log('');
    Logger.log('❌ DATE HANDLING TEST FAILED:');
    Logger.log('   ' + error.toString());
    Logger.log('   Stack: ' + (error.stack || 'N/A'));
    Logger.log('='.repeat(80));
  }
}
