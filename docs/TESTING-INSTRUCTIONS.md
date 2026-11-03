# Testing instructions

For template development and catalogue-wide verification, use the
[template developer guide](TEMPLATE-DEVELOPMENT.md). The repeatable checks are:

```sh
npm run type-check
npm test -- --run
npm run test:templates
npx vite build
```

The Chromium matrix covers all current template packages, real DOM/CSS/fonts/images, paging,
updates, identity/logo variants, empty data and disposal. It writes screenshots and a JSON
report to `os.tmpdir()/split-control-template-tests`; override with `TEMPLATE_TEST_OUTPUT`.
The connected Vitest test covers import, disk storage and HTTP controls with simulated
renderer replies. Neither suite clicks through the full operator UI or tests physical output
hardware. See the developer guide for those boundaries and the manual review checklist.

Development runs on port 5174. If the shell inherits Electron's Node mode, start with
`env -u ELECTRON_RUN_AS_NODE npm run dev`.

## LiveResults time-formatting diagnostic

The remaining sections describe the older, targeted timing/logging diagnostic. Use these
when investigating timing conversion, alongside the current automated tests above.

## Overview

This document provides step-by-step instructions for testing the LiveResults time formatting issue and capturing the necessary logs to identify where the data transformation is failing.

## What Was Fixed

Before testing, the following TypeScript errors were fixed:
1. ✅ Removed duplicate `clearTransformedCache()` method in DataStore
2. ✅ Removed duplicate `controlCode` declaration in DataSourceFieldMapper
3. ✅ Fixed `rundownManager` redeclaration in PlaybackEngine
4. ✅ Fixed TypeScript type error in LiveResultsTransformer for `controlCode` parameter

## What Was Added

Comprehensive logging at 7 critical points in the data flow:
1. **LiveResultsTransformer** - Raw data input and transformed output
2. **DataStore** - Cached transformation results
3. **DataSourceFieldMapper** - Field mapping results
4. **PlaybackEngine (Initial Load)** - Data sent to template on first play
5. **PlaybackEngine (Auto-Update)** - Data sent to template on updates

## Testing Steps

### Step 1: Start the Application

```bash
npm run dev
```

**Wait for:** The application to fully start and the browser to open.

### Step 2: Open Browser DevTools

1. Open the browser's Developer Tools (F12 or Cmd+Option+I)
2. Go to the **Console** tab
3. Clear the console (to make it easier to find relevant logs)

### Step 3: Open Electron DevTools

1. In the Split Control application, open the Developer menu
2. Select "Toggle Developer Tools" or press Cmd+Option+I
3. Go to the **Console** tab
4. Clear the console

**Important:** You need to monitor BOTH consoles:
- **Browser Console** - Shows template (frontend) logs
- **Electron Console** - Shows backend logs (transformer, DataStore, PlaybackEngine)

### Step 4: Play a Template

1. Navigate to a rundown with a LiveResults template (e.g., results-list-paginated)
2. Click the **Play** button
3. Observe the rendered output

### Step 5: Capture Backend Logs

In the **Electron Console**, look for logs with these prefixes:

```
[transformClassResults] Raw runner 1 data
[transformClassResults] Raw runner 2 data
[transformClassResults] Raw runner 3 data

[transformRunner] Processing runner 1: ...
[transformRunner] ... Final output

[transformClassResults] Transformed runner 1
[transformClassResults] Transformed runner 2
[transformClassResults] Transformed runner 3

[DataStore] Transformed result 1
[DataStore] Transformed result 2
[DataStore] Transformed result 3

[DataSourceFieldMapper] Result 1
[DataSourceFieldMapper] Result 2
[DataSourceFieldMapper] Result 3

[PlaybackEngine] Result 1 being sent to template
[PlaybackEngine] Result 2 being sent to template
[PlaybackEngine] Result 3 being sent to template
```

### Step 6: Capture Template Logs

In the **Browser Console**, look for logs from the template:

```
[ResultsListPaginated] Load called
[ResultsListPaginated] Processing result 1: ...
[ResultsListPaginated] Processing result 2: ...
```

### Step 7: Compare Data at Each Stage

For each runner (especially the first 3), compare the data at each logging point:

#### Expected Data Flow:

**Stage 1: Raw API Data (transformClassResults)**
```
result: "155200" (string, centiseconds)
timeplus: "0" (string, centiseconds)
```

**Stage 2: Transformed Data (transformRunner Final output)**
```
time: "25:52" (string, MM:SS format)
diff: "" (empty string for leader)
```

**Stage 3: DataStore Cache**
```
time: "25:52" (string)
timeType: "string"
diff: "" (string)
diffType: "string"
```

