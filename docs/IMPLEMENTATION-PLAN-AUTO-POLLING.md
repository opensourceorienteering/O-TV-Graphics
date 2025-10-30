# Implementation Plan: Automatic LiveResults Polling Integration

**Date:** 2025-10-22  
**Status:** 📋 PLANNED (Not Yet Implemented)  
**Priority:** Medium  
**Impact:** Feature Enhancement - Automatic data refresh for playing graphics

---

## Executive Summary

This document provides a comprehensive analysis of integrating the existing LiveResults automatic polling system with the PlaybackEngine to enable automatic updates for playing graphics. The polling infrastructure and hash-based change detection already exist and work excellently - we just need to connect them to the playback system.

---

## Question 1: Automatic Data Refresh Integration

### Current Status: ❌ **NOT IMPLEMENTED**

The automatic polling system exists but is **NOT currently integrated** with the PlaybackEngine to update playing graphics.

### What EXISTS:
- ✅ `LiveResultsClient` has polling capability (`startPolling()` method)
- ✅ `DataStore` has polling with hash-based change detection
- ✅ Rundown items have `liveResultsData.autoUpdate` flag
- ✅ UI has "Auto-update from LiveResults" checkbox in Template Settings Panel

### What's MISSING:
- ❌ No connection between DataStore polling and PlaybackEngine
- ❌ No automatic `update` commands sent to playing graphics
- ❌ No listener for `results:updated` events in PlaybackEngine

### Current Behavior:
When automatic polling is enabled:
1. DataStore polls the API every N seconds (default: 15s)
2. If data changes (hash comparison), it emits `results:updated` event
3. **BUT** PlaybackEngine doesn't listen to this event
4. **Result:** Playing graphics are NOT automatically updated

### Expected Behavior (After Implementation):
When automatic polling is enabled:
1. User plays a graphic with `autoUpdate: true`
2. PlaybackEngine starts polling for that competition/class
3. When API data changes, DataStore emits `results:updated`
4. PlaybackEngine receives event and sends `update` command to playing graphic
5. Template's `updateAction()` is called with fresh data
6. Graphic updates smoothly without re-playing animation

---

## Question 2: Update Command Frequency

### Current Behavior: ❌ **NO UPDATE COMMANDS SENT**

Since the integration doesn't exist, no update commands are currently sent during automatic polling.

### Recommended Implementation: **Send `update` Only**

**Option A: Send `update` only (RECOMMENDED)**
```typescript
// When polling detects changes:
if (graphic.isPlaying && item.liveResultsData?.autoUpdate) {
  await playbackEngine.updateItem(projectId, rundownId, itemId, newData);
  // This sends graphics:command with 'update'
  // Template's updateAction() is called
  // Graphic updates WITHOUT re-playing animation
}
```

**Option B: Send `update` + `play` (NOT RECOMMENDED)**
```typescript
// When polling detects changes:
await playbackEngine.updateItem(projectId, rundownId, itemId, newData);
await playbackEngine.nextItem(projectId, rundownId, itemId); // Trigger animation
```

### Recommendation: Use **Option A** (update only)

**Reasons:**
- ✅ Less disruptive to viewers (no animation replay)
- ✅ Follows OGRAF spec (`updateAction` is designed for this use case)
- ✅ Lower overhead (one command vs two)
- ✅ Template controls whether to animate the update (via CSS transitions)
- ✅ Matches broadcast graphics industry standards

### Update Frequency:
- Controlled by `rundown.liveResults.updateInterval` (default: 15000ms)
- Only sends update if data hash changed (no unnecessary updates)
- Configurable per rundown in UI

---

## Question 3: Data Change Detection (Hashing)

### Current Status: ✅ **FULLY IMPLEMENTED**

The system has **EXCELLENT** hash-based change detection at multiple levels.

### Level 1: LiveResultsClient (Raw API Data)

**File:** `src/main/data/LiveResultsClient.ts`

```typescript
private calculateHash(data: any): string {
  const json = JSON.stringify(data);
  return crypto.createHash('md5').update(json).digest('hex');
}

// In getClassResults():
const hash = this.calculateHash(data);
const changed = !cached || cached.hash !== hash;

// Only triggers onUpdate if hash changed
if (result.changed) {
  config.onUpdate(result.data);
}
```

**How it works:**
1. API response is fetched
2. MD5 hash is calculated from JSON.stringify(data)
3. Hash is compared with cached hash
4. `changed: true` only if hashes differ
5. Polling callback (`onUpdate`) only fires if `changed === true`

