# Template Data Source Configuration System

## Overview

The Template Data Source Configuration System allows OGRAF templates to declare their data requirements and UI controls separately from the OGRAF manifest. This enables:

1. **Declarative data fetching** - Templates specify which fields should be auto-populated from APIs
2. **Dynamic UI generation** - UI controls are automatically rendered based on configuration
3. **Separation of concerns** - Data source logic is separate from template graphics code
4. **Backward compatibility** - Templates without datasource files continue to work with manual input

## File Structure

### Sidecar File Naming Convention

Each template can have an optional datasource configuration file:

```
templates/
  └── individual-results-control/
      ├── individual-results-control.ograf.json    # OGRAF manifest (required)
      ├── individual-results-control.datasource.json  # Datasource config (optional)
      └── graphic.js                                # Template code (required)
```

**Naming pattern:** `{template-id}.datasource.json`

### Schema Version

Current schema version: `1.0`

## Configuration Modes

Templates can operate in three modes:

### 1. Manual Mode
All fields are manually entered by operators. No API integration.

```json
{
  "version": "1.0",
  "mode": "manual",
  "manual": {
    "fields": ["namn", "titel"],
    "hiddenFields": []
  }
}
```

### 2. API Mode
All data is fetched from an external API. No manual input required.

**Auto-update is the STANDARD for all API templates** - it defaults to enabled and can be disabled per rundown item in the Template Settings Panel. Polling interval is standardized at 15 seconds.

```json
{
  "version": "1.0",
  "mode": "api",
  "api": {
    "provider": "liveresults",
    "fieldMappings": [...],
    "uiControls": [...]
  }
}
```

> **Note:** The `autoUpdate` configuration field is deprecated and no longer used. Auto-update is now enabled by default for all API templates.

### 3. Hybrid Mode
Combination of API data and manual input. Most common for flexible workflows.

```json
{
  "version": "1.0",
  "mode": "hybrid",
  "api": {...},
  "manual": {...}
}
```

## UI Control Types

### Class Selector

Dropdown for selecting orienteering classes.

```json
{
  "type": "class-selector",
  "label": "Class",
  "helpText": "Select the class to display results for",
  "required": true,
  "storeAs": "className",
  "compact": true
}
```

### Runner Search

Autocomplete search for individual runners.

```json
{
  "type": "runner-search",
  "label": "Runner",
  "helpText": "Search for a runner by name or bib number",
  "required": true,
  "storeAs": "runnerId",
  "searchBy": "both",
  "placeholder": "Search by name or bib number...",
  "populateFields": {
    "runnerName": "name",
    "club": "club",
    "bibNumber": "bib",
    "className": "className"
  }
}
```

**populateFields**: When a runner is selected, automatically populate template fields with runner data.

### Control Point Selector

Dropdown for selecting control points/checkpoints.

```json
{
  "type": "control-point-selector",
  "label": "Control Point",
  "helpText": "Select which control point to show results for",
  "required": true,
  "storeAs": "controlCode",
  "multiple": false,
  "includeFinish": false
}
```

### Leg Selector

Dropdown for selecting relay race legs.

```json
{
  "type": "leg-selector",
  "label": "Leg",
  "helpText": "Select which leg to display",
  "required": true,
  "storeAs": "legNumber",
  "maxLegs": 6
}
```

### Team Search

Autocomplete search for relay teams (similar to runner search).

```json
{
  "type": "team-search",
  "label": "Team",
  "helpText": "Search for a team by name or club",
  "required": true,
  "storeAs": "teamId",
  "searchBy": "both",
  "placeholder": "Search by team name or club...",
  "populateFields": {
    "teamName": "teamName",
    "club": "club",
    "className": "className"
  }
}
```

## Complete Examples

### Example 1: Individual Results at Control Point

**File:** `templates/individual-results-control/individual-results-control.datasource.json`

