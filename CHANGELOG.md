# Changelog

All notable changes to the Supplier Management System project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.4.0] - 2026-04-23

### 2026-04-23
#### Fixed
- `755f9a8` Stale balance in batch posting — in-memory resolution across all payment types (Unpaid, Due, Regular, Partial)

### 2026-04-22
#### Fixed
- `e861bac` Flush before balance read in `_runPaidDatePass`
- `67bd26a` Set `invoiceRow` before `processPayment` to guarantee paidDate push

### 2026-04-21
#### Added
- `a983018` Extract `UIMenuBatchPosting` sub-module from `UIMenu.gs`
- `fa26ad6` Extract `UIMenuSheetManager` sub-module from `UIMenu.gs`
- `7db3766` Add `UIUtils` shared toast + confirmOperation helpers

#### Fixed
- `a28b3ba` Route unexpected `paymentType` through balance-check in `_runPaidDatePass`
- `689ef8c` Correct `setConfig`/`getConfig` to use `RESOLVER_CONFIG`
- `35e8868` Post-review fixes from UIMenu modularization

#### Performance
- `a3db09e` Batch paidDate writes in `_runPaidDatePass` — 2N API calls → O(1)

#### Refactored
- `6b98581` Slim `UIMenu` to thin facade; delegate batch/sheet logic to sub-modules
- `7c87d8d` Decompose `UserResolver.getCurrentUser` into phase helpers

### 2026-04-18
#### Added
- `eef3438` Post-flush sequence in `_handleRegularBatchPosting`; add `_markAllPendingAsFailed`, `_runPaidDatePass`, `_runBalancePass`
- `dd81021` `flushPendingRegularInvoices` in `InvoiceManager`
- `18a856e` Defer balance calculation post-flush; pass `invoiceRow` to `processPayment`
- `2d3f983` `flushPendingPaymentRows` in `PaymentManager`

#### Fixed
- `3d0d06c` Null-coalescing for paymentSheet fallback; pass `paymentDate` through pending checks

#### Performance
- `303af96` Defer payment write in batch mode
- `ab496ba` Defer steps 3–4 in batch mode; queue `pendingPaidDateChecks`
- `122d06c` Skip cache update in deferred batch mode

### 2026-04-14
#### Fixed
- `c610c62` Move accumulator arrays to top-level batch context
- `7548a65` Handle Unpaid rows in mixed batches

#### Performance
- `b61fe3f` Eliminate per-row API calls via deferred bulk writes

### 2026-04-09
#### Added
- `4d78a99` CacheService cross-execution persistence for active invoice partition

### 2026-04-08
#### Fixed
- `679d31c` Silence spurious write-through warning in PaymentCache
- `6b64937` Remove erroneous `formatTime` call on pre-formatted timestamp

#### Performance
- `52e2536` Eliminate dual-trigger overhead; fix col F formatting regression
- `0a2024e` Eliminate duplicate balance `setBackground` in batch post

#### Refactored
- `d665137` Consolidate PaymentCache into `CacheManager.gs`
- `606ce3a` Remove dead `testBalanceCalculation` call sites from Integration test
- Multiple CacheManager dead-code removals (`_logStatistics`, `getSupplierData`, dead partition fields, vestigial stats)
- Multiple BalanceCalculator dead-method removals (`getSupplierSummary`, `validatePreviewAccuracy`, `getSupplierOutstandingDetailed`)
- Multiple InvoiceManager cleanup commits (dead result builders, `_rowToInvoiceObject` extraction, formula delegation)

### 2026-04-07
#### Added
- `31e0fca` Unpaid batch fast-path — loop, flush, grid builders, backgrounds
- `6f13eb9` Detect all-Unpaid batch and branch to fast-path
- `5ffadaf` Deferred-write mode for `createInvoice` + `flushPendingInvoiceRows`

#### Fixed
- `44912c5` Code review findings in UIMenu
- `be3cb4d` Release lock if `getTargetSheet` throws in `_initUnpaidBatchContext`

### 2026-04-05
#### Fixed
- `c47f9b5` Read-back verification for Due payment paidDate writes
- `9e3224f` Record `invoiceId` for Due payments; simplify payment gating
- `b07cc94` Correct stale `globalIndexMap.index` after partition transition
- `52a6e1a` Null-coalescing guard in `_toast` to preserve `duration=0`

#### Performance
- `7f6982e` Eliminate lock churn; fix post-payment balance overcounting
- `66a3e31` Eliminate dead API calls in paymentType/supplier edit subchain

#### Refactored
- `354b3ae` Decompose `_handleBatchPosting` into 5 phase helpers
- `71c028b` Extract `_confirmOperation`; replace 11 inline dialog blocks
- `1a3b41c` Extract `_toast` helper; replace all toast chains
- `374618a` Restructure UI menu by frequency of use

### 2026-04-02
#### Added
- `1fd58b0` System Health Check menu item wired to `validateDataIntegrity`
- `b2f2965` `setBatchPostStatus()` configurable via CONFIG