**Stage 4: PlaybackEngine → Template**
```
time: "25:52" (string)
timeType: "string"
diff: "" (string)
diffType: "string"
```

**Stage 5: Template Receives**
```
time: "25:52" (should match Stage 4)
diff: "" (should match Stage 4)
```

#### Actual Data (Current Bug):

**Template Receives:**
```
time: "--:--" (WRONG - should be "25:52")
diff: "+0" or "+1900" (WRONG - should be "" or "+0:19")
```

## What to Look For

### Scenario 1: Transformer Not Being Called

**Symptoms:**
- No logs with `[transformClassResults]` prefix
- No logs with `[transformRunner]` prefix

**Diagnosis:**
- The new datasource system is not being used
- Data is coming from a different code path

**Action:**
- Share the full Electron console log
- Note that NO transformer logs appear

### Scenario 2: Transformer Called But Returns Wrong Data

**Symptoms:**
- Logs show `[transformClassResults]` and `[transformRunner]`
- But transformed data shows `time: "--:--"` or `diff: "1900"`

**Diagnosis:**
- Bug in the transformer logic
- Parsing of centiseconds is failing

**Action:**
- Share the transformer logs showing the wrong output
- Note the exact values in the "Final output" log

### Scenario 3: Transformer Correct, DataStore Wrong

**Symptoms:**
- `[transformRunner] Final output` shows correct data: `time: "25:52"`
- `[DataStore] Transformed result` shows wrong data: `time: "--:--"`

**Diagnosis:**
- Bug in DataStore caching or data handling

**Action:**
- Share both transformer and DataStore logs
- Note where the data changes

### Scenario 4: DataStore Correct, PlaybackEngine Wrong

**Symptoms:**
- `[DataStore] Transformed result` shows correct data
- `[PlaybackEngine] Result X being sent to template` shows wrong data

**Diagnosis:**
- Bug in PlaybackEngine data handling or field mapping

**Action:**
- Share DataStore and PlaybackEngine logs
- Note where the data changes

### Scenario 5: PlaybackEngine Correct, Template Wrong

**Symptoms:**
- `[PlaybackEngine] Result X being sent to template` shows correct data
- Template logs show wrong data

**Diagnosis:**
- Bug in template's data processing
- Template is modifying the data incorrectly

**Action:**
- Share PlaybackEngine and template logs
- Check template's `load()` and `formatTime()` methods

## Expected vs. Actual Comparison

### Runner 1 (Leader - Wilma Jonsson)

| Stage | Field | Expected | Actual (Bug) |
|-------|-------|----------|--------------|
| Raw API | result | "155200" | ? |
| Raw API | timeplus | "0" | ? |
| Transformed | time | "25:52" | ? |
| Transformed | diff | "" | ? |
| Template | time | "25:52" | "--:--" |
| Template | diff | "" | "+0" |

### Runner 2 (Felicia Persson)

| Stage | Field | Expected | Actual (Bug) |
|-------|-------|----------|--------------|
| Raw API | result | "157100" | ? |
| Raw API | timeplus | "1900" | ? |
| Transformed | time | "26:11" | ? |
| Transformed | diff | "+0:19" | ? |
| Template | time | "26:11" | "--:--" |
| Template | diff | "+0:19" | "+1900" |

### Runner 3 (Hannah Josefsson)

| Stage | Field | Expected | Actual (Bug) |
|-------|-------|----------|--------------|
| Raw API | result | "162200" | ? |
| Raw API | timeplus | "7200" | ? |
| Transformed | time | "27:04" | ? |
| Transformed | diff | "+1:12" | ? |
| Template | time | "27:04" | "--:--" |
| Template | diff | "+1:12" | "+7200" |

## What to Share

After testing, please share:

1. **Full Electron Console Log** (from when you clicked Play)
   - Copy all logs from the Electron DevTools console
   - Include everything from the moment you clicked Play

2. **Full Browser Console Log** (template logs)
   - Copy all logs from the browser DevTools console
   - Include template logs showing what data it received

3. **Screenshot of Rendered Output**
   - Show what the template is displaying
   - This confirms the visual bug

4. **Fill in the "Actual (Bug)" column** in the tables above
   - Based on the logs you captured
   - This helps identify exactly where the data becomes incorrect

## Quick Checklist

- [ ] Application started successfully
- [ ] Both DevTools consoles open (Electron + Browser)
- [ ] Consoles cleared before testing
- [ ] Template played
- [ ] Backend logs captured (Electron console)
- [ ] Template logs captured (Browser console)
- [ ] Logs compared with expected values
- [ ] Identified where data becomes incorrect
- [ ] Ready to share logs and findings


