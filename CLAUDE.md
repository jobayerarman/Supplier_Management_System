# CLAUDE.md - AI Assistant Context

This file provides context for AI assistants (like Claude) working with the Supplier Management System codebase.

## Project Overview

A Google Apps Script application for managing supplier invoices and payments through Google Sheets. The system tracks invoice creation, payment processing, balance calculations, and maintains comprehensive audit trails with real-time balance updates.

## Architecture

### Modular Design

```
_Config.gs           → Configuration (sheets, columns, business rules)
_Utils.gs            → Utilities (string/date/sheet helpers, ID generation, locks)
_UserResolver.gs     → Reliable user identification with fallback strategy
AuditLogger.gs       → Audit trail operations
ValidationEngine.gs  → Business rule validation
InvoiceManager.gs    → Invoice CRUD + intelligent caching
PaymentManager.gs    → Payment processing + paid date workflow
BalanceCalculator.gs → Balance calculations
UIMenu.gs            → Custom menu for batch operations
Code.gs              → Main entry point (onEdit handler)
```

### Data Flow

#### Individual Transaction (onEdit)
```
User Action (edit cell) 
  → onEdit() event handler
  → Single batch row read (1 API call)
  → Validation
  → Invoice processing (create/update)
  → Payment processing (conditional)
  → Cache synchronization
  → Balance calculation
  → Status update (1 API call)
  → Audit logging
```

#### Batch Operations (UIMenu)
```
User selects menu option (e.g., "Batch Post All Valid Rows")
  → onOpen() creates custom menu
  → batchPostAllRows() or similar function
  → Batch read all rows in range
  → Loop through rows:
    → buildDataObject()
    → validatePostData()
    → InvoiceManager.processOptimized()
    → PaymentManager.processOptimized()
    → setBatchPostStatus()
  → showValidationResults()
```

## Core Concepts

### Payment Types

1. **Unpaid**: New invoice, no payment (`receivedAmt > 0, paymentAmt = 0`)
2. **Regular**: Full immediate payment (`receivedAmt = paymentAmt`)
3. **Partial**: Incomplete payment (`0 < paymentAmt < receivedAmt`)
4. **Due**: Payment on existing invoice (`receivedAmt = 0, paymentAmt > 0`, requires `prevInvoice`)

### Critical Performance System: InvoiceCache

**Purpose**: Eliminate redundant sheet reads during transaction processing

**Strategy**: Write-through cache with indexed lookups
- Primary index: `"SUPPLIER|INVOICE_NO" → row index` (O(1) lookup)
- Supplier index: `"SUPPLIER" → [row indices]` (O(m) supplier queries)
- TTL-based expiration (60 seconds)

**Cache Operations**:
- `getInvoiceData()`: Lazy load with automatic refresh
- `addInvoiceToCache(rowNum, rowData)`: Write-through on invoice creation
- `updateInvoiceInCache(supplier, invoiceNo)`: Sync after payment processing
- `invalidateSupplierCache(supplier)`: Surgical invalidation

**Critical Implementation Detail**: 
Cache reads EVALUATED values from sheet after formula writes to prevent storing formula strings. This ensures numeric data for balance calculations.

### User Resolution System

**Purpose**: Reliable user identification in shared Google Sheets environments where `Session.getEffectiveUser()` may fail

**Fallback Chain**:
1. `Session.getActiveUser()` - Most reliable in bound scripts
2. Sheet-based detection - Reads last user from Settings sheet
3. `Session.getEffectiveUser()` - Last resort (may return developer email)
4. Default fallback - `default@google.com`

**Key Functions**:
- `UserResolver.getCurrentUser()`: Primary function for getting current user
- `UserResolver.setCurrentUserEmail(email)`: Store user in tracking sheet (for trigger contexts)
- `UserResolver.setConfig(overrides)`: Update configuration

**Usage**: Replace direct `Session.getActiveUser()` calls with `UserResolver.getCurrentUser()`

### Batch Operations System

**Purpose**: Streamline end-of-day processing with bulk validation and posting

**Menu Structure** (created by `onOpen()`):
- **Batch Validate All Rows**: Validate all rows without posting
- **Batch Post All Valid Rows**: Validate and post all valid rows
- **Validate Selected Rows**: Validate only selected row range
- **Post Selected Rows**: Post only selected row range
- **Clear All Post Checkboxes**: Reset sheet after batch operations

**Safety Features**:
- Confirmation dialogs before destructive operations
- Daily sheet validation (01-31 only)
- Skip already posted rows
- Skip empty rows (no supplier)
- Error tracking with detailed results dialog
- Row-level error status updates

