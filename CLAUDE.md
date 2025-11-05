# CLAUDE.md - AI Assistant Context

This file provides context for AI assistants (like Claude) working with the Supplier Management System codebase.

## Project Overview

A Google Apps Script application for managing supplier invoices and payments through Google Sheets. The system tracks invoice creation, payment processing, balance calculations, and maintains comprehensive audit trails with real-time balance updates.

## Architecture

### Modular Design

```
_Config.gs              → Configuration (sheets, columns, business rules, Master DB config)
_Utils.gs               → Utilities (string/date/sheet helpers, ID generation, locks, Master DB utils)
_UserResolver.gs        → Reliable user identification with fallback strategy
AuditLogger.gs          → Audit trail operations (Master DB aware)
ValidationEngine.gs     → Business rule validation
CacheManager.gs         → Centralized invoice data caching with write-through support (Master DB aware)
InvoiceManager.gs       → Invoice CRUD operations (Master DB aware)
PaymentManager.gs       → Payment processing + PaymentCache (quad-index) + paid date workflow (Master DB aware)
BalanceCalculator.gs    → Balance calculations
UIMenu.gs               → Custom menu for batch operations
Code.gs                 → Main entry point (onEdit handler)
PerformanceBenchmarks.gs → Benchmark suite for cache optimizations
MasterDatabaseTests.gs  → Master Database connection and write tests
```

### Master Database Architecture (NEW)

The system supports two operational modes for maximum flexibility:

**1. Local Mode (Default)**
- Each monthly file contains its own InvoiceDatabase, PaymentLog, AuditLog, and SupplierDatabase
- All reads and writes happen within the monthly file
- Traditional setup - data isolated by month
- No additional configuration required

**2. Master Database Mode (Centralized)**
- One central file (00_SUPPLIER_ACCOUNTS_DATABASE_MASTER) contains all databases
- Monthly files use IMPORTRANGE to display data from Master
- Apps Script writes directly to Master Database
- Cross-month queries and consolidated reporting enabled
- Single source of truth for all invoice and payment data

**Configuration (_Config.gs):**
```javascript
CONFIG.masterDatabase = {
  connectionMode: 'local',  // or 'master' to enable Master DB mode
  id: 'YOUR_MASTER_DB_SPREADSHEET_ID',  // From Master DB URL
  url: 'https://docs.google.com/spreadsheets/d/YOUR_ID/edit',
  sheets: {
    invoice: 'InvoiceDatabase',
    payment: 'PaymentLog',
    audit: 'AuditLog',
    supplier: 'SupplierDatabase'
  },
  importRanges: {
    invoice: 'A:M',   // All invoice columns
    payment: 'A:L',   // All payment columns
    audit: 'A:G',     // All audit columns
    supplier: 'A:D'   // All supplier columns
  }
}
```

**Key Components:**
- `MasterDatabaseUtils` - Helper utilities for Master DB access
- `MasterDatabaseUtils.getSourceSheet(sheetType)` - **For reads**: Always returns local sheet (IMPORTRANGE in master mode)
- `MasterDatabaseUtils.getTargetSheet(sheetType)` - **For writes**: Returns Master (master mode) or local (local mode)
- `MasterDatabaseUtils.buildImportFormula(sheetType)` - Generates IMPORTRANGE formulas
- `MasterDatabaseUtils.testConnection()` - Validates Master DB setup
- **Read/Write Pattern**: Reads from local sheets (fast), writes to Master DB (master mode only)
- Automatic routing - all operations go to correct location based on connectionMode
- Backward compatible - works in both modes without code changes

**Setup Process:**
1. Create Master Database file (00_SUPPLIER_ACCOUNTS_DATABASE_MASTER)
2. Copy sheet structures: InvoiceDatabase, PaymentLog, AuditLog, SupplierDatabase
3. Update CONFIG.masterDatabase in monthly files:
   - Set `connectionMode: 'master'`
   - Set `id` to Master Database spreadsheet ID
   - Set `url` to Master Database URL
4. Run `testMasterDatabaseConnection()` to verify setup
5. Replace local sheets in monthly files with IMPORTRANGE formulas
6. Grant IMPORTRANGE permissions when prompted
7. **CRITICAL**: Set up installable Edit trigger:
   - Open Script Editor in monthly file
   - Run `setupInstallableEditTrigger()` function
   - Authorize when prompted
   - This is required because simple triggers cannot access other spreadsheets
   - Only needs to be done once per monthly file

