# Caching Architecture

## CacheManager ([CacheManager.gs](CacheManager.gs))

**Purpose**: Eliminate redundant InvoiceDatabase sheet reads. Write-through cache with partitioning, indexed lookups, and incremental updates. TTL: 60 seconds.

### Partitions

Invoices split into two partitions:
- **Active**: unpaid/partial (balance > $0.01) — hot data, 10-30% of invoices
- **Inactive**: fully paid (balance ≤ $0.01) — cold data, 70-90% of invoices

Invoices auto-transition Active → Inactive when fully paid. Result: 70-90% smaller active cache.

### Index Structure

- Primary: `"SUPPLIER|INVOICE_NO" → row index` (O(1) lookup)
- Supplier: `"SUPPLIER" → [row indices]` (O(m) supplier queries)
- Invoice: `"INVOICE_NO" → row index` (O(1) invoice queries)

### Key Operations

- `getInvoiceData()` — lazy load, auto-refresh on TTL expiry
- `addInvoiceToCache(rowNum, rowData)` — write-through on invoice creation
- `updateInvoiceInCache(supplier, invoiceNo)` — sync after payment
- `updateSingleInvoice(supplier, invoiceNo)` — **incremental update** (250x faster than full reload: ~1ms vs ~500ms)
- `invalidate(operation, supplier, invoiceNo)` — smart invalidation; `'updateAmount'` triggers incremental update
- `invalidateSupplierCache(supplier)` — surgical per-supplier invalidation (both partitions)
- `getPartitionStats()` — monitor active/inactive distribution
- `clear()` — full reset

### Critical Implementation Detail

Cache must read **evaluated values** from sheet (not formula strings). In master mode, cache reads from `getTargetSheet()` (Master DB); in local mode, from `getSourceSheet()` (local sheet). Cache invalidation must happen **after** writing to PaymentLog so SUMIFS formulas recalculate before cache reads them.

### Performance

| Operation | Time |
|-----------|------|
| Cache hit | <1ms |
| Cache miss (local) | 200-400ms (one-time load) |
| Cache miss (master) | 300-600ms (one-time load) |
| Incremental update | ~1ms |
| Full reload | ~500ms |
| Partition transition | <2ms |

---

## PaymentCache (inside [PaymentManager.gs](PaymentManager.gs))

**Purpose**: Eliminate redundant PaymentLog reads. O(1) for all payment queries. TTL: 60 seconds.

### Quad-Index Structure

1. `"INVOICE_NO" → [row indices]` — all payments for an invoice
2. `"SUPPLIER" → [row indices]` — all payments for a supplier
3. `"SUPPLIER|INVOICE_NO" → [row indices]` — combined queries
4. `"PAYMENT_ID" → row index` — O(1) duplicate detection

### Key Operations

- `getPaymentData()` — lazy load
- `addPaymentToCache(rowNum, rowData)` — write-through when payment recorded
- `clear()` — full invalidation

### Performance

| Operation | Time |
|-----------|------|
| Cache hit | <1ms |
| Initial load | 200-400ms (one-time) |
| Any query | 1-3ms O(1) |
| Duplicate detection | <1ms O(1) |

Scalable to 50,000+ payments at constant O(1). Before optimization: O(n), unusable at 10,000 payments.
