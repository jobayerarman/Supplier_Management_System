# WhatsApp Reporting Integration - Setup Guide

## Overview

This integration enables automated WhatsApp delivery of business reports:
- **Daily Reports**: Text summary of yesterday's transactions (9 PM daily)
- **Weekly Reports**: Text + PDF summary (Saturday 8 AM)
- **Monthly Reports**: Text + PDF dashboard (1st of month, 9 AM)

**Cost**: FREE for first 1,000 business-initiated conversations per month (Meta WhatsApp Cloud API)

---

## Part 1: WhatsApp Cloud API Setup

### Step 1: Create Meta Business Account

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Sign in with your Facebook account
3. Click "My Apps" → "Create App"
4. Select "Business" as app type
5. Fill in app details and create

### Step 2: Add WhatsApp Product

1. In your app dashboard, click "Add Product"
2. Find "WhatsApp" and click "Set Up"
3. Follow the setup wizard to:
   - Link or create a WhatsApp Business Account
   - Add a phone number (you can use the test number initially)
   - Verify your business (for production use)

### Step 3: Get Credentials

You need **3 pieces of information**:

#### A. Phone Number ID
1. In App Dashboard → WhatsApp → API Setup
2. Copy the "Phone number ID" (looks like: `123456789012345`)

#### B. Access Token (Permanent)
**IMPORTANT**: Generate a permanent System User token (not temporary test token)

1. In App Dashboard → Business Settings → System Users
2. Click "Add" to create new System User
3. Give it admin role
4. Click "Generate New Token"
5. Select your app and grant these permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
6. **Save this token securely** - it won't be shown again!
7. Token format: `EAAxxxxxxxxxxxxx` (long alphanumeric string)

#### C. Recipient Phone Number
1. The phone number that will receive reports
2. Format: Country code + number, no + or spaces
3. Example: `8801711123456` (Bangladesh number)
4. **IMPORTANT**: This number must have an active WhatsApp account

### Step 4: Test Number Setup (Optional)

For initial testing, Meta provides a test number with up to 5 recipient numbers:

1. In WhatsApp → API Setup
2. Under "Send and receive messages"
3. Add your phone number to "To" field
4. Click "Send message" to verify it works
5. You'll receive a verification code on WhatsApp

---

## Part 2: Google Apps Script Configuration

### Step 1: Open Script Editor

1. Open your Supplier Management spreadsheet
2. Go to: Extensions → Apps Script
3. You should see all the `.gs` files in the left sidebar

### Step 2: Configure WhatsApp via Menu

**EASIEST METHOD**: Use the built-in configuration wizard

1. Close and reopen your spreadsheet (to load new menu)
2. Go to menu: **📋FP - Operations → 📱 WhatsApp Reports → 🔧 Configure WhatsApp**
3. Follow the 3-step wizard:
   - **Step 1**: Paste your Meta Access Token
   - **Step 2**: Paste your Phone Number ID
   - **Step 3**: Enter recipient phone (format: `8801711123456`)
4. Click OK on success confirmation

**ALTERNATIVE METHOD**: Set Script Properties manually

1. In Script Editor: Project Settings (⚙️ icon) → Script Properties
2. Add these 3 properties:

| Property | Value | Example |
|----------|-------|---------|
| `WA_ACCESS_TOKEN` | Your Meta access token | `EAAxxxxxxxxxxxxx` |
| `WA_PHONE_NUMBER_ID` | Your WhatsApp phone ID | `123456789012345` |
| `REPORT_RECIPIENT_PHONE` | Recipient number (no +) | `8801711123456` |

3. Click "Save script properties"

### Step 3: Test Connection

1. Go to: **📋FP - Operations → 📱 WhatsApp Reports → 🧪 Test Connection**
2. You should receive a test message on WhatsApp
3. If successful, setup is complete!

**Troubleshooting**:
- ❌ "Configuration Error" → Check Script Properties are set correctly
- ❌ "Test Failed: Invalid access token" → Regenerate token in Meta Dashboard
- ❌ "Recipient phone number is not a WhatsApp user" → Verify number has WhatsApp account

---

## Part 3: Enable Automated Reports

### Option 1: Setup All Triggers (Recommended)

