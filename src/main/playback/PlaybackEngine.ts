/**
 * Playback Engine
 * Manages graphics playback and coordinates between rundown items and graphics renderer
 */

import { getLogger } from '../utils/logger';
import { getTemplateManager } from '../templates/OGrafManager';
import { getRundownManager } from '../projects/RundownManager';
import { DataSourceFieldMapper } from '../data/DataSourceFieldMapper';
import { WebSocketServer, SocketRoom } from '../data/WebSocketServer';
import { getDataStore } from '../data/DataStore';
import type { OGrafResultsData } from '../data/LiveResultsTransformer';
import { getProjectManager } from '../projects/ProjectManager';
import { getClubLogoService, shortClubName } from '../data/ClubLogoService';
import { applyStartList } from '../events/EventService';
import { clubNameLibrary } from '../data/clubNames';
import { assertTemplateInProjectSet } from '../templates/templateSets';
import { presentationForGraphics } from '../../shared/branding';
import { isMultiStep, zonesClash, type GraphicZone } from '../../shared/types/ograf';
import type { ProjectPresentation, SPXRundown } from '../../shared/types/spx';

const logger = getLogger();

/**
 * Renderers reply { success, result: ReturnPayload }, so the step is result.result.currentStep.
 * (Reading result.currentStep always gave 1, which broke multi-step resync and undo.)
 */
function stepFromPlayResult(playResult: any): number {
  const step = playResult?.result?.currentStep ?? playResult?.currentStep;
  return Number.isFinite(step) && step > 0 ? step : 1;
}

function totalStepsFromPlayResult(playResult: any): number | undefined {
  const steps = playResult?.result?.totalSteps ?? playResult?.totalSteps;
  return Number.isFinite(steps) && steps > 0 ? steps : undefined;
}

/**
 * Playback Engine class
 */
export class PlaybackEngine {
  private wsServer: WebSocketServer | null = null;
  private activeGraphics: Map<string, ActiveGraphic> = new Map();
  private removalTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private autoPageTimeouts: Map<string, NodeJS.Timeout> = new Map();
  /** Waiting commands by request id (unique per command, echoed by the renderers) */
  private pendingResponses: Map<string, {
    /** `${command}:${graphicId}`, for renderers that do not echo the request id */
    key: string;
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    responses: any[];
    expectedCount: number;
  }> = new Map();
  // Track timed-out commands to suppress late response warnings
  private timedOutCommands: Set<string> = new Set();
  private requestSeq = 0;
  // Track in-progress play operations to prevent race conditions
  private playInProgress: Set<string> = new Set();
  // Live-results polls currently running, keyed by `${sourceId}|${competitionId}|${className}`
  private livePolls: Map<string, { competitionId: number; className: string; client: any }> = new Map();
  // Coalescing of live updates per competition/class: one run at a time, at most one queued
  private liveUpdateRunning: Set<string> = new Set();
  private liveUpdatePending: Set<string> = new Set();

  constructor() {
    logger.info('Playback engine initialized');
  }

  private cancelAutoPage(graphicId: string): void {
    const timeout = this.autoPageTimeouts.get(graphicId);
    if (timeout) clearTimeout(timeout);
    this.autoPageTimeouts.delete(graphicId);
  }

