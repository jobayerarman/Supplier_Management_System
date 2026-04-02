# Common Tasks

## Add a New Payment Type

1. Add to `CONFIG.rules.SUPPORTED_PAYMENT_TYPES` in [_Config.gs](_Config.gs)
2. Add validation case in `validatePaymentTypeRules(data)` in [ValidationEngine.gs](ValidationEngine.gs)
3. Update `_calculateTransactionImpact()` in [BalanceCalculator.gs](BalanceCalculator.gs)
4. Add case in `onEdit` payment type handler in [Code.gs](Code.gs)

## Add a New Batch Operation

1. Add menu item in `onOpen()` in [UIMenu.gs](UIMenu.gs)
2. Create handler following `batch*` / `*AllRows` naming pattern
3. Use `validateRowsInSheet()` or `postRowsInSheet()` as template
4. Call `showValidationResults()` to display outcome
5. Add confirmation dialog for any destructive operation

## Add New Validation Rules

1. Add to `validatePostData()` or create a new validator in [ValidationEngine.gs](ValidationEngine.gs)
2. Return `{ valid: false, error: "message" }` format
3. Errors auto-display via `setBatchPostStatus()`

## Debug User Identification Issues

1. Check UserResolver fallback chain in [_UserResolver.gs](_UserResolver.gs)
2. Run `testUserResolver()` from Script Editor → check Logger output
3. Use `UserResolver.getUserWithMetadata()` to see which detection method fired
4. Use menu: 📋FP → 👤 User Settings → Show User Info
5. If Session fails in trigger context, ensure installable trigger is set up (see [master_database.md](master_database.md))

## Debug Balance Issues

1. Check cache freshness: inspect `CacheManager.timestamp`
2. Verify cache holds evaluated values, not formula strings — see [caching_architecture.md](caching_architecture.md)
3. Compare preview vs actual: `BalanceCalculator.validatePreviewAccuracy(data)`
4. Check AuditLog sheet for calculation warnings

## Debug Cache Issues

1. `CacheManager.getPartitionStats()` — check active/inactive distribution
2. `CacheManager.clear()` — force full reload on next access
3. Ensure cache invalidation happens **after** PaymentLog write (SUMIFS must recalculate first)
4. In master mode, verify `getTargetSheet()` is used for cache loads (not `getSourceSheet()`)
