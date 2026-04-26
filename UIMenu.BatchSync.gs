var UIMenuBatchSync = {

  handleBatchSync: function(sheet) {
    const cols         = CONFIG.cols;
    const firstDataRow = CONFIG.dataStartRow;
    const lastRow      = sheet.getLastRow();

    if (lastRow < firstDataRow) {
      return { regularPartial: 0, due: 0, skipped: 0, failed: 0 };
    }

    const numDataRows = lastRow - firstDataRow + 1;
    const allValues   = sheet
      .getRange(firstDataRow, 1, numDataRows, CONFIG.totalColumns.daily)
      .getValues();

    const regularPartialRows = [];
    const dueRows            = [];
    let   skipped            = 0;

    for (let i = 0; i < allValues.length; i++) {
      const row         = allValues[i];
      const paymentType = row[cols.paymentType];
      const paymentAmt  = row[cols.paymentAmt];
      const prevInvoice = row[cols.prevInvoice];

      // Skip rows with no payment type, or already processed (either field populated)
      if (!paymentType || paymentType === '') continue;
      if (paymentAmt  !== '' && paymentAmt  !== null) continue;
      if (prevInvoice !== '' && prevInvoice !== null) continue;

      const invoiceNo   = row[cols.invoiceNo];
      const receivedAmt = row[cols.receivedAmt];
      const supplier    = row[cols.supplier];

      if (paymentType === 'Regular' || paymentType === 'Partial') {
        // IMPORTRANGE hasn't finished loading yet — skip
        if (!invoiceNo || invoiceNo === '' || !receivedAmt || receivedAmt === '') {
          skipped++;
          continue;
        }
        regularPartialRows.push({
          i:           i,
          paymentType: paymentType,
          invoiceNo:   invoiceNo,
          receivedAmt: receivedAmt,
          rowValues:   row.slice()
        });
      } else if (paymentType === 'Due') {
        if (!supplier || String(supplier).trim() === '') {
          skipped++;
          continue;
        }
        dueRows.push({
          i:         i,
          supplier:  supplier,
          rowValues: row.slice()
        });
      }
    }

    let failed = 0;

    // ── Regular / Partial ── single setValues for cols F+G ──────────────────
    if (regularPartialRows.length > 0) {
      const writeArray = allValues.map(row => [row[cols.prevInvoice], row[cols.paymentAmt]]);
      for (const r of regularPartialRows) {
        writeArray[r.i][0] = r.invoiceNo;
        writeArray[r.i][1] = r.receivedAmt;
      }

      let writeSucceeded = false;
      try {
        sheet
          .getRange(firstDataRow, cols.prevInvoice + 1, numDataRows, 2)
          .setValues(writeArray);
        writeSucceeded = true;
      } catch (err) {
        AuditLogger.logError('batchSyncPaymentFields',
          'Batch setValues failed: ' + err.toString());
        failed += regularPartialRows.length;
      }

      if (writeSucceeded) {
        for (const r of regularPartialRows) {
          try {
            if (r.paymentType === 'Partial') {
              sheet.getRange(firstDataRow + r.i, cols.paymentAmt + 1)
                .setBackground(CONFIG.colors.warning);
            }
            r.rowValues[cols.prevInvoice] = r.invoiceNo;
            r.rowValues[cols.paymentAmt]  = r.receivedAmt;
            BalanceCalculator.updateBalanceCell(sheet, firstDataRow + r.i, false, r.rowValues);
          } catch (err) {
            AuditLogger.logError('batchSyncPaymentFields',
              'Row ' + (firstDataRow + r.i) + ': ' + err.toString());
            failed++;
          }
        }
      }
    }

    // ── Due ── per-row dropdown (cannot be batched) ─────────────────────────
    for (const d of dueRows) {
      try {
        InvoiceManager.buildDuePaymentDropdown(
          sheet,
          firstDataRow + d.i,
          d.supplier,
          'Due',
          d.rowValues[cols.prevInvoice]
        );
      } catch (err) {
        AuditLogger.logError('batchSyncPaymentFields',
          'Row ' + (firstDataRow + d.i) + ': ' + err.toString());
        failed++;
      }
    }

    return {
      regularPartial: regularPartialRows.length,
      due:            dueRows.length,
      skipped:        skipped,
      failed:         failed
    };
  },

  _showSyncResults: function(results) {
    const ui    = SpreadsheetApp.getUi();
    const lines = [
      '✅ Regular/Partial populated:  ' + results.regularPartial,
      '🔄 Due dropdowns built:        ' + results.due,
      '⚠️  Skipped (incomplete data): ' + results.skipped,
      '❌ Errors:                      ' + results.failed
    ];
    ui.alert('Payment Fields Synced', lines.join('\n'), ui.ButtonSet.OK);
  }

};
