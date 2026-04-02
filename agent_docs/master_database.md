# Master Database Architecture

## Two Operational Modes

**Local Mode (Default)** — each monthly file contains its own InvoiceDatabase, PaymentLog, AuditLog, SupplierList. All reads/writes stay within the monthly file. No extra config needed.

**Master Mode** — one central file (00_SUPPLIER_ACCOUNTS_DATABASE_MASTER) holds all databases. Monthly files use IMPORTRANGE to display data; Apps Script writes directly to Master. Enables cross-month queries and consolidated reporting.

Read/Write pattern in master mode: **reads from local IMPORTRANGE sheets** (fast, no cross-file latency), **writes to Master DB** (adds ~50-100ms per write).

## Configuration

In [_Config.gs](_Config.gs), set `CONFIG.masterDatabase`:
- `connectionMode: 'local'` or `'master'`
- `id`: Master DB spreadsheet ID (from URL)
- `url`: Full Master DB URL
- `sheets`: sheet name mappings (`invoice`, `payment`, `audit`, `supplier`)

Check current mode: `CONFIG.isMasterMode()`

## Setup Steps (Master Mode)

1. Create Master Database spreadsheet (00_SUPPLIER_ACCOUNTS_DATABASE_MASTER)
2. Copy sheet structures: InvoiceDatabase, PaymentLog, AuditLog, SupplierList
3. Set `connectionMode: 'master'` and fill `id`/`url` in [_Config.gs](_Config.gs)
4. Run `testMasterDatabaseConnection()` from Script Editor to validate
5. Run `generateImportRangeFormulas()` — copy output formulas into monthly file sheets
6. Grant IMPORTRANGE permissions when prompted by Google Sheets
7. **CRITICAL**: Run `setupInstallableEditTrigger()` once per monthly file (see below)

## Simple Trigger Limitation — CRITICAL

Simple triggers (`onEdit`, `onOpen`) **cannot call `SpreadsheetApp.openById()`** — they cannot access other files.

Master mode requires an **installable trigger**:
1. Open Script Editor in the monthly spreadsheet
2. Select `setupInstallableEditTrigger` from function dropdown → Run ▶️
3. Authorize OAuth when prompted
4. Verify: Script Editor → Triggers (⏰) → should show one Edit trigger for `onEdit`

To remove: run `removeInstallableEditTrigger()`

This is why `testMasterDatabaseWrites()` works (manual = full permissions) but `onEdit` posting fails (simple trigger = restricted).

## Key Utilities ([_Utils.gs](_Utils.gs) — MasterDatabaseUtils)

- `getSourceSheet(sheetType)` — **for reads**: always returns local sheet
- `getTargetSheet(sheetType)` — **for writes**: returns Master (master mode) or local (local mode)
- `buildImportFormula(sheetType)` — generates IMPORTRANGE formula
- `testConnection()` — validates Master DB setup

## Test Functions ([Test.MasterDatabase.gs](Test.MasterDatabase.gs))

- `testMasterDatabaseConnection()` — connectivity + sheet accessibility
- `testMasterDatabaseWrites()` — creates test data in Master DB (**WARNING: writes real data**)
- `generateImportRangeFormulas()` — ready-to-paste IMPORTRANGE formulas
- `showMasterDatabaseConfig()` — displays current config
- `testMasterDatabaseCaching()` — verifies cache performance with Master DB
