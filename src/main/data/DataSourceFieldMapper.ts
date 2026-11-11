import { timingClasses, mapTimingClasses } from './timingScope';
/**
 * Data Source Field Mapper
 * Applies field mappings from datasource configuration to transform API data into template fields
 */

import { getLogger } from '../utils/logger';
import { TemplateDataSourceConfig } from '../../shared/types/template-datasource';
import type { TimingHub } from './timing/TimingHub';
import type { ClassResults, CompetitionInfo, ResultRow } from './timing/model';
import { wallClockCs } from './timing/model';
import { getDataStore } from './DataStore';
import { getDataSourceRegistry } from './DataSourceRegistry';
import { competitionClock, CompetitionClock, startTimeEpochMs } from './liveTime';
import { getClubLogoService } from './ClubLogoService';

const logger = getLogger();

/**
 * Apply field mappings to transform API data into template fields
 */
/**
 * Template sidecars name the timing data 'timing' (any timing source, built in or plugin);
 * 'liveresults' is the original name and stays accepted.
 */
export function isTimingProvider(provider: string | undefined): boolean {
  return provider === 'timing' || provider === 'liveresults';
}

export class DataSourceFieldMapper {
  private static optionalSnapshots = new WeakMap<TemplateDataSourceConfig, Map<string, Promise<Record<string, any>>>>();
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

    if (isTimingProvider(dataSourceConfig.api.provider) && dataSourceConfig.api.classScope === 'optional' && !dataSourceValues.className) {
      const requests = this.optionalSnapshots.get(dataSourceConfig) ?? new Map();
      this.optionalSnapshots.set(dataSourceConfig, requests);
      const key = JSON.stringify([competitionId, dataSourceId, dataSourceValues, rundownSettings]);
      const pending = requests.get(key);
      if (pending) return pending;
      const request = (async () => {
        const source: any = dataSourceId ? getDataSourceRegistry().get(dataSourceId) : undefined;
        const client = source?.getClient?.();
        if (!client) throw new Error('Choose a timing source for this event');
        const classes = await timingClasses(client, competitionId);
        const mapped = await mapTimingClasses(classes, className => this.fetchAndMapData(
          dataSourceConfig, competitionId, { ...dataSourceValues, className }, rundownSettings, dataSourceId
        ));
        // A failed class aborts the update, preserving the graphic's last complete snapshot.
        return {
          ...(mapped[0] ?? {}), className: '',
          results: mapped.flatMap((data, i) => (data.results ?? []).map((r: any) => ({ ...r, className: classes[i] }))),
          splitControls: [...new Map(mapped.flatMap(data => data.splitControls ?? []).map((c: any) => [String(c.code), c])).values()],
        };
      })();
      requests.set(key, request);
      try { return await request; } finally { requests.delete(key); }

    }

