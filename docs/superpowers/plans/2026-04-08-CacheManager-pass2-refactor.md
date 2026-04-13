# CacheManager.gs — Pass 2 Audit & Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `plan-driven-file-refactoring` to implement this plan.

**Goal:** Remove residual dead code and stale comments from the pass-1 refactor, extract a `_snapshot()` helper to DRY the duplicate return-object construction, fix a correctness bug in `getPartitionStats()`, and eliminate the intermediate `allInvoices` array in `invalidateSupplierCache`.
**Architecture:** Zero new abstractions — all changes are deletions, renames, or one small DRY extraction.
**Tech Stack:** Google Apps Script (V8 runtime, ES2019-compatible, no module system, no `require`/`import`)

---

## 1. Current State Summary

| Metric | Value |
|--------|-------|
| Total lines | 751 |
| Total functions | 18 |
| Functions > 80 lines | 0 |
| Functions 60–80 lines | 2 (`invalidateSupplierCache` 77 LOC, `updateSingleInvoice` 58 LOC) |
| Stale `SIMPLIFIED:` JSDoc tags | 5 occurrences (lines 66, 91, 221, 272, 315) |
| Stale internal-refactor comments | 3 (lines 31–32, 701) |
| Dead object fields in `invoiceEntries.push()` | 2 (`partition`, `index` — never destructured from result) |
| Redundant property alias | 1 (`TTL` — single use, aliases `CONFIG.rules.CACHE_TTL_MS`) |
| Duplicate return-object construction | 2 sites (`get()` lines 74–82, `getInvoiceData()` lines 701–710) |
| Wrong JSDoc | 1 (`addInvoiceToCache` `rowNumber` param says "NOT USED" but it is used) |
| Intermediate array that can be eliminated | 1 (`allInvoices` in `invalidateSupplierCache` lines 560–563) |
| Correctness bug | 1 (`getPartitionStats()` implicit string coercion + wrong zero-total inactive %) |

---

## 2. Function-by-Function Analysis

| Function | Lines | LOC | Verdict | Notes |
|----------|-------|-----|---------|-------|
| `get` | 70–87 | 18 | ⚠️ DRY | Return object duplicated in `getInvoiceData` |
| `set` | 95–124 | 30 | ⚠️ Stale JSDoc | `SIMPLIFIED:` prefix |
| `_isActiveInvoice` | 135–148 | 14 | ✅ Clean | — |
| `_addRowToPartition` | 161–181 | 21 | ✅ Clean | — |
| `_applyPartitionTransition` | 195–216 | 22 | ✅ Clean | — |
| `addInvoiceToCache` | 232–267 | 36 | ⚠️ Wrong JSDoc | `rowNumber` param says "NOT USED" — it IS used; `SIMPLIFIED:` prefix |
| `updateInvoiceInCache` | 278–280 | 3 | ⚠️ Stale JSDoc | `SIMPLIFIED:` prefix |
| `patchInvoiceField` | 295–310 | 16 | ✅ Clean | — |
| `updateSingleInvoice` | 331–388 | 58 | ⚠️ Stale JSDoc | `SIMPLIFIED:` prefix |
| `_moveToInactivePartition` | 400–436 | 37 | ✅ Clean | — |
| `_moveToActivePartition` | 447–481 | 35 | ✅ Clean | — |
| `invalidate` | 494–517 | 24 | ✅ Clean | — |
| `invalidateGlobal` | 523–525 | 3 | ✅ Clean | — |
| `invalidateSupplierCache` | 535–611 | 77 | ⚠️ Redundant | `allInvoices` intermediate array; dead `partition`/`index` fields in `invoiceEntries` |
| `markPaymentWritten` | 624–628 | 5 | ✅ Clean | — |
| `clear` | 634–650 | 17 | ✅ Clean | — |
| `getInvoiceData` | 670–711 | 42 | ⚠️ DRY + stale | Return object duplicated in `get()`; stale backward-compat comment |
| `getPartitionStats` | 719–750 | 32 | ⚠️ Bug | Inactive % and hit-rate computed via implicit string coercion; zero-total edge case returns wrong 100% |

