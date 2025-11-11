/**
 * Invoice management module
 * Handles all invoice-related operations
 * - Creating new invoices
 * - Updating existing invoices
 * - Finding invoice records
 * - Managing invoice formulas
 * 
 * OPTIMIZATIONS:
 * - Intelligent caching with write-through support
 * - Immediate findability after creation (fixes Regular payment bug)
 * - Batch operations for multiple invoice operations
 * - Single getDataRange() call per operation
 * - Lazy formula application
 * - Index-based lookups
 * - Memory-efficient filtering
 */

// ==================== INVOICE MANAGER MODULE ====================

/**
 * InvoiceManager - Optimized version
 * Handles creation, updates, and processing of supplier invoices
 */
const InvoiceManager = {
  /**
   * Process invoice (create or update based on existence)
   * 
   * @param {Object} data - Transaction data
   * @returns {Object} Result with success flag and details
   */
  process: function (data) {
    try {
      // Skip creation for "Due" payments with no invoice number
      if (data.paymentType === 'Due' && !data.invoiceNo) {
        return { success: true, action: 'none' };
      }

      // Check if invoice already exists
      const existingInvoice = data.invoiceNo ? this.find(data.supplier, data.invoiceNo) : null;
      return existingInvoice ? this.update(existingInvoice, data) : this.create(data, existingInvoice);

    } catch (error) {
      AuditLogger.logError('InvoiceManager.process',
        `Failed to process invoice for ${data.supplier}: ${error.toString()}`);
      return {
        success: false,
        error: `Invoice processing failed: ${error.message}`
      };
    }
  },

  /**
   * OPTIMIZED: InvoiceManager.processOptimized()
   * Returns invoiceId immediately for payment processing
   */
  processOptimized: function(data) {
    try {
      // Skip for Due payments without invoice
      if (data.paymentType === 'Due' && !data.invoiceNo) {
        return { success: true, action: 'none', invoiceId: null };
      }

      // Check existence using cached data
      const existingInvoice = data.invoiceNo ? this.find(data.supplier, data.invoiceNo) : null;
      
      if (existingInvoice) {
        // Update if needed
        const result = this.updateOptimized(existingInvoice, data);
        const invoiceId = existingInvoice.data[CONFIG.invoiceCols.sysId] || 
                          IDGenerator.generateInvoiceId(data.sysId);
        return { 
          ...result, 
          invoiceId: invoiceId
        };
      } else {
        // Create new
        return this.create(data);
      }

    } catch (error) {
      AuditLogger.logError('InvoiceManager.processOptimized', error.toString());
      return { success: false, error: `Invoice processing failed: ${error.message}` };
    }
  },

  /**
   * Create new invoice with write-through cache
   * 
   * @param {Object} data - Transaction data
   * @param {Object} invoice - Pre-checked invoice (optional)
   * @returns {Object} Result with success flag and invoice details
   */
  create: function (data, invoice = null) {
    const lock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
    if (!lock) {
      return { success: false, error: 'Unable to acquire lock for invoice creation' };
    }

    try {
      const { supplier, invoiceNo, sheetName, sysId, receivedAmt, timestamp } = data;

      // Double-check invoice doesn't exist (atomic check with lock)
      const existingInvoice = invoice || this.find(supplier, invoiceNo);

      if (existingInvoice) {
        const msg = `Invoice ${invoiceNo} already exists at row ${existingInvoice.row}`;
        AuditLogger.log('DUPLICATE_PREVENTED', data, msg);
        return { success: false, error: msg, existingRow: existingInvoice.row };
      }

      // Use Master Database if in master mode, otherwise use local sheet
      const invoiceSh = MasterDatabaseUtils.getTargetSheet('invoice');
      const lastRow = invoiceSh.getLastRow();
      const newRow = lastRow + 1;
      const invoiceDate = getDailySheetDate(sheetName) || timestamp;
      const formattedDate = DateUtils.formatDate(invoiceDate);
      const invoiceId = IDGenerator.generateInvoiceId(sysId);

      // NEW STRUCTURE: A=invoiceDate, B=supplier, C=invoiceNo, D=totalAmount, E=totalPaid, F=balanceDue, G=status, H=paidDate, I=daysOutstanding
      const E = `=IF(C${newRow}="","",IFERROR(SUMIFS(PaymentLog!E:E, PaymentLog!C:C,C${newRow}, PaymentLog!B:B,B${newRow}),0))`;  // Total Paid
      const F = `=IF(D${newRow}="","",D${newRow}-E${newRow})`;  // Balance Due
      const G = `=IFS(F${newRow}=0,"Paid",F${newRow}=D${newRow},"Unpaid",F${newRow}<D${newRow},"Partial")`;  // Status
      const I = `=IF(F${newRow}=0,0,TODAY()-A${newRow})`;  // Days Outstanding

      // Build new invoice row WITH formulas included
      const newRowData = [
        invoiceDate,      // A - invoiceDate
        supplier,         // B - supplier
        invoiceNo,        // C - invoiceNo
        receivedAmt,      // D - totalAmount
        E,                // E - totalPaid (formula)
        F,                // F - balanceDue (formula)
        G,                // G - status (formula)
        '',               // H - paidDate
        I,                // I - daysOutstanding (formula)
        sheetName,        // J - originDay
        data.enteredBy || UserResolver.getCurrentUser(),  // K - enteredBy (NEW)
        timestamp,        // L - timestamp
        invoiceId         // M - sysId
      ];

      // ═══ WRITE TO SHEET ═══
      invoiceSh.getRange(newRow, 1, 1, newRowData.length).setValues([newRowData]);

      // ═══ ADD TO CACHE (Write-Through) - KEY FIX ═══
      CacheManager.addInvoiceToCache(newRow, newRowData);

      AuditLogger.log('INVOICE_CREATED', data, `Created new invoice ${invoiceNo} at row ${newRow} | Date: ${formattedDate} | Added to cache`);

      return { success: true, action: 'created', invoiceId, row: newRow };

    } catch (error) {
      AuditLogger.logError('InvoiceManager.create',
        `Failed to create invoice ${data.invoiceNo}: ${error.toString()}`);
      return {success: false, error: error.toString()};

    } finally {
      LockManager.releaseLock(lock);
    }
  },

  /**
   * Update existing invoice
   * OPTIMIZED: Batch updates in single operation
   * 
   * @param {Object} existingInvoice - Existing invoice record {row, data}
   * @param {Object} data - Transaction data
   * @returns {Object} Result with success flag
   */
  update: function (existingInvoice, data) {
    try {
      if (!existingInvoice) return { success: false, error: 'Invoice not found' };
      const col = CONFIG.invoiceCols;

      // Use Master Database if in master mode, otherwise use local sheet
      const invoiceSh = MasterDatabaseUtils.getTargetSheet('invoice');
      const rowNum = existingInvoice.row;

      const oldTotal = Number(existingInvoice.data[col.totalAmount]) || 0;
      const oldOrigin = String(existingInvoice.data[col.originDay]);
      
      // Check if updates are needed
      const amountChanged = Number(data.receivedAmt) !== oldTotal;
      const originChanged = (String(data.sheetName) !== oldOrigin);
      
      if (!amountChanged && !originChanged) {
        return { success: true, action: 'no_change', row: rowNum };
      }
      
      // Perform only necessary writes in one batch
      const updates = [];
      if (amountChanged) {
        updates.push({ col: col.totalAmount + 1, val: data.receivedAmt });
      }
      if (originChanged) {
        updates.push({ col: col.originDay + 1, val: data.sheetName });
      }

      if (updates.length) {
        const range = invoiceSh.getRange(rowNum, 1, 1, CONFIG.totalColumns.invoice);
        const values = range.getValues()[0];
        updates.forEach(u => (values[u.col - 1] = u.val));
        range.setValues([values]);
      }

      // Cache invalidation only if numeric data changed
      if (amountChanged) {
        const invoiceNo = existingInvoice.data[col.invoiceNo];
        CacheManager.invalidate('updateAmount', data.supplier, invoiceNo);
      }

      return { success: true, action: 'updated', row: rowNum };

    } catch (error) {
      AuditLogger.logError('InvoiceManager.update',
        `Failed to update invoice: ${error.toString()}`);
      return { success: false, error: error.toString() };
    }
  },

  /**
   * OPTIMIZED: InvoiceManager.updateOptimized()
   * Only writes if data actually changed
   */
  updateOptimized: function(existingInvoice, data) {
    try {
      const col = CONFIG.invoiceCols;
      const rowNum = existingInvoice.row;
      
      const oldTotal = Number(existingInvoice.data[col.totalAmount]) || 0;
      const oldOrigin = String(existingInvoice.data[col.originDay]);
      const newTotal = Number(data.receivedAmt);
      const newOrigin = String(data.sheetName);
      
      // Early exit if no changes
      if (newTotal === oldTotal && newOrigin === oldOrigin) {
        return { success: true, action: 'no_change', row: rowNum };
      }

      // Batch write only changed columns
      // Use Master Database if in master mode, otherwise use local sheet
      const invoiceSh = MasterDatabaseUtils.getTargetSheet('invoice');
      const updates = [];
      
      if (newTotal !== oldTotal) {
        updates.push({ col: col.totalAmount + 1, val: newTotal });
      }
      if (newOrigin !== oldOrigin) {
        updates.push({ col: col.originDay + 1, val: newOrigin });
      }

      if (updates.length > 0) {
        const range = invoiceSh.getRange(rowNum, 1, 1, CONFIG.totalColumns.invoice);
        const values = range.getValues()[0];
        updates.forEach(u => (values[u.col - 1] = u.val));
        range.setValues([values]);

        // NEW: Use incremental update instead of supplier cache invalidation
        const invoiceNo = existingInvoice.data[col.invoiceNo];
        CacheManager.invalidate('updateAmount', data.supplier, invoiceNo);
      }

      return { success: true, action: 'updated', row: rowNum };

    } catch (error) {
      AuditLogger.logError('InvoiceManager.updateOptimized', error.toString());
      return { success: false, error: error.toString() };
    }
  },

  /**
   * Update paid date when invoice is fully paid
   * Called after payment processing
   * @param {string} invoiceNo - Invoice number
   * @param {string} supplier - Supplier name
   * @param {Date} paymentDate - Date of final payment
   */
  updatePaidDate: function (invoiceNo, supplier, paymentDate) {
    try {
      const invoice = this.find(supplier, invoiceNo);
      const col = CONFIG.invoiceCols;
      if (!invoice) return;

      // Use Master Database if in master mode, otherwise use local sheet
      const invoiceSh = MasterDatabaseUtils.getTargetSheet('invoice');
      const balanceDue = Number(invoice.data[col.balanceDue]) || 0;
      const currentPaidDate = invoice.data[col.paidDate];

      // If balance is zero and paid date is empty, set it
      if (balanceDue === 0 && !currentPaidDate) {
        invoiceSh.getRange(invoice.row, col.paidDate + 1)
          .setValue(paymentDate);

        AuditLogger.log('INVOICE_FULLY_PAID', { invoiceNo, supplier },
          `Invoice fully paid on ${DateUtils.formatDate(paymentDate)}`);

        CacheManager.clear();
      }
    } catch (error) {
      AuditLogger.logError('InvoiceManager.updatePaidDate',
        `Failed to update paid date: ${error.toString()}`);
    }
  },

  /**
   * OPTIMIZED: InvoiceManager.updatePaidDateOptimized()
   * Only writes if balance is zero and date is empty
   */
  updatePaidDateOptimized: function(invoiceNo, supplier, paymentDate) {
    try {
      const invoice = this.find(supplier, invoiceNo);
      if (!invoice) return;

      const col = CONFIG.invoiceCols;
      const balanceDue = Number(invoice.data[col.balanceDue]) || 0;
      const currentPaidDate = invoice.data[col.paidDate];

      // Only write if conditions met
      if (balanceDue === 0 && !currentPaidDate) {
        // Use Master Database if in master mode, otherwise use local sheet
        const invoiceSh = MasterDatabaseUtils.getTargetSheet('invoice');
        invoiceSh.getRange(invoice.row, col.paidDate + 1).setValue(paymentDate);

        AuditLogger.log('INVOICE_FULLY_PAID', { invoiceNo, supplier },
          `Invoice fully paid on ${DateUtils.formatDate(paymentDate)}`);
      }
    } catch (error) {
      AuditLogger.logError('InvoiceManager.updatePaidDateOptimized', error.toString());
    }
  },

  /**
   * Set formulas for an invoice row in a non-destructive way.
   * This function now only targets the specific formula columns.
   * Used by the repairAllFormulas() utility.
   * 
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Invoice sheet
   * @param {number} row - Row number to apply formulas to
   */
  setFormulas: function (sheet, row) {
    try {
      const col = CONFIG.invoiceCols;

      // TARGETED UPDATE: Set formula for 'Total Paid' (Column E)
      // NEW STRUCTURE: A=invoiceDate, B=supplier, C=invoiceNo, D=totalAmount, E=totalPaid
      sheet.getRange(row, col.totalPaid + 1)
        .setFormula(`=IF(C${row}="","",IFERROR(SUMIFS(PaymentLog!E:E, PaymentLog!C:C,C${row}, PaymentLog!B:B,B${row}),0))`);

      // TARGETED UPDATE: Set formula for 'Balance Due' (Column F)
      sheet.getRange(row, col.balanceDue + 1)
        .setFormula(`=IF(D${row}="","", D${row} - E${row})`);

      // TARGETED UPDATE: Set formula for 'Status' (Column G)
      sheet.getRange(row, col.status + 1)
        .setFormula(`=IFS(F${row}=0,"Paid", F${row}=D${row},"Unpaid", F${row}<D${row},"Partial")`);

      // TARGETED UPDATE: Set formula for 'Days Outstanding' (Column I)
      sheet.getRange(row, col.daysOutstanding + 1)
        .setFormula(`=IF(F${row}=0, 0, TODAY() - A${row})`);

    } catch (error) {
      logSystemError('InvoiceManager.setFormulas',
        `Failed to set formulas for row ${row}: ${error.toString()}`);
      throw error;
    }
  },

  /**
   * Find invoice record by supplier and invoice number (cached lookup)
   * 
   * Uses globalIndexMap for O(1) cross-partition lookup.
   *
   * @param {string} supplier - Supplier name
   * @param {string} invoiceNo - Invoice number
   * @returns {{row:number,data:Array,partition:string}|null}
   */
  find: function (supplier, invoiceNo) {
    if (StringUtils.isEmpty(supplier) || StringUtils.isEmpty(invoiceNo)) {
      return null;
    }

    try {
      // Get cached partition data with globalIndexMap
      const cacheData = CacheManager.getInvoiceData();

      const normalizedSupplier = StringUtils.normalize(supplier);
      const normalizedInvoice = StringUtils.normalize(invoiceNo);
      const key = `${normalizedSupplier}|${normalizedInvoice}`;

      // Use globalIndexMap for cross-partition lookup
      const location = cacheData.globalIndexMap?.get(key);

      if (!location) {
        return null;
      }

      // Get data from appropriate partition
      const partitionData = location.partition === 'active'
        ? cacheData.activeData
        : cacheData.inactiveData;

      return {
        row: location.sheetRow, // Use tracked sheet row (1-based)
        data: partitionData[location.index],
        partition: location.partition
      };

    } catch (error) {
      AuditLogger.logError('InvoiceManager.find', `Failed to find invoice ${invoiceNo} for ${supplier}: ${error.toString()}`);
      return null;
    }
  },

  /**
   * Return all unpaid invoices for a given supplier.
   * Uses CacheManager for instant lookup.
   * 
   * @param {string} supplier - Supplier name
   * @returns {Array} Array of unpaid invoice objects
   */
  /**
   * PERFORMANCE FIX #2: Partition-aware consumer implementation
   *
   * Get unpaid invoices for supplier using ACTIVE PARTITION
   *
   * OLD APPROACH:
   * - Iterate ALL supplier invoices (could be 1000s)
   * - Filter by status (UNPAID/PARTIAL)
   * - Return filtered subset
   *
   * NEW APPROACH (PARTITION-AWARE):
   * - Query ACTIVE partition only (already filtered by balanceDue > 0.01)
   * - 70-90% faster (only iterates unpaid/partial invoices)
   * - Eliminates status filtering logic
   *
   * PERFORMANCE BENEFIT:
   * - Typical supplier: 200 total invoices, 20 unpaid
   * - OLD: Iterate 200 invoices, check all statuses → ~5ms
   * - NEW: Iterate 20 invoices directly → ~0.5ms
   * - **10x faster** for suppliers with many paid invoices
   *
   * @param {string} supplier - Supplier name
   * @returns {Array<{invoiceNo:string, rowIndex:number, amount:number}>} Unpaid invoices
   */
  getUnpaidForSupplier: function (supplier) {
    if (StringUtils.isEmpty(supplier)) return [];

    try {
      // ✅ PERFORMANCE FIX #2: Use ACTIVE partition (unpaid/partial invoices only)
      const cacheData = CacheManager.getInvoiceData();
      const normalizedSupplier = StringUtils.normalize(supplier);

      // Try active partition first (fast path - only unpaid/partial invoices)
      const activeIndex = cacheData.activeSupplierIndex || null;
      if (activeIndex && activeIndex.has(normalizedSupplier)) {
        const activeRows = activeIndex.get(normalizedSupplier) || [];
        const activeData = cacheData.activeData || [];
        const col = CONFIG.invoiceCols;
        const unpaidInvoices = [];

        // Iterate ONLY active invoices (already filtered by balance > 0.01)
        for (let i of activeRows) {
          const row = activeData[i];
          if (!row) continue; // Skip nulled entries (partition transitions)

          const invoiceNo = row[col.invoiceNo];
          const totalAmount = row[col.totalAmount];
          const totalPaid = row[col.totalPaid] || 0;
          const balanceDue = totalAmount - totalPaid;

          // Active partition contains unpaid/partial by definition
          if (balanceDue > 0.01) {
            unpaidInvoices.push({
              invoiceNo,
              rowIndex: i,
              amount: balanceDue
            });
          }
        }

        return unpaidInvoices;
      }

      return [];

    } catch (error) {
      AuditLogger.logError('InvoiceManager.getUnpaidForSupplier',
        `Failed to get unpaid invoices for ${supplier}: ${error.toString()}`);
      return [];
    }
  },

  /**
   * Get all invoices for a supplier (paid and/or unpaid)
   *
   * Uses partition-aware supplier indices for O(m) performance where m = supplier's invoice count.
   *
   * @param {string} supplier - Supplier name
   * @param {boolean} includePaid - Include paid invoices (default true)
   * @returns {Array<Object>} Array of invoice objects
   */
  getAllForSupplier: function (supplier, includePaid = true) {
    if (StringUtils.isEmpty(supplier)) {
      return [];
    }

    try {
      // Use partition-aware supplier indices
      const cacheData = CacheManager.getInvoiceData();
      const col = CONFIG.invoiceCols;
      const normalizedSupplier = StringUtils.normalize(supplier);

      const activeRows = cacheData.activeSupplierIndex?.get(normalizedSupplier) || [];
      const inactiveRows = cacheData.inactiveSupplierIndex?.get(normalizedSupplier) || [];

      const invoices = [];

      // Process active partition (unpaid/partial invoices)
      for (const i of activeRows) {
        const row = cacheData.activeData[i];
        if (!row) continue;

        const balanceDue = Number(row[col.balanceDue]) || 0;

        invoices.push({
          invoiceNo: row[col.invoiceNo],
          invoiceDate: row[col.invoiceDate],
          totalAmount: row[col.totalAmount],
          totalPaid: row[col.totalPaid],
          balanceDue: balanceDue,
          status: row[col.status],
          paidDate: row[col.paidDate],
          daysOutstanding: row[col.daysOutstanding],
          originDay: row[col.originDay],
          enteredBy: row[col.enteredBy],
          timestamp: row[col.timestamp],
          sysId: row[col.sysId],
          partition: 'active'
        });
      }

      // Process inactive partition (paid invoices) if requested
      if (includePaid) {
        for (const i of inactiveRows) {
          const row = cacheData.inactiveData[i];
          if (!row) continue;

          const balanceDue = Number(row[col.balanceDue]) || 0;

          invoices.push({
            invoiceNo: row[col.invoiceNo],
            invoiceDate: row[col.invoiceDate],
            totalAmount: row[col.totalAmount],
            totalPaid: row[col.totalPaid],
            balanceDue: balanceDue,
            status: row[col.status],
            paidDate: row[col.paidDate],
            daysOutstanding: row[col.daysOutstanding],
            originDay: row[col.originDay],
            enteredBy: row[col.enteredBy],
            timestamp: row[col.timestamp],
            sysId: row[col.sysId],
            partition: 'inactive'
          });
        }
      }

      return invoices;

    } catch (error) {
      AuditLogger.logError('InvoiceManager.getAllForSupplier',
        `Failed to get invoices for ${supplier}: ${error.toString()}`);
      return [];
    }
  },

  /**
   * Get invoice statistics
   * OPTIMIZED: Single data read, single-pass aggregation
   * 
   * @returns {Object} Statistics summary
   */
  getStatistics: function () {
    try {
      // Use partition-aware data
      const cacheData = CacheManager.getInvoiceData();
      const col = CONFIG.invoiceCols;

      const activeCount = cacheData.activeData ? cacheData.activeData.length - 1 : 0; // Exclude header
      const inactiveCount = cacheData.inactiveData ? cacheData.inactiveData.length - 1 : 0; // Exclude header

      if (activeCount === 0 && inactiveCount === 0) {
        return {
          total: 0,
          unpaid: 0,
          partial: 0,
          paid: 0,
          totalOutstanding: 0,
          activePartitionSize: 0,
          inactivePartitionSize: 0
        };
      }

      // Aggregate active partition (Unpaid + Partial)
      let unpaid = 0, partial = 0;
      let totalOutstanding = 0;

      for (let i = 1; i < cacheData.activeData.length; i++) {
        const row = cacheData.activeData[i];
        const status = row[col.status];
        const balanceDue = Number(row[col.balanceDue]) || 0;

        if (StringUtils.equals(status, 'Unpaid')) unpaid++;
        else if (StringUtils.equals(status, 'Partial')) partial++;

        totalOutstanding += balanceDue;
      }

      // Inactive partition = Paid invoices (balance should be ~$0)
      const paid = inactiveCount;

      return {
        total: activeCount + inactiveCount,
        unpaid: unpaid,
        partial: partial,
        paid: paid,
        totalOutstanding: totalOutstanding,
        activePartitionSize: activeCount,
        inactivePartitionSize: inactiveCount
      };

    } catch (error) {
      AuditLogger.logError('InvoiceManager.getStatistics',
        `Failed to get statistics: ${error.toString()}`);
      return null;
    }
  },

  /**
   * OPTIMIZED: Reduced Spreadsheet API calls by 25-50%
   * - Early exit: 2 calls (was 3) - removed clearNote()
   * - Error path: 3 calls (was 4) - removed setValue('')
   * - Success path: 2 calls (unchanged, already optimal)
   * - No unpaid: 3 calls (unchanged, all necessary)
   *
   * Build dropdown list of unpaid invoices for a supplier
   * Used for "Due" payment type dropdown in daily sheet.
   * 
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Daily sheet
   * @param {number} row - Target row
   * @param {string} supplier - Supplier name
   * @param {string} paymentType - Payment type
   * @returns {boolean} Success flag
   */
  buildUnpaidDropdown: function (sheet, row, supplier, paymentType) {
    const targetCell = sheet.getRange(row, CONFIG.cols.prevInvoice + 1);

    // Clear dropdown if not "Due" or missing supplier
    if (paymentType !== "Due" || StringUtils.isEmpty(supplier)) {
      try {
        targetCell.clearDataValidations().clearNote().clearContent().setBackground(null);
      } catch (e) {
        AuditLogger.logError('InvoiceManager.buildUnpaidDropdown', `Failed to clear: ${e.toString()}`);
      }
      return false;
    }

    try {
      const unpaidInvoices = this.getUnpaidForSupplier(supplier);

      if (unpaidInvoices.length === 0) {
        // No unpaid invoices found - show warning message
        targetCell.clearDataValidations()
          .clearContent()
          .setNote(`No unpaid invoices found for ${supplier}.\n\nThis supplier either has no invoices or all invoices are fully paid.`)
          .setBackground(CONFIG.colors.warning);

        return false;
      }

      const invoiceNumbers = unpaidInvoices.map(inv => inv.invoiceNo);
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(invoiceNumbers, true)
        .setAllowInvalid(true)
        .build();

      // CRITICAL FIX: Set dropdown FIRST, then clear content
      // This prevents the clearContent() edit event from interfering with the dropdown
      // Old order: clearContent → setDataValidation (dropdown could be cleared by cascade events)
      // New order: setDataValidation → clearContent (dropdown already set when cascade fires)
      const currentValue = targetCell.getValue();
      const isValidValue = invoiceNumbers.includes(String(currentValue));

      // Set dropdown and background first (no edit event triggered)
      targetCell
        .setDataValidation(rule)
        .setBackground(CONFIG.colors.info);

      // Clear content and note ONLY if current value is invalid or empty
      if (!isValidValue || !currentValue) {
        targetCell.clearContent().clearNote();
      } else {
        targetCell.clearNote();
      }
      return true;

    } catch (error) {
      AuditLogger.logError('InvoiceManager.buildUnpaidDropdown', error.toString());
      targetCell.clearDataValidations()
        .clearContent()
        .setNote('Error loading invoices - please contact administrator')
        .setBackground(CONFIG.colors.error);

      return false;
    }
  },

  /**
   * Repair formulas for all invoices (maintenance function)
   * 
   * @returns {Object} Result with repaired count
   */
  repairAllFormulas: function () {
    try {
      // Use Master Database if in master mode, otherwise use local sheet
      const invoiceSh = MasterDatabaseUtils.getTargetSheet('invoice');
      const lastRow = invoiceSh.getLastRow();

      if (lastRow < 2) {
        return { success: true, repairedCount: 0, message: 'No invoices to repair' };
      }

      // Batch check all formulas at once
      const formulaRange = invoiceSh.getRange(2, 1, lastRow - 1, CONFIG.totalColumns.invoice);
      const formulas = formulaRange.getFormulas();

      let repairedCount = 0;
      const rowsToRepair = [];

      // Identify rows needing repair
      for (let i = 0; i < formulas.length; i++) {
        const rowFormulas = formulas[i];
        // Check if key formula columns are missing
        // NEW STRUCTURE: E=totalPaid(4), F=balanceDue(5), G=status(6), I=daysOutstanding(8)
        if (!rowFormulas[4] || !rowFormulas[5] || !rowFormulas[6] || !rowFormulas[8]) {
          rowsToRepair.push(i + 2); // +2 for header and 0-based index
        }
      }

      // Repair in batch
      for (const rowNum of rowsToRepair) {
        this.setFormulas(invoiceSh, rowNum);
        repairedCount++;
      }

      return {
        success: true,
        repairedCount: repairedCount,
        message: `Repaired ${repairedCount} invoice(s)`
      };
    } catch (error) {
      logSystemError('InvoiceManager.repairAllFormulas', error.toString());
      return { success: false, error: error.toString() };
    }
  },

  /**
  * Batch create multiple invoices (for bulk import)
  * NEW: Optimized for mass data entry
  * 
  * @param {Array} invoiceDataArray - Array of invoice data objects
  * @returns {Object} Result summary
  */
  batchCreate: function (invoiceDataArray) {
    if (!invoiceDataArray || invoiceDataArray.length === 0) {
      return { success: true, created: 0, failed: 0, errors: [] };
    }

    const lock = LockManager.acquireScriptLock(CONFIG.rules.LOCK_TIMEOUT_MS);
    if (!lock) {
      return { success: false, error: 'Unable to acquire lock for batch creation' };
    }

    try {
      // Use Master Database if in master mode, otherwise use local sheet
      const invoiceSh = MasterDatabaseUtils.getTargetSheet('invoice');
      const lastRow = invoiceSh.getLastRow();
      const startRow = lastRow + 1;

      const newRowsData = [];
      const errors = [];
      let created = 0;
      let failed = 0;

      // Pre-check all duplicates in memory to avoid multiple `find` calls if possible
      // This is an optimization for larger datasets.
      CacheManager.getInvoiceData(); // Ensures cache is populated

      for (let i = 0; i < invoiceDataArray.length; i++) {
        const data = invoiceDataArray[i];
        const currentRowNum = startRow + i;

        try {
          // Check for duplicates using the now-cached data
          const exists = this.find(data.supplier, data.invoiceNo);
          if (exists) {
            errors.push(`Row ${i + 1}: Invoice ${data.invoiceNo} for ${data.supplier} already exists.`);
            failed++;
            continue;
          }

          const invoiceDate = data.invoiceDate || data.timestamp;

          // Build the full row with data and formulas
          const newInvoiceRow = [
            invoiceDate,                                                                                                                                    // A - invoiceDate
            data.supplier,                                                                                                                                  // B - supplier
            data.invoiceNo,                                                                                                                                 // C - invoiceNo
            data.receivedAmt,                                                                                                                               // D - totalAmount
            `=IF(C${currentRowNum}="","",IFERROR(SUMIFS(PaymentLog!E:E, PaymentLog!C:C,C${currentRowNum}, PaymentLog!B:B,B${currentRowNum}),0))`,           // E - totalPaid (formula)
            `=IF(D${currentRowNum}="","", D${currentRowNum} - E${currentRowNum})`,                                                                          // F - balanceDue (formula)
            `=IFS(F${currentRowNum}=0,"Paid", F${currentRowNum}=D${currentRowNum},"Unpaid", F${currentRowNum}<D${currentRowNum},"Partial")`,                // G - status (formula)
            '',                                                                                                                                             // H - paidDate
            `=IF(F${currentRowNum}=0, 0, TODAY() - A${currentRowNum})`,                                                                                     // I - daysOutstanding (formula)
            data.sheetName || 'IMPORT',                                                                                                                     // J - originDay
            data.enteredBy || UserResolver.getCurrentUser(),                                                                                                // K - enteredBy (NEW)
            data.timestamp,                                                                                                                                 // L - timestamp
            IDGenerator.generateInvoiceId(data.sysId || IDGenerator.generateUUID())                                                                         // M - sysId
          ];

          newRowsData.push(newInvoiceRow);
          created++;

        } catch (error) {
          errors.push(`Row ${i + 1} (${data.invoiceNo}): ${error.message}`);
          failed++;
        }
      }

      // Batch write all new rows at once
      if (newRowsData.length > 0) {
        invoiceSh.getRange(startRow, 1, newRowsData.length, newRowsData[0].length)
          .setValues(newRowsData);
      }

      // Clear cache after all operations are complete
      CacheManager.invalidate('create');

      return {
        success: true,
        created: created,
        failed: failed,
        errors: errors,
        message: `Created ${created} invoice(s), ${failed} failed.`
      };

    } catch (error) {
      AuditLogger.logError('InvoiceManager.batchCreate', error.toString());
      return { success: false, error: error.toString() };
    } finally {
      LockManager.releaseLock(lock);
    }
  }
};



