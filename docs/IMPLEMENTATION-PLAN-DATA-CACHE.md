# Implementation Plan: Transformed Data Cache

**Priority:** Medium  
**Effort:** 2-3 hours  
**Impact:** High (30-50% CPU reduction for multi-template scenarios)  
**Risk:** Low

---

## Problem Statement

When multiple templates display data from the same class (e.g., M21), the current architecture:
1. ✅ Fetches API data once (cached efficiently)
2. ❌ Transforms data multiple times (redundant)
3. ❌ Maps fields multiple times (redundant)

**Example Scenario:**
- Template A: Results list showing M21 class
- Template B: Lower-third showing M21 runner
- Template C: Split times showing M21 runner

**Current Flow:**
```
Template A plays → Fetch M21 (API call) → Transform → Map → Display
Template B plays → Fetch M21 (cached ✅) → Transform (again ❌) → Map → Display
Template C plays → Fetch M21 (cached ✅) → Transform (again ❌) → Map → Display
```

**Optimized Flow:**
```
Template A plays → Fetch M21 (API call) → Transform → Cache → Map → Display
Template B plays → Fetch M21 (cached ✅) → Get cached transform ✅ → Map → Display
Template C plays → Fetch M21 (cached ✅) → Get cached transform ✅ → Map → Display
```

---

## Solution Design

### Add Transformed Data Cache to DataStore

**Location:** `src/main/data/DataStore.ts`

**New Cache Structure:**
```typescript
private transformedResults: Map<string, {
  ografData: OGrafResultsData;
  hash: string;
  timestamp: number;
}> = new Map();
```

**Key Format:** `${competitionId}_${className}`

**Cache Invalidation:**
- When raw API data hash changes
- When cache is older than 5 minutes (configurable)
- When explicitly cleared

---

## Implementation Steps

### Step 1: Add Cache Storage to DataStore

**File:** `src/main/data/DataStore.ts`

**Add after line 45:**
```typescript
private transformedResults: Map<string, {
  ografData: OGrafResultsData;
  hash: string;
  timestamp: number;
}> = new Map();

private readonly TRANSFORM_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
```

---

### Step 2: Create Cached Transform Method

**File:** `src/main/data/DataStore.ts`

**Add new method:**
```typescript
/**
 * Get transformed class results with caching
 * Only re-transforms if raw data hash changed
 */
async getTransformedClassResults(
  competitionId: number,
  className: string,
  options?: {
    maxRows?: number;
    competitionName?: string;
  }
): Promise<OGrafResultsData> {
  const client = getLiveResultsClient();
  const key = `${competitionId}_${className}`;

  // Fetch raw data (uses LiveResultsClient cache)
  const rawData = await client.getClassResults(competitionId, className);

  // Check if we have cached transformed data
  const cached = this.transformedResults.get(key);
  const now = Date.now();

  // Return cached if:
  // 1. Cache exists
  // 2. Hash matches (data hasn't changed)
  // 3. Cache is not stale (within TTL)
  if (cached && 
      cached.hash === rawData.hash && 
      (now - cached.timestamp) < this.TRANSFORM_CACHE_TTL) {
    logger.debug('Returning cached transformed data', {
      competitionId,
      className,
      cacheAge: now - cached.timestamp
    });
    return cached.ografData;
  }

  // Transform data
  logger.debug('Transforming class results', {
    competitionId,
    className,
    reason: !cached ? 'no cache' : 
            cached.hash !== rawData.hash ? 'hash changed' : 
            'cache stale'
  });

  const ografData = LiveResultsTransformer.transformClassResults(
    rawData.data,
    options
  );

  // Cache transformed data
  this.transformedResults.set(key, {
    ografData,
    hash: rawData.hash,
    timestamp: now
  });

  return ografData;
}
```

---

### Step 3: Update DataSourceFieldMapper to Use Cache

**File:** `src/main/data/DataSourceFieldMapper.ts`

**Replace lines 60-100 (fetchLiveResultsData method):**

**Before:**
```typescript
const classResult = await client.getClassResults(competitionId, className);
const ografData = LiveResultsTransformer.transformClassResults(
  classResult.data,
  { competitionName }
);
```

**After:**
```typescript
const dataStore = getDataStore();
const ografData = await dataStore.getTransformedClassResults(
  competitionId,
  className,
  { competitionName }
);
```

**Add import:**
```typescript
import { getDataStore } from './DataStore';
```

---

### Step 4: Update PlaybackEngine Legacy System

**File:** `src/main/playback/PlaybackEngine.ts`

**Replace lines 250-280 (legacy LiveResults fetch):**

**Before:**
```typescript
const classResult = await liveResultsClient.getClassResults(
  item.liveResultsData.competitionId,
  item.liveResultsData.className
);

const ografData = LiveResultsTransformer.transformClassResults(
  classResult.data,
  {
    maxRows: item.liveResultsData.maxRows,
    competitionName: competition.name
  }
);
```

