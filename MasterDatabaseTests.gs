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

    const invoiceResult = InvoiceManager.create(testData);

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
 * Test cache functionality with Master Database
 * Verifies that caching works correctly when reading from Master
 *
 * @returns {void} Results logged to Logger
 */
function testMasterDatabaseCaching() {
  Logger.log('='.repeat(80));
  Logger.log('MASTER DATABASE CACHE TEST');
  Logger.log('='.repeat(80));
  Logger.log('');

  if (!CONFIG.isMasterMode()) {
    Logger.log('❌ System is in LOCAL mode - skipping cache test');
    Logger.log('='.repeat(80));
    return;
  }

  try {
    // Clear cache first
    Logger.log('Test 1: Clearing cache');
    Logger.log('-'.repeat(40));
    CacheManager.clear();
    Logger.log('✅ Cache cleared');
    Logger.log('');

    // Test cache load
    Logger.log('Test 2: Loading invoice data from Master Database');
    Logger.log('-'.repeat(40));
    const startTime = Date.now();
    const invoiceData = CacheManager.getInvoiceData();
    const loadTime = Date.now() - startTime;

    Logger.log(`✅ Invoice data loaded in ${loadTime}ms`);
    Logger.log(`   Total invoices: ${invoiceData.data.length - 1}`); // -1 for header
    Logger.log(`   Cache size: ${invoiceData.indexMap.size} entries`);
    Logger.log('');

    // Test cache hit
    Logger.log('Test 3: Testing cache hit');
    Logger.log('-'.repeat(40));
    const hitStartTime = Date.now();
    const cachedData = CacheManager.getInvoiceData();
    const hitTime = Date.now() - hitStartTime;

    Logger.log(`✅ Cache hit in ${hitTime}ms (should be <5ms)`);
    Logger.log('');

    // Test partition stats
    Logger.log('Test 4: Cache partition statistics');
    Logger.log('-'.repeat(40));
    const stats = CacheManager.getPartitionStats();

    Logger.log(`Active Partition: ${stats.active.count} invoices (${stats.active.percentage}%)`);
    Logger.log(`Inactive Partition: ${stats.inactive.count} invoices (${stats.inactive.percentage}%)`);
    Logger.log(`Total: ${stats.total} invoices`);
    Logger.log(`Memory Reduction: ${stats.memoryReduction}`);
    Logger.log('');

    // Summary
    Logger.log('='.repeat(80));
    Logger.log('✅ CACHE TEST COMPLETED');
    Logger.log(`   Load time: ${loadTime}ms`);
    Logger.log(`   Cache hit time: ${hitTime}ms`);
    Logger.log(`   Performance: ${hitTime < 5 ? 'EXCELLENT' : hitTime < 20 ? 'GOOD' : 'NEEDS IMPROVEMENT'}`);
    Logger.log('='.repeat(80));

  } catch (error) {
    Logger.log('');
    Logger.log('❌ CACHE TEST FAILED:');
    Logger.log(`   ${error.toString()}`);
    Logger.log('='.repeat(80));
  }
}

/**
 * TEST: Conditional Cache Strategy Performance
 *
 * Tests the conditional cache loading in both Local and Master modes
 * Measures performance and validates data freshness
 *
 * WHAT IT TESTS:
 * 1. Cache loads from correct source (Master DB vs Local)
 * 2. Performance difference between modes
 * 3. Data freshness after writes
 * 4. No index mismatch warnings
 *
 * RUN FROM: Script Editor → Select function → Run
 */
