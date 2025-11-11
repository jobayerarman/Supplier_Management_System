/**
 * UserResolver - Context-Aware User Identification for Google Sheets
 *
 * Provides reliable user identification across different execution contexts:
 * - Menu context (batch operations): Uses Session → Prompt if needed
 * - Trigger context (individual posts): Uses Session → Default if needed
 *
 * Features:
 * - Context-aware fallback chains
 * - Execution-scoped caching (in-memory, < 0.01ms)
 * - Session caching (UserProperties, 1-hour TTL)
 * - User prompt fallback for menu context
 * - Detection metadata for debugging
 * - Email validation
 * - Performance statistics tracking
 *
 * Version: 2.1 (Performance Optimized)
 * Last Updated: 2025-11-10
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

  // ═══ EXECUTION-SCOPED CACHE (In-Memory, High Performance) ═══
  // This cache persists only for the duration of the current script execution
  // Automatically cleared when execution completes (Google Apps Script behavior)
  // Eliminates redundant UserProperties reads and Session API calls
  let _executionCache = {
    email: null,
    method: null,
    context: null,
    timestamp: null,
    isValid: false  // Simple flag - true if cache populated this execution
  };

  // ═══ PERFORMANCE STATISTICS ═══
  const _stats = {
    executionCacheHits: 0,
    userPropertiesCacheHits: 0,
    sessionDetections: 0,
    promptFallbacks: 0,
    defaultFallbacks: 0,
    totalCalls: 0,
    avgExecutionCacheTime: 0,
    avgUserPropertiesCacheTime: 0,
    avgDetectionTime: 0
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

  // ═══════════════════════════════════════════════════════════════
  // EXECUTION-SCOPED CACHE HELPERS (In-Memory, High Performance)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get user from execution-scoped cache (in-memory)
   * Extremely fast (< 0.01ms) - no API calls, no property reads
   *
   * @returns {Object|null} Cached user object or null if not cached
   */
  function getExecutionCache() {
    if (_executionCache.isValid && _executionCache.email) {
      return {
        email: _executionCache.email,
        method: _executionCache.method + '_exec_cached',
        timestamp: _executionCache.timestamp
      };
    }
    return null;
  }

  /**
   * Set execution-scoped cache (in-memory)
   * Stores user for current execution only
   * Automatically cleared when script execution completes
   *
   * @param {string} email - User email to cache
   * @param {string} method - Detection method used
   */
  function setExecutionCache(email, method) {
    _executionCache = {
      email: email,
      method: method,
      context: getExecutionContext(),
      timestamp: new Date(),
      isValid: true
    };
  }

  /**
   * Clear execution-scoped cache
   * Useful for testing or forcing fresh detection
   */
  function clearExecutionCache() {
    _executionCache = {
      email: null,
      method: null,
      context: null,
      timestamp: null,
      isValid: false
    };
    // Also reset statistics for this execution
    Object.keys(_stats).forEach(key => _stats[key] = 0);
  }

  /**
   * Get performance statistics for current execution
   * @returns {Object} Statistics object with cache hits, timings, etc.
   */
  function getStatistics() {
    return {
      ..._stats,
      cacheHitRate: _stats.totalCalls > 0
        ? ((_stats.executionCacheHits + _stats.userPropertiesCacheHits) / _stats.totalCalls * 100).toFixed(1) + '%'
        : '0%',
      executionCacheEnabled: _executionCache.isValid
    };
  }

  /**
   * Reset performance statistics
   * Useful for benchmarking or testing
   */
  function resetStatistics() {
    Object.keys(_stats).forEach(key => _stats[key] = 0);
  }

  // ═══════════════════════════════════════════════════════════════
  // USER PROPERTIES CACHE HELPERS (Persistent, 1-hour TTL)
  // ═══════════════════════════════════════════════════════════════

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
   * Multi-level caching strategy for optimal performance:
   * 1. Execution-scoped cache (< 0.01ms) - in-memory
   * 2. UserProperties cache (3-5ms) - persistent, 1-hour TTL
   * 3. Session detection (20-40ms) - Session APIs
   * 4. User prompt (menu context only)
   * 5. Default fallback
   *
   * @returns {string} User email address
   */
  function getCurrentUser() {
    const startTime = Date.now();
    _stats.totalCalls++;

    try {
      // ═══ LEVEL 1: Execution-scoped cache (in-memory, < 0.01ms) ═══
      const execCached = getExecutionCache();
      if (execCached) {
        _stats.executionCacheHits++;
        const duration = Date.now() - startTime;
        _stats.avgExecutionCacheTime =
          (_stats.avgExecutionCacheTime * (_stats.executionCacheHits - 1) + duration)
          / _stats.executionCacheHits;

        lastDetection = {
          email: execCached.email,
          method: execCached.method,
          context: getExecutionContext(),
          timestamp: new Date()
        };
        return execCached.email;
      }

      // ═══ LEVEL 2: UserProperties cache (persistent, 3-5ms) ═══
      const cached = getCachedUser();
      if (cached) {
        _stats.userPropertiesCacheHits++;
        const duration = Date.now() - startTime;
        _stats.avgUserPropertiesCacheTime =
          (_stats.avgUserPropertiesCacheTime * (_stats.userPropertiesCacheHits - 1) + duration)
          / _stats.userPropertiesCacheHits;

        // Store in execution cache for subsequent calls
        setExecutionCache(cached.email, 'cached');

        lastDetection = {
          email: cached.email,
          method: 'cached',
          context: getExecutionContext(),
          timestamp: new Date()
        };
        return cached.email;
      }

      // ═══ LEVEL 3: Session detection (20-40ms) ═══
      const context = getExecutionContext();

      // Try Session.getActiveUser() first (works in most contexts)
      const sessionActive = getSessionActiveUser();
      if (sessionActive) {
        _stats.sessionDetections++;
        const duration = Date.now() - startTime;
        _stats.avgDetectionTime =
          (_stats.avgDetectionTime * (_stats.sessionDetections - 1) + duration)
          / _stats.sessionDetections;

        // Store in BOTH caches
        setCachedUser(sessionActive, 'session_active');
        setExecutionCache(sessionActive, 'session_active');

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
        _stats.sessionDetections++;
        const duration = Date.now() - startTime;
        _stats.avgDetectionTime =
          (_stats.avgDetectionTime * (_stats.sessionDetections - 1) + duration)
          / _stats.sessionDetections;

        // Store in BOTH caches
        setCachedUser(sessionEffective, 'session_effective');
        setExecutionCache(sessionEffective, 'session_effective');

        lastDetection = {
          email: sessionEffective,
          method: 'session_effective',
          context: context,
          timestamp: new Date()
        };
        return sessionEffective;
      }

      // ═══ LEVEL 4: User prompt (menu context only) ═══
      if (context === 'menu') {
        // In menu context, prompt user for identification
        const prompted = promptUserForIdentification();
        if (prompted) {
          _stats.promptFallbacks++;

          // Store in BOTH caches
          setCachedUser(prompted, 'user_prompt');
          setExecutionCache(prompted, 'user_prompt');

          lastDetection = {
            email: prompted,
            method: 'user_prompt',
            context: context,
            timestamp: new Date()
          };
          return prompted;
        }
      }

      // ═══ LEVEL 5: Default fallback ═══
      _stats.defaultFallbacks++;

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
      _stats.defaultFallbacks++;

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

    // Performance methods (v2.1)
    clearExecutionCache,
    getStatistics,
    resetStatistics,

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

/**
 * Diagnostic function: Test all user resolution methods
 * Run from Script Editor to diagnose user identification issues
 * Particularly useful for debugging shared environment problems
 *
 * Tests:
 * - Authorization context
 * - Session.getActiveUser()
 * - Session.getEffectiveUser()
 * - Session.getTemporaryActiveUserKey()
 * - Execution context detection
 * - Cache functionality
 * - Trigger type detection
 *
 * @returns {void} Results logged and shown in alert
 */
function diagnoseUserResolution() {
  const ui = SpreadsheetApp.getUi();
  const results = [];

  results.push('═══ USER RESOLUTION DIAGNOSTIC ═══\n');

  // Test 1: Authorization Info
  results.push('1. AUTHORIZATION CONTEXT:');
  try {
    const authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    const authStatus = authInfo.getAuthorizationStatus();
    const permUrl = authInfo.getAuthorizationUrl();

    results.push(`   Status: ${authStatus}`);
    results.push(`   Required: ${authStatus === ScriptApp.AuthorizationStatus.REQUIRED ? 'YES ⚠️' : 'NO ✅'}`);
    if (permUrl) {
      results.push(`   Auth URL: ${permUrl.substring(0, 50)}...`);
    }
  } catch (error) {
    results.push(`   ❌ Error: ${error.message}`);
  }
  results.push('');

  // Test 2: Execution Context
  results.push('2. EXECUTION CONTEXT:');
  try {
    const context = UserResolver.getExecutionContext();
    results.push(`   Context: ${context}`);
    results.push(`   Expected: 'direct' (running from editor)`);
  } catch (error) {
    results.push(`   ❌ Error: ${error.message}`);
  }
  results.push('');

  // Test 3: Session.getActiveUser()
  results.push('3. SESSION.GETACTIVEUSER():');
  try {
    const user = Session.getActiveUser();
    const email = user ? user.getEmail() : null;
    if (email && email.trim().length > 0) {
      results.push(`   ✅ Email: ${email}`);
      results.push(`   Valid: ${UserResolver.isValidEmail(email) ? 'YES' : 'NO'}`);
    } else {
      results.push(`   ⚠️ Empty or null email`);
      results.push(`   This is common in shared environments with simple triggers`);
    }
  } catch (error) {
    results.push(`   ❌ Error: ${error.message}`);
  }
  results.push('');

  // Test 4: Session.getEffectiveUser()
  results.push('4. SESSION.GETEFFECTIVEUSER():');
  try {
    const email = Session.getEffectiveUser().getEmail();
    if (email && email.trim().length > 0) {
      results.push(`   ✅ Email: ${email}`);
      results.push(`   Note: Often returns script owner, not actual user`);
    } else {
      results.push(`   ⚠️ Empty or null email`);
    }
  } catch (error) {
    results.push(`   ❌ Error: ${error.message}`);
  }
  results.push('');

  // Test 5: Session Token
  results.push('5. SESSION.GETTEMPORARYACTIVEUSERKEY():');
  try {
    const token = Session.getTemporaryActiveUserKey();
    if (token && token.length > 0) {
      results.push(`   ✅ Token: ${token.substring(0, 20)}...`);
      results.push(`   Length: ${token.length} chars`);
    } else {
      results.push(`   ⚠️ Empty token`);
    }
  } catch (error) {
    results.push(`   ❌ Error: ${error.message}`);
  }
  results.push('');

  // Test 6: UserResolver.getCurrentUser()
  results.push('6. USERRESOLVER.GETCURRENTUSER():');
  try {
    UserResolver.clearUserCache(); // Clear first for fresh test
    const email = UserResolver.getCurrentUser();
    const metadata = UserResolver.getLastDetection();
    results.push(`   Email: ${email}`);
    results.push(`   Method: ${metadata.method}`);
    results.push(`   Context: ${metadata.context}`);

    if (email === 'default@google.com') {
      results.push(`   ⚠️ USING DEFAULT FALLBACK - This is the reported bug!`);
    }
  } catch (error) {
    results.push(`   ❌ Error: ${error.message}`);
  }
  results.push('');

  // Test 7: Trigger Detection
  results.push('7. TRIGGER SETUP:');
  try {
    const ss = SpreadsheetApp.getActive();
    const triggers = ScriptApp.getUserTriggers(ss);
    const editTriggers = triggers.filter(t => t.getEventType() === ScriptApp.EventType.ON_EDIT);

    results.push(`   Total triggers: ${triggers.length}`);
    results.push(`   Edit triggers: ${editTriggers.length}`);

    if (editTriggers.length === 0) {
      results.push(`   ⚠️ NO INSTALLABLE EDIT TRIGGER FOUND`);
      results.push(`   → This causes the bug in shared environments!`);
      results.push(`   → Run setupInstallableEditTrigger() to fix`);
    } else {
      editTriggers.forEach((trigger, i) => {
        results.push(`   Trigger ${i + 1}: ${trigger.getHandlerFunction()}`);
      });
      results.push(`   ✅ Installable trigger is set up`);
    }
  } catch (error) {
    results.push(`   ❌ Error: ${error.message}`);
  }
  results.push('');

  // Summary and recommendations
  results.push('═══ DIAGNOSIS SUMMARY ═══');

  const hasActiveUser = results.join('\n').includes('SESSION.GETACTIVEUSER():\n   ✅');
  const hasInstallableTrigger = results.join('\n').includes('✅ Installable trigger is set up');
  const usingDefaultFallback = results.join('\n').includes('USING DEFAULT FALLBACK');

  if (usingDefaultFallback) {
    results.push('❌ BUG CONFIRMED: Using default@google.com\n');

    if (!hasInstallableTrigger) {
      results.push('ROOT CAUSE: No installable Edit trigger');
      results.push('SOLUTION:');
      results.push('1. Run: setupInstallableEditTrigger()');
      results.push('2. Authorize when prompted');
      results.push('3. Test again with diagnoseUserResolution()');
    } else if (!hasActiveUser) {
      results.push('ROOT CAUSE: Session.getActiveUser() failing');
      results.push('POSSIBLE ISSUES:');
      results.push('• User lacks authorization to the script');
      results.push('• Script permissions not properly granted');
      results.push('• Running in limited execution context');
      results.push('\nSOLUTION:');
      results.push('1. Each user must authorize the script');
      results.push('2. Use "Set My Email" menu option as workaround');
    }
  } else if (hasActiveUser && hasInstallableTrigger) {
    results.push('✅ USER RESOLUTION WORKING CORRECTLY');
  } else {
    results.push('⚠️ PARTIAL SETUP - May work in some contexts');
  }

  const message = results.join('\n');

  // Log to console for detailed analysis
  Logger.log(message);

  // Show in alert (truncated if too long)
  const maxLength = 1800;
  const displayMessage = message.length > maxLength
    ? message.substring(0, maxLength) + '\n\n... (see Logs for full output)'
    : message;

  ui.alert('User Resolution Diagnostic', displayMessage, ui.ButtonSet.OK);
}

/**
 * Benchmark UserResolver performance with execution-scoped cache
 * Run from Script Editor to measure cache effectiveness
 *
 * Tests:
 * - Performance of 200 consecutive getCurrentUser() calls
 * - Cache hit rate
 * - Average timing per cache level
 * - Overall performance improvement
 *
 * @returns {void} Results logged to console
 */
function benchmarkUserResolver() {
  const iterations = 200;
  Logger.log('═══ UserResolver Performance Benchmark ═══\n');

  // Warm up (ensure user is detected)
  UserResolver.clearUserCache();
  UserResolver.clearExecutionCache();
  UserResolver.getCurrentUser();

  Logger.log('Starting benchmark with ' + iterations + ' iterations...\n');

  // Clear caches and statistics
  UserResolver.clearUserCache();
  UserResolver.clearExecutionCache();
  UserResolver.resetStatistics();

  // Run benchmark
  const startTime = Date.now();

  for (let i = 0; i < iterations; i++) {
    UserResolver.getCurrentUser();
  }

  const duration = Date.now() - startTime;
  const avgTime = duration / iterations;

  // Get statistics
  const stats = UserResolver.getStatistics();

  // Display results
  Logger.log('═══ BENCHMARK RESULTS ═══');
  Logger.log('Total Iterations: ' + iterations);
  Logger.log('Total Duration: ' + duration + 'ms');
  Logger.log('Average per call: ' + avgTime.toFixed(2) + 'ms');
  Logger.log('');

  Logger.log('═══ CACHE PERFORMANCE ═══');
  Logger.log('Execution Cache Hits: ' + stats.executionCacheHits + ' (' +
    (stats.executionCacheHits / iterations * 100).toFixed(1) + '%)');
  Logger.log('UserProperties Cache Hits: ' + stats.userPropertiesCacheHits + ' (' +
    (stats.userPropertiesCacheHits / iterations * 100).toFixed(1) + '%)');
  Logger.log('Session Detections: ' + stats.sessionDetections);
  Logger.log('Cache Hit Rate: ' + stats.cacheHitRate);
  Logger.log('');

  Logger.log('═══ TIMING BREAKDOWN ═══');
  Logger.log('Avg Execution Cache Time: ' + stats.avgExecutionCacheTime.toFixed(4) + 'ms');
  Logger.log('Avg UserProperties Cache Time: ' + stats.avgUserPropertiesCacheTime.toFixed(2) + 'ms');
  Logger.log('Avg Detection Time: ' + (stats.avgDetectionTime || 0).toFixed(2) + 'ms');
  Logger.log('');

  Logger.log('═══ PERFORMANCE ANALYSIS ═══');

  // Calculate expected time without execution cache
  // First call: Session detection (or UserProperties if cache existed)
  // Remaining calls: Would hit UserProperties cache at ~4ms each
  const estimatedUserPropsCacheTime = stats.avgUserPropertiesCacheTime || 4; // Default 4ms if no UserProperties hits
  const firstCallTime = stats.sessionDetections > 0
    ? (stats.avgDetectionTime || 25)  // Session detection time
    : estimatedUserPropsCacheTime;     // Or UserProperties cache

  const remainingCalls = iterations - 1;
  const withoutExecCache = firstCallTime + (remainingCalls * estimatedUserPropsCacheTime);

  const improvement = withoutExecCache > 0
    ? ((withoutExecCache - duration) / withoutExecCache * 100)
    : 0;
  const timeSaved = withoutExecCache - duration;

  Logger.log('Expected without execution cache: ' + withoutExecCache.toFixed(0) + 'ms');
  Logger.log('  - First call (detection/cache): ' + firstCallTime.toFixed(0) + 'ms');
  Logger.log('  - Remaining ' + remainingCalls + ' calls (@4ms each): ' + (remainingCalls * estimatedUserPropsCacheTime).toFixed(0) + 'ms');
  Logger.log('Actual with execution cache: ' + duration + 'ms');
  Logger.log('  - First call: ~' + (duration - (stats.executionCacheHits * stats.avgExecutionCacheTime)).toFixed(0) + 'ms');
  Logger.log('  - Remaining ' + stats.executionCacheHits + ' calls: ~' + (stats.executionCacheHits * stats.avgExecutionCacheTime).toFixed(1) + 'ms');
  Logger.log('Performance Improvement: ' + improvement.toFixed(1) + '% faster');
  Logger.log('Time Saved: ' + timeSaved.toFixed(0) + 'ms');
  Logger.log('');

  Logger.log('Note: Average of ' + avgTime.toFixed(2) + 'ms per call includes statistics tracking overhead');
  Logger.log('Pure execution cache hits are < 0.1ms; overhead is from Date.now() and stats tracking');
  Logger.log('');

  Logger.log('═══ REAL-WORLD IMPACT ═══');
  Logger.log('100-row batch operation:');
  Logger.log('  Without optimization: ~' + ((stats.avgUserPropertiesCacheTime || 4) * 100).toFixed(0) + 'ms');
  Logger.log('  With optimization: ~' + (avgTime * 100).toFixed(1) + 'ms');
  Logger.log('  Savings: ~' + (((stats.avgUserPropertiesCacheTime || 4) * 100) - (avgTime * 100)).toFixed(0) + 'ms per batch');

  // Also show alert for convenience
  const ui = SpreadsheetApp.getUi();
  const summary =
    '═══ Performance Benchmark ═══\n\n' +
    iterations + ' calls in ' + duration + 'ms\n' +
    'Average: ' + avgTime.toFixed(2) + 'ms per call\n\n' +
    '═══ Cache Stats ═══\n' +
    'Execution Cache: ' + stats.executionCacheHits + ' hits\n' +
    'UserProperties Cache: ' + stats.userPropertiesCacheHits + ' hits\n' +
    'Cache Hit Rate: ' + stats.cacheHitRate + '\n\n' +
    '═══ Performance ═══\n' +
    'Improvement: ' + improvement.toFixed(1) + '% faster\n' +
    'Time Saved: ' + (withoutExecCache - duration).toFixed(0) + 'ms\n\n' +
    'See Logs for detailed breakdown';

  ui.alert('UserResolver Benchmark', summary, ui.ButtonSet.OK);
}