---

## 3. Specific Issue Categories

### Simplification Opportunities

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| S1 | `invalidateSupplierCache` line 577 | `invoiceEntries.push({ partition, index, key, location })` — `partition` and `index` are never destructured from `invoiceEntries` (line 592 only uses `{ key, location }`); the loop variable names match but the fields in the pushed object are dead | `invoiceEntries.push({ key, location })` |
| S2 | Object definition line 34 | `TTL: CONFIG.rules.CACHE_TTL_MS` — single-use property alias; only referenced once in `get()` as `this.TTL` | Remove field; use `CONFIG.rules.CACHE_TTL_MS` directly in `get()` |
| S3 | Lines 31–32 | `// ═══ PARTITION-ONLY CACHE (SIMPLIFIED) ═══` + `// Removed unified cache for reduced complexity...` — stale refactor narrative; architecture is fully documented in the module JSDoc header | Delete both lines |
| S4 | Lines 66, 91, 221, 272, 315 | `SIMPLIFIED:` prefix in 5 JSDoc descriptions — describes a past refactoring phase, not the current design | Remove `SIMPLIFIED:` prefix + old-design sentence from each |
| S5 | Line 701 | `// ✅ Return partition-only data (backward compatibility removed)` — stale, points to old state | Delete line |
| S6 | `addInvoiceToCache` line 229 | `@param {number} rowNumber - Sheet row number (1-based, NOT USED in partition-only mode)` — `rowNumber` IS used: passed as `sheetRow` to `_addRowToPartition` | Fix JSDoc: `@param {number} rowNumber - Sheet row number (1-based) used for targeted re-reads` |

### Performance / Correctness

| # | Location | Issue | Impact |
|---|----------|-------|--------|
| P1 | `get()` lines 74–82, `getInvoiceData()` lines 701–710 | Identical 7-field partition-data object constructed in 2 places — DRY violation, allocates a new object on every cache hit | Extract `_snapshot()` helper; remove duplication |
| P2 | `getPartitionStats()` lines 742, 744, 748 | `(100 - activePercentage)` and `(100 - activeHitRate)` rely on implicit coercion of `.toFixed(1)` strings to numbers. When `totalCount === 0`, `activePercentage = 0` (integer, not string), so `inactive.percentage = (100 - 0).toFixed(1) = "100.0"` — wrong when there are no invoices | Compute `inactivePercentage` and `inactiveHitRate` independently from raw counts |

### Redundancy

| # | Location | Issue | Affected sites |
|---|----------|-------|----------------|
| R1 | `invalidateSupplierCache` lines 560–578 | `allInvoices` intermediate array builds `{partition, index}` objects only to fetch `currentData` and then look up `location`. Can build `invoiceEntries` directly from `activeRows`/`inactiveRows`, eliminating the intermediate array and its temporary objects | 1 function — `invalidateSupplierCache` |
| R2 | `get()` / `getInvoiceData()` | Same 7-field object constructed twice (see P1) | 2 sites → extract `_snapshot()` |

---

## 4. Cache Strategy Review — No Changes

The cache strategy is sound after pass 1. No architectural changes needed in pass 2.

---

## 5. Self-Test: 2026-04-08

Audited against current `CacheManager.gs` (751 lines).

| Task | Status | Notes |
|------|--------|-------|
| Task 1: Remove dead fields from `invoiceEntries.push()` | ✅ done | `4da104f` |
| Task 2: Remove `TTL` property alias | ✅ done | `cd04c64` |
| Task 3: Sweep stale `SIMPLIFIED:` / refactor-narrative comments | ✅ done | `747a1bc` |
| Task 4: Fix wrong `rowNumber` JSDoc in `addInvoiceToCache` | ✅ done | `5c2ae75` |
| Task 5: Eliminate `allInvoices` intermediate array | ✅ done | `548a0d0` |
| Task 6: Extract `_snapshot()` helper | ✅ done | `3da215f` |
| Task 7: Fix `getPartitionStats()` inactive computations | ✅ done | `21a55c7` |

