/**
 * Data Source Field Mapper
 * Applies field mappings from datasource configuration to transform API data into template fields
 */

import { getLogger } from '../utils/logger';
import { TemplateDataSourceConfig } from '../../shared/types/template-datasource';
import { LiveResultsClient } from './LiveResultsClient';
import { getDataStore } from './DataStore';
import { getDataSourceRegistry } from './DataSourceRegistry';
import { competitionClock, startTimeEpochMs } from './liveTime';
import { getClubLogoService } from './ClubLogoService';

const logger = getLogger();

/**
 * Apply field mappings to transform API data into template fields
 */
export class DataSourceFieldMapper {
  /**
   * Fetch and map data based on datasource configuration and UI control values
   */
  static async fetchAndMapData(
    dataSourceConfig: TemplateDataSourceConfig,
    competitionId: number,
    dataSourceValues: Record<string, any>,
    rundownSettings?: {
      competitionNameOverride?: string;
      raceLocation?: string;
    },
    dataSourceId?: string
  ): Promise<Record<string, any>> {
    logger.debug('Fetching and mapping data', {
      mode: dataSourceConfig.mode,
      provider: dataSourceConfig.api?.provider,
      competitionId,
      dataSourceValues,
      dataSourceId
    });

    // Values a graphic always needs, whatever the operator picked (e.g. start lists read the
    // start times: controlCode "Start")
    const fixedValues = (dataSourceConfig.api as any)?.fixedValues;
    if (fixedValues && typeof fixedValues === 'object') {
      dataSourceValues = { ...dataSourceValues, ...fixedValues };
    }

    // Only fetch API data if mode is 'api' or 'hybrid'
    if (dataSourceConfig.mode === 'manual') {
      logger.debug('Manual mode - no API data to fetch');
      return {};
    }

    if (!dataSourceConfig.api) {
      logger.warn('API mode but no API config found');
      return {};
    }

    // Fetch data based on provider
    if (dataSourceConfig.api.provider === 'liveresults') {
      return await this.fetchLiveResultsData(
        dataSourceConfig,
        competitionId,
        dataSourceValues,
        rundownSettings,
        dataSourceId
      );
    }

    logger.warn('Unknown API provider', { provider: dataSourceConfig.api.provider });
    return {};
  }

