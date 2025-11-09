# Changelog

All notable changes to the Supplier Management System project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - 2025-11-09

### Added
- Comprehensive unit tests for InvoiceManager module (aacb3cd)
- Test suite standardization with isolated benchmarks (e32a243)
- Full InvoiceManager test coverage including edge cases

### Changed
- Standardized test file naming convention (f7400a2)
- Separated test and benchmark functions into dedicated files (2914286)
- Refactored BalanceCalculator to consolidate constants and remove legacy code (973b741)
- Removed legacy backward compatibility functions from BalanceCalculator (567e2ba)
- Consolidated duplicate constants to CONFIG.constants (5a97a76)

### Refactored
- BalanceCalculator Phase 3: Added result builders and internal payment config (ee0a44b)
- BalanceCalculator Phase 2: Extracted helper functions for improved clarity (61612e1)
- BalanceCalculator Phase 1: Added constants, JSDoc, and section organization (439b3db)
- PaymentManager code clarity and maintainability improvements (6d09516)

### Removed
- Obsolete migration and troubleshooting files (24df777)
- Temporary refactoring documentation files (27d6c15)

### Fixed
- Corrected payment ID format in test mocks to match real system (b8587cb)

### Other
- Synced codebase from manual App Script changes to GitHub (d087593)

---

## [1.3.0] - 2025-11-06

### Added
- Comprehensive JSDoc type definitions for PaymentManager (06345ee)
- Installable trigger setup for Master Database access (ccba1ad)
- Comprehensive logging to Due payment workflow (320e11e)
- OAuth scopes for Master Database cross-file access (f4bdcb2)
- Batch operations performance testing (f03dfbb)

### Changed
- PaymentManager function renaming for clarity (64c4ad6)
- PaymentManager function reorganization by relevance (18872c3)
- Function typedefs moved inline for better encapsulation (18872c3)
- Improved Master Database awareness in batch operations (f03dfbb)
- Code clarity and maintainability improvements across modules

### Refactored
- PaymentManager: Extracted processOptimized helpers (1df2ce5)
- PaymentManager: Implemented _withLock wrapper for standardized lock management (ffa097d)
- PaymentManager: Extracted immutable result builders (5733f10)
- PaymentManager: Split _updateInvoicePaidDate into helper functions (0a9e5e8)
- PaymentManager: Extracted _queryPayments template function (97b98d1)
- PaymentManager: Replaced magic numbers with named constants (c8029c0)
- PaymentManager: Extracted _buildPaymentObject mapper (e228759)
- PaymentCache: Extracted _addToIndex helper function (cbb599a)
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

## [1.2.0] - 2025-11-05

### Added
- **Master Database Support**: Centralized Master Database architecture for multi-file invoice management (38a9c9c)
  - Support for both local and master connection modes
  - IMPORTRANGE formula generation and integration
  - Cross-file access via installable triggers
  - Master Database utilities for transparent switching
- Conditional cache strategy based on connection mode (8753d34)
- Partition-aware cache implementation (6b6a091)
- Cache partitioning (active vs inactive invoices) for 70-90% performance improvement (e1b7f27)
- Master Database test suite (MasterDatabaseTests.gs) (240d3cf onwards)

### Changed
- Simplified CacheManager to partition-only architecture (51d69a2)
- Reorganized invoice columns to match payment structure (e99ba14)
- Refactored UI menu operations with Master DB awareness (fc6ae67)

### Refactored
- Separated simple trigger from installable trigger for Master Database mode (d3dcca1)
- Added comprehensive audit logging to clearPaymentFieldsForTypeChange (56ac140)
- Production cleanup - removed debug logs from core modules (Part 2) (e692087)
- Production cleanup - removed debug logs from Code.gs and InvoiceManager.gs (d6c9764)
- Eliminated redundant balance logic using BalanceCalculator.calculate() (913ac39)
- Updated legacy sheet access to use MasterDatabaseUtils (768e36a)

### Fixed
- Corrected case sensitivity in getUnpaidForSupplier status check (5ad2d4d)
- Prevented corrupted cache state in invalidateSupplierCache (aa7d03d)
- Prevented dropdown clearing by reordering operations (e95b89e)
- Updated InvoiceManager to use partition-aware cache (critical bug fix) (6b6a091)

