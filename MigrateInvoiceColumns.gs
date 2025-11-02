// ==================== INVOICE COLUMNS MIGRATION SCRIPT ====================
/**
 * Migration Script: Reorganize InvoiceDatabase Columns
 *
 * PURPOSE:
 * Safely migrate InvoiceDatabase sheet from old structure to new structure
 * that matches paymentCols pattern (identifiers → business data → metadata → system)
 *
 * OLD STRUCTURE (12 columns):
 * A=date, B=supplier, C=invoiceNo, D=invoiceDate, E=totalAmount, F=totalPaid,
 * G=balanceDue, H=status, I=paidDate, J=originDay, K=daysOutstanding, L=sysId
 *
 * NEW STRUCTURE (13 columns):
 * A=invoiceDate, B=supplier, C=invoiceNo, D=totalAmount, E=totalPaid, F=balanceDue,
 * G=status, H=paidDate, I=daysOutstanding, J=originDay, K=enteredBy, L=timestamp, M=sysId
 *
 * CHANGES:
 * - invoiceDate: D → A
 * - totalAmount: E → D
 * - totalPaid: F → E (formula)
 * - balanceDue: G → F (formula)
 * - status: H → G (formula)
 * - paidDate: I → H (formula)
 * - daysOutstanding: K → I (formula)
 * - originDay: J → J (no change)
 * - enteredBy: NEW → K
 * - timestamp: A → L
 * - sysId: L → M
 *
 * SAFETY FEATURES:
 * - Creates backup sheet before migration
 * - Validates data before and after migration
 * - Rollback capability
 * - Dry-run mode for testing
 */

/**
 * Main migration function
 * Call this from Script Editor to run migration
 *
 * @param {boolean} dryRun - If true, only validates without making changes
 * @returns {Object} Migration result
 */
function migrateInvoiceColumns(dryRun = true) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  // Confirmation dialog
  if (!dryRun) {
    const response = ui.alert(
      'Invoice Column Migration',
      'This will reorganize the InvoiceDatabase sheet structure.\n\n' +
      'A backup will be created before migration.\n\n' +
      'Do you want to proceed?',
      ui.ButtonSet.YES_NO
    );

    if (response !== ui.Button.YES) {
      return { success: false, message: 'Migration cancelled by user' };
    }
  }

  try {
    Logger.log('=== INVOICE COLUMN MIGRATION STARTED ===');
    Logger.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);

    // Step 1: Validate preconditions
    Logger.log('Step 1: Validating preconditions...');
    const validation = validatePreconditions(ss);
    if (!validation.valid) {
      return { success: false, message: validation.error };
    }

    const invoiceSheet = ss.getSheetByName(CONFIG.invoiceSheet);
    const lastRow = invoiceSheet.getLastRow();

    if (lastRow < 2) {
      return { success: true, message: 'No data to migrate (empty sheet)' };
    }

    // Step 2: Create backup (skip in dry run)
    let backupSheet = null;
    if (!dryRun) {
      Logger.log('Step 2: Creating backup sheet...');
      backupSheet = createBackup(ss, invoiceSheet);
      Logger.log(`Backup created: ${backupSheet.getName()}`);
    }

    // Step 3: Read all existing data
    Logger.log('Step 3: Reading existing data...');
    const oldData = invoiceSheet.getRange(1, 1, lastRow, 12).getValues();
    const oldFormulas = invoiceSheet.getRange(1, 1, lastRow, 12).getFormulas();

    Logger.log(`Read ${lastRow} rows (including header)`);

    // Step 4: Transform data to new structure
    Logger.log('Step 4: Transforming data to new structure...');
    const transformResult = transformDataToNewStructure(oldData, oldFormulas);
    const { newData, newFormulas } = transformResult;

    Logger.log(`Transformed ${newData.length} rows`);

    // Step 5: Validate transformed data
    Logger.log('Step 5: Validating transformed data...');
    const dataValidation = validateTransformedData(oldData, newData);
    if (!dataValidation.valid) {
      return { success: false, message: `Data validation failed: ${dataValidation.error}` };
    }

    // Step 6: Apply changes (skip in dry run)
    if (!dryRun) {
      Logger.log('Step 6: Applying changes to sheet...');
      applyChanges(invoiceSheet, newData, newFormulas);
      Logger.log('Changes applied successfully');
    } else {
      Logger.log('Step 6: SKIPPED (dry run mode)');
    }

    // Step 7: Verification
    Logger.log('Step 7: Verification...');
    if (!dryRun) {
      const verifyResult = verifyMigration(invoiceSheet);
      if (!verifyResult.valid) {
        Logger.log('VERIFICATION FAILED - Consider rollback');
        return {
          success: false,
          message: `Migration completed but verification failed: ${verifyResult.error}`,
          backupSheet: backupSheet ? backupSheet.getName() : null
        };
      }
    }

    Logger.log('=== MIGRATION COMPLETED SUCCESSFULLY ===');

    const result = {
      success: true,
      message: dryRun
        ? 'Dry run completed successfully - data is ready for migration'
        : 'Migration completed successfully',
      rowsMigrated: lastRow - 1,
      backupSheet: backupSheet ? backupSheet.getName() : null,
      dryRun: dryRun
    };

    if (!dryRun) {
      ui.alert(
        'Migration Complete',
        `InvoiceDatabase structure updated successfully!\n\n` +
        `Rows migrated: ${result.rowsMigrated}\n` +
        `Backup sheet: ${result.backupSheet}\n\n` +
        `Please verify the data and formulas.`,
        ui.ButtonSet.OK
      );
    }

    return result;

  } catch (error) {
    Logger.log(`ERROR: ${error.toString()}`);
    Logger.log(error.stack);

    const errorMsg = `Migration failed: ${error.toString()}`;

    if (!dryRun) {
      ui.alert('Migration Error', errorMsg, ui.ButtonSet.OK);
    }

    return { success: false, message: errorMsg };
  }
}