---

## Task Sequence

| Order | Task | Type | Rationale |
|-------|------|------|-----------|
| 1 | Remove dead fields from `invoiceEntries.push()` | delete | Simplest; 1-line change |
| 2 | Remove `TTL` property alias | delete | 2-line change; no dependencies |
| 3 | Sweep stale `SIMPLIFIED:` and refactor-narrative comments | polish | Comment-only; no logic risk |
| 4 | Fix wrong `rowNumber` JSDoc | polish | Comment-only; no logic risk |
| 5 | Eliminate `allInvoices` intermediate array | simplify | Reduce object churn in hot path |
| 6 | Extract `_snapshot()` helper | extract → DRY | Must extract before DRY-replacing both call sites |
| 7 | Fix `getPartitionStats()` inactive computations | fix | Correctness; independent of other tasks |

> **Rule:** Delete dead code first. Extract helpers before DRY-replacing call sites.

---

## Files

| Action | File | What changes |
|--------|------|--------------|
| Modify | `CacheManager.gs` | All tasks |

---

## Verification Checklist

Run after all tasks complete.

- [ ] Zero parse errors (paste into Apps Script editor)
- [ ] No function exceeds 80 lines
- [ ] `invoiceEntries.push` has no `partition` or `index` fields: `grep -n "invoiceEntries.push" CacheManager.gs` shows only `{ key, location }`
- [ ] `this.TTL` absent: `grep -n "this\.TTL" CacheManager.gs` returns nothing
- [ ] `SIMPLIFIED:` absent: `grep -n "SIMPLIFIED:" CacheManager.gs` returns nothing
- [ ] `_snapshot` present and called from `get()` and `getInvoiceData()`: `grep -n "_snapshot" CacheManager.gs` shows definition + 2 call sites
- [ ] `allInvoices` absent: `grep -n "allInvoices" CacheManager.gs` returns nothing
- [ ] `getPartitionStats()` inactive percentage computed independently (not via `100 - activePercentage`)
- [ ] Smoke test A: Run `testCacheInvalidation()` in Test.Integration.gs — passes
- [ ] Smoke test B: Run `runQuickBenchmark()` in Benchmark.Performance.gs — completes without errors

---

## Task 1: Remove Dead Fields from `invoiceEntries.push()` (Line 577)

**Files:**
- Modify: `CacheManager.gs:577`

The `invoiceEntries` array is consumed at line 592 with `for (const { key, location } of invoiceEntries)`. Only `key` and `location` are destructured. The `partition` and `index` fields pushed at line 577 are never read from the result objects.

- [ ] **Step 1: Remove dead fields**

```js
// BEFORE (line 577):
        invoiceEntries.push({ partition, index, key, location });

// AFTER:
        invoiceEntries.push({ key, location });
```

- [ ] **Step 2b: Verify**

`grep -n "invoiceEntries\.push" CacheManager.gs` shows only `{ key, location }`.

- [ ] **Step 3: Commit**

```
git add CacheManager.gs
git commit -m "refactor(CacheManager): remove dead partition/index fields from invoiceEntries

The consuming loop only destructures {key, location}. The partition and index
fields pushed into each entry were never read from the result array."
```

---

## Task 2: Remove `TTL` Property Alias (Line 34)

**Files:**
- Modify: `CacheManager.gs:34` (delete field) and `CacheManager.gs:72` (inline reference)

`TTL: CONFIG.rules.CACHE_TTL_MS` is a named alias for a config value. It is referenced exactly once in `get()` as `this.TTL`. Removing it reduces object state by one field.