**Testing Functions (MasterDatabaseTests.gs):**
- `testMasterDatabaseConnection()` - Test connectivity and configuration
- `testMasterDatabaseWrites()` - Test write operations (creates test data)
- `generateImportRangeFormulas()` - Generate formulas for monthly file setup
- `showMasterDatabaseConfig()` - Display current configuration
- `testMasterDatabaseCaching()` - Verify cache functionality with Master DB

**Performance:**
- **Read performance**: Identical to local mode - reads from local IMPORTRANGE sheets
  - Cache hit: ~1-5ms
  - Cache miss: ~200-400ms (local sheet read)
  - No cross-file latency on reads
- **Write performance**: Additional latency in master mode due to cross-file writes
  - Local mode: ~20-50ms
  - Master mode: ~70-150ms (+50-100ms cross-file latency)
- Cache works identically in both modes
- IMPORTRANGE updates automatically when Master DB changes

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
    → PaymentManager.processPayment()
    → setBatchPostStatus()
  → showValidationResults()
```

## Core Concepts

### Payment Types

1. **Unpaid**: New invoice, no payment (`receivedAmt > 0, paymentAmt = 0`)
2. **Regular**: Full immediate payment (`receivedAmt = paymentAmt`)
3. **Partial**: Incomplete payment (`0 < paymentAmt < receivedAmt`)
4. **Due**: Payment on existing invoice (`receivedAmt = 0, paymentAmt > 0`, requires `prevInvoice`)

### Critical Performance System: CacheManager

**Purpose**: Eliminate redundant sheet reads during invoice transaction processing

**Strategy**: Write-through cache with partitioning, indexed lookups, and incremental updates
- **Cache Partitioning**: Active (unpaid/partial) vs Inactive (fully paid) invoices
- Primary index: `"SUPPLIER|INVOICE_NO" → row index` (O(1) lookup)
- Supplier index: `"SUPPLIER" → [row indices]` (O(m) supplier queries)
- Invoice index: `"INVOICE_NO" → row index` (O(1) invoice queries)
- TTL-based expiration (60 seconds)
- **NEW**: Incremental updates (1-5ms vs 500ms full reload)

**Cache Partitioning** (Performance Optimization):
- **Active Partition**: Unpaid and partially paid invoices (balance due > $0.01)
  - Hot data - frequently accessed for payment processing
  - Smaller cache size for faster iteration
  - Typical size: 10-30% of total invoices
- **Inactive Partition**: Fully paid invoices (balance due ≤ $0.01)
  - Cold data - rarely accessed
  - Separated to reduce active cache overhead
  - Typical size: 70-90% of total invoices
- **Automatic Transition**: Invoices move from active → inactive when fully paid
- **Performance Benefit**: 70-90% reduction in active cache size

**Cache Operations**:
- `getInvoiceData()`: Lazy load with automatic refresh
- `addInvoiceToCache(rowNum, rowData)`: Write-through on invoice creation
- `updateInvoiceInCache(supplier, invoiceNo)`: Sync after payment processing
- **`updateSingleInvoice(supplier, invoiceNo)`**: Incremental single-row update with partition transition support
- `invalidate(operation, supplier, invoiceNo)`: Smart invalidation with incremental update support
- `invalidateSupplierCache(supplier)`: Surgical supplier-specific invalidation (both partitions)
- **`getPartitionStats()`**: Monitor partition distribution and efficiency

**Incremental Update Feature** (Performance Optimization):
- Updates single invoice row without clearing entire cache
- Triggered automatically by `invalidate('updateAmount', supplier, invoiceNo)`
- 250x faster than full cache reload (1ms vs 500ms)
- Includes consistency validation and automatic fallback to full reload on errors
- Statistics tracking: incremental updates, full reloads, average update time, cache hit rate, partition transitions

**Partition Transition Logic**:
- Active → Inactive: When invoice becomes fully paid (balance ≤ $0.01)
- Inactive → Active: When paid invoice is reopened (rare edge case)
- Transitions tracked in statistics for monitoring

**Conditional Cache Strategy** (Master Database Support):
- **Local Mode**: Cache reads from local InvoiceDatabase sheet
  - Performance: 200-400ms per cache load
  - Always fresh (same file, immediate updates)
  - No timing issues
- **Master Mode**: Cache reads from Master Database directly
  - Performance: 300-600ms per cache load (+100-200ms cross-file latency)
  - Always fresh (bypasses IMPORTRANGE timing issues)
  - Eliminates index mismatch warnings
- **Tradeoff**: Slight latency in Master mode for guaranteed data freshness
- Cache loads happen once per TTL (60 seconds), not per transaction

**Critical Implementation Details**:
- Cache reads EVALUATED values from sheet after formula writes to prevent storing formula strings
- **Conditional reads**: Master mode uses `getTargetSheet()` (Master DB), Local mode uses `getSourceSheet()` (local)
- Incremental updates handle edge cases (supplier changes, missing invoices, corruption detection, partition transitions)
- Automatic fallback to full cache clear if incremental update fails
- Performance statistics logged every 100 updates for monitoring
- Partitioned supplier indices also cleared on surgical invalidation

**Performance**:
- Query time: O(1) constant regardless of invoice count
- Memory overhead: ~450KB for 1,000 invoices (negligible)
- Active cache reduction: 70-90% smaller (partition benefit)
- Partition transition: <2ms (move invoice between partitions)
- Cache load: 200-400ms (local), 300-600ms (master)

---

### Critical Performance System: PaymentCache

**Purpose**: Eliminate redundant PaymentLog sheet reads for query operations

**Strategy**: Write-through cache with quad-index structure for O(1) lookups

**Index Structure**:
1. **Invoice index**: `"INVOICE_NO" → [row indices]` - All payments for an invoice
2. **Supplier index**: `"SUPPLIER" → [row indices]` - All payments for a supplier
3. **Combined index**: `"SUPPLIER|INVOICE_NO" → [row indices]` - Combined queries
4. **Payment ID index**: `"PAYMENT_ID" → row index` - Duplicate detection

**Cache Operations**:
- `getPaymentData()`: Lazy load with automatic refresh
- `addPaymentToCache(rowNum, rowData)`: Write-through when payment recorded
- `clear()`: Invalidate entire cache

**Performance Optimizations**:
- **Lock scope reduction**: Locks held only during sheet writes (20-50ms vs 100-200ms)
- **Eliminated double cache updates**: Single update per payment transaction
- **O(1) queries**: All payment queries are constant time regardless of database size
- **O(1) duplicate detection**: Hash lookup instead of linear scan

**Performance Metrics**:
- Initial cache load: 200-400ms (one-time per TTL expiration)
- Cache hit: <1ms (instant from memory)
- Query operations: 1-3ms (O(1) index lookups)
- Duplicate detection: <1ms (O(1) hash lookup)
- Memory overhead: ~450KB for 1,000 payments (negligible)

**Scalability**:
- Current: Constant O(1) performance regardless of PaymentLog size
- Tested: Maintains performance up to 50,000+ payments
- Before optimization: O(n) degradation - unusable at 10,000 payments
- After optimization: O(1) constant - fast at 50,000+ payments

**Usage in Code**:
```javascript
// Query operations use cached data automatically
const history = PaymentManager.getHistoryForInvoice(invoiceNo);
const total = PaymentManager.getTotalForSupplier(supplier);
const isDupe = PaymentManager.isDuplicate(sysId);
```

**TTL Behavior**:
- Cache valid for 60 seconds
- Automatic refresh on first access after expiration
- Balances freshness vs performance

### User Resolution System (v2.0)

**Purpose**: Context-aware user identification that gets the **actual logged-in user** in both trigger and menu contexts

**Architecture**: Eliminates unreliable sheet-based detection, uses Session APIs + user prompt fallback

**Context-Aware Fallback Chains**:

**Menu Context** (batch operations):
1. **Cache** (UserProperties, 1-hour TTL) - Performance optimization
2. **Session.getActiveUser()** ✅ - Primary method (works in menu context)
3. **Session.getEffectiveUser()** ✅ - Secondary method
4. **User Prompt** ⚠️ - Manual entry if Session fails (validates email format)
5. **Default fallback** ❌ - `default@google.com` (last resort)

**Trigger Context** (individual posts):
1. **Cache** (UserProperties, 1-hour TTL) - Performance optimization
2. **Session.getActiveUser()** ✅ - Primary method (works in installable triggers)
3. **Session.getEffectiveUser()** ✅ - Secondary method
4. **Default fallback** ❌ - `default@google.com` (last resort, no prompt in trigger)

**Key Features**:
- **Session Caching**: 1-hour TTL in UserProperties for performance
- **Email Validation**: RFC 5322 validation before accepting email
- **Detection Metadata**: Tracks which method was used for debugging
- **User Prompt**: In menu context only, prompts user if Session fails
- **Deprecated Methods**: Sheet-based detection removed (unreliable, caused wrong attribution)

**Core Functions**:
- `UserResolver.getCurrentUser()`: Get current user (maintains backward compatibility)
- `UserResolver.getUserWithMetadata()`: Get user + detection metadata for debugging
- `UserResolver.setManualUserEmail(email)`: Manually set email (stored in cache)
- `UserResolver.clearUserCache()`: Clear cached user (for troubleshooting)
- `UserResolver.getExecutionContext()`: Detect context ('menu', 'trigger_installable', 'direct')
- `UserResolver.isValidEmail(email)`: Validate email format

**Menu Options** (📋FP - Operations → 👤 User Settings):
- **Set My Email**: Manually set email if auto-detection fails
- **Show User Info**: View current user, detection method, and execution context
- **Clear User Cache**: Force fresh user detection

**Deprecated Functions** (kept for backward compatibility):
- ❌ `detectUserFromSheetEdit()` - No longer functional, always returns null
- ❌ `setCurrentUserEmail()` - Redirects to `setManualUserEmail()`

**Detection Metadata Example**:
```javascript
{
  email: "john@company.com",
  method: "session_active",  // or "cached", "user_prompt", "manual_override", etc.
  context: "menu",           // or "trigger_installable", "direct"
  timestamp: Date            // When detected
}
```

**Usage**:
```javascript
// Simple usage (backward compatible)
const email = UserResolver.getCurrentUser();

