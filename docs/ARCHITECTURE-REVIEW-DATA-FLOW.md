# Data Flow Architecture Review & Recommendations

**Date:** 2025-10-21  
**Status:** Analysis Complete  
**Reviewer:** AI Agent

---

## Executive Summary

The current data flow architecture is **well-designed and already optimal** for theme-based flexibility. The new datasource configuration system (`DataSourceFieldMapper` + template datasource configs) provides excellent declarative data handling while maintaining backward compatibility. However, there are **3 specific improvements** recommended to enhance efficiency and reduce redundancy.

**Overall Assessment:** ✅ **Architecture is sound** - Minor optimizations recommended

---

## Current Architecture Analysis

### 1. Data Flow Layers (5 Layers)

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: API Client (LiveResultsClient)                     │
│ - HTTP requests with hash-based caching                     │
│ - Polling management (per competition/class)                │
│ - Cache: competitions, classes, classResults, lastPassings  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: Data Transformer (LiveResultsTransformer)          │
│ - Converts LiveResults API format → OGRAF standard format   │
│ - Calculates time diffs, formats times, status codes        │
│ - Output: OGrafResultsData, OGrafRunner                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Field Mapper (DataSourceFieldMapper) [NEW SYSTEM]  │
│ - Applies template-specific field mappings                  │
│ - Extracts data using dot notation (e.g., "results[0].name")│
│ - Applies transformations (uppercase, formatTime, etc.)     │
│ - Handles control point selection logic                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: Legacy Mapper (LiveResultsMapper) [LEGACY SYSTEM]  │
│ - Template-type-specific mapping (start-list, results, etc.)│
│ - Hardcoded transformations for specific template types     │
│ - Used for backward compatibility                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 5: Playback Engine                                    │
│ - Orchestrates data fetching during playback                │
│ - Chooses between new system vs legacy system               │
│ - Passes data to OGRAF templates                            │
└─────────────────────────────────────────────────────────────┘
```

### 2. Caching Mechanisms ✅ EXCELLENT

**LiveResultsClient** implements hash-based change detection:
- Each API response includes a hash (MD5 of data)
- Cache stores: `{ data, hash, timestamp }`
- Only triggers `onUpdate` callback if hash changed
- **Result:** Minimal unnecessary data processing

**Cache Scope:**
- `competitions`: Global (all competitions)
- `classes[competitionId]`: Per competition
- `classResults[competitionId_className]`: Per class
- `lastPassings[competitionId]`: Per competition

**Polling Efficiency:**
- Polls at configurable intervals (default: 15s)
- Only fetches data that changed (hash comparison)
- **No redundant API calls** - excellent design

### 3. Template Data Declaration ✅ EXCELLENT

Templates declare data requirements via `{template-id}.datasource.json`:

```json
{
  "version": "1.0",
  "mode": "api",
  "api": {
    "provider": "liveresults",
    "fieldMappings": [
      {
        "templateField": "results",
        "apiPath": "results",
        "required": true
      },
      {
        "templateField": "className",
        "apiPath": "className",
        "required": true
      }
    ],
    "uiControls": [
      {
        "type": "class-selector",
        "storeAs": "className"
      }
    ],
    "autoUpdate": {
      "defaultEnabled": true,
      "intervalMs": 5000
    }
  }
}
```

**Strengths:**
- ✅ Declarative - no code changes needed for new templates
- ✅ Flexible field mappings with dot notation
- ✅ Built-in transformations (uppercase, formatTime, etc.)
- ✅ UI controls auto-generated from config
- ✅ Supports manual, api, and hybrid modes

---

## Identified Issues & Recommendations

### Issue 1: Dual System Redundancy ⚠️ MEDIUM PRIORITY

**Problem:**
- Two parallel systems: `DataSourceFieldMapper` (new) + `LiveResultsMapper` (legacy)
- Both do similar transformations
- Legacy system has hardcoded template types
- Increases maintenance burden

**Current Code (PlaybackEngine.ts:153-187):**
```typescript
// NEW datasource configuration system
if (template.dataSourceConfig && item.liveResultsData?.dataSourceValues) {
  const mappedData = await DataSourceFieldMapper.fetchAndMapData(...);
  graphicData = mappedData;
}
// Legacy LiveResults auto-fetch (backward compatibility)
else if (item.liveResultsData?.competitionId && item.liveResultsData?.className) {
  // Uses LiveResultsMapper.autoMap()
}
```

**Recommendation:**
1. **Keep both systems for now** (backward compatibility is critical)
2. **Add deprecation warnings** to legacy system
3. **Create migration guide** for converting legacy templates to new datasource config
4. **Plan to remove legacy system** in v2.0 (6-12 months)

**Migration Path:**
- Identify all templates using legacy system
- Create datasource.json files for each
- Test equivalence
- Deprecate LiveResultsMapper in next major version

---

### Issue 2: Polling is Per-Class, Not Per-Template ⚠️ LOW PRIORITY

**Problem:**
- Multiple templates showing same class data create **only one poll** (good!)
- But: Polling interval is global per class, not per template
- Template A might want 5s updates, Template B wants 15s updates
- Currently: Uses the interval from whichever template started polling first

**Current Implementation:**
- `DataStore.startPolling(competitionId, className, interval)`
- Key: `${competitionId}_${className}`
- If already polling, doesn't restart with new interval

**Recommendation:**
✅ **Current design is actually optimal** - here's why:
- API efficiency: One poll per class is better than multiple
- Data consistency: All templates see same data at same time
- Simplicity: No complex interval negotiation logic

**Alternative (if needed):**
- Use **minimum interval** among all active templates for that class
- Track which templates are subscribed to each poll
- Adjust interval dynamically when templates are added/removed
- **Complexity:** High, **Benefit:** Low → **Not recommended**

---

### Issue 3: No Shared Data Cache Between Templates ⚠️ MEDIUM PRIORITY

**Problem:**
- Each template fetch goes through full pipeline:
  - API call (cached) ✅
  - Transform to OGRAF (repeated) ❌
  - Field mapping (repeated) ❌
- If 3 templates show same class, transformation happens 3 times

**Example Scenario:**
- Template A: Results list (M21 class)
- Template B: Lower-third (M21 class, specific runner)
- Template C: Split times (M21 class, specific runner)

**Current Flow:**
```
Template A plays → Fetch M21 → Transform → Map → Display
Template B plays → Fetch M21 (cached ✅) → Transform (again ❌) → Map → Display
Template C plays → Fetch M21 (cached ✅) → Transform (again ❌) → Map → Display
```

**Recommendation:**
Add a **transformed data cache** in DataStore:

```typescript
// In DataStore.ts
private transformedData: Map<string, {
  ografData: OGrafResultsData;
  hash: string;
  timestamp: number;
}> = new Map();

