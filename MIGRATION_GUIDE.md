# Invoice Column Reorganization - Migration Guide

## Overview

This guide covers the migration of the InvoiceDatabase sheet structure to align with the paymentCols pattern, providing better consistency and adding the `enteredBy` metadata field.

## Changes Summary

### Column Mapping Changes

| Field | Old Position | New Position | Type | Notes |
|-------|-------------|--------------|------|-------|
| **Invoice Date** | D (3) | A (0) | Data | Moved to first position (identifier) |
| **Supplier** | B (1) | B (1) | Data | No change |
| **Invoice No** | C (2) | C (2) | Data | No change |
| **Total Amount** | E (4) | D (3) | Data | Moved left |
| **Total Paid** | F (5) | E (4) | Formula | Updated formula references |
| **Balance Due** | G (6) | F (5) | Formula | Updated formula references |
| **Status** | H (7) | G (6) | Formula | Updated formula references |
| **Paid Date** | I (8) | H (7) | Data | Moved left |
| **Days Outstanding** | K (10) | I (8) | Formula | Updated formula references |
| **Origin Day** | J (9) | J (9) | Data | No change |
| **Entered By** | - | K (10) | Data | **NEW FIELD** (default: "SYSTEM") |
| **Timestamp** | A (0) | L (11) | Data | Moved to metadata section |
| **SYS_ID** | L (11) | M (12) | Data | Moved to last position |

### Formula Updates

**Old Formulas:**
```javascript
F: =IF(C2="","",IFERROR(SUMIFS(PaymentLog!E:E, PaymentLog!C:C,C2, PaymentLog!B:B,B2),0))
G: =IF(E2="","",E2-F2)
H: =IFS(G2=0,"Paid",G2=E2,"Unpaid",G2<E2,"Partial")
K: =IF(G2=0,0,TODAY()-D2)
```

**New Formulas:**
```javascript
E: =IF(C2="","",IFERROR(SUMIFS(PaymentLog!E:E, PaymentLog!C:C,C2, PaymentLog!B:B,B2),0))
F: =IF(D2="","",D2-E2)
G: =IFS(F2=0,"Paid",F2=D2,"Unpaid",F2<D2,"Partial")
I: =IF(F2=0,0,TODAY()-A2)
```

## Migration Steps

### Pre-Migration Checklist

- [ ] **Backup**: Ensure recent spreadsheet backup exists
- [ ] **Test Environment**: Test migration in a copy first
- [ ] **User Communication**: Notify all users of maintenance window
- [ ] **Cache Clear**: Clear all caches before migration
- [ ] **Config Update**: Verify CONFIG changes are deployed

### Step 1: Run Dry Run Test

```javascript
// In Google Apps Script editor
function testMigration() {
  const result = migrateInvoiceColumns(true);
  Logger.log(JSON.stringify(result, null, 2));
}
```

**Verify dry run results:**
- Check Logger output for any validation errors
- Confirm row counts match
- Verify no data loss in transformation

### Step 2: Run Live Migration

```javascript
// In Google Apps Script editor
function runMigration() {
  const result = migrateInvoiceColumns(false);
  Logger.log(JSON.stringify(result, null, 2));
}
```

**During migration, the script will:**
1. Show confirmation dialog
2. Create backup sheet (InvoiceDatabase_Backup_YYYYMMDD_HHMMSS)
3. Read all existing data
4. Transform to new structure
5. Validate transformed data
6. Clear and restructure sheet
7. Write new data with updated formulas
8. Verify migration success

### Step 3: Post-Migration Verification

#### A. Manual Verification

1. **Check Headers:**
   ```
   A: Invoice Date
   B: Supplier
   C: Invoice No
   D: Total Amount
   E: Total Paid
   F: Balance Due
   G: Status
   H: Paid Date
   I: Days Outstanding
   J: Origin Day
   K: Entered By
   L: Timestamp
   M: SYS_ID
   ```

2. **Verify Formulas:**
   - Column E (Total Paid): Should have SUMIFS formula
   - Column F (Balance Due): Should calculate D-E
   - Column G (Status): Should show Paid/Unpaid/Partial
   - Column I (Days Outstanding): Should calculate from column A