    // Fetch data based on provider
    if (isTimingProvider(dataSourceConfig.api.provider)) {
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

      // Every data source has a timing hub: Liveresultat, MeOS, MOP, IOF XML, plugins
      const client: TimingHub | undefined =
        typeof (dataSource as any).getClient === 'function' ? (dataSource as any).getClient() : undefined;
      if (!client) {
        throw new Error(`Data source '${dataSourceId}' cannot feed templates (type: ${dataSource.config.type})`);
      }

      // Get className from dataSourceValues (set by class-selector UI control)
      const className = dataSourceValues.className;
      if (!className) {
        logger.warn('No className in dataSourceValues - cannot fetch timing data');
        return {};
      }

      // Competition info for context (date + time zone are needed for live clocks)
      let competition: CompetitionInfo | undefined;
      try {
        competition = await client.getCompetitionInfo(competitionId);
      } catch (error) {
        logger.warn('Competition info failed', {
          competitionId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      const clockOffsetMs = await client.getServerClockOffsetMs();

      // A poll that just detected a change fetched this class moments ago: reuse it
      const classResults = (await client.getClassResults(competitionId, className, { maxAgeMs: 2000 })).data;

      // Get controlCode from dataSourceValues if specified
      const controlCode = dataSourceValues.controlCode;

      // Cached rows for graphics (DataStore), from the same data source's hub
      const dataStore = getDataStore();
      const cachedOgrafData = await dataStore.getTransformedClassResults(
        competitionId,
        className,
        {
          competitionName: competition?.name,
          controlCode,
          client,
          maxAgeMs: 2000
        }
      );

      // The DataStore caches this object, so never mutate it: work on copies.
      const clock = competition ? clockOf(competition) : null;
      const rowByRunner = new Map<string, ResultRow>();
      for (const row of classResults.rows) rowByRunner.set(`${row.name}|${row.club}`, row);
      // Relays: leg times count from the team's start, not the runner's changeover
      const teamStarts = competition ? teamStartsByClub(classResults.rows, competition) : new Map<string, number>();
      // Radio controls of the class, and every runner's times at them, for split graphics
      const splitControls = classResults.controls.map(c => ({ code: c.key, name: c.name }));
      const logos = getClubLogoService();
      const ografData = {
        ...cachedOgrafData,
        // Timing plugins: extra class fields, read as x.<plugin>.<key>
        ...(classResults.ext ? { x: classResults.ext } : {}),
        competitionName: rundownSettings?.competitionNameOverride || cachedOgrafData.competitionName,
        results: (cachedOgrafData.results ?? []).map(runner => {
          const row = rowByRunner.get(`${runner.name}|${runner.club}`);
          const startCs = row && competition ? wallClockCs(competition, row.start) || undefined : undefined;
          const startTimeMs = clock && startCs ? startTimeEpochMs(clock, startCs) : undefined;
          const extra: Record<string, any> = { className };
          if (row?.statusCode === 0 && row.time !== undefined && row.time > 0) extra.finishTimeMs = Math.round(row.time / 10) * 10;
          if (startTimeMs) extra.startTimeMs = startTimeMs;
          const teamStartCs = teamStarts.get(String(runner.club ?? ''));
          if (clock && teamStartCs && teamStartCs !== startCs) extra.teamStartTimeMs = startTimeEpochMs(clock, teamStartCs);
          if (row?.country) extra.country = row.country;
          // Timing plugins: declared extra fields, read as results[].x.<plugin>.<key>
          if (row?.ext) extra.x = row.ext;
          const logo = logos?.lookup(runner.club);
          if (logo) extra.clubLogo = logo;
          if (row && splitControls.length) {
            extra.splitTimes = splitControls
              .map(c => {
                const split = row.splits[c.code];
                return {
                  code: c.code,
                  time: split ? Math.round(split.time / 10) : 0,
                  place: split?.place || 0,
                  timeplus: split?.behind !== undefined ? Math.round(split.behind / 10) : 0,
                  status: split?.status ?? 0
                };
              })
              .filter(t => t.time > 0);
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

      // Relays: the selected team on every leg, for graphics that follow a team (split comparison)
      if (dataSourceConfig.api?.fieldMappings?.some(m => m.apiPath === 'relayLegs')) {
        const legs = await relayLegsOfTeam(client, competitionId, className, classResults, dataSourceValues);
        if (legs.length) mappedFields.relayLegs = legs;
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
          const controlObj = classResults.controls.find(c => String(c.key) === String(controlCode));
          mappedFields.controlName = controlObj ? controlObj.name : `Control ${controlCode}`;
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

/** competitionClock() of a competition as the hub describes it */
export function clockOf(info: CompetitionInfo): CompetitionClock | null {
  return competitionClock({ date: info.date, timezone: info.timezone, timediff: info.timediffHours });
}

/**
 * Relays: when each team started (hundredths since midnight), by team name. Leg results and
 * splits count from the team's start, while a runner's own start is their changeover.
 * A team start after the runner's own start can't be right and is left out. Empty for
 * individual classes, and for teams whose start the source does not know.
 */
export function teamStartsByClub(rows: ResultRow[], info: CompetitionInfo): Map<string, number> {
  const starts = new Map<string, number>();
  for (const r of rows) {
    const cs = wallClockCs(info, r.teamStart);
    if (cs > 0 && r.club) starts.set(String(r.club), cs);
  }
  for (const r of rows) {
    const team = starts.get(String(r.club ?? ''));
    const start = wallClockCs(info, r.start);
    if (team && start > 0 && team > start) starts.delete(String(r.club));
  }
  return starts;
}

/** One leg of a relay team, as graphics get it (relayLegs) */
export interface RelayLegOfTeam {
  leg: number;
  className: string;
  /** The leg's radio controls in course order */
  controls: Array<{ code: number; name: string }>;
  /** The team's runner on this leg; times and places from the team's start (null: not known yet) */
  runner: {
    name: string;
    club: string;
    status: number;
    /** Team time at the end of the leg (hundredths), 0 until then */
    result: number;
    place: number;
    /** Behind the best team at the end of the leg (hundredths) */
    timeplus: number;
    /** This runner's own time on the leg (hundredths), 0 until known */
    legTime: number;
    /** Rank of the leg time among all teams on this leg (0 until known) */
    legPlace: number;
    /** Behind the fastest leg time (hundredths) */
    legTimeplus: number;
    /** Team time, place and time behind at each radio control of the leg */
    splits: Array<{ code: number; time: number; place: number; timeplus: number }>;
  } | null;
}

const hundredths = (ms: number | undefined) => (ms !== undefined ? Math.round(ms / 10) : 0);

/**
 * The selected runner's team on every leg of a relay: each leg class ("Mixed-1", "Mixed-2" …)
 * with the team's runner, places and times from the team's start. Empty for individual classes.
 */
export async function relayLegsOfTeam(
  client: Pick<TimingHub, 'getClassResults' | 'getClasses'>,
  competitionId: number,
  className: string,
  current: ClassResults,
  values: { runnerName?: string; runnerClub?: string }
): Promise<RelayLegOfTeam[]> {
  const leg = /^(.*\S)\s*-(\d+)$/.exec(String(className));
  if (!leg) return [];
  const base = leg[1];
  const own = current.rows.find(r => r.name === values.runnerName);
  const team = String(values.runnerClub || own?.club || '');
  if (!team) return [];
  // the relay's legs, from the class list (fall back to legs 1 … this one)
  let legNames: string[] = [];
  try {
    const classes = (await client.getClasses(competitionId)).data ?? [];
    legNames = classes.map(c => String(c.className))
      .filter(n => { const m = /^(.*\S)\s*-(\d+)$/.exec(n); return !!m && m[1] === base; });
  } catch { /* fall back below */ }
  if (!legNames.length) legNames = Array.from({ length: Number(leg[2]) }, (_, i) => `${base}-${i + 1}`);
  const legNo = (n: string) => Number(/-(\d+)$/.exec(n)?.[1] ?? 0);
  legNames.sort((a, b) => legNo(a) - legNo(b));
  const out: RelayLegOfTeam[] = [];
  // every team's time at the end of the previous leg, for leg times (team -> hundredths)
  let previousEnd = new Map<string, number>();
  for (const name of legNames) {
    let data: ClassResults | undefined = name === className ? current : undefined;
    if (!data) {
      try { data = (await client.getClassResults(competitionId, name, { maxAgeMs: 10_000 })).data; }
      catch { previousEnd = new Map(); continue; } // the next leg's times can't be worked out
    }
    const controls = data.controls.map(c => ({ code: c.key, name: c.name }));
    // leg times of all teams on this leg: team time now minus at the previous changeover
    const ends = new Map<string, number>();
    const legTimes = new Map<string, number>();
    for (const x of data.rows) {
      const end = x.statusCode === 0 ? hundredths(x.time) || 0 : 0;
      if (!end) continue;
      ends.set(String(x.club), end);
      const before = legNo(name) === 1 ? 0 : previousEnd.get(String(x.club));
      if (before !== undefined && end > before) legTimes.set(String(x.club), end - before);
    }
    previousEnd = ends;
    const fastest = Math.min(...legTimes.values());
    const r = data.rows.find(x => String(x.club) === team);
    const legTime = legTimes.get(team) ?? 0;
    out.push({
      leg: legNo(name),
      className: name,
      controls,
      runner: r ? {
        name: String(r.name ?? ''),
        club: String(r.club ?? ''),
        status: r.statusCode || 0,
        result: r.statusCode === 0 ? hundredths(r.time) || 0 : 0,
        place: r.tied ? 0 : r.place || 0,
        timeplus: hundredths(r.behind) || 0,
        legTime,
        legPlace: legTime ? 1 + [...legTimes.values()].filter(t => t < legTime).length : 0,
        legTimeplus: legTime ? legTime - fastest : 0,
        splits: controls
          .map(c => {
            const split = r.splits[c.code];
            return { code: c.code, time: split ? hundredths(split.time) : 0, place: split?.place || 0, timeplus: hundredths(split?.behind) || 0 };
          })
          .filter(s => s.time > 0)
      } : null
    });
  }
  return out;
}