- [ ] **Step 1: Delete the field from the object definition**

```js
// BEFORE (line 34):
  TTL: CONFIG.rules.CACHE_TTL_MS,  // Time-to-live in milliseconds

// AFTER: (delete the line entirely)
```

- [ ] **Step 2: Inline the reference in `get()`**

```js
// BEFORE (line 72):
    if (this.activeData && this.timestamp && (now - this.timestamp) < this.TTL) {

// AFTER:
    if (this.activeData && this.timestamp && (now - this.timestamp) < CONFIG.rules.CACHE_TTL_MS) {
```

- [ ] **Step 3: Verify**

`grep -n "this\.TTL" CacheManager.gs` returns zero matches.

- [ ] **Step 4: Commit**

```
git add CacheManager.gs
git commit -m "refactor(CacheManager): inline TTL reference, remove single-use property alias

TTL was set once from CONFIG.rules.CACHE_TTL_MS and read once in get().
Direct reference is clearer and reduces object state."
```

---

## Task 3: Sweep Stale `SIMPLIFIED:` and Refactor-Narrative Comments

**Files:**
- Modify: `CacheManager.gs` (lines 31–32, 66, 91, 221, 272, 315, 701)

These comments describe the old unified-cache architecture that was replaced in a prior refactor. They add noise without informing readers about the current design.

- [ ] **Step 1: Delete the section divider and "Removed unified cache" comment (lines 31–32)**

```js
// BEFORE (lines 31–32):
  // ═══ PARTITION-ONLY CACHE (SIMPLIFIED) ═══
  // Removed unified cache for reduced complexity and better scalability
  timestamp: null,

// AFTER:
  timestamp: null,
```

- [ ] **Step 2: Remove `SIMPLIFIED:` lines from 5 JSDoc blocks**

In `get()` (line 66) — remove the entire `SIMPLIFIED:` line:
```js
// BEFORE:
   * SIMPLIFIED: Returns partition-only data (no backward compatibility)
   *
// AFTER: (delete the line and the blank line after it)
```

In `set()` (line 91) — remove the `SIMPLIFIED:` line:
```js
// BEFORE:
   * SIMPLIFIED: Builds only partition structures (no unified cache)
   *
// AFTER: (delete the line and the blank line after it)
```

In `addInvoiceToCache()` (line 221):
```js
// BEFORE:
   * SIMPLIFIED: Direct partition write without redundant reads or unified cache
   *
// AFTER: (delete the line and the blank line after it)
```

In `updateInvoiceInCache()` (line 272):
```js
// BEFORE:
   * SIMPLIFIED: Direct delegation to updateSingleInvoice
   *
// AFTER: (delete the line and the blank line after it)
```

In `updateSingleInvoice()` (line 315):
```js
// BEFORE:
   * SIMPLIFIED: Uses globalIndexMap for partition-aware updates
   *
// AFTER: (delete the line and the blank line after it)
```

- [ ] **Step 3: Remove stale backward-compat comment in `getInvoiceData()` (line 701)**

```js
// BEFORE:
    // ✅ Return partition-only data (backward compatibility removed)
    return {

// AFTER:
    return {
```

- [ ] **Step 4: Verify**

`grep -n "SIMPLIFIED:\|Removed unified cache\|backward compatibility removed\|PARTITION-ONLY CACHE" CacheManager.gs` returns zero matches.

- [ ] **Step 5: Commit**

```
git add CacheManager.gs
git commit -m "style(CacheManager): remove stale SIMPLIFIED and refactor-narrative comments

8 comment lines describing the old unified-cache architecture and the pass-1
refactor phase. Current design is fully described by the module JSDoc header."
```

---

## Task 4: Fix Wrong `rowNumber` JSDoc in `addInvoiceToCache`

**Files:**
- Modify: `CacheManager.gs` (`addInvoiceToCache` JSDoc `@param` for `rowNumber`)

