/**
 * Template Settings Panel Component
 * Shows template configuration options and field editor for selected rundown item
 */

import { useState, useEffect } from 'react';
import { Settings, Info, Radio, Layers, Maximize2, Play, Square, ChevronRight } from 'lucide-react';
import { SPXRundownItem, SPXProject, SPXRundown } from '../../../shared/types/spx';
import { OGrafTemplateInfo } from '../../../shared/types/ograf';
import { TemplateFieldEditor } from './TemplateFieldEditor';
import { ClassSelector } from './ClassSelector';
import { DataSourceUIRenderer } from './DataSourceUIRenderer';

interface TemplateSettingsPanelProps {
  item: SPXRundownItem | null;
  template: OGrafTemplateInfo | null;
  project: SPXProject | null;
  rundown: SPXRundown | null;
  onPlay?: (itemId: string) => void;
  onStop?: (itemId: string) => void;
  onNextStep?: (itemId: string) => void;
  onSave: (itemId: string, data: { fields: Record<string, any>; liveResultsData?: any; playbackMode?: 'solo' | 'stackable' }) => Promise<void>;
}

export function TemplateSettingsPanel({
  item,
  template,
  project,
  rundown,
  onPlay,
  onStop,
  onNextStep,
  onSave
}: TemplateSettingsPanelProps) {
  const [editingFields, setEditingFields] = useState<Record<string, any>>(item?.fields || {});

  // Get competition ID from: rundown dataSource > rundown liveResults (deprecated) > project liveResults (deprecated) > item override
  // NOTE: We prioritize rundown-level competition ID over item-level to avoid showing stale data
  // when the user switches competitions. Item-level override is only used if explicitly different.
  const [itemCompetitionId, setItemCompetitionId] = useState<number | undefined>(
    rundown?.dataSource?.competitionId ||
    rundown?.liveResults?.competitionId ||
    project?.liveResults?.competitionId ||
    item?.liveResultsData?.competitionId
  );
  const [itemClassName, setItemClassName] = useState<string | undefined>(
    item?.liveResultsData?.className
  );
  // Auto-update is the STANDARD for API templates - default to true
  const [autoUpdate, setAutoUpdate] = useState<boolean>(
    item?.liveResultsData?.autoUpdate ??
    (template?.dataSourceConfig?.mode === 'api' ? true : false)
  );
  const [playbackMode, setPlaybackMode] = useState<'solo' | 'stackable'>(
    item?.playbackMode || template?.manifest.playbackMode || 'stackable'
  );
  const [instanceName, setInstanceName] = useState<string>(
    item?.instanceName || ''
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // State for datasource UI control values
  const [dataSourceValues, setDataSourceValues] = useState<Record<string, any>>(
    item?.liveResultsData?.dataSourceValues || {}
  );

  // Calculate which fields should be excluded from manual editing
  // For API templates, hide ALL fields that have API mappings (they're shown in the API Data Options section)
  const getExcludedFields = (): string[] => {
    if (!template?.dataSourceConfig?.api?.fieldMappings) {
      return [];
    }

    // Exclude ALL fields that have API mappings
    // They are either:
    // 1. Auto-populated and hidden (shown nowhere, just populated)
    // 2. Auto-populated with override (shown in "Field Overrides" section)
    // Either way, they shouldn't appear in "Manual Input Values" section
    return template.dataSourceConfig.api.fieldMappings.map((m: { templateField: string }) => m.templateField);
  };

  // Update editing fields when item changes
  useEffect(() => {
    if (item) {
      setEditingFields(item.fields || {});
      // Prioritize rundown-level competition ID to avoid stale data
      setItemCompetitionId(
        rundown?.dataSource?.competitionId ||
        rundown?.liveResults?.competitionId ||
        project?.liveResults?.competitionId ||
        item.liveResultsData?.competitionId
      );
      setItemClassName(item.liveResultsData?.className);
      // Auto-update is the STANDARD for API templates - default to true
      setAutoUpdate(
        item.liveResultsData?.autoUpdate ??
        (template?.dataSourceConfig?.mode === 'api' ? true : false)
      );
      setPlaybackMode(item.playbackMode || template?.manifest.playbackMode || 'stackable');
      setInstanceName(item.instanceName || '');
      setDataSourceValues(item.liveResultsData?.dataSourceValues || {});
      setHasUnsavedChanges(false);

      // DEBUG: Log template and datasource config
      console.log('[TemplateSettingsPanel] Item selected:', {
        itemId: item.id,
        templateId: item.templateId,
        hasTemplate: !!template,
        templateManifestId: template?.manifest?.id,
        hasDataSourceConfig: !!template?.dataSourceConfig,
        dataSourceConfig: template?.dataSourceConfig,
        hasApiControls: !!template?.dataSourceConfig?.api?.uiControls,
        controlCount: template?.dataSourceConfig?.api?.uiControls?.length || 0,
        rundownDataSource: rundown?.dataSource,
        rundownLiveResults: rundown?.liveResults,
        projectLiveResults: project?.liveResults,
        excludedFields: getExcludedFields()
      });
    }
  }, [item, project, rundown, template]);

  // Track changes
  useEffect(() => {
    if (item) {
      const defaultCompetitionId = rundown?.dataSource?.competitionId || rundown?.liveResults?.competitionId || project?.liveResults?.competitionId;
      // Auto-update is the STANDARD for API templates - default to true
      const defaultAutoUpdate = template?.dataSourceConfig?.mode === 'api' ? true : false;
      // For templates using new datasource system, extract className from dataSourceValues
      const effectiveClassName = itemClassName || dataSourceValues.className;
      const savedClassName = item.liveResultsData?.className;

      const hasChanges =
        JSON.stringify(editingFields) !== JSON.stringify(item.fields || {}) ||
        playbackMode !== (item.playbackMode || template?.manifest.playbackMode || 'stackable') ||
        instanceName !== (item.instanceName || '') ||
        itemCompetitionId !== (item.liveResultsData?.competitionId || defaultCompetitionId) ||
        effectiveClassName !== savedClassName ||
        autoUpdate !== (item.liveResultsData?.autoUpdate ?? defaultAutoUpdate) ||
        JSON.stringify(dataSourceValues) !== JSON.stringify(item.liveResultsData?.dataSourceValues || {});
      setHasUnsavedChanges(hasChanges);
    }
  }, [editingFields, playbackMode, instanceName, itemCompetitionId, itemClassName, autoUpdate, dataSourceValues, item, project, rundown, template]);

  const handleSave = async () => {
    if (!item) return;

    try {
      const updateData: any = {
        fields: editingFields,
        playbackMode: playbackMode,
        instanceName: instanceName || undefined // Only include if not empty
      };

      // Include LiveResults metadata if set
      // IMPORTANT: Always include liveResultsData if template uses API data source
      // This ensures autoUpdate flag is properly saved even with default values
      if (itemCompetitionId || itemClassName || Object.keys(dataSourceValues).length > 0 || template?.dataSourceConfig?.mode === 'api') {
        // For templates using new datasource system, extract className from dataSourceValues
        // This ensures PlaybackEngine can find it for auto-update polling
        const effectiveClassName = itemClassName || dataSourceValues.className;

        updateData.liveResultsData = {
          competitionId: itemCompetitionId,
          className: effectiveClassName, // Use className from dataSourceValues if not set directly
          autoUpdate: autoUpdate,
          dataSourceValues: dataSourceValues, // Include datasource UI control values
          lastUpdate: Date.now()
        };
      }

      await onSave(item.id, updateData);
      setHasUnsavedChanges(false);
    } catch (error) {
      // Error handling is done in parent component
      throw error;
    }
  };

  const excludedFields = getExcludedFields();

  if (!item || !template) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#1a1a1a',
        borderRadius: '4px',
        border: '1px solid #333'
      }}>
        {/* Header */}
        <div style={{
          padding: '0.75rem',
          background: '#2a2a2a',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <Settings size={16} />
          <span style={{ fontWeight: 'bold', fontSize: '0.875rem' }}>Template Settings</span>
        </div>

        {/* Empty State */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666',
          gap: '1rem',
          padding: '2rem'
        }}>
          <Settings size={64} style={{ opacity: 0.2 }} />
          <p style={{ fontSize: '0.875rem', textAlign: 'center', margin: 0 }}>
            Select a rundown item to edit its settings
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#1a1a1a',
        borderRadius: '4px',
        border: '1px solid #333',
        overflow: 'hidden'
      }}>
      {/* Header */}
      <div style={{
        padding: '0.75rem',
        background: '#2a2a2a',
        borderBottom: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Settings size={16} />
          <span style={{ fontWeight: 'bold', fontSize: '0.875rem' }}>Template Settings</span>
          {hasUnsavedChanges && (
            <span style={{
              fontSize: '0.65rem',
              color: '#9e7c4a',
              background: '#2a2010',
              padding: '0.125rem 0.375rem',
              borderRadius: '3px',
              border: '1px solid #9e7c4a'
            }}>
              UNSAVED
            </span>
          )}
        </div>
      </div>

      {/* Content - Scrollable */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        paddingBottom: '0.5rem'
      }}>
        {/* Section 1: API-Related Input Options */}
        {(() => {
          // Get competition ID from all possible sources
          const rundownCompetitionId = rundown?.dataSource?.competitionId || rundown?.liveResults?.competitionId;
          const projectCompetitionId = project?.liveResults?.competitionId;
          const hasCompetitionId = !!(itemCompetitionId || rundownCompetitionId || projectCompetitionId);

          return hasCompetitionId;
        })() && (
          <div style={{
            padding: '0.75rem',
            background: '#0a0a0a',
            borderRadius: '4px',
            border: '1px solid #333'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '0.75rem',
              fontWeight: 'bold',
              fontSize: '0.875rem',
              color: '#fff'
            }}>
              <Radio size={14} />
              API Data Options
            </div>

            {/* Render datasource UI controls if available */}
            {template.dataSourceConfig?.api?.uiControls && template.dataSourceConfig.api.uiControls.length > 0 ? (
              <>
                <DataSourceUIRenderer
                  controls={template.dataSourceConfig.api.uiControls}
                  competitionId={rundown?.dataSource?.competitionId || rundown?.liveResults?.competitionId || project?.liveResults?.competitionId || itemCompetitionId || 0}
                  values={dataSourceValues}
                  onChange={(fieldName, value) => {
                    setDataSourceValues(prev => ({
                      ...prev,
                      [fieldName]: value
                    }));
                    setHasUnsavedChanges(true);
                  }}
                  fieldMappings={template.dataSourceConfig.api.fieldMappings}
                />

                {/* Auto-Update Toggle - STANDARD for API templates */}
                <div style={{ marginTop: '0.75rem' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem',
                    background: autoUpdate ? '#1a2a1a' : '#2a1a1a',
                    borderRadius: '4px',
                    border: `1px solid ${autoUpdate ? '#4a9e4a' : '#9e4a4a'}`,
                    transition: 'all 0.2s'
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '0.75rem',
                        fontWeight: '500',
                        color: autoUpdate ? '#4a9e4a' : '#ccc',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                      }}>
                        {autoUpdate ? (
                          <>
                            <span style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: '#4a9e4a',
                              animation: 'pulse 2s infinite'
                            }} />
                            <span>Live auto-update enabled (standard)</span>
                          </>
                        ) : (
                          <>
                            <span style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: '#9e4a4a'
                            }} />
                            <span>Auto-update disabled</span>
                          </>
                        )}
                      </div>
                      <div style={{
                        fontSize: '0.65rem',
                        color: '#888',
                        marginTop: '0.25rem'
                      }}>
                        {autoUpdate ? (
                          <>
                            Graphic will update automatically as new data arrives
                            {item?.liveResultsData?.lastUpdate && (
                              <> • Last updated: {new Date(item.liveResultsData.lastUpdate).toLocaleTimeString()}</>
                            )}
                          </>
                        ) : (
                          'Data will be fetched once when graphic is played'
                        )}
                      </div>
                    </div>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.7rem',
                      cursor: 'pointer',
                      padding: '0.25rem 0.5rem',
                      background: !autoUpdate ? '#3a2a2a' : 'transparent',
                      borderRadius: '3px',
                      border: `1px solid ${!autoUpdate ? '#9e4a4a' : '#333'}`,
                      whiteSpace: 'nowrap'
                    }}>
                      <input
                        type="checkbox"
                        checked={!autoUpdate}
                        onChange={(e) => setAutoUpdate(!e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                      <span>Disable auto-update</span>
                    </label>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Fallback to legacy class selector if no datasource config */}
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: '500' }}>
                    Class Filter
                  </label>
                  <ClassSelector
                    competitionId={rundown?.dataSource?.competitionId || rundown?.liveResults?.competitionId || project?.liveResults?.competitionId || itemCompetitionId || 0}
                    selectedClassName={itemClassName}
                    onSelect={(className) => setItemClassName(className || undefined)}
                    compact={true}
                  />
                </div>

                {/* Auto-Update Toggle - STANDARD for API templates */}
                {itemClassName && (
                  <div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem',
                      background: autoUpdate ? '#1a2a1a' : '#2a1a1a',
                      borderRadius: '4px',
                      border: `1px solid ${autoUpdate ? '#4a9e4a' : '#9e4a4a'}`,
                      transition: 'all 0.2s'
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: '0.75rem',
                          fontWeight: '500',
                          color: autoUpdate ? '#4a9e4a' : '#ccc',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}>
                          {autoUpdate ? (
                            <>
                              <span style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: '#4a9e4a',
                                animation: 'pulse 2s infinite'
                              }} />
                              <span>Live auto-update enabled (standard)</span>
                            </>
                          ) : (
                            <>
                              <span style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: '#9e4a4a'
                              }} />
                              <span>Auto-update disabled</span>
                            </>
                          )}
                        </div>
                        <div style={{
                          fontSize: '0.65rem',
                          color: '#888',
                          marginTop: '0.25rem'
                        }}>
                          {autoUpdate ? (
                            <>
                              Graphic will update automatically as new data arrives
                              {item?.liveResultsData?.lastUpdate && (
                                <> • Last updated: {new Date(item.liveResultsData.lastUpdate).toLocaleTimeString()}</>
                              )}
                            </>
                          ) : (
                            'Data will be fetched once when graphic is played'
                          )}
                        </div>
                      </div>
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: '0.7rem',
                        cursor: 'pointer',
                        padding: '0.25rem 0.5rem',
                        background: !autoUpdate ? '#3a2a2a' : 'transparent',
                        borderRadius: '3px',
                        border: `1px solid ${!autoUpdate ? '#9e4a4a' : '#333'}`,
                        whiteSpace: 'nowrap'
                      }}>
                        <input
                          type="checkbox"
                          checked={!autoUpdate}
                          onChange={(e) => setAutoUpdate(!e.target.checked)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span>Disable auto-update</span>
                      </label>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Section 2: Manual Input Values (Template Fields) */}
        <div style={{
          padding: '0.75rem',
          background: '#0a0a0a',
          borderRadius: '4px',
          border: '1px solid #333'
        }}>
          <div style={{
            fontWeight: 'bold',
            fontSize: '0.875rem',
            marginBottom: '0.75rem',
            color: '#fff'
          }}>
            Manual Input Values
          </div>
          <TemplateFieldEditor
            manifest={template.manifest}
            initialData={editingFields}
            onChange={(newFields) => {
              setEditingFields(newFields);
            }}
            showActions={false}
            competitionId={rundown?.dataSource?.competitionId || rundown?.liveResults?.competitionId || project?.liveResults?.competitionId || itemCompetitionId}
            className={itemClassName}
            enableAutoFill={!!(rundown?.dataSource?.competitionId || rundown?.liveResults?.competitionId || project?.liveResults?.competitionId || itemCompetitionId) && !!itemClassName}
            excludeFields={excludedFields}
          />
        </div>

        {/* Section 3: Playback Mode */}
        <div style={{
          padding: '0.75rem',
          background: '#0a0a0a',
          borderRadius: '4px',
          border: '1px solid #333'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '0.75rem',
            fontWeight: 'bold',
            fontSize: '0.875rem',
            color: '#fff'
          }}>
            {playbackMode === 'solo' ? <Maximize2 size={14} /> : <Layers size={14} />}
            Playback Mode
          </div>

          <select
            className="input"
            value={playbackMode}
            onChange={(e) => setPlaybackMode(e.target.value as 'solo' | 'stackable')}
            style={{
              width: '100%',
              fontSize: '0.875rem',
              padding: '0.5rem',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '4px',
              color: '#fff'
            }}
          >
            <option value="stackable">Stackable - Plays alongside other graphics</option>
            <option value="solo">Solo - Stops all other graphics first</option>
          </select>

          <div style={{
            fontSize: '0.7rem',
            color: '#888',
            marginTop: '0.5rem',
            lineHeight: '1.4'
          }}>
            {playbackMode === 'solo' ? (
              <>
                <strong style={{ color: '#9e4a4a' }}>Solo mode:</strong> All other graphics will be stopped before playing this one.
                Use for full-screen templates like results lists and start lists.
              </>
            ) : (
              <>
                <strong style={{ color: '#4a7c9e' }}>Stackable mode:</strong> This graphic will play alongside other graphics.
                Use for lower thirds, banners, and overlays that can be layered.
              </>
            )}
          </div>
        </div>

        {/* Section 4: Instance Name */}
        <div style={{
          padding: '0.75rem',
          background: '#0a0a0a',
          borderRadius: '4px',
          border: '1px solid #333'
        }}>
          <label style={{
            display: 'block',
            marginBottom: '0.5rem',
            fontSize: '0.75rem',
            fontWeight: '500',
            color: '#fff'
          }}>
            Instance Name
          </label>
          <input
            type="text"
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            placeholder="e.g., M21 Final Results, W35 Control 3"
            style={{
              width: '100%',
              padding: '0.5rem',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '0.75rem',
              outline: 'none'
            }}
            onFocus={(e) => e.target.style.borderColor = '#4a7c9e'}
            onBlur={(e) => e.target.style.borderColor = '#333'}
          />
          <div style={{
            fontSize: '0.65rem',
            color: '#888',
            marginTop: '0.25rem'
          }}>
            Optional descriptive name for this rundown item
          </div>
        </div>

        {/* Section 5: Template Information (Read-only) */}
        <div style={{
          padding: '0.75rem',
          background: '#0a0a0a',
          borderRadius: '4px',
          border: '1px solid #333'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '0.5rem',
            fontWeight: 'bold',
            fontSize: '0.875rem',
            color: '#fff'
          }}>
            <Info size={14} />
            Template Information
          </div>
          <div style={{ fontSize: '0.75rem', color: '#888', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div><strong>Name:</strong> {template.manifest.name}</div>
            <div><strong>ID:</strong> {template.manifest.id}</div>
            {template.manifest.description && (
              <div><strong>Description:</strong> {template.manifest.description}</div>
            )}
            <div><strong>Version:</strong> {template.manifest.version}</div>
            {template.manifest.author && (
              <div><strong>Author:</strong> {template.manifest.author.name}</div>
            )}
            {template.manifest.stepCount && template.manifest.stepCount > 1 && (
              <div><strong>Steps:</strong> {template.manifest.stepCount} (Multi-step graphic)</div>
            )}
          </div>
        </div>
      </div>

      {/* Section 5: Action Buttons (Sticky at Bottom) */}
      <div style={{
        padding: '0.5rem',
        background: '#2a2a2a',
        borderTop: '1px solid #333',
        display: 'flex',
        gap: '0.5rem'
      }}>
        {/* Playback Controls */}
        {!item.onair ? (
          <button
            onClick={() => onPlay?.(item.id)}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.375rem',
              padding: '0.625rem',
              background: '#2a5a2a',
              border: '1px solid #3a7a3a',
              borderRadius: '4px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: '600',
              transition: 'all 0.2s'
            }}
          >
            <Play size={16} />
            Play
          </button>
        ) : (
          <>
            <button
              onClick={() => onStop?.(item.id)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.375rem',
                padding: '0.625rem',
                background: '#9e4a4a',
                border: '1px solid #ae5a5a',
                borderRadius: '4px',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: '600',
                transition: 'all 0.2s'
              }}
            >
              <Square size={16} />
              Stop
            </button>

            {/* Next Step Button - Only for multi-step graphics */}
            {/* Show if stepCount is 0 (auto) or > 1 (explicit multi-step) */}
            {(template.manifest.stepCount === 0 || (template.manifest.stepCount && template.manifest.stepCount > 1)) ? (
              <button
                onClick={() => onNextStep?.(item.id)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.375rem',
                  padding: '0.625rem',
                  background: '#9e7c4a',
                  border: '1px solid #ae8c5a',
                  borderRadius: '4px',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  transition: 'all 0.2s'
                }}
              >
                <ChevronRight size={16} />
                Next Step
              </button>
            ) : null}
          </>
        )}

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={!hasUnsavedChanges}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.375rem',
            padding: '0.625rem',
            background: hasUnsavedChanges ? '#4a7c9e' : '#333',
            border: `1px solid ${hasUnsavedChanges ? '#5a8cae' : '#444'}`,
            borderRadius: '4px',
            color: hasUnsavedChanges ? '#fff' : '#888',
            cursor: hasUnsavedChanges ? 'pointer' : 'not-allowed',
            fontSize: '0.8rem',
            fontWeight: '600',
            transition: 'all 0.2s'
          }}
        >
          Save
        </button>
      </div>
    </div>
    </>
  );
}