#### Fixed
- `49466de` Correct post-payment balance; persist manual user identity across sessions
- `4b319a2` Allow dots and slashes in invoice numbers
- `255020c` `createInvoice` falls through to update on race-condition duplicate
- `9a81435` Prevent cache read before SUMIFS recalculates
- `476b44c` New invoices placed in correct ACTIVE partition
- `8a862f6` Wire `validateInvoiceNo` and `validateAmount` into `validatePostData`
- `ff8ae00` Correct `dataStartRow` to 7 throughout codebase

#### Performance
- `e506484` Reduce `batchPostSelectedRows` from 17s to ~5s in MASTER mode
- `6af4af9` Add early column guards and minimal batch reads to trigger handlers
- `05e6af3` Eliminate extra API call in `_handlePaymentTypeEdit`

### 2025-11-19
#### Fixed
- `9241629` Use paidDate parameter instead of reading from sheet
- `043cd0d` Format paid date in INVOICE_ALREADY_PAID audit log
- `e253362` Standardize invoice/payment date extraction to cell B3
- `e8993bb` Correct INVOICE_ALREADY_PAID paid date source; add validation

### 2025-11-12
#### Refactored
- `c455ed0` Rename `processOptimized()` → `createOrUpdateInvoice()` for clarity
- `9a05fc3` Remove unused `batchCreateInvoices()` and helpers
- Multiple InvoiceManager dead-code removals, JSDoc standardization, and semantic naming pass

## [2.3.0] - 2025-11-11

### Added
- **UserResolver v2.1 - Multi-Level Caching Architecture** (80e74fc, ef4d7db)
  - Execution-scoped cache for <0.01ms access time (Phase 1)
  - Parameter passing optimization to eliminate redundant calls (Phase 2)
  - Performance statistics tracking and monitoring
  - `clearExecutionCache()` for cache management
  - `getStatistics()` for performance metrics
  - `benchmarkUserResolver()` for performance validation
  - Comprehensive diagnostic tools via `diagnoseUserResolution()` (14a211f)
  - OAuth scope: `userinfo.email` for proper Session API access

- **UserResolver v2.0 - Context-Aware System** (d6f69c5)
  - Context-aware fallback chains (menu vs trigger contexts)
  - Session API caching with 1-hour TTL
  - Email validation (RFC 5322)
  - User prompt fallback in menu context
  - Detection metadata for debugging
  - Manual email override functionality

- **User Settings Menu** (d6f69c5, 14a211f)
  - "👤 User Settings" submenu in custom menu
  - Set My Email: Manual email override
  - Show User Info: View detection metadata
  - Clear User Cache: Force fresh detection
  - 🔍 Diagnose User Resolution: Self-service troubleshooting

- **Dynamic Progress Updates** (fe056e1)
  - `calculateProgressInterval()` adapts to batch size
  - Scales from 5-100 rows for optimal feedback
  - Initial toast notification for validation operations
  - Consistent UX across validation and posting

- **Helper Functions** (cc0a2fd)
  - `extractUsername(email)`: Extract username from email
  - `getUsernameOnly()`: Get current user's username for display

### Changed
- **Standardized enteredBy Storage** (412ea01)
  - UIMenu.gs and Code.gs now store full email addresses
  - Consistent user attribution across batch and individual posts
  - Display-only username extraction for UI
  - Improved audit trail consistency in shared environments

- **UserResolver Architecture** (d6f69c5)
  - Removed unreliable sheet-based detection
  - Replaced with robust Session API + user prompt fallback
  - Context-aware strategies optimize for execution mode
  - Detection metadata tracking

### Fixed
- **Critical Security Fix: Cache Race Condition** (cc0a2fd)
  - Added session token validation to prevent cache poisoning
  - Store and validate `Session.getTemporaryActiveUserKey()`
  - Clear cache on session mismatch
  - Prevents multi-user attribution bugs in shared environments

- **UserResolver getExecutionContext() Logic** (cc0a2fd)
  - Fixed dead code issue (authMode retrieved but not used)
  - Refactored to use authMode as primary detection method
  - More reliable context detection

- **Shared User Attribution Bug** (d6f69c5, 14a211f)
  - Fixed users appearing as `default@google.com` in shared spreadsheets
  - Added OAuth scope for proper Session API access
  - Comprehensive diagnostic tools for troubleshooting

- **Benchmark Calculation Logic** (b03e18f)
  - Fixed negative improvement percentage in `benchmarkUserResolver()`
  - Corrected formula: firstCallTime + (remainingCalls × 4ms)
  - Added detailed breakdown logging

### Performance
- **99.5% Performance Improvement in Batch Operations**
  - Before: 600-1000ms for 100-row batch (200 getCurrentUser() calls)
  - After Phase 1: 5-10ms (execution cache, 99% reduction)
  - After Phase 2: 4-5ms (parameter passing, additional savings)
  - Individual posts: 10-20ms → ~0.01ms for subsequent calls

- **Call Reduction in Batch Operations**
  - UIMenu.gs validate: 100 calls → 1 call (99% reduction)
  - UIMenu.gs post: 100 calls → 1 call (99% reduction)
  - Code.gs individual post: 2 calls → 1 call (50% reduction)

