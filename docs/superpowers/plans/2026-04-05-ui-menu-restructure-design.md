# UI Menu Restructure Design

**Date:** 2026-04-05
**Status:** Approved

---

## Context

The current `📋 FP - Operations` menu feels scattered because items were added incrementally as features were built, without a cohesive organizing principle. Specifically:

- 4 batch operation items sit flat at the top with no clear grouping
- `Clear All Post Checkboxes` floats loosely after Reset Operations with no logical home
- `🗑️ Delete Daily Sheets` sits dangerously close to checkbox clearing with no grouping
- `System Health Check` is orphaned at the bottom
- Trigger setup/removal functions (`setupInstallableEditTrigger` / `removeInstallableEditTrigger`) exist in Code.gs but have no menu access at all

**Goal:** Reorganize the menu around **frequency of use** (daily → monthly → occasional → admin), with emoji consistency so related actions are instantly recognizable.

---

## Menu Structure

```
📋 FP - Operations
│
│  ── DAILY ──────────────────────────────────────────
├── ✅ Validate Selected Rows
├── 📤 Post Selected Rows
├── ─────────────────────────────
├── ✅ Batch Validate All Rows
├── 📤 Batch Post All Valid Rows
│
│  ── MONTHLY ─────────────────────────────────────────
├── 📅 Monthly Setup (submenu)
│   ├── 🗑️ Delete Daily Sheets (02-31)          ← step 1
│   ├── ─────────────────────────
│   ├── ☑️ Clear All Post Checkboxes             ← step 2a
│   ├── 🧹 Reset Current Sheet to Zero           ← step 2b
│   ├── ─────────────────────────
│   ├── 📄 Create All Daily Sheets (02-31)       ← step 3a
│   ├── 📄 Create Missing Sheets Only            ← step 3b
│   ├── ─────────────────────────
│   ├── 🗂️ Reorganize Sheets
│   └── 🔧 Fix Date Formulas Only
│
│  ── OCCASIONAL ──────────────────────────────────────
├── 🔄 Reset Operations (submenu)
│   ├── 🧹 Quick Reset Current Sheet
│   └── 🧹 Reset All Daily Sheets to Zero
│
│  ── RARE / ADMIN ────────────────────────────────────
├── ─────────────────────────────
├── ⚙️ System & Admin (submenu)
│   ├── 🏥 System Health Check
│   ├── ─────────────────────────
│   ├── ⚠️ Setup Installable Trigger
│   └── ⚠️ Remove Installable Trigger
│
└── 👤 User Settings (submenu)
    ├── 📧 Set My Email
    ├── ℹ️ Show User Info
    ├── 🗑️ Clear User Cache
    ├── ─────────────────────────
    └── 🔍 Diagnose User Resolution
```

---

## Emoji Convention

| Emoji | Meaning |
|---|---|
| ✅ | All validate actions |
| 📤 | All post actions |
| 📄 | All create-sheet actions |
| 🧹 | All reset-to-zero actions |
| 🗑️ | All delete/remove actions |
| ⚠️ | Dangerous trigger operations |
| ☑️ | Checkbox-specific clear |

---

## Monthly Workflow

The Monthly Setup submenu is ordered to mirror the actual monthly cycle:

1. Duplicate the monthly file and rename it (done outside the script)
2. **🗑️ Delete Daily Sheets (02-31)** — clears sheets from the previous month's template
3. **☑️ Clear All Post Checkboxes** — cleans sheet 01 checkboxes
4. **🧹 Reset Current Sheet to Zero** — clears sheet 01 input cells (navigate to sheet 01 first)
5. Update the date on sheet 01 to the 1st of the current month (done manually in the cell)
6. **📄 Create All Daily Sheets (02-31)** or **📄 Create Missing Sheets Only** — generate daily sheets from the template

---

## What Changes From Today

| Current | New |
|---|---|
| 4 batch ops flat at top, no grouping | Selected ops first (daily priority), batch ops below separator |
| `Clear All Post Checkboxes` floating after Reset submenu | Moved to Monthly Setup → step 2a |
| `🗑️ Delete Daily Sheets` floating next to checkboxes | Moved to Monthly Setup → step 1 |
| Monthly Setup submenu named `📝 Daily Sheets` | Renamed `📅 Monthly Setup`, items ordered by workflow |
| `Reset Current Sheet to Zero` in Reset Operations | Moved to Monthly Setup → step 2b |
| Reset Operations had 3 items | Slimmed to 2: Quick Reset + Reset All |
| No trigger setup/removal in menu | Added to `⚙️ System & Admin` with warning dialogs |
| `System Health Check` orphaned at bottom | Moved into `⚙️ System & Admin` |
| No emojis on most items | Every item has an emoji; related actions share emoji |

---

## Implementation Scope

### Files to Modify

**[UIMenu.gs](../../UIMenu.gs)** — `createMenus()` function only (lines 296–336)
- Rewrite the `.addItem` / `.addSubMenu` chain to match the new structure
- No logic changes — purely structural

**[Code.gs](../../Code.gs)** — Add 2 new global handler functions
- `setupInstallableTriggerWithConfirmation()` — shows warning dialog, then calls `setupInstallableEditTrigger()`
- `removeInstallableTriggerWithConfirmation()` — shows warning dialog, then calls `removeInstallableEditTrigger()`

### Warning Dialog Behavior

Both trigger functions display a `YES_NO` dialog before executing:

```
Setup: "This will install an edit trigger required for Master Database mode.
        Only run this once per monthly file. Continue?"

Remove: "This will remove the installable edit trigger.
         The spreadsheet will fall back to the simple onEdit trigger.
         Master Database writes will stop working. Continue?"
```

If the user selects NO, the function exits without taking action.

### No Logic Changes

All existing function implementations remain unchanged. This is a pure menu restructure plus 2 thin wrapper functions.

---

## Verification

1. Open the spreadsheet — the `📋 FP - Operations` menu appears with new structure
2. Daily ops (✅ / 📤) are immediately visible at the top
3. Open `📅 Monthly Setup` — items appear in workflow order with correct emojis
4. Open `🔄 Reset Operations` — only Quick Reset and Reset All remain
5. Open `⚙️ System & Admin` — System Health Check appears, trigger items show warning dialogs before executing
6. Open `👤 User Settings` — all 4 user items present
7. Run `✅ Validate Selected Rows` and `📤 Post Selected Rows` — confirm they work as before
8. Run `🏥 System Health Check` — confirms wiring to `MenuRunDataIntegrityCheck`
9. Click `⚠️ Setup Installable Trigger` → dialog appears → click NO → nothing happens