### Level 2: DataStore (Transformed OGRAF Data)

**File:** `src/main/data/DataStore.ts`

```typescript
private transformedResults: Map<string, {
  ografData: OGrafResultsData;
  hash: string;  // Hash of RAW data
  timestamp: number;
}> = new Map();

// Return cached if hash matches
if (cached && cached.hash === rawData.hash) {
  return cached.ografData; // Skip transformation
}
```

**How it works:**
1. Transformed data is cached with the raw data's hash
2. When fetching data, check if cached hash matches new raw data hash
3. If match, return cached transformed data (skip expensive transformation)
4. If no match, transform and cache with new hash

### Efficiency Analysis:

**Without Hashing (Naive Approach):**
- Poll every 15s → Fetch API → Transform → Update graphic
- 4 updates/minute × 60 minutes = 240 updates/hour
- Even if data unchanged!

**With Hashing (Current Implementation):**
- Poll every 15s → Fetch API → Calculate hash → Compare
- If unchanged: Skip transformation, skip update
- If changed: Transform once, update once
- **Result:** Zero unnecessary updates! ✅

### Performance Impact:
- **Hash calculation:** ~1-2ms for 20 KB JSON (negligible)
- **Hash comparison:** <0.1ms (string equality)
- **Transformation saved:** ~10-50ms per skip (significant)
- **Network saved:** 0 bytes (still polls API, but that's necessary)
- **WebSocket saved:** ~20 KB per skip (significant for high-frequency polling)

---

## Question 4: Partial Data Updates

### Current Status: ❌ **FULL DATASET SENT**

The system currently sends the **ENTIRE dataset** in every `update` command.

### Evidence:

**File:** `src/main/playback/PlaybackEngine.ts` (lines 288-291)

```typescript
// In playItem() - when graphic already loaded:
await this.sendCommand('update', {
  id: graphicId,
  data: graphicData  // FULL dataset (all 94 runners, manifest, etc.)
});
```

### Payload Size Analysis (94 Runners):

**Breakdown:**
- Manifest metadata: ~1-2 KB
- 94 runners × ~200 bytes/runner = ~18.8 KB
- Competition metadata: ~100 bytes
- **Total: ~20-22 KB per update**

### Is This a Problem?

**Answer: ❌ NO - This is perfectly fine**

**Reasons:**
1. **Network Performance:**
   - 20 KB over WebSocket transmits in <10ms on typical network
   - Even on slow network (1 Mbps), only ~160ms
   - Updates happen every 15-30 seconds (not real-time)

2. **Simplicity:**
   - Templates expect full dataset (easier to implement)
   - No complex diff algorithm needed
   - No template changes required
   - Easier to debug and maintain

3. **Reliability:**
   - Full dataset ensures consistency
   - No risk of partial state corruption
   - Template always has complete data

4. **Industry Standards:**
   - Broadcast graphics typically use full dataset updates
   - CasparCG, vMix, etc. all send full data
   - OGRAF spec doesn't define partial updates

### Partial Updates Analysis (NOT RECOMMENDED):

**What would be required:**
```typescript
// Calculate diff between old and new data
const diff = calculateDiff(oldData, newData);

// Send only changed fields
await this.sendCommand('update', {
  id: graphicId,
  partialData: diff  // Only changed runners
});

// Template must merge partial data
template.updateAction({ partialData: diff });
```

**Challenges:**
- ❌ Complex diff algorithm (deep object comparison)
- ❌ Template changes required (must handle partial data)
- ❌ Risk of state inconsistency
- ❌ Harder to debug ("why is this field missing?")
- ❌ Only saves ~10-15 KB per update (negligible)

**Savings:**
- Best case: Only 1 runner changed → Save ~19 KB
- Worst case: All runners changed → Save 0 KB
- Average case: ~10 runners changed → Save ~17 KB
- **Benefit:** Minimal (saves <200ms on slow network)

### Recommendation: **Keep Sending Full Dataset**

**Rationale:**
- ✅ Simple and reliable
- ✅ Performant enough (20 KB is tiny)
- ✅ Follows industry standards
- ✅ No template changes needed
- ✅ Easier to maintain and debug

---

## Implementation Plan

### Step 1: Add Polling Listener to PlaybackEngine

**File:** `src/main/playback/PlaybackEngine.ts`

**Add import:**
```typescript
import { getDataStore } from '../data/DataStore';
```

**Modify `setWebSocketServer()` method:**
```typescript
setWebSocketServer(wsServer: WebSocketServer) {
  this.wsServer = wsServer;
  logger.info('WebSocket server attached to playback engine');

  // Set callback for graphics responses
  this.wsServer.setResponseCallback((data: any) => {
    this.handleGraphicsResponse(data);
  });

  // NEW: Listen for LiveResults updates
  const dataStore = getDataStore();
  dataStore.on('results:updated', (competitionId, className, ografData) => {
    this.handleLiveResultsUpdate(competitionId, className, ografData);
  });
}
```

**Add new method:**
```typescript
/**
 * Handle LiveResults polling updates
 * Automatically update playing graphics that have autoUpdate enabled
 */
private async handleLiveResultsUpdate(
  competitionId: number,
  className: string,
  ografData: any
): Promise<void> {
  logger.debug('LiveResults update received', { competitionId, className });

  // Find all playing graphics that use this competition/class
  for (const [graphicId, graphic] of this.activeGraphics) {
    if (!graphic.isPlaying) continue;

    // Get rundown item to check autoUpdate flag
    const rundownManager = getRundownManager();
    try {
      const rundown = await rundownManager.loadRundown(graphic.projectId, graphic.rundownId);
      const item = rundown.items.find(i => i.id === graphic.itemId);

      if (!item) continue;

      // Check if this item uses this competition/class and has autoUpdate enabled
      if (item.liveResultsData?.autoUpdate &&
          item.liveResultsData?.competitionId === competitionId &&
          item.liveResultsData?.className === className) {
        
        logger.info('Auto-updating playing graphic', {
          graphicId,
          competitionId,
          className
        });

        try {
          // Send update command with fresh data
          await this.sendCommand('update', {
            id: graphicId,
            data: ografData
          });

          logger.info('Graphic auto-updated successfully', { graphicId });
        } catch (error) {
          logger.error('Failed to auto-update graphic', {
            graphicId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    } catch (error) {
      logger.error('Failed to load rundown for auto-update check', {
        graphicId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}
```

### Step 2: Start/Stop Polling When Graphics Play/Stop

**Modify `playItem()` method (add after line 318):**
```typescript
logger.info('Rundown item playing', { itemId, graphicId, currentStep });

// NEW: Start polling if autoUpdate is enabled
if (item.liveResultsData?.autoUpdate &&
    item.liveResultsData?.competitionId &&
    item.liveResultsData?.className) {
  
  const dataStore = getDataStore();
  const interval = rundown.liveResults?.updateInterval || 15000;
  
  dataStore.startPolling(
    item.liveResultsData.competitionId,
    item.liveResultsData.className,
    interval
  );

  logger.info('Started auto-update polling', {
    graphicId,
    competitionId: item.liveResultsData.competitionId,
    className: item.liveResultsData.className,
    interval
  });
}
```

**Modify `stopItem()` method (add after line 368):**
```typescript
await rundownManager.updateItem(projectId, rundownId, itemId, {
  onair: false,
  currentStep: undefined
});

// NEW: Stop polling when graphic stops
const rundown = await rundownManager.loadRundown(projectId, rundownId);
const item = rundown.items.find(i => i.id === itemId);

if (item?.liveResultsData?.autoUpdate &&
    item.liveResultsData?.competitionId &&
    item.liveResultsData?.className) {
  
  const dataStore = getDataStore();
  
  // Check if any other graphics are using this competition/class
  let otherGraphicsUsingData = false;
  for (const [otherGraphicId, otherGraphic] of this.activeGraphics) {
    if (otherGraphicId === graphicId) continue;
    if (!otherGraphic.isPlaying) continue;

    const otherRundown = await rundownManager.loadRundown(otherGraphic.projectId, otherGraphic.rundownId);
    const otherItem = otherRundown.items.find(i => i.id === otherGraphic.itemId);

    if (otherItem?.liveResultsData?.competitionId === item.liveResultsData.competitionId &&
        otherItem?.liveResultsData?.className === item.liveResultsData.className) {
      otherGraphicsUsingData = true;
      break;
    }
  }

  // Only stop polling if no other graphics are using this data
  if (!otherGraphicsUsingData) {
    dataStore.stopPolling(
      item.liveResultsData.competitionId,
      item.liveResultsData.className
    );

    logger.info('Stopped auto-update polling (no other graphics using data)', { graphicId });
  } else {
    logger.info('Keeping auto-update polling active (other graphics using data)', { graphicId });
  }
}
```

---

## Performance Impact Assessment

### Network Traffic:
- **Polling frequency:** Every 15-30 seconds (configurable)
- **Payload size:** ~20 KB per update (when data changes)
- **Bandwidth:** ~1.3 KB/s average (negligible)
- **Impact:** ✅ Minimal

### CPU Usage:
- **Hash calculation:** ~1-2ms per poll (MD5 of JSON)
- **Hash comparison:** <0.1ms per poll
- **Transformation:** Only when data changes (~10-50ms)
- **Impact:** ✅ Minimal

### Memory Usage:
- **Transformed cache:** ~20 KB per competition/class
- **Polling timers:** ~100 bytes per timer
- **Event listeners:** ~100 bytes per listener
- **Impact:** ✅ Minimal

### WebSocket Traffic:
- **Update commands:** Only when data changes
- **Command size:** ~20 KB (full dataset)
- **Frequency:** Depends on race dynamics (typically 1-5 updates/minute)
- **Impact:** ✅ Minimal

### Overall Assessment:
**✅ EXCELLENT** - The automatic polling system is well-designed and highly efficient. Hash-based change detection prevents unnecessary updates, and the full dataset approach keeps implementation simple and reliable.

---

## Recommendations Summary

### 1. Implement PlaybackEngine Integration (HIGH PRIORITY)
- Add `results:updated` event listener to `setWebSocketServer()`
- Implement `handleLiveResultsUpdate()` method
- Auto-update playing graphics when `autoUpdate === true`
- Send `update` command only (not `update` + `play`)

### 2. Keep Full Dataset Updates (NO CHANGE NEEDED)
- 20 KB payload is negligible for WebSocket
- Simplicity > micro-optimization
- Templates expect full data
- Follows industry standards

### 3. Leverage Existing Hash Detection (NO CHANGE NEEDED)
- Already prevents unnecessary updates
- Works at both API and transform levels
- Excellent design - no changes needed

### 4. Add Polling Lifecycle Management
- Start polling when graphic plays (if autoUpdate enabled)
- Stop polling when graphic stops (with ref counting)
- Handle multiple graphics using same competition/class data
- Prevent duplicate polling timers

### 5. Testing Checklist
- [ ] Single graphic with autoUpdate enabled
- [ ] Multiple graphics using same competition/class
- [ ] Multiple graphics using different competitions
- [ ] Graphic stops while others still playing
- [ ] All graphics stop (polling should stop)
- [ ] Data changes during playback (should update)
- [ ] Data unchanged during playback (should not update)
- [ ] Large dataset (100+ runners)
- [ ] High-frequency polling (5 second interval)
- [ ] Network latency simulation

---

## Related Files

### Core Implementation:
- `src/main/playback/PlaybackEngine.ts` - Main playback engine (needs modification)
- `src/main/data/DataStore.ts` - Polling and caching (already complete)
- `src/main/data/LiveResultsClient.ts` - API client with hashing (already complete)

### Supporting Files:
- `src/renderer/control/components/TemplateSettingsPanel.tsx` - Auto-update UI checkbox
- `src/shared/types/spx.ts` - Type definitions for `liveResultsData.autoUpdate`
- `src/renderer/graphics/ograf-renderer.ts` - Template `updateAction()` handler

---

## Future Enhancements (Optional)

### 1. Update Notification UI
Show visual indicator when graphic is auto-updated:
- Toast notification: "Results updated (M21 - 3 new finishers)"
- Rundown item badge: "🔄 Auto-updating"
- Status bar: "Last update: 5 seconds ago"

### 2. Update History Log
Track update history for debugging:
- Timestamp of each update
- Data hash before/after
- Number of changed runners
- Update success/failure

### 3. Conditional Updates
Only update if specific conditions met:
- Only update if new finishers (not just time changes)
- Only update if top 10 positions changed
- Only update if specific runner's status changed

### 4. Update Throttling
Prevent excessive updates during rapid changes:
- Debounce updates (wait 2s after last change)
- Rate limit (max 1 update per 5 seconds)
- Batch multiple changes into single update

---

## Conclusion

The automatic polling integration is a straightforward enhancement that leverages the existing excellent hash-based change detection system. The implementation is simple, performant, and follows industry best practices. The full dataset approach is appropriate for this use case and should not be changed to partial updates.

**Estimated Implementation Time:** 2-3 hours  
**Testing Time:** 1-2 hours  
**Total Effort:** 3-5 hours

**Risk Level:** Low (well-defined requirements, existing infrastructure)  
**Complexity:** Medium (event handling, lifecycle management)  
**Value:** High (enables automatic live updates for broadcast graphics)