- **Cache Performance**
  - Execution cache hits: 99.5% hit rate
  - Access time: <0.01ms per hit
  - UserProperties cache: 3-5ms fallback
  - Session detection: 20-40ms (first call only)

### Refactored
- **Centralized Email Display Logic** (cc0a2fd)
  - Eliminated duplicate `.split("@")[0]` calls
  - Consistent helper function usage across codebase
  - Updated UIMenu.gs (3 locations) and Code.gs (1 location)

- **UserResolver Direct Usage** (e8cdaf1)
  - Replaced `getCurrentUserEmail()` wrapper with direct calls
  - More explicit code for better maintainability
  - Marked wrapper as deprecated

### Documentation
- **Comprehensive Documentation Updates**
  - Updated CLAUDE.md with UserResolver v2.1 section (938ae2b)
  - Multi-level cache strategy documentation
  - Performance impact metrics (99.5% improvement)
  - New functions documented with examples
  - Security features explained
  - Backward compatibility guarantees

### Deprecated
- `detectUserFromSheetEdit()` - No longer functional (UserResolver v2.0)
- `setCurrentUserEmail()` - Redirects to `setManualUserEmail()`
- `getCurrentUserEmail()` wrapper in _Utils.gs - Use `UserResolver.getCurrentUser()` directly

### Removed
- Temporary documentation files (076758d)
  - PERFORMANCE_ANALYSIS_UserResolver.md
  - TROUBLESHOOTING_USER_RESOLUTION.md
  - PR_DETAILS.md
- Temporary benchmark function `benchmarkUserResolverMinimal()` (938ae2b)
- Temporary PR summary file (4af1ac9)

### Testing
- `benchmarkUserResolver()`: 200-iteration performance validation
- Cache hit rate measurement and statistics
- Multi-user scenario testing in shared environments
- Context detection testing (menu, trigger, direct)

### Security
- Session token validation prevents cache poisoning
- Email validation (RFC 5322) before accepting user input
- TTL-based cache expiration (1-hour)
- Graceful degradation on security feature failures

### Backward Compatibility
- ✅ Zero breaking changes to public API
- ✅ Deprecated functions maintained for compatibility
- ✅ Optional parameters with safe defaults
- ✅ Existing code works without modification
- ✅ Automatic performance benefits

---

## [2.2.0] - 2025-11-09

### Added
- Comprehensive unit tests for InvoiceManager module (aacb3cd)
- Full InvoiceManager test coverage including edge cases
- Test suite standardization with isolated benchmarks (e32a243)

### Changed
- Standardized test file naming convention (f7400a2)
- Separated test and benchmark functions into dedicated files (2914286)
- Refactored BalanceCalculator to consolidate constants and remove legacy code (973b741)
- Removed legacy backward compatibility functions from BalanceCalculator (567e2ba)
- Consolidated duplicate constants to CONFIG.constants (5a97a76)

### Refactored
- **BalanceCalculator Refactoring Series (3-Phase)**:
  - Phase 3: Added result builders and internal payment config (ee0a44b)
  - Phase 2: Extracted helper functions for improved clarity (61612e1)
  - Phase 1: Added constants, JSDoc, and section organization (439b3db)
- PaymentManager code clarity and maintainability improvements (6d09516)

### Removed
- Obsolete migration and troubleshooting files (24df777)
- Temporary refactoring documentation files (27d6c15)

### Fixed
- Corrected payment ID format in test mocks to match real system (b8587cb)

### Other
- Synced codebase from manual App Script changes to GitHub (d087593)

---

## [2.1.0] - 2025-11-06

### Added
- Comprehensive JSDoc type definitions for PaymentManager (06345ee)
- Comprehensive logging to Due payment workflow (320e11e)
- Batch operations performance testing (f03dfbb)

### Changed
- **PaymentManager Refactoring Series (8 commits for clarity and maintainability)**:
  - Extracted processOptimized helpers (1df2ce5)
  - Implemented _withLock wrapper for standardized lock management (ffa097d)
  - Extracted immutable result builders (5733f10)
  - Split _updateInvoicePaidDate into helper functions (0a9e5e8)
  - Extracted _queryPayments template function (97b98d1)
  - Replaced magic numbers with named constants (c8029c0)
  - Extracted _buildPaymentObject mapper (e228759)
  - Function renaming for clarity (64c4ad6)
  - Function reorganization by relevance (18872c3)
- Function typedefs moved inline for better encapsulation (18872c3)
- Improved Master Database awareness in batch operations (f03dfbb)
- Code clarity and maintainability improvements across modules
- PaymentCache helper extraction: _addToIndex helper function (cbb599a)
- Updated UIMenu to use partition-aware cache (6b6a091)