3. **Spot Check Data:**
   - Pick 5-10 random invoices
   - Verify all data fields are correct
   - Check calculated balances match expected values
   - Confirm timestamps and dates are correct

#### B. Automated Verification

Run the verification function:
```javascript
function verifyMigrationResult() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('InvoiceDatabase');
  const result = verifyMigration(sheet);
  Logger.log(JSON.stringify(result, null, 2));
}
```

#### C. System Integration Test

1. **Create New Invoice:**
   - Go to a daily sheet
   - Enter a new transaction
   - Click Post checkbox
   - Verify invoice created correctly with new structure

2. **Process Payment:**
   - Create a Due payment on existing invoice
   - Verify payment recorded correctly
   - Check balance updates properly

3. **Check Cache:**
   - Run `CacheManager.getInvoiceData()`
   - Verify cache loads without errors
   - Check partition stats with `CacheManager.getPartitionStats()`

4. **Validate Balances:**
   - Run `BalanceCalculator.getSupplierOutstanding('SUPPLIER_NAME')`
   - Compare with manual calculation
   - Verify formulas calculate correctly

### Step 4: Rollback (If Needed)

If issues are discovered:

```javascript
function rollback() {
  // Replace with your actual backup sheet name
  const backupName = 'InvoiceDatabase_Backup_20250102_143022';
  return rollbackMigration(backupName);
}
```

## Code Changes Summary

### Files Modified

1. **_Config.gs**
   - Updated `invoiceCols` mapping
   - Changed `totalColumns.invoice` from 12 to 13
   - Updated header validation array

2. **InvoiceManager.gs**
   - Updated `create()` function - new row structure and formulas
   - Updated `setFormulas()` function - formula column references
   - Updated `getAllForSupplier()` - return object structure
   - Updated `batchCreate()` - row construction
   - Updated `repairAllFormulas()` - formula column indices

3. **CacheManager.gs**
   - Fixed `getSupplierData()` - changed `paymentStatus` to `status`

4. **BalanceCalculator.gs**
   - No changes needed (uses CONFIG dynamically)

5. **PaymentManager.gs**
   - No changes needed (uses CONFIG dynamically)

### New Files

1. **MigrateInvoiceColumns.gs**
   - Complete migration script with backup/rollback
   - Dry-run testing capability
   - Data transformation and validation

2. **MIGRATION_GUIDE.md**
   - This documentation file

## Testing Scenarios

### Scenario 1: Create New Invoice (Unpaid)

**Steps:**
1. Go to daily sheet (e.g., sheet "15")
2. Enter: Supplier="TestCo", Invoice No="TEST001", Received Amt=1000, Payment Type="Unpaid"
3. Check Post box

**Expected Result:**
- New row in InvoiceDatabase with:
  - A (Invoice Date): Sheet date
  - B (Supplier): TestCo
  - C (Invoice No): TEST001
  - D (Total Amount): 1000
  - E (Total Paid): 0 (formula)
  - F (Balance Due): 1000 (formula)
  - G (Status): Unpaid (formula)
  - H (Paid Date): Empty
  - I (Days Outstanding): >0 (formula)
  - J (Origin Day): 15
  - K (Entered By): Current user
  - L (Timestamp): Current datetime
  - M (SYS_ID): Generated ID

### Scenario 2: Regular Payment

**Steps:**
1. Create invoice with receivedAmt=500, paymentAmt=500, paymentType="Regular"
2. Post transaction

**Expected Result:**
- Invoice created with Status="Paid"
- Paid Date set to current date
- Days Outstanding=0
- Payment recorded in PaymentLog

### Scenario 3: Partial Payment

**Steps:**
1. Create invoice: receivedAmt=1000, paymentAmt=400, paymentType="Partial"
2. Post transaction

**Expected Result:**
- Invoice Status="Partial"
- Balance Due=600
- Paid Date empty
- Days Outstanding calculated from invoice date

### Scenario 4: Due Payment

**Steps:**
1. Find unpaid invoice from Scenario 3
2. Create Due payment: prevInvoice="TEST001", paymentAmt=600
3. Post transaction

