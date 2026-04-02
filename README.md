# Supplier Management System

A high-performance Google Apps Script application for managing supplier invoices, payments, and ledger tracking with real-time balance calculations and comprehensive audit logging.

## Table of Contents

- [Features](#features)
- [System Architecture](#system-architecture)
- [Operational Modes](#operational-modes)
- [Sheet Structure](#sheet-structure)
- [Setup Instructions](#setup-instructions)
- [Payment Type Workflows](#payment-type-workflows)
- [API Documentation](#api-documentation)
- [Configuration Guide](#configuration-guide)
- [Performance Features](#performance-features)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## Features

### Core Functionality
- **Invoice Management**: Create, track, and update supplier invoices with automatic status calculation
- **Payment Processing**: Handle multiple payment types (Unpaid, Regular, Partial, Due)
- **Real-time Balance Calculation**: Partition-aware cache with surgical per-supplier invalidation
- **Supplier Ledger**: Track outstanding balances per supplier
- **Audit Trail**: Comprehensive batch-queued logging of all transactions and system actions
- **Data Validation**: Business rule enforcement with clear error messages
- **Concurrency Safety**: Document-level locking for multi-user scenarios

### Advanced Features
- **Smart Caching**: 60-second TTL invoice cache with Active/Inactive partition split (70–90% memory reduction)
- **Payment Cache**: Separate quad-index payment cache for O(1) duplicate detection
- **Master Database Mode**: Central write target with IMPORTRANGE read-back for multi-file deployments
- **Dual Trigger System**: Lightweight simple trigger for UI ops + installable trigger for full DB access
- **Batch Operations**: Bulk validate and post with real-time progress tracking via custom menu
- **Auto-population**: Intelligent field completion based on payment type
- **Dropdown Generation**: Dynamic unpaid invoice selection for Due payments
- **User Resolution**: Multi-fallback user identification with execution-scoped and session-level caching
- **Performance Monitoring**: Built-in benchmark runners

---

## System Architecture

### Modular Design

```
┌──────────────────────────────────────────────────────────────────┐
│                    Spreadsheet Events                             │
│  onEdit() [simple trigger]    onEditInstallable() [installable]  │
│  ─ Invoice No / Received Amt  ─ POST / Payment Type / Due Inv.   │
│  ─ Lightweight UI only        ─ Full DB + Cache access           │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                     ┌─────▼─────┐
                     │  Code.gs  │
                     │ (Orchestr)│
                     └─────┬─────┘
           ┌───────────────┼──────────────────┬────────────────┐
           ▼               ▼                  ▼                ▼
    ┌────────────┐  ┌─────────────┐  ┌──────────────┐  ┌────────────┐
    │ Validation │  │  Invoice    │  │   Payment    │  │  UIMenu.gs │
    │  Engine   │  │  Manager    │  │   Manager    │  │ (Batch Ops)│
    └────────────┘  └──────┬──────┘  └──────┬───────┘  └────────────┘
                           │                │
                    ┌──────▼──────┐  ┌──────▼──────┐
                    │CacheManager │  │PaymentCache │
                    │(Active/Inac)│  │(Quad-Index) │
                    └──────┬──────┘  └─────────────┘
                           │
              ┌────────────▼────────────┐
              │    BalanceCalculator    │
              └────────────┬────────────┘
                           │
          ┌────────────────┼───────────────┐
          ▼                ▼               ▼
    ┌──────────┐     ┌─────────┐    ┌──────────┐
    │  Audit   │     │  Utils  │    │  Config  │
    │  Logger  │     │         │    │          │
    └──────────┘     └────┬────┘    └──────────┘
                          │
                 ┌────────▼────────┐
                 │MasterDatabaseU. │
                 │(getSourceSheet /│
                 │ getTargetSheet) │
                 └─────────────────┘
```

### Module Descriptions

| Module | File | Purpose |
|--------|------|---------|
| **Entry Point** | `Code.gs` | Event handling, dual-trigger dispatch, workflow orchestration, auto-populate |
| **Validation** | `ValidationEngine.gs` | Data validation, business rule enforcement, due-payment invoice checks |
| **Invoice Ops** | `InvoiceManager.gs` | Invoice CRUD (`createOrUpdateInvoice`, `findInvoice`), dropdown building |
| **Payment Ops** | `PaymentManager.gs` | Payment recording, `PaymentCache` (quad-index), paid-date workflow |
| **Invoice Cache** | `CacheManager.gs` | Partitioned invoice cache (Active/Inactive), TTL, surgical invalidation |
| **Balance Calc** | `BalanceCalculator.gs` | Balance calculation, UI cell updates, supplier outstanding totals |
| **Batch UI** | `UIMenu.gs` | Custom menu, `batchPostAllRows`, `batchValidateAllRows`, progress feedback |
| **Audit** | `AuditLogger.gs` | Batch-queue audit trail, `log`, `logError`, `logWarning`, `flush` |
| **User Identity** | `_UserResolver.gs` | User identification with multi-level fallback + execution/session caching |
| **Utilities** | `_Utils.gs` | StringUtils, DateUtils, SheetUtils, MasterDatabaseUtils, IDGenerator, LockManager |
| **Configuration** | `_Config.gs` | Sheet/column mappings, business rules, Master DB config, `isMasterMode()` |
| **Tests** | `Test.*.gs`, `Benchmark.Performance.gs` | Unit, integration, and performance benchmarks |

---

## Operational Modes

### Local Mode (default)
All data stays in the monthly spreadsheet file. InvoiceDatabase, PaymentLog, and AuditLog are written directly to the current file.

### Master Database Mode
Writes go to a central `00_SUPPLIER_ACCOUNTS_DATABASE_MASTER` spreadsheet. Monthly files read data back via `IMPORTRANGE` formulas. Requires an installable trigger — see [Setup Instructions](#setup-instructions).

**Active mode:** `CONFIG.isMasterMode()` — configured in [`_Config.gs`](_Config.gs):

```javascript
masterDatabase: {
  connectionMode: 'master',  // 'local' or 'master'
  id: '<spreadsheet-id>',
  url: 'https://docs.google.com/spreadsheets/d/<id>',
  sheets: {
    invoice: 'InvoiceDatabase',
    payment: 'PaymentLog',
    audit: 'AuditLog',
    supplier: 'SupplierList'
  }
}
```

All write operations are automatically routed via `MasterDatabaseUtils.getTargetSheet(type)`. Reads always use the local sheet (fast; in Master mode the local sheet displays data via IMPORTRANGE).

---

## Dual Trigger System

The system uses two separate `onEdit` handlers to work within Google Apps Script permission boundaries:

| Trigger | Function | Columns Handled | Permissions |
|---------|----------|-----------------|-------------|
| **Simple** | `onEdit(e)` | Invoice No, Received Amount | Limited — current spreadsheet only, no `openById` |
| **Installable** | `onEditInstallable(e)` | POST checkbox, Payment Type, Supplier, Previous Invoice, Payment Amount | Full — can access Master Database |

In **Local mode** the simple trigger handles everything. In **Master mode**, run `setupInstallableEditTrigger()` once per monthly file to register the installable trigger.

```javascript
// Run once from Script Editor to enable Master Database mode:
setupInstallableEditTrigger()
```

---

## Sheet Structure

### Required Sheets

#### 1. Daily Sheets (`01` – `31`)
**Purpose**: Daily transaction entry sheets (one per day of month)

**Columns** (A–N):
| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Date | Date | Transaction date (from cell B3, auto-filled) |
| B | Supplier | Text | Supplier name (from SupplierList) |
| C | Invoice No | Text | Invoice number (max 50 chars) |
| D | Received Amount | Number | Total invoice amount received |
| E | Payment Type | Dropdown | `Unpaid`, `Regular`, `Partial`, `Due` |
| F | Previous Invoice | Text/Dropdown | Reference invoice (for Due payments) |
| G | Payment Amount | Number | Amount being paid |
| H | Current Balance | Number | Supplier's outstanding balance (calculated) |
| I | Notes | Text | Optional notes |
| J | Post | Checkbox | Check to post transaction |
| K | Status | Text | Posting status (`POSTED`, `ERROR`, `PROCESSING...`) |
| L | Entered By | Text | User display name (auto-filled) |
| M | Timestamp | DateTime | Post timestamp (auto-filled) |
| N | SYS_ID | Text | System-generated UUID |

#### 2. InvoiceDatabase
**Purpose**: Master invoice ledger

**Columns** (A–M):
| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Invoice Date | Date | Actual invoice/receipt date |
| B | Supplier | Text | Supplier name |
| C | Invoice No | Text | Invoice number (unique per supplier) |
| D | Total Amount | Number | Invoice total |
| E | Total Paid | Formula | `=SUMIFS(PaymentLog!E:E, ...)` |
| F | Balance Due | Formula | `=D - E` |
| G | Status | Formula | `=IFS(F=0,"Paid",F=D,"Unpaid",F<D,"Partial")` |
| H | Paid Date | Formula | Date when fully paid |
| I | Days Outstanding | Formula | Days since invoice date |
| J | Origin Day | Text | Source sheet name (`01`–`31`) |
| K | Entered By | Text | User email |
| L | Timestamp | DateTime | Post timestamp |
| M | SYS_ID | Text | Unique invoice ID |

#### 3. PaymentLog
**Purpose**: Payment transaction log

**Columns** (A–L):
| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Date | Date | Payment date |
| B | Supplier | Text | Supplier name |
| C | Invoice No | Text | Invoice being paid |
| D | Payment Type | Text | Type of payment |
| E | Amount | Number | Payment amount |
| F | Method | Text | `Cash`, `Check`, `Bank Transfer`, `None` |
| G | Reference | Text | Payment reference |
| H | From Sheet | Text | Source daily sheet |
| I | Entered By | Text | User email |
| J | Timestamp | DateTime | Post timestamp |
| K | SYS_ID | Text | System-generated UUID |
| L | Invoice ID | Text | Reference to invoice SYS_ID |

#### 4. SupplierLedger
**Purpose**: Summary of outstanding balances per supplier

**Columns** (A–D):
| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Supplier | Text | Supplier name |
| B | Outstanding | Formula | `=SUMIFS(InvoiceDatabase!F:F, ...)` |
| C | Last Updated | DateTime | Last transaction date |
| D | Status | Text | `Active`, `Inactive` |

#### 5. AuditLog
**Purpose**: System audit trail

**Columns** (A–G):
| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Timestamp | DateTime | Action timestamp |
| B | User | Text | User email or `SYSTEM` |
| C | Sheet | Text | Source sheet or `N/A` |
| D | Location | Text | Row reference or `N/A` |
| E | Action | Text | `POST`, `UPDATE`, `SYSTEM_ERROR`, `WARNING`, `INFO`, etc. |
| F | Details | Text | JSON-serialized transaction fields |
| G | Message | Text | Human-readable message |

#### 6. SupplierList
**Purpose**: Master list of approved suppliers (used for data validation dropdowns)

---

## Setup Instructions

### Prerequisites
- Google Account with access to Google Sheets
- Spreadsheet with required sheets (see [Sheet Structure](#sheet-structure))

### Installation Steps

1. **Create Spreadsheet Structure**
   ```
   ✓ Create a new Google Spreadsheet with name 00_SUPPLIER_ACCOUNTS_DATABASE_MASTER
   ✓ Create sheets: InvoiceDatabase, PaymentLog, SupplierLedger, AuditLog, SupplierList
   ✓ Create a new Google Spreadsheet with name Supplier_Accounts_YYYY-DD_MMM
   ✓ Create daily sheets: 01, 02, 03, ..., 31
   ✓ Add column headers as specified in Sheet Structure section
   ✓ Each daily sheet must have the transaction date in cell B3
   ```

2. **Install Scripts**
   ```
   ✓ Open Tools → Script editor
   ✓ Create new script files for each .gs file in this repository
   ✓ Copy contents from each file to corresponding script file
   ✓ Save the project
   ```

3. **Configure Settings**
   - Open `_Config.gs`
   - Set `connectionMode` to `'local'` (default) or `'master'`
   - If using Master mode, fill in `id` and `url` under `masterDatabase`
   - Adjust business rules if needed:
     ```javascript
     rules: {
       MAX_TRANSACTION_AMOUNT: 1000000,
       CACHE_TTL_MS: 60000,
       LOCK_TIMEOUT_MS: 30000,
       MAX_INVOICE_NO_LENGTH: 50
     }
     ```

4. **Validate Configuration**
   ```javascript
   // Run once from Script Editor:
   initializeConfiguration()
   ```
   This validates sheet structure and logs any errors to the Script Editor console.

5. **Set Up Installable Trigger (Master mode only)**
   ```javascript
   // Run once per monthly file when using Master Database mode:
   setupInstallableEditTrigger()
   ```
   In Local mode the built-in `onEdit` simple trigger is sufficient — no manual setup needed.

6. **Test Installation**
   ```javascript
   // Run from Script Editor:
   runQuickBenchmark()
   ```

### Permissions
On first run, Google will request permissions:
- ✓ View and manage spreadsheets
- ✓ Connect to external services (Master Database access)

---

## Payment Type Workflows

### 1. Unpaid (New Invoice, No Payment)

**Use Case**: Receiving an invoice without immediate payment

**Process**:
```
1. Select Supplier
2. Enter Invoice No
3. Enter Received Amount (invoice total)
4. Select Payment Type: "Unpaid"
5. Payment Amount = 0 (automatic)
6. Check "Post" checkbox
```

**System Actions**:
- Creates invoice in InvoiceDatabase
- No payment record created
- Invoice status = "Unpaid"
- Balance Due = Total Amount

**Validation Rules**:
- Payment Amount must be 0
- Invoice Number required
- Received Amount > 0

---

### 2. Regular (Invoice + Full Payment)

**Use Case**: Receiving an invoice and paying it in full immediately

**Process**:
```
1. Select Supplier
2. Enter Invoice No
3. Enter Received Amount
4. Select Payment Type: "Regular"
5. Previous Invoice = Invoice No (auto-populated)
6. Payment Amount = Received Amount (auto-populated)
7. Check "Post" checkbox
```

**System Actions**:
- Creates invoice in InvoiceDatabase
- Creates payment record in PaymentLog
- Invoice status = "Paid"
- Balance Due = 0

**Validation Rules**:
- Payment Amount MUST equal Received Amount
- Invoice Number required
- Received Amount > 0

---

### 3. Partial (Invoice + Partial Payment)

**Use Case**: Receiving an invoice and making a partial payment

**Process**:
```
1. Select Supplier
2. Enter Invoice No
3. Enter Received Amount (total invoice)
4. Select Payment Type: "Partial"
5. Previous Invoice = Invoice No (auto-populated)
6. Payment Amount = (auto-filled with Received Amount, ADJUST DOWN)
7. Check "Post" checkbox
```

**System Actions**:
- Creates invoice in InvoiceDatabase
- Creates payment record in PaymentLog
- Invoice status = "Unpaid"
- Balance Due = Total Amount - Payment Amount

**Validation Rules**:
- Payment Amount must be > 0 and < Received Amount
- Invoice Number required
- Received Amount > 0

---

### 4. Due (Payment on Existing Invoice)

**Use Case**: Making a payment on a previously unpaid invoice

**Process**:
```
1. Select Supplier
2. Leave Invoice No blank
3. Leave Received Amount as 0
4. Select Payment Type: "Due"
5. Previous Invoice = Select from dropdown (auto-generated list of unpaid invoices)
6. Payment Amount = Balance Due (auto-populated, can adjust down)
7. Check "Post" checkbox
```

**System Actions**:
- Updates existing invoice's Total Paid (via SUMIFS formula recalculation)
- Creates payment record in PaymentLog
- Recalculates Balance Due
- If balance = 0, invoice status transitions to "Paid" (cache moves to Inactive partition)

**Validation Rules**:
- Received Amount must be 0
- Previous Invoice must be selected
- Previous Invoice must exist with balance > 0
- Payment Amount > 0 and ≤ Balance Due of selected invoice

---

## API Documentation

### For Developers: Key Functions

#### ValidationEngine

```javascript
/**
 * Validate transaction data before posting
 * @param {Object} data - Transaction data
 * @param {string} data.supplier
 * @param {string} data.invoiceNo
 * @param {number} data.receivedAmt
 * @param {string} data.paymentType
 * @param {number} data.paymentAmt
 * @param {string} data.prevInvoice
 * @returns {Object} {valid: boolean, error: string, errors: string[]}
 */
function validatePostData(data)

/**
 * Validate payment type-specific rules
 * @param {Object} data - Transaction data
 * @returns {Object} {valid: boolean, errors: string[]}
 */
function validatePaymentTypeRules(data)

/**
 * Validate Due payment (invoice existence + balance check)
 * @param {Object} data - Transaction data
 * @returns {Object} {valid: boolean, errors: string[]}
 */
function validateDuePayment(data)
```

#### InvoiceManager

```javascript
/**
 * Create or update invoice (UPSERT)
 * @param {Object} data - Transaction data
 * @returns {Object} {success: boolean, invoiceId: string, error: string}
 */
InvoiceManager.createOrUpdateInvoice(data)

/**
 * Find invoice by supplier and invoice number (O(1) cache lookup)
 * @param {string} supplier
 * @param {string} invoiceNo
 * @returns {Object|null} {row, data: Array} or null
 */
InvoiceManager.findInvoice(supplier, invoiceNo)

/**
 * Get unpaid/partial invoices for supplier
 * @param {string} supplier
 * @returns {Array} Array of invoice objects
 */
InvoiceManager.getUnpaidForSupplier(supplier)

/**
 * Build dropdown of unpaid invoices for Due payment selection
 * @param {Sheet} sheet
 * @param {number} row
 * @param {string} supplier
 * @param {string} paymentType
 */
InvoiceManager.buildDuePaymentDropdown(sheet, row, supplier, paymentType)
```

#### PaymentManager

```javascript
/**
 * Record payment and trigger invoice status update
 * @param {Object} data - Transaction data
 * @param {string} invoiceId - Invoice SYS_ID
 * @returns {Object} {success: boolean, error: string}
 */
PaymentManager.processPayment(data, invoiceId)

/**
 * Determine if payment record should be written for this transaction
 * @param {Object} data - Transaction data
 * @returns {boolean}
 */
PaymentManager.shouldRecordPayment(data)
```

#### CacheManager

```javascript
/**
 * Get invoice data (lazy-load with 60s TTL)
 * Returns partition-aware cache object
 * @returns {{activeData, activeIndexMap, activeSupplierIndex,
 *            inactiveData, inactiveIndexMap, inactiveSupplierIndex, globalIndexMap}}
 */
CacheManager.getInvoiceData()

/**
 * Surgical per-supplier cache invalidation (reads only changed supplier's rows)
 * @param {string} supplier
 */
CacheManager.invalidateSupplierCache(supplier)

/**
 * Full cache clear
 */
CacheManager.clear()

/**
 * Get partition statistics (active vs inactive counts, hit rates)
 * @returns {Object}
 */
CacheManager.getPartitionStats()
```

#### BalanceCalculator

```javascript
/**
 * Get supplier's total outstanding balance
 * @param {string} supplier
 * @returns {number}
 */
BalanceCalculator.getSupplierOutstanding(supplier)

/**
 * Get single invoice's balance due
 * @param {string} invoiceNo
 * @param {string} supplier
 * @returns {number}
 */
BalanceCalculator.getInvoiceOutstanding(invoiceNo, supplier)

/**
 * Update balance cell in daily sheet (preview before post, actual after)
 * @param {Sheet} sheet
 * @param {number} row
 * @param {boolean} afterPost
 * @param {Array} rowData - Pre-read row values (required)
 */
BalanceCalculator.updateBalanceCell(sheet, row, afterPost, rowData)
```

#### AuditLogger

```javascript
/**
 * Log transaction/action (queued in batch mode)
 * @param {string} action
 * @param {Object} data
 * @param {string} message
 */
AuditLogger.log(action, data, message)

/**
 * Log system error
 * @param {string} context
 * @param {string} message
 */
AuditLogger.logError(context, message)

/**
 * Flush queued entries to sheet (one batch write)
 * @returns {number} Entries flushed
 */
AuditLogger.flush()

/**
 * Get recent audit entries
 * @param {number} limit - default 100
 * @returns {Array}
 */
AuditLogger.getRecentEntries(limit)

/**
 * Get complete audit trail for a transaction
 * @param {string} sysId
 * @returns {Array}
 */
AuditLogger.getTrailForRecord(sysId)
```

#### UIMenu (Batch Operations)

```javascript
/**
 * Validate all rows in current daily sheet without posting
 */
UIMenu.batchValidateAllRows()

/**
 * Validate and post all valid rows in current daily sheet
 */
UIMenu.batchPostAllRows()

/**
 * Clear all Post checkboxes in current daily sheet
 */
UIMenu.clearAllPostCheckboxes()
```

---

## Configuration Guide

### Business Rules (`_Config.gs`)

```javascript
rules: {
  // Maximum transaction amount allowed
  MAX_TRANSACTION_AMOUNT: 1000000,

  // Cache time-to-live in milliseconds (60 seconds)
  CACHE_TTL_MS: 60000,

  // Document lock timeout (30 seconds)
  LOCK_TIMEOUT_MS: 30000,

  // Maximum invoice number length
  MAX_INVOICE_NO_LENGTH: 50,

  // Supported payment types
  SUPPORTED_PAYMENT_TYPES: ['Unpaid', 'Regular', 'Partial', 'Due'],

  // Supported payment methods
  SUPPORTED_PAYMENT_METHODS: ['Cash', 'Check', 'Bank Transfer', 'None'],

  // Default payment method
  DEFAULT_PAYMENT_METHOD: 'Cash'
}
```

### UI Colors

```javascript
colors: {
  success:    '#E8F5E8',  // Light green (successful posts)
  error:      '#FFEBEE',  // Light red (errors)
  warning:    '#FFF4E6',  // Light orange (warnings)
  processing: '#FFF9C4',  // Light yellow (in-progress)
  info:       '#E3F2FD',  // Light blue (balance preview)
  neutral:    '#F5F5F5'   // Light gray
}
```

### Column Mappings

If your sheet structure differs, update column indices in `_Config.gs`. All indices are **0-based**:

```javascript
// Daily sheet (cols A=0, B=1, ...)
cols: {
  supplier:    1,  // B
  invoiceNo:   2,  // C
  receivedAmt: 3,  // D
  paymentType: 4,  // E
  prevInvoice: 5,  // F
  paymentAmt:  6,  // G
  balance:     7,  // H
  notes:       8,  // I
  post:        9,  // J
  status:      10, // K
  enteredBy:   11, // L
  timestamp:   12, // M
  sysId:       13  // N
}
```

---

## Performance Features

### 1. Invoice Cache — Active/Inactive Partitioning
- **Active partition**: Unpaid and partially-paid invoices (balance > $0.01) — typically 10–30% of total
- **Inactive partition**: Fully paid invoices — typically 70–90% of total
- **Balance queries** only scan the Active partition, reducing iteration by 70–90%
- Automatic partition transition when an invoice becomes fully paid
- TTL: 60 seconds; cache persists across edits in the same execution window

### 2. Payment Cache — Quad-Index Structure (inside `PaymentManager`)
- Four indexes: invoice, supplier, combined (`SUPPLIER|INVOICE_NO`), and payment-ID
- O(1) duplicate detection for payment records
- Write-through: new payments available in cache immediately after write

### 3. Surgical Supplier Invalidation
- `CacheManager.invalidateSupplierCache(supplier)` updates only the affected supplier's rows
- Reads fresh values from the sheet only for that supplier, then updates partitions in-place
- Other suppliers' data remains cached and valid — no global clear required

### 4. Batch Write Strategy
- **Single read per edit**: row data read once, passed through the entire pipeline
- **Batch writes**: `setValues()` for multi-column status updates (1 API call)
- **AuditLogger batch queue**: entries queued in memory, flushed in a single `setValues()` call (auto-flush at threshold; manual flush at end of batch operations)

### 5. Concurrency Management
- Document locks acquired **only** during the critical POST operation
- All non-POST edits (field auto-population, balance preview) run lock-free
- Early validation exits before lock acquisition (fail fast — no lock wasted on invalid data)
- Lock timeout: 30 seconds with automatic release

### Performance Benchmarks

Typical operation times (from `Benchmark.Performance.gs`):

| Operation | Time |
|-----------|------|
| Invoice find (cache hit) | < 2ms |
| Invoice find (cache miss) | 200–400ms |
| Balance calculation (active partition) | < 10ms |
| Surgical supplier invalidation | 10–50ms |
| Full cache clear + reload | 200–600ms |
| Full post transaction (Local mode) | 300–500ms |
| Full post transaction (Master mode) | 500–800ms |

---

## Testing

### Running Tests

From Google Apps Script Script Editor, run any of these functions:

**Unit / Integration Tests**:
```javascript
// Cache manager tests
runCacheManagerTests()         // Test.CacheManager.gs

// Invoice manager tests
runInvoiceManagerTests()       // Test.InvoiceManager.gs

// Payment manager tests
runPaymentManagerTests()       // Test.PaymentManager.gs

// Integration tests (full workflow)
runIntegrationTests()          // Test.Integration.gs

// Master Database connection and write tests
testMasterDatabaseConnection() // Test.MasterDatabase.gs
testMasterDatabaseWrites()     // Test.MasterDatabase.gs

// Trigger setup tests
runTriggerTests()              // Test.Triggers.gs
```

**Performance Benchmarks**:
```javascript
runAllBenchmarks()   // Full benchmark suite — Benchmark.Performance.gs
runQuickBenchmark()  // Quick smoke-test benchmarks
```

### Test File Map

| File | What It Tests |
|------|---------------|
| `Test.CacheManager.gs` | Cache partitioning, TTL, surgical invalidation, partition transitions |
| `Test.InvoiceManager.gs` | Invoice CRUD, duplicate detection, dropdown building |
| `Test.PaymentManager.gs` | Payment recording, PaymentCache, duplicate detection, paid-date workflow |
| `Test.Integration.gs` | Full end-to-end post workflow for each payment type |
| `Test.MasterDatabase.gs` | Master DB connection, sheet access, write routing |
| `Test.Triggers.gs` | Trigger setup and teardown |
| `Benchmark.Performance.gs` | Cache load times, lookup times, batch operation throughput |

### Writing New Tests

```javascript
function testMyFeature() {
  try {
    const testData = {
      supplier: 'TEST SUPPLIER',
      invoiceNo: 'INV-001',
      receivedAmt: 1000,
      paymentAmt: 0,
      paymentType: 'Unpaid',
      sheetName: '01',
      rowNum: 6,
      enteredBy: 'test@example.com',
      sysId: IDGenerator.generateUUID()
    };

    const result = validatePostData(testData);

    if (result.valid) {
      Logger.log('✓ Test passed');
    } else {
      Logger.log('✗ Test failed: ' + result.error);
    }

  } catch (error) {
    Logger.log('✗ Test error: ' + error.toString());
  }
}
```

---

## Troubleshooting

### Common Issues

#### 1. "Configuration Error" on First Run
**Cause**: Required sheets missing or misnamed

**Solution**:
```javascript
const result = CONFIG.validate();
Logger.log(result.errors);
Logger.log(result.warnings);
```

#### 2. "Lock Acquisition Failed"
**Cause**: Another user is processing a transaction, or a previous lock was not released

**Solution**:
- Wait 30 seconds and retry
- Check for stuck scripts in Executions log
- Clear lock manually (advanced):
  ```javascript
  LockService.getDocumentLock().releaseLock()
  ```

#### 3. Balance Not Updating
**Cause**: Cache stale or formula error

**Solution**:
```javascript
// Clear entire invoice cache (forces reload on next access)
CacheManager.clear()

// Force balance recalculation for a specific row
BalanceCalculator.updateBalanceCell(sheet, row, false, rowData)
```

#### 4. "Invoice Already Exists" Error
**Cause**: Duplicate invoice number for same supplier

**Solution**:
- Check if invoice was already posted in InvoiceDatabase
- Use a different invoice number
- Or pay the existing invoice using the "Due" payment type

#### 5. Dropdown Not Showing Unpaid Invoices
**Cause**: No unpaid invoices exist, or supplier name mismatch

**Solution**:
- Verify supplier name matches exactly (comparison is case-insensitive but whitespace-sensitive)
- Check InvoiceDatabase for invoices with `Balance Due > 0`
- Verify `CacheManager` has not expired (TTL = 60s); re-edit the Supplier cell to rebuild the dropdown

#### 6. Audit Log Not Recording
**Cause**: AuditLog sheet missing or batch queue not flushed

**Solution**:
- Ensure `AuditLog` sheet exists with 7 columns
- In batch operations, call `AuditLogger.flush()` at the end
- Check queue status: `AuditLogger.getQueueStats()`

#### 7. Master Database Writes Not Working
**Cause**: Missing installable trigger or wrong spreadsheet ID

**Solution**:
```javascript
// Step 1: Verify connection
const result = MasterDatabaseUtils.testConnection();
Logger.log(JSON.stringify(result));

// Step 2: Re-register trigger if needed
setupInstallableEditTrigger()

// Step 3: Validate config
initializeConfiguration()
```

### Debug Mode

View all recent audit entries:
```javascript
const entries = AuditLogger.getRecentEntries(50);
entries.forEach(e => Logger.log(`${e.action}: ${e.message}`));
```

View cache partition stats:
```javascript
Logger.log(JSON.stringify(CacheManager.getPartitionStats()));
```

View audit trail for a specific transaction:
```javascript
const trail = AuditLogger.getTrailForRecord('<sysId>');
trail.forEach(e => Logger.log(e.action + ': ' + e.message));
```

---

## Contributing

### Development Guidelines

1. **Code Style**:
   - Use JSDoc comments for all public functions
   - Follow existing naming conventions (`camelCase` methods, `UPPER_SNAKE` constants)
   - Use `const` for immutable values
   - Never hardcode sheet names or column indices — use `CONFIG`

2. **Single Read Pattern**:
   - Read the row once with `sheet.getRange(row, 1, 1, CONFIG.totalColumns.daily).getValues()[0]`
   - Pass `rowData` through the entire function chain — never re-read

3. **Batch Writes**:
   - Group related cell updates into a single `setValues()` call
   - Never write cell-by-cell in a loop

4. **Cache Awareness**:
   - Use `CacheManager.getInvoiceData()` for all invoice lookups
   - Call `CacheManager.invalidateSupplierCache(supplier)` after posting (not `CacheManager.clear()`)
   - For payment lookups, use `PaymentCache` inside `PaymentManager`

5. **Testing**:
   - Write tests in `Test.*.gs` before adding features
   - Run `runAllBenchmarks()` to verify no performance regressions
   - Manual checklist: post all four payment types (Unpaid, Regular, Partial, Due)

6. **Adding New Payment Types**:
   - Add to `CONFIG.rules.SUPPORTED_PAYMENT_TYPES`
   - Add case to `validatePaymentTypeRules()` in `ValidationEngine.gs`
   - Add entry to `PAYMENT_TYPE_CONFIG` in `BalanceCalculator.gs`
   - Add case to `Code._handlePaymentTypeEdit()`

### Known Issues & Future Enhancements
- Formula injection vulnerability on invoice number fields (high priority)
- Audit logger pagination for large audit sheets
- Rate limiting for rapid sequential post operations
- Multi-currency support

---

## License

This project is provided as-is for internal use. Modify and distribute according to your organization's policies.

---

## Support

For issues, questions, or feature requests:
1. Check [Troubleshooting](#troubleshooting) section
2. Review [API Documentation](#api-documentation)
3. Check Google Apps Script execution logs (`View → Executions`)
4. Run `CONFIG.validate()` to check sheet/config health
5. Contact system administrator

---

**Version**: 2.0
**Last Updated**: April 2026
**Timezone**: Asia/Dhaka
**Runtime**: Google Apps Script V8