```json
{
  "version": "1.0",
  "mode": "hybrid",
  "api": {
    "provider": "liveresults",
    "fieldMappings": [
      {
        "templateField": "className",
        "apiPath": "className",
        "required": true
      },
      {
        "templateField": "competitionName",
        "apiPath": "competition.name",
        "required": true
      },
      {
        "templateField": "results",
        "apiPath": "controlResults",
        "required": true
      }
    ],
    "uiControls": [
      {
        "type": "class-selector",
        "label": "Class",
        "helpText": "Select the class to display results for",
        "required": true,
        "storeAs": "className",
        "compact": true
      },
      {
        "type": "control-point-selector",
        "label": "Control Point",
        "helpText": "Select which control point to show results for",
        "required": true,
        "storeAs": "controlCode",
        "multiple": false,
        "includeFinish": false
      }
    ]
  },
  "manual": {
    "fields": ["maxRows"],
    "hiddenFields": ["results", "competitionName"]
  }
}
```

**Behavior:**
- Shows class selector and control point selector in Template Settings Panel
- Auto-fetches results from LiveResults API when class and control point are selected
- Allows manual editing of `maxRows` field
- Hides `results` and `competitionName` from manual editing (populated by API)
- Auto-updates every 15 seconds when enabled (standard polling interval)

### Example 2: Runner Lower Third

**File:** `templates/individual-runner-lower-third/individual-runner-lower-third.datasource.json`

```json
{
  "version": "1.0",
  "mode": "hybrid",
  "api": {
    "provider": "liveresults",
    "fieldMappings": [
      {
        "templateField": "runnerName",
        "apiPath": "runner.name",
        "required": true
      },
      {
        "templateField": "club",
        "apiPath": "runner.club",
        "required": false
      },
      {
        "templateField": "bibNumber",
        "apiPath": "runner.bib",
        "required": false
      },
      {
        "templateField": "className",
        "apiPath": "runner.className",
        "required": false
      }
    ],
    "uiControls": [
      {
        "type": "runner-search",
        "label": "Runner",
        "helpText": "Search for a runner by name or bib number",
        "required": true,
        "storeAs": "runnerId",
        "searchBy": "both",
        "placeholder": "Search by name or bib number...",
        "populateFields": {
          "runnerName": "name",
          "club": "club",
          "bibNumber": "bib",
          "className": "className"
        }
      }
    ],
    "autoUpdate": {
      "defaultEnabled": false
    }
  },
  "manual": {
    "fields": ["runnerName", "club", "bibNumber", "className"],
    "hiddenFields": []
  }
}
```

**Behavior:**
- Shows runner search box in Template Settings Panel
- When runner is selected, automatically populates all fields
- Fields can still be manually edited after auto-population
- Auto-update is enabled by default (standard for all API templates) but can be disabled per rundown item if needed

## Implementation Details

### Loading Process

1. **Template Discovery** - `OGrafManager.discoverTemplates()` scans template directories
2. **Manifest Loading** - Each template's `.ograf.json` file is loaded and validated
3. **Datasource Loading** - `OGrafManager.loadDataSourceConfig()` attempts to load `{template-id}.datasource.json`
4. **Cache Storage** - Template info with datasource config is cached in `OGrafTemplateInfo.dataSourceConfig`

### UI Rendering

1. **Template Selection** - User selects a rundown item in ProductionView
2. **Settings Panel** - TemplateSettingsPanel receives template with datasource config
3. **Dynamic Rendering** - `DataSourceUIRenderer` renders UI controls based on `uiControls` array
4. **Value Storage** - Control values are stored in `item.liveResultsData.dataSourceValues`

### Data Flow

```
User selects control value
  ↓
DataSourceUIRenderer.onChange()
  ↓
TemplateSettingsPanel.setDataSourceValues()
  ↓
User clicks Save
  ↓
onSave() with dataSourceValues
  ↓
Stored in rundown item
```

## Backward Compatibility

Templates without datasource files continue to work:

- `template.dataSourceConfig` will be `null`
- TemplateSettingsPanel falls back to legacy class selector
- All existing templates remain functional

## Future Enhancements

1. **Custom transformations** - Add more field transformation functions
2. **Conditional controls** - Show/hide controls based on other values
3. **Validation rules** - Add field validation in datasource config
4. **Multiple API providers** - Support for APIs beyond LiveResults
5. **Data caching** - Cache API responses to reduce network calls