async getTransformedClassResults(
  competitionId: number,
  className: string
): Promise<OGrafResultsData> {
  const key = `${competitionId}_${className}`;
  
  // Check if we have cached transformed data
  const cached = this.transformedData.get(key);
  const rawData = await client.getClassResults(competitionId, className);
  
  // Only re-transform if raw data changed
  if (cached && cached.hash === rawData.hash) {
    return cached.ografData;
  }
  
  // Transform and cache
  const ografData = LiveResultsTransformer.transformClassResults(rawData.data);
  this.transformedData.set(key, {
    ografData,
    hash: rawData.hash,
    timestamp: Date.now()
  });
  
  return ografData;
}
```

**Benefits:**
- ✅ Eliminates redundant transformations
- ✅ Maintains same API efficiency
- ✅ Minimal code changes
- ✅ Transparent to templates

**Estimated Impact:**
- CPU: 30-50% reduction in transformation overhead
- Memory: Negligible (transformed data is small)
- Complexity: Low (simple cache layer)

---

## Answers to Specific Questions

### Q1: Is DataSourceFieldMapper flexible enough for different template types?

**Answer: ✅ YES - Excellent flexibility**

**Evidence:**
- Supports dot notation for nested data: `"runner.name"`, `"results[0].time"`
- Built-in transformations: `uppercase`, `lowercase`, `formatTime`, `formatDate`, `trim`
- Can map entire arrays: `"results"` → full results array
- Can extract single values: `"results[0].name"` → specific runner
- Supports conditional logic via UI controls (class-selector, runner-search, etc.)

**Example - Results List Template:**
```json
{
  "fieldMappings": [
    { "templateField": "results", "apiPath": "results" }
  ]
}
```

**Example - Lower-Third Template:**
```json
{
  "fieldMappings": [
    { "templateField": "runnerName", "apiPath": "results[0].name" },
    { "templateField": "time", "apiPath": "results[0].time" }
  ],
  "uiControls": [
    {
      "type": "runner-search",
      "populateFields": {
        "runnerName": "name",
        "club": "club"
      }
    }
  ]
}
```

**Limitation:** No custom JavaScript transformations
**Recommendation:** Add support for custom transform functions if needed:

```json
{
  "templateField": "displayName",
  "apiPath": "runner.name",
  "transform": "custom:formatRunnerName"
}
```

Then templates can provide custom transforms in their graphic.js:

```javascript
class MyTemplate extends HTMLElement {
  static transforms = {
    formatRunnerName: (name) => name.toUpperCase().split(' ').reverse().join(', ')
  };
}
```

---

### Q2: Should we consolidate legacy and new systems?

**Answer: ⚠️ YES, but gradually**

**Recommendation:**
1. **Phase 1 (Now):** Keep both systems, add deprecation warnings
2. **Phase 2 (3 months):** Migrate all built-in templates to new system
3. **Phase 3 (6 months):** Mark legacy system as deprecated in docs
4. **Phase 4 (12 months):** Remove legacy system in v2.0

**Rationale:**
- Backward compatibility is critical for existing productions
- New system is superior in every way
- Gradual migration reduces risk

---

### Q3: Are there redundant data fetches when multiple templates use same class?

**Answer: ✅ NO - API calls are efficiently cached**

**Evidence:**
- `LiveResultsClient` caches by `${competitionId}_${className}`
- Hash-based change detection prevents redundant processing
- Only one poll per class, regardless of template count

**However:** Transformation is redundant (see Issue 3 above)

---

### Q4: Should templates specify custom data transformations?

**Answer: ⚠️ MAYBE - Add if needed**

**Current Transformations (sufficient for 90% of cases):**
- `uppercase`, `lowercase`, `trim`
- `formatTime`, `formatDate`

**Potential Additions:**
- `formatDistance` - "5.2 km" → "5.2"
- `formatPace` - seconds → "min/km"
- `abbreviate` - "Orienteering Club" → "OC"
- `custom:functionName` - Template-defined functions

**Recommendation:**
- ✅ **Current system is sufficient** for now
- ⚠️ **Add custom transforms** only if real use case emerges
- ⚠️ **Keep it simple** - avoid over-engineering

---

### Q5: Is field mapping system sufficient, or need advanced transformations?

**Answer: ✅ SUFFICIENT - Current system is well-designed**

**Current Capabilities:**
- ✅ Dot notation for nested access
- ✅ Array indexing: `results[0]`
- ✅ Built-in transformations
- ✅ Conditional logic via UI controls

**Missing (but not critical):**
- ❌ Array filtering: `results[status=0]` (only OK runners)
- ❌ Array mapping: `results[].name` (all names)
- ❌ Computed fields: `results[0].time - results[1].time`

**Recommendation:**
- ✅ **Keep current system** - it's simple and powerful
- ⚠️ **Add advanced features** only if specific use case requires it
- ⚠️ **Prefer template-side logic** for complex transformations

---

## Final Recommendations

### Priority 1: Implement Transformed Data Cache (Issue 3)
**Effort:** 2-3 hours  
**Impact:** High (30-50% CPU reduction)  
**Risk:** Low

### Priority 2: Add Deprecation Warnings to Legacy System (Issue 1)
**Effort:** 1 hour  
**Impact:** Medium (guides migration)  
**Risk:** None

### Priority 3: Create Migration Guide
**Effort:** 2-3 hours  
**Impact:** Medium (enables template authors to migrate)  
**Risk:** None

### Priority 4: Monitor for Custom Transform Needs
**Effort:** Ongoing  
**Impact:** Low (future-proofing)  
**Risk:** None

---

## Conclusion

The current architecture is **well-designed and production-ready**. The new datasource configuration system provides excellent theme-based flexibility while maintaining backward compatibility. The main optimization opportunity is adding a transformed data cache to eliminate redundant processing.

**Overall Grade: A-**

**Strengths:**
- ✅ Excellent caching and API efficiency
- ✅ Declarative template data requirements
- ✅ Flexible field mapping system
- ✅ Backward compatible

**Areas for Improvement:**
- ⚠️ Add transformed data cache
- ⚠️ Deprecate legacy system gradually
- ⚠️ Consider custom transform functions (future)


