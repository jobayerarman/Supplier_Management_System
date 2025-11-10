# Troubleshooting: User Resolution Bug (default@google.com)

## Problem Description

**Symptom**: All shared users appear as `default@google.com` in audit logs instead of their actual Google account email.

**Affected Operations**:
- Individual posts via `Code.gs` (`processPostedRowWithLock()`)
- Batch operations via `UIMenu.gs` (batch post/validate)
- Any operation that records `enteredBy` field

**Expected**: System should detect actual user email (e.g., `john.doe@company.com`)
**Actual**: System falls back to `default@google.com`

---

## Root Causes

### Primary Cause: Missing Installable Edit Trigger

**Why This Happens**:
- By default, the system uses a **simple trigger** (`onEdit`)
- Simple triggers run with **limited permissions** (AuthMode.LIMITED)
- In this mode, `Session.getActiveUser()` returns empty string for shared users
- Only the script owner can be identified

**Solution**: Convert to **installable trigger** which runs with full permissions (AuthMode.FULL)

### Secondary Cause: User Authorization

Even with installable trigger, users must individually authorize the script to access their identity.

---

## Diagnostic Steps

### Step 1: Run Diagnostic Tool

1. Open the Google Sheet
2. Go to menu: **📋FP - Operations → 👤 User Settings → 🔍 Diagnose User Resolution**
3. Review the diagnostic report

**What to Look For**:
- ❌ "NO INSTALLABLE EDIT TRIGGER FOUND" → Follow Solution A
- ❌ "Session.getActiveUser() failing" → Follow Solution B
- ✅ "USER RESOLUTION WORKING CORRECTLY" → Issue is elsewhere

### Step 2: Check Authorization Status

The diagnostic will show:
```
1. AUTHORIZATION CONTEXT:
   Status: NOT_REQUIRED ✅  (Good - script is authorized)
   OR
   Status: REQUIRED ⚠️      (Bad - authorization needed)
```

### Step 3: Check Trigger Setup

The diagnostic will show:
```
7. TRIGGER SETUP:
   Edit triggers: 0  ⚠️ NO INSTALLABLE EDIT TRIGGER FOUND
   OR
   Edit triggers: 1  ✅ Installable trigger is set up
```

---

## Solution A: Set Up Installable Edit Trigger (Primary Fix)

### For Script Owner (One-Time Setup)

**⚠️ IMPORTANT**: Only the **script owner** can set up installable triggers.

1. **Open Script Editor**
   - In Google Sheets: Extensions → Apps Script

2. **Run Setup Function**
   - From function dropdown, select: `setupInstallableEditTrigger`
   - Click Run (▶️)
   - Authorize when prompted (review permissions and click Allow)

3. **Verify Success**
   - You should see alert: "✅ Installable Edit trigger has been set up successfully!"
   - The trigger is now active for ALL users

4. **Test**
   - Run: `diagnoseUserResolution()` again
   - Check that "Edit triggers: 1 ✅" appears

### What This Does

- Creates an installable trigger that calls `onEditInstallable()` instead of `onEdit()`
- Runs with **AuthMode.FULL** (full permissions)
- Can access `Session.getActiveUser()` for all authorized users
- Required for Master Database mode
- Required for reliable user identification in shared environments

### Technical Details

**Before**:
```
Simple Trigger → onEdit() → AuthMode.LIMITED → Session.getActiveUser() = empty
```

**After**:
```
Installable Trigger → onEditInstallable() → AuthMode.FULL → Session.getActiveUser() = actual email ✅
```

---

## Solution B: User Authorization (Per-User Setup)

If installable trigger is set up but specific users still see `default@google.com`:

### For Each Shared User

1. **User must trigger authorization**
   - Open the Google Sheet
   - Make an edit in any daily sheet (01-31) that triggers a post
   - OR run any function from Script Editor
   - OR use menu: 📋FP - Operations → 👤 User Settings → Show User Info

2. **Authorization Prompt**
   - User will see: "Authorization Required" dialog
   - Click "Continue"
   - Select Google account
   - Review permissions:
     - View and manage spreadsheets
     - Display and run third-party web content
   - Click "Allow"

3. **Verify**
   - Run: 📋FP - Operations → 👤 User Settings → 🔍 Diagnose User Resolution
   - Check: "SESSION.GETACTIVEUSER(): ✅ Email: user@domain.com"

### Why This Is Needed

- Google Apps Script requires **per-user authorization** for security
- Even with installable trigger, each user must grant permission
- This is a one-time setup per user
- Authorization persists until revoked

---

## Solution C: Manual Email Override (Workaround)

If Solutions A & B don't work (rare edge cases):

### Temporary Workaround

1. **Set Email Manually**
   - Go to menu: 📋FP - Operations → 👤 User Settings → Set My Email
   - Enter your full email address
   - Click OK

2. **How It Works**
   - Stores email in UserProperties cache (1-hour TTL)
   - Bypasses Session API detection
   - Works immediately without authorization

3. **Limitations**
   - Must re-enter after 1 hour (cache expiration)
   - Must re-enter after clearing cache
   - Not ideal for production use
   - Only use if Solutions A & B fail

---

## Verification After Fix

### Test Individual Post

1. Open any daily sheet (01-31)
2. Fill in a row: Supplier, Invoice No, Received Amt, etc.
3. Check the "Post" checkbox
4. Check columns K-M:
   - **Status**: Should show "POSTED"
   - **Entered By**: Should show your username (not "default")
   - **Timestamp**: Should show current date/time

### Test Batch Post