1. Go to: **📋FP - Operations → 📱 WhatsApp Reports → ⚙️ Setup Report Triggers**
2. Authorize when prompted (first time only)
3. Confirm setup dialog

This will enable:
- ✅ **Daily Report**: 9 PM every day (yesterday's summary)
- ✅ **Weekly Report**: Saturday 8 AM (text + PDF)
- ✅ **Monthly Report**: 1st of month, 9 AM (text + PDF)

### Option 2: Manual Triggers (Advanced)

In Script Editor:
1. Click ⏰ (Triggers) in left sidebar
2. Click "+ Add Trigger" for each report:

**Daily Report Trigger**:
- Function: `sendDailyReport`
- Event source: Time-driven
- Type: Day timer
- Time of day: 9pm to 10pm
- Save

**Weekly Report Trigger**:
- Function: `sendWeeklyReport`
- Event source: Time-driven
- Type: Week timer
- Day of week: Saturday
- Time of day: 8am to 9am
- Save

**Monthly Report Trigger**:
- Function: `sendMonthlyReport`
- Event source: Time-driven
- Type: Month timer
- Day of month: 1
- Time of day: 9am to 10am
- Save

### Verify Triggers

1. Go to: **📋FP - Operations → 📱 WhatsApp Reports → 📋 Show Trigger Status**
2. Should show 3 active triggers
3. Or check in Script Editor → ⏰ Triggers

### Disable Automation

To stop automated reports:
1. Go to: **📋FP - Operations → 📱 WhatsApp Reports → 🔴 Remove Report Triggers**
2. Confirm removal

---

## Part 4: Manual Testing

Before enabling automation, test each report type manually:

### Test Daily Report
1. Go to: **📋FP - Operations → 📱 WhatsApp Reports → 📊 Send Daily Report**
2. Wait for success confirmation (~5-10 seconds)
3. Check WhatsApp for message with yesterday's summary

**Sample Daily Report**:
```
📊 Daily Summary - Nov 17, 2025
Sunday
━━━━━━━━━━━━━━━━━━━━

✅ Posted Transactions: 45

📥 Invoices
Count: 38
Amount: ৳2,456,780

💰 Payments
Count: 42
Amount: ৳2,234,560

📋 By Type
Regular: 25 (৳1,890,000)
Partial: 8 (৳345,000)
Due: 9 (৳421,780)

🏆 Top Suppliers
1. ABC Corporation
   ৳456,000
2. XYZ Limited
   ৳234,500
...
```

### Test Weekly Report
1. Go to: **📋FP - Operations → 📱 WhatsApp Reports → 📈 Send Weekly Report**
2. Wait 15-30 seconds (generates PDF)
3. Check WhatsApp for:
   - Text summary message
   - PDF attachment with daily breakdown

**Weekly Report Includes**:
- 7-day transaction summary
- Daily breakdown table
- Collection efficiency %
- Total outstanding
- Top suppliers
- PDF with detailed metrics

### Test Monthly Report
1. Go to: **📋FP - Operations → 📱 WhatsApp Reports → 📅 Send Monthly Report**
2. Wait 20-40 seconds (generates PDF dashboard)
3. Check WhatsApp for:
   - Text summary message
   - PDF dashboard attachment

**Monthly Report Includes**:
- Executive summary (invoices, payments, outstanding)
- Invoice statistics (active, paid, collection rate)
- Payment statistics
- Aging analysis (0-30, 31-60, 61-90, 90+ days)
- Key insights
- PDF dashboard with charts

---

## Part 5: Monitoring & Maintenance

### Check Audit Log

All WhatsApp operations are logged in the `AuditLog` sheet:

**Actions logged**:
- `WHATSAPP_CONFIGURED` - Configuration updated
- `WHATSAPP_TEST_SUCCESS` - Test message sent
- `WHATSAPP_MESSAGE_SENT` - Report text sent
- `WHATSAPP_MEDIA_UPLOADED` - PDF uploaded
- `WHATSAPP_DOCUMENT_SENT` - PDF delivered
- `DAILY_REPORT_SENT` - Daily automation succeeded
- `WEEKLY_REPORT_SENT` - Weekly automation succeeded
- `MONTHLY_REPORT_SENT` - Monthly automation succeeded
- `*_ERROR` - Any failures

**Error logs include**:
- `WHATSAPP_SEND_FAILED` - API error (check token/permissions)
- `WHATSAPP_UPLOAD_FAILED` - Media upload issue (check file size)
- `DAILY_REPORT_ERROR` - Report generation failed
- `WEEKLY_PDF_ERROR` - PDF creation failed
- `MONTHLY_PDF_ERROR` - Dashboard generation failed

### View Execution Logs

In Script Editor:
1. Click "Executions" (📋 icon) in left sidebar
2. See all trigger runs and their status
3. Click any execution to see detailed logs

**What to check**:
- ✅ Green checkmark = Success
- ❌ Red X = Failed (click to see error)
- Duration (should be < 60 seconds)

### Common Issues

#### Issue: "Invalid access token"
**Solution**: Token expired or invalid
1. Generate new System User token in Meta Dashboard
2. Run "Configure WhatsApp" again with new token

#### Issue: "Phone number not registered"
**Solution**: Recipient doesn't have WhatsApp
1. Verify number format (no + or spaces)
2. Confirm number has active WhatsApp account
3. Try test number first

#### Issue: "Media upload failed: File too large"
**Solution**: PDF exceeds 16MB limit
1. Check PDF size in Drive
2. Reduce report date range if needed
3. Monthly reports with huge datasets may hit limit

#### Issue: Reports not sending automatically
**Solution**: Triggers not set up or disabled
1. Check "Show Trigger Status" shows 3 triggers
2. Check Script Editor → Triggers
3. Re-run "Setup Report Triggers" if needed

#### Issue: "Script timeout" during PDF generation
**Solution**: Report too large or slow processing
1. Optimize date range (weekly reports)
2. Check Master Database mode performance
3. Increase trigger timeout (advanced)

### Usage Limits & Costs

**WhatsApp Cloud API Free Tier**:
- First **1,000 conversations/month** = FREE
- Conversation = 24-hour messaging window
- Each report delivery = 1 conversation

**Expected monthly usage**:
- Daily reports: ~30 conversations
- Weekly reports: ~4 conversations
- Monthly reports: 1 conversation
- **Total: ~35 conversations/month** (well within free tier)

**If you exceed 1,000/month** (unlikely):
- Additional conversations: ~৳0.50-1.00 per conversation
- Monitor usage in Meta Business Manager

---

## Part 6: Customization

### Change Report Schedule

Edit triggers in Script Editor or modify functions in `ScheduledReports.gs`:

**Daily Report Time** (default 9 PM):
```javascript
.atHour(21)  // Change to desired hour (0-23)
```

**Weekly Report Day** (default Saturday):
```javascript
.onWeekDay(ScriptApp.WeekDay.SATURDAY)  // Change day
.atHour(8)  // Change hour
```

**Monthly Report Date** (default 1st):
```javascript
.onMonthDay(1)  // Change to desired day (1-31)
.atHour(9)
```

### Change Report Content

**Daily Report**: Edit `ReportingEngine.gs` → `formatDailyTextReport()`
**Weekly Report**: Edit `ReportingEngine.gs` → `formatWeeklyTextReport()`
**Monthly Report**: Edit `ReportingEngine.gs` → `formatMonthlyTextReport()`

**PDF Styling**: Edit `PDFGenerator.gs` → `createWeeklyPDF()` or `createMonthlyPDF()`

### Add Multiple Recipients

Currently supports single recipient. To add multiple:

1. Modify `ScheduledReports.gs` functions
2. Loop through recipient list:
```javascript
const recipients = ['8801711123456', '8801811234567'];
recipients.forEach(recipient => {
  WhatsAppManager.sendTextMessage(recipient, messageText);
});
```

### Change Report Currency

Edit `ReportingEngine.gs` format functions:
```javascript
.toLocaleString('en-BD')  // Change locale
// Example: 'en-US' for US format, 'en-IN' for Indian format
```

---

## Part 7: Security Best Practices

### Protect Access Token

❌ **NEVER**:
- Share access token in screenshots
- Commit token to git repositories
- Email or message token to anyone
- Store in shared documents

✅ **ALWAYS**:
- Store in Script Properties only
- Use System User token (not test token)
- Regenerate if compromised
- Limit token permissions to WhatsApp only

### Verify Recipients

- Only send reports to trusted business phone numbers
- Don't share reports with external parties without permission
- Reports contain sensitive financial data

### Monitor Usage

- Check AuditLog regularly for unexpected activity
- Review Executions log weekly
- Set up Meta webhook for delivery notifications (advanced)

---

## Part 8: Troubleshooting Checklist

Before asking for help, verify:

### Configuration Checklist
- [ ] Meta app created and WhatsApp product added
- [ ] System User access token generated (not test token)
- [ ] Phone Number ID copied correctly
- [ ] Recipient phone has WhatsApp account
- [ ] All 3 Script Properties set correctly
- [ ] Test connection successful

### Automation Checklist
- [ ] Triggers setup completed
- [ ] 3 triggers visible in Trigger Status
- [ ] Authorization granted for triggers
- [ ] Test reports sent successfully
- [ ] AuditLog shows configuration entry
- [ ] Executions log shows no errors

### Performance Checklist
- [ ] Daily reports < 10 seconds
- [ ] Weekly reports < 30 seconds
- [ ] Monthly reports < 60 seconds
- [ ] No timeout errors in Executions
- [ ] PDF files < 16MB
- [ ] No API rate limit errors

---

## Getting Help

### Check Documentation
1. This setup guide
2. `CLAUDE.md` for system architecture
3. Code comments in `.gs` files

### Review Logs
1. AuditLog sheet for operation history
2. Script Editor → Executions for trigger runs
3. Script Editor → Logs (View → Logs) for debug info

### Test Components
1. Run individual functions from Script Editor
2. Test with manual report sending first
3. Check each step: config → test → manual → automation

### Common Solutions
- **"Cannot find function"** → Close/reopen spreadsheet
- **"Unauthorized"** → Re-authorize in Script Editor
- **"Timeout"** → Reports too large, reduce date range
- **"API Error"** → Check Meta Dashboard for app status

---

## Quick Reference

### Menu Locations
```
📋FP - Operations
  └─ 📱 WhatsApp Reports
      ├─ 🔧 Configure WhatsApp     → Setup credentials
      ├─ 🧪 Test Connection         → Send test message
      ├─ 📊 Send Daily Report       → Manual daily report
      ├─ 📈 Send Weekly Report      → Manual weekly report
      ├─ 📅 Send Monthly Report     → Manual monthly report
      ├─ ⚙️ Setup Report Triggers    → Enable automation
      ├─ 🔴 Remove Report Triggers   → Disable automation
      └─ 📋 Show Trigger Status      → Check automation
```

### Files Created
```
WhatsAppManager.gs        → API communication
ReportingEngine.gs        → Data aggregation
PDFGenerator.gs           → PDF creation
ScheduledReports.gs       → Automation & triggers
UIMenu.gs                 → Menu integration (modified)
WHATSAPP_SETUP.md         → This documentation
```

### Script Properties
```
WA_ACCESS_TOKEN           → Meta access token
WA_PHONE_NUMBER_ID        → WhatsApp phone ID
REPORT_RECIPIENT_PHONE    → Recipient number
```

### Trigger Schedule
```
Daily:   9 PM every day      → Yesterday summary
Weekly:  Saturday 8 AM       → Text + PDF (7 days)
Monthly: 1st @ 9 AM          → Text + PDF dashboard
```

---

## Success Criteria

✅ **Setup Complete When**:
1. Test connection sends message successfully
2. Manual daily report delivers in < 10 seconds
3. Manual weekly report delivers text + PDF
4. Manual monthly report delivers text + PDF
5. Trigger status shows 3 active triggers
6. AuditLog shows successful operations

✅ **Production Ready When**:
1. All manual tests pass for 1 week
2. No errors in AuditLog
3. Executions show green checkmarks
4. Recipients confirm receiving reports
5. PDF formatting looks correct
6. Data accuracy verified

---

**Last Updated**: November 2025
**Version**: 1.0
**Support**: Check AuditLog and Executions log for debugging
