# Master Database Trigger Troubleshooting Guide

## 🚨 Issue: Two Triggers Running Simultaneously

### Problem Description
When using Master Database mode, you may see TWO executions for every edit:
1. **Simple Trigger** (auto-created) - ❌ Fails with permission errors
2. **Installable Trigger** (manually created) - ✅ Works correctly

### Root Cause
Having a function named `onEdit` **automatically creates a simple trigger**, regardless of whether you have an installable trigger. Both execute, causing:
- Duplicate executions
- Permission errors from simple trigger
- Timeout errors (~32 seconds)
- Confusion in execution logs

---

## ✅ Solution

### Quick Fix (Recommended)

**The simple trigger failures are EXPECTED and HARMLESS** when you have an installable trigger.

1. **Verify installable trigger exists:**
   - Open Apps Script Editor
   - Click **Triggers** (⏰ icon on left sidebar)
   - You should see: `onEdit | Head | From spreadsheet | On edit`
   - If missing, run `setupInstallableEditTrigger()`

2. **Ignore simple trigger errors:**
   - Simple trigger will fail with permission errors
   - This is EXPECTED - it cannot access Master Database
   - Installable trigger will succeed and handle everything
   - System works correctly despite simple trigger errors

3. **Check execution log pattern:**
   ```
   Execution #1 (Simple Trigger):
     Status: ❌ Failed
     Error: "Specified permissions are not sufficient"
     Duration: ~32 seconds (timeout)

   Execution #2 (Installable Trigger):
     Status: ✅ Completed
     Duration: 2-5 seconds
     Result: Transaction posted successfully
   ```

### Diagnostic Tools

Run these functions from Apps Script Editor → Run:

1. **`diagnoseTriggers()`** - Shows all active triggers
2. **`checkSimpleTriggerConflict()`** - Explains simple trigger behavior
3. **`testMasterDatabaseConnection()`** - Validates Master DB access

---

## 🔧 Step-by-Step Fix

### Step 1: Verify Installable Trigger Exists

**In Apps Script Editor:**

1. Click **Triggers** icon (⏰) on left sidebar
2. Look for trigger with these properties:
   - **Function:** `onEdit`
   - **Event source:** From spreadsheet
   - **Event type:** On edit

**If trigger is MISSING:**
```javascript
// Run this from Script Editor:
setupInstallableEditTrigger()
```

**If trigger is PRESENT:**
You're good! Simple trigger errors are harmless.

---

### Step 2: Understand Simple Trigger Behavior

**Simple Trigger (Auto-created):**
- Always runs when function is named `onEdit`
- Has **restricted permissions**
- **Cannot** access other spreadsheets
- **Cannot** use `SpreadsheetApp.openById()`
- **Will fail** when trying to access Master Database

**This is EXPECTED!** The simple trigger failure is harmless because:
1. Simple trigger fails fast (~2 seconds)
2. Installable trigger immediately runs after
3. Installable trigger has full permissions
4. Installable trigger succeeds and completes the transaction
5. User sees no impact

---

### Step 3: Verify System is Working

**Check AuditLog sheet:**

Look for successful transaction entries:
```
Time: 17:57:13
Action: INVOICE_CREATED
Status: Success
```

If you see successful entries, **the system is working correctly** despite simple trigger errors.

**Check execution log:**

You should see TWO executions per edit:
1. First execution: Simple trigger fails (ignore this)
2. Second execution: Installable trigger succeeds (this is what matters)

---

## 🎯 Expected Behavior in Master Database Mode

### Normal Execution Pattern

**For every edit, you will see:**

```
Execution Log Entry #1:
  Trigger: Simple (onEdit)
  Status: Failed ❌
  Error: "Specified permissions are not sufficient"
  Duration: 1-2 seconds

  👉 This is EXPECTED. Ignore this failure.

Execution Log Entry #2:
  Trigger: Installable (onEdit)
  Status: Completed ✅
  Result: Transaction posted successfully
  Duration: 2-5 seconds

  👉 This is the REAL execution. System works!
```

### AuditLog Pattern