  /**
   * Fetch data from LiveResults API and apply field mappings
   */
  private static async fetchLiveResultsData(
    dataSourceConfig: TemplateDataSourceConfig,
    competitionId: number,
    dataSourceValues: Record<string, any>,
    rundownSettings?: {
      competitionNameOverride?: string;
      raceLocation?: string;
    },
    dataSourceId?: string
  ): Promise<Record<string, any>> {
    const totalStartTime = Date.now();
    try {
      // Require explicit data source ID - no fallback
      if (!dataSourceId) {
        logger.error('No data source ID specified in rundown', {
          competitionId,
          dataSourceValues
        });
        throw new Error('No data source ID specified. Rundown must have a data source configured.');
      }

      logger.info('Fetching data from data source', {
        dataSourceId,
        competitionId,
        dataSourceValues
      });

      // Get the specified data source
      const registry = getDataSourceRegistry();
      const dataSource = registry.get(dataSourceId);

      if (!dataSource) {
        const availableSources = registry.getAll().map(ds => ds.config.id);
        logger.error('Data source not found in registry', {
          dataSourceId,
          availableSources
        });

        const availableList = availableSources.length > 0
          ? ` Available sources: ${availableSources.join(', ')}`
          : ' No data sources configured.';
        throw new Error(`Data source '${dataSourceId}' not found.${availableList} Please configure data source in Project View.`);
      }

      logger.info('Using data source', {
        dataSourceId: dataSource.config.id,
        dataSourceName: dataSource.config.name,
        dataSourceType: dataSource.config.type
      });

      // Any source that exposes a LiveResults-compatible client works: Liveresultat (REST/legacy)
      // or a MeOS MOP database (MySQLDataSource + MopBackend).
      const client: LiveResultsClient | undefined =
        typeof (dataSource as any).getClient === 'function' ? (dataSource as any).getClient() : undefined;
      if (!client) {
        throw new Error(`Data source '${dataSourceId}' cannot feed templates (type: ${dataSource.config.type})`);
      }
      logger.debug('Using LiveResults client from data source', {
        dataSourceId,
        baseUrl: dataSource.config.config.baseUrl
      });

      // Get className from dataSourceValues (set by class-selector UI control)
      const className = dataSourceValues.className;
      if (!className) {
        logger.warn('No className in dataSourceValues - cannot fetch LiveResults data');
        return {};
      }

      logger.debug('Fetching LiveResults class results', { competitionId, className });

      // Get competition info for context (date + timezone are needed for live clocks).
      // getCompetitionInfo is one small cached request; the full competition list is a fallback.
      const competitionsStartTime = Date.now();
      let competition: { name?: string; date?: string; timediff?: number; timezone?: string } | undefined;
      try {
        competition = await client.getCompetitionInfo(competitionId);
      } catch (error) {
        logger.warn('getCompetitionInfo failed, falling back to competition list', {
          competitionId,
          error: error instanceof Error ? error.message : String(error)
        });
        const competitionsResponse = await client.getCompetitions();
        competition = competitionsResponse.data.find(c => c.id === competitionId);
      }
      const clockOffsetMs = await client.getServerClockOffsetMs();
      logger.debug('Fetched competition info', { durationMs: Date.now() - competitionsStartTime });

      // Get raw class results for splitcontrols data
      const classResultsStartTime = Date.now();
      // A poll that just detected a change fetched this class moments ago: reuse it
      const rawClassResults = await client.getClassResults(competitionId, className, { maxAgeMs: 2000 });
      logger.debug('Fetched class results', { durationMs: Date.now() - classResultsStartTime });

      // Get controlCode from dataSourceValues if specified
      const controlCode = dataSourceValues.controlCode;

      // Use cached transformation from DataStore
      // IMPORTANT: Pass the data source's client to ensure we fetch from the correct API
      const transformStartTime = Date.now();
      const dataStore = getDataStore();
      const cachedOgrafData = await dataStore.getTransformedClassResults(
        competitionId,
        className,
        {
          competitionName: competition?.name,
          controlCode, // Pass control code for split time filtering
          client, // Pass the data source's LiveResultsClient instance
          maxAgeMs: 2000
        }
      );
      logger.debug('Transformed class results', { durationMs: Date.now() - transformStartTime });

      // The DataStore caches this object, so never mutate it: work on copies.
      const clock = competition ? competitionClock(competition) : null;
      const rawByRunner = new Map<string, any>();
      for (const raw of rawClassResults.data.results ?? []) rawByRunner.set(`${raw.name}|${raw.club}`, raw);
      // Radio controls of the class, and every runner's times at them, for split graphics
      const splitControls = (rawClassResults.data.splitcontrols ?? []).map((c: any) =>
        typeof c === 'object' ? { code: Number(c.code), name: String(c.name ?? '') } : { code: Number(c), name: '' });
      const logos = getClubLogoService();
      const ografData = {
        ...cachedOgrafData,
        competitionName: rundownSettings?.competitionNameOverride || cachedOgrafData.competitionName,
        results: (cachedOgrafData.results ?? []).map(runner => {
          const raw = rawByRunner.get(`${runner.name}|${runner.club}`);
          const startCs = raw?.start ? Number(raw.start) : undefined;
          const startTimeMs = clock && startCs ? startTimeEpochMs(clock, startCs) : undefined;
          const extra: Record<string, any> = {};
          if (startTimeMs) extra.startTimeMs = startTimeMs;
          if (raw?.country) extra.country = raw.country;
          const logo = logos?.lookup(runner.club);
          if (logo) extra.clubLogo = logo;
          if (raw?.splits && splitControls.length) {
            extra.splitTimes = splitControls
              .map((c: { code: number }) => ({
                code: c.code,
                time: Number(raw.splits[String(c.code)]) || 0,
                place: Number(raw.splits[`${c.code}_place`]) || 0,
                timeplus: Number(raw.splits[`${c.code}_timeplus`]) || 0,
                status: Number(raw.splits[`${c.code}_status`] ?? 0)
              }))
              .filter((t: { time: number }) => t.time > 0);
          }
          return { ...runner, ...extra };
        })
      };

      // Now apply field mappings from datasource config
      const mappedFields: Record<string, any> = {};

      if (dataSourceConfig.api?.fieldMappings) {
        for (const mapping of dataSourceConfig.api.fieldMappings) {
          const value = this.extractFieldValue(ografData, mapping.apiPath);
          
          if (value !== undefined) {
            // Apply transformation if specified
            const transformedValue = mapping.transform 
              ? this.applyTransform(value, mapping.transform)
              : value;
            
            mappedFields[mapping.templateField] = transformedValue;
          } else if (mapping.required) {
            logger.warn('Required field mapping failed', {
              templateField: mapping.templateField,
              apiPath: mapping.apiPath
            });
          }
        }
      }

      // Add additional context fields
      const mappingStartTime = Date.now();
      mappedFields.className = className;
      if (competition?.name) {
        mappedFields.competitionName = rundownSettings?.competitionNameOverride || competition.name;
      }
      if (competition?.date) {
        mappedFields.competitionDate = competition.date;
      }
      if (rundownSettings?.raceLocation) {
        mappedFields.raceLocation = rundownSettings.raceLocation;
      }

      // Live clock context for templates that show running times:
      //   now (server time) = Date.now() + clockOffsetMs
      //   running time      = now - result.startTimeMs
      mappedFields.clockOffsetMs = clockOffsetMs;
      if (clock) {
        mappedFields.competitionTimeZone = clock.timeZone;
        mappedFields.competitionTimediff = clock.timediffHours;
      }
      mappedFields.dataTimestamp = Date.now();
      mappedFields.splitControls = splitControls;
      logger.debug('Applied field mappings', { durationMs: Date.now() - mappingStartTime });

      // Handle control point selection
      // controlCode already declared above on line 93
      if (controlCode) {
        mappedFields.controlCode = controlCode;

        // Determine control name
        if (controlCode === 'F' || controlCode === 'finish' || controlCode === 'Finish') {
          mappedFields.controlName = 'Finish';
        } else if (controlCode === 'Start' || controlCode === 'S') {
          mappedFields.controlName = 'Start';
        } else {
          // Check if control is in splitcontrols array (from raw data)
          // splitcontrols is now an array of objects with { code: number, name: string }
          const splitControls = rawClassResults.data.splitcontrols || [];
          const controlObj = splitControls.find((ctrl: any) => {
            // Handle both numeric and string control codes
            const ctrlCode = typeof ctrl === 'object' ? ctrl.code : ctrl;
            return String(ctrlCode) === String(controlCode);
          });

          if (controlObj) {
            // Use the name from the API if available
            const controlName = typeof controlObj === 'object' ? controlObj.name : `Control ${controlCode}`;
            mappedFields.controlName = controlName;
          } else {
            mappedFields.controlName = `Control ${controlCode}`;
          }
        }
      } else {
        // Default to Finish if no control selected
        mappedFields.controlCode = '';
        mappedFields.controlName = 'Finish';
      }

      // For list-based templates, include the full results array
      if (ografData.results && ografData.results.length > 0) {
        mappedFields.results = ografData.results;

        // Log first 3 results to verify data integrity
        logger.info('=== DataSourceFieldMapper: Results array ===', {
          resultsCount: ografData.results.length
        });
        for (let i = 0; i < Math.min(3, ografData.results.length); i++) {
          logger.info(`[DataSourceFieldMapper] Result ${i + 1}`, {
            position: ografData.results[i].position,
            name: ografData.results[i].name,
            time: ografData.results[i].time,
            diff: ografData.results[i].diff,
            statusCode: ografData.results[i].statusCode
          });
        }
      }

      // Merge dataSourceValues into mappedFields
      // This includes values from UI controls like runner-search, which populate fields
      // like runnerName, runnerBib, runnerClub, etc.
      //
      // NEW: Respect field configuration for overrides
      // - If a field has allowOverride=true and operator provided a value, use operator value
      // - If a field is not in mappedFields (not from API), use dataSourceValues
      // - Otherwise, API data takes precedence
      for (const [key, value] of Object.entries(dataSourceValues)) {
        // Skip if no value provided
        if (value === undefined || value === '') {
          continue;
        }

        // Check if this field has a mapping configuration
        const fieldMapping = dataSourceConfig.api?.fieldMappings?.find(
          m => m.templateField === key
        );

        // If field allows override and operator provided a value, use it
        if (fieldMapping?.allowOverride && value !== undefined && value !== '') {
          mappedFields[key] = value;
          logger.debug('Field override applied', {
            field: key,
            apiValue: mappedFields[key],
            overrideValue: value
          });
        }
        // If field is not in mappedFields (not from API), use dataSourceValues
        else if (mappedFields[key] === undefined) {
          mappedFields[key] = value;
        }
        // Otherwise, API data takes precedence (no override)
      }

      logger.debug('Field mapping complete', {
        mappedFieldCount: Object.keys(mappedFields).length,
        fields: Object.keys(mappedFields),
        controlCode: mappedFields.controlCode,
        controlName: mappedFields.controlName,
        resultsCount: mappedFields.results?.length || 0,
        firstResult: mappedFields.results?.[0],
        runnerName: mappedFields.runnerName,
        runnerBib: mappedFields.runnerBib
      });

      const totalDuration = Date.now() - totalStartTime;
      logger.info('DataSourceFieldMapper: Final mapped data', {
        className: mappedFields.className,
        controlCode: mappedFields.controlCode,
        controlName: mappedFields.controlName,
        resultsCount: mappedFields.results?.length || 0,
        hasResults: !!mappedFields.results,
        runnerName: mappedFields.runnerName,
        runnerBib: mappedFields.runnerBib,
        totalDurationMs: totalDuration
      });

      return mappedFields;

    } catch (error) {
      const totalDuration = Date.now() - totalStartTime;
      logger.error('Failed to fetch LiveResults data', {
        error: error instanceof Error ? error.message : String(error),
        competitionId,
        dataSourceValues,
        totalDurationMs: totalDuration
      });
      // Rethrow: callers must decide. Returning {} here used to blank graphics on air
      // whenever a single poll failed (network blip, 5xx).
      throw error;
    }
  }

