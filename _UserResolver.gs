/**
 * UserResolver - Context-Aware User Identification for Google Sheets
 *
 * Provides reliable user identification across different execution contexts:
 * - Menu context (batch operations): Uses Session → Prompt if needed
 * - Trigger context (individual posts): Uses Session → Default if needed
 *
 * Features:
 * - Context-aware fallback chains
 * - Session caching (1-hour TTL)
 * - User prompt fallback for menu context
 * - Detection metadata for debugging
 * - Email validation
 *
 * Version: 2.0
 * Last Updated: 2025-11-05
 */

const UserResolver = (() => {
  // Configuration
  const CONFIG = {
    DEFAULT_USER_EMAIL: 'default@google.com',
    CACHE_TTL_MS: 3600000, // 1 hour
    CACHE_KEY_PREFIX: 'UserResolver_',
    MAX_PROMPT_ATTEMPTS: 3,
    // Deprecated settings (kept for backward compatibility)
    SHEET_NAME: 'Settings',
    AUDIT_COLUMN: 'A'
  };

  // Detection metadata (for debugging and audit)
  let lastDetection = {
    email: null,
    method: null,
    context: null,
    timestamp: null
  };

  /**
   * Detect execution context using authorization mode
   * Uses authMode as primary detection method for reliability
   * @returns {string} Context type: 'menu', 'trigger_installable', 'trigger_simple', 'direct'
   */
  function getExecutionContext() {
    try {
      // Primary detection: Check authorization mode
      const authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
      const authStatus = authInfo.getAuthorizationStatus();

      // If authorization required, it's a simple trigger (limited permissions)
      if (authStatus === ScriptApp.AuthorizationStatus.REQUIRED) {
        return 'trigger_simple';
      }

      // Authorization not required - could be installable trigger, menu, or direct
      // Differentiate by checking UI availability and Session access
      try {
        const ui = SpreadsheetApp.getUi();
        // UI available - either menu or direct execution

        // Check if there's an active user with email
        try {
          const user = Session.getActiveUser();
          const email = user ? user.getEmail() : null;
          if (email && email.trim().length > 0) {
            return 'menu'; // Menu context - has UI and active user
          }
        } catch (sessionError) {
          // Session might fail even with UI - treat as direct
        }

        return 'direct'; // Has UI but no active user - direct execution from editor

      } catch (uiError) {
        // UI not available - must be trigger context
        // Since authStatus is NOT_REQUIRED, it's an installable trigger
        return 'trigger_installable';
      }

    } catch (error) {
      Logger.log('UserResolver getExecutionContext error: ' + error.message);
      return 'unknown';
    }
  }

  /**
   * Validate email format
   * @param {string} email - Email to validate
   * @returns {boolean} True if valid email format
   */
  function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;

    // RFC 5322 simplified validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  }

  /**
   * Get cached user email from UserProperties
   * Validates session token to prevent wrong user attribution in multi-user environments
   * @returns {Object|null} Cached user object or null if expired/not found
   */
  function getCachedUser() {
    try {
      const userProps = PropertiesService.getUserProperties();
      const cacheKey = CONFIG.CACHE_KEY_PREFIX + 'email';
      const cacheTimeKey = CONFIG.CACHE_KEY_PREFIX + 'timestamp';
      const cacheMethodKey = CONFIG.CACHE_KEY_PREFIX + 'method';
      const cacheSessionKey = CONFIG.CACHE_KEY_PREFIX + 'session_token';

      const cachedEmail = userProps.getProperty(cacheKey);
      const cachedTime = userProps.getProperty(cacheTimeKey);
      const cachedMethod = userProps.getProperty(cacheMethodKey);
      const cachedSessionToken = userProps.getProperty(cacheSessionKey);

      if (!cachedEmail || !cachedTime) return null;

      // Validate session token to prevent cache poisoning
      // Session.getTemporaryActiveUserKey() returns unique session identifier
      try {
        const currentSessionToken = Session.getTemporaryActiveUserKey();
        if (currentSessionToken && cachedSessionToken && currentSessionToken !== cachedSessionToken) {
          // Different session - cached data is from different user
          Logger.log('UserResolver: Session mismatch detected, clearing cache');
          clearCachedUser();
          return null;
        }
      } catch (sessionError) {
        // Session.getTemporaryActiveUserKey() may fail in some contexts
        // In this case, rely on TTL-based expiration only
        Logger.log('UserResolver: Session validation unavailable, using TTL only');
      }

      // Check if cache is still valid (within TTL)
      const cacheAge = Date.now() - parseInt(cachedTime, 10);
      if (cacheAge > CONFIG.CACHE_TTL_MS) {
        // Cache expired
        clearCachedUser();
        return null;
      }

      return {
        email: cachedEmail,
        method: cachedMethod || 'cached',
        timestamp: new Date(parseInt(cachedTime, 10))
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Cache user email in UserProperties with session token validation
   * @param {string} email - Email to cache
   * @param {string} method - Detection method used
   */
  function setCachedUser(email, method) {
    try {
      const userProps = PropertiesService.getUserProperties();
      const cacheKey = CONFIG.CACHE_KEY_PREFIX + 'email';
      const cacheTimeKey = CONFIG.CACHE_KEY_PREFIX + 'timestamp';
      const cacheMethodKey = CONFIG.CACHE_KEY_PREFIX + 'method';
      const cacheSessionKey = CONFIG.CACHE_KEY_PREFIX + 'session_token';

      const cacheData = {
        [cacheKey]: email,
        [cacheTimeKey]: Date.now().toString(),
        [cacheMethodKey]: method
      };

      // Store session token if available (for validation on cache reads)
      try {
        const sessionToken = Session.getTemporaryActiveUserKey();
        if (sessionToken) {
          cacheData[cacheSessionKey] = sessionToken;
        }
      } catch (sessionError) {
        // Session token unavailable - cache will rely on TTL only
        Logger.log('UserResolver: Session token unavailable for cache write');
      }

      userProps.setProperties(cacheData);
    } catch (error) {
      // Cache failure is non-fatal
      Logger.log('UserResolver cache write failed: ' + error.message);
    }
  }

  /**
   * Clear cached user data including session token
   */
  function clearCachedUser() {
    try {
      const userProps = PropertiesService.getUserProperties();
      const cacheKey = CONFIG.CACHE_KEY_PREFIX + 'email';
      const cacheTimeKey = CONFIG.CACHE_KEY_PREFIX + 'timestamp';
      const cacheMethodKey = CONFIG.CACHE_KEY_PREFIX + 'method';
      const cacheSessionKey = CONFIG.CACHE_KEY_PREFIX + 'session_token';

      userProps.deleteProperty(cacheKey);
      userProps.deleteProperty(cacheTimeKey);
      userProps.deleteProperty(cacheMethodKey);
      userProps.deleteProperty(cacheSessionKey);
    } catch (error) {
      // Non-fatal
    }
  }

  /**
   * Try to get user from Session.getActiveUser()
   * Works in: Installable triggers, menu items, direct execution
   * Fails in: Simple triggers
   *
   * @returns {string|null} User email or null
   */
  function getSessionActiveUser() {
    try {
      const user = Session.getActiveUser();
      const email = user.getEmail();
      if (email && email.trim().length > 0 && isValidEmail(email)) {
        return email;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Try to get user from Session.getEffectiveUser()
   * May return developer email in shared environments
   *
   * @returns {string|null} User email or null
   */
  function getSessionEffectiveUser() {
    try {
      const email = Session.getEffectiveUser().getEmail();
      if (email && email.trim().length > 0 && isValidEmail(email)) {
        return email;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Prompt user to enter their email address
   * Only used in menu context when Session methods fail
   *
   * @returns {string|null} User email or null if cancelled
   */
  function promptUserForIdentification() {
    try {
      const ui = SpreadsheetApp.getUi();
      let attempts = 0;

      while (attempts < CONFIG.MAX_PROMPT_ATTEMPTS) {
        const response = ui.prompt(
          'User Identification Required',
          'Unable to automatically detect your email address.\n\n' +
          'Please enter your email to continue:',
          ui.ButtonSet.OK_CANCEL
        );

        if (response.getSelectedButton() !== ui.Button.OK) {
          // User cancelled
          return null;
        }

        const email = response.getResponseText().trim();

        if (isValidEmail(email)) {
          return email;
        }

        // Invalid email, try again
        attempts++;
        if (attempts < CONFIG.MAX_PROMPT_ATTEMPTS) {
          ui.alert(
            'Invalid Email',
            `"${email}" is not a valid email address.\n\n` +
            `Please try again (${attempts}/${CONFIG.MAX_PROMPT_ATTEMPTS} attempts used).`,
            ui.ButtonSet.OK
          );
        }
      }

      // Max attempts reached
      ui.alert(
        'User Identification Failed',
        'Unable to verify your email address after multiple attempts.\n\n' +
        'Operations will use default user identification.',
        ui.ButtonSet.OK
      );

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get current user with context-aware fallback strategy
   * Main public API - maintains backward compatibility
   *
   * @returns {string} User email address
   */
  function getCurrentUser() {
    try {
      // Check cache first (performance optimization)
      const cached = getCachedUser();
      if (cached) {
        lastDetection = {
          email: cached.email,
          method: 'cached',
          context: getExecutionContext(),
          timestamp: new Date()
        };
        return cached.email;
      }

      // Detect execution context
      const context = getExecutionContext();

      // Try Session.getActiveUser() first (works in most contexts)
      const sessionActive = getSessionActiveUser();
      if (sessionActive) {
        setCachedUser(sessionActive, 'session_active');
        lastDetection = {
          email: sessionActive,
          method: 'session_active',
          context: context,
          timestamp: new Date()
        };
        return sessionActive;
      }

      // Try Session.getEffectiveUser() second
      const sessionEffective = getSessionEffectiveUser();
      if (sessionEffective) {
        setCachedUser(sessionEffective, 'session_effective');
        lastDetection = {
          email: sessionEffective,
          method: 'session_effective',
          context: context,
          timestamp: new Date()
        };
        return sessionEffective;
      }

      // Context-specific fallbacks
      if (context === 'menu') {
        // In menu context, prompt user for identification
        const prompted = promptUserForIdentification();
        if (prompted) {
          setCachedUser(prompted, 'user_prompt');
          lastDetection = {
            email: prompted,
            method: 'user_prompt',
            context: context,
            timestamp: new Date()
          };
          return prompted;
        }
      }

      // Final fallback: Default email
      lastDetection = {
        email: CONFIG.DEFAULT_USER_EMAIL,
        method: 'default_fallback',
        context: context,
        timestamp: new Date()
      };

      // Log warning for audit purposes
      Logger.log(`⚠️ UserResolver using default fallback | Context: ${context}`);

      return CONFIG.DEFAULT_USER_EMAIL;

    } catch (error) {
      Logger.log('UserResolver critical error: ' + error.message);
      lastDetection = {
        email: CONFIG.DEFAULT_USER_EMAIL,
        method: 'error_fallback',
        context: 'error',
        timestamp: new Date()
      };
      return CONFIG.DEFAULT_USER_EMAIL;
    }
  }

  /**
   * Extract username from email address (without domain)
   * Useful when you already have an email and want just the username
   * Example: "john.doe@company.com" → "john.doe"
   *
   * @param {string} email - Full email address
   * @returns {string} Username portion of email (before @)
   */
  function extractUsername(email) {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return email; // Return as-is if no @ found
    }
    return email.split('@')[0];
  }

  /**
   * Get current user's username only (without domain)
   * Convenience method that gets current user and extracts username
   * Example: "john.doe@company.com" → "john.doe"
   *
   * @returns {string} Username portion of current user's email
   */
  function getUsernameOnly() {
    return extractUsername(getCurrentUser());
  }

  /**
   * Get current user with detection metadata (for debugging)
   * Returns full detection information including method and context
   *
   * @returns {Object} Detection result with email, method, context, timestamp
   */
  function getUserWithMetadata() {
    const email = getCurrentUser();
    return {
      ...lastDetection,
      email: email // Ensure email is always set
    };
  }

  /**
   * Manually set user email (for "Set My Email" menu option)
   * Stores in UserProperties cache
   *
   * @param {string} email - Email address to set
   * @returns {boolean} True if successful
   */
  function setManualUserEmail(email) {
    if (!isValidEmail(email)) {
      return false;
    }

    try {
      setCachedUser(email, 'manual_override');
      lastDetection = {
        email: email,
        method: 'manual_override',
        context: getExecutionContext(),
        timestamp: new Date()
      };
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clear user cache (for logout or troubleshooting)
   */
  function clearUserCache() {
    clearCachedUser();
    lastDetection = {
      email: null,
      method: null,
      context: null,
      timestamp: null
    };
  }

  /**
   * Get current detection metadata (for debugging)
   * @returns {Object} Last detection metadata
   */
  function getLastDetection() {
    return { ...lastDetection };
  }

  /**
   * Update configuration values
   * @param {Object} overrides - Configuration properties to override
   */
  function setConfig(overrides) {
    Object.assign(CONFIG, overrides);
  }

  /**
   * Get current configuration
   * @returns {Object} Configuration object
   */
  function getConfig() {
    return { ...CONFIG };
  }

  // ═══ DEPRECATED METHODS (Kept for backward compatibility) ═══

  /**
   * @deprecated Since v2.0 - Sheet-based detection is unreliable and no longer used
   * This method is kept for backward compatibility but always returns null
   * Use getCurrentUser() instead which uses Session + Prompt fallback
   */
  function detectUserFromSheetEdit() {
    Logger.log('⚠️ detectUserFromSheetEdit() is deprecated and no longer functional');
    return null;
  }

  /**
   * @deprecated Since v2.0 - Sheet-based tracking is no longer used
   * Use UserProperties cache instead (automatic via getCurrentUser())
   */
  function setCurrentUserEmail(email) {
    Logger.log('⚠️ setCurrentUserEmail() is deprecated - use setManualUserEmail() instead');
    return setManualUserEmail(email);
  }

  // Public API
  return {
    // Core methods
    getCurrentUser,
    getUsernameOnly,
    extractUsername,
    getUserWithMetadata,
    setManualUserEmail,
    clearUserCache,

    // Utility methods
    getLastDetection,
    getExecutionContext,
    isValidEmail,

    // Configuration
    setConfig,
    getConfig,

    // Deprecated methods (keep for backward compatibility)
    setCurrentUserEmail,
    detectUserFromSheetEdit
  };
})();

/**
 * Unit Tests for UserResolver
 * Run in Apps Script editor: Run > testUserResolver
 */
function testUserResolver() {
  Logger.log('═══ UserResolver v2.0 Unit Tests ═══\n');

  // Test 1: getCurrentUser returns a valid email format
  Logger.log('Test 1: getCurrentUser returns valid email');
  const user = UserResolver.getCurrentUser();
  const test1 = user && user.includes('@');
  Logger.log(`  Result: ${user}`);
  Logger.log(`  Status: ${test1 ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test 2: getUserWithMetadata returns detection info
  Logger.log('Test 2: getUserWithMetadata returns metadata');
  const metadata = UserResolver.getUserWithMetadata();
  const test2 = metadata && metadata.email && metadata.method && metadata.context;
  Logger.log(`  Email: ${metadata.email}`);
  Logger.log(`  Method: ${metadata.method}`);
  Logger.log(`  Context: ${metadata.context}`);
  Logger.log(`  Timestamp: ${metadata.timestamp}`);
  Logger.log(`  Status: ${test2 ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test 3: getExecutionContext returns valid context
  Logger.log('Test 3: getExecutionContext returns valid context');
  const context = UserResolver.getExecutionContext();
  const validContexts = ['menu', 'trigger_installable', 'trigger_simple', 'direct', 'unknown'];
  const test3 = validContexts.includes(context);
  Logger.log(`  Context: ${context}`);
  Logger.log(`  Status: ${test3 ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test 4: isValidEmail validates correctly
  Logger.log('Test 4: isValidEmail validation');
  const validEmail = UserResolver.isValidEmail('test@example.com');
  const invalidEmail1 = !UserResolver.isValidEmail('invalid');
  const invalidEmail2 = !UserResolver.isValidEmail('');
  const invalidEmail3 = !UserResolver.isValidEmail(null);
  const test4 = validEmail && invalidEmail1 && invalidEmail2 && invalidEmail3;
  Logger.log(`  "test@example.com": ${validEmail ? 'Valid ✅' : 'Invalid ❌'}`);
  Logger.log(`  "invalid": ${invalidEmail1 ? 'Invalid ✅' : 'Valid ❌'}`);
  Logger.log(`  "": ${invalidEmail2 ? 'Invalid ✅' : 'Valid ❌'}`);
  Logger.log(`  null: ${invalidEmail3 ? 'Invalid ✅' : 'Valid ❌'}`);
  Logger.log(`  Status: ${test4 ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test 5: Cache functionality
  Logger.log('Test 5: Cache functionality');
  UserResolver.clearUserCache(); // Clear first
  const firstCall = UserResolver.getCurrentUser();
  const firstMetadata = UserResolver.getLastDetection();
  const secondCall = UserResolver.getCurrentUser();
  const secondMetadata = UserResolver.getLastDetection();
  const test5 = firstCall === secondCall && secondMetadata.method === 'cached';
  Logger.log(`  First call method: ${firstMetadata.method}`);
  Logger.log(`  Second call method: ${secondMetadata.method}`);
  Logger.log(`  Status: ${test5 ? '✅ PASS (cache working)' : '❌ FAIL'}\n`);

  // Test 6: Manual email setting
  Logger.log('Test 6: Manual email setting');
  const manualEmail = 'manual@example.com';
  const setResult = UserResolver.setManualUserEmail(manualEmail);
  const retrievedEmail = UserResolver.getCurrentUser();
  const retrievedMetadata = UserResolver.getLastDetection();
  const test6 = setResult && retrievedEmail === manualEmail && retrievedMetadata.method === 'manual_override';
  Logger.log(`  Set email: ${manualEmail}`);
  Logger.log(`  Retrieved email: ${retrievedEmail}`);
  Logger.log(`  Method: ${retrievedMetadata.method}`);
  Logger.log(`  Status: ${test6 ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test 7: Cache clearing
  Logger.log('Test 7: Cache clearing');
  UserResolver.clearUserCache();
  const afterClearEmail = UserResolver.getCurrentUser();
  const afterClearMetadata = UserResolver.getLastDetection();
  const test7 = afterClearMetadata.method !== 'cached' && afterClearMetadata.method !== 'manual_override';
  Logger.log(`  After clear method: ${afterClearMetadata.method}`);
  Logger.log(`  Status: ${test7 ? '✅ PASS (cache cleared)' : '❌ FAIL'}\n`);

  // Summary
  const totalTests = 7;
  const passedTests = [test1, test2, test3, test4, test5, test6, test7].filter(Boolean).length;
  Logger.log('═══ Test Summary ═══');
  Logger.log(`Passed: ${passedTests}/${totalTests}`);
  Logger.log(`Status: ${passedTests === totalTests ? '✅ ALL TESTS PASSED' : '⚠️ SOME TESTS FAILED'}`);
}

/**
 * Menu option: Set My Email
 * Allows users to manually set their email if auto-detection fails
 */
function menuSetMyEmail() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    'Set My Email',
    'Enter your email address for user identification:',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const email = response.getResponseText().trim();

  if (!UserResolver.isValidEmail(email)) {
    ui.alert(
      'Invalid Email',
      `"${email}" is not a valid email address.`,
      ui.ButtonSet.OK
    );
    return;
  }

  const success = UserResolver.setManualUserEmail(email);

  if (success) {
    ui.alert(
      'Email Set Successfully',
      `Your email has been set to: ${email}\n\n` +
      'This will be used for all operations until cache expires (1 hour) or is cleared.',
      ui.ButtonSet.OK
    );
  } else {
    ui.alert(
      'Error',
      'Failed to set email. Please try again.',
      ui.ButtonSet.OK
    );
  }
}

/**
 * Menu option: Clear User Cache
 * For troubleshooting user identification issues
 */
function menuClearUserCache() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Clear User Cache',
    'This will clear your cached user identification.\n\n' +
    'Your email will be automatically detected again on the next operation.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  UserResolver.clearUserCache();

  ui.alert(
    'Cache Cleared',
    'User cache has been cleared successfully.\n\n' +
    'Your email will be automatically detected on the next operation.',
    ui.ButtonSet.OK
  );
}

/**
 * Menu option: Show User Info
 * For debugging user identification
 */
function menuShowUserInfo() {
  const ui = SpreadsheetApp.getUi();

  const metadata = UserResolver.getUserWithMetadata();
  const context = UserResolver.getExecutionContext();

  const message =
    `Current User: ${metadata.email}\n\n` +
    `Detection Method: ${metadata.method}\n` +
    `Execution Context: ${context}\n` +
    `Detected At: ${metadata.timestamp ? metadata.timestamp.toLocaleString() : 'N/A'}\n\n` +
    `─────────────────────\n` +
    `Detection Methods:\n` +
    `• session_active: From Session.getActiveUser()\n` +
    `• session_effective: From Session.getEffectiveUser()\n` +
    `• user_prompt: Manually entered by user\n` +
    `• manual_override: Set via "Set My Email" menu\n` +
    `• cached: Retrieved from cache\n` +
    `• default_fallback: All methods failed`;

  ui.alert('User Identification Info', message, ui.ButtonSet.OK);
}
