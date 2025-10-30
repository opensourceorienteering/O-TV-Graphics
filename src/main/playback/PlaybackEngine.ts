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

const logger = getLogger();

/**
 * Playback Engine class
 */
export class PlaybackEngine {
  private wsServer: WebSocketServer | null = null;
  private activeGraphics: Map<string, ActiveGraphic> = new Map();
  private removalTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private pendingResponses: Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    responses: any[];
    expectedCount: number;
  }> = new Map();
  // Track timed-out commands to suppress late response warnings
  private timedOutCommands: Set<string> = new Set();
  // Track in-progress play operations to prevent race conditions
  private playInProgress: Set<string> = new Set();

  constructor() {
    logger.info('Playback engine initialized');
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
    const responseKey = `${command}:${id}`;

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
   * Handle LiveResults update from DataStore
   * Automatically updates all active graphics that use this competition/class
   */
  private async handleLiveResultsUpdate(
    competitionId: number,
    className: string,
    ografData: OGrafResultsData
  ): Promise<void> {
    logger.debug('LiveResults update received', {
      competitionId,
      className,
      runners: ografData.results.length
    });

    // Find all active graphics using this competition/class with autoUpdate enabled
    let updatedCount = 0;
    for (const [graphicId, graphic] of this.activeGraphics) {
      // Get the rundown item to check autoUpdate setting
      try {
        const rundownManager = getRundownManager();
        const rundown = await rundownManager.loadRundown(graphic.projectId, graphic.rundownId);
        const item = rundown.items.find(i => i.id === graphic.itemId);

        if (!item) {
          logger.warn('Item not found for active graphic', { graphicId, itemId: graphic.itemId });
          continue;
        }

        // Check if this graphic uses this competition/class and has autoUpdate enabled
        if (item.liveResultsData?.autoUpdate &&
            item.liveResultsData?.competitionId === competitionId &&
            item.liveResultsData?.className === className) {

          logger.info('Auto-updating playing graphic', {
            graphicId,
            competitionId,
            className,
            isPlaying: graphic.isPlaying
          });

          try {
            // Prepare data for the graphic using field mappings
            const templateManager = getTemplateManager();
            const templates = templateManager.getAllTemplates();
            const template = templates.find((t) => t.manifest.id === item.templateId);

            if (!template || !template.dataSourceConfig) {
              logger.warn('Template or dataSourceConfig not found for auto-update', {
                graphicId,
                templateId: item.templateId
              });
              continue;
            }

            // Map the OGRAF data to template fields
            const mappedData = await DataSourceFieldMapper.fetchAndMapData(
              template.dataSourceConfig,
              competitionId,
              item.liveResultsData.dataSourceValues || {},
              rundown.settings,
              rundown.dataSource?.sourceId
            );

            // Log the data being sent in the update
            logger.info('=== PlaybackEngine: Auto-update data being sent ===', {
              graphicId,
              hasResults: !!mappedData.results,
              resultsCount: mappedData.results?.length || 0
            });

            // Log first 3 results to verify data integrity
            if (mappedData.results && mappedData.results.length > 0) {
              for (let i = 0; i < Math.min(3, mappedData.results.length); i++) {
                logger.info(`[PlaybackEngine Auto-Update] Result ${i + 1}`, {
                  position: mappedData.results[i].position,
                  name: mappedData.results[i].name,
                  time: mappedData.results[i].time,
                  timeType: typeof mappedData.results[i].time,
                  diff: mappedData.results[i].diff,
                  diffType: typeof mappedData.results[i].diff,
                  statusCode: mappedData.results[i].statusCode
                });
              }
            }

            // Send update command with fresh data
            await this.sendCommand('update', {
              id: graphicId,
              data: mappedData
            });

            // Update the stored data in active graphic
            graphic.data = mappedData;

            updatedCount++;
            logger.info('Graphic auto-updated successfully', { graphicId });
          } catch (error) {
            logger.error('Failed to auto-update graphic', {
              graphicId,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      } catch (error) {
        logger.error('Error checking graphic for auto-update', {
          graphicId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    if (updatedCount > 0) {
      logger.info('Auto-update complete', {
        competitionId,
        className,
        updatedGraphics: updatedCount
      });
    }
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

      // Generate unique graphic ID
      const graphicId = `${projectId}-${rundownId}-${itemId}`;

      // Prepare data for the graphic
      let graphicData = item.fields || {};

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

          // Use mapped data as graphic data
          graphicData = mappedData;

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
          manifest: template.manifest,
          templateDirectoryName: template.directoryName,
          data: graphicData,
          currentStep: 1
        });
      } else {
        logger.info('Graphic already loaded', { graphicId });
        // Graphic already loaded - update with fresh data if LiveResults is configured
        if (item.liveResultsData?.competitionId && item.liveResultsData?.className) {
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

      // Play the graphic
      logger.info('Sending play command', { graphicId });
      const playResult = await this.sendCommand('play', {
        id: graphicId,
        options: {
          skipAnimation: false
        }
      });

      // Update active graphic state
      const activeGraphic = this.activeGraphics.get(graphicId);
      const currentStep = playResult?.currentStep || 1;
      if (activeGraphic) {
        activeGraphic.isPlaying = true;
        activeGraphic.currentStep = currentStep;
      }

      // Update rundown item state with current step
      // The play command returns currentStep from the template
      await rundownManager.updateItem(projectId, rundownId, itemId, {
        onair: true,
        currentStep
      });

      logger.info('Rundown item playing', { itemId, graphicId, currentStep });

      // Start polling if autoUpdate is enabled
      if (item.liveResultsData?.autoUpdate &&
          item.liveResultsData?.competitionId &&
          item.liveResultsData?.className) {

        const dataStore = getDataStore();

        // Use standard polling interval (15 seconds)
        // Auto-update is now the standard for all API templates
        const interval = 15000;

        // Get the data source's client to ensure we poll the correct API
        let pollingClient = null;
        if (rundown.dataSource?.sourceId) {
          const { getDataSourceRegistry } = await import('../data/DataSourceRegistry');
          const registry = getDataSourceRegistry();
          const dataSource = registry.get(rundown.dataSource.sourceId);

          if (dataSource && 'getClient' in dataSource) {
            pollingClient = (dataSource as any).getClient();
            logger.info('Using data source client for polling', {
              dataSourceId: rundown.dataSource.sourceId,
              graphicId
            });
          }
        }

        dataStore.startPolling(
          item.liveResultsData.competitionId,
          item.liveResultsData.className,
          interval,
          pollingClient // Pass the data source's client
        );

        logger.info('Started auto-update polling', {
          graphicId,
          competitionId: item.liveResultsData.competitionId,
          className: item.liveResultsData.className,
          interval
        });
      }

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
      const activeGraphic = this.activeGraphics.get(graphicId);
      if (activeGraphic) {
        activeGraphic.isPlaying = false;
      }

      // Update rundown item state
      const rundownManager = getRundownManager();
      await rundownManager.updateItem(projectId, rundownId, itemId, {
        onair: false,
        currentStep: undefined // Clear current step when stopped
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

      // Stop polling if this was the last graphic using this competition/class
      // Reuse rundownManager from above
      const rundown = await rundownManager.loadRundown(projectId, rundownId);
      const item = rundown.items.find(i => i.id === itemId);

      if (item?.liveResultsData?.autoUpdate &&
          item.liveResultsData?.competitionId &&
          item.liveResultsData?.className) {

        const competitionId = item.liveResultsData.competitionId;
        const className = item.liveResultsData.className;

        // Check if any other active graphics are using this competition/class
        let otherGraphicsUsingData = false;
        for (const [otherGraphicId, otherGraphic] of this.activeGraphics) {
          if (otherGraphicId === graphicId) continue; // Skip the graphic we're stopping

          try {
            const otherRundown = await rundownManager.loadRundown(otherGraphic.projectId, otherGraphic.rundownId);
            const otherItem = otherRundown.items.find(i => i.id === otherGraphic.itemId);

            if (otherItem?.liveResultsData?.autoUpdate &&
                otherItem.liveResultsData?.competitionId === competitionId &&
                otherItem.liveResultsData?.className === className &&
                otherGraphic.isPlaying) {
              otherGraphicsUsingData = true;
              break;
            }
          } catch (error) {
            logger.warn('Error checking other graphic for polling', {
              otherGraphicId,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }

        // Only stop polling if no other graphics are using this data
        if (!otherGraphicsUsingData) {
          // Get the data source's client to stop polling on the correct client
          let pollingClient = null;
          if (rundown.dataSource?.sourceId) {
            const { getDataSourceRegistry } = await import('../data/DataSourceRegistry');
            const registry = getDataSourceRegistry();
            const dataSource = registry.get(rundown.dataSource.sourceId);

            if (dataSource && 'getClient' in dataSource) {
              pollingClient = (dataSource as any).getClient();
            }
          }

          const dataStore = getDataStore();
          dataStore.stopPolling(competitionId, className, pollingClient);
          logger.info('Stopped auto-update polling (no other graphics using this data)', {
            competitionId,
            className,
            usingDataSourceClient: !!pollingClient
          });
        } else {
          logger.debug('Keeping auto-update polling active (other graphics still using this data)', {
            competitionId,
            className
          });
        }
      }

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

      // Update the graphic
      await this.sendCommand('update', {
        id: graphicId,
        data
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
      const currentStep = playResult?.currentStep || 1;
      if (activeGraphic) {
        activeGraphic.currentStep = currentStep;
      }

      // Update rundown item with new current step
      const rundownManager = getRundownManager();
      await rundownManager.updateItem(projectId, rundownId, itemId, {
        currentStep
      });

      logger.info('Advanced to next step', { itemId, graphicId, currentStep });

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
      const currentStep = playResult?.currentStep || 1;
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
      logger.info('All graphics cleared');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to clear graphics', { error: message });
      throw error;
    }
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
    const responseKey = `${command}:${graphicId}`;

    // Critical commands that need confirmation (SPX-GC pattern: only track critical commands)
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

    // Fire-and-forget for non-critical commands (SPX-GC inspired)
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
            // Partial success is OK (SPX-GC style: be more forgiving)
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
      payload
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
  projectId: string;
  rundownId: string;
  itemId: string;
  templateId: string;
  isPlaying: boolean;
  // Full state for syncing to new renderers
  manifest?: any;
  templateDirectoryName?: string;
  data?: any;
  currentStep?: number;
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