**After:**
```typescript
const ografData = await dataStore.getTransformedClassResults(
  item.liveResultsData.competitionId,
  item.liveResultsData.className,
  {
    maxRows: item.liveResultsData.maxRows,
    competitionName: competition.name
  }
);
```

---

### Step 5: Add Cache Management Methods

**File:** `src/main/data/DataStore.ts`

**Add methods for cache management:**
```typescript
/**
 * Clear transformed data cache
 */
clearTransformedCache(competitionId?: number, className?: string): void {
  if (competitionId && className) {
    const key = `${competitionId}_${className}`;
    this.transformedResults.delete(key);
    logger.info('Cleared transformed cache', { competitionId, className });
  } else if (competitionId) {
    // Clear all for competition
    const keys = Array.from(this.transformedResults.keys())
      .filter(k => k.startsWith(`${competitionId}_`));
    keys.forEach(k => this.transformedResults.delete(k));
    logger.info('Cleared transformed cache for competition', { competitionId, count: keys.length });
  } else {
    // Clear all
    this.transformedResults.clear();
    logger.info('Cleared all transformed cache');
  }
}

/**
 * Get cache statistics
 */
getTransformedCacheStats(): {
  size: number;
  entries: Array<{ key: string; age: number; hash: string }>;
} {
  const now = Date.now();
  const entries = Array.from(this.transformedResults.entries()).map(([key, value]) => ({
    key,
    age: now - value.timestamp,
    hash: value.hash
  }));

  return {
    size: this.transformedResults.size,
    entries
  };
}
```

---

### Step 6: Add IPC Handlers for Cache Management

**File:** `src/main/ipc/dataHandlers.ts`

**Add handlers:**
```typescript
/**
 * Clear transformed data cache
 */
ipcMain.handle('data:clearTransformedCache', async (
  _event,
  competitionId?: number,
  className?: string
) => {
  try {
    const store = getDataStore();
    store.clearTransformedCache(competitionId, className);
    return { success: true };
  } catch (error) {
    logger.error('IPC error: data:clearTransformedCache', {
      error: (error as Error).message
    });
    return {
      success: false,
      error: (error as Error).message
    };
  }
});

/**
 * Get cache statistics
 */
ipcMain.handle('data:getTransformedCacheStats', async () => {
  try {
    const store = getDataStore();
    const stats = store.getTransformedCacheStats();
    return { success: true, data: stats };
  } catch (error) {
    logger.error('IPC error: data:getTransformedCacheStats', {
      error: (error as Error).message
    });
    return {
      success: false,
      error: (error as Error).message
    };
  }
});
```

---

## Testing Plan

### Test Case 1: Single Template
**Expected:** No performance change (baseline)
1. Play results-list-paginated template for M21
2. Verify data loads correctly
3. Check logs for "Transforming class results" (should appear once)

### Test Case 2: Multiple Templates, Same Class
**Expected:** 30-50% reduction in transform operations
1. Play results-list-paginated for M21
2. Play lower-third for M21 runner
3. Play split-times for M21 runner
4. Check logs:
   - First play: "Transforming class results"
   - Second play: "Returning cached transformed data"
   - Third play: "Returning cached transformed data"

### Test Case 3: Cache Invalidation
**Expected:** Re-transform when data changes
1. Play template for M21
2. Wait for LiveResults data to update (hash changes)
3. Play template again
4. Check logs: "Transforming class results" with reason "hash changed"

### Test Case 4: Cache TTL
**Expected:** Re-transform after 5 minutes
1. Play template for M21
2. Wait 6 minutes
3. Play template again
4. Check logs: "Transforming class results" with reason "cache stale"

---

## Performance Metrics

### Before Implementation
- 3 templates showing M21 class
- API calls: 1 (cached ✅)
- Transformations: 3 (redundant ❌)
- CPU time: ~30ms per transform = 90ms total

### After Implementation
- 3 templates showing M21 class
- API calls: 1 (cached ✅)
- Transformations: 1 (cached ✅)
- CPU time: ~30ms total

**Improvement:** 67% reduction in transformation overhead

---

## Rollback Plan

If issues arise:
1. Revert changes to `DataSourceFieldMapper.ts`
2. Revert changes to `PlaybackEngine.ts`
3. Remove new methods from `DataStore.ts`
4. System will fall back to original behavior

**Risk:** Very low - cache is purely additive, doesn't change core logic

---

## Future Enhancements

1. **Configurable TTL:** Allow per-template cache TTL settings
2. **Memory Management:** Add max cache size limit with LRU eviction
3. **Cache Warming:** Pre-fetch and transform data for upcoming templates
4. **Metrics Dashboard:** Show cache hit rate, memory usage in UI