### Fixed
- Made shouldRecordPayment a public function (4f47c2c)
- Prevented simple trigger from clearing dropdown and overwriting installable trigger output (76f14df)
- Prevented dropdown validation from clearing manual invoice input (933f167)
- Fixed Due payment dropdown clearing and amount reset issues (7553fa5)
- Added invoiceDate field to buildDataObject for proper date handling (497bc44)
- Corrected negative balance calculation for Due payments after posting (b8c5d5e)
- Cleared linked payment fields when source fields are deleted (3e0e01c)
- Fixed IMPORTRANGE stale data issues (1ee06c7)

### Performance
- Implemented 3 critical CacheManager optimizations for Master mode (c93cb39)
- Optimized batch operations with critical fixes and UX enhancements (fc6ae67)
- Optimized Master DB reads to use local IMPORTRANGE sheets (e6296c3)

### Documentation
- Added Phase 2 completion summary and accomplishments (8b339fe)
- Added Phase 1 completion summary and testing instructions (7906dd8)
- Added trigger diagnostic tools and comprehensive troubleshooting guide (4b31e2a)
- Updated documentation with Master Database awareness (e91d4f0)
- Updated CLAUDE.md with Conditional Cache Strategy (f67227d)

### Testing
- Added comprehensive test suite for PaymentManager before refactoring (35affca)
- Added comprehensive conditional cache strategy test (fe4b61e)
- Added batch operations performance test (130e6cc)
- Added comprehensive logging for debug purposes (80118ee, 56ac140)

---

## [2.0.0] - 2025-11-05

### ⚠️ BREAKING CHANGES

This is a **major architectural update** introducing support for centralized Master Database mode. The system now operates in two distinct modes with different capabilities and requirements:

- **Local Mode** (default): Traditional single-file operation (backward compatible)
- **Master Mode** (new): Centralized multi-file architecture with IMPORTRANGE integration

**Note**: Simple triggers (`onEdit`, `onOpen`) cannot access other spreadsheets. When using Master Database mode, you **MUST** set up an installable Edit trigger by running `setupInstallableEditTrigger()` in the target monthly file.

### Added
- **Master Database Architecture** (38a9c9c)
  - Centralized Master Database file (00_SUPPLIER_ACCOUNTS_DATABASE_MASTER)
  - Dual connection modes: `local` and `master` via CONFIG.masterDatabase.connectionMode
  - MasterDatabaseUtils for transparent mode switching
  - IMPORTRANGE formula generation and integration
  - Cross-file access via installable triggers (required for Master mode)
  - Master Database test suite (MasterDatabaseTests.gs)
  - Master Database configuration in _Config.gs
  - OAuth scopes for cross-file access (f4bdcb2)
  - Installable trigger setup functions (ccba1ad)

- **Conditional Cache Strategy** (8753d34, fe4b61e)
  - Reads from local sheets (IMPORTRANGE in Master mode)
  - Writes to Master Database (when in Master mode)
  - Optimized for both local and cross-file scenarios
  - Comprehensive cache strategy testing

- **Cache Partitioning** (e1b7f27, 51d69a2, 6b6a091)
  - Active partition: Unpaid/partially paid invoices (hot data, frequently accessed)
  - Inactive partition: Fully paid invoices (cold data, rarely accessed)
  - 70-90% reduction in active cache size
  - Automatic partition transitions based on payment status
  - Partition statistics tracking

### Changed
- **Simplified CacheManager to Partition-Only Architecture** (51d69a2)
  - Removed backward compatibility dual-partition support
  - Streamlined cache operations
  - Enhanced partition transition logic
  - Improved partition statistics

- **Reorganized Invoice Columns** (e99ba14)
  - Invoice columns restructured to match payment structure
  - Better alignment for cross-reference operations
  - Enhanced readability and consistency

- **Refactored UI Menu Operations** (fc6ae67)
  - Added Master Database awareness to batch operations
  - Phase 1-4A optimization and critical fixes
  - Enhanced UX with performance tracking

### Refactored
- **Production Cleanup - Debug Log Removal** (e692087, d6c9764)
  - Removed debug logs from core modules (Part 2)
  - Removed debug logs from Code.gs and InvoiceManager.gs
  - Cleaner production environment

- **Separated Simple Trigger from Installable Trigger** (d3dcca1)
  - Simple trigger (onEdit) for Local mode operations
  - Installable trigger for Master Database mode access
  - Prevents conflicts and unnecessary redundancy

- **Added Comprehensive Audit Logging** (56ac140)
  - Enhanced clearPaymentFieldsForTypeChange function
  - Better transaction tracking for Master mode operations
  - Audit trail includes connection mode context

- **Sheet Access Modernization** (768e36a)
  - Updated legacy sheet access to use MasterDatabaseUtils
  - Transparent routing between local and Master sheets
  - Consistent API across both modes

- **Balance Logic Optimization** (913ac39)
  - Eliminated redundant balance calculation code
  - Unified balance logic using BalanceCalculator.calculate()
  - Single source of truth for balance computations

### Fixed
- **Cache Synchronization Issues** (6b6a091 - critical bug fix)
  - Updated InvoiceManager to use partition-aware cache
  - Corrected case sensitivity in getUnpaidForSupplier (5ad2d4d)
  - Prevented corrupted cache state in invalidateSupplierCache (aa7d03d)