  /**
   * Extract value from nested object using dot notation path
   * Examples:
   *   - "results" → data.results
   *   - "results[0].name" → data.results[0].name
   *   - "runner.name" → data.runner.name
   */
  private static extractFieldValue(data: any, path: string): any {
    const parts = path.split('.');
    let current = data;

    for (const part of parts) {
      if (current === undefined || current === null) {
        return undefined;
      }

      // Handle array indexing (e.g., "results[0]")
      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, arrayName, index] = arrayMatch;
        current = current[arrayName]?.[parseInt(index, 10)];
      } else {
        current = current[part];
      }
    }

    return current;
  }

  /**
   * Apply transformation to a value
   */
  private static applyTransform(
    value: any,
    transform: 'formatTime' | 'formatDate' | 'uppercase' | 'lowercase' | 'trim'
  ): any {
    if (value === undefined || value === null) {
      return value;
    }

    switch (transform) {
      case 'uppercase':
        return String(value).toUpperCase();
      
      case 'lowercase':
        return String(value).toLowerCase();
      
      case 'trim':
        return String(value).trim();
      
      case 'formatTime':
        // Assume value is in seconds, format as MM:SS
        if (typeof value === 'number') {
          const minutes = Math.floor(value / 60);
          const seconds = Math.floor(value % 60);
          return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
        return value;
      
      case 'formatDate':
        // Format date string
        if (typeof value === 'string' || value instanceof Date) {
          const date = new Date(value);
          return date.toLocaleDateString();
        }
        return value;
      
      default:
        logger.warn('Unknown transform type', { transform });
        return value;
    }
  }
}

