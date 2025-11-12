# InvoiceManager Refactor - Quick Reference

## At-a-Glance Summary

**Goal**: Apply PaymentManager's proven 7-commit refactoring patterns to InvoiceManager

**Scope**: Code quality, maintainability, and organization (NOT performance optimization)

**Duration**: 2-3 days across 7 commits

**Risk Level**: 🟢 LOW (Phase 1 & 3) / 🟡 MEDIUM (Phase 2)

---

## 7-Commit Roadmap

### 📝 Commit 1: Extract Constants
**Content**: Create `CONSTANTS` object with all magic numbers/strings
**Lines Added**: ~30 (new object)
**Lines Removed**: ~20 (from scattered usage)
**Risk**: 🟢 LOW
**Impact**: Self-documenting code, single source of truth

**Commit Message**:
```
refactor: extract named constants in InvoiceManager

- Create CONSTANTS object for formula templates
- Create CONSTANTS for status and payment type values
- Replace magic strings throughout module
- Add balance threshold constant (0.01)

Benefits: Self-documenting, single modification point
```

---

### 📝 Commit 2: Extract Data Builders
**Content**: Extract formula building & row data construction
**Lines Added**: ~40 (new functions)
**Lines Removed**: ~30 (from duplication in create/batchCreate)
**Risk**: 🟢 LOW
**Impact**: DRY code, shared logic, easier maintenance

**New Functions**:
- `_buildInvoiceFormulas(rowNum)` - Formula string generation
- `_buildInvoiceRowData(invoice)` - Row array construction

**Commit Message**:
```
refactor: extract data building functions in InvoiceManager

- Extract _buildInvoiceFormulas() to prevent formula duplication
- Extract _buildInvoiceRowData() for consistent row structure
- Used by create() and batchCreate() functions
- Eliminates DRY violation across 2+ locations

Benefits: Single source of truth for row structure
```

---

### 📝 Commit 3: Introduce Result Builders
**Content**: Create immutable result object constructors
**Lines Added**: ~60 (new builder functions)
**Lines Modified**: ~80 (update return statements)
**Risk**: 🟡 MEDIUM (changes return types)
**Impact**: Consistent results, safer concurrency, easier testing

**New Functions**:
- `_buildCreationResult(invoiceId, row, action)` ✅ Success
- `_buildUpdateResult(row, action)` ✅ Success
- `_buildDuplicateError(invoiceNo, row)` ❌ Duplicate
- `_buildLockError(operation)` ❌ Lock failed
- `_buildValidationError(invoiceNo, reason)` ❌ Invalid
- `_buildGenericError(operation, error)` ❌ Other error

**Commit Message**:
```
refactor: introduce immutable result builders in InvoiceManager

- Create 6 result builder functions for consistency
- All builders include timestamp for debugging
- Used by all public API methods
- Guarantees complete result objects (no missing fields)

Benefits: Consistent API, no partial state, safer for tests
```

---

### 📝 Commit 4: Extract Lock HOF
**Content**: Create higher-order function for lock management
**Lines Added**: ~25 (new HOF)
**Lines Removed**: ~26 (boilerplate from create/batchCreate)
**Risk**: 🟡 MEDIUM (lock safety critical)
**Impact**: -54% boilerplate, consistent error handling

**New Function**:
- `_withLock(operation, context)` - Wraps operation with lock/unlock

**Usage**:
```javascript
return this._withLock(() => {
  // Business logic only
  return this._buildCreationResult(invoiceId, row);
}, { operationType: 'invoice creation' });
```

**Commit Message**:
```
refactor: extract lock management HOF in InvoiceManager

- Create _withLock() higher-order function
- Centralizes acquire/release/error handling
- Reduces boilerplate by 54% (13 lines → 6)
- Used by create() and batchCreate()

Benefits: Less boilerplate, guaranteed cleanup, consistent errors
```

---

### 📝 Commit 5: Reorganize into 7 Sections
**Content**: Add section headers, reorder functions
**Lines Added**: ~15 (section headers)
**Lines Removed**: 0 (reorganization only)
**Risk**: 🟢 LOW (no logic changes)
**Impact**: Dramatically improved navigability

**New Structure**:
```
SECTION 1: CONSTANTS
SECTION 2: PUBLIC API - CORE OPERATIONS
SECTION 3: PUBLIC API - QUERIES & ANALYSIS
SECTION 4: PUBLIC API - BATCH OPERATIONS
SECTION 5: INTERNAL HELPERS - DATA BUILDING
SECTION 6: INTERNAL HELPERS - UTILITIES
SECTION 7: RESULT BUILDERS
```