- **User Interface Issues** (e95b89e)
  - Prevented dropdown clearing by reordering operations
  - Better separation of form field dependencies

### Performance
- **Phase 1 & 2 Optimization** (df14ac7)
  - Implemented foundational performance improvements
  - Tested and validated in both connection modes

- **Balance Calculation Optimization** (6b376d8)
  - Optimized balance calculation with in-memory computation
  - Reduced cross-file latency impact

### Documentation
- **CLAUDE.md Master Database Architecture** (extensive updates)
  - Master Database configuration guide
  - Setup process (7 steps)
  - Testing functions reference
  - Read/Write pattern explanation
  - Performance characteristics (local vs Master mode)
  - Simple trigger limitations section
  - Troubleshooting guide

- **README Documentation** (468466f)
- **Master Database Setup Instructions**

### Testing
- **Master Database Test Suite** (MasterDatabaseTests.gs)
  - testMasterDatabaseConnection(): Full connectivity validation
  - testMasterDatabaseWrites(): Write operation validation
  - generateImportRangeFormulas(): Formula generation utility
  - showMasterDatabaseConfig(): Configuration display
  - testMasterDatabaseCaching(): Cache functionality validation

- **Conditional Cache Strategy Testing** (fe4b61e)
- **Batch Operations Performance Testing** (130e6cc)

### Known Limitations
- Simple triggers cannot access other spreadsheets - use installable triggers in Master mode
- IMPORTRANGE updates have slight timing delays - cache strategy compensates
- Master Database writes add 50-100ms latency vs local mode (acceptable tradeoff)
- Initial IMPORTRANGE grant requires one-time user authorization

---

## [1.3.0] - 2025-10-28

### Added
- **Batch Operations System**
  - Custom menu system for batch validation and posting (7850e60, 1fe93ec)
  - Batch validate all rows without posting
  - Batch post all valid rows with confirmation
  - Batch validate/post selected rows
  - Clear all post checkboxes functionality
  - UIMenu module for comprehensive UI operations (7850e60)
- Comprehensive performance benchmark suite (PerformanceBenchmarks.gs) (13a7446)
- Incremental cache updates for 250x performance improvement (ec306c6)
- Central performance testing framework (618d739)
- Performance testing suite with CentralizedPerformanceTests (3d4a9e0)

### Changed
- Consolidated InvoiceCache into CacheManager.gs module (039e0e6, f98bef9)
- Reorganized PaymentManager functions by relevance
- Improved code clarity and maintainability across modules
- Optimized lock scope for 75% reduction in lock duration (23635e0)
- Transformed PaymentManager from O(n) to O(1) scalability (bfd1706)

### Refactored
- **Optimized processPostedRowWithLock Function**:
  - Batched writes for 100-200ms improvement (ba72583)
  - Eliminated redundant date reads (a8b5cc6)
  - Fixed cache invalidation timing bug (9f21097)
  - Fixed lock acquisition strategy for 60-70% better concurrency (a094e05)
- Refactored BalanceCalculator.gs with improved organization and JSDoc
- Removed unused _calculateBalance() function (de7d369)
- Removed backward compatibility wrappers and legacy code
- Separated test and benchmark functions into dedicated files
- Consolidated business logic and performance testing frameworks

### Fixed
- Fixed incorrect constant name reference in UIMenu (c998153)
- Fixed UIMenu checkbox logic for successful posts (5e4e25c)
- Eliminated redundant cache updates in PaymentManager (3f8f421)
- Fixed buildUnpaidDropdown() API call optimization - 25-50% reduction (9d858c7, cc7d80c)
- Fixed validation errors in batch operations
- Fixed payment type handling with conditional data fetching (3ed775a)
- Fixed invoice lookups to use cached data (154f590)

### Performance
- **Lock Scope Optimization**: 75% reduction in lock duration (100-200ms → 20-50ms) (23635e0)
- **POST Workflow**: 200-450ms improvement per edit (4500369)
- **Immediate UI Feedback**: "PROCESSING..." status (17c2072)
- **API Calls**: 30-50% fewer calls for buildUnpaidDropdown (9d858c7)
- **Optimized Payment Type Handling**: Conditional data fetching (3ed775a)
- **User Identification**: Optimized via UserResolver (c4f23e2)

### Documentation
- Added comprehensive PaymentCache architecture documentation (599117c)
- Added CLAUDE.md context for AI assistants (21286d3)
- Added performance benchmark documentation
- Created comprehensive README documentation (e77bbaa)

### Testing
- Comprehensive PaymentManager performance benchmark suite (13a7446)
- Cache memory analysis and performance profiling
- CentralizedPerformanceTests with comprehensive test coverage (618d739)

---

## [1.2.0] - 2025-10-28

### Added
- **PaymentCache**: Quad-index caching system for 170x faster payment queries (d2f504a)
  - Invoice index for O(1) lookups by invoice number
  - Supplier index for O(1) supplier-based queries
  - Combined index for O(1) composite lookups
  - Payment ID index for O(1) duplicate detection (0495876)
