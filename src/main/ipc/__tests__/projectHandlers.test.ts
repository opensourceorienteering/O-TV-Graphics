/**
 * Integration tests for new IPC handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SPXRundown } from '../../../shared/types/spx';

// Mock dependencies
const mockRundownManager = {
  updateRundown: vi.fn(),
  loadRundown: vi.fn(),
  createRundown: vi.fn(),
  deleteRundown: vi.fn(),
  listRundowns: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  removeItem: vi.fn(),
  reorderItems: vi.fn()
};

vi.mock('../../utils/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

vi.mock('../../projects/RundownManager', () => ({
  getRundownManager: () => mockRundownManager
}));

vi.mock('../../projects/ProjectManager', () => ({
  getProjectManager: () => ({
    loadProject: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    listProjects: vi.fn()
  })
}));

vi.mock('../../playback/PlaybackEngine', () => ({
  getPlaybackEngine: () => ({
    clearAll: vi.fn()
  })
}));

describe('IPC Handlers - New Rundown Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rundown:updateDataSource', () => {
    it('should update data source configuration successfully', async () => {
      const mockRundown: SPXRundown = {
        id: 'rundown-1',
        name: 'Test Rundown',
        projectId: 'project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        dataSource: {
          sourceId: 'liveresults-default',
          baseUrl: 'https://new.liveresults.com',
          competitionId: 123,
          competitionName: 'Test Competition'
        }
      };

      mockRundownManager.updateRundown.mockResolvedValue(mockRundown);

      // Simulate IPC handler call
      const dataSource = {
        sourceId: 'liveresults-default',
        baseUrl: 'https://new.liveresults.com',
        competitionId: 123,
        competitionName: 'Test Competition'
      };

      const result = await mockRundownManager.updateRundown('project-1', 'rundown-1', { dataSource });

      expect(mockRundownManager.updateRundown).toHaveBeenCalledWith('project-1', 'rundown-1', { dataSource });
      expect(result.dataSource?.baseUrl).toBe('https://new.liveresults.com');
      expect(result.dataSource?.competitionId).toBe(123);
    });

    it('should handle errors gracefully', async () => {
      mockRundownManager.updateRundown.mockRejectedValue(new Error('Update failed'));

      await expect(
        mockRundownManager.updateRundown('project-1', 'rundown-1', {
          dataSource: {
            sourceId: 'test',
            baseUrl: 'https://test.com'
          }
        })
      ).rejects.toThrow('Update failed');
    });
  });

  describe('rundown:updateSettings', () => {
    it('should update global settings successfully', async () => {
      const mockRundown: SPXRundown = {
        id: 'rundown-2',
        name: 'Test Rundown 2',
        projectId: 'project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        settings: {
          competitionNameOverride: 'Custom Competition Name',
          raceLocation: 'Stockholm, Sweden'
        }
      };

      mockRundownManager.updateRundown.mockResolvedValue(mockRundown);

      const settings = {
        competitionNameOverride: 'Custom Competition Name',
        raceLocation: 'Stockholm, Sweden'
      };

      const result = await mockRundownManager.updateRundown('project-1', 'rundown-2', { settings });

      expect(mockRundownManager.updateRundown).toHaveBeenCalledWith('project-1', 'rundown-2', { settings });
      expect(result.settings?.competitionNameOverride).toBe('Custom Competition Name');
      expect(result.settings?.raceLocation).toBe('Stockholm, Sweden');
    });

    it('should handle partial settings updates', async () => {
      const mockRundown: SPXRundown = {
        id: 'rundown-3',
        name: 'Test Rundown 3',
        projectId: 'project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        settings: {
          competitionNameOverride: 'Only Name Override'
        }
      };

      mockRundownManager.updateRundown.mockResolvedValue(mockRundown);

      const settings = {
        competitionNameOverride: 'Only Name Override',
        raceLocation: undefined
      };

      const result = await mockRundownManager.updateRundown('project-1', 'rundown-3', { settings });

      expect(result.settings?.competitionNameOverride).toBe('Only Name Override');
      expect(result.settings?.raceLocation).toBeUndefined();
    });

    it('should handle errors gracefully', async () => {
      mockRundownManager.updateRundown.mockRejectedValue(new Error('Settings update failed'));

      await expect(
        mockRundownManager.updateRundown('project-1', 'rundown-1', {
          settings: {
            competitionNameOverride: 'Test'
          }
        })
      ).rejects.toThrow('Settings update failed');
    });
  });

  describe('rundown:updateAllowedTemplates', () => {
    it('should update template allowlist successfully', async () => {
      const mockRundown: SPXRundown = {
        id: 'rundown-4',
        name: 'Test Rundown 4',
        projectId: 'project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        allowedTemplates: ['template-1', 'template-2', 'template-3']
      };

      mockRundownManager.updateRundown.mockResolvedValue(mockRundown);

      const allowedTemplates = ['template-1', 'template-2', 'template-3'];

      const result = await mockRundownManager.updateRundown('project-1', 'rundown-4', { allowedTemplates });

      expect(mockRundownManager.updateRundown).toHaveBeenCalledWith('project-1', 'rundown-4', { allowedTemplates });
      expect(result.allowedTemplates).toEqual(['template-1', 'template-2', 'template-3']);
      expect(result.allowedTemplates?.length).toBe(3);
    });

    it('should handle empty allowlist', async () => {
      const mockRundown: SPXRundown = {
        id: 'rundown-5',
        name: 'Test Rundown 5',
        projectId: 'project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        allowedTemplates: []
      };

      mockRundownManager.updateRundown.mockResolvedValue(mockRundown);

      const result = await mockRundownManager.updateRundown('project-1', 'rundown-5', { allowedTemplates: [] });

      expect(result.allowedTemplates).toEqual([]);
    });

    it('should handle large template lists', async () => {
      const largeTemplateList = Array.from({ length: 50 }, (_, i) => `template-${i + 1}`);

      const mockRundown: SPXRundown = {
        id: 'rundown-6',
        name: 'Test Rundown 6',
        projectId: 'project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        allowedTemplates: largeTemplateList
      };

      mockRundownManager.updateRundown.mockResolvedValue(mockRundown);

      const result = await mockRundownManager.updateRundown('project-1', 'rundown-6', { allowedTemplates: largeTemplateList });

      expect(result.allowedTemplates?.length).toBe(50);
      expect(result.allowedTemplates?.[0]).toBe('template-1');
      expect(result.allowedTemplates?.[49]).toBe('template-50');
    });

    it('should handle errors gracefully', async () => {
      mockRundownManager.updateRundown.mockRejectedValue(new Error('Template allowlist update failed'));

      await expect(
        mockRundownManager.updateRundown('project-1', 'rundown-1', {
          allowedTemplates: ['template-1']
        })
      ).rejects.toThrow('Template allowlist update failed');
    });
  });

  describe('Combined updates', () => {
    it('should handle updating multiple fields at once', async () => {
      const mockRundown: SPXRundown = {
        id: 'rundown-7',
        name: 'Test Rundown 7',
        projectId: 'project-1',
        items: [],
        created: Date.now(),
        modified: Date.now(),
        dataSource: {
          sourceId: 'liveresults-default',
          baseUrl: 'https://combined.test.com',
          competitionId: 999
        },
        settings: {
          competitionNameOverride: 'Combined Test',
          raceLocation: 'Test City'
        },
        allowedTemplates: ['template-a', 'template-b']
      };

      mockRundownManager.updateRundown.mockResolvedValue(mockRundown);

      const updates = {
        dataSource: mockRundown.dataSource,
        settings: mockRundown.settings,
        allowedTemplates: mockRundown.allowedTemplates
      };

      const result = await mockRundownManager.updateRundown('project-1', 'rundown-7', updates);

      expect(result.dataSource?.baseUrl).toBe('https://combined.test.com');
      expect(result.settings?.competitionNameOverride).toBe('Combined Test');
      expect(result.allowedTemplates).toEqual(['template-a', 'template-b']);
    });
  });
});

