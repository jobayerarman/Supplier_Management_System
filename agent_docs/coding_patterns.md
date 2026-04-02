# Coding Patterns & Conventions

## Naming Conventions

- **Modules**: PascalCase objects — `InvoiceManager`, `AuditLogger`, `UserResolver`
- **Functions**: camelCase — `processPayment`, `getCurrentUser`
- **Private methods**: underscore prefix — `_recordPayment`, `_calculateTransactionImpact`
- **Constants**: SCREAMING_SNAKE_CASE inside `CONFIG`
- **UI functions**: descriptive camelCase — `batchPostAllRows`, `showValidationResults`

## Critical Patterns

### Single Read — pass row data through the pipeline; never re-read
See [Code.gs](Code.gs) `processPostedRowWithLock()` for the canonical example.

### Batch Write — one `setValues()` call for multiple cells
See [UIMenu.gs](UIMenu.gs) `setBatchPostStatus()`.

### Cache-First Lookups
```
CacheManager.getInvoiceData()  →  indexMap.get(`${supplier}|${invoiceNo}`)
```

### User Identification — always use UserResolver, never direct Session calls
```
UserResolver.getCurrentUser()        // simple usage
UserResolver.getUserWithMetadata()   // with debug info
```
Direct `Session.getActiveUser()` fails in trigger contexts.

### Batch Operation Pattern — read all rows once, process in memory, write targeted updates
See [UIMenu.gs](UIMenu.gs) `postRowsInSheet()`.

## Error Handling

- Wrap all operations in try-catch
- Log errors: `AuditLogger.logError(context, message)`
- User-facing errors via `setBatchPostStatus(sheet, row, msg, "SYSTEM", time, false, colors.error)`
- Cache failures must not block transactions (inconsistency > failure)
- Individual row failures in batch ops must not stop the entire batch

## Concurrency

- Document lock: `LockManager.acquireDocumentLock(timeout)` — for posting
- Script lock: `LockManager.acquireScriptLock(timeout)` — for invoice creation
- Always release in `finally` block
- Batch ops: acquire lock once for the entire batch

## Configuration

All sheet names, column indices, business rules, and colors live in `CONFIG` in [_Config.gs](_Config.gs). **Never hardcode these values.**

Key paths: `CONFIG.cols.supplier`, `CONFIG.invoiceSheet`, `CONFIG.rules.MAX_TRANSACTION_AMOUNT`, `CONFIG.colors.success`

Validate on init: `CONFIG.validate()`

## Backward Compatibility Wrappers

Legacy entry points redirect to module methods (see bottom of relevant .gs files). New code must call module methods directly, e.g. `InvoiceManager.createOrUpdateInvoice(data)` not `processInvoice(data)`.