### Performance
- Implemented Phase 1 and Phase 2 performance optimizations (df14ac7)
- Optimized balance calculation with in-memory computation (6b376d8)
- Implemented conditional cache strategy based on connection mode (8753d34)

### Documentation
- Created comprehensive README documentation (468466f)
- Updated CLAUDE.md with Master Database architecture (extensive updates)
- Added Master Database setup instructions

### Testing
- Added Master Database connection and write tests (MasterDatabaseTests.gs)
- Tested cache functionality with Master DB (testMasterDatabaseCaching)

---

## [1.1.0] - 2025-10-28

### Added
- **PaymentCache**: Quad-index caching system for 170x faster payment queries (d2f504a)
  - Invoice index for O(1) lookups by invoice number
  - Supplier index for O(1) supplier-based queries
  - Combined index for O(1) composite lookups
  - Payment ID index for O(1) duplicate detection
- Payment ID index for O(1) duplicate detection (0495876)
- Comprehensive performance benchmark suite (PerformanceBenchmarks.gs) (13a7446)
- Incremental cache updates for 250x performance improvement (ec306c6)
- Custom menu system for batch operations (7850e60, 1fe93ec)
- Batch validation and posting capabilities
- UIMenu module for comprehensive UI operations
- Central performance testing framework (618d739, 3d4a9e0)
- Performance testing suite with CentralizedPerformanceTests (3d4a9e0)

### Changed
- Transformed PaymentManager from O(n) to O(1) scalability (bfd1706)
- Reorganized PaymentManager functions by relevance (various)
- Improved code clarity and maintainability across modules
- Optimized lock scope for 75% reduction in lock duration (23635e0)
- Consolidated InvoiceCache into CacheManager.gs module (039e0e6, f98bef9)

### Refactored
- Refactored BalanceCalculator.gs with improved organization and JSDoc (439b3db onwards)
- Removed unused _calculateBalance() function (de7d369)
- Removed backward compatibility wrappers and legacy code
- Optimized processPostedRowWithLock with batched writes (ba72583)
- Separated test and benchmark functions into dedicated files
- Consolidated business logic and performance testing frameworks

### Fixed
- Fixed incorrect constant name reference in UIMenu (c998153)
- Fixed UIMenu checkbox logic for successful posts (5e4e25c)
- Eliminated redundant cache updates in PaymentManager (3f8f421)
- Fixed buildUnpaidDropdown() API call optimization (9d858c7, cc7d80c)
- Fixed payment processing to avoid redundant date reads (a8b5cc6)
- Fixed lock acquisition strategy for better concurrency (a094e05)
- Fixed shouldRecordPayment visibility and logic
- Fixed validation errors in batch operations

### Performance
- **75% reduction** in lock scope duration (100-200ms → 20-50ms) (23635e0)
- **170x faster** payment queries (340ms → 2ms) (d2f504a)
- **340x faster** duplicate detection (<1ms) (0495876)
- **250x faster** incremental cache updates (1ms vs 500ms) (ec306c6)
- **30-50% fewer** API calls for buildUnpaidDropdown (9d858c7)
- **200-450ms improvement** in POST workflow (4500369)
- **Immediate UI feedback** with PROCESSING status (17c2072)
- **70-90% reduction** in active cache size via partitioning (e1b7f27)

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
- **API Call Reduction**: 87.5% (8+ calls → 1 call per edit)
- **Lock Duration**: 75% reduction (100-200ms → 20-50ms)
- **Payment Queries**: 170x faster (340ms → 2ms)
- **Duplicate Detection**: 340x faster (340ms → <1ms)
- **Cache Updates**: 250x faster for incremental updates (1ms vs 500ms)
- **Active Cache Size**: 70-90% smaller via partitioning
- **POST Workflow**: 200-450ms improvement

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

- **October 4**: Initial project setup and foundational architecture
- **October 5-9**: Module consolidation and refactoring
- **October 9-28**: Performance optimization and caching system
- **October 28 - November 5**: Master Database implementation
- **November 5-6**: UI menu and batch operations
- **November 6-9**: Code quality, testing, and documentation

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

**Last Updated**: November 9, 2025
**Maintained By**: Development Team
**Repository**: jobayerarman/Supplier_Management_System