- **Incremental Cache Updates** (ec306c6)
  - 250x faster single-row updates (1ms vs 500ms full reload)
  - Partition transition support (active ↔ inactive)
  - Automatic fallback to full reload on errors
  - Performance statistics tracking
- **Central Performance Testing Framework** (618d739, 3d4a9e0)
  - Comprehensive benchmark suite (PerformanceBenchmarks.gs)
  - CentralizedPerformanceTests with complete test coverage
  - Cache memory analysis and profiling
  - Scalability testing up to 50,000+ records

### Changed
- **Transformed PaymentManager from O(n) to O(1) scalability** (bfd1706)
  - Query performance independent of database size
  - Constant-time operation for all payment lookups
  - Index-based duplicate detection
- Reorganized PaymentManager functions by relevance and performance
- Improved code clarity and maintainability across modules
- Optimized lock scope for 75% reduction in lock duration (23635e0)
- Consolidated InvoiceCache into CacheManager.gs module (039e0e6, f98bef9)
- Updated onEdit handler to single API call per edit (86fcd41, c86162b)

### Refactored
- **Optimized Payment Processing** (23635e0, 3f8f421)
  - Moved locks inside payment recording (75% faster)
  - Eliminated redundant cache updates by passing cached data
  - Reduced lock duration from 100-200ms to 20-50ms
- Refactored BalanceCalculator.gs with improved organization and JSDoc
- Removed unused _calculateBalance() function (de7d369)
- Removed backward compatibility wrappers and legacy code
- Optimized processPostedRowWithLock with batched writes (ba72583)
- Separated test and benchmark functions into dedicated files
- Consolidated business logic and performance testing frameworks

### Fixed
- Fixed incorrect constant name reference in UIMenu (c998153)
- Fixed UIMenu checkbox logic for successful posts (5e4e25c)
- Eliminated redundant cache updates in PaymentManager (3f8f421)
- Fixed buildUnpaidDropdown() API call optimization - 25-50% reduction (9d858c7, cc7d80c)
- Fixed payment processing to avoid redundant date reads (a8b5cc6)
- Fixed lock acquisition strategy for better concurrency (a094e05)
- Fixed shouldRecordPayment visibility and logic
- Fixed validation errors in batch operations

### Performance
- **API Calls**: 87.5% reduction per edit (8+ calls → 1 call) (86fcd41, c86162b)
- **Lock Duration**: 75% reduction (100-200ms → 20-50ms) (23635e0)
- **Payment Queries**: 170x faster (340ms → 2ms) (d2f504a)
- **Duplicate Detection**: 340x faster (<1ms) (0495876)
- **Incremental Updates**: 250x faster (1ms vs 500ms) (ec306c6)
- **API Calls for Dropdowns**: 30-50% reduction (9d858c7)
- **POST Workflow**: 200-450ms improvement (4500369)
- **UI Feedback**: Immediate PROCESSING status (17c2072)
- **Cache Partitioning**: 70-90% reduction in active cache size (e1b7f27)

### Documentation
- Added comprehensive PaymentCache architecture documentation (599117c)
- Added performance benchmark documentation
- Added CLAUDE.md context for AI assistants (21286d3)
- Created comprehensive README documentation (e77bbaa)

### Testing
- Comprehensive PaymentManager performance benchmark suite (13a7446)
- Cache memory analysis and performance profiling
- CentralizedPerformanceTests with comprehensive test coverage (618d739)

---

## [1.1.0] - 2025-10-09

### Added
- **User Resolution System** (4783818)
  - Multi-level fallback chain for reliable user identification
  - Session-based and sheet-based detection
  - Configurable default email
  - Works in shared environments and trigger contexts
- **Central Cache Management** (039e0e6, f98bef9)
  - Consolidated InvoiceCache into CacheManager.gs
  - Unified cache management across modules
  - Supplier index for O(m) lookups
  - TTL-based cache expiration

### Changed
- Refactored Code.gs for improved organization (20e15e0, b43fa7b)
- Updated configuration structure for scalability (612910d)
- Replaced direct Session calls with UserResolver (c4f23e2)
- Improved balance calculation display logic

### Refactored
- Consolidated utilities into modules (20e15e0, 38006f1)
- Enhanced JSDoc documentation across codebase (2d37c8c)
- Improved error handling throughout
- Enhanced code maintainability and readability
- Removed legacy and unused functions (038780d)

### Fixed
- Fixed balance cell display with dynamic note logic (803f282)
- Fixed payment type reference for Due and Partial payments (046fdb6)
- Fixed balance calculation showing supplier outstanding (f8fbd05)
- Removed unused updateInvoiceOutstanding to prevent formula conflicts (a966bf0)
- Fixed dropdown population efficiency (3023fed)
- Added defensive checks in getSheet function (72434fa)
- Fixed duplicate invoice safeguards (a065470)
- Fixed payment type sorting order (a41b84f)
- Fixed post checkbox to remain checked after posting (71ec9ff)
- Fixed variable naming (sh → sheet) (13d2786)
- Fixed incorrect Audit Log message (66985e7)
- Added invoice-related date management (8e69360, 35a8eb8)

