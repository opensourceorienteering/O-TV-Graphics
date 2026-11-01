/**
 * Project Manager
 * Manages projects (events) and their rundowns on disk
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../utils/logger';
import { getConfig } from '../utils/config';
import {
  DEFAULT_TEMPLATE_SET,
  LEGACY_TEMPLATE_SET,
  SPXProject,
  SPXProjectListItem,
  SPXProjectVariable
} from '../../shared/types/spx';

const logger = getLogger();

/**
 * Project creation options
 */
export interface CreateProjectOptions {
  name: string;
  description?: string;
  variables?: SPXProjectVariable[];
  /** Template set for the project (default "classic") */
  templateSet?: string;
  settings?: SPXProject['settings'];
}

/**
 * Project Manager
 * Handles CRUD operations for projects
 */
export class ProjectManager {
  private projectsDir: string;

  constructor(projectsDir?: string) {
    const config = getConfig();
    this.projectsDir = projectsDir || path.join(config.general.dataroot, 'projects');
    this.ensureProjectsDirectory();
  }

  /**
   * Ensure projects directory exists
   */
  private ensureProjectsDirectory(): void {
    if (!fs.existsSync(this.projectsDir)) {
      fs.mkdirSync(this.projectsDir, { recursive: true });
      logger.info('Projects directory created', { path: this.projectsDir });
    }
  }

  /**
   * Get project directory path
   */
  private getProjectDir(projectId: string): string {
    return path.join(this.projectsDir, projectId);
  }

  /**
   * Get project file path
   */
  private getProjectFilePath(projectId: string): string {
    return path.join(this.getProjectDir(projectId), 'project.json');
  }

  /**
   * Create a new project
   */
  async createProject(options: CreateProjectOptions): Promise<SPXProject> {
    const projectId = uuidv4();
    const now = Date.now();

    const project: SPXProject = {
      id: projectId,
      name: options.name,
      description: options.description,
      created: now,
      modified: now,
      variables: options.variables || [],
      customControls: [],
      templateSet: options.templateSet || DEFAULT_TEMPLATE_SET,
      settings: {
        defaultLayer: '1',
        defaultOut: 'animate',
        autoSave: true,
        ...options.settings
      }
    };

    try {
      // Create project directory
      const projectDir = this.getProjectDir(projectId);
      fs.mkdirSync(projectDir, { recursive: true });

      // Create rundowns subdirectory
      const rundownsDir = path.join(projectDir, 'rundowns');
      fs.mkdirSync(rundownsDir, { recursive: true });

      // Save project file
      await this.saveProject(project);

      logger.info('Project created', { projectId, name: project.name });
      return project;

    } catch (error) {
      logger.error('Failed to create project', { error, projectId, name: options.name });
      throw new Error(`Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Load a project by ID
   */
  async loadProject(projectId: string): Promise<SPXProject> {
    try {
      const projectPath = this.getProjectFilePath(projectId);

      if (!fs.existsSync(projectPath)) {
        throw new Error(`Project not found: ${projectId}`);
      }

      const content = fs.readFileSync(projectPath, 'utf-8');
      const project: SPXProject = JSON.parse(content);
      // Projects from before template sets used the original (classic) graphics
      if (!project.templateSet) project.templateSet = LEGACY_TEMPLATE_SET;

      logger.debug('Project loaded', { projectId, name: project.name });
      return project;

    } catch (error) {
      logger.error('Failed to load project', { error, projectId });
      throw new Error(`Failed to load project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Save a project
   */
  async saveProject(project: SPXProject): Promise<void> {
    try {
      // Update modified timestamp
      project.modified = Date.now();

      const projectPath = this.getProjectFilePath(project.id);
      const content = JSON.stringify(project, null, 2);

      fs.writeFileSync(projectPath, content, 'utf-8');

      logger.debug('Project saved', { projectId: project.id, name: project.name });

    } catch (error) {
      logger.error('Failed to save project', { error, projectId: project.id });
      throw new Error(`Failed to save project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update project metadata
   */
  async updateProject(projectId: string, updates: Partial<SPXProject>): Promise<SPXProject> {
    try {
      const project = await this.loadProject(projectId);

      // Apply updates (excluding id, created)
      const { id, created, ...allowedUpdates } = updates;
      Object.assign(project, allowedUpdates);

      await this.saveProject(project);

      logger.info('Project updated', { projectId, updates: Object.keys(allowedUpdates) });
      return project;

    } catch (error) {
      logger.error('Failed to update project', { error, projectId });
      throw new Error(`Failed to update project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a project
   */
  async deleteProject(projectId: string): Promise<void> {
    try {
      const projectDir = this.getProjectDir(projectId);

      if (!fs.existsSync(projectDir)) {
        throw new Error(`Project not found: ${projectId}`);
      }

      // Delete project directory recursively
      fs.rmSync(projectDir, { recursive: true, force: true });

      logger.info('Project deleted', { projectId });

    } catch (error) {
      logger.error('Failed to delete project', { error, projectId });
      throw new Error(`Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List all projects
   */
  async listProjects(): Promise<SPXProjectListItem[]> {
    try {
      if (!fs.existsSync(this.projectsDir)) {
        return [];
      }

      const entries = fs.readdirSync(this.projectsDir, { withFileTypes: true });
      const projects: SPXProjectListItem[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const project = await this.loadProject(entry.name);
            
            // Count rundowns
            const rundownsDir = path.join(this.getProjectDir(project.id), 'rundowns');
            let rundownCount = 0;
            if (fs.existsSync(rundownsDir)) {
              const rundownFiles = fs.readdirSync(rundownsDir).filter(f => f.endsWith('.json'));
              rundownCount = rundownFiles.length;
            }

            projects.push({
              id: project.id,
              name: project.name,
              description: project.description,
              created: project.created,
              modified: project.modified,
              rundownCount,
              templateSet: project.templateSet
            });
          } catch (error) {
            logger.warn('Failed to load project in list', { projectId: entry.name, error });
          }
        }
      }

      // Sort by modified date (newest first)
      projects.sort((a, b) => b.modified - a.modified);

      logger.debug('Projects listed', { count: projects.length });
      return projects;

    } catch (error) {
      logger.error('Failed to list projects', { error });
      throw new Error(`Failed to list projects: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if project exists
   */
  projectExists(projectId: string): boolean {
    const projectPath = this.getProjectFilePath(projectId);
    return fs.existsSync(projectPath);
  }

  /**
   * Get rundowns directory for a project
   */
  getRundownsDir(projectId: string): string {
    return path.join(this.getProjectDir(projectId), 'rundowns');
  }
}

// Singleton instance
let projectManager: ProjectManager | null = null;

/**
 * Initialize project manager
 */
export function initProjectManager(projectsDir?: string): ProjectManager {
  if (!projectManager) {
    projectManager = new ProjectManager(projectsDir);
    logger.info('Project manager initialized');
  }
  return projectManager;
}

/**
 * Get project manager instance
 */
export function getProjectManager(): ProjectManager {
  if (!projectManager) {
    throw new Error('Project manager not initialized. Call initProjectManager() first.');
  }
  return projectManager;
}