**Performance Optimization**:
- Single batch read for all rows in range
- In-memory processing before writes
- Surgical cache invalidation per supplier

### Sheet Structure

**Daily Sheets (01-31)**: Transaction entry
- Columns B-N: Supplier, Invoice No, Received Amt, Payment Type, Prev Invoice, Payment Amt, Balance, Notes, Post, Status, Entered By, Timestamp, SYS_ID

**InvoiceDatabase**: Central invoice ledger
- Columns with formulas: Total Paid (SUMIFS), Balance Due, Status, Days Outstanding
- Formula evaluation critical for cache accuracy

**PaymentLog**: Payment transaction history

**AuditLog**: Complete audit trail

**Settings**: User tracking for UserResolver (optional)

## Key Implementation Patterns

### 1. Single Read Pattern
```javascript
// ✅ GOOD: Read once, pass through pipeline
const rowData = sheet.getRange(row, 1, 1, totalCols).getValues()[0];
validatePostData(data);
InvoiceManager.processOptimized(data);
PaymentManager.processOptimized(data, invoiceId);
BalanceCalculator.updateBalanceCell(sheet, row, true, rowData);
```

### 2. Batch Write Pattern
```javascript
// ✅ GOOD: Single API call for multiple cells
const updates = [[keepChecked, status, user, time]];
sheet.getRange(row, startCol, 1, 4).setValues(updates);
```

### 3. Cache-First Lookups
```javascript
// ✅ GOOD: Use cached data
const { data, indexMap } = InvoiceCache.getInvoiceData();
const key = `${supplier}|${invoiceNo}`;
const rowIndex = indexMap.get(key);
```

### 4. User Resolution Pattern
```javascript
// ✅ GOOD: Use UserResolver for reliable user identification
const enteredBy = UserResolver.getCurrentUser();

// ❌ BAD: Direct Session call may fail in shared environments
const enteredBy = Session.getActiveUser().getEmail();
```

### 5. Batch Operation Pattern
```javascript
// ✅ GOOD: Batch read, in-memory processing, targeted writes
const allData = sheet.getRange(startRow, 2, numRows, totalCols).getValues();
for (let i = 0; i < allData.length; i++) {
  const data = buildDataObject(allData[i], startRow + i, sheetName);
  // Process in memory
  processRow(data);
}
```

### 6. Optimized Functions
Functions ending in `Optimized` accept pre-read data:
- `InvoiceManager.processOptimized(data)`
- `PaymentManager.processOptimized(data, invoiceId)`
- `InvoiceManager.updateOptimized(existingInvoice, data)`

## Configuration

All settings centralized in `CONFIG` object:

```javascript
CONFIG.cols.supplier          // Column indices (0-based)
CONFIG.invoiceSheet           // Sheet names
CONFIG.rules.MAX_TRANSACTION_AMOUNT  // Business rules
CONFIG.colors.success         // UI colors
```

Validate config on initialization: `CONFIG.validate()`

## Error Handling

- Try-catch blocks wrap all operations
- Errors logged to AuditLog via `AuditLogger.logError(context, message)`
- User-facing errors: `setBatchPostStatus(sheet, row, errorMsg, "SYSTEM", time, false, colors.error)`
- Cache failures don't block transactions (inconsistency > failure)
- Batch operations: Individual row failures don't stop entire batch

## Concurrency Control

- Document locks: `LockManager.acquireDocumentLock(timeout)` for posting
- Script locks: `LockManager.acquireScriptLock(timeout)` for invoice creation
- Always release in `finally` block
- Batch operations: Lock acquired once for entire batch

## Validation Rules

Enforced in `ValidationEngine.gs`:
1. Supplier and payment type required
2. Invoice numbers: max 50 chars, alphanumeric + hyphens/underscores
3. Amounts: non-negative, under MAX_TRANSACTION_AMOUNT
4. Payment type specific:
   - Regular: `paymentAmt === receivedAmt`
   - Partial: `paymentAmt < receivedAmt`
   - Due: Valid `prevInvoice` with sufficient balance
5. No duplicate invoices (same supplier + invoice number)

## Naming Conventions

- **Modules**: PascalCase objects (`InvoiceManager`, `AuditLogger`, `UserResolver`)
- **Functions**: camelCase (`processOptimized`, `calculateBalance`, `getCurrentUser`)
- **Private methods**: Underscore prefix (`_recordPayment`, `_calculateTransactionImpact`)
- **Constants**: SCREAMING_SNAKE_CASE in CONFIG
- **UI functions**: camelCase with descriptive names (`batchPostAllRows`, `showValidationResults`)

## Common Tasks