  private scheduleAutoPage(
    projectId: string,
    rundownId: string,
    itemId: string,
    seconds?: number,
  ): void {
    const graphicId = `${projectId}-${rundownId}-${itemId}`;
    this.cancelAutoPage(graphicId);
    if (!seconds || seconds <= 0) return;
    // Single-page graphics stay on air until the operator takes them off
    const active = this.activeGraphics.get(graphicId);
    const manifest = active?.manifest
      ?? getTemplateManager().getAllTemplates().find(t => t.manifest.id === active?.templateId)?.manifest;
    if (!isMultiStep(manifest)) return;
    const timeout = setTimeout(async () => {
      this.autoPageTimeouts.delete(graphicId);
      const graphic = this.activeGraphics.get(graphicId);
      if (!graphic?.isPlaying) return;
      const previousStep = graphic.currentStep || 1;
      try {
        if (graphic.totalSteps && previousStep >= graphic.totalSteps) {
          logger.info('Automatic page playback finished; hiding graphic', {
            itemId,
            currentStep: graphic.currentStep,
            totalSteps: graphic.totalSteps,
          });
          await this.stopItem(projectId, rundownId, itemId);
          return;
        }
        await this.nextItem(projectId, rundownId, itemId);
        const currentStep = this.activeGraphics.get(graphicId)?.currentStep || previousStep;
        if (currentStep === previousStep) {
          logger.info('Automatic page playback reached the last page; hiding graphic', { itemId, currentStep });
          await this.stopItem(projectId, rundownId, itemId);
        }
      } catch (error) {
        logger.error('Automatic page advance failed', {
          itemId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, seconds * 1000);
    this.autoPageTimeouts.set(graphicId, timeout);
  }

  /**
   * Set WebSocket server for sending commands to graphics renderer
   */
  setWebSocketServer(wsServer: WebSocketServer) {
    this.wsServer = wsServer;
    logger.info('WebSocket server attached to playback engine');

    // Set callback for graphics responses
    this.wsServer.setResponseCallback((data: any) => {
      this.handleGraphicsResponse(data);
    });

    // Set callback for new clients joining program-output room
    // This allows us to sync graphics state to newly connected renderers
    this.wsServer.setNewClientCallback((socketId: string, room: SocketRoom) => {
      // Call async function without awaiting (fire-and-forget)
      // Errors are handled inside syncGraphicsToNewClient
      this.syncGraphicsToNewClient(socketId, room).catch(error => {
        logger.error('Error in syncGraphicsToNewClient callback', {
          socketId,
          room,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    });

    // Listen for LiveResults updates from DataStore
    const dataStore = getDataStore();
    dataStore.on('results:updated', (competitionId: number, className: string, ografData: OGrafResultsData) => {
      this.handleLiveResultsUpdate(competitionId, className, ografData).catch(error => {
        logger.error('Error in handleLiveResultsUpdate callback', {
          competitionId,
          className,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    });
    logger.info('Listening for LiveResults updates from DataStore');
  }

  /**
   * Handle graphics renderer response
   */
  private handleGraphicsResponse(data: any): void {
    const { command, id, result } = data;
    const commandKey = `${command}:${id}`;
    // The request id says which command this answers. Without one (an older renderer),
    // the oldest waiting command for this graphic gets it.
    const responseKey: string = data.requestId
      || ([...this.pendingResponses].find(([, p]) => p.key === commandKey)?.[0] ?? commandKey);

    logger.info('Received graphics response', { command, id, success: result?.success });

    const pending = this.pendingResponses.get(responseKey);
    if (pending) {
      // Collect response from this renderer
      pending.responses.push(result);

      logger.debug('Graphics response collected', {
        command,
        id,
        receivedCount: pending.responses.length,
        expectedCount: pending.expectedCount
      });

      // Check if we have all responses
      if (pending.responses.length >= pending.expectedCount) {
        clearTimeout(pending.timeout);
        this.pendingResponses.delete(responseKey);

        // Check if ANY response failed
        const failedResponse = pending.responses.find(r => !r?.success);
        if (failedResponse) {
          logger.error('Graphics command failed on at least one renderer', {
            command,
            id,
            error: failedResponse.error,
            totalResponses: pending.responses.length
          });
          pending.reject(new Error(failedResponse.error || 'Graphics command failed'));
        } else {
          // All responses succeeded
          logger.debug('Graphics command succeeded on all renderers', {
            command,
            id,
            totalResponses: pending.responses.length
          });
          pending.resolve(pending.responses[0]); // Return first success response
        }
      }
    } else {
      // Check if this was a timed-out command (late response)
      if (this.timedOutCommands.has(responseKey)) {
        logger.debug('Received late response for timed-out command', {
          command,
          id,
          result
        });
      } else {
        logger.warn('Received graphics response for unknown command', {
          command,
          id,
          result
        });
      }
    }
  }

  /**
   * Which competition/class/source an item follows live, or null when it doesn't auto-update.
   *
   * One rule for play, polling, updates and stop:
   *  - competition: the rundown's data source competition (what play uses), else the item's saved one
   *  - class: the datasource UI value, else the item's saved className
   *  - autoUpdate: the item's flag; API templates default to on
   */
  private resolveLiveBinding(
    rundown: { dataSource?: { competitionId?: number; sourceId?: string } },
    item: { liveResultsData?: any },
    template?: { dataSourceConfig?: { mode?: string } }
  ): { competitionId: number; className: string; sourceId?: string; dataSourceValues: Record<string, any> } | null {
    const lr = item.liveResultsData || {};
    const dataSourceValues: Record<string, any> = lr.dataSourceValues || {};
    const autoUpdate = lr.autoUpdate ?? (template?.dataSourceConfig?.mode === 'api');
    const competitionId = Number(rundown.dataSource?.competitionId || lr.competitionId || 0);
    const className: string | undefined = dataSourceValues.className || lr.className;
    if (!autoUpdate || !competitionId || !className) return null;
    return { competitionId, className, sourceId: rundown.dataSource?.sourceId, dataSourceValues };
  }

  /**
   * The LiveResults client of a configured data source (null = DataStore singleton)
   */
  private async getSourceClient(sourceId?: string): Promise<any | null> {
    if (!sourceId) return null;
    const { getDataSourceRegistry } = await import('../data/DataSourceRegistry');
    const dataSource = getDataSourceRegistry().get(sourceId);
    return dataSource && 'getClient' in dataSource ? (dataSource as any).getClient() : null;
  }

  /**
   * Reconcile live-results polling with what is on air.
   * Starts a poll for every (source, competition, class) used by a playing graphic and stops
   * every poll nothing uses any more. Called after play, stop, clear and item edits, so
   * polls never leak and follow class/competition changes on air.
   */
  async syncPolling(): Promise<void> {
    const desired = new Map<string, { competitionId: number; className: string; sourceId?: string }>();
    const rundownManager = getRundownManager();
    const templates = getTemplateManager().getAllTemplates();

    for (const graphic of this.activeGraphics.values()) {
      if (!graphic.isPlaying || graphic.source === 'api') continue;
      try {
        const rundown = await rundownManager.loadRundown(graphic.projectId, graphic.rundownId);
        const item = rundown.items.find(i => i.id === graphic.itemId);
        if (!item) continue;
        const template = templates.find(t => t.manifest.id === item.templateId);
        const binding = this.resolveLiveBinding(rundown, item, template);
        if (!binding) continue;
        desired.set(`${binding.sourceId ?? ''}|${binding.competitionId}|${binding.className}`, binding);
      } catch (error) {
        logger.warn('syncPolling: could not inspect graphic', {
          graphicId: graphic.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const dataStore = getDataStore();
    for (const [key, poll] of this.livePolls) {
      if (!desired.has(key)) {
        dataStore.stopPolling(poll.competitionId, poll.className, poll.client);
        this.livePolls.delete(key);
        logger.info('Stopped live polling (nothing on air uses it)', { competitionId: poll.competitionId, className: poll.className });
      }
    }
    for (const [key, binding] of desired) {
      if (this.livePolls.has(key)) continue;
      const client = await this.getSourceClient(binding.sourceId);
      // Interval 0 = the client's own minimum: 10 s for the REST API, 15 s for legacy api.php
      dataStore.startPolling(binding.competitionId, binding.className, 0, client);
      this.livePolls.set(key, { competitionId: binding.competitionId, className: binding.className, client });
      logger.info('Started live polling', {
        competitionId: binding.competitionId,
        className: binding.className,
        dataSourceId: binding.sourceId
      });
    }
  }

  getLivePollingStatus() {
    return getDataStore().getPollingStatus().filter(status => status.active &&
      [...this.livePolls.values()].some(p => p.competitionId === status.competitionId && p.className === status.className));
  }

  /**
   * Handle LiveResults update from DataStore.
   * Updates run one at a time per competition/class; updates arriving meanwhile collapse into
   * one follow-up run, so a slow renderer never builds a backlog.
   */
  private async handleLiveResultsUpdate(
    competitionId: number,
    className: string,
    _ografData: OGrafResultsData
  ): Promise<void> {
    const key = `${competitionId}|${className}`;
    if (this.liveUpdateRunning.has(key)) {
      this.liveUpdatePending.add(key);
      return;
    }
    this.liveUpdateRunning.add(key);
    try {
      do {
        this.liveUpdatePending.delete(key);
        await this.applyLiveResultsUpdate(competitionId, className);
      } while (this.liveUpdatePending.has(key));
    } finally {
      this.liveUpdateRunning.delete(key);
    }
  }

  /**
   * Push fresh data to every active graphic that follows this competition/class.
   * On a fetch error the graphic keeps its last good data instead of being blanked.
   */
  private async applyLiveResultsUpdate(competitionId: number, className: string): Promise<void> {
    let updatedCount = 0;
    const rundownManager = getRundownManager();
    const templates = getTemplateManager().getAllTemplates();

    for (const [graphicId, graphic] of Array.from(this.activeGraphics)) {
      if (graphic.source === 'api') continue;
      try {
        const rundown = await rundownManager.loadRundown(graphic.projectId, graphic.rundownId);
        const item = rundown.items.find(i => i.id === graphic.itemId);
        if (!item) continue;
        const template = templates.find(t => t.manifest.id === item.templateId);
        const binding = this.resolveLiveBinding(rundown, item, template);
        if (!binding || binding.competitionId !== competitionId || binding.className !== className) continue;
        if (!template?.dataSourceConfig) {
          logger.warn('Template has no dataSourceConfig; cannot auto-update', { graphicId, templateId: item.templateId });
          continue;
        }

        let mappedData: Record<string, any>;
        try {
          mappedData = await DataSourceFieldMapper.fetchAndMapData(
            template.dataSourceConfig,
            binding.competitionId,
            binding.dataSourceValues,
            rundown.settings,
            binding.sourceId
          );
        } catch (error) {
          logger.warn('Live update skipped: fetch failed, keeping last good data on air', {
            graphicId,
            error: error instanceof Error ? error.message : String(error)
          });
          continue;
        }
        if (!mappedData || Object.keys(mappedData).length === 0) {
          logger.warn('Live update skipped: mapper returned no data', { graphicId });
          continue;
        }
        mappedData = await this.decorateData(graphic.projectId, rundown, { ...(item.fields || {}), ...mappedData });
        // The graphic may have been stopped and disposed while we were fetching
        if (!this.activeGraphics.has(graphicId)) continue;
        // Operator chose to hold this graphic's data on air: only note that what it would show changed
        if (graphic.isPlaying && item.liveResultsData?.holdOnAir) {
          const withSplits = /splits|position-history/.test(graphic.templateId);
          graphic.newData = shownResults(mappedData, withSplits) !== shownResults(graphic.data, withSplits);
          continue;
        }

        await this.sendCommand('update', { id: graphicId, data: mappedData });
        graphic.data = mappedData;
        updatedCount++;
        logger.info('Graphic auto-updated', {
          graphicId,
          resultsCount: mappedData.results?.length || 0,
          isPlaying: graphic.isPlaying
        });
      } catch (error) {
        logger.error('Failed to auto-update graphic', {
          graphicId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    if (updatedCount > 0) {
      logger.info('Auto-update complete', { competitionId, className, updatedGraphics: updatedCount });
    }
  }

  /**
   * Re-map an on-air item from its saved settings and push the result, then re-sync polling.
   * Used after the operator edits an item while it is playing (e.g. picks another runner/class).
   */
  async refreshItem(projectId: string, rundownId: string, itemId: string): Promise<boolean> {
    const graphicId = `${projectId}-${rundownId}-${itemId}`;
    const graphic = this.activeGraphics.get(graphicId);
    if (!graphic) return false;

    const rundown = await getRundownManager().loadRundown(projectId, rundownId);
    const item = rundown.items.find(i => i.id === itemId);
    const template = getTemplateManager().getAllTemplates().find(t => t.manifest.id === item?.templateId);
    if (!item || !template) return false;

    let data: Record<string, any> = item.fields || {};
    if (template.dataSourceConfig && item.liveResultsData?.dataSourceValues) {
      data = await DataSourceFieldMapper.fetchAndMapData(
        template.dataSourceConfig,
        rundown.dataSource?.competitionId || item.liveResultsData.competitionId || 0,
        item.liveResultsData.dataSourceValues,
        rundown.settings,
        rundown.dataSource?.sourceId
      ).then(mapped => ({ ...(item.fields || {}), ...mapped }));
    }
    data = await this.decorateData(projectId, rundown, data);
    await this.sendCommand('update', { id: graphicId, data });
    graphic.data = data;
    graphic.newData = false;
    if (graphic.isPlaying) {
      this.scheduleAutoPage(
        projectId,
        rundownId,
        itemId,
        item.autoPageDurationSeconds,
      );
    }
    await this.syncPolling();
    return true;
  }

  /**
   * Sync all loaded graphics to a newly connected renderer
   * This prevents the "Program Preview goes blank" issue when iframes reload
   */
  private async syncGraphicsToNewClient(socketId: string, room: SocketRoom): Promise<void> {
    if (room !== SocketRoom.PROGRAM_OUTPUT) {
      return; // Only sync to program-output room
    }

    if (!this.wsServer) {
      logger.error('Cannot sync graphics: WebSocket server not attached');
      return;
    }

    const loadedGraphics = Array.from(this.activeGraphics.values());

    if (loadedGraphics.length === 0) {
      logger.debug('No graphics to sync to new client', { socketId, room });
      return;
    }

    logger.info('Syncing graphics state to new client', {
      socketId,
      room,
      graphicsCount: loadedGraphics.length
    });

    // Send load commands for all loaded graphics to the new client
    for (const graphic of loadedGraphics) {
      if (!graphic.manifest || !graphic.templateDirectoryName || !graphic.data) {
        logger.warn('Cannot sync graphic: missing state data', {
          graphicId: graphic.id,
          hasManifest: !!graphic.manifest,
          hasTemplateDirectoryName: !!graphic.templateDirectoryName,
          hasData: !!graphic.data
        });
        continue;
      }

      try {
        // Send load command to the specific client
        this.wsServer.sendToClient(socketId, {
          spxcmd: 'graphics:command',
          command: 'load',
          payload: {
            id: graphic.id,
            manifest: graphic.manifest,
            templateId: graphic.templateDirectoryName,
            data: graphic.data
          }
        });

        logger.debug('Sent load command to new client', {
          socketId,
          graphicId: graphic.id,
          templateId: graphic.templateDirectoryName
        });

        // If the graphic is currently playing, send play command too
        if (graphic.isPlaying) {
          // Wait a bit for load to complete
          await new Promise(resolve => setTimeout(resolve, 100));

          this.wsServer.sendToClient(socketId, {
            spxcmd: 'graphics:command',
            command: 'play',
            payload: {
              id: graphic.id,
              options: {
                skipAnimation: true, // Skip animation for sync
                goto: graphic.currentStep || 1
              }
            }
          });

          logger.debug('Sent play command to new client', {
            socketId,
            graphicId: graphic.id,
            currentStep: graphic.currentStep
          });
        }
      } catch (error) {
        logger.error('Failed to sync graphic to new client', {
          socketId,
          graphicId: graphic.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    logger.info('Graphics sync complete', {
      socketId,
      syncedCount: loadedGraphics.length
    });
  }

  /**
   * Play a rundown item
   */
  /**
   * Context every graphic gets besides its own fields: the project's presentation settings
   * (club/flag rule, logos) and event info from the rundown. Template sets read
   * data.presentation and data.event; other graphics ignore them.
   */
  private async decorateData(projectId: string, rundown: SPXRundown, data: Record<string, any>): Promise<Record<string, any>> {
    let presentation: ProjectPresentation = {};
    let info: import('../../shared/types/event').EventInfo = {};
    try {
      const project = await getProjectManager().loadProject(projectId);
      presentation = presentationForGraphics(project.settings?.presentation);
      info = project.info ?? {};
    } catch {
      // project file unreadable: defaults
    }
    // Bibs (real or virtual) and favourites from the event's start list
    data = applyStartList(projectId, data);
    data = shortClubNames(data, clubNameLibrary());
    return {
      ...data,
      presentation: { identity: 'auto', clubLogos: true, clearClashing: true, ...presentation },
      event: {
        name: rundown.settings?.competitionNameOverride || rundown.dataSource?.competitionName || data.competitionName || '',
        location: rundown.settings?.raceLocation || '',
        date: info.date || data.competitionDate || '',
        series: info.series || '',
        organiser: info.organiser || '',
        timeZone: info.timeZone || ''
      }
    };
  }

  /** Take graphics off air whose screen zone clashes with the one about to play */
  private async clearClashing(graphicId: string, zone: GraphicZone | undefined): Promise<void> {
    if (!zone) return;
    const rundownManager = getRundownManager();
    for (const g of Array.from(this.activeGraphics.values())) {
      if (g.id === graphicId || !g.isPlaying || !zonesClash(zone, g.zone)) continue;
      logger.info('Clearing clashing graphic', { playing: graphicId, zone, clearing: g.id, theirZone: g.zone });
      try {
        await this.sendCommand('stop', { id: g.id, skipAnimation: false });
        g.isPlaying = false;
        if (g.source !== 'api') {
          const r = await rundownManager.loadRundown(g.projectId, g.rundownId);
          const it = r.items.find(i => i.id === g.itemId);
          if (it) { it.onair = false; await rundownManager.saveRundown(r); }
        }
      } catch (error) {
        logger.warn('Failed to clear clashing graphic', { graphicId: g.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  async playItem(
    projectId: string,
    rundownId: string,
    itemId: string
  ): Promise<void> {
    const graphicId = `${projectId}-${rundownId}-${itemId}`;

    // CRITICAL: Prevent concurrent play operations on the same item
    // This prevents race conditions when user clicks play multiple times rapidly
    if (this.playInProgress.has(graphicId)) {
      logger.warn('Play operation already in progress for this item, ignoring duplicate request', {
        graphicId,
        projectId,
        rundownId,
        itemId
      });
      return;
    }

    logger.info('Playing rundown item', { projectId, rundownId, itemId, graphicId });

    // Mark this play operation as in progress
    this.playInProgress.add(graphicId);

    try {
      // Get rundown manager
      const rundownManager = getRundownManager();
      const rundown = await rundownManager.loadRundown(projectId, rundownId);

      // Find the item
      const item = rundown.items.find(i => i.id === itemId);
      if (!item) {
        throw new Error(`Item not found: ${itemId}`);
      }

      // Get template manager
      const templateManager = getTemplateManager();
      const templates = templateManager.getAllTemplates();

      // Find the template
      const template = templates.find((t) => t.manifest.id === item.templateId);
      if (!template) {
        throw new Error(`Template not found: ${item.templateId}`);
      }

      // One look per production: refuse graphics from another template set
      const project = await getProjectManager().loadProject(projectId);
      assertTemplateInProjectSet(project, template);

      // Prepare data for the graphic
      let graphicData: Record<string, any> = item.fields || {};

      // NEW datasource configuration system
      if (template.dataSourceConfig && item.liveResultsData?.dataSourceValues) {
        const fetchStartTime = Date.now();
        try {
          logger.info('Using new datasource configuration system', {
            templateId: item.templateId,
            dataSourceValues: item.liveResultsData.dataSourceValues,
            competitionId: rundown.dataSource?.competitionId,
            dataSourceId: rundown.dataSource?.sourceId,
            rundownId: rundown.id,
            rundownName: rundown.name
          });

          // Fetch and map data using the new system
          const mappedData = await DataSourceFieldMapper.fetchAndMapData(
            template.dataSourceConfig,
            rundown.dataSource?.competitionId || 0,
            item.liveResultsData.dataSourceValues,
            rundown.settings,
            rundown.dataSource?.sourceId
          );

          const fetchDuration = Date.now() - fetchStartTime;
          logger.info('Datasource field mapping complete', {
            templateId: item.templateId,
            mappedFieldsCount: Object.keys(mappedData).length,
            hasResults: !!mappedData.results,
            resultsCount: mappedData.results?.length || 0,
            fetchDurationMs: fetchDuration
          });

          // Live data on top of the operator's manual options (rows per page, titles ...)
          graphicData = { ...(item.fields || {}), ...mappedData };

        } catch (error) {
          const fetchDuration = Date.now() - fetchStartTime;
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error('Failed to fetch data using datasource system', {
            error: errorMessage,
            templateId: item.templateId,
            fetchDurationMs: fetchDuration
          });

          // Throw a user-friendly error instead of silently falling back
          throw new Error(`Failed to fetch API data: ${errorMessage}. Check data source configuration and network connection.`);
        }
      }

      graphicData = await this.decorateData(projectId, rundown, graphicData);

      // Check playback mode - if solo, stop all currently playing graphics
      // Priority: rundown item > template manifest > default to stackable
      const playbackMode = item.playbackMode || template.manifest.playbackMode || 'stackable';

      if (playbackMode === 'solo') {
        logger.info('Solo mode - stopping all currently playing graphics', {
          templateId: item.templateId,
          graphicId,
          source: item.playbackMode ? 'rundown-item' : template.manifest.playbackMode ? 'template-manifest' : 'default'
        });

        // Stop all currently playing graphics
        const playingGraphics = Array.from(this.activeGraphics.values()).filter(g => g.isPlaying);
        for (const graphic of playingGraphics) {
          try {
            await this.sendCommand('stop', {
              id: graphic.id,
              skipAnimation: false
            });
            graphic.isPlaying = false;

            // Update rundown item state
            const graphicRundown = await rundownManager.loadRundown(graphic.projectId, graphic.rundownId);
            const graphicItem = graphicRundown.items.find(i => i.id === graphic.itemId);
            if (graphicItem) {
              graphicItem.onair = false;
              await rundownManager.saveRundown(graphicRundown);
            }
          } catch (error) {
            logger.error('Failed to stop graphic in solo mode', {
              graphicId: graphic.id,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      } else {
        if (graphicData.presentation?.clearClashing !== false) {
          await this.clearClashing(graphicId, template.zone);
        }
        logger.debug('Stackable mode template - keeping other graphics playing', {
          templateId: item.templateId,
          graphicId,
          currentlyPlaying: Array.from(this.activeGraphics.values()).filter(g => g.isPlaying).length
        });
      }

      // Clear any pending removal timeout for this graphic
      // This prevents race conditions where a graphic is removed after being played again
      const pendingTimeout = this.removalTimeouts.get(graphicId);
      if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        this.removalTimeouts.delete(graphicId);
        logger.debug('Cleared pending removal timeout for graphic', { graphicId });
      }

      // Check if already loaded
      if (!this.activeGraphics.has(graphicId)) {
        logger.info('Graphic not loaded yet, sending load command', { graphicId });

        // Log the data being sent to the template
        logger.info('=== PlaybackEngine: Data being sent to template ===', {
          graphicId,
          templateId: template.directoryName,
          hasResults: !!graphicData.results,
          resultsCount: graphicData.results?.length || 0
        });

        // Log first 3 results to verify data integrity
        if (graphicData.results && graphicData.results.length > 0) {
          for (let i = 0; i < Math.min(3, graphicData.results.length); i++) {
            logger.info(`[PlaybackEngine] Result ${i + 1} being sent to template`, {
              position: graphicData.results[i].position,
              name: graphicData.results[i].name,
              time: graphicData.results[i].time,
              timeType: typeof graphicData.results[i].time,
              diff: graphicData.results[i].diff,
              diffType: typeof graphicData.results[i].diff,
              statusCode: graphicData.results[i].statusCode
            });
          }
        }

        // Load the graphic first
        // Send directory name for URL construction (e.g., "runner-spotlight")
        await this.sendCommand('load', {
          id: graphicId,
          manifest: template.manifest,
          templateId: template.directoryName, // Use directory name for URL construction
          data: graphicData
        });

        // Track active graphic with full state for syncing to new renderers
        this.activeGraphics.set(graphicId, {
          id: graphicId,
          projectId,
          rundownId,
          itemId,
          templateId: item.templateId,
          isPlaying: false,
          zone: template.zone,
          manifest: template.manifest,
          templateDirectoryName: template.directoryName,
          data: graphicData,
          currentStep: 1
        });
      } else {
        logger.info('Graphic already loaded', { graphicId });
        // Graphic already loaded - update with fresh data if LiveResults is configured
        if (template.dataSourceConfig && item.liveResultsData?.dataSourceValues) {
          logger.info('Updating already-loaded graphic with fresh LiveResults data', {
            graphicId,
            dataKeys: Object.keys(graphicData)
          });

          await this.sendCommand('update', {
            id: graphicId,
            data: graphicData
          });
        }
      }

      // Determine which step to play
      // If graphic was recently stopped (within 1500ms timeout), restore the previous step
      // This enables "undo" functionality for operators
      let activeGraphic = this.activeGraphics.get(graphicId);
      const preservedStep = activeGraphic?.currentStep;

      // Play the graphic
      let playResult;
      if (preservedStep && preservedStep > 1) {
        logger.info('Sending play command with preserved step (undo functionality)', {
          graphicId,
          preservedStep
        });
        playResult = await this.sendCommand('play', {
          id: graphicId,
          options: {
            skipAnimation: false,
            goto: preservedStep // Resume from preserved step
          }
        });
      } else {
        logger.info('Sending play command', { graphicId });
        playResult = await this.sendCommand('play', {
          id: graphicId,
          options: {
            skipAnimation: false
          }
        });
      }

      // Update active graphic state
      activeGraphic = this.activeGraphics.get(graphicId);
      const currentStep = stepFromPlayResult(playResult);
      if (activeGraphic) {
        activeGraphic.isPlaying = true;
        activeGraphic.currentStep = currentStep;
        activeGraphic.totalSteps = totalStepsFromPlayResult(playResult);
      }

      // Update rundown item state with current step
      // The play command returns currentStep from the template
      await rundownManager.updateItem(projectId, rundownId, itemId, {
        onair: true,
        currentStep
      });

      logger.info('Rundown item playing', { itemId, graphicId, currentStep });

      this.scheduleAutoPage(
        projectId,
        rundownId,
        itemId,
        item.autoPageDurationSeconds,
      );

      // Start (or keep) live-results polling for everything on air
      await this.syncPolling();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to play rundown item', { itemId, error: message });
      throw error;
    } finally {
      // CRITICAL: Always remove from in-progress set, even if operation failed
      this.playInProgress.delete(graphicId);
      logger.debug('Play operation completed, removed from in-progress set', { graphicId });
    }
  }

  /**
   * Stop a rundown item
   */
  async stopItem(
    projectId: string,
    rundownId: string,
    itemId: string
  ): Promise<void> {
    logger.info('Stopping rundown item', { projectId, rundownId, itemId });

    try {
      // Generate graphic ID
      const graphicId = `${projectId}-${rundownId}-${itemId}`;
      this.cancelAutoPage(graphicId);

      // Check if loaded
      if (!this.activeGraphics.has(graphicId)) {
        logger.warn('Graphic not loaded, cannot stop', { graphicId });
        return;
      }

      // Stop the graphic
      await this.sendCommand('stop', {
        id: graphicId,
        skipAnimation: false
      });

      // Update active graphic state
      // IMPORTANT: Preserve currentStep in ActiveGraphic for "undo" functionality
      // This allows operators to replay the graphic within 1500ms and resume from the same step
      const activeGraphic = this.activeGraphics.get(graphicId);
      if (activeGraphic) {
        activeGraphic.isPlaying = false;
        // Keep currentStep in activeGraphic - it will be cleared when graphic is disposed
      }

      // Update rundown item state
      const rundownManager = getRundownManager();
      await rundownManager.updateItem(projectId, rundownId, itemId, {
        onair: false,
        currentStep: undefined // Clear from UI, but preserved in activeGraphic for quick replay
      });

      // Schedule removal from active graphics after animation completes
      // Store the timeout ID so it can be cancelled if the graphic is played again
      const timeoutId = setTimeout(async () => {
        // Dispose the graphic to free memory
        try {
          await this.sendCommand('dispose', { id: graphicId });
          logger.debug('Graphic disposed after stop animation', { graphicId });
        } catch (error) {
          logger.warn('Failed to dispose graphic', {
            graphicId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }

        // Remove from tracking
        this.activeGraphics.delete(graphicId);
        this.removalTimeouts.delete(graphicId);
        logger.info('Graphic removed from active graphics', { graphicId });
      }, 1500); // Wait for stop animation + dispose

      this.removalTimeouts.set(graphicId, timeoutId);

      // Stop live polling that nothing on air needs any more
      await this.syncPolling();

      logger.info('Rundown item stopped', { itemId, graphicId });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to stop rundown item', { itemId, error: message });
      throw error;
    }
  }

  /**
   * Update a rundown item's data
   */
  async updateItem(
    projectId: string,
    rundownId: string,
    itemId: string,
    data: any
  ): Promise<void> {
    logger.info('Updating rundown item', { projectId, rundownId, itemId });

    try {
      // Generate graphic ID
      const graphicId = `${projectId}-${rundownId}-${itemId}`;

      // Check if loaded
      if (!this.activeGraphics.has(graphicId)) {
        logger.warn('Graphic not loaded, cannot update', { graphicId });
        return;
      }

      // Keep the presentation/event context the graphic was loaded with
      const rundown = await getRundownManager().loadRundown(projectId, rundownId);
      const decorated = await this.decorateData(projectId, rundown, data ?? {});
      await this.sendCommand('update', {
        id: graphicId,
        data: decorated
      });

      logger.info('Rundown item updated', { itemId, graphicId });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to update rundown item', { itemId, error: message });
      throw error;
    }
  }

  /**
   * Advance to next step in a multi-step graphic
   * According to OGRAF spec, this is done by calling playAction with delta: 1
   */
  async nextItem(
    projectId: string,
    rundownId: string,
    itemId: string
  ): Promise<void> {
    logger.info('Advancing to next step', { projectId, rundownId, itemId });

    try {
      // Generate graphic ID
      const graphicId = `${projectId}-${rundownId}-${itemId}`;

      // Check if loaded
      if (!this.activeGraphics.has(graphicId)) {
        logger.warn('Graphic not loaded, cannot advance to next step', { graphicId });
        return;
      }

      const activeGraphic = this.activeGraphics.get(graphicId);

      // Check if playing
      if (!activeGraphic?.isPlaying) {
        logger.warn('Graphic not playing, cannot advance to next step', { graphicId });
        return;
      }
      const previousStep = activeGraphic.currentStep || 1;

      // Send play command with delta: 1 to advance to next step
      // According to OGRAF spec, playAction with delta advances relative to current step
      const playResult = await this.sendCommand('play', {
        id: graphicId,
        options: {
          skipAnimation: false,
          delta: 1
        }
      });

      // Update active graphic state
      const currentStep = stepFromPlayResult(playResult);
      if (activeGraphic) {
        activeGraphic.currentStep = currentStep;
        activeGraphic.totalSteps = totalStepsFromPlayResult(playResult) ?? activeGraphic.totalSteps;
      }

      // Update rundown item with new current step
      const rundownManager = getRundownManager();
      await rundownManager.updateItem(projectId, rundownId, itemId, {
        currentStep
      });

      logger.info('Advanced to next step', { itemId, graphicId, currentStep });

      const rundown = await rundownManager.loadRundown(projectId, rundownId);
      const item = rundown.items.find(candidate => candidate.id === itemId);
      if (currentStep > previousStep) {
        this.scheduleAutoPage(
          projectId,
          rundownId,
          itemId,
          item?.autoPageDurationSeconds,
        );
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to advance to next step', { itemId, error: message });
      throw error;
    }
  }

  /**
   * Go back to previous step in a multi-step graphic
   * According to OGRAF spec, this is done by calling playAction with delta: -1
   */
  async previousItem(
    projectId: string,
    rundownId: string,
    itemId: string
  ): Promise<void> {
    logger.info('Going back to previous step', { projectId, rundownId, itemId });

    try {
      // Generate graphic ID
      const graphicId = `${projectId}-${rundownId}-${itemId}`;

      // Check if loaded
      if (!this.activeGraphics.has(graphicId)) {
        logger.warn('Graphic not loaded, cannot go to previous step', { graphicId });
        return;
      }

      const activeGraphic = this.activeGraphics.get(graphicId);

      // Check if playing
      if (!activeGraphic?.isPlaying) {
        logger.warn('Graphic not playing, cannot go to previous step', { graphicId });
        return;
      }

      // Send play command with delta: -1 to go to previous step
      // According to OGRAF spec, playAction with delta advances relative to current step
      const playResult = await this.sendCommand('play', {
        id: graphicId,
        options: {
          skipAnimation: false,
          delta: -1
        }
      });

      // Update active graphic state
      const currentStep = stepFromPlayResult(playResult);
      if (activeGraphic) {
        activeGraphic.currentStep = currentStep;
      }

      // Update rundown item with new current step
      const rundownManager = getRundownManager();
      await rundownManager.updateItem(projectId, rundownId, itemId, {
        currentStep
      });

      logger.info('Went back to previous step', { itemId, graphicId, currentStep });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to go to previous step', { itemId, error: message });
      throw error;
    }
  }

  /**
   * Clear all graphics
   */
  async clearAll(): Promise<void> {
    logger.info('Clearing all graphics');

    try {
      // Get all active graphics before clearing
      const activeGraphicsList = Array.from(this.activeGraphics.values());

      // Send clear command to renderer
      await this.sendCommand('clear', {});

      // Update all rundown items to set onair = false
      const rundownManager = getRundownManager();
      for (const graphic of activeGraphicsList) {
        if (graphic.source === 'api') continue;
        try {
          await rundownManager.updateItem(
            graphic.projectId,
            graphic.rundownId,
            graphic.itemId,
            { onair: false }
          );
        } catch (error) {
          logger.error('Failed to update item onair status during clearAll', {
            itemId: graphic.itemId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Clear all pending removal timeouts
      for (const timeoutId of this.removalTimeouts.values()) {
        clearTimeout(timeoutId);
      }
      this.removalTimeouts.clear();

      // Clear the active graphics map
      this.activeGraphics.clear();
      // ...and stop every live poll (they used to keep running after Esc / clear all)
      await this.syncPolling();
      logger.info('All graphics cleared');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to clear graphics', { error: message });
      throw error;
    }
  }

  // ------------------------------------------------------------------------------------------
  // OGraf Server API (graphic instances loaded by external controllers)
  // ------------------------------------------------------------------------------------------

  /** Everything loaded on the program output, rundown items and API instances alike */
  listGraphicInstances(): { graphicInstanceId: string; templateId: string; source: 'rundown' | 'api'; isPlaying: boolean }[] {
    return Array.from(this.activeGraphics.values()).map(g => ({
      graphicInstanceId: g.id,
      templateId: g.templateId,
      source: g.source ?? 'rundown',
      isPlaying: g.isPlaying
    }));
  }

  /** Load a template onto the program output for an external controller */
  async apiLoad(templateId: string, data: unknown): Promise<{ graphicInstanceId: string; statusCode: number; statusMessage?: string }> {
    const template = getTemplateManager().getAllTemplates().find(t => t.manifest.id === templateId);
    if (!template) throw Object.assign(new Error(`Graphic not found: ${templateId}`), { httpStatus: 404 });
    const graphicInstanceId = `ograf-api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const result: any = await this.sendCommand('load', {
      id: graphicInstanceId,
      manifest: template.manifest,
      templateId: template.directoryName,
      data: data ?? {}
    });
    this.activeGraphics.set(graphicInstanceId, {
      id: graphicInstanceId,
      source: 'api',
      projectId: '',
      rundownId: '',
      itemId: '',
      templateId,
      isPlaying: false,
      manifest: template.manifest,
      templateDirectoryName: template.directoryName,
      data: data ?? {},
      currentStep: 0
    });
    return { graphicInstanceId, statusCode: 200, statusMessage: result?.message };
  }

  private requireApiInstance(graphicInstanceId: string): ActiveGraphic {
    const g = this.activeGraphics.get(graphicInstanceId);
    if (!g) throw Object.assign(new Error(`GraphicInstance not found: ${graphicInstanceId}`), { httpStatus: 404 });
    if (g.source !== 'api') {
      throw Object.assign(new Error('This GraphicInstance belongs to an Split Control rundown item; control it from the rundown'), { httpStatus: 409 });
    }
    return g;
  }

  async apiPlay(graphicInstanceId: string, params: { delta?: number; goto?: number; skipAnimation?: boolean } = {}) {
    const g = this.requireApiInstance(graphicInstanceId);
    const result: any = await this.sendCommand('play', { id: graphicInstanceId, options: params });
    g.isPlaying = true;
    g.currentStep = stepFromPlayResult(result);
    return { graphicInstanceId, statusCode: result?.result?.statusCode ?? 200, statusMessage: result?.result?.message, currentStep: g.currentStep };
  }

  async apiStop(graphicInstanceId: string, params: { skipAnimation?: boolean } = {}) {
    const g = this.requireApiInstance(graphicInstanceId);
    await this.sendCommand('stop', { id: graphicInstanceId, skipAnimation: params.skipAnimation ?? false });
    g.isPlaying = false;
    return { graphicInstanceId, statusCode: 200 };
  }

  async apiUpdate(graphicInstanceId: string, params: { data: unknown; skipAnimation?: boolean }) {
    const g = this.requireApiInstance(graphicInstanceId);
    await this.sendCommand('update', { id: graphicInstanceId, data: params.data, skipAnimation: params.skipAnimation });
    g.data = params.data;
    return { graphicInstanceId, statusCode: 200 };
  }

  async apiCustomAction(graphicInstanceId: string, actionId: string, params: { payload: unknown; skipAnimation?: boolean }) {
    this.requireApiInstance(graphicInstanceId);
    await this.sendCommand('custom', { id: graphicInstanceId, actionId, payload: params.payload, skipAnimation: params.skipAnimation });
    return { graphicInstanceId, statusCode: 200 };
  }

  /**
   * Clear (remove) instances matching any filter (all when no filters).
   * Rundown items are stopped through the rundown so their on-air state stays correct.
   */
  async apiClear(filters: { graphicId?: string; graphicInstanceId?: string }[]): Promise<string[]> {
    const matches = (g: ActiveGraphic) => filters.length === 0 || filters.some(f =>
      (!f.graphicId || f.graphicId === g.templateId) && (!f.graphicInstanceId || f.graphicInstanceId === g.id));
    const cleared: string[] = [];
    for (const g of Array.from(this.activeGraphics.values())) {
      if (!matches(g)) continue;
      if (g.source === 'api') {
        await this.sendCommand('dispose', { id: g.id });
        this.activeGraphics.delete(g.id);
      } else if (g.isPlaying) {
        await this.stopItem(g.projectId, g.rundownId, g.itemId);
      } else {
        continue;
      }
      cleared.push(g.id);
    }
    return cleared;
  }

  /**
   * Get active graphics
   */
  getActiveGraphics(): ActiveGraphic[] {
    return Array.from(this.activeGraphics.values());
  }

  /**
   * Send command to graphics renderer via WebSocket and wait for response
   */
  private async sendCommand(command: string, payload: any): Promise<any> {
    if (!this.wsServer) {
      throw new Error('WebSocket server not attached to playback engine');
    }

    // Normalize graphicId to empty string if undefined (for commands like 'clear')
    const graphicId = payload.id || '';
    const commandKey = `${command}:${graphicId}`;
    // Unique per command: two quick page turns on one graphic must not share a waiting slot
    const responseKey = `${commandKey}#${++this.requestSeq}`;

    // Critical commands that need confirmation (only critical commands are tracked)
    const criticalCommands = ['load', 'play'];
    const requireResponse = criticalCommands.includes(command);

    // Get number of connected graphics renderers in the program-output room
    const programRoomClientCount = this.wsServer.getRoomClientCount(SocketRoom.PROGRAM_OUTPUT);
    const expectedResponses = Math.max(1, programRoomClientCount); // At least 1 response expected

    logger.info('Sending graphics command to program-output room', {
      command,
      graphicId: graphicId || '(none)',
      programRoomClients: programRoomClientCount,
      expectedResponses,
      requireResponse
    });

    // Fire-and-forget for non-critical commands
    if (!requireResponse) {
      this.wsServer.broadcastToRoom(SocketRoom.PROGRAM_OUTPUT, {
        spxcmd: 'graphics:command',
        command,
        payload
      });
      logger.info('Fire-and-forget command sent to program-output room', { command, graphicId });
      return { success: true, message: 'Command sent (no response expected)' };
    }

    // Create promise for response (only for critical commands)
    const responsePromise = new Promise((resolve, reject) => {
      // Increased timeouts: 10s for load (was 5s), 5s for others (was 2s)
      const timeoutMs = command === 'load' ? 10000 : 5000;
      const timeout = setTimeout(() => {
        const pending = this.pendingResponses.get(responseKey);
        this.pendingResponses.delete(responseKey);

        // Track this command as timed out to suppress late response warnings
        this.timedOutCommands.add(responseKey);
        // Clean up after 10 seconds to prevent memory leak
        setTimeout(() => this.timedOutCommands.delete(responseKey), 10000);

        if (pending && pending.responses.length > 0) {
          // We got some responses but not all - check if any failed
          const failedResponse = pending.responses.find(r => !r?.success);

          // For critical commands, any failure is a problem
          if (criticalCommands.includes(command) && failedResponse) {
            logger.error('Graphics command failed on at least one renderer', {
              command,
              graphicId,
              error: failedResponse.error,
              receivedCount: pending.responses.length,
              expectedCount: pending.expectedCount
            });
            reject(new Error(failedResponse.error || 'Graphics command failed'));
          } else {
            // Partial success is OK (be forgiving)
            logger.debug('Graphics command completed with partial success', {
              command,
              graphicId,
              receivedCount: pending.responses.length,
              expectedCount: pending.expectedCount
            });
            resolve(pending.responses.find(r => r?.success) || pending.responses[0]);
          }
        } else {
          const idStr = graphicId ? ` ${graphicId}` : '';
          logger.error('Graphics command timeout - no responses received', {
            command,
            graphicId,
            expectedCount: pending?.expectedCount || 0
          });

          // Provide actionable error message based on command type
          let errorMsg = `Graphics command timeout: ${command}${idStr}`;
          if (command === 'load') {
            errorMsg = `Graphic failed to load (timeout after 10s). Check if template is valid and graphics output is running.`;
          } else if (command === 'play') {
            errorMsg = `Graphic failed to play (timeout after 5s). Check graphics output window.`;
          }
          reject(new Error(errorMsg));
        }
      }, timeoutMs);

      // CRITICAL: Register pending response BEFORE broadcasting command
      // to avoid race condition where response arrives before registration
      this.pendingResponses.set(responseKey, {
        key: commandKey,
        resolve,
        reject,
        timeout,
        responses: [],
        expectedCount: expectedResponses
      });
    });

    // Broadcast command to program-output room only (Graphics Window, Web Output, Program Preview)
    // IMPORTANT: This must happen AFTER registering the pending response above
    logger.info('Broadcasting graphics command to program-output room', {
      command,
      graphicId,
      spxcmd: 'graphics:command',
      room: SocketRoom.PROGRAM_OUTPUT
    });
    this.wsServer.broadcastToRoom(SocketRoom.PROGRAM_OUTPUT, {
      spxcmd: 'graphics:command',
      command,
      payload: { ...payload, requestId: responseKey }
    });

    // Wait for response from graphics renderer
    try {
      const result = await responsePromise;
      logger.debug('Graphics command completed', { command, graphicId, result });
      return result;
    } catch (error) {
      logger.error('Graphics command failed', {
        command,
        graphicId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

/**
 * Active graphic state
 * Extended to include full state for syncing to new renderers
 */
interface ActiveGraphic {
  id: string;
  /** 'api' = loaded through the OGraf Server API (no rundown item behind it) */
  source?: 'rundown' | 'api';
  projectId: string;
  rundownId: string;
  itemId: string;
  templateId: string;
  isPlaying: boolean;
  /** Screen zone of the graphic (template manifest v_olgrafik_zone) */
  zone?: GraphicZone;
  // Full state for syncing to new renderers
  manifest?: any;
  templateDirectoryName?: string;
  data?: any;
  currentStep?: number;
  totalSteps?: number;
  /** Live updates are held for this graphic and newer results have arrived */
  newData?: boolean;
}

/** Graphics show clubs by the club name library's names, else their short names from the club lists */
function shortClubNames(data: Record<string, any>, overrides: Record<string, string>): Record<string, any> {
  const clubs = getClubLogoService();
  const name = (club: string) => (clubs ? clubs.shortName(club, overrides) : shortClubName(club, overrides)) ?? club;
  const out = { ...data };
  if (Array.isArray(data.results)) out.results = data.results.map((r: any) => (r?.club ? { ...r, club: name(r.club) } : r));
  if (typeof data.runnerClub === 'string') out.runnerClub = name(data.runnerClub);
  return out;
}

/** What a graphic shows from live data, for telling whether held data is out of date */
function shownResults(data: any, withSplits: boolean): string {
  return JSON.stringify((data?.results ?? []).map((r: any) => [r.name, r.club, r.position, r.time, r.diff, r.statusCode, withSplits ? r.splitTimes : 0]));
}

// Singleton instance
let playbackEngine: PlaybackEngine | null = null;

/**
 * Initialize playback engine
 */
export function initPlaybackEngine(): PlaybackEngine {
  if (!playbackEngine) {
    playbackEngine = new PlaybackEngine();
  }
  return playbackEngine;
}

/**
 * Get playback engine instance
 */
export function getPlaybackEngine(): PlaybackEngine {
  if (!playbackEngine) {
    throw new Error('Playback engine not initialized');
  }
  return playbackEngine;
}

