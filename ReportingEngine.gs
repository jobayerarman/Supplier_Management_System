// @ts-nocheck
// ==================== MODULE: ReportingEngine.gs ====================
/**
 * Reporting Engine for WhatsApp integration
 * Aggregates invoice and payment data for daily, weekly, and monthly reports
 *
 * ARCHITECTURE:
 * - Uses existing cached data (InvoiceCache, PaymentCache) for performance
 * - Reads daily sheets for transaction-level reporting
 * - Calculates collection efficiency and aging buckets
 * - Returns structured data for text and PDF formatting
 *
 * RETURN FORMAT: {success: boolean, data: Object, error: string}
 */

const ReportingEngine = {
  // ═══════════════════════════════════════════════════════════════════════════
  // DAILY REPORTING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate daily report from specified date's daily sheet
   * @param {string|Date} dateStr - Date to report on (defaults to yesterday)
   * @returns {Object} {success, data: {date, totalPosted, invoices, payments, byType, topSuppliers, warnings}, error}
   */
  generateDailyReport: function(dateStr = null) {
    try {
      // Default to yesterday if not specified
      let targetDate;
      if (dateStr) {
        targetDate = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
      } else {
        targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - 1); // Yesterday
      }

      // Get day number (1-31) for sheet name
      const dayNum = targetDate.getDate();
      const sheetName = dayNum.toString().padStart(2, '0');

      // Check if sheet is valid daily sheet
      if (!CONFIG.dailySheets.includes(sheetName)) {
        return {
          success: false,
          data: null,
          error: `Invalid daily sheet: ${sheetName}`
        };
      }

      // Get daily sheet
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(sheetName);

      if (!sheet) {
        return {
          success: false,
          data: null,
          error: `Daily sheet not found: ${sheetName}`
        };
      }

      // Read all data from sheet (starting from data row)
      const lastRow = sheet.getLastRow();
      if (lastRow < CONFIG.dataStartRow) {
        // No data in sheet
        return {
          success: true,
          data: {
            date: DateUtils.formatDate(targetDate),
            totalPosted: 0,
            invoices: { count: 0, amount: 0 },
            payments: { count: 0, amount: 0 },
            byType: {},
            topSuppliers: [],
            warnings: []
          },
          error: null
        };
      }

      const dataRange = sheet.getRange(CONFIG.dataStartRow, 1, lastRow - CONFIG.dataStartRow + 1, CONFIG.cols.sysId + 1);
      const allData = dataRange.getValues();

      // Process posted rows
      const stats = this._processPostedRows(allData);

      // Format result
      return {
        success: true,
        data: {
          date: DateUtils.formatDate(targetDate),
          dayOfWeek: targetDate.toLocaleDateString('en-US', { weekday: 'long' }),
          totalPosted: stats.totalPosted,
          invoices: stats.invoices,
          payments: stats.payments,
          byType: stats.byType,
          topSuppliers: stats.topSuppliers,
          warnings: stats.warnings
        },
        error: null
      };

    } catch (error) {
      AuditLogger.logError('DAILY_REPORT_ERROR', error.toString());
      return {
        success: false,
        data: null,
        error: `Daily report generation failed: ${error.toString()}`
      };
    }
  },

  /**
   * Process posted rows from daily sheet data
   * @private
   * @param {Array[]} allData - Sheet data array
   * @returns {Object} Aggregated statistics
   */
  _processPostedRows: function(allData) {
    const col = CONFIG.cols;
    let totalPosted = 0;
    let invoiceCount = 0, invoiceAmount = 0;
    let paymentCount = 0, paymentAmount = 0;
    const byType = {};
    const supplierTotals = {};
    const warnings = [];

    for (let i = 0; i < allData.length; i++) {
      const row = allData[i];

      // Check if row is posted (checkbox column)
      const isPosted = row[col.post] === true || row[col.post] === 'TRUE';
      if (!isPosted) continue;

      // Check if status is POSTED (not ERROR)
      const status = row[col.status];
      if (!status || !status.toString().toUpperCase().includes('POSTED')) {
        if (status && status.toString().toUpperCase().includes('ERROR')) {
          warnings.push(`Row ${CONFIG.dataStartRow + i}: ${status}`);
        }
        continue;
      }

      totalPosted++;

      // Extract data
      const supplier = StringUtils.normalize(row[col.supplier]);
      const paymentType = row[col.paymentType];
      const receivedAmt = parseFloat(row[col.receivedAmt]) || 0;
      const paymentAmt = parseFloat(row[col.paymentAmt]) || 0;

      // Count invoices (receivedAmt > 0)
      if (receivedAmt > 0) {
        invoiceCount++;
        invoiceAmount += receivedAmt;
      }

      // Count payments (paymentAmt > 0)
      if (paymentAmt > 0) {
        paymentCount++;
        paymentAmount += paymentAmt;
      }

      // Aggregate by payment type
      if (paymentType) {
        if (!byType[paymentType]) {
          byType[paymentType] = { count: 0, invoiceAmt: 0, paymentAmt: 0 };
        }
        byType[paymentType].count++;
        byType[paymentType].invoiceAmt += receivedAmt;
        byType[paymentType].paymentAmt += paymentAmt;
      }

      // Aggregate by supplier
      if (supplier) {
        if (!supplierTotals[supplier]) {
          supplierTotals[supplier] = { invoiceAmt: 0, paymentAmt: 0 };
        }
        supplierTotals[supplier].invoiceAmt += receivedAmt;
        supplierTotals[supplier].paymentAmt += paymentAmt;
      }
    }

    // Get top 5 suppliers by total transaction amount
    const topSuppliers = Object.entries(supplierTotals)
      .map(([name, amounts]) => ({
        name: name,
        invoiceAmt: amounts.invoiceAmt,
        paymentAmt: amounts.paymentAmt,
        total: amounts.invoiceAmt + amounts.paymentAmt
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return {
      totalPosted: totalPosted,
      invoices: { count: invoiceCount, amount: invoiceAmount },
      payments: { count: paymentCount, amount: paymentAmount },
      byType: byType,
      topSuppliers: topSuppliers,
      warnings: warnings
    };
  },

  /**
   * Format daily report as WhatsApp text message
   * @param {Object} reportData - Data from generateDailyReport()
   * @returns {string} Formatted text message
   */
  formatDailyTextReport: function(reportData) {
    if (!reportData || !reportData.data) {
      return '❌ *Daily Report Error*\nNo data available';
    }

    const data = reportData.data;
    let text = `📊 *Daily Summary - ${data.date}*\n`;
    text += `${data.dayOfWeek}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Overview
    text += `✅ *Posted Transactions: ${data.totalPosted}*\n\n`;

    // Invoices
    text += `📥 *Invoices*\n`;
    text += `Count: ${data.invoices.count}\n`;
    text += `Amount: ৳${data.invoices.amount.toLocaleString('en-BD')}\n\n`;

    // Payments
    text += `💰 *Payments*\n`;
    text += `Count: ${data.payments.count}\n`;
    text += `Amount: ৳${data.payments.amount.toLocaleString('en-BD')}\n\n`;

    // By Type
    if (Object.keys(data.byType).length > 0) {
      text += `📋 *By Type*\n`;
      for (const [type, stats] of Object.entries(data.byType)) {
        text += `${type}: ${stats.count} (৳${(stats.invoiceAmt + stats.paymentAmt).toLocaleString('en-BD')})\n`;
      }
      text += `\n`;
    }

    // Top Suppliers
    if (data.topSuppliers.length > 0) {
      text += `🏆 *Top Suppliers*\n`;
      data.topSuppliers.forEach((supplier, index) => {
        text += `${index + 1}. ${supplier.name}\n`;
        text += `   ৳${supplier.total.toLocaleString('en-BD')}\n`;
      });
      text += `\n`;
    }

    // Warnings
    if (data.warnings.length > 0) {
      text += `⚠️ *Warnings: ${data.warnings.length}*\n`;
      // Show first 3 warnings only
      data.warnings.slice(0, 3).forEach(warning => {
        text += `• ${warning}\n`;
      });
      if (data.warnings.length > 3) {
        text += `• ...and ${data.warnings.length - 3} more\n`;
      }
    }

    return text;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WEEKLY REPORTING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate weekly report (aggregates 7 days of daily reports)
   * @param {Date} endDate - End date of week (defaults to yesterday)
   * @returns {Object} {success, data: {period, daily, totals, collectionEfficiency, outstanding}, error}
   */
  generateWeeklyReport: function(endDate = null) {
    try {
      // Default to yesterday as end date
      if (!endDate) {
        endDate = new Date();
        endDate.setDate(endDate.getDate() - 1);
      }

      // Calculate start date (7 days before end date)
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);

      // Generate daily reports for each day in range
      const dailyReports = [];
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const dailyReport = this.generateDailyReport(new Date(currentDate));
        if (dailyReport.success) {
          dailyReports.push(dailyReport.data);
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Aggregate weekly totals
      const totals = {
        posted: 0,
        invoices: { count: 0, amount: 0 },
        payments: { count: 0, amount: 0 }
      };

      dailyReports.forEach(day => {
        totals.posted += day.totalPosted;
        totals.invoices.count += day.invoices.count;
        totals.invoices.amount += day.invoices.amount;
        totals.payments.count += day.payments.count;
        totals.payments.amount += day.payments.amount;
      });

      // Calculate collection efficiency (payments / invoices * 100)
      const collectionEfficiency = totals.invoices.amount > 0 ?
        (totals.payments.amount / totals.invoices.amount * 100).toFixed(1) :
        0;

      // Get total outstanding from BalanceCalculator
      const outstanding = this._calculateTotalOutstanding();

      return {
        success: true,
        data: {
          period: {
            start: DateUtils.formatDate(startDate),
            end: DateUtils.formatDate(endDate)
          },
          daily: dailyReports,
          totals: totals,
          collectionEfficiency: parseFloat(collectionEfficiency),
          outstanding: outstanding
        },
        error: null
      };

    } catch (error) {
      AuditLogger.logError('WEEKLY_REPORT_ERROR', error.toString());
      return {
        success: false,
        data: null,
        error: `Weekly report generation failed: ${error.toString()}`
      };
    }
  },

  /**
   * Format weekly report as WhatsApp text summary
   * @param {Object} reportData - Data from generateWeeklyReport()
   * @returns {string} Formatted text message
   */
  formatWeeklyTextReport: function(reportData) {
    if (!reportData || !reportData.data) {
      return '❌ *Weekly Report Error*\nNo data available';
    }

    const data = reportData.data;
    let text = `📈 *Weekly Summary*\n`;
    text += `${data.period.start} - ${data.period.end}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Totals
    text += `✅ *Total Transactions: ${data.totals.posted}*\n\n`;

    text += `📥 *Invoices*\n`;
    text += `Count: ${data.totals.invoices.count}\n`;
    text += `Amount: ৳${data.totals.invoices.amount.toLocaleString('en-BD')}\n\n`;

    text += `💰 *Payments*\n`;
    text += `Count: ${data.totals.payments.count}\n`;
    text += `Amount: ৳${data.totals.payments.amount.toLocaleString('en-BD')}\n\n`;

    text += `📊 *Collection Efficiency*\n`;
    text += `${data.collectionEfficiency}%\n\n`;

    text += `💼 *Total Outstanding*\n`;
    text += `৳${data.outstanding.toLocaleString('en-BD')}\n\n`;

    text += `📄 *Detailed PDF report attached*`;

    return text;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MONTHLY REPORTING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate monthly report (uses cached statistics)
   * @param {number} year - Year (defaults to current)
   * @param {number} month - Month 1-12 (defaults to current)
   * @returns {Object} {success, data: {period, invoices, payments, aging, outstanding}, error}
   */
  generateMonthlyReport: function(year = null, month = null) {
    try {
      // Default to current month if not specified
      const now = new Date();
      if (!year) year = now.getFullYear();
      if (!month) month = now.getMonth() + 1; // getMonth() returns 0-11

      // Get month name
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
      const monthName = monthNames[month - 1];

      // Get invoice data from cache for aging analysis
      const invoiceCache = CacheManager.getInvoiceData();
      const aging = this._calculateAgingBuckets(invoiceCache);

      // Get total outstanding
      const outstanding = this._calculateTotalOutstanding();

      // Get invoice and payment statistics (month-to-date from caches)
      // Note: This gets ALL invoices/payments, not just current month
      // For true monthly filtering, would need to add date filtering logic
      const invoiceStats = {
        total: invoiceCache.activeData.length + invoiceCache.inactiveData.length - 2, // -2 for headers
        active: invoiceCache.activeData.length - 1, // -1 for header
        paid: invoiceCache.inactiveData.length - 1,
        totalAmount: this._sumInvoiceAmounts(invoiceCache)
      };

      // Get payment statistics
      const paymentCache = PaymentManager.PaymentCache.getPaymentData();
      const paymentStats = {
        count: paymentCache.data.length - 1, // -1 for header
        totalAmount: this._sumPaymentAmounts(paymentCache)
      };

      return {
        success: true,
        data: {
          period: {
            month: monthName,
            year: year
          },
          invoices: invoiceStats,
          payments: paymentStats,
          aging: aging,
          outstanding: outstanding
        },
        error: null
      };

    } catch (error) {
      AuditLogger.logError('MONTHLY_REPORT_ERROR', error.toString());
      return {
        success: false,
        data: null,
        error: `Monthly report generation failed: ${error.toString()}`
      };
    }
  },

  /**
   * Format monthly report as WhatsApp text summary
   * @param {Object} reportData - Data from generateMonthlyReport()
   * @returns {string} Formatted text message
   */
  formatMonthlyTextReport: function(reportData) {
    if (!reportData || !reportData.data) {
      return '❌ *Monthly Report Error*\nNo data available';
    }

    const data = reportData.data;
    let text = `📅 *Monthly Summary*\n`;
    text += `${data.period.month} ${data.period.year}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Invoice Stats
    text += `📥 *Invoices*\n`;
    text += `Total: ${data.invoices.total}\n`;
    text += `Active: ${data.invoices.active}\n`;
    text += `Paid: ${data.invoices.paid}\n`;
    text += `Amount: ৳${data.invoices.totalAmount.toLocaleString('en-BD')}\n\n`;

    // Payment Stats
    text += `💰 *Payments*\n`;
    text += `Count: ${data.payments.count}\n`;
    text += `Amount: ৳${data.payments.totalAmount.toLocaleString('en-BD')}\n\n`;

    // Outstanding
    text += `💼 *Total Outstanding*\n`;
    text += `৳${data.outstanding.toLocaleString('en-BD')}\n\n`;

    // Aging
    text += `⏳ *Aging Analysis*\n`;
    text += `0-30 days: ৳${data.aging.bucket_0_30.toLocaleString('en-BD')}\n`;
    text += `31-60 days: ৳${data.aging.bucket_31_60.toLocaleString('en-BD')}\n`;
    text += `61-90 days: ৳${data.aging.bucket_61_90.toLocaleString('en-BD')}\n`;
    text += `90+ days: ৳${data.aging.bucket_90_plus.toLocaleString('en-BD')}\n\n`;

    text += `📄 *Detailed PDF dashboard attached*`;

    return text;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate aging buckets from invoice cache
   * @private
   * @param {Object} invoiceCache - Invoice cache data
   * @returns {Object} Aging buckets
   */
  _calculateAgingBuckets: function(invoiceCache) {
    const aging = {
      bucket_0_30: 0,
      bucket_31_60: 0,
      bucket_61_90: 0,
      bucket_90_plus: 0
    };

    const col = CONFIG.invoiceCols;
    const now = new Date();

    // Process active invoices only (unpaid/partial)
    for (let i = 1; i < invoiceCache.activeData.length; i++) {
      const invoice = invoiceCache.activeData[i];
      const balanceDue = parseFloat(invoice[col.balanceDue]) || 0;

      if (balanceDue <= CONFIG.constants.FULLY_PAID_THRESHOLD) continue;

      // Calculate days outstanding
      const invoiceDate = new Date(invoice[col.invoiceDate]);
      const daysOutstanding = Math.floor((now - invoiceDate) / (1000 * 60 * 60 * 24));

      // Categorize into buckets
      if (daysOutstanding <= 30) {
        aging.bucket_0_30 += balanceDue;
      } else if (daysOutstanding <= 60) {
        aging.bucket_31_60 += balanceDue;
      } else if (daysOutstanding <= 90) {
        aging.bucket_61_90 += balanceDue;
      } else {
        aging.bucket_90_plus += balanceDue;
      }
    }

    return aging;
  },

  /**
   * Calculate total outstanding from invoice cache
   * @private
   * @returns {number} Total outstanding amount
   */
  _calculateTotalOutstanding: function() {
    try {
      const invoiceCache = CacheManager.getInvoiceData();
      const col = CONFIG.invoiceCols;
      let total = 0;

      // Sum balance due from active invoices only
      for (let i = 1; i < invoiceCache.activeData.length; i++) {
        const balanceDue = parseFloat(invoiceCache.activeData[i][col.balanceDue]) || 0;
        if (balanceDue > CONFIG.constants.FULLY_PAID_THRESHOLD) {
          total += balanceDue;
        }
      }

      return total;
    } catch (error) {
      Logger.log(`Error calculating outstanding: ${error.toString()}`);
      return 0;
    }
  },

  /**
   * Sum total invoice amounts from cache
   * @private
   * @param {Object} invoiceCache - Invoice cache data
   * @returns {number} Total invoice amount
   */
  _sumInvoiceAmounts: function(invoiceCache) {
    const col = CONFIG.invoiceCols;
    let total = 0;

    // Sum from both partitions
    for (let i = 1; i < invoiceCache.activeData.length; i++) {
      total += parseFloat(invoiceCache.activeData[i][col.invoiceAmt]) || 0;
    }
    for (let i = 1; i < invoiceCache.inactiveData.length; i++) {
      total += parseFloat(invoiceCache.inactiveData[i][col.invoiceAmt]) || 0;
    }

    return total;
  },

  /**
   * Sum total payment amounts from cache
   * @private
   * @param {Object} paymentCache - Payment cache data
   * @returns {number} Total payment amount
   */
  _sumPaymentAmounts: function(paymentCache) {
    const col = CONFIG.paymentCols;
    let total = 0;

    for (let i = 1; i < paymentCache.data.length; i++) {
      total += parseFloat(paymentCache.data[i][col.paymentAmt]) || 0;
    }

    return total;
  }
};
