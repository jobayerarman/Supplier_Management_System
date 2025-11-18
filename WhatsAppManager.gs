// @ts-nocheck
// ==================== MODULE: WhatsAppManager.gs ====================
/**
 * WhatsApp Cloud API integration module
 * Handles sending text messages, media uploads, and document delivery via WhatsApp Business API
 *
 * CONFIGURATION REQUIREMENTS:
 * - WA_ACCESS_TOKEN: Meta access token (from Meta Business Account)
 * - WA_PHONE_NUMBER_ID: WhatsApp Business Phone Number ID
 * - REPORT_RECIPIENT_PHONE: Recipient phone number (format: 8801711123456, no + prefix)
 *
 * API DOCUMENTATION: https://developers.facebook.com/docs/whatsapp/cloud-api
 * FREE TIER: 1,000 business-initiated conversations/month
 *
 * RETURN FORMAT: All functions return {success: boolean, data: Object, error: string}
 */

const WhatsAppManager = {
  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  config: {
    accessToken: null,        // Lazy-loaded from Script Properties
    phoneNumberId: null,      // Lazy-loaded from Script Properties
    apiVersion: 'v18.0',      // WhatsApp Cloud API version
    baseUrl: 'https://graph.facebook.com'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lazy-load configuration from Script Properties
   * @private
   */
  _loadConfig: function() {
    if (!this.config.accessToken) {
      const props = PropertiesService.getScriptProperties();
      this.config.accessToken = props.getProperty('WA_ACCESS_TOKEN');
      this.config.phoneNumberId = props.getProperty('WA_PHONE_NUMBER_ID');
    }
  },

  /**
   * Get base URL for WhatsApp API calls
   * @private
   * @returns {string} Base API URL with version and phone number ID
   */
  _getApiUrl: function() {
    this._loadConfig();
    return `${this.config.baseUrl}/${this.config.apiVersion}/${this.config.phoneNumberId}`;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE API FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Send text message via WhatsApp
   * @param {string} to - Recipient phone number (format: 8801711123456, no + or spaces)
   * @param {string} message - Text message to send (max 4096 characters)
   * @returns {Object} {success: boolean, data: Object, error: string}
   */
  sendTextMessage: function(to, message) {
    try {
      // Validate configuration
      const configValidation = this.validateConfig();
      if (!configValidation.success) {
        return configValidation;
      }

      // Validate inputs
      if (!to || !message) {
        return {
          success: false,
          data: null,
          error: 'Missing required parameters: to and message are required'
        };
      }

      // Sanitize phone number (remove +, spaces, hyphens)
      const sanitizedPhone = to.replace(/[\s\+\-]/g, '');

      // Truncate message if too long
      const truncatedMessage = message.length > 4096 ? message.substring(0, 4093) + '...' : message;

      // Build request payload
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizedPhone,
        type: 'text',
        text: {
          preview_url: false,
          body: truncatedMessage
        }
      };

      // Make API request
      const url = `${this._getApiUrl()}/messages`;
      const options = {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };

      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const responseData = JSON.parse(response.getContentText());

      // Check response
      if (responseCode === 200 && responseData.messages && responseData.messages.length > 0) {
        // Success
        AuditLogger.logInfo('WHATSAPP_MESSAGE_SENT', `Text message sent to ${sanitizedPhone}`);
        return {
          success: true,
          data: {
            messageId: responseData.messages[0].id,
            recipient: sanitizedPhone
          },
          error: null
        };
      } else {
        // API error
        const errorMsg = responseData.error ?
          `${responseData.error.message} (Code: ${responseData.error.code})` :
          'Unknown API error';

        AuditLogger.logError('WHATSAPP_SEND_FAILED', errorMsg);
        return {
          success: false,
          data: responseData,
          error: errorMsg
        };
      }

    } catch (error) {
      AuditLogger.logError('WHATSAPP_MESSAGE_ERROR', error.toString());
      return {
        success: false,
        data: null,
        error: `Exception: ${error.toString()}`
      };
    }
  },

  /**
   * Upload media file to WhatsApp servers
   * @param {Blob} fileBlob - File blob to upload
   * @param {string} mimeType - MIME type (e.g., 'application/pdf', 'image/jpeg')
   * @returns {Object} {success: boolean, mediaId: string, error: string}
   */
  uploadMedia: function(fileBlob, mimeType) {
    try {
      // Validate configuration
      const configValidation = this.validateConfig();
      if (!configValidation.success) {
        return configValidation;
      }

      // Validate inputs
      if (!fileBlob) {
        return {
          success: false,
          mediaId: null,
          error: 'Missing required parameter: fileBlob is required'
        };
      }

      // Check file size (max 16MB for documents, 5MB for images)
      const fileSize = fileBlob.getBytes().length;
      const maxSize = mimeType.startsWith('image/') ? 5 * 1024 * 1024 : 16 * 1024 * 1024;

      if (fileSize > maxSize) {
        return {
          success: false,
          mediaId: null,
          error: `File too large: ${(fileSize / 1024 / 1024).toFixed(2)}MB (max ${maxSize / 1024 / 1024}MB)`
        };
      }

      // Build multipart form data
      const boundary = '----WebKitFormBoundary' + Utilities.getUuid().replace(/-/g, '');
      const payload = Utilities.newBlob(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="messaging_product"\r\n\r\n' +
        'whatsapp\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="file"; filename="' + fileBlob.getName() + '"\r\n' +
        'Content-Type: ' + mimeType + '\r\n\r\n'
      ).getBytes().concat(
        fileBlob.getBytes()
      ).concat(
        Utilities.newBlob('\r\n--' + boundary + '--\r\n').getBytes()
      );

      // Make API request
      const url = `${this._getApiUrl()}/media`;
      const options = {
        method: 'post',
        contentType: 'multipart/form-data; boundary=' + boundary,
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`
        },
        payload: payload,
        muteHttpExceptions: true
      };

      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const responseData = JSON.parse(response.getContentText());

      // Check response
      if (responseCode === 200 && responseData.id) {
        // Success
        AuditLogger.logInfo('WHATSAPP_MEDIA_UPLOADED', `Media uploaded: ${responseData.id} (${(fileSize / 1024).toFixed(2)}KB)`);
        return {
          success: true,
          mediaId: responseData.id,
          error: null
        };
      } else {
        // API error
        const errorMsg = responseData.error ?
          `${responseData.error.message} (Code: ${responseData.error.code})` :
          'Unknown API error';

        AuditLogger.logError('WHATSAPP_UPLOAD_FAILED', errorMsg);
        return {
          success: false,
          mediaId: null,
          error: errorMsg
        };
      }

    } catch (error) {
      AuditLogger.logError('WHATSAPP_UPLOAD_ERROR', error.toString());
      return {
        success: false,
        mediaId: null,
        error: `Exception: ${error.toString()}`
      };
    }
  },

  /**
   * Send document via WhatsApp (requires media to be uploaded first)
   * @param {string} to - Recipient phone number (format: 8801711123456, no + or spaces)
   * @param {string} mediaId - Media ID from uploadMedia()
   * @param {string} filename - Display filename for recipient
   * @param {string} caption - Optional caption (max 1024 characters)
   * @returns {Object} {success: boolean, data: Object, error: string}
   */
  sendDocument: function(to, mediaId, filename, caption = '') {
    try {
      // Validate configuration
      const configValidation = this.validateConfig();
      if (!configValidation.success) {
        return configValidation;
      }

      // Validate inputs
      if (!to || !mediaId || !filename) {
        return {
          success: false,
          data: null,
          error: 'Missing required parameters: to, mediaId, and filename are required'
        };
      }

      // Sanitize phone number
      const sanitizedPhone = to.replace(/[\s\+\-]/g, '');

      // Truncate caption if too long
      const truncatedCaption = caption.length > 1024 ? caption.substring(0, 1021) + '...' : caption;

      // Build request payload
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizedPhone,
        type: 'document',
        document: {
          id: mediaId,
          filename: filename
        }
      };

      // Add caption if provided
      if (truncatedCaption) {
        payload.document.caption = truncatedCaption;
      }

      // Make API request
      const url = `${this._getApiUrl()}/messages`;
      const options = {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };

      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const responseData = JSON.parse(response.getContentText());

      // Check response
      if (responseCode === 200 && responseData.messages && responseData.messages.length > 0) {
        // Success
        AuditLogger.logInfo('WHATSAPP_DOCUMENT_SENT', `Document sent to ${sanitizedPhone}: ${filename}`);
        return {
          success: true,
          data: {
            messageId: responseData.messages[0].id,
            recipient: sanitizedPhone,
            filename: filename
          },
          error: null
        };
      } else {
        // API error
        const errorMsg = responseData.error ?
          `${responseData.error.message} (Code: ${responseData.error.code})` :
          'Unknown API error';

        AuditLogger.logError('WHATSAPP_SEND_DOC_FAILED', errorMsg);
        return {
          success: false,
          data: responseData,
          error: errorMsg
        };
      }

    } catch (error) {
      AuditLogger.logError('WHATSAPP_DOCUMENT_ERROR', error.toString());
      return {
        success: false,
        data: null,
        error: `Exception: ${error.toString()}`
      };
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION & UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate WhatsApp configuration
   * @returns {Object} {success: boolean, data: Object, error: string}
   */
  validateConfig: function() {
    this._loadConfig();

    const missing = [];
    if (!this.config.accessToken) missing.push('WA_ACCESS_TOKEN');
    if (!this.config.phoneNumberId) missing.push('WA_PHONE_NUMBER_ID');

    if (missing.length > 0) {
      const errorMsg = `Missing WhatsApp configuration: ${missing.join(', ')}. Please run "Configure WhatsApp" from menu.`;
      return {
        success: false,
        data: { missingProperties: missing },
        error: errorMsg
      };
    }

    return {
      success: true,
      data: {
        configured: true,
        apiVersion: this.config.apiVersion
      },
      error: null
    };
  },

  /**
   * Get current configuration status (for debugging)
   * @returns {Object} Configuration details
   */
  getConfigStatus: function() {
    this._loadConfig();
    const props = PropertiesService.getScriptProperties();

    return {
      accessTokenSet: !!this.config.accessToken,
      phoneNumberIdSet: !!this.config.phoneNumberId,
      recipientSet: !!props.getProperty('REPORT_RECIPIENT_PHONE'),
      apiVersion: this.config.apiVersion,
      baseUrl: this.config.baseUrl
    };
  }
};
