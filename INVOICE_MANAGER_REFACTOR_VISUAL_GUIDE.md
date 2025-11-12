# InvoiceManager Refactoring - Visual Guide

Quick visual reference for the refactoring strategy

---

## 1. Current Module Structure

```
InvoiceManager (770 lines)
├─ processOptimized() [28 lines] ────────────┐
├─ create() [93 lines] ──────────────────────┤
├─ updateOptimized() [68 lines] ────────────┤ Monolithic
├─ setFormulas() [50 lines] ─────────────────┤ (Mixed Concerns)
├─ find() [69 lines] ──────────────────────┤
├─ getUnpaidForSupplier() [57 lines] ──────┤
├─ getAllForSupplier() [138 lines] ────────┤
├─ getStatistics() [98 lines] ─────────────┤
├─ buildUnpaidDropdown() [135 lines] ──────┤
├─ repairAllFormulas() [91 lines] ─────────┤
└─ batchCreate() [145 lines] ──────────────┘

Issues:
❌ No section headers
❌ Constants scattered throughout
❌ DRY violations (formula building repeated)
❌ Mixed concerns (query + UI + error handling in buildUnpaidDropdown)
❌ Inconsistent result objects
❌ Boilerplate lock management repeated
```

---

## 2. Proposed Module Structure

```
InvoiceManager (~800-850 lines)
│
├─ SECTION 1: CONSTANTS
│  └─ CONSTANTS: { FORMULA, STATUS, PAYMENT_TYPE, ... } [30 lines]
│     ✅ Self-documenting, single source of truth
│
├─ SECTION 2: PUBLIC API - CORE OPERATIONS
│  ├─ processOptimized() [~25 lines]
│  ├─ createInvoice() [~35 lines]
│  └─ updateInvoiceIfChanged() [~30 lines]
│     ✅ Orchestration & transaction operations
│
├─ SECTION 3: PUBLIC API - QUERIES & ANALYSIS
│  ├─ findInvoice() [~25 lines]
│  ├─ getUnpaidForSupplier() [~30 lines]
│  ├─ getInvoicesForSupplier() [~40 lines]
│  └─ getInvoiceStatistics() [~50 lines]
│     ✅ Query operations (read-only)
│
├─ SECTION 4: PUBLIC API - BATCH OPERATIONS
│  ├─ batchCreateInvoices() [~80 lines]
│  ├─ repairInvoiceFormulas() [~50 lines]
│  └─ buildDuePaymentDropdown() [~80 lines]
│     ✅ Bulk operations & maintenance
│
├─ SECTION 5: INTERNAL HELPERS - DATA BUILDING
│  ├─ _buildInvoiceFormulas() [~15 lines]
│  ├─ _buildInvoiceRowData() [~20 lines]
│  └─ _buildInvoiceLedgerRow() [~10 lines]
│     ✅ Pure data transformation functions
│
├─ SECTION 6: INTERNAL HELPERS - UTILITIES
│  ├─ applyInvoiceFormulas() [~25 lines]
│  ├─ _withLock() [~25 lines]  ← HOF for lock mgmt
│  ├─ _validateDropdownRequest() [~10 lines]
│  ├─ _insertInvoiceRow() [~15 lines]
│  └─ _insertInvoiceBatch() [~20 lines]
│     ✅ Low-level utilities, lock management
│
├─ SECTION 7: RESULT BUILDERS (Immutable Constructors)
│  ├─ _buildCreationResult() [~10 lines]
│  ├─ _buildUpdateResult() [~10 lines]
│  ├─ _buildDuplicateError() [~8 lines]
│  ├─ _buildLockError() [~8 lines]
│  ├─ _buildValidationError() [~8 lines]
│  └─ _buildGenericError() [~8 lines]
│     ✅ Guaranteed complete, consistent result objects
│
└─ BACKWARD COMPATIBILITY WRAPPERS
   └─ Legacy wrapper functions for migration
      ✅ No breaking changes to external callers
```

---

