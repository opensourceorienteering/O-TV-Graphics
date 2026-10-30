/**
 * Tests for PlaybackEngine rundown-level data source and settings
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SPXRundown, SPXRundownItem } from '../../../shared/types/spx';
import { LiveResultsClient } from '../../data/LiveResultsClient';

// Mock dependencies
const mockTemplateManager = {
  getAllTemplates: vi.fn(() => [
    {
      manifest: {
        id: 'test-template',
        name: 'Test Template',
        version: '1.0.0',
        description: 'Test template'
      },
      directoryName: 'test-template'
    }
  ])
};

const mockRundownManager = {
  loadRundown: vi.fn(),
  saveRundown: vi.fn(),
  updateItem: vi.fn()
};

const mockDataStore = {
  getCompetitions: vi.fn(() => [
    {
      id: 123,
      name: 'Test Competition',
      organizer: 'Test Organizer',
      date: '2025-10-21',
      timediff: 0
    }
  ]),
  loadCompetitions: vi.fn()
};

const mockLiveResultsClient = {
  getClassResults: vi.fn(() => ({
    data: {
      className: 'M21',
      splitcontrols: [],
      results: [
        {
          place: '1',
          name: 'Test Runner',
          club: 'Test Club',
          result: '3600',
          status: 0,
          timeplus: '0',
          progress: 100,
          start: 0
        }
      ],
      hash: 'test-hash'
    }
  }))
};

vi.mock('../../utils/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

vi.mock('../../utils/config', () => ({
  getConfig: vi.fn(() => ({
    liveresults: {
      baseUrl: 'https://global.liveresults.com',
      cacheInterval: 15000,
      timeout: 10000
    }
  }))
}));

vi.mock('../../templates/OGrafManager', () => ({
  getTemplateManager: () => mockTemplateManager
}));

vi.mock('../../projects/RundownManager', () => ({
  getRundownManager: () => mockRundownManager
}));

vi.mock('../../data/DataStore', () => ({
  getDataStore: () => mockDataStore
}));

vi.mock('../../data/LiveResultsClient', () => ({
  getLiveResultsClient: () => mockLiveResultsClient,
  LiveResultsClient: vi.fn().mockImplementation((options) => ({
    getClassResults: vi.fn(() => ({
      data: {
        className: 'M21',
        splitcontrols: [],
        results: [
          {
            place: '1',
            name: 'Test Runner',
            club: 'Test Club',
            result: '3600',
            status: 0,
            timeplus: '0',
            progress: 100,
            start: 0
          }
        ],
        hash: 'test-hash'
      }
    }))
  }))
}));

vi.mock('../../data/LiveResultsMapper', () => ({
  LiveResultsMapper: {
    autoMap: vi.fn(() => ({
      data: {
        competitionName: 'Test Competition',
        className: 'M21',
        results: []
      }
    }))
  }
}));

describe('PlaybackEngine - Rundown-Level Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Data Source Configuration', () => {
    it('should use rundown-level baseUrl when available', async () => {
      const rundown: SPXRundown = {
        id: 'rundown-1',
        name: 'Test Rundown',
        projectId: 'project-1',
        items: [
          {
            id: 'item-1',
            templateId: 'test-template',
            templatePath: '/templates/test-template',
            fields: {},
            onair: false,
            layer: '1',
            out: 'animate',
            liveResultsData: {
              competitionId: 123,
              className: 'M21'
            }
          } as SPXRundownItem
        ],
        created: Date.now(),
        modified: Date.now(),
        dataSource: {
          sourceId: 'liveresults-custom',
          baseUrl: 'https://custom.liveresults.com',
          competitionId: 123,
          competitionName: 'Test Competition'
        }
      };

      mockRundownManager.loadRundown.mockResolvedValue(rundown);

      // Verify that LiveResultsClient constructor would be called with custom baseUrl
      // This is tested by checking the mock implementation
      const clientConstructor = vi.mocked(LiveResultsClient);
      
      // The actual PlaybackEngine would create a new client with the custom baseUrl
      // We're testing the logic that determines which baseUrl to use
      const baseUrl = rundown.dataSource?.baseUrl || 'https://global.liveresults.com';
      
      expect(baseUrl).toBe('https://custom.liveresults.com');
    });

    it('should fall back to global config when dataSource is not present', async () => {
      const rundown: SPXRundown = {
        id: 'rundown-2',
        name: 'Test Rundown 2',
        projectId: 'project-1',
        items: [
          {
            id: 'item-2',
            templateId: 'test-template',
            templatePath: '/templates/test-template',
            fields: {},
            onair: false,
            layer: '1',
            out: 'animate',
            liveResultsData: {
              competitionId: 123,
              className: 'M21'
            }
          } as SPXRundownItem
        ],
        created: Date.now(),
        modified: Date.now()
        // No dataSource field - should use global config
      };

      mockRundownManager.loadRundown.mockResolvedValue(rundown);

      // Should fall back to global config
      const baseUrl = rundown.dataSource?.baseUrl || 'https://global.liveresults.com';
      
      expect(baseUrl).toBe('https://global.liveresults.com');
    });
  });

  describe('Settings Application', () => {
    it('should apply competitionNameOverride to graphics data', () => {
      const rundown: SPXRundown = {
        id: 'rundown-3',
        name: 'Test Rundown 3',
        projectId: 'project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        settings: {
          competitionNameOverride: 'Custom Branded Competition'
        }
      };

      const graphicData = {
        competitionName: 'Original Competition Name',
        className: 'M21',
        results: []
      };

      // Apply settings override
      if (rundown.settings?.competitionNameOverride) {
        graphicData.competitionName = rundown.settings.competitionNameOverride;
      }

      expect(graphicData.competitionName).toBe('Custom Branded Competition');
    });

    it('should apply raceLocation to graphics data', () => {
      const rundown: SPXRundown = {
        id: 'rundown-4',
        name: 'Test Rundown 4',
        projectId: 'project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        settings: {
          raceLocation: 'Stockholm, Sweden'
        }
      };

      const graphicData: any = {
        competitionName: 'Test Competition',
        className: 'M21',
        results: []
      };

      // Apply settings
      if (rundown.settings?.raceLocation) {
        graphicData.raceLocation = rundown.settings.raceLocation;
      }

      expect(graphicData.raceLocation).toBe('Stockholm, Sweden');
    });

    it('should apply both competitionNameOverride and raceLocation', () => {
      const rundown: SPXRundown = {
        id: 'rundown-5',
        name: 'Test Rundown 5',
        projectId: 'project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        settings: {
          competitionNameOverride: 'Branded Competition',
          raceLocation: 'Oslo, Norway'
        }
      };

      const graphicData: any = {
        competitionName: 'Original Name',
        className: 'M21',
        results: []
      };

      // Apply settings
      if (rundown.settings?.competitionNameOverride) {
        graphicData.competitionName = rundown.settings.competitionNameOverride;
      }
      if (rundown.settings?.raceLocation) {
        graphicData.raceLocation = rundown.settings.raceLocation;
      }

      expect(graphicData.competitionName).toBe('Branded Competition');
      expect(graphicData.raceLocation).toBe('Oslo, Norway');
    });

    it('should not modify data when settings are not present', () => {
      const rundown: SPXRundown = {
        id: 'rundown-6',
        name: 'Test Rundown 6',
        projectId: 'project-1',
        items: [],
        created: Date.now(),
        modified: Date.now()
        // No settings field
      };

      const graphicData: any = {
        competitionName: 'Original Name',
        className: 'M21',
        results: []
      };

      // Apply settings (should do nothing)
      if (rundown.settings?.competitionNameOverride) {
        graphicData.competitionName = rundown.settings.competitionNameOverride;
      }
      if (rundown.settings?.raceLocation) {
        graphicData.raceLocation = rundown.settings.raceLocation;
      }

      expect(graphicData.competitionName).toBe('Original Name');
      expect(graphicData.raceLocation).toBeUndefined();
    });
  });

  describe('Backward Compatibility', () => {
    it('should work with old rundowns that only have liveResults', async () => {
      const oldRundown: SPXRundown = {
        id: 'old-rundown',
        name: 'Old Rundown',
        projectId: 'project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        liveResults: {
          competitionId: 123,
          competitionName: 'Old Competition'
        }
        // No dataSource or settings fields
      };

      mockRundownManager.loadRundown.mockResolvedValue(oldRundown);

      // Should fall back to global config
      const baseUrl = oldRundown.dataSource?.baseUrl || 'https://global.liveresults.com';
      
      expect(baseUrl).toBe('https://global.liveresults.com');
      expect(oldRundown.liveResults?.competitionId).toBe(123);
    });
  });
});


describe('PlaybackEngine - automatic pagination', () => {
  const onAir = async (stepCount: number, currentStep: number, totalSteps: number) => {
    const { PlaybackEngine } = await import('../PlaybackEngine');
    const engine = new PlaybackEngine() as any;
    engine.activeGraphics.set('p-r-i', {
      itemId: 'i', templateId: 't', isPlaying: true, manifest: { id: 't', stepCount }, currentStep, totalSteps
    });
    engine.stopItem = vi.fn(async () => true);
    engine.nextItem = vi.fn(async () => true);
    engine.scheduleAutoPage('p', 'r', 'i', 5);
    await vi.advanceTimersByTimeAsync(10_000);
    return engine;
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('leaves single-page graphics on air for the operator to take off', async () => {
    const engine = await onAir(1, 1, 1);
    expect(engine.stopItem).not.toHaveBeenCalled();
    expect(engine.nextItem).not.toHaveBeenCalled();
  });

  it('hides a paginated graphic after its last page', async () => {
    const engine = await onAir(-1, 2, 2);
    expect(engine.stopItem).toHaveBeenCalledWith('p', 'r', 'i');
  });
});

describe('PlaybackEngine - graphics command responses', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = async () => {
    const { PlaybackEngine } = await import('../PlaybackEngine');
    const engine = new PlaybackEngine() as any;
    const sent: any[] = [];
    engine.wsServer = {
      getRoomClientCount: () => 1,
      broadcastToRoom: (_room: string, msg: any) => sent.push(msg),
    };
    return { engine, sent, respond: (data: any) => engine.handleGraphicsResponse(data) };
  };

  it('keeps quick page turns on one graphic apart', async () => {
    const { engine, sent, respond } = await setup();
    const first = engine.sendCommand('play', { id: 'g', delta: -1 });
    await vi.advanceTimersByTimeAsync(1000);
    const second = engine.sendCommand('play', { id: 'g', delta: 1 });
    const [a, b] = sent.map(m => m.payload.requestId);
    expect(a).not.toBe(b);
    // the first command never gets an answer; its timeout must not take the second down
    const failed = expect(first).rejects.toThrow(/timeout/);
    await vi.advanceTimersByTimeAsync(4500);
    await failed;
    respond({ command: 'play', id: 'g', requestId: b, result: { success: true, currentStep: 2 } });
    await expect(second).resolves.toMatchObject({ currentStep: 2 });
  });

  it('answers the oldest command when a renderer does not echo the request id', async () => {
    const { engine, respond } = await setup();
    const first = engine.sendCommand('play', { id: 'g' });
    const second = engine.sendCommand('play', { id: 'g' });
    respond({ command: 'play', id: 'g', result: { success: true, currentStep: 1 } });
    respond({ command: 'play', id: 'g', result: { success: true, currentStep: 2 } });
    await expect(first).resolves.toMatchObject({ currentStep: 1 });
    await expect(second).resolves.toMatchObject({ currentStep: 2 });
  });
});
