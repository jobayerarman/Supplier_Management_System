# Testing

## Running Tests

All tests run from **Script Editor → Functions dropdown → Select function → Run ▶️ → View Logs**.

There is no CLI test runner — this is Google Apps Script.

## Unit Tests

| Function | File | Tests |
|----------|------|-------|
| `testUserResolver()` | [_UserResolver.gs](_UserResolver.gs) | User identification fallback chain |

## Integration Tests

See [Test.Integration.gs](Test.Integration.gs), [Test.InvoiceManager.gs](Test.InvoiceManager.gs), [Test.PaymentManager.gs](Test.PaymentManager.gs), [Test.CacheManager.gs](Test.CacheManager.gs), [Test.Triggers.gs](Test.Triggers.gs).

## Master Database Tests ([Test.MasterDatabase.gs](Test.MasterDatabase.gs))

- `testMasterDatabaseConnection()` — config + sheet accessibility check
- `testMasterDatabaseWrites()` — **creates real test data in Master DB**
- `generateImportRangeFormulas()` — outputs ready-to-paste IMPORTRANGE formulas
- `showMasterDatabaseConfig()` — displays current configuration
- `testMasterDatabaseCaching()` — verifies cache performance in master mode

## Performance Benchmarks ([Benchmark.Performance.gs](Benchmark.Performance.gs))

- `runAllBenchmarks()` — full suite (~5-10 seconds)
- `runQuickBenchmark()` — essential tests only (~2-3 seconds)
- `testCacheMemory()` — memory analysis only

Expected results:
- Cache load: 200-400ms (local), 300-600ms (master) — one-time per TTL
- Query operations: 1-3ms (O(1))
- Duplicate detection: <1ms (O(1))

## Manual Testing Checklist

- [ ] All 4 payment types post successfully (Unpaid, Regular, Partial, Due)
- [ ] Balances calculate correctly after each payment type
- [ ] Cache stays synchronized after payments (check InvoiceDatabase values)
- [ ] Duplicate invoices blocked
- [ ] Validation errors display in Status column
- [ ] Audit trail captures all operations in AuditLog
- [ ] Concurrent posts don't create duplicates (lock test)
- [ ] Batch operations handle row-level errors without stopping
- [ ] User identification works in shared environment (trigger + menu contexts)
- [ ] Custom menu appears on spreadsheet open
- [ ] Master mode: writes go to Master DB, reads come from local IMPORTRANGE
