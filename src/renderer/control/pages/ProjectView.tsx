/**
 * Projects View Page
 * 3-Column Layout: Projects | Rundowns | Preferences
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderPlus,
  FilePlus,
  Trash2,
  Maximize2,
  ChevronDown,
  ChevronUp,
  BookOpen
} from 'lucide-react';
import {
  SPXProject,
  SPXProjectListItem,
  SPXRundown,
  SPXRundownListItem
} from '../../../shared/types/spx';
import { LiveResultsCompetition } from '../../../shared/types/liveresults';
import { DataSourceConfig } from '../../../shared/types/dataSource';
import { CompetitionSelector } from '../components/CompetitionSelector';
import { useToast } from '../contexts/ToastContext';
import { trackProjectAccess, trackRundownAccess } from '../utils/recentItems';

export function ProjectView() {
  const navigate = useNavigate();
  const toast = useToast();

  // State
  const [projects, setProjects] = useState<SPXProjectListItem[]>([]);
  const [selectedProject, setSelectedProject] = useState<SPXProject | null>(null);
  const [rundowns, setRundowns] = useState<SPXRundownListItem[]>([]);
  const [selectedRundown, setSelectedRundown] = useState<SPXRundown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataSources, setDataSources] = useState<DataSourceConfig[]>([]);
  const [selectedDataSourceId, setSelectedDataSourceId] = useState<string>('liveresults-default');

  // Modals
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateRundown, setShowCreateRundown] = useState(false);

  // Form state
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [rundownName, setRundownName] = useState('');

  // Rundown configuration state
  const [dataSourceBaseUrl, setDataSourceBaseUrl] = useState('');
  const [competitionNameOverride, setCompetitionNameOverride] = useState('');
  const [raceLocation, setRaceLocation] = useState('');
  const [availableTemplates, setAvailableTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);

  // Collapsible section state
  const [competitionSelectorExpanded, setCompetitionSelectorExpanded] = useState(false);
  const [templateSelectorExpanded, setTemplateSelectorExpanded] = useState(false);

  // Operation loading states
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingRundown, setCreatingRundown] = useState(false);
  const [updatingCompetition, setUpdatingCompetition] = useState(false);

  // Load projects and data sources on mount
  useEffect(() => {
    loadProjects();
    loadDataSources();
    loadTemplates();
  }, []);

  // Load rundowns when project selected
  useEffect(() => {
    if (selectedProject) {
      loadRundowns(selectedProject.id);
    } else {
      setRundowns([]);
      setSelectedRundown(null);
    }
  }, [selectedProject]);

  // Sync rundown configuration state when rundown selected
  useEffect(() => {
    if (selectedRundown) {
      // Sync data source configuration
      const sourceId = selectedRundown.dataSource?.sourceId || 'liveresults-default';
      setSelectedDataSourceId(sourceId);

      // Find the selected data source and set its base URL
      const dataSource = dataSources.find(ds => ds.id === sourceId);
      if (dataSource) {
        setDataSourceBaseUrl(dataSource.config.baseUrl || '');
      } else {
        // Fallback to rundown's stored baseUrl for backward compatibility
        setDataSourceBaseUrl(selectedRundown.dataSource?.baseUrl || '');
      }

      // Sync global settings
      setCompetitionNameOverride(selectedRundown.settings?.competitionNameOverride || '');
      setRaceLocation(selectedRundown.settings?.raceLocation || '');

      // Sync template allowlist
      setSelectedTemplates(selectedRundown.allowedTemplates || []);

      // Set collapsible section states based on whether data is configured
      // Competition selector: expanded if no competition selected, collapsed if selected
      const hasCompetition = !!(selectedRundown.dataSource?.competitionId || selectedRundown.liveResults?.competitionId);
      setCompetitionSelectorExpanded(!hasCompetition);

      // Template selector: collapsed by default
      setTemplateSelectorExpanded(false);
    } else {
      // Reset form state
      setSelectedDataSourceId('liveresults-default');
      setDataSourceBaseUrl('');
      setCompetitionNameOverride('');
      setRaceLocation('');
      setSelectedTemplates([]);
      setCompetitionSelectorExpanded(false);
      setTemplateSelectorExpanded(false);
    }
  }, [selectedRundown, dataSources]);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.invoke('project:list');
      if (result.success) {
        setProjects(result.data || []);
      } else {
        setError(result.error || 'Failed to load projects');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const loadRundowns = async (projectId: string) => {
    try {
      const result = await window.electronAPI.invoke('rundown:list', projectId);
      if (result.success) {
        setRundowns(result.data || []);
      } else {
        toast.error(`Failed to load rundowns: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to load rundowns: ${errorMessage}`);
    }
  };

  const loadDataSources = async () => {
    try {
      const result = await window.electronAPI.invoke('dataSource:getAll');
      if (result.success) {
        const sources = result.data || [];
        setDataSources(sources.filter((s: DataSourceConfig) => s.enabled));

        // Set default data source if available
        if (sources.length > 0 && sources[0].id) {
          setSelectedDataSourceId(sources[0].id);
        }
      } else {
        toast.error(`Failed to load data sources: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to load data sources: ${errorMessage}`);
    }
  };

  const loadTemplates = async () => {
    try {
      const result = await window.electronAPI.invoke('templates:getAll');
      if (result && result.success) {
        const templates = result.templates || [];
        setAvailableTemplates(templates.map((t: any) => ({
          id: t.manifest?.id || t.directoryName,
          name: t.manifest?.name || t.directoryName
        })));
      } else {
        toast.error(`Failed to load templates: ${result?.error || 'Unknown error'}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to load templates: ${errorMessage}`);
    }
  };

  const handleCreateProject = async () => {
    if (!projectName.trim()) return;

    setCreatingProject(true);
    try {
      const result = await window.electronAPI.invoke('project:create', {
        name: projectName,
        description: projectDescription
      });

      if (result.success) {
        setShowCreateProject(false);
        setProjectName('');
        setProjectDescription('');
        await loadProjects();
        toast.success('Project created successfully');
      } else {
        toast.error(`Failed to create project: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to create project: ${errorMessage}`);
    } finally {
      setCreatingProject(false);
    }
  };

  const handleSelectProject = async (projectId: string) => {
    try {
      const result = await window.electronAPI.invoke('project:load', projectId);
      if (result.success) {
        setSelectedProject(result.data);
        setSelectedRundown(null);

        // Track project access for recent items
        trackProjectAccess(result.data.id, result.data.name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;

    try {
      const result = await window.electronAPI.invoke('project:delete', projectId);
      if (result.success) {
        if (selectedProject?.id === projectId) {
          setSelectedProject(null);
        }
        await loadProjects();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleCreateRundown = async () => {
    if (!rundownName.trim() || !selectedProject) return;

    setCreatingRundown(true);
    try {
      const result = await window.electronAPI.invoke('rundown:create', {
        projectId: selectedProject.id,
        name: rundownName
      });

      if (result.success) {
        setShowCreateRundown(false);
        setRundownName('');
        await loadRundowns(selectedProject.id);
        toast.success('Rundown created successfully');
      } else {
        toast.error(`Failed to create rundown: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to create rundown: ${errorMessage}`);
    } finally {
      setCreatingRundown(false);
    }
  };

  const handleSelectRundown = async (rundownId: string) => {
    if (!selectedProject) return;

    try {
      const result = await window.electronAPI.invoke('rundown:load', selectedProject.id, rundownId);
      if (result.success) {
        setSelectedRundown(result.data);

        // Track rundown access for recent items
        trackRundownAccess(
          selectedProject.id,
          selectedProject.name,
          result.data.id,
          result.data.name,
          result.data.items?.length || 0
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleDeleteRundown = async (rundownId: string) => {
    if (!confirm('Are you sure you want to delete this rundown?')) return;
    if (!selectedProject) return;

    try {
      const result = await window.electronAPI.invoke('rundown:delete', selectedProject.id, rundownId);
      if (result.success) {
        if (selectedRundown?.id === rundownId) {
          setSelectedRundown(null);
        }
        await loadRundowns(selectedProject.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleCompetitionSelect = async (competition: LiveResultsCompetition | null) => {
    if (!selectedProject || !selectedRundown) return;

    setUpdatingCompetition(true);
    try {
      // Update both old and new data models for backward compatibility
      const updates: any = {
        liveResults: competition ? {
          ...selectedRundown.liveResults,
          competitionId: competition.id,
          competitionName: competition.name
        } : undefined
      };

      // Also update new dataSource field
      if (competition) {
        updates.dataSource = {
          ...selectedRundown.dataSource,
          sourceId: selectedDataSourceId,
          baseUrl: dataSourceBaseUrl || 'https://liveresultat.orientering.se',
          competitionId: competition.id,
          competitionName: competition.name
        };
      }

      const result = await window.electronAPI.invoke('rundown:update', selectedProject.id, selectedRundown.id, updates);

      if (result.success) {
        setSelectedRundown(result.data);
        toast.success('Competition selection updated');
      } else {
        toast.error(`Failed to update rundown: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to update rundown: ${errorMessage}`);
    } finally {
      setUpdatingCompetition(false);
    }
  };

  const handleDataSourceChange = (dataSourceId: string) => {
    setSelectedDataSourceId(dataSourceId);

    // Automatically populate the base URL from the selected data source
    const dataSource = dataSources.find(ds => ds.id === dataSourceId);
    if (dataSource) {
      setDataSourceBaseUrl(dataSource.config.baseUrl || '');
    }
  };



  const handleToggleTemplate = (templateId: string) => {
    setSelectedTemplates(prev => {
      if (prev.includes(templateId)) {
        return prev.filter(id => id !== templateId);
      } else {
        return [...prev, templateId];
      }
    });
  };

  const handleEnterProductionMode = async () => {
    if (!selectedProject || !selectedRundown) return;

    try {
      // Save all pending changes before entering production mode
      const updates: Partial<SPXRundown> = {};

      // Update data source configuration
      const dataSource = dataSources.find(ds => ds.id === selectedDataSourceId);
      if (dataSource) {
        updates.dataSource = {
          sourceId: selectedDataSourceId,
          baseUrl: dataSource.config.baseUrl || '',
          // Fall back to liveResults for backward compatibility during migration
          competitionId: selectedRundown.dataSource?.competitionId || selectedRundown.liveResults?.competitionId,
          competitionName: selectedRundown.dataSource?.competitionName || selectedRundown.liveResults?.competitionName
        };
      }

      // Update global settings
      updates.settings = {
        competitionNameOverride: competitionNameOverride,
        raceLocation: raceLocation
      };

      // Update template allowlist
      updates.allowedTemplates = selectedTemplates;

      // Save all updates at once
      const result = await window.electronAPI.invoke('rundown:update', selectedProject.id, selectedRundown.id, updates);

      if (result && result.success) {
        // Navigate to production mode
        navigate(`/production/${selectedProject.id}/${selectedRundown.id}`);
      } else {
        toast.error(`Failed to save rundown configuration: ${result?.error || 'Unknown error'}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to save rundown configuration: ${errorMessage}`);
    }
  };

  if (loading) {
    return <div className="loading">Loading projects...</div>;
  }

  return (
    <div className="project-view" style={{
      display: 'flex',
      height: '100%',
      gap: '1rem',
      padding: '1rem',
      overflow: 'hidden'
    }}>
      {/* Column 1: Projects */}
      <div className="projects-column" style={{
        flex: '0 0 300px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        borderRight: '1px solid #333',
        paddingRight: '1rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Projects</h2>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => setShowCreateProject(true)}
            title="Create New Project"
          >
            <FolderPlus size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {projects.length === 0 ? (
            <div style={{ padding: '1rem', textAlign: 'center', color: '#888' }}>
              No projects yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {projects.map(project => (
                <div
                  key={project.id}
                  className={`project-item ${selectedProject?.id === project.id ? 'selected' : ''}`}
                  style={{
                    padding: '0.75rem',
                    background: selectedProject?.id === project.id ? '#2a4a6a' : '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                  onClick={() => handleSelectProject(project.id)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{project.name}</div>
                    {project.description && (
                      <div style={{ fontSize: '0.875rem', color: '#888' }}>{project.description}</div>
                    )}
                  </div>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(project.id);
                    }}
                    title="Delete Project"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Column 2: Rundowns */}
      <div className="rundowns-column" style={{
        flex: '0 0 300px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        borderRight: '1px solid #333',
        paddingRight: '1rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Rundowns</h2>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => setShowCreateRundown(true)}
            disabled={!selectedProject}
            title="Create New Rundown"
          >
            <FilePlus size={16} />
          </button>
        </div>

        {!selectedProject ? (
          <div style={{ padding: '1rem', textAlign: 'center', color: '#888' }}>
            Select a project first
          </div>
        ) : rundowns.length === 0 ? (
          <div style={{ padding: '1rem', textAlign: 'center', color: '#888' }}>
            No rundowns yet
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {rundowns.map(rundown => (
                <div
                  key={rundown.id}
                  className={`rundown-item ${selectedRundown?.id === rundown.id ? 'selected' : ''}`}
                  style={{
                    padding: '0.75rem',
                    background: selectedRundown?.id === rundown.id ? '#2a4a6a' : '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                  onClick={() => handleSelectRundown(rundown.id)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{rundown.name}</div>
                    <div style={{ fontSize: '0.875rem', color: '#888' }}>
                      {rundown.itemCount} items
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteRundown(rundown.id);
                    }}
                    title="Delete Rundown"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Column 3: Preferences */}
      <div className="preferences-column" style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Preferences</h2>

        {!selectedRundown ? (
          <div style={{ padding: '1rem', textAlign: 'center', color: '#888' }}>
            Select a rundown to configure preferences
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', flex: 1, overflowY: 'auto' }}>
            {/* 1. Data Source Configuration */}
            <div className="preference-section">
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>1. Data Source Configuration</h3>
              <p style={{
                fontSize: '0.875rem',
                color: '#888',
                margin: '0 0 0.75rem 0',
                lineHeight: '1.4'
              }}>
                Select which data source to use for this rundown.
              </p>

              {/* Warning if no data sources available */}
              {dataSources.length === 0 && (
                <div style={{
                  padding: '0.75rem',
                  background: '#2a1a1a',
                  border: '1px solid #9e4a4a',
                  borderRadius: '4px',
                  color: '#9e4a4a',
                  fontSize: '0.875rem',
                  marginBottom: '0.75rem'
                }}>
                  <strong>No data sources configured!</strong>
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem' }}>
                    Please configure a data source in Settings &gt; Data before using this rundown.
                  </p>
                </div>
              )}

              {/* Warning if selected data source doesn't exist */}
              {dataSources.length > 0 && selectedDataSourceId && !dataSources.find(ds => ds.id === selectedDataSourceId) && (
                <div style={{
                  padding: '0.75rem',
                  background: '#2a1a1a',
                  border: '1px solid #9e7c4a',
                  borderRadius: '4px',
                  color: '#9e7c4a',
                  fontSize: '0.875rem',
                  marginBottom: '0.75rem'
                }}>
                  <strong>Data source not found!</strong>
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem' }}>
                    The data source '{selectedDataSourceId}' no longer exists. Please select a different data source.
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.875rem', fontWeight: 'bold', marginBottom: '0.25rem', display: 'block' }}>
                    Data Source
                  </label>
                  <select
                    className="input"
                    value={selectedDataSourceId}
                    onChange={(e) => handleDataSourceChange(e.target.value)}
                    style={{ fontSize: '0.875rem', width: '100%' }}
                    disabled={dataSources.length === 0}
                  >
                    {dataSources.length === 0 && (
                      <option value="">-- No data sources available --</option>
                    )}
                    {dataSources.filter(ds => ds.enabled).map(ds => (
                      <option key={ds.id} value={ds.id}>
                        {ds.name}
                      </option>
                    ))}
                  </select>
                  <p style={{ fontSize: '0.75rem', color: '#666', margin: '0.25rem 0 0 0' }}>
                    Base URL: {dataSourceBaseUrl || 'Not configured'}
                  </p>
                </div>
              </div>
            </div>

            {/* 2. Competition Selection */}
            <div className="preference-section">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  padding: '0.5rem',
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  marginBottom: competitionSelectorExpanded ? '0.75rem' : '0'
                }}
                onClick={() => setCompetitionSelectorExpanded(!competitionSelectorExpanded)}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>2. Competition Selection</h3>
                  {!competitionSelectorExpanded && (
                    <p style={{ margin: 0, fontSize: '0.875rem', color: '#888' }}>
                      {selectedRundown.dataSource?.competitionName || selectedRundown.liveResults?.competitionName || 'No competition selected'}
                    </p>
                  )}
                </div>
                {competitionSelectorExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </div>
              {competitionSelectorExpanded && (
                <div>
                  <p style={{
                    fontSize: '0.875rem',
                    color: '#888',
                    margin: '0 0 0.75rem 0',
                    lineHeight: '1.4'
                  }}>
                    Select a competition to automatically populate graphics with live data.
                  </p>
                  {updatingCompetition && (
                    <div style={{
                      fontSize: '0.875rem',
                      color: '#4a9e9e',
                      marginBottom: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}>
                      <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }} />
                      Updating competition selection...
                    </div>
                  )}
                  <CompetitionSelector
                    selectedCompetitionId={selectedRundown.dataSource?.competitionId || selectedRundown.liveResults?.competitionId}
                    onSelect={handleCompetitionSelect}
                    sourceId={selectedDataSourceId}
                  />
                </div>
              )}
            </div>

            {/* 3. Global Settings */}
            <div className="preference-section">
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>3. Global Settings</h3>
              <p style={{
                fontSize: '0.875rem',
                color: '#888',
                margin: '0 0 0.75rem 0',
                lineHeight: '1.4'
              }}>
                Customize competition name and location for graphics display.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.875rem', fontWeight: 'bold', marginBottom: '0.25rem', display: 'block' }}>
                    Competition Name Override
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={competitionNameOverride}
                    onChange={(e) => setCompetitionNameOverride(e.target.value)}
                    placeholder="Custom competition name for branding"
                    style={{ fontSize: '0.875rem', width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.875rem', fontWeight: 'bold', marginBottom: '0.25rem', display: 'block' }}>
                    Race Location
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={raceLocation}
                    onChange={(e) => setRaceLocation(e.target.value)}
                    placeholder="e.g., Stockholm, Sweden"
                    style={{ fontSize: '0.875rem', width: '100%' }}
                  />
                </div>
              </div>
            </div>

            {/* 4. Rundown Templates */}
            <div className="preference-section">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  padding: '0.5rem',
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  marginBottom: templateSelectorExpanded ? '0.75rem' : '0'
                }}
                onClick={() => setTemplateSelectorExpanded(!templateSelectorExpanded)}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>4. Rundown Templates</h3>
                  {!templateSelectorExpanded && (
                    <p style={{ margin: 0, fontSize: '0.875rem', color: '#888' }}>
                      {selectedTemplates.length === 0
                        ? 'All templates allowed'
                        : `${selectedTemplates.length} template${selectedTemplates.length === 1 ? '' : 's'} selected`}
                    </p>
                  )}
                </div>
                {templateSelectorExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </div>
              {templateSelectorExpanded && (
                <div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.75rem'
                  }}>
                    <p style={{
                      fontSize: '0.875rem',
                      color: '#888',
                      margin: 0,
                      lineHeight: '1.4'
                    }}>
                      Select which templates can be used in this rundown. Leave empty to allow all templates.
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        window.electronAPI.invoke('window:openExternal', 'http://localhost:5657/docs');
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.5rem 0.75rem',
                        background: '#667eea',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        transition: 'background 0.2s ease',
                        whiteSpace: 'nowrap'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#5568d3';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#667eea';
                      }}
                      title="Open Template Developer Guide"
                    >
                      <BookOpen size={16} />
                      Documentation
                    </button>
                  </div>
                  {availableTemplates.length === 0 ? (
                    <div style={{
                      padding: '1rem',
                      textAlign: 'center',
                      color: '#888',
                      background: '#0a0a0a',
                      borderRadius: '4px',
                      border: '1px dashed #333'
                    }}>
                      No templates available
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                      {availableTemplates.map((template) => (
                        <label
                          key={template.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.5rem',
                            background: selectedTemplates.includes(template.id) ? '#2a4a6a' : '#1a1a1a',
                            border: '1px solid #333',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            transition: 'background 0.2s ease'
                          }}
                          onMouseEnter={(e) => {
                            if (!selectedTemplates.includes(template.id)) {
                              e.currentTarget.style.background = '#2a2a2a';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!selectedTemplates.includes(template.id)) {
                              e.currentTarget.style.background = '#1a1a1a';
                            }
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedTemplates.includes(template.id)}
                            onChange={() => handleToggleTemplate(template.id)}
                            style={{ cursor: 'pointer' }}
                          />
                          <span>{template.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Enter Production Mode Button */}
            <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid #333' }}>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleEnterProductionMode}
                disabled={!selectedRundown}
                style={{
                  width: '100%',
                  padding: '1rem',
                  fontSize: '1.125rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                <Maximize2 size={20} />
                Save & Enter Production Mode
              </button>
              <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#888', textAlign: 'center' }}>
                All changes will be saved when entering production mode
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create Project Modal */}
      {showCreateProject && (
        <div className="modal-overlay" onClick={() => setShowCreateProject(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Project</h2>
            <div className="form-group">
              <label>Project Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Enter project name"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Description (optional)</label>
              <textarea
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                placeholder="Enter project description"
                rows={3}
              />
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCreateProject(false)}
                disabled={creatingProject}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateProject}
                disabled={creatingProject || !projectName.trim()}
              >
                {creatingProject ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Rundown Modal */}
      {showCreateRundown && (
        <div className="modal-overlay" onClick={() => setShowCreateRundown(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Rundown</h2>
            <div className="form-group">
              <label>Rundown Name</label>
              <input
                type="text"
                value={rundownName}
                onChange={(e) => setRundownName(e.target.value)}
                placeholder="Enter rundown name"
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCreateRundown(false)}
                disabled={creatingRundown}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateRundown}
                disabled={creatingRundown || !rundownName.trim()}
              >
                {creatingRundown ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="error-toast" style={{
          position: 'fixed',
          bottom: '1rem',
          right: '1rem',
          background: '#ff4444',
          color: '#fff',
          padding: '1rem',
          borderRadius: '4px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
        }}>
          {error}
          <button
            onClick={() => setError(null)}
            style={{
              marginLeft: '1rem',
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