/**
 * Validate preconditions for migration
 */
function validatePreconditions(ss) {
  const invoiceSheet = ss.getSheetByName(CONFIG.invoiceSheet);

  if (!invoiceSheet) {
    return { valid: false, error: 'InvoiceDatabase sheet not found' };
  }

  const currentCols = invoiceSheet.getLastColumn();
  if (currentCols !== 12) {
    return {
      valid: false,
      error: `Expected 12 columns, found ${currentCols}. Sheet may already be migrated or have incorrect structure.`
    };
  }

  // Check if headers match old structure
  const headers = invoiceSheet.getRange(1, 1, 1, 12).getValues()[0];
  const expectedHeaders = ['Date', 'Supplier', 'Invoice No', 'Invoice Date', 'Total Amount', 'Total Paid',
                           'Balance Due', 'Status', 'Paid Date', 'Origin Day', 'Days Outstanding', 'SYS_ID'];

  for (let i = 0; i < expectedHeaders.length; i++) {
    if (headers[i] !== expectedHeaders[i]) {
      Logger.log(`WARNING: Header mismatch at column ${i + 1}: expected "${expectedHeaders[i]}", found "${headers[i]}"`);
    }
  }

  return { valid: true };
}

/**
 * Create backup of InvoiceDatabase sheet
 */
function createBackup(ss, invoiceSheet) {
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const backupName = `InvoiceDatabase_Backup_${timestamp}`;

  const backup = invoiceSheet.copyTo(ss);
  backup.setName(backupName);

  // Move backup to end
  ss.moveActiveSheet(ss.getNumSheets());

  return backup;
}

/**
 * Transform data from old structure to new structure
 */
