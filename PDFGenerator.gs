// @ts-nocheck
// ==================== MODULE: PDFGenerator.gs ====================
/**
 * PDF Generator for WhatsApp Reports
 * Creates formatted PDF documents from report data
 *
 * ARCHITECTURE:
 * - Creates temporary Google Doc for formatting
 * - Converts to PDF blob
 * - Cleans up temporary file
 * - Returns PDF blob ready for upload
 *
 * SIZE LIMIT: WhatsApp documents limited to 16MB
 */

const PDFGenerator = {
  // ═══════════════════════════════════════════════════════════════════════════
  // WEEKLY PDF GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create weekly PDF report
   * @param {Object} reportData - Data from ReportingEngine.generateWeeklyReport()
   * @returns {Blob} PDF file blob
   */
  createWeeklyPDF: function(reportData) {
    let tempDocId = null;

    try {
      if (!reportData || !reportData.data) {
        throw new Error('Invalid report data');
      }

      const data = reportData.data;

      // Create temporary Google Doc
      const docName = `Weekly_Report_${data.period.start}_to_${data.period.end}`;
      const doc = DocumentApp.create(docName);
      tempDocId = doc.getId();
      const body = doc.getBody();

      // Clear default content
      body.clear();

      // ═══ HEADER ═══
      const title = body.appendParagraph('WEEKLY SUMMARY REPORT');
      title.setHeading(DocumentApp.ParagraphHeading.HEADING1);
      title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

      const period = body.appendParagraph(`${data.period.start} - ${data.period.end}`);
      period.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      period.setSpacingAfter(20);

      // ═══ OVERVIEW SECTION ═══
      this._addSectionHeader(body, 'Overview');

      const overviewTable = body.appendTable([
        ['Total Transactions', data.totals.posted.toString()],
        ['Invoice Count', data.totals.invoices.count.toString()],
        ['Invoice Amount', '৳' + data.totals.invoices.amount.toLocaleString('en-BD')],
        ['Payment Count', data.totals.payments.count.toString()],
        ['Payment Amount', '৳' + data.totals.payments.amount.toLocaleString('en-BD')],
        ['Collection Efficiency', data.collectionEfficiency + '%'],
        ['Total Outstanding', '৳' + data.outstanding.toLocaleString('en-BD')]
      ]);

      this._styleTable(overviewTable);
      body.appendParagraph('').setSpacingAfter(15);

      // ═══ DAILY BREAKDOWN SECTION ═══
      this._addSectionHeader(body, 'Daily Breakdown');

      // Create daily breakdown table
      const dailyHeaders = ['Date', 'Day', 'Posted', 'Invoices', 'Payments'];
      const dailyRows = [dailyHeaders];

      data.daily.forEach(day => {
        dailyRows.push([
          day.date,
          day.dayOfWeek,
          day.totalPosted.toString(),
          `${day.invoices.count} (৳${day.invoices.amount.toLocaleString('en-BD')})`,
          `${day.payments.count} (৳${day.payments.amount.toLocaleString('en-BD')})`
        ]);
      });

      const dailyTable = body.appendTable(dailyRows);
      this._styleTable(dailyTable, true); // true = has header row
      body.appendParagraph('').setSpacingAfter(15);

      // ═══ TOP SUPPLIERS SECTION (from last day) ═══
      if (data.daily.length > 0) {
        const lastDay = data.daily[data.daily.length - 1];
        if (lastDay.topSuppliers && lastDay.topSuppliers.length > 0) {
          this._addSectionHeader(body, 'Top Suppliers (Last Day)');

          const supplierHeaders = ['Rank', 'Supplier', 'Invoice Amt', 'Payment Amt', 'Total'];
          const supplierRows = [supplierHeaders];

          lastDay.topSuppliers.forEach((supplier, index) => {
            supplierRows.push([
              (index + 1).toString(),
              supplier.name,
              '৳' + supplier.invoiceAmt.toLocaleString('en-BD'),
              '৳' + supplier.paymentAmt.toLocaleString('en-BD'),
              '৳' + supplier.total.toLocaleString('en-BD')
            ]);
          });

          const supplierTable = body.appendTable(supplierRows);
          this._styleTable(supplierTable, true);
          body.appendParagraph('').setSpacingAfter(15);
        }
      }

      // ═══ FOOTER ═══
      const footer = body.appendParagraph(`Generated: ${DateUtils.now()}`);
      footer.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      footer.setFontSize(8);
      footer.setForegroundColor('#999999');

      // Save and close doc
      doc.saveAndClose();

      // Convert to PDF
      const pdfBlob = DriveApp.getFileById(tempDocId).getAs('application/pdf');
      pdfBlob.setName(docName + '.pdf');

      // Delete temporary doc
      DriveApp.getFileById(tempDocId).setTrashed(true);
      tempDocId = null;

      AuditLogger.logInfo('WEEKLY_PDF_GENERATED', `PDF created: ${docName}.pdf (${(pdfBlob.getBytes().length / 1024).toFixed(2)}KB)`);

      return pdfBlob;

    } catch (error) {
      // Cleanup temp doc if exists
      if (tempDocId) {
        try {
          DriveApp.getFileById(tempDocId).setTrashed(true);
        } catch (cleanupError) {
          Logger.log(`Failed to cleanup temp doc: ${cleanupError.toString()}`);
        }
      }

      AuditLogger.logError('WEEKLY_PDF_ERROR', error.toString());
      throw new Error(`Weekly PDF generation failed: ${error.toString()}`);
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MONTHLY PDF GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create monthly PDF dashboard
   * @param {Object} reportData - Data from ReportingEngine.generateMonthlyReport()
   * @returns {Blob} PDF file blob
   */
  createMonthlyPDF: function(reportData) {
    let tempDocId = null;

    try {
      if (!reportData || !reportData.data) {
        throw new Error('Invalid report data');
      }

      const data = reportData.data;

      // Create temporary Google Doc
      const docName = `Monthly_Dashboard_${data.period.month}_${data.period.year}`;
      const doc = DocumentApp.create(docName);
      tempDocId = doc.getId();
      const body = doc.getBody();

      // Clear default content
      body.clear();

      // ═══ HEADER ═══
      const title = body.appendParagraph('MONTHLY DASHBOARD');
      title.setHeading(DocumentApp.ParagraphHeading.HEADING1);
      title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

      const period = body.appendParagraph(`${data.period.month} ${data.period.year}`);
      period.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      period.setSpacingAfter(20);

      // ═══ EXECUTIVE SUMMARY ═══
      this._addSectionHeader(body, 'Executive Summary');

      const summaryTable = body.appendTable([
        ['Total Outstanding', '৳' + data.outstanding.toLocaleString('en-BD')],
        ['Total Invoices', data.invoices.total.toString()],
        ['Active Invoices', data.invoices.active.toString()],
        ['Paid Invoices', data.invoices.paid.toString()],
        ['Total Payments', data.payments.count.toString()],
        ['Payment Amount', '৳' + data.payments.totalAmount.toLocaleString('en-BD')]
      ]);

      this._styleTable(summaryTable);
      body.appendParagraph('').setSpacingAfter(15);

      // ═══ INVOICE STATISTICS ═══
      this._addSectionHeader(body, 'Invoice Statistics');

      const invoiceTable = body.appendTable([
        ['Total Invoices', data.invoices.total.toString()],
        ['Active (Unpaid/Partial)', data.invoices.active.toString()],
        ['Fully Paid', data.invoices.paid.toString()],
        ['Total Invoice Amount', '৳' + data.invoices.totalAmount.toLocaleString('en-BD')],
        ['Collection Rate', `${data.invoices.paid > 0 ? ((data.invoices.paid / data.invoices.total) * 100).toFixed(1) : 0}%`]
      ]);

      this._styleTable(invoiceTable);
      body.appendParagraph('').setSpacingAfter(15);

      // ═══ PAYMENT STATISTICS ═══
      this._addSectionHeader(body, 'Payment Statistics');

      const paymentTable = body.appendTable([
        ['Total Payments', data.payments.count.toString()],
        ['Total Amount', '৳' + data.payments.totalAmount.toLocaleString('en-BD')],
        ['Average Payment', data.payments.count > 0 ? '৳' + (data.payments.totalAmount / data.payments.count).toFixed(2) : '৳0']
      ]);

      this._styleTable(paymentTable);
      body.appendParagraph('').setSpacingAfter(15);

      // ═══ AGING ANALYSIS ═══
      this._addSectionHeader(body, 'Aging Analysis');

      const totalAging = data.aging.bucket_0_30 + data.aging.bucket_31_60 +
                         data.aging.bucket_61_90 + data.aging.bucket_90_plus;

      const agingTable = body.appendTable([
        ['Age Bucket', 'Amount', 'Percentage'],
        ['0-30 days', '৳' + data.aging.bucket_0_30.toLocaleString('en-BD'),
         totalAging > 0 ? ((data.aging.bucket_0_30 / totalAging) * 100).toFixed(1) + '%' : '0%'],
        ['31-60 days', '৳' + data.aging.bucket_31_60.toLocaleString('en-BD'),
         totalAging > 0 ? ((data.aging.bucket_31_60 / totalAging) * 100).toFixed(1) + '%' : '0%'],
        ['61-90 days', '৳' + data.aging.bucket_61_90.toLocaleString('en-BD'),
         totalAging > 0 ? ((data.aging.bucket_61_90 / totalAging) * 100).toFixed(1) + '%' : '0%'],
        ['90+ days', '৳' + data.aging.bucket_90_plus.toLocaleString('en-BD'),
         totalAging > 0 ? ((data.aging.bucket_90_plus / totalAging) * 100).toFixed(1) + '%' : '0%'],
        ['Total', '৳' + totalAging.toLocaleString('en-BD'), '100%']
      ]);

      this._styleTable(agingTable, true);
      body.appendParagraph('').setSpacingAfter(15);

      // ═══ KEY INSIGHTS ═══
      this._addSectionHeader(body, 'Key Insights');

      const insights = body.appendParagraph('');
      insights.appendText('• ').setBold(true);
      insights.appendText(`${((data.invoices.paid / data.invoices.total) * 100).toFixed(1)}% of invoices are fully paid\n`);
      insights.appendText('• ').setBold(true);
      insights.appendText(`৳${data.outstanding.toLocaleString('en-BD')} in outstanding receivables\n`);
      insights.appendText('• ').setBold(true);

      // Calculate overdue percentage (60+ days)
      const overdueAmt = data.aging.bucket_61_90 + data.aging.bucket_90_plus;
      const overduePercent = totalAging > 0 ? ((overdueAmt / totalAging) * 100).toFixed(1) : 0;
      insights.appendText(`${overduePercent}% of outstanding is overdue (60+ days)\n`);

      insights.appendText('• ').setBold(true);
      insights.appendText(`Average payment: ৳${data.payments.count > 0 ? (data.payments.totalAmount / data.payments.count).toFixed(2) : 0}\n`);

      body.appendParagraph('').setSpacingAfter(15);

      // ═══ FOOTER ═══
      const footer = body.appendParagraph(`Generated: ${DateUtils.now()}`);
      footer.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      footer.setFontSize(8);
      footer.setForegroundColor('#999999');

      // Save and close doc
      doc.saveAndClose();

      // Convert to PDF
      const pdfBlob = DriveApp.getFileById(tempDocId).getAs('application/pdf');
      pdfBlob.setName(docName + '.pdf');

      // Delete temporary doc
      DriveApp.getFileById(tempDocId).setTrashed(true);
      tempDocId = null;

      AuditLogger.logInfo('MONTHLY_PDF_GENERATED', `PDF created: ${docName}.pdf (${(pdfBlob.getBytes().length / 1024).toFixed(2)}KB)`);

      return pdfBlob;

    } catch (error) {
      // Cleanup temp doc if exists
      if (tempDocId) {
        try {
          DriveApp.getFileById(tempDocId).setTrashed(true);
        } catch (cleanupError) {
          Logger.log(`Failed to cleanup temp doc: ${cleanupError.toString()}`);
        }
      }

      AuditLogger.logError('MONTHLY_PDF_ERROR', error.toString());
      throw new Error(`Monthly PDF generation failed: ${error.toString()}`);
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add formatted section header
   * @private
   * @param {Body} body - Google Doc body
   * @param {string} headerText - Header text
   */
  _addSectionHeader: function(body, headerText) {
    const header = body.appendParagraph(headerText);
    header.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    header.setForegroundColor('#1a73e8');
    header.setSpacingBefore(10);
    header.setSpacingAfter(5);
  },

  /**
   * Apply consistent styling to table
   * @private
   * @param {Table} table - Google Doc table
   * @param {boolean} hasHeaderRow - Whether table has header row
   */
  _styleTable: function(table, hasHeaderRow = false) {
    // Set table width and borders
    table.setBorderWidth(1);
    table.setBorderColor('#cccccc');

    // Style all cells
    for (let i = 0; i < table.getNumRows(); i++) {
      const row = table.getRow(i);

      for (let j = 0; j < row.getNumCells(); j++) {
        const cell = row.getCell(j);
        cell.setPaddingTop(5);
        cell.setPaddingBottom(5);
        cell.setPaddingLeft(8);
        cell.setPaddingRight(8);

        // Header row styling
        if (hasHeaderRow && i === 0) {
          cell.setBackgroundColor('#f3f3f3');
          cell.editAsText().setBold(true);
          cell.editAsText().setFontSize(10);
        } else {
          cell.editAsText().setFontSize(9);
        }

        // Alternate row colors for readability (if has header)
        if (hasHeaderRow && i > 0 && i % 2 === 0) {
          cell.setBackgroundColor('#fafafa');
        }
      }
    }
  }
};