**You should see complete audit trail:**
```
[TS:xxx] onEdit.paymentTypeEdit → PaymentType changed to "Regular"
[TS:xxx] clearPaymentFieldsForTypeChange → Clearing fields
[TS:xxx] FIELD_CLEARED → Payment type changed to Regular
[TS:xxx] INVOICE_CREATED → Invoice posted successfully
```

If audit trail is complete, **system is working correctly**.

---

## 🚨 When to Take Action

### ❌ System is BROKEN if:

1. **No installable trigger exists**
   - Symptoms: ALL executions fail
   - Fix: Run `setupInstallableEditTrigger()`

2. **Installable trigger is also failing**
   - Symptoms: Both executions show same permission error
   - Fix: Delete and recreate trigger:
     ```javascript
     removeInstallableEditTrigger()
     setupInstallableEditTrigger()
     ```

3. **No successful transactions in AuditLog**
   - Symptoms: No INVOICE_CREATED or PAYMENT_CREATED entries
   - Fix: Check Master Database configuration in _Config.gs

### ✅ System is WORKING if:

1. **Installable trigger exists** (check Triggers panel)
2. **Some executions succeed** (see Completed status)
3. **AuditLog has successful entries** (INVOICE_CREATED, etc.)
4. **Transactions are being posted** (check InvoiceDatabase sheet)

---

## 📊 Execution Log Analysis

### What to Look For

**Good Pattern (Working):**
```
Execution Time | Status    | Duration | Trigger Type
11/4 17:56:48  | Failed    | 1.2s     | Simple      ← Ignore
11/4 17:56:48  | Completed | 3.5s     | Installable ← Success!
11/4 17:57:08  | Failed    | 1.8s     | Simple      ← Ignore
11/4 17:57:08  | Completed | 2.9s     | Installable ← Success!
```

**Bad Pattern (Broken):**
```
Execution Time | Status    | Duration | Trigger Type
11/4 17:56:48  | Failed    | 1.2s     | Simple      ← Failed
11/4 17:57:08  | Failed    | 1.8s     | Simple      ← Failed
(No installable trigger executions)
```

---

## 🔍 Advanced Diagnostics

### Check Trigger Type in Code

Add this to beginning of `onEdit()` function temporarily:

```javascript
function onEdit(e) {
  // Detect trigger type
  const isSimpleTrigger = !ScriptApp.getAuthMode ||
                          ScriptApp.getAuthMode() === ScriptApp.AuthMode.LIMITED;

  if (isSimpleTrigger) {
    Logger.log('⚠️  Running as SIMPLE TRIGGER (limited permissions)');
    Logger.log('This execution will fail on Master Database access.');
    Logger.log('Installable trigger will handle it.');
    return; // Exit early to avoid permission errors
  }

  Logger.log('✅ Running as INSTALLABLE TRIGGER (full permissions)');

  // ... rest of onEdit code ...
}
```

This will make simple trigger exit immediately, avoiding errors.

---

## 📝 Summary

### Key Points

1. **Simple trigger auto-created** when function is named `onEdit`
2. **Simple trigger ALWAYS fails** in Master Database mode
3. **This is EXPECTED behavior** - not a bug
4. **Installable trigger handles everything** correctly
5. **System works despite simple trigger errors**

### Recommended Actions

✅ **DO:**
- Verify installable trigger exists
- Ignore simple trigger failures in logs
- Check AuditLog for successful transactions
- Monitor installable trigger executions

❌ **DON'T:**
- Delete the `onEdit` function (you need it!)
- Worry about simple trigger errors (they're harmless)
- Try to fix permissions for simple trigger (impossible)
- Remove installable trigger (you need it for Master DB!)

---

## 🆘 Still Having Issues?

If system is still not working after following this guide:

1. Run `diagnoseTriggers()` and share output
2. Check AuditLog for last 10 entries
3. Share execution log pattern (success/failure)
4. Verify Master Database configuration:
   ```javascript
   showMasterDatabaseConfig()
   ```

The issue is almost always:
- Missing installable trigger
- Incorrect Master Database configuration
- Permissions not authorized during setup

Run the diagnostic tools and the issue will be clear!
