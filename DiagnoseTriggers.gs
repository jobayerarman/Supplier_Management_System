/**
 * Diagnostic function to check all active triggers
 * Run this from Script Editor to see what triggers are active
 */
function diagnoseTriggers() {
  const ss = SpreadsheetApp.getActive();
  const triggers = ScriptApp.getUserTriggers(ss);

  Logger.log('='.repeat(60));
  Logger.log('TRIGGER DIAGNOSTIC REPORT');
  Logger.log('='.repeat(60));
  Logger.log(`Total triggers found: ${triggers.length}`);
  Logger.log('');

  if (triggers.length === 0) {
    Logger.log('⚠️  NO INSTALLABLE TRIGGERS FOUND!');
    Logger.log('');
    Logger.log('This means ONLY simple triggers are running.');
    Logger.log('For Master Database mode, you MUST have an installable trigger.');
    Logger.log('');
    Logger.log('Run: setupInstallableEditTrigger() to create one');
  } else {
    triggers.forEach((trigger, index) => {
      Logger.log(`Trigger ${index + 1}:`);
      Logger.log(`  Type: ${trigger.getEventType()}`);
      Logger.log(`  Handler: ${trigger.getHandlerFunction()}`);
      Logger.log(`  Trigger ID: ${trigger.getUniqueId()}`);
      Logger.log('');
    });

    // Check for duplicate Edit triggers
    const editTriggers = triggers.filter(t => t.getEventType() === ScriptApp.EventType.ON_EDIT);
    if (editTriggers.length > 1) {
      Logger.log('⚠️  WARNING: Multiple Edit triggers found!');
      Logger.log('This will cause the onEdit function to run multiple times per edit.');
      Logger.log('');
      Logger.log('Run: removeInstallableEditTrigger() to clean up duplicates');
    } else if (editTriggers.length === 1) {
      Logger.log('✅ One Edit trigger found (correct)');
    }
  }

  Logger.log('='.repeat(60));
  Logger.log('SIMPLE TRIGGER CHECK');
  Logger.log('='.repeat(60));
  Logger.log('');
  Logger.log('⚠️  Simple trigger is ALWAYS active when function is named "onEdit"');
  Logger.log('');
  Logger.log('Simple trigger limitations:');
  Logger.log('  ❌ Cannot access other spreadsheets (Master Database)');
  Logger.log('  ❌ Cannot run longer than 30 seconds');
  Logger.log('  ❌ Restricted permissions');
  Logger.log('');
  Logger.log('For Master Database mode:');
  Logger.log('  ✅ You MUST have ONLY installable trigger');
  Logger.log('  ❌ Simple trigger will FAIL with permission errors');
  Logger.log('');
  Logger.log('If simple trigger is causing issues:');
  Logger.log('  Option 1: Ensure installable trigger exists (it will override simple trigger behavior)');
  Logger.log('  Option 2: The simple trigger should fail fast and the installable will succeed');
  Logger.log('');
  Logger.log('='.repeat(60));

  // Show in UI as well
  const ui = SpreadsheetApp.getUi();
  let message = `Found ${triggers.length} installable trigger(s):\n\n`;

  if (triggers.length === 0) {
    message = '⚠️  NO INSTALLABLE TRIGGERS FOUND!\n\n';
    message += 'You are running with SIMPLE TRIGGER ONLY.\n';
    message += 'This will FAIL in Master Database mode.\n\n';
    message += 'Run setupInstallableEditTrigger() to fix.';
  } else {
    triggers.forEach((trigger, index) => {
      message += `${index + 1}. Type: ${trigger.getEventType()}\n`;
      message += `   Handler: ${trigger.getHandlerFunction()}\n\n`;
    });

    const editTriggers = triggers.filter(t => t.getEventType() === ScriptApp.EventType.ON_EDIT);
    if (editTriggers.length > 1) {
      message += '⚠️  WARNING: Multiple Edit triggers!\n';
      message += 'Run removeInstallableEditTrigger() to clean up.';
    } else if (editTriggers.length === 1) {
      message += '✅ Configuration looks correct!\n\n';
      message += 'NOTE: Simple trigger "onEdit" also runs automatically.\n';
      message += 'It will fail with permission errors, but installable trigger will succeed.';
    }
  }

  ui.alert('Trigger Diagnostic', message, ui.ButtonSet.OK);

  Logger.log('Check Logs for detailed report (View → Logs)');
}

/**
 * Check if function has simple trigger conflict
 */
function checkSimpleTriggerConflict() {
  const ui = SpreadsheetApp.getUi();

  // Check if onEdit function exists (it will have simple trigger)
  try {
    // If we can reference it, it exists
    const hasOnEdit = typeof onEdit === 'function';

    if (hasOnEdit) {
      Logger.log('✅ onEdit function exists');
      Logger.log('⚠️  This creates an automatic SIMPLE TRIGGER');
      Logger.log('');
      Logger.log('Impact:');
      Logger.log('  - Simple trigger runs FIRST (restricted permissions)');
      Logger.log('  - Then installable trigger runs (full permissions)');
      Logger.log('  - Simple trigger will FAIL on Master Database access');
      Logger.log('  - Installable trigger will SUCCEED');
      Logger.log('');
      Logger.log('This is EXPECTED BEHAVIOR in Master Database mode.');
      Logger.log('The simple trigger failure is harmless - installable trigger handles it.');

      ui.alert(
        'Simple Trigger Detected',
        '⚠️  Function "onEdit" creates automatic simple trigger.\n\n' +
        'Simple trigger will fail with permission errors.\n' +
        'Installable trigger will succeed.\n\n' +
        'This is EXPECTED BEHAVIOR in Master Database mode.\n\n' +
        'To avoid seeing errors:\n' +
        '1. Ignore simple trigger failures in logs\n' +
        '2. Only installable trigger matters\n' +
        '3. System works correctly despite simple trigger errors',
        ui.ButtonSet.OK
      );
    }
  } catch (e) {
    Logger.log('Could not check for onEdit function');
  }
}