function transformDataToNewStructure(oldData, oldFormulas) {
  const newData = [];
  const newFormulas = [];

  // Process header row
  const newHeaders = [
    'Invoice Date',   // A (was D)
    'Supplier',       // B (was B)
    'Invoice No',     // C (was C)
    'Total Amount',   // D (was E)
    'Total Paid',     // E (was F - formula)
    'Balance Due',    // F (was G - formula)
    'Status',         // G (was H - formula)
    'Paid Date',      // H (was I)
    'Days Outstanding', // I (was K - formula)
    'Origin Day',     // J (was J)
    'Entered By',     // K (NEW)
    'Timestamp',      // L (was A)
    'SYS_ID'          // M (was L)
  ];

  newData.push(newHeaders);
  newFormulas.push(new Array(13).fill(''));

  // Process data rows
  for (let i = 1; i < oldData.length; i++) {
    const oldRow = oldData[i];
    const oldFormulaRow = oldFormulas[i];
    const rowNum = i + 1; // 1-based row number

    // Map old columns to new positions
    // OLD: [date(A), supplier(B), invoiceNo(C), invoiceDate(D), totalAmount(E), totalPaid(F), balanceDue(G), status(H), paidDate(I), originDay(J), daysOutstanding(K), sysId(L)]
    // NEW: [invoiceDate(A), supplier(B), invoiceNo(C), totalAmount(D), totalPaid(E), balanceDue(F), status(G), paidDate(H), daysOutstanding(I), originDay(J), enteredBy(K), timestamp(L), sysId(M)]

    const newRow = [
      oldRow[3],                    // A: invoiceDate (was D)
      oldRow[1],                    // B: supplier (was B)
      oldRow[2],                    // C: invoiceNo (was C)
      oldRow[4],                    // D: totalAmount (was E)
      null,                         // E: totalPaid (formula - will be set separately)
      null,                         // F: balanceDue (formula - will be set separately)
      null,                         // G: status (formula - will be set separately)
      oldRow[8],                    // H: paidDate (was I)
      null,                         // I: daysOutstanding (formula - will be set separately)
      oldRow[9],                    // J: originDay (was J)
      'SYSTEM',                     // K: enteredBy (NEW - default value)
      oldRow[0],                    // L: timestamp (was A)
      oldRow[11]                    // M: sysId (was L)
    ];

    // Build formula row with updated column references
    // NEW STRUCTURE: A=invoiceDate, B=supplier, C=invoiceNo, D=totalAmount, E=totalPaid, F=balanceDue, G=status, H=paidDate, I=daysOutstanding
    const newFormulaRow = [
      '',                                                                                                                     // A: invoiceDate (data)
      '',                                                                                                                     // B: supplier (data)
      '',                                                                                                                     // C: invoiceNo (data)
      '',                                                                                                                     // D: totalAmount (data)
      `=IF(C${rowNum}="","",IFERROR(SUMIFS(PaymentLog!E:E, PaymentLog!C:C,C${rowNum}, PaymentLog!B:B,B${rowNum}),0))`,      // E: totalPaid (formula)
      `=IF(D${rowNum}="","",D${rowNum}-E${rowNum})`,                                                                         // F: balanceDue (formula)
      `=IFS(F${rowNum}=0,"Paid",F${rowNum}=D${rowNum},"Unpaid",F${rowNum}<D${rowNum},"Partial")`,                           // G: status (formula)
      '',                                                                                                                     // H: paidDate (data)
      `=IF(F${rowNum}=0,0,TODAY()-A${rowNum})`,                                                                              // I: daysOutstanding (formula)
      '',                                                                                                                     // J: originDay (data)
      '',                                                                                                                     // K: enteredBy (data)
      '',                                                                                                                     // L: timestamp (data)
      ''                                                                                                                      // M: sysId (data)
    ];

    newData.push(newRow);
    newFormulas.push(newFormulaRow);
  }

  return { newData, newFormulas };
}

/**
 * Validate transformed data
 */
function validateTransformedData(oldData, newData) {
  // Check row counts match
  if (oldData.length !== newData.length) {
    return {
      valid: false,
      error: `Row count mismatch: old=${oldData.length}, new=${newData.length}`
    };
  }

  // Validate critical data preserved
  for (let i = 1; i < oldData.length; i++) {
    const oldRow = oldData[i];
    const newRow = newData[i];

    // Check supplier (B→B)
    if (oldRow[1] !== newRow[1]) {
      return {
        valid: false,
        error: `Row ${i + 1}: Supplier mismatch - old="${oldRow[1]}", new="${newRow[1]}"`
      };
    }

    // Check invoiceNo (C→C)
    if (oldRow[2] !== newRow[2]) {
      return {
        valid: false,
        error: `Row ${i + 1}: Invoice No mismatch - old="${oldRow[2]}", new="${newRow[2]}"`
      };
    }

    // Check totalAmount (E→D)
    if (oldRow[4] !== newRow[3]) {
      return {
        valid: false,
        error: `Row ${i + 1}: Total Amount mismatch - old="${oldRow[4]}", new="${newRow[3]}"`
      };
    }

    // Check sysId (L→M)
    if (oldRow[11] !== newRow[12]) {
      return {
        valid: false,
        error: `Row ${i + 1}: SYS_ID mismatch - old="${oldRow[11]}", new="${newRow[12]}"`
      };
    }
  }

  return { valid: true };
}

/**
 * Apply changes to InvoiceDatabase sheet
 */