The JSDoc says `rowNumber` is "NOT USED in partition-only mode", but `rowNumber` is passed directly to `_addRowToPartition` as the `sheetRow` argument and stored in `globalIndexMap` for future re-reads.

- [ ] **Step 1: Fix the `@param` line**

```js
// BEFORE:
   * @param {number} rowNumber - Sheet row number (1-based, NOT USED in partition-only mode)

// AFTER:
   * @param {number} rowNumber - Sheet row number (1-based) stored for targeted re-reads
```

- [ ] **Step 2b: Verify**

`grep -n "NOT USED" CacheManager.gs` returns zero matches.

- [ ] **Step 3: Commit**

```
git add CacheManager.gs
git commit -m "docs(CacheManager): fix misleading rowNumber JSDoc in addInvoiceToCache

Parameter is passed to _addRowToPartition as sheetRow and stored in
globalIndexMap — not unused. Corrects a stale comment from prior refactor."
```

---

## Task 5: Eliminate `allInvoices` Intermediate Array in `invalidateSupplierCache`

**Files:**
- Modify: `CacheManager.gs` (`invalidateSupplierCache` method, lines ~560–578)

Currently the method builds `allInvoices` (an array of `{partition, index}` objects) and then loops it to build `invoiceEntries`. The two steps can be collapsed into a single loop directly over `activeRows` and `inactiveRows`.

**Current code (lines 560–578):**
```js
      // Process all invoices for this supplier (both partitions)
      const allInvoices = [
        ...activeRows.map(idx => ({ partition: 'active', index: idx })),
        ...inactiveRows.map(idx => ({ partition: 'inactive', index: idx }))
      ];

      // ── PERF FIX: collect all sheet-row numbers first, then read the entire
      //    range in a single API call instead of one getValues() per invoice.
      const invoiceEntries = [];
      for (const { partition, index } of allInvoices) {
        const currentData = partition === 'active'
          ? this.activeData[index]
          : this.inactiveData[index];
        if (!currentData) continue;
        const invoiceNo = StringUtils.normalize(currentData[col.invoiceNo]);
        const key = `${normalizedSupplier}|${invoiceNo}`;
        const location = this.globalIndexMap.get(key);
        if (!location) continue;
        invoiceEntries.push({ key, location });
      }
```

- [ ] **Step 1: Replace with direct double-loop construction**

```js
      // Collect sheet-row numbers for both partitions in a single pass.
      // One batch API read covers all rows regardless of N invoices.
      const invoiceEntries = [];
      for (const idx of activeRows) {
        const currentData = this.activeData[idx];
        if (!currentData) continue;
        const invoiceNo = StringUtils.normalize(currentData[col.invoiceNo]);
        const key = `${normalizedSupplier}|${invoiceNo}`;
        const location = this.globalIndexMap.get(key);
        if (!location) continue;
        invoiceEntries.push({ key, location });
      }
      for (const idx of inactiveRows) {
        const currentData = this.inactiveData[idx];
        if (!currentData) continue;
        const invoiceNo = StringUtils.normalize(currentData[col.invoiceNo]);
        const key = `${normalizedSupplier}|${invoiceNo}`;
        const location = this.globalIndexMap.get(key);
        if (!location) continue;
        invoiceEntries.push({ key, location });
      }
```

- [ ] **Step 2a: Spot-check**

After this change, call `invalidateSupplierCache('ACME')` on a supplier with both active and inactive invoices. Confirm all invoices are still findable via `InvoiceManager.findInvoice()`.

- [ ] **Step 3: Verify**

`grep -n "allInvoices" CacheManager.gs` returns zero matches. `grep -n "invoiceEntries\.push" CacheManager.gs` shows exactly 2 call sites (one per loop).

- [ ] **Step 4: Commit**

