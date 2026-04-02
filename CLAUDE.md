# CLAUDE.md

Google Apps Script application for managing supplier invoices and payments via Google Sheets. Tracks invoice creation, payment processing, balance calculations, and audit trails. No CLI — all code runs in the Google Apps Script editor (script.google.com).

## Agent Docs

Read these before working on relevant areas:

- [agent_docs/master_database.md](agent_docs/master_database.md) — Local vs Master DB modes, trigger setup, IMPORTRANGE config
- [agent_docs/caching_architecture.md](agent_docs/caching_architecture.md) — CacheManager (invoice) + PaymentCache internals, performance numbers
- [agent_docs/coding_patterns.md](agent_docs/coding_patterns.md) — Naming conventions, error handling, concurrency, config rules
- [agent_docs/common_tasks.md](agent_docs/common_tasks.md) — How to add payment types, validations, debug user/balance/cache issues
- [agent_docs/testing.md](agent_docs/testing.md) — Test functions, benchmark runners, manual checklist

## Module Map

```
_Config.gs              → CONFIG object: sheet names, column indices, business rules, Master DB config
_Utils.gs               → StringUtils, DateUtils, SheetUtils, MasterDatabaseUtils, IDGenerator, LockManager
_UserResolver.gs        → Reliable user identification with multi-level fallback + caching
AuditLogger.gs          → Audit trail: log(), logError(), logWarning(), getTrailForRecord()
ValidationEngine.gs     → validatePostData(), validatePaymentTypeRules(), validateDuePayment()
CacheManager.gs         → Write-through invoice cache with partitioning + incremental updates
InvoiceManager.gs       → createOrUpdateInvoice(), findInvoice(), getUnpaidForSupplier()
PaymentManager.gs       → processPayment(), PaymentCache (quad-index), paid date workflow
BalanceCalculator.gs    → calculate(), calculatePreview(), updateBalanceCell(), getSupplierOutstanding()
UIMenu.gs               → onOpen() custom menu, batchPostAllRows(), batchValidateAllRows()
Code.gs                 → onEdit() entry point, processPostedRowWithLock(), auto-populate helpers
Benchmark.Performance.gs → runAllBenchmarks(), runQuickBenchmark() — run from Script Editor
Test.MasterDatabase.gs  → testMasterDatabaseConnection(), testMasterDatabaseWrites()
Test.*.gs               → Unit/integration tests — run from Script Editor
```

## Operational Modes

**Local (default)**: all data stays in the monthly spreadsheet file.
**Master**: writes go to `00_SUPPLIER_ACCOUNTS_DATABASE_MASTER`; monthly files read via IMPORTRANGE. Requires installable trigger — see [agent_docs/master_database.md](agent_docs/master_database.md).

Active mode: `CONFIG.isMasterMode()` — configured in [_Config.gs](_Config.gs).

## Payment Types

| Type | Condition |
|------|-----------|
| Unpaid | `receivedAmt > 0`, `paymentAmt = 0` |
| Regular | `paymentAmt === receivedAmt` |
| Partial | `0 < paymentAmt < receivedAmt` |
| Due | `receivedAmt = 0`, `paymentAmt > 0`, requires `prevInvoice` with balance |

## Sheet Structure

- **Daily sheets (01-31)**: Cols B-N — Supplier, Invoice No, Received Amt, Payment Type, Prev Invoice, Payment Amt, Balance, Notes, Post, Status, Entered By, Timestamp, SYS_ID
- **InvoiceDatabase**: Central ledger with SUMIFS formulas for Total Paid, Balance Due, Status, Days Outstanding
- **PaymentLog**: Payment transaction history
- **AuditLog**: Complete audit trail
- **Settings**: Optional — UserResolver persistent cache

## Critical Gotchas

1. **Cache reads evaluated values** — never formula strings; InvoiceDatabase columns use SUMIFS
2. **Cache invalidation timing** — must happen AFTER writing to PaymentLog (SUMIFS recalculates first)
3. **Master mode requires installable trigger** — simple `onEdit` cannot call `SpreadsheetApp.openById()`; run `setupInstallableEditTrigger()` once per monthly file
4. **UserResolver not Session** — `Session.getActiveUser()` fails in trigger context; always use `UserResolver.getCurrentUser()`
5. **Date source** — daily sheet dates come from cell A3, fallback to current date
6. **Lock errors** — users may see "Unable to acquire lock" during concurrent edits; this is by design

## AI Guidelines

- **Never hardcode** sheet names or column indices — use `CONFIG`
- **Single read pattern** — read row once, pass `rowData` through the entire pipeline
- **Batch writes** — one `setValues()` call for multiple cells, never cell-by-cell
- **Cache-first** — use `CacheManager.getInvoiceData()` for invoice lookups
- **Always use `UserResolver`** for user identification
- **Audit everything** — log all state changes via `AuditLogger`
- **Validation in ValidationEngine** — add new rules there, not inline
- **Confirm before destructive batch ops** — add UI dialog

## Quick Reference

```
Find invoice:          InvoiceManager.findInvoice(supplier, invoiceNo)
Supplier balance:      BalanceCalculator.getSupplierOutstanding(supplier)
Payment history:       PaymentManager.getHistoryForInvoice(invoiceNo)
Check duplicate:       PaymentManager.isDuplicate(sysId)
Log action:            AuditLogger.log(action, data, message)
Validate:              validatePostData(data)
Clear invoice cache:   CacheManager.clear()
Partition stats:       CacheManager.getPartitionStats()
Current user:          UserResolver.getCurrentUser()
Acquire lock:          LockManager.acquireDocumentLock(timeout)

Master DB setup:       setupInstallableEditTrigger()   ← run once per monthly file
Test connection:       testMasterDatabaseConnection()
Generate formulas:     generateImportRangeFormulas()
Run benchmarks:        runAllBenchmarks()
```