1. Fill in multiple rows
2. Use menu: 📋FP - Operations → Batch Post All Valid Rows
3. Check "Entered By" column for all posted rows
4. Should show your username, not "default"

### Check Audit Log

1. Go to "AuditLog" sheet
2. Find recent entries
3. Check "User" column
4. Should show your full email (e.g., `john.doe@company.com`)
5. Should NOT show `default@google.com`

---

## Understanding UserResolver v2.0 Fallback Chain

The system tries multiple methods in order:

### 1. Cache (Fast Path)
- Check UserProperties cache
- Validate session token (prevents cache poisoning)
- TTL: 1 hour
- **Skip if**: Cache expired or session mismatch

### 2. Session.getActiveUser() (Primary Method)
- **Works in**: Installable triggers, menu operations, direct execution
- **Fails in**: Simple triggers (limited permissions)
- **Returns**: Actual logged-in user's email
- **This is the fix for the bug!**

### 3. Session.getEffectiveUser() (Secondary Method)
- **Usually returns**: Script owner's email (not actual user)
- **Useful for**: Fallback identification
- **Not ideal**: Doesn't differentiate between users

### 4. User Prompt (Menu Context Only)
- **Triggers if**: Session methods fail in menu operations
- **Shows**: Dialog asking user to enter email
- **Validates**: Email format before accepting
- **Not available in**: Trigger context (no UI)

### 5. Default Fallback (Last Resort)
- Returns: `default@google.com`
- **This is the bug symptom**
- **Means**: All previous methods failed
- **Fix**: Solutions A or B above

---

## Common Issues and Solutions

### Issue 1: "Authorization Required" Loop

**Symptom**: User keeps seeing authorization prompt but it never completes

**Cause**: Browser blocking popup or cookies disabled

**Solution**:
1. Check browser popup blocker settings
2. Enable third-party cookies for Google domains
3. Try in incognito mode
4. Try different browser

### Issue 2: Script Owner Works, Shared Users Don't

**Symptom**: Owner sees correct email, shared users see `default@google.com`

**Cause**: Installable trigger not set up (still using simple trigger)

**Solution**: Follow Solution A above (set up installable trigger)

### Issue 3: Works in Menu, Fails in Edit Trigger

**Symptom**: Batch operations show correct email, individual posts don't

**Cause**: Menu uses installable context, edit uses simple trigger

**Solution**: Follow Solution A above (set up installable trigger)

### Issue 4: All Methods Fail

**Symptom**: Even after Solutions A & B, still shows `default@google.com`

**Possible Causes**:
- Organizational G Suite policies restricting script permissions
- Domain administrator disabled Apps Script
- Network/proxy blocking Google OAuth
- Script deployed as web app with wrong access settings

**Solutions**:
1. Contact G Suite administrator
2. Check organizational policies
3. Use Solution C (manual email override) as temporary workaround
4. Consider using different Google account

---

## Debugging Commands

### Run from Script Editor

```javascript
// Full diagnostic report
diagnoseUserResolution()

// Check current user detection
UserResolver.getUserWithMetadata()
// Returns: { email, method, context, timestamp }

// Check execution context
UserResolver.getExecutionContext()
// Returns: 'menu', 'trigger_installable', 'trigger_simple', or 'direct'

// Test Session APIs directly
Session.getActiveUser().getEmail()
Session.getEffectiveUser().getEmail()
Session.getTemporaryActiveUserKey()
```

### Check From Menu

- **Show User Info**: 📋FP - Operations → 👤 User Settings → Show User Info
- **Diagnose**: 📋FP - Operations → 👤 User Settings → 🔍 Diagnose User Resolution
- **Clear Cache**: 📋FP - Operations → 👤 User Settings → Clear User Cache

---

## Technical Background

### Google Apps Script Authorization Modes

| Mode | Trigger Type | Session.getActiveUser() | Can Access Other Files |
|------|-------------|------------------------|----------------------|
| **LIMITED** | Simple trigger | ❌ Empty for shared users | ❌ No |
| **FULL** | Installable trigger | ✅ Returns actual user | ✅ Yes |
| **CUSTOM_FUNCTION** | =CUSTOM() | ❌ Not available | ❌ No |

### Why Simple Triggers Fail for Shared Users

From Google's documentation:
> "Simple triggers run with the permissions of the active user viewing the spreadsheet. If the user is not the owner of the spreadsheet, certain APIs will not work, including `Session.getActiveUser()` for users other than the owner."

**Solution**: Use installable triggers which run with the authorization of the user who created them (the owner) but can still identify individual users via `Session.getActiveUser()`.

---

## Preventing This Issue

### For New Spreadsheets

1. **Set up installable trigger immediately** after deploying script
2. Run `setupInstallableEditTrigger()` as part of initial setup
3. Document trigger requirement in setup guide
4. Test with non-owner user before going live

### For Shared Environments

1. **Always use installable triggers** for production
2. Include authorization step in user onboarding
3. Use `diagnoseUserResolution()` for troubleshooting
4. Document the issue in user training materials

---

## Still Need Help?

1. **Run diagnostic**: Menu → 👤 User Settings → 🔍 Diagnose User Resolution
2. **Copy full diagnostic output** from Logs (View → Logs in Script Editor)
3. **Check these details**:
   - Trigger setup (simple vs installable)
   - Authorization status
   - Session.getActiveUser() result
   - Execution context
4. **Provide**:
   - Diagnostic output
   - User role (owner vs shared)
   - When issue occurs (individual post vs batch)
   - Browser and G Suite configuration

---

**Last Updated**: 2025-11-10
**Related**: UserResolver v2.0, `setupInstallableEditTrigger()`, `diagnoseUserResolution()`