// With debugging metadata
const { email, method, context } = UserResolver.getUserWithMetadata();
```

**Benefits**:
- ✅ Always gets actual logged-in user (no stale data)
- ✅ Context-aware fallback strategies
- ✅ User prompt ensures 100% success rate in menu context
- ✅ Performance optimized with 1-hour cache
- ✅ Full debugging capability with detection metadata
- ✅ Backward compatible with existing code

### Batch Operations System

**Purpose**: Streamline end-of-day processing with bulk validation and posting

**Master Database Compatibility**:
- ✅ Fully compatible with both Local and Master modes
- Automatic connection mode detection and tracking
- Performance metrics for both modes
- Audit logging includes connection mode context
- Results dialog shows mode and performance stats

**Menu Structure** (created by `onOpen()`):
- **Batch Validate All Rows**: Validate all rows without posting
- **Batch Post All Valid Rows**: Validate and post all valid rows
- **Validate Selected Rows**: Validate only selected row range
- **Post Selected Rows**: Post only selected row range
- **Clear All Post Checkboxes**: Reset sheet after batch operations
- **👤 User Settings** (submenu):
  - **Set My Email**: Manually set user email
  - **Show User Info**: View current user detection info
  - **Clear User Cache**: Force fresh user detection

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
- Surgical cache invalidation per supplier (once per unique supplier)
- Performance tracking: duration, avg time per row
- Expected: 50-300ms/row (Local), 100-500ms/row (Master)

**Master Database Awareness**:
- Connection mode logged at batch start (BATCH_POST_START)
- Performance metrics logged at completion (BATCH_POST_COMPLETE)
- Toast notifications show connection mode during processing
- Results dialog includes:
  - Connection Mode (LOCAL/MASTER)
  - Total Duration (seconds)
  - Average Time per Row (milliseconds)
  - Performance expectations for current mode
- Audit trail includes supplier cache invalidation count

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
PaymentManager.processPayment(data, invoiceId);
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
const { data, indexMap } = CacheManager.getInvoiceData();
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
Optimized functions accept pre-read data:
- `InvoiceManager.processOptimized(data)`
- `PaymentManager.processPayment(data, invoiceId)`
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
- **Functions**: camelCase (`processPayment`, `calculateBalance`, `getCurrentUser`)
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
1. Check cache freshness: `CacheManager.timestamp`
2. Verify formula evaluation: Inspect cached values for formula strings
3. Compare preview vs actual: `BalanceCalculator.validatePreviewAccuracy(data)`
4. Check AuditLog for calculation warnings

### Performance Optimization
1. Minimize `sheet.getRange()` calls (batch reads/writes)
2. Pass `rowData` to functions (avoid re-reads)
3. Use cached lookups: `CacheManager.getInvoiceData()`
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
10. **Master Database access**: Simple triggers (onEdit, onOpen) cannot access other spreadsheets via `SpreadsheetApp.openById()`. Must use installable triggers when in Master mode. Run `setupInstallableEditTrigger()` to convert. See "Simple Trigger Limitations" below.

## Dependencies

- Google Apps Script runtime
- SpreadsheetApp API
- LockService (concurrency)
- Utilities (UUID, date formatting)
- Session (timezone, user info - with UserResolver fallback)

## Simple Trigger Limitations and Master Database

**IMPORTANT**: When using Master Database mode, you MUST use an installable Edit trigger.

### The Problem

Google Apps Script has two types of triggers:

**Simple Triggers** (default `onEdit`, `onOpen`):
- ❌ Cannot call `SpreadsheetApp.openById()` to access other files
- ❌ Cannot access services requiring authorization
- ✅ Can only access the current spreadsheet
- ✅ Easy to set up (just name function `onEdit`)

**Installable Triggers** (manual setup required):
- ✅ Full authorization and permissions
- ✅ Can access any spreadsheet via `SpreadsheetApp.openById()`
- ✅ Can use all Google Apps Script services
- ⚠️ Requires one-time setup per spreadsheet

### The Solution

When using Master Database mode (`connectionMode: 'master'`), the system needs to write to a different spreadsheet file. This requires an installable trigger.

**Setup Steps:**
1. Open Script Editor in your monthly spreadsheet
2. From the function dropdown, select `setupInstallableEditTrigger`
3. Click Run ▶️
4. Authorize when prompted (you'll see OAuth consent screen)
5. Done! A success dialog will appear

**To verify:** Check the installable trigger was created:
- Script Editor → Triggers (⏰ icon on left sidebar)
- You should see one Edit trigger for the onEdit function

**To remove:** Run `removeInstallableEditTrigger()` function if you need to troubleshoot

### Why testMasterDatabaseWrites() Works But Posting Doesn't

- `testMasterDatabaseWrites()` runs manually from Script Editor → Full permissions ✅
- `onEdit` runs as simple trigger → Restricted permissions ❌
- **Solution:** Convert to installable trigger as described above

**Note:** This is only required for **Master Database mode**. Local mode works fine with simple triggers since all operations stay within the current spreadsheet.

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
**Get payment history**: `PaymentManager.getHistoryForInvoice(invoiceNo)` - O(1) cached
**Get supplier payments**: `PaymentManager.getHistoryForSupplier(supplier)` - O(1) cached
**Check duplicate**: `PaymentManager.isDuplicate(sysId)` - O(1) hash lookup
**Log action**: `AuditLogger.log(action, data, message)`
**Validate data**: `validatePostData(data)`
**Clear cache**: `CacheManager.clear()`
**Get partition stats**: `CacheManager.getPartitionStats()` - Active vs Inactive distribution
**Acquire lock**: `LockManager.acquireDocumentLock(timeout)`
**Get current user**: `UserResolver.getCurrentUser()`
**Batch validate**: `batchValidateAllRows()` (from menu)
**Batch post**: `batchPostAllRows()` (from menu)
**Run benchmarks**: `runAllBenchmarks()` (from Script Editor)

**Master Database Functions:**
**Setup trigger**: `setupInstallableEditTrigger()` - **REQUIRED** for Master mode (run once per file)
**Remove trigger**: `removeInstallableEditTrigger()` - Remove installable trigger if needed
**Test connection**: `testMasterDatabaseConnection()` (from Script Editor)
**Test writes**: `testMasterDatabaseWrites()` (from Script Editor - creates test data)
**Generate formulas**: `generateImportRangeFormulas()` (from Script Editor)
**Show config**: `showMasterDatabaseConfig()` (from Script Editor)
**Test caching**: `testMasterDatabaseCaching()` (from Script Editor)
**Get source sheet** (reads): `MasterDatabaseUtils.getSourceSheet(sheetType)` - Always local (IMPORTRANGE in master mode)
**Get target sheet** (writes): `MasterDatabaseUtils.getTargetSheet(sheetType)` - Master or local based on mode
**Build IMPORTRANGE**: `MasterDatabaseUtils.buildImportFormula(sheetType)` - Generate formulas
**Check mode**: `CONFIG.isMasterMode()` - Returns true if using Master Database

## Module Responsibilities

### _Config.gs
- Centralized configuration for sheets, columns, rules, colors
- **Master Database configuration** (connectionMode, id, url, sheets, importRanges)
- Configuration validation on initialization (includes Master DB validation)
- Helper methods for column letter/index conversion
- Configuration export and summary functions
- **`isMasterMode()`** - Check if using Master Database
- **`getMasterDatabaseId()`** - Get Master DB spreadsheet ID
- **`getMasterDatabaseUrl()`** - Get Master DB URL

### _Utils.gs
- StringUtils: Normalization, comparison, sanitization
- DateUtils: Formatting for time, date, datetime
- SheetUtils: Safe sheet access with validation
- **MasterDatabaseUtils**: Master Database helper utilities
  - **`getSourceSheet(sheetType)`** - **For reads**: Always returns local sheet (IMPORTRANGE in master mode)
  - **`getTargetSheet(sheetType)`** - **For writes**: Returns Master (master mode) or local (local mode)
  - **`buildImportFormula(sheetType)`** - Generate IMPORTRANGE formulas
  - **`testConnection()`** - Validate Master DB setup
  - **`getMasterDatabaseFile()`** - Get Master DB spreadsheet object
  - **`getMasterSheet(sheetType)`** - Get specific Master DB sheet
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

### CacheManager.gs
- Get invoice data: `getInvoiceData()` - lazy load with automatic refresh
- Add to cache: `addInvoiceToCache(rowNum, rowData)` - write-through on invoice creation (with partition routing)
- Update cache: `updateInvoiceInCache(supplier, invoiceNo)` - sync after payment processing
- **Incremental update**: `updateSingleInvoice(supplier, invoiceNo)` - update single row with partition transition support
- Invalidate cache: `invalidate(operation, supplier, invoiceNo)` - smart invalidation with incremental support
- Invalidate supplier: `invalidateSupplierCache(supplier)` - surgical supplier-specific invalidation (both partitions)
- Invalidate global: `invalidateGlobal()` - force complete cache clear
- Get supplier data: `getSupplierData(supplier)` - O(m) supplier invoice lookups
- **Get partition stats**: `getPartitionStats()` - monitor active/inactive distribution and efficiency
- Clear cache: `clear()` - complete cache reset (including partitions)
- Performance tracking: Statistics for incremental updates, full reloads, hit rates, partition transitions
- Cache features: TTL-based expiration, write-through support, dual indexing, incremental updates (250x faster), cache partitioning (70-90% active cache reduction)

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
**Core Functions**:
- Process payment: `processPayment(data, invoiceId)` - with paid date workflow and granular locking
- Get history: `getHistoryForInvoice(invoiceNo)`, `getHistoryForSupplier(supplier)` - **O(1) cached**
- Get totals: `getTotalForSupplier(supplier)` - **O(1) cached**
- Check duplicate: `isDuplicate(sysId)` - **O(1) hash lookup**
- Get statistics: `getStatistics()` - **O(1) cached aggregation**
- Private methods: `_recordPayment()`, `_updateInvoicePaidDate()`, `_shouldUpdatePaidDate()`

**Performance Optimizations** (see PaymentCache above):
- All query functions use PaymentCache for O(1) indexed lookups
- Lock held only during sheet writes (75% reduction: 100-200ms → 20-50ms)
- Eliminated redundant cache updates (50% reduction)
- Query time independent of database size (170x faster: 340ms → 2ms)
- Duplicate detection via hash lookup (340x faster: 340ms → <1ms)

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

### PerformanceBenchmarks.gs
**Comprehensive test suite to validate PaymentManager optimizations**

**Test Categories**:
1. **Cache Initialization** (`benchmarkCacheInitialization`)
   - Cache load time measurement
   - Index building performance (4 indices)
   - Memory usage calculation
   - Cache hit vs miss comparison

2. **Query Performance** (`benchmarkQueryPerformance`)
   - `getHistoryForInvoice()` timing
   - `getHistoryForSupplier()` timing
   - `getTotalForSupplier()` timing
   - `getStatistics()` timing
   - Scalability projections (5K, 10K, 50K records)

3. **Duplicate Detection** (`benchmarkDuplicateDetection`)
   - Single check timing
   - Batch checks (100 iterations)
   - Hash lookup vs linear scan comparison

4. **Cache TTL** (`benchmarkCacheTTL`)
   - Cold start vs warm cache timing
   - TTL expiration validation

5. **Dashboard Simulation** (`benchmarkDashboardSimulation`)
   - Real-world multi-query scenario
   - Before/after comparison

**Test Runners**:
- `runAllBenchmarks()`: Complete suite with summary (~5-10 seconds)
- `runQuickBenchmark()`: Essential tests only (~2-3 seconds)
- `testCacheMemory()`: Memory analysis only
- Individual functions for targeted testing

**Expected Results**:
- Cache load: 200-400ms (one-time)
- Query operations: 1-3ms (O(1) constant)
- Duplicate detection: <1ms (O(1) hash)
- Dashboard (5 queries): ~10ms warm, ~400ms cold

**Usage**: Run from Script Editor → Functions dropdown → Select test → Run → View Logs

### MasterDatabaseTests.gs
**Comprehensive test suite for Master Database setup and connectivity**

**Test Functions**:
1. **`testMasterDatabaseConnection()`** - Main connection test
   - Configuration validation
   - Master Database file access
   - Sheet accessibility checks
   - IMPORTRANGE formula generation
   - Detailed error reporting

2. **`testMasterDatabaseWrites()`** - Write operation test
   - Creates test invoice in Master DB
   - Creates test payment in Master DB
   - Verifies audit logging
   - **WARNING**: Writes test data to Master Database

3. **`generateImportRangeFormulas()`** - Formula generator
   - Generates IMPORTRANGE formulas for all sheet types
   - Provides setup instructions
   - Ready to copy-paste into monthly files

4. **`showMasterDatabaseConfig()`** - Configuration display
   - Shows current connectionMode
   - Displays Master DB ID and URL
   - Lists sheet mappings
   - Shows import ranges

5. **`testMasterDatabaseCaching()`** - Cache functionality test
   - Tests cache loading from Master DB
   - Verifies cache hit performance
   - Shows partition statistics
   - Performance validation

**Usage Workflow**:
1. Configure Master DB in _Config.gs
2. Run `testMasterDatabaseConnection()` to validate setup
3. Run `generateImportRangeFormulas()` to get formulas for monthly files
4. (Optional) Run `testMasterDatabaseWrites()` to test write operations
5. (Optional) Run `testMasterDatabaseCaching()` to verify cache performance

**Expected Output**:
- Connection test: Detailed status of all sheets and configuration
- Write test: Confirmation of successful test data creation
- Formula generator: Ready-to-use IMPORTRANGE formulas
- Cache test: Performance metrics and partition stats

---

**Last Updated**: 2 November 2025 - Added Conditional Cache Strategy for Master Database mode
**Previous Update**: 2 November 2025 - Added Master Database architecture
**Maintained By**: Development team
**Questions**: Check AuditLog sheet or code comments for implementation details

---

## Performance Optimization History

**October 2025 - PaymentManager Optimization Series**:

1. **Lock Scope Reduction** (Commit: 23635e0)
   - Moved locks inside _recordPayment() and _updateInvoicePaidDate()
   - Result: 75% reduction in lock duration (100-200ms → 20-50ms)

2. **Cache Update Optimization** (Commit: 3f8f421)
   - Eliminated double cache updates by passing cached invoice data
   - Result: 50% reduction in redundant operations

3. **Dead Code Removal** (Commit: de7d369)
   - Removed unused `_calculateBalance()` function (50 lines)
   - Result: Improved code maintainability

4. **PaymentCache Implementation** (Commit: d2f504a)
   - Added quad-index cache structure for O(1) payment queries
   - Result: 170x faster queries (340ms → 2ms)

5. **Payment ID Index** (Commit: 0495876)
   - Added fourth index for O(1) duplicate detection
   - Result: 340x faster duplicate checks (340ms → <1ms)

6. **Performance Benchmarks** (Commit: 13a7446)
   - Added comprehensive test suite (PerformanceBenchmarks.gs)
   - Result: Quantifiable validation of all optimizations

**Overall Impact**:
- System transformed from O(n) degradation to O(1) scalability
- Usable at 10x larger scale (50,000+ payments vs 5,000)
- All query operations now constant time
- Memory overhead negligible (~450KB per 1,000 records)