```
git add CacheManager.gs
git commit -m "refactor(CacheManager): eliminate allInvoices intermediate array

Builds invoiceEntries directly from activeRows/inactiveRows in two loops.
Removes temporary {partition, index} object allocation per invoice."
```

---

## Task 6: Extract `_snapshot()` Helper

**Files:**
- Modify: `CacheManager.gs`

The 7-field partition-data return object is constructed identically in `get()` (lines 74–82) and `getInvoiceData()` (lines 701–710). Extract `_snapshot()` as a private helper that both sites call.

- [ ] **Step 1: Add `_snapshot()` private helper**

Insert immediately after `_applyPartitionTransition` (after line 216, before `addInvoiceToCache`):

```js
  /**
   * Build the standard partition-data result object from current state.
   * Called by get() on cache hit and by getInvoiceData() after a cache miss load.
   *
   * @private
   * @returns {{activeData:Array, activeIndexMap:Map, activeSupplierIndex:Map, inactiveData:Array, inactiveIndexMap:Map, inactiveSupplierIndex:Map, globalIndexMap:Map}}
   */
  _snapshot: function() {
    return {
      activeData: this.activeData,
      activeIndexMap: this.activeIndexMap,
      activeSupplierIndex: this.activeSupplierIndex,
      inactiveData: this.inactiveData,
      inactiveIndexMap: this.inactiveIndexMap,
      inactiveSupplierIndex: this.inactiveSupplierIndex,
      globalIndexMap: this.globalIndexMap
    };
  },
```

- [ ] **Step 2: Replace call site in `get()`**

```js
// BEFORE (lines 73–83):
      this.stats.cacheHits++;
      return {
        activeData: this.activeData,
        activeIndexMap: this.activeIndexMap,
        activeSupplierIndex: this.activeSupplierIndex,
        inactiveData: this.inactiveData,
        inactiveIndexMap: this.inactiveIndexMap,
        inactiveSupplierIndex: this.inactiveSupplierIndex,
        globalIndexMap: this.globalIndexMap
      };

// AFTER:
      this.stats.cacheHits++;
      return this._snapshot();
```

- [ ] **Step 3: Replace call site in `getInvoiceData()`**

The `return { activeData: ... }` block at lines 701–710 (after `this.set(data)`) becomes:

```js
// BEFORE:
    this.set(data);

    // ✅ Return partition-only data (backward compatibility removed)  ← already deleted in Task 3
    return {
      activeData: this.activeData,
      activeIndexMap: this.activeIndexMap,
      activeSupplierIndex: this.activeSupplierIndex,
      inactiveData: this.inactiveData,
      inactiveIndexMap: this.inactiveIndexMap,
      inactiveSupplierIndex: this.inactiveSupplierIndex,
      globalIndexMap: this.globalIndexMap
    };

// AFTER:
    this.set(data);
    return this._snapshot();
```

- [ ] **Step 2a: Spot-check**

Call `CacheManager.getInvoiceData()` on a populated sheet. Confirm the returned object contains non-empty `activeData`, `activeIndexMap`, and `globalIndexMap`. Call again within TTL; confirm `stats.cacheHits` increments.

- [ ] **Step 4: Verify**

`grep -n "_snapshot" CacheManager.gs` shows: 1 definition, 2 call sites (in `get` and `getInvoiceData`). Neither `get()` nor `getInvoiceData()` contains `activeIndexMap: this.activeIndexMap` inline.

- [ ] **Step 5: Commit**

```
git add CacheManager.gs
git commit -m "refactor(CacheManager): extract _snapshot() helper for partition-data object

Eliminates duplicate 7-field return object construction in get() and
getInvoiceData(). Pure DRY extraction — no behavioral change."
```

---

## Task 7: Fix `getPartitionStats()` Inactive Percentage Computations

**Files:**
- Modify: `CacheManager.gs` (`getPartitionStats`, lines 719–750)