**Commit Message**:
```
refactor: reorganize InvoiceManager into 7-section architecture

- Add clear section headers (=== markers)
- Group related functions under sections
- Match PaymentManager organizational pattern
- Sections: Constants, Core API, Queries, Batch, Data Building, Utils, Builders

Benefits: Better navigability, clear mental model
```

---

### 📝 Commit 6: Break Down Complex Functions
**Content**: Extract pure functions from large methods
**Lines Added**: ~40 (new helper functions)
**Lines Removed**: ~60 (broken out from original functions)
**Risk**: 🟢 LOW (pure functions, no state changes)
**Impact**: Smaller functions, pseudocode-like code

**Functions to Refactor**:
- `buildUnpaidDropdown()` (135 → 80 lines)
  - Extract `_validateDropdownRequest()`
  - Extract `_buildDropdownUI()`
  - Extract `_updateDropdownCell()`

- `batchCreateInvoices()` (130+ → 100 lines)
  - Extract `_validateInvoiceDataBatch()`
  - Extract `_insertInvoiceBatch()`

- `create()` (93 → 60 lines)
  - Extract `_insertInvoiceRow()`
  - Extract `_validateNewInvoice()`

**Commit Message**:
```
refactor: break down complex functions in InvoiceManager

- Extract _validateDropdownRequest() from buildDuePaymentDropdown
- Extract _buildDropdownUI() from buildDuePaymentDropdown
- Extract _insertInvoiceRow() from createInvoice
- Extract _validateInvoiceDataBatch() from batchCreateInvoices
- Extract _insertInvoiceBatch() from batchCreateInvoices

Benefits: Smaller functions, clearer logic, easier testing
```

---

### 📝 Commit 7: Improve Semantic Naming
**Content**: Rename functions for clarity and consistency
**Lines Modified**: ~50 (function names and calls)
**Risk**: 🟢 LOW (backward compat wrappers provided)
**Impact**: Self-documenting API

**Naming Changes**:
- `create()` → `createInvoice()` 📌 More explicit
- `find()` → `findInvoice()` 📌 More explicit
- `updateOptimized()` → `updateInvoiceIfChanged()` 📌 Describes behavior
- `getAllForSupplier()` → `getInvoicesForSupplier()` 📌 More direct
- `getStatistics()` → `getInvoiceStatistics()` 📌 Context-specific
- `buildUnpaidDropdown()` → `buildDuePaymentDropdown()` 📌 More specific
- `batchCreate()` → `batchCreateInvoices()` 📌 More explicit
- `setFormulas()` → `applyInvoiceFormulas()` 📌 More action-oriented

**Backward Compatibility** (keep old names):
```javascript
// Deprecated, but still work
function find(supplier, invoiceNo) {
  return InvoiceManager.findInvoice(supplier, invoiceNo);
}
```

**Commit Message**:
```
refactor: improve semantic naming in InvoiceManager

- Rename functions for clarity and consistency:
  - create() → createInvoice()
  - find() → findInvoice()
  - getAllForSupplier() → getInvoicesForSupplier()
  - getStatistics() → getInvoiceStatistics()
  - buildUnpaidDropdown() → buildDuePaymentDropdown()
  - batchCreate() → batchCreateInvoices()
  - updateOptimized() → updateInvoiceIfChanged()
  - setFormulas() → applyInvoiceFormulas()
- Maintain backward compatibility wrappers

Benefits: Self-documenting API, less ambiguity
```

---

### 📝 Commit 8: Documentation
**Content**: Add comprehensive module docstring
**Lines Added**: ~80 (new documentation)
**Risk**: 🟢 LOW (documentation only)
**Impact**: Better onboarding, clearer integration points

**Topics Covered**:
- Module purpose and responsibilities
- Architecture overview (7 sections)
- Performance optimizations
- Usage examples
- Integration points
- Implementation notes

**Commit Message**:
```
docs: add comprehensive documentation to InvoiceManager

- Add detailed module docstring
- Document architecture and 7-section structure
- Add performance optimization notes
- Provide usage examples for each major function
- Document integration points (Cache, Payment, Balance, etc.)
- Add implementation notes and gotchas

Benefits: Better onboarding, clearer maintainability
```

---

## Key Metrics & Targets