**Expected Result:**
- Original invoice Balance Due=0
- Invoice Status="Paid"
- Paid Date updated
- Days Outstanding=0

### Scenario 5: Cache Operations

**Steps:**
1. Clear cache: `CacheManager.clear()`
2. Query invoice: `InvoiceManager.find('TestCo', 'TEST001')`
3. Check cache stats: `CacheManager.getPartitionStats()`

**Expected Result:**
- Cache loads new 13-column structure
- Invoice found correctly
- All fields accessible via CONFIG.invoiceCols
- Partition stats show active/inactive split

## Troubleshooting

### Issue: "Column count mismatch" error

**Cause:** Sheet already migrated or has incorrect structure

**Solution:**
- Check current column count
- If 13 columns exist, migration already complete
- If other number, manual fix needed

### Issue: Formulas showing #REF! errors

**Cause:** Formula column references incorrect

**Solution:**
- Run `InvoiceManager.repairAllFormulas()`
- Manually verify formula references match new structure

### Issue: Cache loading errors

**Cause:** Cache expects old structure

**Solution:**
- Clear cache: `CacheManager.clear()`
- Reload application
- Re-test invoice operations

### Issue: Balance calculations incorrect

**Cause:** Formula errors or cache issues

**Solution:**
1. Check formulas in columns E, F, G, I
2. Clear cache
3. Manually verify one invoice:
   - Total Amount (D) = Original invoice amount
   - Total Paid (E) = Sum of payments from PaymentLog
   - Balance Due (F) = D - E
   - Status (G) = Based on F value

### Issue: New invoices not getting enteredBy

**Cause:** Data object missing enteredBy field

**Solution:**
- Check `data.enteredBy` is populated before invoice creation
- Fallback to `UserResolver.getCurrentUser()` is in place
- Verify UserResolver working correctly

## Support

If issues persist after troubleshooting:

1. **Check Audit Log:**
   - Review AuditLog sheet for errors
   - Look for failed invoice creation or payment processing

2. **Review Migration Backup:**
   - Backup sheet created: `InvoiceDatabase_Backup_YYYYMMDD_HHMMSS`
   - Can rollback if needed

3. **Contact Development Team:**
   - Provide error messages
   - Share Logger output
   - Note which step failed

## Maintenance

### After Migration

1. **Monitor Performance:**
   - Check cache hit rates
   - Verify partition distribution
   - Monitor audit log for errors

2. **Update Documentation:**
   - Update any external documentation referencing old structure
   - Update training materials
   - Update API documentation if applicable

3. **Clean Up:**
   - After 30 days of stable operation:
     - Archive backup sheets
     - Update CLAUDE.md if needed
     - Close migration tracking issue

## Appendix: Column Index Reference

**Quick reference for developers:**

```javascript
// NEW invoiceCols structure
CONFIG.invoiceCols = {
  invoiceDate: 0,       // A
  supplier: 1,          // B
  invoiceNo: 2,         // C
  totalAmount: 3,       // D
  totalPaid: 4,         // E (formula)
  balanceDue: 5,        // F (formula)
  status: 6,            // G (formula)
  paidDate: 7,          // H
  daysOutstanding: 8,   // I (formula)
  originDay: 9,         // J
  enteredBy: 10,        // K
  timestamp: 11,        // L
  sysId: 12             // M
}
```

**Formula Templates:**
```javascript
// Total Paid (Column E)
=IF(C{row}="","",IFERROR(SUMIFS(PaymentLog!E:E, PaymentLog!C:C,C{row}, PaymentLog!B:B,B{row}),0))

// Balance Due (Column F)
=IF(D{row}="","",D{row}-E{row})

// Status (Column G)
=IFS(F{row}=0,"Paid",F{row}=D{row},"Unpaid",F{row}<D{row},"Partial")

// Days Outstanding (Column I)
=IF(F{row}=0,0,TODAY()-A{row})
```

---

**Document Version:** 1.0
**Last Updated:** 2025-01-02
**Migration Script:** MigrateInvoiceColumns.gs
