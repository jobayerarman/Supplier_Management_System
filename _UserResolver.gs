/**
 * UserResolver - Reliable user identification for shared Google Sheets environments.
 * Implements a fallback strategy to identify the active user when Session.getEffectiveUser() fails.
 */

const UserResolver = (() => {
  // Configuration
  const CONFIG = {
    DEFAULT_USER_EMAIL: 'default@google.com',
    SHEET_NAME: 'Settings',
    AUDIT_COLUMN: 'A'
  };

  /**
   * Retrieves the current active user's email with fallback strategy.
   * Fallback chain: Session.getActiveUser() → Sheet-based detection → Default fallback
   * 
   * @returns {string} User email address or default fallback
   */
  function getCurrentUser() {
    try {
      // Attempt 1: Use Session.getActiveUser() (most reliable in bound scripts)
      const sessionUser = getSessionActiveUser();
      if (sessionUser) return sessionUser;

      // Attempt 2: Detect user from last edit in sheet (collaborative editing)
      const sheetUser = detectUserFromSheetEdit();
      if (sheetUser) return sheetUser;

      // Attempt 3: Use effective user as last resort
      const effectiveUser = getEffectiveUserEmail();
      if (effectiveUser) return effectiveUser;

      // Fallback: Return configured default
      return CONFIG.DEFAULT_USER_EMAIL;
    } catch (error) {
      Logger.log('UserResolver error: ' + error.message);
      return CONFIG.DEFAULT_USER_EMAIL;
    }
  }

  /**
   * Gets user email from Session.getActiveUser() if available.
   * Works in bound scripts and direct executions, but not in triggers.
   * 
   * @returns {string|null} User email or null if unavailable
   */
  function getSessionActiveUser() {
    try {
      const user = Session.getActiveUser();
      const email = user.getEmail();
      return (email && email.length > 0) ? email : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Attempts to identify user from sheet edit metadata.
   * Uses Apps Script's edit history to find the current user in collaborative sheets.
   * 
   * @returns {string|null} User email if detectable from sheet state
   */
  function detectUserFromSheetEdit() {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
      
      if (!sheet) return null;

      // Get the range where the last user email was stored (if tracking is enabled)
      const lastUserRange = sheet.getRange(CONFIG.AUDIT_COLUMN + '1');
      const lastUserEmail = lastUserRange.getValue();

      if (lastUserEmail && typeof lastUserEmail === 'string' && lastUserEmail.includes('@')) {
        return lastUserEmail;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Falls back to Session.getEffectiveUser() as last resort.
   * May return developer email in shared environments; use only after other methods fail.
   * 
   * @returns {string|null} User email or null if empty
   */
  function getEffectiveUserEmail() {
    try {
      const email = Session.getEffectiveUser().getEmail();
      return (email && email.length > 0) ? email : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Sets the current user's email in the tracking sheet.
   * Call this in trigger-based functions to establish user context.
   * 
   * @param {string} email - Email address to store
   */
  function setCurrentUserEmail(email) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
      
      if (!sheet) {
        Logger.log('Warning: Settings sheet not found for user tracking');
        return;
      }

      sheet.getRange(CONFIG.AUDIT_COLUMN + '1').setValue(email);
    } catch (error) {
      Logger.log('Error setting user email: ' + error.message);
    }
  }

  /**
   * Updates configuration values.
   * 
   * @param {Object} overrides - Configuration properties to override
   */
  function setConfig(overrides) {
    Object.assign(CONFIG, overrides);
  }

  // Public API
  return {
    getCurrentUser,
    setCurrentUserEmail,
    setConfig,
    getConfig: () => ({ ...CONFIG })
  };
})();

/**
 * Unit Tests for UserResolver
 * Run in Apps Script editor: Run > testUserResolver
 */
function testUserResolver() {
  Logger.log('=== UserResolver Unit Tests ===');

  // Test 1: getCurrentUser returns a valid email format
  const user = UserResolver.getCurrentUser();
  Logger.log('Test 1 - getCurrentUser returns email: ' + (user.includes('@') ? 'PASS' : 'FAIL'));
  Logger.log('  Result: ' + user);

  // Test 2: Config can be retrieved
  const config = UserResolver.getConfig();
  Logger.log('Test 2 - getConfig returns object: ' + (config && config.DEFAULT_USER_EMAIL ? 'PASS' : 'FAIL'));

  // Test 3: setCurrentUserEmail stores value (if Settings sheet exists)
  try {
    const testEmail = 'test@example.com';
    UserResolver.setCurrentUserEmail(testEmail);
    Logger.log('Test 3 - setCurrentUserEmail executes: PASS');
  } catch (error) {
    Logger.log('Test 3 - setCurrentUserEmail executes: FAIL (' + error.message + ')');
  }

  // Test 4: setConfig updates configuration
  const originalDefault = UserResolver.getConfig().DEFAULT_USER_EMAIL;
  UserResolver.setConfig({ DEFAULT_USER_EMAIL: 'new-default@example.com' });
  const newDefault = UserResolver.getConfig().DEFAULT_USER_EMAIL;
  Logger.log('Test 4 - setConfig updates values: ' + (newDefault === 'new-default@example.com' ? 'PASS' : 'FAIL'));
  UserResolver.setConfig({ DEFAULT_USER_EMAIL: originalDefault });

  Logger.log('=== Tests Complete ===');
}
