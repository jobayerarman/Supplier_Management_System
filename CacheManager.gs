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

// ═══ INTELLIGENT CACHE WITH WRITE-THROUGH ═══
/**
 * Optimized Invoice Cache Module
 * ----------------------------------------------------
 * Features:
 *  - Global invoice data cache (in-memory)
 *  - Fast lookup by supplier|invoiceNo
 *  - Supplier-wise index for quick filtering
 *  - TTL-based auto-expiration
 *  - Write-through cache for immediate findability
 *  - Surgical supplier-specific invalidation
 */