### Code Reduction
```
Function Boilerplate:
  Lock management: 13 lines → 6 lines (-54%)
  Formula building: repeated 2× → 1 function (-50%)
  Row data building: repeated 2× → 1 function (-50%)

Function Size:
  Largest function: 145 lines → 50 lines (-66%)
  Average function: ~60 lines → ~35 lines (-42%)

Code Duplication:
  Magic numbers: 6+ places → 0 (-100%)
  Formula strings: 2 places → 1 (-50%)
  Data building: 2 places → 1 (-50%)
```

### Quality Improvements
```
Structure:
  Section headers: 0 → 7 (new)
  Result builders: 0 → 6 (new)
  Helper functions: 3 → 13 (+433%)

Consistency:
  Result objects: Inconsistent → All consistent
  Error handling: Ad-hoc → Centralized builders
  Lock management: Repeated → Single HOF
```

---

## Risk Mitigation Summary

| Phase | Risk | Mitigation |
|-------|------|-----------|
| 1: Constants | LOW | No logic changes, mechanical search/replace |
| 2: Data Builders | LOW | Same functionality, just extracted |
| 3: Result Builders | MEDIUM | Add tests for builder output shape |
| 4: Lock HOF | MEDIUM | Test with concurrent operations |
| 5: Reorganization | LOW | No code changes, just reordering |
| 6: Break Down | LOW | Pure functions, no state changes |
| 7: Naming | LOW | Backward compat wrappers provided |
| 8: Docs | LOW | Documentation only |

---

## Testing Checklist

### Unit Tests
- [ ] Each builder function returns expected shape
- [ ] Constants object values are correct
- [ ] _withLock properly acquires/releases locks
- [ ] _buildInvoiceFormulas generates correct formulas

### Integration Tests
- [ ] createInvoice works end-to-end
- [ ] updateInvoiceIfChanged only writes if changed
- [ ] batchCreateInvoices handles mixed valid/invalid
- [ ] buildDuePaymentDropdown populates correct invoices

### Manual Testing
- [ ] Create invoice in daily sheet
- [ ] Update invoice amount (verify cache update)
- [ ] Test Due payment dropdown
- [ ] Batch import 50+ invoices
- [ ] Verify Master Database mode still works

---

## Command Cheat Sheet

```bash
# View the full refactoring plan
cat INVOICE_MANAGER_REFACTOR_PLAN.md

# View visual guide
cat INVOICE_MANAGER_REFACTOR_VISUAL_GUIDE.md

# View current InvoiceManager structure
grep -n "^  [a-zA-Z_]*:" InvoiceManager.gs

# View PaymentManager's final structure (for reference)
grep -n "^  [a-zA-Z_]*:" PaymentManager.gs

# Search for magic numbers in InvoiceManager
grep -E '[0-9]{2,}|"(Paid|Unpaid|Partial)"' InvoiceManager.gs

# Check for DRY violations (repeated formula patterns)
grep -c "SUMIFS\|Paid.*Unpaid" InvoiceManager.gs
```

---

## Decision Matrix

### Should we do this refactoring?

| Criterion | Yes | No |
|-----------|-----|-----|
| Will it improve code quality? | ✅ YES | - |
| Will it improve maintainability? | ✅ YES | - |
| Will it reduce code duplication? | ✅ YES | - |
| Will it improve readability? | ✅ YES | - |
| Will it break existing functionality? | ❌ NO | - |
| Will it improve performance? | ➡️ NO | (Not the goal) |
| Is there proven precedent? | ✅ YES | (PaymentManager) |
| Is it low risk? | ✅ YES | (Phased approach) |
| Do we have time? | ✅ YES | (2-3 days) |

**Recommendation**: ✅ **PROCEED** - This refactoring is low-risk, high-value, and proven.

---

## Related Documentation

- **Main Plan**: `INVOICE_MANAGER_REFACTOR_PLAN.md` (detailed, comprehensive)
- **Visual Guide**: `INVOICE_MANAGER_REFACTOR_VISUAL_GUIDE.md` (diagrams, before/after)
- **PaymentManager Reference**: `PaymentManager.gs` (completed refactoring example)

---

## Key Contacts & References

**PaymentManager Refactoring Commits**:
- 64c4ad6 - Final polish
- 1df2ce5 - Break down main function
- 18872c3 - Reorganization into 7 sections
- ffa097d - Lock HOF extraction
- 5733f10 - Result builders
- c8029c0 - Named constants
- e228759 - DRY extraction

**Current InvoiceManager Status**:
- Lines: 770
- Functions: 10 public + 10 backward compat wrappers
- Status: Functional but needs organization

---

**Document Version**: 1.0
**Last Updated**: November 12, 2025
**Recommendation**: Ready to implement Phase 1
