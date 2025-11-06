# Supplier Management System

A high-performance Google Apps Script application for managing supplier invoices, payments, and ledger tracking with real-time balance calculations and comprehensive audit logging.

## Table of Contents

- [Features](#features)
- [System Architecture](#system-architecture)
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
- **Real-time Balance Calculation**: Cached balance lookups with automatic invalidation
- **Supplier Ledger**: Track outstanding balances per supplier
- **Audit Trail**: Comprehensive logging of all transactions and system actions
- **Data Validation**: Business rule enforcement with clear error messages
- **Concurrency Safety**: Document-level locking for multi-user scenarios

### Advanced Features
- **Smart Caching**: 60-second TTL cache for invoice data with surgical invalidation
- **Batch Operations**: Optimized bulk invoice creation
- **Auto-population**: Intelligent field completion based on payment type
- **Dropdown Generation**: Dynamic unpaid invoice selection for Due payments
- **User Resolution**: Multi-fallback user identification system
- **Performance Monitoring**: Built-in performance tests and benchmarks

---

## System Architecture

### Modular Design

```
┌─────────────────────────────────────────────────────────────┐
│                         Code.gs                              │
│                   (Main Entry Point)                         │
│              onEdit() → Event Handler                        │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
  ┌──────────┐   ┌────────────┐  ┌──────────────┐
  │ Validate │   │  Invoice   │  │   Payment    │
  │  Engine  │   │  Manager   │  │   Manager    │
  └─────┬────┘   └─────┬──────┘  └──────┬───────┘
        │              │                 │
        │              ▼                 │
        │      ┌──────────────┐         │
        │      │ Invoice Cache│         │
        │      │   (60s TTL)  │         │
        │      └──────────────┘         │
        │                                │
        └────────────┬───────────────────┘
                     ▼
           ┌──────────────────┐
           │ Balance Calculator│
           └─────────┬─────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
  ┌──────────┐ ┌─────────┐ ┌──────────┐
  │  Audit   │ │  Utils  │ │  Config  │
  │  Logger  │ │         │ │          │
  └──────────┘ └─────────┘ └──────────┘
```

### Module Descriptions

| Module | File | Purpose |
|--------|------|---------|
| **Entry Point** | `Code.gs` | Event handling, workflow orchestration |
| **Validation** | `ValidationEngine.gs` | Data validation, business rule enforcement |
| **Invoice Ops** | `InvoiceManager.gs` | Invoice CRUD, caching, search |
| **Payment Ops** | `PaymentManager.gs` | Payment processing, invoice updates |
| **Balance Calc** | `BalanceCalculator.gs` | Balance calculation, UI updates |
| **Audit** | `AuditLogger.gs` | Transaction logging, audit trail |
| **User Identity** | `_UserResolver.gs` | User identification with fallbacks |
| **Utilities** | `_Utils.gs` | Date, string, lock, ID generation |
| **Configuration** | `_Config.gs` | Sheet/column mappings, business rules |
| **Tests** | `Test*.gs`, `PerformanceTests*.gs` | Unit and performance tests |

---

## Sheet Structure

### Required Sheets

The system requires the following sheets in your Google Spreadsheet:

#### 1. Daily Sheets (`01` - `31`)
**Purpose**: Daily transaction entry sheets (one per day of month)

**Columns** (A-N):
| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Date | Date | Transaction date (auto-filled) |
| B | Supplier | Text | Supplier name (from SupplierList) |
| C | Invoice No | Text | Invoice number (max 50 chars) |
| D | Received Amount | Number | Total invoice amount received |
| E | Payment Type | Dropdown | `Unpaid`, `Regular`, `Partial`, `Due` |
| F | Previous Invoice | Text/Dropdown | Reference invoice (for Due payments) |
| G | Payment Amount | Number | Amount being paid |
| H | Current Balance | Formula | Supplier's outstanding balance |
| I | Notes | Text | Optional notes |
| J | Post | Checkbox | Check to post transaction |
| K | Status | Text | Posting status (`POSTED`, `ERROR`) |
| L | Entered By | Text | User email (auto-filled) |
| M | Timestamp | DateTime | Post timestamp (auto-filled) |
| N | SYS_ID | Text | System-generated UUID |

#### 2. InvoiceDatabase
**Purpose**: Master invoice ledger

**Columns** (A-L):
| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Date | Date | System post date |
| B | Supplier | Text | Supplier name |
| C | Invoice No | Text | Invoice number (unique per supplier) |
| D | Invoice Date | Date | Actual invoice/receipt date |
| E | Total Amount | Number | Invoice total |
| F | Total Paid | Formula | `=SUMIFS(PaymentLog!E:E, ...)` |
| G | Balance Due | Formula | `=E - F` |
| H | Status | Formula | `=IF(G=0, "Paid", "Unpaid")` |
| I | Paid Date | Formula | Date when fully paid |
| J | Origin Day | Text | Source sheet name |
| K | Days Outstanding | Formula | Days since invoice date |
| L | SYS_ID | Text | Unique invoice ID |

#### 3. PaymentLog
**Purpose**: Payment transaction log

**Columns** (A-L):
| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Date | Date | Payment date |
| B | Supplier | Text | Supplier name |
| C | Invoice No | Text | Invoice being paid |
| D | Payment Type | Text | Type of payment |
| E | Amount | Number | Payment amount |
| F | Method | Text | `Cash`, `Check`, `Bank Transfer` |
| G | Reference | Text | Payment reference |
| H | From Sheet | Text | Source daily sheet |
| I | Entered By | Text | User email |
| J | Timestamp | DateTime | Post timestamp |
| K | SYS_ID | Text | System-generated UUID |
| L | Invoice ID | Text | Reference to invoice SYS_ID |

#### 4. SupplierLedger
**Purpose**: Summary of outstanding balances per supplier

**Columns** (A-D):
| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Supplier | Text | Supplier name |
| B | Outstanding | Formula | `=SUMIFS(InvoiceDatabase!G:G, ...)` |
| C | Last Updated | DateTime | Last transaction date |
| D | Status | Text | `Active`, `Inactive` |

#### 5. AuditLog
**Purpose**: System audit trail

**Columns** (A-G):
| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Timestamp | DateTime | Action timestamp |
| B | User | Text | User email |
| C | Sheet | Text | Source sheet |
| D | Location | Text | Row/column reference |
| E | Action | Text | Action type |
| F | Details | Text | Serialized transaction data |
| G | Message | Text | Human-readable message |

#### 6. SupplierList
**Purpose**: Master list of approved suppliers (used for data validation)

---

## Setup Instructions

### Prerequisites
- Google Account with access to Google Sheets
- Basic understanding of Google Apps Script
- Spreadsheet with required sheets (see [Sheet Structure](#sheet-structure))

### Installation Steps

1. **Create Spreadsheet Structure**
   ```
   ✓ Create a new Google Spreadsheet
   ✓ Create sheets: InvoiceDatabase, PaymentLog, SupplierLedger, AuditLog, SupplierList
   ✓ Create daily sheets: 01, 02, 03, ..., 31
   ✓ Add column headers as specified in Sheet Structure section
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
   - Verify sheet names match your spreadsheet
   - Adjust business rules if needed:
     ```javascript
     rules: {
       MAX_TRANSACTION_AMOUNT: 1000000,  // Adjust as needed
       CACHE_TTL_MS: 60000,              // Cache lifetime (60s)
       LOCK_TIMEOUT_MS: 30000,           // Lock timeout (30s)
       MAX_INVOICE_NO_LENGTH: 50
     }
     ```

4. **Initialize Configuration**
   ```javascript
   // Run this function once from Script Editor:
   initializeConfiguration()
   ```
   This validates your sheet structure and displays any errors.

5. **Set Up Triggers** (Optional)
   - The system uses `onEdit()` which runs automatically
   - No manual triggers needed for core functionality

6. **Test Installation**
   ```javascript
   // Run from Script Editor:
   testBalanceCalculatorBasic()
   ```

### Permissions
On first run, Google will request permissions:
- ✓ View and manage spreadsheets
- ✓ Connect to external services (for audit logging)

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
- Payment Amount must be < Received Amount
- Payment Amount must be > 0
- Invoice Number required

---

### 4. Due (Payment on Existing Invoice)

**Use Case**: Making a payment on a previously unpaid invoice

**Process**:
```
1. Select Supplier
2. Leave Invoice No blank (or enter new invoice if receiving one)
3. Enter Received Amount (if receiving new invoice, else 0)
4. Select Payment Type: "Due"
5. Previous Invoice = Select from dropdown (auto-generated list of unpaid invoices)
6. Payment Amount = Balance Due (auto-populated, can adjust)
7. Check "Post" checkbox
```

**System Actions**:
- If Received Amount > 0: Creates new invoice
- Updates existing invoice's Total Paid
- Creates payment record
- Recalculates Balance Due
- If balance = 0, marks invoice as "Paid"

**Validation Rules**:
- Previous Invoice must be selected
- Previous Invoice must exist and have balance > 0
- Payment Amount > 0
- Payment Amount ≤ Balance Due of selected invoice

---

## API Documentation

### For Developers: Key Functions

#### ValidationEngine

```javascript
/**
 * Validate transaction data before posting
 * @param {Object} data - Transaction data
 * @param {string} data.supplier - Supplier name
 * @param {string} data.invoiceNo - Invoice number
 * @param {number} data.receivedAmt - Received amount
 * @param {string} data.paymentType - Payment type
 * @param {number} data.paymentAmt - Payment amount
 * @param {string} data.prevInvoice - Previous invoice reference
 * @returns {Object} {valid: boolean, error: string, errors: array}
 */
function validatePostData(data)
```

#### InvoiceManager

```javascript
/**
 * Process invoice optimized (create or find existing)
 * @param {Object} data - Transaction data
 * @returns {Object} {success: boolean, invoiceId: string, error: string}
 */
InvoiceManager.processOptimized(data)

/**
 * Find invoice by supplier and invoice number
 * @param {string} supplier - Supplier name
 * @param {string} invoiceNo - Invoice number
 * @returns {Object|null} Invoice record or null
 */
InvoiceManager.find(supplier, invoiceNo)

/**
 * Get unpaid invoices for supplier
 * @param {string} supplier - Supplier name
 * @returns {Array} Array of unpaid invoice objects
 */
InvoiceManager.getUnpaidForSupplier(supplier)

/**
 * Build dropdown of unpaid invoices
 * @param {Sheet} sheet - Target sheet
 * @param {number} row - Row number
 * @param {string} supplier - Supplier name
 * @param {string} paymentType - Payment type
 */
InvoiceManager.buildUnpaidDropdown(sheet, row, supplier, paymentType)
```

#### PaymentManager

```javascript
/**
 * Process payment optimized
 * @param {Object} data - Transaction data
 * @param {string} invoiceId - Invoice system ID
 * @returns {Object} {success: boolean, error: string}
 */
PaymentManager.processPayment(data, invoiceId)
```

#### BalanceCalculator

```javascript
/**
 * Get supplier's outstanding balance
 * @param {string} supplier - Supplier name
 * @returns {number} Outstanding balance
 */
BalanceCalculator.getSupplierOutstanding(supplier)

/**
 * Get invoice's outstanding balance
 * @param {string} invoiceNo - Invoice number
 * @param {string} supplier - Supplier name
 * @returns {number} Outstanding balance
 */
BalanceCalculator.getInvoiceOutstanding(invoiceNo, supplier)

/**
 * Update balance cell in daily sheet
 * @param {Sheet} sheet - Sheet object
 * @param {number} row - Row number
 * @param {boolean} isPostContext - Whether called from posting context
 * @param {Array} rowData - Pre-read row values (optional)
 */
BalanceCalculator.updateBalanceCell(sheet, row, isPostContext, rowData)
```

#### AuditLogger

```javascript
/**
 * Log audit action
 * @param {string} action - Action type
 * @param {Object} data - Transaction data
 * @param {string} message - Human-readable message
 */
function auditAction(action, data, message)

/**
 * Get recent audit entries
 * @param {number} limit - Number of entries (default 100)
 * @returns {Array} Array of audit entry objects
 */
AuditLogger.getRecentEntries(limit)
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
  success: '#E8F5E8',   // Light green (successful posts)
  error: '#FFEBEE',     // Light red (errors)
  warning: '#FFF4E6',   // Light orange (warnings)
  info: '#E3F2FD',      // Light blue (info)
  neutral: '#F5F5F5'    // Light gray (neutral)
}
```

### Customizing Column Mappings

If your sheet structure differs, update column indices in `_Config.gs`:

```javascript
cols: {
  supplier: 1,        // B (0-based index)
  invoiceNo: 2,       // C
  receivedAmt: 3,     // D
  // ... adjust as needed
}
```

---

## Performance Features

### 1. Smart Caching
- **Invoice Cache**: 60-second TTL with supplier-based indexing
- **Write-Through**: New invoices immediately added to cache
- **Surgical Invalidation**: Only invalidates affected supplier's cache
- **Cache Statistics**: Track hits/misses (available in advanced mode)

### 2. Batch Operations
- **Single Read Strategy**: Pre-read entire row once, pass through pipeline
- **Batch Writes**: Group related cell updates into single API call
- **Minimal API Calls**: Optimized to reduce SpreadsheetApp operations

### 3. Concurrency Management
- **Document Locks**: Prevent race conditions in multi-user scenarios
- **Lock Timeout**: 30-second timeout with automatic release
- **Lock Manager**: Centralized lock acquisition/release

### 4. Optimization Techniques
```
✓ Zero redundant cell reads
✓ Pre-calculated balance passing
✓ Conditional payment processing
✓ Early validation exit (fail fast)
✓ Formula-based calculations (offload to Sheets engine)
```

### Performance Benchmarks

Typical operation times (from PerformanceTests):
- **Invoice Find (cached)**: < 10ms
- **Invoice Find (cache miss)**: < 100ms
- **Balance Calculation**: < 50ms
- **Full Post Transaction**: < 500ms

---

## Testing

### Running Tests

From Google Apps Script Editor:

**Basic Tests**:
```javascript
// Test balance calculator
testBalanceCalculatorBasic()

// Test invoice operations
testInvoiceOperations()

// Test payment processing
testPaymentProcessing()
```

**Performance Tests**:
```javascript
// Run comprehensive performance suite
runPerformanceTests01()
runPerformanceTests02()
```

### Test Coverage

Current test files:
- `TestCodeGS.gs` - Core workflow tests
- `TestBalanceCalculator.gs` - Balance calculation tests
- `PerformanceTests01.gs` - Cache and lookup performance
- `PerformanceTests02.gs` - Transaction processing performance

### Writing New Tests

Example test structure:
```javascript
function testMyFeature() {
  try {
    // Setup
    const testData = { /* ... */ };

    // Execute
    const result = myFunction(testData);

    // Assert
    if (result.success) {
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
// Run configuration validation
const result = CONFIG.validate();
Logger.log(result.errors);
Logger.log(result.warnings);
```

#### 2. "Lock Acquisition Failed"
**Cause**: Another user is processing a transaction, or previous lock not released

**Solution**:
- Wait 30 seconds and retry
- Check for stuck scripts in Executions log
- Clear locks manually (advanced):
  ```javascript
  LockService.getDocumentLock().releaseLock()
  ```

#### 3. Balance Not Updating
**Cause**: Cache not invalidated or formula error

**Solution**:
```javascript
// Clear all caches
InvoiceCache.invalidate('delete')

// Force recalculation
BalanceCalculator.updateBalanceCell(sheet, row, false, null)
```

#### 4. "Invoice Already Exists" Error
**Cause**: Duplicate invoice number for same supplier

**Solution**:
- Check if invoice was already posted
- Use different invoice number
- Or make payment on existing invoice using "Due" type

#### 5. Dropdown Not Showing Unpaid Invoices
**Cause**: No unpaid invoices exist, or supplier name mismatch

**Solution**:
- Verify supplier name matches exactly (case-insensitive)
- Check InvoiceDatabase for unpaid invoices
- Verify invoice status formulas are working

#### 6. Audit Log Not Recording
**Cause**: Audit logging disabled or sheet missing

**Solution**:
- Ensure AuditLog sheet exists
- Uncomment audit calls in Code.gs (lines 197, 240-241)
- Check AuditLogger.gs for errors

### Debug Mode

Enable detailed logging:
```javascript
// In Code.gs, uncomment audit lines:
auditAction("══NEW-POST══", data, "Starting posting process");
auditAction("══AFTER-POST══", data, "Posted successfully");
```

View logs:
- **Script Editor**: View → Logs
- **Advanced**: View → Executions (shows full execution history)

---

## Contributing

### Development Guidelines

1. **Code Style**:
   - Use JSDoc comments for all functions
   - Follow existing naming conventions
   - Use const for immutable values
   - Use descriptive variable names

2. **Testing**:
   - Write tests for new features
   - Run existing tests before committing
   - Add performance benchmarks for critical paths

3. **Documentation**:
   - Update README for new features
   - Add inline comments for complex logic
   - Document breaking changes

4. **Performance**:
   - Minimize SpreadsheetApp API calls
   - Use batch operations where possible
   - Consider cache implications

### Contribution Workflow

```bash
# Fork the repository
# Make your changes
# Test thoroughly
# Submit pull request with description
```

### Known Issues & Future Enhancements

See codebase analysis for:
- Formula injection vulnerability fix (high priority)
- Audit logger pagination optimization
- Rate limiting for posting operations
- Enhanced error handling
- Multi-currency support

---

## License

This project is provided as-is for internal use. Modify and distribute according to your organization's policies.

---

## Support

For issues, questions, or feature requests:
1. Check [Troubleshooting](#troubleshooting) section
2. Review [API Documentation](#api-documentation)
3. Check Google Apps Script execution logs
4. Contact system administrator

---

**Version**: 1.0
**Last Updated**: October 2025
**Timezone**: Asia/Dhaka
**Runtime**: Google Apps Script V8
