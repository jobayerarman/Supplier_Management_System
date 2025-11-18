// @ts-nocheck
// ==================== MODULE: ScheduledReports.gs ====================
/**
 * Scheduled Reports Module
 * Manages automated WhatsApp report delivery via time-based triggers
 *
 * SCHEDULE:
 * - Daily: 9 PM (21:00) every day - Text summary of yesterday
 * - Weekly: Saturday 8 AM (08:00) - Text + PDF report
 * - Monthly: 1st of month 9 AM (09:00) - Text + PDF dashboard
 *
 * SETUP:
 * 1. Configure WhatsApp credentials via menu
 * 2. Run setupAllReportTriggers() to enable automation
 * 3. Use removeAllReportTriggers() to disable
 */

// ═══════════════════════════════════════════════════════════════════════════
// TRIGGER SETUP FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Setup all report triggers (daily, weekly, monthly)
 * Run this once to enable automated reporting
 */
function setupAllReportTriggers() {
  try {
    // Remove existing triggers first
    removeAllReportTriggers();

    // Setup individual triggers
    setupDailyReportTrigger();
    setupWeeklyReportTrigger();
    setupMonthlyReportTrigger();

    SpreadsheetApp.getUi().alert(
      'Report Triggers Enabled',
      '✅ Automated reports configured:\n\n' +
      '• Daily: 9 PM (yesterday summary)\n' +
      '• Weekly: Saturday 8 AM (text + PDF)\n' +
      '• Monthly: 1st @ 9 AM (dashboard PDF)\n\n' +
      'Reports will be sent to configured WhatsApp number.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );

    AuditLogger.logInfo('WHATSAPP_TRIGGERS_SETUP', 'All report triggers enabled');

  } catch (error) {
    SpreadsheetApp.getUi().alert(
      'Setup Error',
      'Failed to setup triggers: ' + error.toString(),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    AuditLogger.logError('TRIGGER_SETUP_ERROR', error.toString());
  }
}

/**
 * Setup daily report trigger (9 PM every day)
 */
function setupDailyReportTrigger() {
  ScriptApp.newTrigger('sendDailyReport')
    .timeBased()
    .atHour(21) // 9 PM
    .everyDays(1)
    .create();

  Logger.log('Daily report trigger created: 9 PM every day');
}

/**
 * Setup weekly report trigger (Saturday 8 AM)
 */
function setupWeeklyReportTrigger() {
  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(8) // 8 AM
    .create();

  Logger.log('Weekly report trigger created: Saturday 8 AM');
}

/**
 * Setup monthly report trigger (1st of month, 9 AM)
 */
function setupMonthlyReportTrigger() {
  ScriptApp.newTrigger('sendMonthlyReport')
    .timeBased()
    .onMonthDay(1) // 1st of month
    .atHour(9) // 9 AM
    .create();

  Logger.log('Monthly report trigger created: 1st of month, 9 AM');
}

/**
 * Remove all report triggers
 */
function removeAllReportTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removedCount = 0;

  triggers.forEach(trigger => {
    const handlerFunction = trigger.getHandlerFunction();
    if (handlerFunction === 'sendDailyReport' ||
        handlerFunction === 'sendWeeklyReport' ||
        handlerFunction === 'sendMonthlyReport') {
      ScriptApp.deleteTrigger(trigger);
      removedCount++;
    }
  });

  if (removedCount > 0) {
    SpreadsheetApp.getUi().alert(
      'Triggers Removed',
      `✅ Removed ${removedCount} report trigger(s).\n\nAutomated reports are now disabled.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    AuditLogger.logInfo('WHATSAPP_TRIGGERS_REMOVED', `Removed ${removedCount} triggers`);
  } else {
    SpreadsheetApp.getUi().alert(
      'No Triggers',
      'No report triggers found.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }

  Logger.log(`Removed ${removedCount} report triggers`);
}

/**
 * Show current trigger status
 */
function showTriggerStatus() {
  const triggers = ScriptApp.getProjectTriggers();
  const reportTriggers = triggers.filter(t => {
    const fn = t.getHandlerFunction();
    return fn === 'sendDailyReport' || fn === 'sendWeeklyReport' || fn === 'sendMonthlyReport';
  });

  let message = '📊 *WhatsApp Report Triggers*\n\n';

  if (reportTriggers.length === 0) {
    message += '❌ No triggers configured\n\n';
    message += 'Use "Setup Report Triggers" to enable automation.';
  } else {
    message += `✅ ${reportTriggers.length} active trigger(s):\n\n`;
    reportTriggers.forEach(trigger => {
      const fn = trigger.getHandlerFunction();
      const type = fn.replace('send', '').replace('Report', '');
      message += `• ${type}: ${this._describeTrigger(trigger)}\n`;
    });
  }

  SpreadsheetApp.getUi().alert('Trigger Status', message, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Describe trigger schedule
 * @private
 * @param {Trigger} trigger - Apps Script trigger
 * @returns {string} Human-readable schedule
 */
function _describeTrigger(trigger) {
  const eventType = trigger.getEventType();
  if (eventType === ScriptApp.EventType.CLOCK) {
    // Time-based trigger - describe schedule
    return 'Scheduled (see logs for details)';
  }
  return 'Unknown schedule';
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULED REPORT FUNCTIONS (called by triggers)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send daily report via WhatsApp (triggered at 9 PM)
 * Reports on yesterday's activity
 */
function sendDailyReport() {
  try {
    AuditLogger.logInfo('DAILY_REPORT_START', 'Generating daily WhatsApp report');

    // Get recipient from Script Properties
    const props = PropertiesService.getScriptProperties();
    const recipient = props.getProperty('REPORT_RECIPIENT_PHONE');

    if (!recipient) {
      throw new Error('REPORT_RECIPIENT_PHONE not configured. Use "Configure WhatsApp" menu.');
    }

    // Generate report for yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const reportData = ReportingEngine.generateDailyReport(yesterday);

    if (!reportData.success) {
      throw new Error(reportData.error);
    }

    // Format as text message
    const messageText = ReportingEngine.formatDailyTextReport(reportData);

    // Send via WhatsApp
    const result = WhatsAppManager.sendTextMessage(recipient, messageText);

    if (!result.success) {
      throw new Error(result.error);
    }

    AuditLogger.logInfo('DAILY_REPORT_SENT', `Daily report sent to ${recipient}`);
    Logger.log('Daily report sent successfully');

  } catch (error) {
    AuditLogger.logError('DAILY_REPORT_ERROR', error.toString());
    Logger.log(`Daily report failed: ${error.toString()}`);
  }
}

/**
 * Send weekly report via WhatsApp (triggered Saturday 8 AM)
 * Sends text summary + PDF attachment
 */
function sendWeeklyReport() {
  try {
    AuditLogger.logInfo('WEEKLY_REPORT_START', 'Generating weekly WhatsApp report');

    // Get recipient from Script Properties
    const props = PropertiesService.getScriptProperties();
    const recipient = props.getProperty('REPORT_RECIPIENT_PHONE');

    if (!recipient) {
      throw new Error('REPORT_RECIPIENT_PHONE not configured. Use "Configure WhatsApp" menu.');
    }

    // Generate weekly report (ends yesterday)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const reportData = ReportingEngine.generateWeeklyReport(yesterday);

    if (!reportData.success) {
      throw new Error(reportData.error);
    }

    // Format text summary
    const messageText = ReportingEngine.formatWeeklyTextReport(reportData);

    // Send text message first
    const textResult = WhatsAppManager.sendTextMessage(recipient, messageText);

    if (!textResult.success) {
      throw new Error('Text message failed: ' + textResult.error);
    }

    // Generate PDF
    const pdfBlob = PDFGenerator.createWeeklyPDF(reportData);

    // Upload PDF to WhatsApp
    const uploadResult = WhatsAppManager.uploadMedia(pdfBlob, 'application/pdf');

    if (!uploadResult.success) {
      throw new Error('PDF upload failed: ' + uploadResult.error);
    }

    // Send PDF document
    const docResult = WhatsAppManager.sendDocument(
      recipient,
      uploadResult.mediaId,
      pdfBlob.getName(),
      'Weekly Summary Report'
    );

    if (!docResult.success) {
      throw new Error('PDF send failed: ' + docResult.error);
    }

    AuditLogger.logInfo('WEEKLY_REPORT_SENT', `Weekly report sent to ${recipient} (text + PDF)`);
    Logger.log('Weekly report sent successfully');

  } catch (error) {
    AuditLogger.logError('WEEKLY_REPORT_ERROR', error.toString());
    Logger.log(`Weekly report failed: ${error.toString()}`);
  }
}

/**
 * Send monthly report via WhatsApp (triggered 1st of month, 9 AM)
 * Sends text summary + PDF dashboard
 */
function sendMonthlyReport() {
  try {
    AuditLogger.logInfo('MONTHLY_REPORT_START', 'Generating monthly WhatsApp report');

    // Get recipient from Script Properties
    const props = PropertiesService.getScriptProperties();
    const recipient = props.getProperty('REPORT_RECIPIENT_PHONE');

    if (!recipient) {
      throw new Error('REPORT_RECIPIENT_PHONE not configured. Use "Configure WhatsApp" menu.");
    }

    // Generate monthly report for previous month
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // getMonth() is 0-indexed
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const reportData = ReportingEngine.generateMonthlyReport(prevYear, prevMonth);

    if (!reportData.success) {
      throw new Error(reportData.error);
    }

    // Format text summary
    const messageText = ReportingEngine.formatMonthlyTextReport(reportData);

    // Send text message first
    const textResult = WhatsAppManager.sendTextMessage(recipient, messageText);

    if (!textResult.success) {
      throw new Error('Text message failed: ' + textResult.error);
    }

    // Generate PDF dashboard
    const pdfBlob = PDFGenerator.createMonthlyPDF(reportData);

    // Upload PDF to WhatsApp
    const uploadResult = WhatsAppManager.uploadMedia(pdfBlob, 'application/pdf');

    if (!uploadResult.success) {
      throw new Error('PDF upload failed: ' + uploadResult.error);
    }

    // Send PDF document
    const docResult = WhatsAppManager.sendDocument(
      recipient,
      uploadResult.mediaId,
      pdfBlob.getName(),
      'Monthly Dashboard'
    );

    if (!docResult.success) {
      throw new Error('PDF send failed: ' + docResult.error);
    }

    AuditLogger.logInfo('MONTHLY_REPORT_SENT', `Monthly report sent to ${recipient} (text + PDF)`);
    Logger.log('Monthly report sent successfully');

  } catch (error) {
    AuditLogger.logError('MONTHLY_REPORT_ERROR', error.toString());
    Logger.log(`Monthly report failed: ${error.toString()}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MANUAL SEND FUNCTIONS (for testing via menu)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Manually send daily report (for testing)
 */
function sendDailyReportManual() {
  const ui = SpreadsheetApp.getUi();

  try {
    sendDailyReport();
    ui.alert(
      'Daily Report Sent',
      '✅ Daily report sent successfully!\n\nCheck WhatsApp for delivery.',
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert(
      'Send Failed',
      '❌ Failed to send daily report:\n\n' + error.toString(),
      ui.ButtonSet.OK
    );
  }
}

/**
 * Manually send weekly report (for testing)
 */
function sendWeeklyReportManual() {
  const ui = SpreadsheetApp.getUi();

  try {
    ui.alert(
      'Generating Report',
      'Generating weekly report and PDF...\n\nThis may take 15-30 seconds.',
      ui.ButtonSet.OK
    );

    sendWeeklyReport();

    ui.alert(
      'Weekly Report Sent',
      '✅ Weekly report sent successfully!\n\nCheck WhatsApp for text + PDF.',
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert(
      'Send Failed',
      '❌ Failed to send weekly report:\n\n' + error.toString(),
      ui.ButtonSet.OK
    );
  }
}

/**
 * Manually send monthly report (for testing)
 */
function sendMonthlyReportManual() {
  const ui = SpreadsheetApp.getUi();

  try {
    ui.alert(
      'Generating Report',
      'Generating monthly dashboard and PDF...\n\nThis may take 20-40 seconds.',
      ui.ButtonSet.OK
    );

    sendMonthlyReport();

    ui.alert(
      'Monthly Report Sent',
      '✅ Monthly report sent successfully!\n\nCheck WhatsApp for text + PDF.',
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert(
      'Send Failed',
      '❌ Failed to send monthly report:\n\n' + error.toString(),
      ui.ButtonSet.OK
    );
  }
}