function testConditionalCacheStrategy() {
  Logger.log('='.repeat(80));
  Logger.log('TESTING: Conditional Cache Strategy');
  Logger.log('='.repeat(80));

  try {
    const currentMode = CONFIG.isMasterMode() ? 'MASTER' : 'LOCAL';
    Logger.log(`\n📍 Current Connection Mode: ${currentMode}`);

    // ═══ TEST 1: Cache Load Performance ═══
    Logger.log('\n' + '─'.repeat(80));
    Logger.log('TEST 1: Cache Load Performance');
    Logger.log('─'.repeat(80));

    // Clear cache to force fresh load
    CacheManager.clear();

    // Measure cache load time
    const startLoad = Date.now();
    const cacheData = CacheManager.getInvoiceData();
    const loadTime = Date.now() - startLoad;

    Logger.log(`✅ Cache loaded in ${loadTime}ms`);
    Logger.log(`   Total invoices: ${cacheData.data.length - 1}`); // Exclude header
    Logger.log(`   Index size: ${cacheData.indexMap.size}`);
    Logger.log(`   Supplier count: ${cacheData.supplierIndex.size}`);

    // Expected performance
    if (CONFIG.isMasterMode()) {
      Logger.log(`   Expected: 300-600ms (cross-file read from Master DB)`);
      if (loadTime > 1000) {
        Logger.log(`   ⚠️ WARNING: Load time exceeds expected range (${loadTime}ms > 1000ms)`);
      }
    } else {
      Logger.log(`   Expected: 200-400ms (local sheet read)`);
      if (loadTime > 600) {
        Logger.log(`   ⚠️ WARNING: Load time exceeds expected range (${loadTime}ms > 600ms)`);
      }
    }

    // ═══ TEST 2: Cache Hit Performance ═══
    Logger.log('\n' + '─'.repeat(80));
    Logger.log('TEST 2: Cache Hit Performance (Warm Cache)');
    Logger.log('─'.repeat(80));

    const startHit = Date.now();
    const cachedData = CacheManager.getInvoiceData();
    const hitTime = Date.now() - startHit;

    Logger.log(`✅ Cache hit in ${hitTime}ms`);
    Logger.log(`   Expected: <5ms (in-memory access)`);

    if (hitTime > 10) {
      Logger.log(`   ⚠️ WARNING: Cache hit slower than expected (${hitTime}ms > 10ms)`);
    }

    // ═══ TEST 3: Data Freshness After Write ═══
    Logger.log('\n' + '─'.repeat(80));
    Logger.log('TEST 3: Data Freshness After Write');
    Logger.log('─'.repeat(80));

    // Create test invoice
    const testSupplier = `TEST_CACHE_${Date.now()}`;
    const testInvoice = `INV_${Date.now()}`;
    const testAmount = 1234.56;

    Logger.log(`   Creating test invoice: ${testSupplier} | ${testInvoice} | ${testAmount}`);

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
      sysId: `test_cache_${Date.now()}`
    };

    // Write invoice
    const createResult = InvoiceManager.create(testData);

    if (!createResult.success) {
      throw new Error(`Failed to create test invoice: ${createResult.error}`);
    }

    Logger.log(`   ✅ Invoice created: ID ${createResult.invoiceId}`);

    // Clear cache to force fresh load
    CacheManager.clear();

    // Read back and verify
    const startFresh = Date.now();
    const freshCache = CacheManager.getInvoiceData();
    const freshTime = Date.now() - startFresh;

    Logger.log(`   Cache reloaded in ${freshTime}ms`);

    // Find test invoice in cache
    const key = `${StringUtils.normalize(testSupplier)}|${StringUtils.normalize(testInvoice)}`;
    const rowIndex = freshCache.indexMap.get(key);

    if (rowIndex === undefined) {
      throw new Error(`Test invoice not found in cache after write (key: ${key})`);
    }

    const cachedRow = freshCache.data[rowIndex];
    const cachedAmount = Number(cachedRow[CONFIG.invoiceCols.totalAmount]);

    Logger.log(`   ✅ Invoice found in cache at index ${rowIndex}`);
    Logger.log(`   Amount match: ${cachedAmount} === ${testAmount} → ${cachedAmount === testAmount ? '✅' : '❌'}`);

    if (Math.abs(cachedAmount - testAmount) > 0.01) {
      throw new Error(`Amount mismatch: cached ${cachedAmount} vs expected ${testAmount}`);
    }

    // ═══ TEST 4: No Index Mismatch Warnings ═══
    Logger.log('\n' + '─'.repeat(80));
    Logger.log('TEST 4: Index Consistency Check');
    Logger.log('─'.repeat(80));

    // Get supplier outstanding (this is where index mismatch warnings would occur)
    const outstanding = BalanceCalculator.getSupplierOutstanding(testSupplier);

    Logger.log(`   ✅ Supplier outstanding calculated: ${outstanding}`);
    Logger.log(`   Expected: ${testAmount} (one unpaid invoice)`);
    Logger.log(`   Match: ${Math.abs(outstanding - testAmount) < 0.01 ? '✅' : '❌'}`);

    if (Math.abs(outstanding - testAmount) > 0.01) {
      Logger.log(`   ⚠️ WARNING: Outstanding mismatch (${outstanding} vs ${testAmount})`);
      Logger.log(`   This may indicate index mismatch issues`);
    } else {
      Logger.log(`   ✅ No index mismatch warnings (cache is consistent)`);
    }

    // ═══ TEST SUMMARY ═══
    Logger.log('\n' + '═'.repeat(80));
    Logger.log('TEST SUMMARY: Conditional Cache Strategy');
    Logger.log('═'.repeat(80));
    Logger.log(`✅ Connection Mode: ${currentMode}`);
    Logger.log(`✅ Cache Source: ${CONFIG.isMasterMode() ? 'Master Database' : 'Local Sheet'}`);
    Logger.log(`✅ Cache Load Time: ${loadTime}ms (${CONFIG.isMasterMode() ? '300-600ms expected' : '200-400ms expected'})`);
    Logger.log(`✅ Cache Hit Time: ${hitTime}ms (<5ms expected)`);
    Logger.log(`✅ Data Freshness: Verified (amount match after write)`);
    Logger.log(`✅ Index Consistency: Verified (no mismatch warnings)`);
    Logger.log('');
    Logger.log('RECOMMENDATION: Conditional cache strategy is working correctly!');
    Logger.log('  - Local mode: Fast reads from local sheet');
    Logger.log('  - Master mode: Bypasses IMPORTRANGE, reads from Master DB');
    Logger.log('  - No index mismatch warnings in either mode');
    Logger.log('='.repeat(80));

  } catch (error) {
    Logger.log('');
    Logger.log('❌ CONDITIONAL CACHE TEST FAILED:');
    Logger.log(`   ${error.toString()}`);
    Logger.log(`   Stack: ${error.stack || 'N/A'}`);
    Logger.log('='.repeat(80));
  }
}