### Performance
- Optimized InvoiceManager with index-based lookups (a854000, a49fdb7)
- Optimized BalanceCalculator with cache utilization (5bcd607)
- Atomic invoice creation with 30-50% fewer writes (4aa3c8b)

### Documentation
- Added JSDoc and code comments throughout (2d37c8c)
- Added configuration documentation

---

## [1.1.1] - 2025-10-09

### Added
- **PaymentManager Performance Optimization** (bfd1706)
  - Complete transformation from O(n) to O(1) scalability
  - Query performance independent of database size
  - Maintains performance regardless of record count

### Performance
- Query time reduced from O(n) linear to O(1) constant
- Supports up to 50,000+ payment records (previously degraded at 10,000)
- Unlimited scalability for production use

---

## [1.1.2] - 2025-10-19

### Added
- **Lock Scope Optimization** (23635e0)
  - Moved locks inside critical sections
  - Reduced lock duration from 100-200ms to 20-50ms
  - 75% improvement in concurrent access

### Performance
- Lock duration: 75% reduction (100-200ms → 20-50ms)
- Better concurrency for high-activity scenarios

---

## [1.0.0] - 2025-10-04

### Added
- **Core Invoice Management**: Complete invoice creation and tracking system
  - Invoice CRUD operations with validation
  - Automatic invoice ID generation
  - Duplicate invoice prevention
  - Multi-status tracking (UNPAID, PARTIAL, PAID)
- **Payment Processing**: Comprehensive payment management
  - Multiple payment types support (Regular, Partial, Due)
  - Payment recording with automatic linking to invoices
  - Payment history tracking
  - Duplicate payment detection
- **Balance Calculations**: Real-time balance computation
  - Invoice-level balance calculations
  - Supplier-level outstanding balances
  - Transaction impact analysis
  - Preview balance calculations before posting
- **Modular Architecture** (405a26d)
  - _Config.gs: Centralized configuration with validation
  - _Utils.gs: Utility functions for strings, dates, sheets, ID generation, and locks
  - _UserResolver.gs: Reliable user identification with fallback chain
  - AuditLogger.gs: Comprehensive audit trail functionality
  - ValidationEngine.gs: Business rule validation
  - InvoiceManager.gs: Invoice operations
  - PaymentManager.gs: Payment operations
  - BalanceCalculator.gs: Balance calculations
  - Code.gs: Main entry point with onEdit handler
- **Validation System** (5b2eba3, 3381c5b, 72434fa)
  - Supplier and payment type validation
  - Amount validation with configurable limits
  - Payment type-specific business rules
  - Comprehensive error messages
- **Audit Logging**: Complete transaction audit trail
  - User identification and tracking
  - Action logging with timestamps
  - Error tracking and logging
  - Audit queries and filtering
- **User Resolution**: Reliable user identification (4783818)
  - Multi-level fallback chain for user detection
  - Session-based and sheet-based identification
  - Configurable defaults
- **Sheet Management**: Robust sheet access and operations
  - Safe sheet access with validation
  - Error handling for missing sheets
  - Dynamic column reference using indices
- **Concurrency Control**:
  - Document locks for posting operations
  - Script locks for invoice creation
  - Safe lock acquisition and release patterns
- **Data Entry Interface**:
  - Daily transaction sheets (01-31)
  - Real-time balance display
  - Status indicators
  - Post checkbox workflow
- **Balance Display Logic**:
  - Dynamic note generation based on balance
  - Status color coding
  - Outstanding balance tracking
- **Backup and Recovery**:
  - Duplicate invoice safeguards
  - Transaction rollback capabilities
  - Data consistency checks

### Changed
- **Terminology**: Standardized "commit" → "post" terminology throughout (acbc141, c19d0d0)
- Refactored Code.gs for improved organization and clarity (20e15e0, b43fa7b)
- Updated configuration structure for better scalability (612910d)

### Fixed
- Fixed balance cell display with dynamic note logic (803f282)
- Fixed payment type reference for Due and Partial payments (046fdb6)
- Fixed balance calculation showing supplier outstanding (f8fbd05)
- Removed unused updateSupplierOutstanding to prevent formula conflicts (a966bf0)
- Fixed dropdown population efficiency (3023fed)
- Added defensive checks in getSheet function (72434fa)
- Fixed duplicate invoice safeguards (a065470)
- Fixed payment type sorting order (a41b84f)
- Fixed post checkbox to remain checked after posting (71ec9ff)
- Fixed variable naming (sh → sheet) (13d2786)
- Fixed incorrect Audit Log message for supplier outstanding (66985e7)
- Added invoice-related date management functions (8e69360, 35a8eb8)
- Improved updateInvoiceOutstanding error handling (bcbfe4a, c263dd3)

### Performance
- Optimized onEdit handler for minimal API calls (86fcd41, c86162b)
  - Reduced from 8+ calls to 1 API call per edit
  - 87.5% reduction in API call volume
