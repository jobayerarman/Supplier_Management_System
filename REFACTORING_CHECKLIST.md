# PaymentManager.gs Refactoring Checklist

## Pre-Refactoring (DO THIS FIRST!)

### ☐ Step 1: Run Baseline Tests

```javascript
// In Google Apps Script Editor
runAllPaymentManagerTests()
```

**Expected Result**:
```
Passed: 14
Failed: 0
```

**If any tests fail**: Fix failures before refactoring

---

### ☐ Step 2: Document Performance Baseline

```javascript
documentPerformanceBaseline()
```

**Save this output** - You'll compare after refactoring

**Expected Baselines** (for 1000 payments):
- Cache Build: 200-500ms
- 1000 Queries: 10-30ms (0.01-0.03ms avg)
- 1000 Dupe Checks: 5-15ms (<0.02ms avg)
- Statistics: 10-50ms
- 100 Write-Through: 20-100ms

---

### ☐ Step 3: Backup Current Working Code

```bash
# Create backup branch
git checkout -b backup-before-refactor-paymentmanager
git add PaymentManager.gs
git commit -m "Backup: PaymentManager.gs before complexity refactoring"
git push -u origin backup-before-refactor-paymentmanager

# Return to work branch
git checkout claude/understand-payment-manager-processoptim-011CUqP6PQyYGjuHVC62Sijq
```

---

## Refactoring Priority Order

Tackle refactorings in this order (low risk → high risk):

### 🟢 Phase 1: Quick Wins (Low Risk)

**Priority 1.1**: Extract Index Building Helper
- **Target**: Lines 68-110, 119-174
- **Expected Savings**: 40 lines of duplication
- **Risk**: Low (pure function)
- **Time**: 15 minutes

```javascript
// Add to PaymentCache object:
_addToIndex: function(index, key, value) {
  if (!index.has(key)) {
    index.set(key, []);
  }
  index.get(key).push(value);
}

// Replace 8 blocks of duplicated code with:
this._addToIndex(this.invoiceIndex, invoiceNo, i);
```

**Test After**: `testPaymentCache_IndexBuilding()`, `testPaymentCache_WriteThrough()`

---

**Priority 1.2**: Extract Payment Object Mapper
- **Target**: Lines 668-678, 713-724
- **Expected Savings**: 20 lines
- **Risk**: Low (pure transformation)
- **Time**: 15 minutes

```javascript
// Add to PaymentManager:
_buildPaymentObject: function(rowData, col, includeField) {
  const obj = {
    date: rowData[col.date],
    amount: rowData[col.amount],
    type: rowData[col.paymentType],
    // ... common fields
  };

  if (includeField === 'supplier') {
    obj.supplier = rowData[col.supplier];
  } else if (includeField === 'invoiceNo') {
    obj.invoiceNo = rowData[col.invoiceNo];
  }

  return obj;
}
```

**Test After**: `testPaymentManager_GetHistoryForInvoice()`, `testPaymentManager_GetHistoryForSupplier()`

---

**Priority 1.3**: Replace Magic Numbers
- **Target**: Throughout file
- **Expected Savings**: Better readability
- **Risk**: Very low
- **Time**: 10 minutes

```javascript
// Add constants at top:
const HEADER_ROW_COUNT = 1;
const HEADER_ROW_INDEX = 0;
const FIRST_DATA_ROW_INDEX = 1;
const BALANCE_TOLERANCE = 0.01;

// Replace:
if (lastRow < 2) → if (lastRow <= HEADER_ROW_COUNT)
for (let i = 1; ...) → for (let i = FIRST_DATA_ROW_INDEX; ...)
Math.abs(balanceDue) < 0.01 → Math.abs(balanceDue) < BALANCE_TOLERANCE
```

**Test After**: All tests (no behavior change)

---

### 🟡 Phase 2: Medium Refactors (Medium Risk)

**Priority 2.1**: Extract Query Template Function
- **Target**: Lines 649-685, 695-731, 741-769
- **Expected Savings**: 105 lines
- **Risk**: Medium (changes control flow)
- **Time**: 30 minutes