### Adding a New Payment Type
1. Update `CONFIG.rules.SUPPORTED_PAYMENT_TYPES`
2. Add validation in `validatePaymentTypeRules(data)`
3. Update `BalanceCalculator._calculateTransactionImpact()`
4. Add case in `Code.gs` payment type handler

### Adding a New Batch Operation
1. Add menu item in `UIMenu.gs` `onOpen()` function
2. Create handler function following naming pattern (`batch*` or `*AllRows`)
3. Use `validateRowsInSheet()` or `postRowsInSheet()` as template
4. Show results with `showValidationResults()`
5. Add confirmation dialog for destructive operations

### Debugging User Identification Issues
1. Check UserResolver fallback chain order
2. Verify Settings sheet exists if using sheet-based detection
3. Test in different contexts (direct execution vs trigger)
4. Use `testUserResolver()` function for unit testing
5. Check `UserResolver.getConfig()` for current settings

### Debugging Balance Issues
1. Check cache freshness: `InvoiceCache.timestamp`
2. Verify formula evaluation: Inspect cached values for formula strings
3. Compare preview vs actual: `BalanceCalculator.validatePreviewAccuracy(data)`
4. Check AuditLog for calculation warnings

### Performance Optimization
1. Minimize `sheet.getRange()` calls (batch reads/writes)
2. Pass `rowData` to functions (avoid re-reads)
3. Use cached lookups: `InvoiceCache.getInvoiceData()`
4. Profile with `Logger.log()` timestamps
5. Use batch operations for bulk processing

### Adding New Validations
1. Add to `validatePostData()` or create new validator
2. Return `{valid: false, error: "message"}` format
3. Errors automatically displayed via `setBatchPostStatus()`

## Testing Approach

### Manual Testing Checklist
- [ ] All payment types post successfully
- [ ] Balances calculate correctly
- [ ] Cache stays synchronized after payments
- [ ] Duplicate invoices blocked
- [ ] Validation errors display properly
- [ ] Audit trail captures all operations
- [ ] Concurrent posts don't create duplicates
- [ ] Batch operations handle errors gracefully
- [ ] User identification works in shared environments
- [ ] Menu appears on spreadsheet open

### Unit Testing
- Run `testUserResolver()` for user identification tests
- Check Logger output for test results

## Gotchas & Known Issues

1. **Formula strings in cache**: Always read evaluated values, not formulas
2. **Cache invalidation timing**: Payment processing must update cache AFTER writing to PaymentLog (so SUMIFS formulas recalculate)
3. **Concurrent edits**: Document lock prevents race conditions, but users may see "Unable to acquire lock" errors during high activity
4. **Date handling**: Daily sheet dates come from cell A3, fallback to current date
5. **Email resolution**: Use `UserResolver.getCurrentUser()` instead of direct Session calls
6. **Batch operation limits**: UI dialog can only show first 10 errors, rest shown in Status column
7. **Trigger context**: `Session.getActiveUser()` may not work in triggers, use UserResolver instead
8. **Settings sheet**: Required for UserResolver sheet-based detection fallback
9. **Menu initialization**: `onOpen()` trigger must be enabled for custom menu to appear

## Dependencies

- Google Apps Script runtime
- SpreadsheetApp API
- LockService (concurrency)
- Utilities (UUID, date formatting)
- Session (timezone, user info - with UserResolver fallback)

## Backward Compatibility

Legacy function wrappers provided for external scripts:
- `processInvoice(data)` → `InvoiceManager.process(data)`
- `processPayment(data)` → `PaymentManager.process(data)`
- `calculateBalance(data)` → `BalanceCalculator.calculate(data)`
- `getCurrentUserEmail()` → `UserResolver.getCurrentUser()`

New code should use module methods directly.

## AI Assistant Guidelines

When working with this codebase:

1. **Preserve performance patterns**: Maintain single-read, batch-write, cache-first approaches
2. **Follow naming conventions**: Module.method() for public, _method() for private
3. **Add comprehensive error handling**: Try-catch with audit logging
4. **Update validation**: Add rules to ValidationEngine.gs for new business logic
5. **Maintain audit trail**: Log all state changes via AuditLogger
6. **Test cache synchronization**: Ensure updates trigger appropriate cache operations
7. **Document complex logic**: Add inline comments for non-obvious implementations
8. **Use CONFIG**: Never hardcode sheet names or column indices
9. **Use UserResolver**: Always use `UserResolver.getCurrentUser()` for user identification
10. **Batch operation safety**: Add confirmation dialogs and validation for destructive operations
11. **Test in multiple contexts**: Direct execution, onEdit trigger, menu operations, installable triggers

## Quick Reference