- Optimized payment type handling with conditional data fetching (3ed775a)
- Optimized invoice lookups to use cached data (154f590)
- Optimized user identification (c4f23e2)
- Reduced auditAction function calls for posting performance (9c9c59)
- Optimized InvoiceManager with index-based lookups (a854000, a49fdb7)
- Optimized BalanceCalculator with cache utilization (a49fdb7, 5bcd607)
- Atomic invoice creation with 30-50% fewer writes (4aa3c8b)

### Documentation
- Created comprehensive README documentation (468466f, e77bbaa)
- Added JSDoc and code comments for clarity (2d37c8c)
- Added configuration documentation
- Added troubleshooting guides

### Code Quality
- Removed legacy and unused functions (038780d, 2d37c8c)
- Consolidated utilities into modules (20e15e0, 38006f1)
- Improved error handling throughout
- Enhanced code maintainability and readability

---

## Summary of Key Metrics

### Performance Improvements
- **User Resolution (v2.3.0)**: 99.5% faster batch operations (600-1000ms → 4-5ms)
- **API Call Reduction**: 87.5% (8+ calls → 1 call per edit)
- **Lock Duration**: 75% reduction (100-200ms → 20-50ms)
- **Payment Queries**: 170x faster (340ms → 2ms)
- **Duplicate Detection**: 340x faster (340ms → <1ms)
- **Cache Updates**: 250x faster for incremental updates (1ms vs 500ms)
- **Active Cache Size**: 70-90% smaller via partitioning
- **POST Workflow**: 200-450ms improvement
- **UserResolver Calls**: 99% reduction in batch operations (200 calls → 2 calls)

### Scalability
- Transitioned from O(n) to O(1) constant-time operations
- Supports 50,000+ payment records (previously degraded at 10,000)
- Maintains performance regardless of database size
- Dual connection modes (local and Master Database)

### Code Quality
- 10+ modules with clear separation of concerns
- Comprehensive error handling and logging
- Full audit trail for all operations
- 100% Master Database integration
- Extensive test coverage

---

## Development Timeline

### Version Milestones

- **v1.0.0 (October 4)**: Initial project launch and foundational architecture
  - Core invoice and payment management
  - Modular architecture (10+ modules)
  - Audit logging and validation systems
  - 87.5% API call reduction

- **v1.1.0 - v1.1.2 (October 5-19)**: Module consolidation and optimization series
  - v1.1.0: User resolver and cache management
  - v1.1.1: PaymentManager O(n) → O(1) transformation (unlimited scalability)
  - v1.1.2: Lock scope optimization (75% reduction)

- **v1.2.0 (October 28)**: PaymentCache and incremental updates
  - PaymentCache quad-index (170x faster queries)
  - Incremental cache updates (250x faster)
  - Payment ID indexing (340x faster duplicate detection)
  - Comprehensive performance benchmarks

- **v1.3.0 (October 28)**: Batch operations system
  - Custom menu for batch validation/posting
  - Performance optimization and UX enhancements
  - Central testing framework

- **v2.0.0 (November 5)**: Master Database - MAJOR ARCHITECTURAL CHANGE
  - Dual operation modes (local and master)
  - Cross-file access via installable triggers
  - Cache partitioning (70-90% active cache reduction)
  - Conditional cache strategy
  - Master Database test suite

- **v2.1.0 (November 6)**: Post-Master DB integration and refactoring
  - Production cleanup (removed debug logs)
  - PaymentManager refactoring series (8-phase)
  - Enhanced batch operation integration
  - Improved code clarity

- **v2.2.0 (November 9)**: Code quality, testing, and documentation
  - Comprehensive unit tests (full InvoiceManager coverage)
  - BalanceCalculator 3-phase refactoring
  - Test standardization
  - Full documentation sync

- **v2.3.0 (November 11)**: UserResolver v2.1 - Performance & Security
  - Multi-level caching architecture (99.5% performance improvement)
  - Context-aware user resolution system
  - Critical security fixes (session token validation)
  - Comprehensive diagnostic tools
  - 15 commits with 100% conventional commit compliance

### Development Pace

- **Foundation Phase** (Oct 4): 1 day for core architecture
- **Optimization Phase** (Oct 5-28): 24 days of continuous performance improvements
- **Master Database Phase** (Oct 28 - Nov 5): 9 days for major architectural change
- **Refinement Phase** (Nov 5-9): 5 days for integration, testing, and documentation
- **UserResolver Optimization** (Nov 9-11): 2 days for v2.1 performance optimization and security hardening
- **Total Development**: 41 days from initial launch to production-ready with dual-mode support and optimized user resolution

---

## Notes for Contributors

- Always run performance benchmarks when making changes to critical paths
- Update CLAUDE.md when adding new features or modules
- Follow the established naming conventions (PascalCase for modules, camelCase for functions)
- Add comprehensive JSDoc comments for all public functions
- Update AuditLog with all significant operations
- Test in both Local and Master Database modes when applicable
- Use the batch operations menu for end-of-day processing
- Verify cache synchronization after payment operations

---

**Last Updated**: November 11, 2025
**Maintained By**: Development Team
**Repository**: jobayerarman/Supplier_Management_System