```javascript
_queryPayments: function(key, indexName, transformer, defaultValue) {
  if (StringUtils.isEmpty(key)) return defaultValue;

  try {
    const { data, [indexName]: index } = PaymentCache.getPaymentData();
    const normalized = StringUtils.normalize(key);
    const indices = index.get(normalized) || [];

    if (indices.length === 0) return defaultValue;

    const col = CONFIG.paymentCols;
    return transformer(data, indices, col);
  } catch (error) {
    AuditLogger.logError('PaymentManager._queryPayments', error.toString());
    return defaultValue;
  }
}

// Usage:
getHistoryForInvoice: function(invoiceNo) {
  return this._queryPayments(
    invoiceNo,
    'invoiceIndex',
    (data, indices, col) => indices.map(i => this._buildPaymentObject(data[i], col, 'supplier')),
    []
  );
}
```

**Test After**: `testPaymentManager_GetHistoryForInvoice()`, `testPaymentManager_GetHistoryForSupplier()`, `testPaymentManager_GetTotalForSupplier()`, `testIntegration_CachePerformance()`

---

**Priority 2.2**: Split _updateInvoicePaidDate
- **Target**: Lines 457-563 (107 lines → 4 functions of <30 lines each)
- **Expected Savings**: Reduce complexity from 9 to 3-4
- **Risk**: Medium (changes control flow)
- **Time**: 45 minutes

**Extract these functions:**

```javascript
_findInvoiceOrFail: function(invoiceNo, supplier) {
  const invoice = cachedInvoice || InvoiceManager.find(supplier, invoiceNo);
  if (!invoice) {
    throw new Error(`Invoice ${invoiceNo} not found for supplier ${supplier}`);
  }
  return invoice;
}

_calculateBalanceInfo: function(invoice) {
  const col = CONFIG.invoiceCols;
  return {
    totalAmount: Number(invoice.data[col.totalAmount]) || 0,
    totalPaid: Number(invoice.data[col.totalPaid]) || 0,
    balanceDue: Number(invoice.data[col.balanceDue]) || 0,
    fullyPaid: Math.abs(Number(invoice.data[col.balanceDue])) < BALANCE_TOLERANCE
  };
}

_isFullyPaid: function(balanceInfo) {
  return balanceInfo.fullyPaid;
}

_isPaidDateAlreadySet: function(invoice) {
  const col = CONFIG.invoiceCols;
  return !!invoice.data[col.paidDate];
}

_writePaidDateToSheet: function(invoice, paidDate) {
  const lock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
  if (!lock) {
    throw new Error('Unable to acquire lock for paid date update');
  }

  try {
    const invoiceSh = MasterDatabaseUtils.getTargetSheet('invoice');
    const col = CONFIG.invoiceCols;
    invoiceSh.getRange(invoice.row, col.paidDate + 1).setValue(paidDate);
  } finally {
    LockManager.releaseLock(lock);
  }
}

// Refactored main function:
_updateInvoicePaidDate: function(invoiceNo, supplier, paidDate, currentPaymentAmount, context = {}, cachedInvoice = null) {
  try {
    const invoice = this._findInvoiceOrFail(invoiceNo, supplier, cachedInvoice);
    const balanceInfo = this._calculateBalanceInfo(invoice);

    if (!this._isFullyPaid(balanceInfo)) {
      return this._buildPartialPaymentResult(balanceInfo, context);
    }

    if (this._isPaidDateAlreadySet(invoice)) {
      return this._buildAlreadyPaidResult(invoice, context);
    }

    this._writePaidDateToSheet(invoice, paidDate);
    CacheManager.updateInvoiceInCache(supplier, invoiceNo);

    return this._buildSuccessResult(balanceInfo, paidDate, context);
  } catch (error) {
    return this._buildErrorResult(error, context);
  }
}
```

**Note**: This also requires extracting result builders (see Priority 2.3)

**Test After**: Manual testing with actual sheets (no unit tests for sheet operations)

---

**Priority 2.3**: Extract Result Builders
- **Target**: Lines 458-466, 474-476, 495-505, 508-518, 536-538
- **Expected Savings**: Immutable results, safer code
- **Risk**: Medium (changes return patterns)
- **Time**: 30 minutes

```javascript
_buildPartialPaymentResult: function(balanceInfo, context) {
  AuditLogger.log('INVOICE_PARTIAL_PAYMENT', context.transactionData,
    `Invoice ${invoiceNo} partially paid | Balance: ${balanceInfo.balanceDue}`);

  return {
    attempted: true,
    success: false,
    fullyPaid: false,
    paidDateUpdated: false,
    reason: 'partial_payment',
    message: `Invoice partially paid | Balance: ${balanceInfo.balanceDue}`,
    balanceInfo: balanceInfo
  };
}

_buildAlreadyPaidResult: function(invoice, context) {
  // Similar pattern
}

_buildSuccessResult: function(balanceInfo, paidDate, context) {
  // Similar pattern
}

_buildErrorResult: function(error, context) {
  // Similar pattern
}
```