**Problem A — Implicit string coercion:**
`activePercentage` and `activeHitRate` are strings (from `.toFixed(1)`). Using them in `100 - activePercentage` works in JS via coercion, but is fragile and relies on implicit behavior.

**Problem B — Wrong zero-total result:**
When `totalCount === 0`, the ternary assigns `activePercentage = 0` (integer literal, not string). Then `inactive.percentage = (100 - 0).toFixed(1) = "100.0"` — incorrect; inactive should be `"0.0"` when there are no invoices. Same issue for `activeHitRate = 0` when `totalPartitionHits === 0`.

**Problem C — `memoryReduction` uses `parseFloat(activePercentage)` as workaround for the same coercion, adding unnecessary noise.**

- [ ] **Step 1: Rewrite `getPartitionStats()` to compute all values from raw counts**

```js
  getPartitionStats: function () {
    const activeCount = this.activeData ? this.activeData.length - 1 : 0; // Exclude header
    const inactiveCount = this.inactiveData ? this.inactiveData.length - 1 : 0;
    const totalCount = activeCount + inactiveCount;

    const activePercent = totalCount > 0 ? activeCount / totalCount * 100 : 0;
    const inactivePercent = totalCount > 0 ? inactiveCount / totalCount * 100 : 0;

    const totalPartitionHits = this.stats.activePartitionHits + this.stats.inactivePartitionHits;
    const activeHitPercent = totalPartitionHits > 0
      ? this.stats.activePartitionHits / totalPartitionHits * 100
      : 0;
    const inactiveHitPercent = totalPartitionHits > 0
      ? this.stats.inactivePartitionHits / totalPartitionHits * 100
      : 0;

    return {
      active: {
        count: activeCount,
        percentage: activePercent.toFixed(1),
        hitCount: this.stats.activePartitionHits,
        hitRate: activeHitPercent.toFixed(1)
      },
      inactive: {
        count: inactiveCount,
        percentage: inactivePercent.toFixed(1),
        hitCount: this.stats.inactivePartitionHits,
        hitRate: inactiveHitPercent.toFixed(1)
      },
      total: totalCount,
      transitions: this.stats.partitionTransitions,
      memoryReduction: `${inactivePercent.toFixed(0)}% (inactive invoices separated)`
    };
  }
```

- [ ] **Step 2b: Verify**

1. Call `getPartitionStats()` on an empty cache (no data loaded). Confirm `active.percentage === "0.0"` and `inactive.percentage === "0.0"` (not `"100.0"`).
2. Call on a loaded cache with known data. Confirm `active.percentage + inactive.percentage ≈ "100.0"` (may differ by 0.1 due to rounding, which is correct).

`grep -n "100 - active" CacheManager.gs` returns zero matches.

- [ ] **Step 3: Commit**

```
git add CacheManager.gs
git commit -m "fix(CacheManager): compute inactive stats from raw counts in getPartitionStats

Previous code used (100 - activePercentage) where activePercentage was a
.toFixed(1) string, relying on implicit coercion. When totalCount=0 the
ternary returned integer 0, making inactive percentage incorrectly show 100%.
Now computes active and inactive percentages and hit-rates independently."
```

---

## Post-Refactor Size Estimate

| Change | Lines removed | Lines added | Net |
|--------|--------------|-------------|-----|
| Task 1: remove dead push fields | −1 | 0 | −1 |
| Task 2: remove `TTL` property | −1 | 0 | −1 |
| Task 3: stale comment sweep | −10 | 0 | −10 |
| Task 4: fix `rowNumber` JSDoc | 0 | 0 | 0 |
| Task 5: eliminate `allInvoices` | −11 | +14 | +3 |
| Task 6: extract `_snapshot()` | −16 | +13 | −3 |
| Task 7: fix `getPartitionStats()` | −8 | +12 | +4 |
| **Total** | **−47** | **+39** | **−8 lines (~751 → ~743)** |

> Pass 2 is primarily about correctness and code clarity, not line-count reduction.