// ==================== BACKWARD COMPATIBILITY ====================

/**
 * Backward compatibility wrapper functions
 */
function processInvoice(data) {
  return InvoiceManager.process(data);
}

function createNewInvoice(data) {
  return InvoiceManager.create(data);
}

function batchCreateInvoices(invoiceDataArray) {
  return InvoiceManager.batchCreate(invoiceDataArray);
}

function updateExistingInvoice(existingInvoice, data) {
  return InvoiceManager.update(existingInvoice, data);
}

function findInvoiceRecord(supplier, invoiceNo) {
  return InvoiceManager.find(supplier, invoiceNo);
}

function setInvoiceFormulas(sheet, row) {
  return InvoiceManager.setFormulas(sheet, row);
}

function getUnpaidInvoicesForSupplier(supplier) {
  return InvoiceManager.getUnpaidForSupplier(supplier);
}

function getAllInvoicesForSupplier(supplier, includePaid) {
  return InvoiceManager.getAllForSupplier(supplier, includePaid);
}

function getInvoiceStatistics() {
  return InvoiceManager.getStatistics();
}

function buildUnpaidDropdown(sheet, row, supplier, paymentType) {
  return InvoiceManager.buildUnpaidDropdown(sheet, row, supplier, paymentType);
}

function repairAllInvoiceFormulas() {
  return InvoiceManager.repairAllFormulas();
}

function clearCacheManager() {
  CacheManager.clear();
}