**Find an invoice**: `InvoiceManager.find(supplier, invoiceNo)`  
**Get supplier balance**: `BalanceCalculator.getSupplierOutstanding(supplier)`  
**Log action**: `AuditLogger.log(action, data, message)`  
**Validate data**: `validatePostData(data)`  
**Clear cache**: `InvoiceCache.clear()`  
**Acquire lock**: `LockManager.acquireDocumentLock(timeout)`  
**Get current user**: `UserResolver.getCurrentUser()`  
**Batch validate**: `batchValidateAllRows()` (from menu)  
**Batch post**: `batchPostAllRows()` (from menu)

## Module Responsibilities

### _Config.gs
- Centralized configuration for sheets, columns, rules, colors
- Configuration validation on initialization
- Helper methods for column letter/index conversion
- Configuration export and summary functions

### _Utils.gs
- StringUtils: Normalization, comparison, sanitization
- DateUtils: Formatting for time, date, datetime
- SheetUtils: Safe sheet access with validation
- IDGenerator: UUID, invoice ID, payment ID generation
- LockManager: Document and script lock management

### _UserResolver.gs
- Reliable user identification with fallback chain
- Session.getActiveUser() → Sheet detection → Session.getEffectiveUser() → Default
- User email persistence for trigger contexts
- Configurable default email and tracking sheet
- Unit test function included

### AuditLogger.gs
- Log actions: `log(action, data, message)`
- Log errors: `logError(context, message)`
- Log warnings: `logWarning(context, message)`
- Log info: `logInfo(context, message)`
- Query audit trail: `getTrailForRecord(sysId)`, `getRecentEntries(limit)`
- Filter by user or action type

### ValidationEngine.gs
- Main validation: `validatePostData(data)`
- Payment type validation: `validatePaymentTypeRules(data)`
- Due payment validation: `validateDuePayment(data)`
- Business logic validation: `validateBusinessLogic(data)`
- Optional supplier/invoice/amount validators

### InvoiceManager.gs
- Process invoice: `processOptimized(data)` - returns invoiceId immediately
- Create invoice: `create(data)` - with write-through cache
- Update invoice: `updateOptimized(existingInvoice, data)` - conditional write
- Find invoice: `find(supplier, invoiceNo)` - cached O(1) lookup
- Get unpaid: `getUnpaidForSupplier(supplier)` - for Due payment dropdowns
- Build dropdown: `buildUnpaidDropdown(sheet, row, supplier, paymentType)`
- Batch create: `batchCreate(invoiceDataArray)` - for bulk imports
- Repair formulas: `repairAllFormulas()` - maintenance function

### PaymentManager.gs
- Process payment: `processOptimized(data, invoiceId)` - with paid date workflow
- Get history: `getHistoryForInvoice(invoiceNo)`, `getHistoryForSupplier(supplier)`
- Get totals: `getTotalForSupplier(supplier)`
- Check duplicate: `isDuplicate(sysId)`
- Private methods: `_recordPayment()`, `_updateInvoicePaidDate()`, `_shouldUpdatePaidDate()`

### BalanceCalculator.gs
- Calculate balance: `calculate(data)` - actual balance after transaction
- Calculate preview: `calculatePreview(...)` - projected balance before post
- Update balance cell: `updateBalanceCell(sheet, row, afterPost, rowData)`
- Get supplier outstanding: `getSupplierOutstanding(supplier)` - O(m) cached
- Get invoice outstanding: `getInvoiceOutstanding(invoiceNo, supplier)`
- Get summary: `getSupplierSummary(supplier)`
- Private methods: `_calculateTransactionImpact()` - core calculation logic

### UIMenu.gs
- Menu creation: `onOpen()` - creates custom menu on spreadsheet open
- Batch validate all: `batchValidateAllRows()` - validates without posting
- Batch post all: `batchPostAllRows()` - validates and posts all valid rows
- Batch validate selected: `batchValidateSelectedRows()` - selection only
- Batch post selected: `batchPostSelectedRows()` - selection only
- Clear checkboxes: `clearAllPostCheckboxes()` - reset sheet
- Helper functions: `validateRowsInSheet()`, `postRowsInSheet()`, `buildDataObject()`, `showValidationResults()`

### Code.gs
- Event handler: `onEdit(e)` - main entry point for cell edits
- Process posted row: `processPostedRowWithLock()` - transaction workflow
- Auto-populate fields: `autoPopulatePaymentFields()`, `autoPopulateDuePaymentAmount()`
- Clear fields: `clearPaymentFieldsForTypeChange()` - selective clearing

---

**Last Updated**: Based on complete codebase analysis 28 October 2025, 17:48
**Maintained By**: Development team  
**Questions**: Check AuditLog sheet or code comments for implementation details