**Test After**: Manual testing with actual sheets

---

### 🔴 Phase 3: Structural Changes (Higher Risk)

**Priority 3.1**: Extract Lock Management Wrapper
- **Target**: Lines 367-423, 522-543
- **Expected Savings**: Standardized locking pattern
- **Risk**: Medium-High (changes error handling)
- **Time**: 30 minutes

```javascript
_withLock: function(lockType, operation, context) {
  const lock = lockType === 'script'
    ? LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS)
    : LockManager.acquireDocumentLock(CONFIG.rules.LOCK_TIMEOUT_MS);

  if (!lock) {
    throw new Error(`Unable to acquire ${lockType} lock for ${context}`);
  }

  try {
    return operation();
  } finally {
    LockManager.releaseLock(lock);
  }
}

// Usage in _recordPayment:
return this._withLock('script', () => {
  // All sheet write logic here
}, 'payment recording');
```

**Test After**: Manual testing with actual sheets

---

**Priority 3.2**: Extract Cache Loading Logic
- **Target**: Lines 192-236 in PaymentCache.getPaymentData
- **Expected Savings**: Separation of concerns
- **Risk**: Medium (performance sensitive)
- **Time**: 20 minutes

```javascript
_loadDataFromSheet: function() {
  const paymentSh = MasterDatabaseUtils.getSourceSheet('payment');
  const lastRow = paymentSh.getLastRow();

  if (lastRow <= HEADER_ROW_COUNT) {
    return this._createEmptyDataset();
  }

  return paymentSh.getRange(1, 1, lastRow, CONFIG.totalColumns.payment).getValues();
}

_createEmptyDataset: function() {
  return [[]]; // Header placeholder
}

getPaymentData: function() {
  const cached = this.get();
  if (cached) return cached;

  try {
    const data = this._loadDataFromSheet();
    this.set(data);
    return this._wrapResult();
  } catch (error) {
    AuditLogger.logError('PaymentCache.getPaymentData', error.toString());
    return this._createEmptyResult();
  }
}
```

**Test After**: `testPaymentCache_IndexBuilding()`, `testIntegration_CachePerformance()`

---

## Testing Protocol

### After EACH Refactoring

1. **Save file** (Ctrl+S / Cmd+S)

2. **Run relevant unit tests**
   ```javascript
   // Run test related to changed code
   testPaymentCache_IndexBuilding()
   // or
   testPaymentManager_GetHistoryForInvoice()
   ```

3. **Verify test passes** ✅
   - If PASS: Continue to next refactoring
   - If FAIL: Debug and fix before proceeding

4. **Commit change**
   ```bash
   git add PaymentManager.gs
   git commit -m "refactor: extract _addToIndex helper (saves 40 lines)"
   ```

---

### After EACH Phase

1. **Run all tests**
   ```javascript
   runAllPaymentManagerTests()
   ```

2. **Verify all 14 tests pass** ✅

3. **Document performance**
   ```javascript
   documentPerformanceBaseline()
   ```

4. **Compare to baseline**
   - All metrics within ±10%? ✅ Continue
   - Any metric >25% slower? ⚠️ Investigate and fix

5. **Commit phase**
   ```bash
   git add PaymentManager.gs
   git commit -m "refactor: Phase 1 complete - Quick wins (reduced 60 lines)"
   git push
   ```

---

## Post-Refactoring Validation

### ☐ Step 1: Run Complete Test Suite

```javascript
runAllPaymentManagerTests()
```

**Expected**: All 14 tests pass ✅

---

### ☐ Step 2: Performance Validation

```javascript
documentPerformanceBaseline()
```

**Compare to original baseline:**
- Cache Build: Should be same or faster
- Query Performance: Should be same or faster
- All metrics within ±10%

---

### ☐ Step 3: Manual Integration Tests

**Test actual spreadsheet operations:**

1. **Post Regular Payment**
   - Go to daily sheet (e.g., "01")
   - Enter: Supplier, Invoice, Amount
   - Set Payment Type = Regular
   - Check "Post" checkbox
   - ✅ Verify: PaymentLog entry created
   - ✅ Verify: Invoice marked as paid

2. **Post Due Payment**
   - Create unpaid invoice first
   - Post Due payment to that invoice
   - ✅ Verify: PaymentLog entry created
   - ✅ Verify: Original invoice paid date set