function applyChanges(invoiceSheet, newData, newFormulas) {
  const lastRow = invoiceSheet.getLastRow();

  // Step 1: Clear existing data
  invoiceSheet.clear();

  // Step 2: Set new column count by inserting one column
  invoiceSheet.insertColumnAfter(12); // Insert column M

  // Step 3: Write new data
  invoiceSheet.getRange(1, 1, newData.length, 13).setValues(newData);

  // Step 4: Apply formulas
  for (let i = 0; i < newFormulas.length; i++) {
    const formulaRow = newFormulas[i];
    const rowNum = i + 1;

    for (let j = 0; j < formulaRow.length; j++) {
      if (formulaRow[j]) {
        invoiceSheet.getRange(rowNum, j + 1).setFormula(formulaRow[j]);
      }
    }
  }

  // Step 5: Format headers
  const headerRange = invoiceSheet.getRange(1, 1, 1, 13);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#E8F5E8');

  Logger.log('Sheet structure updated successfully');
}

/**
 * Verify migration completed successfully
 */
function verifyMigration(invoiceSheet) {
  // Check column count
  const cols = invoiceSheet.getLastColumn();
  if (cols !== 13) {
    return { valid: false, error: `Expected 13 columns, found ${cols}` };
  }

  // Check headers
  const headers = invoiceSheet.getRange(1, 1, 1, 13).getValues()[0];
  const expectedHeaders = ['Invoice Date', 'Supplier', 'Invoice No', 'Total Amount', 'Total Paid',
                           'Balance Due', 'Status', 'Paid Date', 'Days Outstanding', 'Origin Day',
                           'Entered By', 'Timestamp', 'SYS_ID'];

  for (let i = 0; i < expectedHeaders.length; i++) {
    if (headers[i] !== expectedHeaders[i]) {
      return {
        valid: false,
        error: `Header mismatch at column ${i + 1}: expected "${expectedHeaders[i]}", found "${headers[i]}"`
      };
    }
  }

  // Check formulas exist in correct columns
  if (invoiceSheet.getLastRow() > 1) {
    const formulas = invoiceSheet.getRange(2, 1, 1, 13).getFormulas()[0];

    // E (index 4) should have formula
    if (!formulas[4] || !formulas[4].startsWith('=')) {
      return { valid: false, error: 'Total Paid formula missing in column E' };
    }

    // F (index 5) should have formula
    if (!formulas[5] || !formulas[5].startsWith('=')) {
      return { valid: false, error: 'Balance Due formula missing in column F' };
    }

    // G (index 6) should have formula
    if (!formulas[6] || !formulas[6].startsWith('=')) {
      return { valid: false, error: 'Status formula missing in column G' };
    }

    // I (index 8) should have formula
    if (!formulas[8] || !formulas[8].startsWith('=')) {
      return { valid: false, error: 'Days Outstanding formula missing in column I' };
    }
  }

  return { valid: true };
}

/**
 * Rollback migration using backup sheet
 *
 * @param {string} backupSheetName - Name of backup sheet to restore from
 * @returns {Object} Rollback result
 */
function rollbackMigration(backupSheetName) {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Rollback Migration',
    `This will restore InvoiceDatabase from backup:\n${backupSheetName}\n\n` +
    'Current InvoiceDatabase will be deleted.\n\n' +
    'Do you want to proceed?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return { success: false, message: 'Rollback cancelled by user' };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const backupSheet = ss.getSheetByName(backupSheetName);

    if (!backupSheet) {
      return { success: false, message: `Backup sheet "${backupSheetName}" not found` };
    }

    const currentInvoiceSheet = ss.getSheetByName(CONFIG.invoiceSheet);
    if (currentInvoiceSheet) {
      ss.deleteSheet(currentInvoiceSheet);
    }

    const restoredSheet = backupSheet.copyTo(ss);
    restoredSheet.setName(CONFIG.invoiceSheet);

    // Reorder to original position (usually position 2 after daily sheets)
    ss.setActiveSheet(restoredSheet);
    ss.moveActiveSheet(2);

    ui.alert(
      'Rollback Complete',
      `InvoiceDatabase has been restored from backup.\n\n` +
      `Backup sheet "${backupSheetName}" is still available.`,
      ui.ButtonSet.OK
    );

    return { success: true, message: 'Rollback completed successfully' };

  } catch (error) {
    const errorMsg = `Rollback failed: ${error.toString()}`;
    ui.alert('Rollback Error', errorMsg, ui.ButtonSet.OK);
    return { success: false, message: errorMsg };
  }
}

/**
 * Test function - runs dry run migration
 */
function testMigration() {
  const result = migrateInvoiceColumns(true);
  Logger.log('Test Migration Result:');
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Production function - runs actual migration
 */
function runMigration() {
  const result = migrateInvoiceColumns(false);
  Logger.log('Migration Result:');
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
