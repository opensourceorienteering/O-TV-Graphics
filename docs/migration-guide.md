# Data Source Architecture Migration Guide

**Version:** 1.0.0  
**Last Updated:** 2025-10-20

## Overview

OL-Grafik has migrated from a hardcoded LiveResults integration to a pluggable data source architecture. This guide explains the changes and how to migrate existing projects.

## What Changed?

### Before (Old Architecture)

```json
{
  "liveresults": {
    "baseUrl": "https://liveresultat.orientering.se",
    "cacheInterval": 15000,
    "timeout": 10000
  }
}
```

- LiveResults was hardcoded into the application
- Configuration was global only
- No support for other data sources
- Direct coupling between UI and LiveResults API

### After (New Architecture)

```json
{
  "dataSources": [
    {
      "id": "liveresults-default",
      "name": "LiveResults (Default)",
      "type": "liveresults",
      "enabled": true,
      "config": {
        "baseUrl": "https://liveresultat.orientering.se",
        "cacheInterval": 15000,
        "timeout": 10000
      }
    }
  ],
  "liveresults": {
    "baseUrl": "https://liveresultat.orientering.se",
    "cacheInterval": 15000,
    "timeout": 10000
  }
}
```

- Pluggable data source architecture
- Support for multiple data sources
- LiveResults is now one of many possible data sources
- Backward compatibility maintained

## Automatic Migration

**Good news:** Your existing configuration is automatically migrated!

When you first run the updated version of OL-Grafik:

1. The application detects the old `liveresults` configuration
2. Automatically creates a new data source entry with ID `liveresults-default`
3. Preserves your existing `baseUrl`, `cacheInterval`, and `timeout` settings
4. Keeps the old configuration for backward compatibility

**You don't need to do anything!** Your existing projects and rundowns will continue to work.

## Migration Details

### Configuration File Migration

**Old config.json:**
```json
{
  "general": { ... },
  "liveresults": {
    "baseUrl": "https://liveresultat.orientering.se",
    "cacheInterval": 15000,
    "timeout": 10000
  },
  "output": { ... }
}
```

**New config.json (auto-migrated):**
```json
{
  "general": { ... },
  "dataSources": [
    {
      "id": "liveresults-default",
      "name": "LiveResults (Default)",
      "type": "liveresults",
      "enabled": true,
      "config": {
        "baseUrl": "https://liveresultat.orientering.se",
        "cacheInterval": 15000,
        "timeout": 10000
      }
    }
  ],
  "liveresults": {
    "baseUrl": "https://liveresultat.orientering.se",
    "cacheInterval": 15000,
    "timeout": 10000
  },
  "output": { ... }
}
```

### Rundown Migration

**Old rundown structure:**
```json
{
  "id": "rundown-1",
  "name": "My Rundown",
  "liveResults": {
    "competitionId": 12345,
    "competitionName": "My Competition"
  },
  "items": [ ... ]
}
```

**New rundown structure (unchanged):**
```json
{
  "id": "rundown-1",
  "name": "My Rundown",
  "liveResults": {
    "competitionId": 12345,
    "competitionName": "My Competition"
  },
  "items": [ ... ]
}
```

**Note:** Rundown structure remains unchanged. The `liveResults` field is still used, but now it references the `liveresults-default` data source automatically.

### Rundown Item Migration

**Old item structure:**
```json
{
  "id": "item-1",
  "templateId": "individual-results-finish",
  "liveResultsData": {
    "competitionId": 12345,
    "className": "M21",
    "autoUpdate": false,
    "lastUpdate": 1729468800000
  },
  "fields": { ... }
}
```

**New item structure (unchanged):**
```json
{
  "id": "item-1",
  "templateId": "individual-results-finish",
  "liveResultsData": {
    "competitionId": 12345,
    "className": "M21",
    "autoUpdate": false,
    "lastUpdate": 1729468800000
  },
  "fields": { ... }
}
```

**Note:** Item structure remains unchanged. Items automatically use the `liveresults-default` data source.

## Using the New Architecture

### Managing Data Sources

1. **Open Settings** - Navigate to Settings > Data tab
2. **View Data Sources** - See all configured data sources
3. **Add New Source** - Click "Add Data Source" to create a new source
4. **Edit Source** - Click edit icon to modify configuration
5. **Test Connection** - Click test icon to verify connectivity
6. **Enable/Disable** - Toggle sources on/off as needed

### Selecting Data Sources

In **ProjectView > Preferences panel:**

1. Select a rundown
2. If multiple data sources are configured, choose from the dropdown
3. Select a competition from the chosen data source
4. The rundown will use data from the selected source

### Adding Multiple LiveResults Instances

You can now configure multiple LiveResults instances:

```json
{
  "dataSources": [
    {
      "id": "liveresults-norway",
      "name": "LiveResults Norway",
      "type": "liveresults",
      "enabled": true,
      "config": {
        "baseUrl": "https://liveresultat.orientering.no",
        "cacheInterval": 15000,
        "timeout": 10000
      }
    },
    {
      "id": "liveresults-sweden",
      "name": "LiveResults Sweden",
      "type": "liveresults",
      "enabled": true,
      "config": {
        "baseUrl": "https://liveresultat.orientering.se",
        "cacheInterval": 15000,
        "timeout": 10000
      }
    }
  ]
}
```

## Breaking Changes

**None!** The migration is fully backward compatible.

- Old configuration format still works
- Existing rundowns continue to function
- No manual migration required
- No data loss

## Deprecation Notice

The old `liveresults` configuration format is **deprecated** but still supported:

```json
{
  "liveresults": {
    "baseUrl": "...",
    "cacheInterval": 15000,
    "timeout": 10000
  }
}
```

**Recommended:** Use the new `dataSources` format for new configurations:

```json
{
  "dataSources": [
    {
      "id": "liveresults-default",
      "name": "LiveResults",
      "type": "liveresults",
      "enabled": true,
      "config": {
        "baseUrl": "...",
        "cacheInterval": 15000,
        "timeout": 10000
      }
    }
  ]
}
```

## Future Enhancements

The new architecture enables:

1. **Manual Data Entry** - Enter results manually without LiveResults
2. **CSV Import** - Import results from CSV files
3. **Custom APIs** - Connect to custom timing systems
4. **Database Integration** - Direct database connections
5. **Third-Party Plugins** - Community-developed data sources

## Troubleshooting

### Issue: "Data source not found: liveresults-default"

**Solution:** The auto-migration didn't run. Manually add the data source:

1. Open Settings > Data tab
2. Click "Add Data Source"
3. Select "LiveResults" type
4. Set ID to `liveresults-default`
5. Configure baseUrl and other settings
6. Save

### Issue: Competitions not loading

**Solution:** Check data source configuration:

1. Open Settings > Data tab
2. Find your data source
3. Click "Test Connection"
4. Verify baseUrl is correct
5. Check network connectivity

### Issue: Multiple data sources showing

**Solution:** This is expected! You can:

1. Disable unused sources (toggle switch)
2. Delete unused sources (delete icon)
3. Select preferred source in ProjectView

## Support

For issues or questions:

1. Check the [Data Source Plugin API](./data-source-plugin-api.md) documentation
2. Review the [IDataSource interface](../src/shared/types/dataSource.ts)
3. Examine the [LiveResultsDataSource](../src/main/data/sources/LiveResultsDataSource.ts) reference implementation
4. Open an issue on GitHub

## Version History

- **v1.0.0** (2025-10-20) - Initial data source architecture release
  - Pluggable data source support
  - Automatic migration from old format
  - Backward compatibility maintained

