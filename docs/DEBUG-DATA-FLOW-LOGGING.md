# Data Flow Debugging - Logging Points

This document describes the comprehensive logging added to trace the LiveResults data flow from API to template.

## Purpose

To identify where in the data pipeline the time formatting is failing or being bypassed, causing:
- Leader time displaying as `"--:--"` instead of `"25:52"`
- Runner times showing raw centisecond values like `"+1900"` instead of formatted times like `"+0:19"`

## Logging Points Added

### 1. LiveResultsTransformer.transformClassResults()
**Location:** `src/main/data/LiveResultsTransformer.ts` (lines 285-307, 364-384)

**What it logs:**
- Raw runner data (first 3 runners):
  - `name`, `place`, `result`, `resultType`, `timeplus`, `timeplusType`, `status`
- Transformed runner data (first 3 runners):
  - `position`, `name`, `time`, `diff`, `statusCode`

**Log prefix:** `[transformClassResults]`

**What to look for:**
- ✅ Raw `result` should be a string like `"155200"` (centiseconds)
- ✅ Raw `timeplus` should be a string like `"1900"` (centiseconds)
- ✅ Transformed `time` should be formatted like `"25:52"` (MM:SS)
- ✅ Transformed `diff` should be formatted like `"+0:19"` (MM:SS with + prefix)
- ❌ If transformed `time` is `"--:--"`, the transformer failed to parse the time
- ❌ If transformed `diff` is `"1900"` or `"+1900"`, the transformer failed to format the diff

### 2. LiveResultsTransformer.transformRunner()
**Location:** `src/main/data/LiveResultsTransformer.ts` (lines 165-259)

**What it logs:**
- Input data for each runner
- Conversion steps (centiseconds → seconds)
- Time difference calculations
- Final output

**Log prefix:** `[transformRunner]`

**What to look for:**
- ✅ Should show conversion from centiseconds to seconds (divide by 100)
- ✅ Should show formatted time and diff in final output
- ❌ If `timeSeconds` is 0, the parsing failed

### 3. DataStore.getTransformedClassResults()
**Location:** `src/main/data/DataStore.ts` (lines 258-293)

**What it logs:**
- Transformation completion
- First 3 transformed results with:
  - `position`, `name`, `time`, `timeType`, `diff`, `diffType`, `statusCode`

**Log prefix:** `[DataStore]`

**What to look for:**
- ✅ `time` should be a string like `"25:52"`
- ✅ `timeType` should be `"string"`
- ✅ `diff` should be a string like `"+0:19"` or `""` (empty for leader)
- ✅ `diffType` should be `"string"`
- ❌ If `time` is `"--:--"`, the transformer returned incorrect data
- ❌ If `diff` is a raw number or unformatted string, the transformer failed

### 4. DataSourceFieldMapper.fetchLiveResultsData()
**Location:** `src/main/data/DataSourceFieldMapper.ts` (lines 180-209)

**What it logs:**
- Results array from OGRAF data
- First 3 results with:
  - `position`, `name`, `time`, `diff`, `statusCode`
- Final mapped data summary

**Log prefix:** `[DataSourceFieldMapper]`

**What to look for:**
- ✅ Results should have formatted `time` and `diff` values
- ❌ If results have raw centisecond values, the transformation was bypassed

### 5. PlaybackEngine.playItem() - Initial Load
**Location:** `src/main/playback/PlaybackEngine.ts` (lines 479-513)

**What it logs:**
- Data being sent to template during initial load
- First 3 results with:
  - `position`, `name`, `time`, `timeType`, `diff`, `diffType`, `statusCode`

**Log prefix:** `[PlaybackEngine]`

**What to look for:**
- ✅ This is the FINAL data sent to the template
- ✅ `time` and `diff` should be formatted strings
- ❌ If incorrect here, the template will display incorrect data

### 6. PlaybackEngine.handleLiveResultsUpdate() - Auto-Updates
**Location:** `src/main/playback/PlaybackEngine.ts` (lines 206-238)

**What it logs:**
- Data being sent to template during auto-updates
- First 3 results with:
  - `position`, `name`, `time`, `timeType`, `diff`, `diffType`, `statusCode`

**Log prefix:** `[PlaybackEngine Auto-Update]`

**What to look for:**
- ✅ Same as initial load - data should be formatted
- ❌ If different from initial load, there's a code path difference

## Expected Log Sequence

When playing a template with LiveResults data, you should see logs in this order:

```
1. [transformClassResults] Raw runner 1 data
   → result: "155200", timeplus: "0"
   
2. [transformRunner] Processing runner 1: Wilma Jonsson
   → Converted string centiseconds: 155200 → 1552 seconds
   
3. [transformRunner] Wilma Jonsson: Final output
   → time: "25:52", diff: "", statusCode: 0
   
4. [transformClassResults] Transformed runner 1
   → position: "1", name: "Wilma Jonsson", time: "25:52", diff: ""
   
5. [DataStore] Transformed result 1
   → position: "1", name: "Wilma Jonsson", time: "25:52", timeType: "string", diff: "", diffType: "string"
   
6. [DataSourceFieldMapper] Result 1
   → position: "1", name: "Wilma Jonsson", time: "25:52", diff: ""
   
7. [PlaybackEngine] Result 1 being sent to template
   → position: "1", name: "Wilma Jonsson", time: "25:52", timeType: "string", diff: "", diffType: "string"
```

## Debugging Steps

1. **Restart the application** to load the new logging code
2. **Play a template** with LiveResults data
3. **Check the console logs** for the sequence above
4. **Identify where the data becomes incorrect:**
   - If incorrect at step 3-4: Bug in `transformRunner()`
   - If incorrect at step 5: Bug in `DataStore` caching or transformation
   - If incorrect at step 6: Bug in `DataSourceFieldMapper`
   - If incorrect at step 7: Bug in `PlaybackEngine` data handling
   - If correct at step 7 but wrong in template: Bug in template code

## Common Issues to Look For

### Issue 1: Time shows as "--:--"
**Cause:** `timeSeconds` is 0 because parsing failed
**Look for:** Logs showing `timeSeconds: 0` in `transformRunner`
**Fix:** Check if `result` field is in expected format (string centiseconds)

### Issue 2: Diff shows raw centiseconds (e.g., "+1900")
**Cause:** `formatTimeDiff` not being called or receiving wrong input
**Look for:** Logs showing `diff: "1900"` instead of `diff: "+0:19"`
**Fix:** Check if `timeplus` is being divided by 100 before formatting

### Issue 3: Data correct in logs but wrong in template
**Cause:** Template is modifying the data incorrectly
**Look for:** Correct data in PlaybackEngine logs but wrong in rendered HTML
**Fix:** Check template's `formatTime()` and `formatTimeDisplay()` methods

### Issue 4: Cached data is stale
**Cause:** DataStore returning old cached data
**Look for:** Log showing "Returning cached transformed data"
**Fix:** Clear cache or check cache invalidation logic

## Next Steps After Debugging

Once you identify where the data becomes incorrect:

1. **Share the relevant log section** showing the incorrect data
2. **Note the exact log prefix** (e.g., `[transformRunner]`, `[DataStore]`)
3. **Compare with expected values** from this document
4. **I'll provide a targeted fix** for that specific component


