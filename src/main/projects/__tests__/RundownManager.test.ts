/**
 * Unit tests for RundownManager migration logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RundownManager } from '../RundownManager';
import { SPXRundown } from '../../../shared/types/spx';
import * as configModule from '../../utils/config';
import * as projectManagerModule from '../ProjectManager';

// Mock dependencies
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
      baseUrl: 'https://test.liveresults.com',
      cacheInterval: 15000,
      timeout: 10000
    }
  }))
}));

vi.mock('../ProjectManager', () => ({
  getProjectManager: vi.fn(() => ({
    getRundownsDir: vi.fn(() => '/test/rundowns'),
    projectExists: vi.fn(() => true)
  }))
}));

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
    readdirSync: vi.fn(() => [])
  }
}));

describe('RundownManager Migration Logic', () => {
  let rundownManager: RundownManager;

  beforeEach(() => {
    rundownManager = new RundownManager();
    vi.clearAllMocks();
  });

  describe('migrateRundown', () => {
    it('should migrate liveResults to dataSource', () => {
      const oldRundown: SPXRundown = {
        id: 'test-rundown-1',
        name: 'Test Rundown',
        projectId: 'test-project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        liveResults: {
          competitionId: 123,
          competitionName: 'Test Competition',
          autoUpdate: true,
          updateInterval: 15000
        }
      };

      // Access private method via type assertion
      const migratedRundown = (rundownManager as any).migrateRundown(oldRundown);

      // Migration keeps the competition but leaves the source empty so the UI asks the user to pick one
      expect(migratedRundown.dataSource).toBeDefined();
      expect(migratedRundown.dataSource?.sourceId).toBe('');
      expect(migratedRundown.dataSource?.baseUrl).toBe('');
      expect(migratedRundown.dataSource?.competitionId).toBe(123);
      expect(migratedRundown.dataSource?.competitionName).toBe('Test Competition');
    });

    it('should initialize empty allowedTemplates if not present', () => {
      const rundown: SPXRundown = {
        id: 'test-rundown-2',
        name: 'Test Rundown 2',
        projectId: 'test-project-1',
        items: [],
        created: Date.now(),
        modified: Date.now()
      };

      const migratedRundown = (rundownManager as any).migrateRundown(rundown);

      expect(migratedRundown.allowedTemplates).toBeDefined();
      expect(migratedRundown.allowedTemplates).toEqual([]);
    });

    it('should initialize empty settings if not present', () => {
      const rundown: SPXRundown = {
        id: 'test-rundown-3',
        name: 'Test Rundown 3',
        projectId: 'test-project-1',
        items: [],
        created: Date.now(),
        modified: Date.now()
      };

      const migratedRundown = (rundownManager as any).migrateRundown(rundown);

      expect(migratedRundown.settings).toBeDefined();
      expect(migratedRundown.settings).toEqual({});
    });

    it('should not overwrite existing dataSource', () => {
      const rundown: SPXRundown = {
        id: 'test-rundown-4',
        name: 'Test Rundown 4',
        projectId: 'test-project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        dataSource: {
          sourceId: 'custom-source',
          baseUrl: 'https://custom.api.com',
          competitionId: 456,
          competitionName: 'Custom Competition'
        },
        liveResults: {
          competitionId: 123,
          competitionName: 'Old Competition'
        }
      };

      const migratedRundown = (rundownManager as any).migrateRundown(rundown);

      // Should keep existing dataSource, not overwrite with liveResults
      expect(migratedRundown.dataSource?.sourceId).toBe('custom-source');
      expect(migratedRundown.dataSource?.baseUrl).toBe('https://custom.api.com');
      expect(migratedRundown.dataSource?.competitionId).toBe(456);
    });

    it('should not overwrite existing allowedTemplates', () => {
      const rundown: SPXRundown = {
        id: 'test-rundown-5',
        name: 'Test Rundown 5',
        projectId: 'test-project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        allowedTemplates: ['template-1', 'template-2']
      };

      const migratedRundown = (rundownManager as any).migrateRundown(rundown);

      expect(migratedRundown.allowedTemplates).toEqual(['template-1', 'template-2']);
    });

    it('should not overwrite existing settings', () => {
      const rundown: SPXRundown = {
        id: 'test-rundown-6',
        name: 'Test Rundown 6',
        projectId: 'test-project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        settings: {
          competitionNameOverride: 'Custom Name',
          raceLocation: 'Stockholm, Sweden'
        }
      };

      const migratedRundown = (rundownManager as any).migrateRundown(rundown);

      expect(migratedRundown.settings?.competitionNameOverride).toBe('Custom Name');
      expect(migratedRundown.settings?.raceLocation).toBe('Stockholm, Sweden');
    });

    it('should handle missing config gracefully', () => {
      // Mock getConfig to throw error
      vi.spyOn(configModule, 'getConfig').mockImplementationOnce(() => {
        throw new Error('Config not available');
      });

      const rundown: SPXRundown = {
        id: 'test-rundown-7',
        name: 'Test Rundown 7',
        projectId: 'test-project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        liveResults: {
          competitionId: 789,
          competitionName: 'Test Competition'
        }
      };

      const migratedRundown = (rundownManager as any).migrateRundown(rundown);

      // Migration does not depend on config: the base URL is chosen when the user selects a source
      expect(migratedRundown.dataSource).toBeDefined();
      expect(migratedRundown.dataSource?.baseUrl).toBe('');
      expect(migratedRundown.dataSource?.competitionId).toBe(789);
    });

    it('should handle rundown with all new fields already present', () => {
      const rundown: SPXRundown = {
        id: 'test-rundown-8',
        name: 'Test Rundown 8',
        projectId: 'test-project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        dataSource: {
          sourceId: 'liveresults-default',
          baseUrl: 'https://liveresultat.orientering.se',
          competitionId: 999,
          competitionName: 'Modern Competition'
        },
        settings: {
          competitionNameOverride: 'Branded Name',
          raceLocation: 'Oslo, Norway'
        },
        allowedTemplates: ['template-a', 'template-b', 'template-c']
      };

      const migratedRundown = (rundownManager as any).migrateRundown(rundown);

      // Should not modify anything
      expect(migratedRundown.dataSource).toEqual(rundown.dataSource);
      expect(migratedRundown.settings).toEqual(rundown.settings);
      expect(migratedRundown.allowedTemplates).toEqual(rundown.allowedTemplates);
    });
  });
});