## 3. Improvement Patterns Applied

### Pattern 1: Named Constants ⭐ Low Risk

```javascript
// BEFORE:
const E = `=IF(C${newRow}="","",IFERROR(SUMIFS(PaymentLog!E:E, ...)`
const F = `=IF(D${newRow}="","",D${newRow}-E${newRow})`
const G = `=IFS(F${newRow}=0,"Paid",F${newRow}=D${newRow},"Unpaid",...)`
const I = `=IF(F${newRow}=0,0,TODAY()-A${newRow})`

if (paymentType !== "Due" || StringUtils.isEmpty(supplier)) {

// AFTER:
CONSTANTS: {
  FORMULA: {
    TOTAL_PAID: `=IF(C{row}="","",IFERROR(...)`,
    BALANCE_DUE: `=IF(D{row}="","",D{row}-E{row})`,
    STATUS: `=IFS(F{row}=0,"Paid",...)`,
    DAYS_OUTSTANDING: `=IF(F{row}=0,0,TODAY()-A{row})`,
  },
  PAYMENT_TYPE: {
    DUE: 'Due',
    REGULAR: 'Regular',
    PARTIAL: 'Partial',
  },
},

if (paymentType !== this.CONSTANTS.PAYMENT_TYPE.DUE || ...) {
```

**Impact**: Self-documenting, single source of truth, -15 lines duplication

---

### Pattern 2: Extract DRY Code ⭐ Low Risk

```javascript
// BEFORE: Repeated in create() AND batchCreate() (2 places)
const E = `=IF(C${newRow}="","",IFERROR(SUMIFS(...)`
const F = `=IF(D${newRow}="","",D${newRow}-E${newRow})`
const G = `=IJS(F${newRow}=0,"Paid",...)`
const I = `=IF(F${newRow}=0,0,TODAY()-A${newRow})`

// AFTER: Single function
_buildInvoiceFormulas: function(rowNum) {
  return {
    totalPaid: this.CONSTANTS.FORMULA.TOTAL_PAID.replace('{row}', rowNum),
    balanceDue: this.CONSTANTS.FORMULA.BALANCE_DUE.replace('{row}', rowNum),
    status: this.CONSTANTS.FORMULA.STATUS.replace('{row}', rowNum),
    daysOutstanding: this.CONSTANTS.FORMULA.DAYS_OUTSTANDING.replace('{row}', rowNum),
  };
}
```

**Impact**: Eliminates DRY violation, -20 lines of duplication, single modification point

---

### Pattern 3: Immutable Result Builders ⭐ Medium Risk

```javascript
// BEFORE: Inconsistent result structures
return { success: true, action: 'created', invoiceId, row: newRow };
return { success: false, error: msg, existingRow: existingInvoice.row };
return null;  // find() returns null on not found
return [];    // getUnpaidForSupplier() returns empty array on error

// AFTER: Consistent structure guarantees
_buildCreationResult: function(invoiceId, row) {
  return {
    success: true,
    action: 'created',
    invoiceId: invoiceId,
    row: row,
    timestamp: new Date(),  // Added for debugging
  };
},

_buildDuplicateError: function(invoiceNo, row) {
  return {
    success: false,
    error: `Invoice ${invoiceNo} already exists at row ${row}`,
    existingRow: row,
    timestamp: new Date(),
  };
},

// Usage:
if (existingInvoice) {
  return this._buildDuplicateError(invoiceNo, existingInvoice.row);
}
return this._buildCreationResult(invoiceId, newRow);
```

**Impact**: No partial state, easier testing, consistent API, safer concurrency

---

### Pattern 4: Lock Management HOF ⭐ Medium Risk

```javascript
// BEFORE: 13 lines of boilerplate repeated in create() AND batchCreate()
const lock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
if (!lock) {
  return { success: false, error: 'Unable to acquire lock for invoice creation' };
}

try {
  // ... 50+ lines of business logic
} catch (error) {
  AuditLogger.logError('InvoiceManager.create', ...);
  return { success: false, error: error.toString() };
} finally {
  LockManager.releaseLock(lock);
}

// AFTER: Single HOF used in both places
_withLock: function(operation, context = {}) {
  const lock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
  if (!lock) {
    return this._buildLockError(context.operationType || 'operation');
  }
  try {
    return operation();  // Call business logic
  } catch (error) {
    return this._buildGenericError(context.operationType, error);
  } finally {
    LockManager.releaseLock(lock);
  }
},

// Usage: Cleaner, business logic only
return this._withLock(() => {
  const existingInvoice = invoice || this.find(supplier, invoiceNo);
  if (existingInvoice) {
    return this._buildDuplicateError(invoiceNo, existingInvoice.row);
  }
  // ... more business logic
  return this._buildCreationResult(invoiceId, newRow);
}, { operationType: 'invoice creation' });
```

**Impact**: -54% boilerplate, consistent error handling, easier testing, guaranteed cleanup

---

### Pattern 5: Information Architecture ⭐ Low Risk

```javascript
// BEFORE: No organization, hard to navigate
const InvoiceManager = {
  processOptimized: ...,
  create: ...,
  updateOptimized: ...,
  setFormulas: ...,
  find: ...,
  getUnpaidForSupplier: ...,
  getAllForSupplier: ...,
  getStatistics: ...,
  buildUnpaidDropdown: ...,
  repairAllFormulas: ...,
  batchCreate: ...,
}

// AFTER: 7 clear sections with headers
const InvoiceManager = {
  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1: CONSTANTS & CONFIG
  // ═══════════════════════════════════════════════════════════════════

  CONSTANTS: { ... },

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2: PUBLIC API - CORE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════

  processOptimized: ...,
  createInvoice: ...,
  updateInvoiceIfChanged: ...,

  // ... more sections with clear headers
}
```

**Impact**: Dramatically improved navigation, clear mental model, matches PaymentManager pattern

---

### Pattern 6: Break Down Complex Functions ⭐ Low Risk

```javascript
// BEFORE: 135-line buildUnpaidDropdown() mixing concerns
buildUnpaidDropdown: function (sheet, row, supplier, paymentType) {
  const targetCell = sheet.getRange(row, CONFIG.cols.prevInvoice + 1);

  // Validation
  if (paymentType !== "Due" || StringUtils.isEmpty(supplier)) {
    try {
      targetCell.clearDataValidations().clearNote()...
    } catch (e) {
      ...
    }
    return false;
  }

  // Query
  try {
    const unpaidInvoices = this.getUnpaidForSupplier(supplier);
    if (unpaidInvoices.length === 0) {
      targetCell.clearDataValidations()...
      return false;
    }

    // UI Building
    const invoiceNumbers = unpaidInvoices.map(inv => inv.invoiceNo);
    const rule = SpreadsheetApp.newDataValidation()...
    targetCell.setDataValidation(rule)...

    // Content Management
    const currentValue = targetCell.getValue();
    const isValidValue = invoiceNumbers.includes(String(currentValue));
    if (!isValidValue || !currentValue) {
      targetCell.clearContent().clearNote();
    } else {
      targetCell.clearNote();
    }
    return true;

  } catch (error) {
    targetCell.clearDataValidations()...
    return false;
  }
},

// AFTER: Broken into small, focused functions
_validateDropdownRequest: function(paymentType, supplier) {
  if (paymentType !== this.CONSTANTS.PAYMENT_TYPE.DUE) {
    return { valid: false };
  }
  if (StringUtils.isEmpty(supplier)) {
    return { valid: false };
  }
  return { valid: true };
},

_buildDropdownUI: function(invoiceNumbers) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(invoiceNumbers, true)
    .setAllowInvalid(true)
    .build();
},

buildDuePaymentDropdown: function(sheet, row, supplier, paymentType) {
  const targetCell = sheet.getRange(row, CONFIG.cols.prevInvoice + 1);

  // Step 1: Validate request
  const validation = this._validateDropdownRequest(paymentType, supplier);
  if (!validation.valid) {
    targetCell.clearDataValidations().clearNote().clearContent().setBackground(null);
    return false;
  }

  try {
    // Step 2: Get unpaid invoices
    const unpaidInvoices = this.getUnpaidForSupplier(supplier);
    if (unpaidInvoices.length === 0) {
      targetCell.clearDataValidations()
        .clearContent()
        .setNote(`No unpaid invoices for ${supplier}`)
        .setBackground(CONFIG.colors.warning);
      return false;
    }

    // Step 3: Build and apply dropdown
    const invoiceNumbers = unpaidInvoices.map(inv => inv.invoiceNo);
    const rule = this._buildDropdownUI(invoiceNumbers);

    // Step 4: Update cell (set validation first, then content)
    targetCell.setDataValidation(rule).setBackground(CONFIG.colors.info);
    const currentValue = targetCell.getValue();
    if (!invoiceNumbers.includes(String(currentValue))) {
      targetCell.clearContent().clearNote();
    }
    return true;

  } catch (error) {
    targetCell.clearDataValidations()
      .clearContent()
      .setNote('Error loading invoices')
      .setBackground(CONFIG.colors.error);
    return false;
  }
},
```

**Impact**: 135 → ~80 lines, each function has single responsibility, pseudocode-like readability

---

### Pattern 7: Semantic Function Naming ⭐ Low Risk

```
Before → After
────────────────────────────────────────────────────────
find()                      → findInvoice()
create()                    → createInvoice()
getAllForSupplier()         → getInvoicesForSupplier()
getStatistics()             → getInvoiceStatistics()
buildUnpaidDropdown()       → buildDuePaymentDropdown()
batchCreate()               → batchCreateInvoices()
updateOptimized()           → updateInvoiceIfChanged()
setFormulas()               → applyInvoiceFormulas()
```

**Impact**: Self-documenting API, reduced cognitive load, better IDE autocomplete

---

## 4. Quantified Impact Summary

### Code Metrics

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total lines | 770 | ~820 | +7% (organized structure) |
| Largest function | 145 lines | 50 lines | -66% |
| Constants scattered | 6+ places | 1 object | ✅ Eliminated |
| DRY violations | 2+ instances | 0 | ✅ Eliminated |
| Result builders | 0 | 6-7 | +600% |
| Module sections | 0 | 7 | ✅ Clear structure |
| Lock boilerplate | 13 lines × 2 | 1 HOF | -54% |

### Quality Improvements

| Aspect | Impact | Evidence |
|--------|--------|----------|
| **Readability** | ⬆️⬆️ Dramatic | Functions 40-50 lines max |
| **Maintainability** | ⬆️⬆️ Dramatic | DRY, constants, single responsibility |
| **Testability** | ⬆️ Moderate | Pure functions, immutable builders |
| **Navigability** | ⬆️⬆️ Dramatic | 7 clear sections with headers |
| **Consistency** | ⬆️⬆️ Dramatic | Result builders guarantee structure |
| **Performance** | ➡️ No change | Not optimization-focused |

---

## 5. Refactoring Timeline Visualization

```
Day 1 (Phase 1: Quick Wins)
├─ Morning
│  └─ Extract Constants + Formula Building
│     ├─ Identify magic numbers/strings
│     ├─ Create CONSTANTS object
│     ├─ Extract _buildInvoiceFormulas()
│     ├─ Extract _buildInvoiceRowData()
│     └─ ✅ Commit 1: "refactor: extract constants & data builders"
│
└─ Afternoon
   └─ Testing & validation
      ├─ Run existing test suite
      ├─ Manual smoke tests
      └─ ✅ Ready for Phase 2

Day 2 (Phase 2: Foundation)
├─ Morning
│  └─ Result Builders
│     ├─ Design builder methods (6-7 functions)
│     ├─ Update all return statements
│     ├─ Add timestamps to result objects
│     └─ ✅ Commit 2: "refactor: introduce result builders"
│
├─ Afternoon: Part 1
│  └─ Lock Management HOF
│     ├─ Extract _withLock()
│     ├─ Convert create() to use _withLock()
│     ├─ Convert batchCreate() to use _withLock()
│     └─ ✅ Commit 3: "refactor: extract lock management HOF"
│
└─ Afternoon: Part 2
   └─ Reorganization
      ├─ Add 7 section headers
      ├─ Reorganize methods into sections
      ├─ Group related functions
      └─ ✅ Commit 4: "refactor: reorganize into 7-section architecture"

Day 3 (Phase 3: Polish)
├─ Morning
│  └─ Break Down Complex Functions
│     ├─ Extract helpers from buildDuePaymentDropdown()
│     ├─ Extract helpers from batchCreateInvoices()
│     ├─ Extract helpers from create()
│     └─ ✅ Commit 5: "refactor: break down complex functions"
│
├─ Midday
│  └─ Semantic Naming
│     ├─ Rename functions for clarity
│     ├─ Update backward compat wrappers
│     └─ ✅ Commit 6: "refactor: improve semantic naming"
│
└─ Afternoon
   └─ Documentation & Final Testing
      ├─ Add module docstring
      ├─ Update function comments
      ├─ Comprehensive test suite run
      ├─ Performance validation
      └─ ✅ Commit 7: "docs: add comprehensive InvoiceManager documentation"
```

---

## 6. Risk Mitigation Strategy

```
Phase 1: CONSTANTS EXTRACTION
├─ Risk Level: 🟢 LOW
├─ Mitigation:
│  ├─ No logic changes, just constant extraction
│  ├─ All strings/numbers have exact same values
│  ├─ Search & replace is systematic
│  └─ Test after each file
│
└─ Rollback: Easy (undo commit)

Phase 2: RESULT BUILDERS
├─ Risk Level: 🟡 MEDIUM
├─ Mitigation:
│  ├─ Builders return identical structure to current code
│  ├─ Add to result object without removing fields
│  ├─ Test each method independently
│  ├─ Run full test suite before commit
│  └─ Check for callers expecting specific fields
│
└─ Rollback: Revert to previous structure in builders

Phase 2: LOCK MANAGEMENT HOF
├─ Risk Level: 🟡 MEDIUM
├─ Mitigation:
│  ├─ Test with concurrent operations
│  ├─ Verify lock is always released (finally block)
│  ├─ Check error cases (lock acquisition failure)
│  ├─ Verify cascade behavior (operation returns result)
│  └─ Manual testing with batch operations
│
└─ Rollback: Replace _withLock calls with original boilerplate

Phase 3: FUNCTION EXTRACTION
├─ Risk Level: 🟢 LOW
├─ Mitigation:
│  ├─ Extract pure functions (no state changes)
│  ├─ Keep public API unchanged
│  ├─ Test extracted functions independently
│  └─ Verify calling code still works
│
└─ Rollback: Inline extracted functions

Phase 3: SEMANTIC NAMING
├─ Risk Level: 🟢 LOW
├─ Mitigation:
│  ├─ Use backward compat wrappers for public API
│  ├─ Only rename internal functions freely
│  ├─ Update all call sites systematically
│  ├─ Grep for old function names to catch all references
│  └─ Test after bulk rename
│
└─ Rollback: Revert to old names
```

---

## 7. Testing Strategy

### Unit Tests
```javascript
// Test constants exist
test('CONSTANTS.FORMULA.TOTAL_PAID exists', () => {
  expect(InvoiceManager.CONSTANTS.FORMULA.TOTAL_PAID).toBeDefined();
});

// Test builders return complete objects
test('_buildCreationResult returns complete object', () => {
  const result = InvoiceManager._buildCreationResult('ID123', 5);
  expect(result).toEqual({
    success: true,
    action: 'created',
    invoiceId: 'ID123',
    row: 5,
    timestamp: expect.any(Date),
  });
});

// Test _withLock handles errors
test('_withLock releases lock on error', () => {
  const mockLock = { release: jest.fn() };
  const operation = () => { throw new Error('test'); };

  const result = InvoiceManager._withLock(operation, { operationType: 'test' });

  expect(mockLock.release).toHaveBeenCalled();
  expect(result.success).toBe(false);
});
```

### Integration Tests
```javascript
// Create invoice (tests full path with cache)
test('createInvoice creates and caches invoice', () => {
  const data = { supplier: 'ABC', invoiceNo: 'INV001', receivedAmt: 100 };
  const result = InvoiceManager.createInvoice(data);

  expect(result.success).toBe(true);
  const cached = InvoiceManager.findInvoice('ABC', 'INV001');
  expect(cached).toBeDefined();
});

// Batch operations (tests volume, error handling)
test('batchCreateInvoices handles mix of valid/invalid', () => {
  const data = [
    { supplier: 'A', invoiceNo: 'INV1', receivedAmt: 100 },  // Valid
    { supplier: 'A', invoiceNo: 'INV1', receivedAmt: 200 },  // Duplicate
    { supplier: 'B', invoiceNo: 'INV2', receivedAmt: 150 },  // Valid
  ];

  const result = InvoiceManager.batchCreateInvoices(data);
  expect(result.created).toBe(2);
  expect(result.failed).toBe(1);
});
```

### Manual Testing
```javascript
// In Google Sheets:
1. Create invoice in daily sheet
   ├─ Verify it appears in cache
   └─ Verify SYS_ID is generated
2. Update invoice amount
   ├─ Verify balance recalculates
   └─ Verify cache invalidates
3. Test Due payment dropdown
   ├─ Verify only unpaid invoices shown
   └─ Verify dropdown selects correctly
4. Batch import 50 invoices
   ├─ Verify all created
   ├─ Verify cache size
   └─ Verify no performance degradation
```

---

## 8. Success Criteria Checklist

```
✅ Functionality
  ☐ All existing tests pass
  ☐ No breaking changes to public API
  ☐ Backward compatibility wrappers work
  ☐ Cache behavior unchanged
  ☐ Master Database mode unaffected

✅ Code Quality
  ☐ Constants extracted (0 magic numbers)
  ☐ DRY violations eliminated
  ☐ All result objects consistent
  ☐ Lock management centralized
  ☐ Functions are small (< 50 lines)
  ☐ Single responsibility per function

✅ Structure
  ☐ 7 clear sections with headers
  ☐ Navigable (ctrl+f for section headers works)
  ☐ Matches PaymentManager pattern
  ☐ Self-documenting organization

✅ Naming
  ☐ All function names semantic
  ☐ No ambiguous abbreviations
  ☐ Consistent naming pattern

✅ Documentation
  ☐ Module docstring comprehensive
  ☐ Section headers clear
  ☐ Method comments accurate
  ☐ Examples provided for complex functions

✅ Performance
  ☐ No performance regression
  ☐ Same operation timing before/after
  ☐ Cache behavior identical
  ☐ Batch operation speed unchanged
```

---

## 9. Comparison to PaymentManager Refactoring

The proposed InvoiceManager refactoring **directly mirrors** PaymentManager's successful approach:

| Aspect | PaymentManager | InvoiceManager |
|--------|---|---|
| **Phase 1: Quick Wins** | Constants + DRY extraction | ✅ Same pattern |
| **Phase 2: Foundation** | Result builders + HOF + Reorganization | ✅ Same pattern |
| **Phase 3: Polish** | Break down + Naming + Docs | ✅ Same pattern |
| **Total Commits** | 7 | ✅ Targeting 7 |
| **Risk Approach** | Low → Medium → Low | ✅ Same strategy |
| **Code Metrics** | -54% boilerplate, -66% max function | ✅ Similar targets |
| **Structure** | 7 sections | ✅ Same structure |

**Key Insight**: PaymentManager proved this approach works. InvoiceManager can benefit from the same systematic refinement.

---

**Version**: 1.0 | **Date**: November 12, 2025