3. **Post Partial Payment**
   - Enter partial payment (less than total)
   - ✅ Verify: PaymentLog entry created
   - ✅ Verify: Paid date NOT set

4. **Test Duplicate Detection**
   - Try to post same transaction twice
   - ✅ Verify: Second post rejected

---

### ☐ Step 4: Run Performance Benchmarks

```javascript
runAllBenchmarks()
```

From `PerformanceBenchmarks.gs` - verifies:
- Cache initialization
- Query performance at scale
- Duplicate detection speed
- Dashboard simulation

**Expected**: All benchmarks pass with similar or better performance

---

### ☐ Step 5: Test Master Database Mode (If Applicable)

If system uses Master DB mode:

1. **Verify configuration**
   ```javascript
   showMasterDatabaseConfig()
   ```

2. **Test writes**
   ```javascript
   testMasterDatabaseWrites()
   ```

3. **Test caching**
   ```javascript
   testMasterDatabaseCaching()
   ```

**All should work identically to before refactoring**

---

## Success Criteria Checklist

### ☐ All Tests Pass
- [ ] 14 unit tests pass ✅
- [ ] Performance benchmarks pass ✅
- [ ] Manual integration tests pass ✅
- [ ] Master DB tests pass (if applicable) ✅

### ☐ Performance Maintained or Improved
- [ ] Cache build time ≤ baseline
- [ ] Query performance ≤ baseline
- [ ] No new performance regressions

### ☐ Code Quality Improved
- [ ] Longest function ≤ 50 lines (was 107)
- [ ] Max complexity ≤ 6 (was 9)
- [ ] Code duplication reduced by 100+ lines
- [ ] All magic numbers replaced with constants

### ☐ Functionality Unchanged
- [ ] All payment types work (Regular, Due, Partial, Unpaid)
- [ ] Duplicate detection works
- [ ] Paid date workflow works
- [ ] Query functions return same results
- [ ] Cache behavior identical

### ☐ Documentation Updated
- [ ] CLAUDE.md updated with new helper functions
- [ ] Code comments reflect new structure
- [ ] JSDoc added for new functions

---

## Rollback Plan

If tests fail or performance degrades:

```bash
# Rollback to backup
git checkout backup-before-refactor-paymentmanager PaymentManager.gs

# Or reset to last good commit
git log --oneline  # Find last good commit
git reset --hard <commit-hash>
```

---

## Tracking Improvements

### Before Refactoring
- **Lines of Code**: ~840
- **Longest Function**: 107 lines (_updateInvoicePaidDate)
- **Max Complexity**: 9
- **Code Duplication**: ~150 lines
- **Functions >50 lines**: 3

### After Refactoring (Target)
- **Lines of Code**: ~700-750 (net reduction after adding helpers)
- **Longest Function**: <50 lines
- **Max Complexity**: <6
- **Code Duplication**: <30 lines
- **Functions >50 lines**: 0

---

## Questions During Refactoring?

**Test fails after change?**
1. Check which test failed (name in FAILURES section)
2. Review code related to that test
3. Determine if behavior changed unintentionally
4. Fix code OR update test if intentional change

**Performance degraded?**
1. Check which metric slowed down
2. Review what changed in that code path
3. Look for added sheet reads or inefficient loops
4. Optimize or rollback change

**Not sure if change is safe?**
1. Make change in separate branch
2. Run tests
3. If tests pass, merge
4. If tests fail, investigate before merging

---

## Final Commit

After all refactoring complete and validated:

```bash
git add PaymentManager.gs PaymentManagerTests.gs TESTING_README.md
git commit -m "refactor(PaymentManager): reduce complexity from 9 to <6

- Extract helper functions (_addToIndex, _buildPaymentObject, _queryPayments)
- Split _updateInvoicePaidDate into 4 functions (<30 lines each)
- Replace magic numbers with named constants
- Extract result builders for immutable returns
- Reduce code duplication by 100+ lines

✅ All 14 unit tests pass
✅ Performance maintained (within 5% of baseline)
✅ Manual integration tests pass
✅ Longest function reduced from 107 to <50 lines
✅ Max complexity reduced from 9 to <6"

git push -u origin claude/understand-payment-manager-processoptim-011CUqP6PQyYGjuHVC62Sijq
```

---

## Remember

**The goal**: Reduce complexity while maintaining 100% functionality

**The strategy**: Small, incremental changes with tests after each

**The safety net**: Comprehensive test suite locks in behavior

**If in doubt**: Test more, commit smaller changes, ask questions
