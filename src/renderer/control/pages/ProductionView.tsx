/**
 * Production Mode View
 * Full-screen production interface with 4-panel layout
 * Shows only the production controls without project/rundown selectors
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Monitor, MonitorOff, Plus, Keyboard, X } from 'lucide-react';
import { RundownItemList } from '../components/RundownItemList';
import { TemplateSettingsPanel } from '../components/TemplateSettingsPanel';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { OGrafTemplateInfo } from '../../../shared/types/ograf';
import { SPXProject, SPXRundown } from '../../../shared/types/spx';
import { useToast } from '../contexts/ToastContext';
import { trackRundownAccess } from '../utils/recentItems';

export function ProductionView() {
  const { projectId, rundownId } = useParams<{ projectId: string; rundownId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  // DEBUG: Track component render count and what's causing renders
  const renderCountRef = useRef(0);
  const prevPropsRef = useRef({ projectId, rundownId });
  renderCountRef.current += 1;

  const propsChanged = {
    projectId: prevPropsRef.current.projectId !== projectId,
    rundownId: prevPropsRef.current.rundownId !== rundownId
  };

  console.log(`[ProductionView] 🔄 RENDER #${renderCountRef.current}`, {
    projectId,
    rundownId,
    propsChanged,
    timestamp: new Date().toISOString()
  });

  prevPropsRef.current = { projectId, rundownId };

  // Track previous rundown to detect actual rundown switches (not just re-renders)
  const prevRundownRef = useRef<{ projectId?: string; rundownId?: string }>({});

  // State
  const [project, setProject] = useState<SPXProject | null>(null);
  const [rundown, setRundown] = useState<SPXRundown | null>(null);
  const [templates, setTemplates] = useState<OGrafTemplateInfo[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [graphicsWindowVisible, setGraphicsWindowVisible] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [ndiInfo, setNdiInfo] = useState<any>(null);
  const [webInfo, setWebInfo] = useState<any>(null);

  // DEBUG: Track specific state changes (not on every render)
  const prevStateRef = useRef<{
    rundownItemsCount?: number;
    rundownItemsRef?: any;
    rundown?: any;
    templates?: any;
    ndiInfo?: any;
    webInfo?: any;
    loading?: boolean;
  }>({});

  useEffect(() => {
    const currentState = {
      rundownItemsCount: rundown?.items?.length || 0,
      rundownItemsRef: rundown?.items,
      rundown,
      templates,
      ndiInfo,
      webInfo,
      loading
    };

    const changed = {
      rundownItemsCount: prevStateRef.current.rundownItemsCount !== currentState.rundownItemsCount,
      rundownItemsRef: prevStateRef.current.rundownItemsRef !== currentState.rundownItemsRef,
      rundown: prevStateRef.current.rundown !== currentState.rundown,
      templates: prevStateRef.current.templates !== currentState.templates,
      ndiInfo: prevStateRef.current.ndiInfo !== currentState.ndiInfo,
      webInfo: prevStateRef.current.webInfo !== currentState.webInfo,
      loading: prevStateRef.current.loading !== currentState.loading
    };

    if (Object.values(changed).some(v => v)) {
      console.log('[ProductionView] 📊 STATE CHANGED', {
        renderCount: renderCountRef.current,
        changed,
        currentState: {
          rundownItemsCount: currentState.rundownItemsCount,
          hasRundown: !!currentState.rundown,
          hasTemplates: currentState.templates?.length > 0,
          templatesCount: currentState.templates?.length || 0,
          hasNdiInfo: !!currentState.ndiInfo,
          hasWebInfo: !!currentState.webInfo,
          loading: currentState.loading
        },
        timestamp: new Date().toISOString()
      });
    }

    prevStateRef.current = currentState;
  }, [rundown, rundown?.items, templates, ndiInfo, webInfo, loading]);

  // Load data on mount and when switching rundowns
  useEffect(() => {
    // Check if this is an actual rundown switch or just a re-render
    const prevProjectId = prevRundownRef.current.projectId;
    const prevRundownId = prevRundownRef.current.rundownId;
    const isRundownSwitch = (prevProjectId && prevProjectId !== projectId) ||
                           (prevRundownId && prevRundownId !== rundownId);
    const isInitialMount = !prevProjectId && !prevRundownId;

    console.log('[ProductionView] useEffect triggered', {
      projectId,
      rundownId,
      prevProjectId,
      prevRundownId,
      isRundownSwitch,
      isInitialMount,
      timestamp: new Date().toISOString()
    });

    // Only clear graphics when ACTUALLY switching rundowns, not on every re-render
    // Do NOT clear on initial mount - this prevents clearing graphics that might already be playing
    if (isRundownSwitch) {
      console.log('[ProductionView] ⚠️  RUNDOWN SWITCH DETECTED - Calling playback:clear', {
        from: { projectId: prevProjectId, rundownId: prevRundownId },
        to: { projectId, rundownId },
        timestamp: new Date().toISOString()
      });

      window.electronAPI.invoke('playback:clear')
        .then(() => {
          console.log('[ProductionView] playback:clear completed successfully', {
            projectId,
            rundownId,
            timestamp: new Date().toISOString()
          });
        })
        .catch(err => {
          console.warn('[ProductionView] Failed to clear graphics on rundown switch:', err);
          // Don't show error to user - this is a background cleanup operation
        });
    } else if (isInitialMount) {
      console.log('[ProductionView] Initial mount - NOT clearing graphics (preserving any active graphics)', {
        projectId,
        rundownId,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log('[ProductionView] Re-render with same rundown - NOT clearing graphics', {
        projectId,
        rundownId,
        timestamp: new Date().toISOString()
      });
    }

    // Update ref for next comparison
    prevRundownRef.current = { projectId, rundownId };

    loadData();
    checkGraphicsWindowVisibility();
    loadOutputInfo();

    // Refresh output info every 5 seconds
    const interval = setInterval(loadOutputInfo, 5000);
    return () => {
      console.log('[ProductionView] useEffect cleanup - clearing interval', {
        projectId,
        rundownId,
        timestamp: new Date().toISOString()
      });
      clearInterval(interval);
    };
  }, [projectId, rundownId]);

  // Check graphics window visibility
  const checkGraphicsWindowVisibility = async () => {
    try {
      const result = await window.electronAPI.invoke('window:isGraphicsVisible');
      if (result && result.success && result.data) {
        setGraphicsWindowVisible(result.data.visible);
      } else if (result && !result.success) {
        toast.error(`Failed to check graphics window: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to check graphics window: ${errorMessage}`);
    }
  };

  // Toggle graphics window
  const toggleGraphicsWindow = async () => {
    try {
      const result = await window.electronAPI.invoke('window:toggleGraphics');
      if (result && result.success && result.data) {
        setGraphicsWindowVisible(result.data.visible);
      } else if (result && !result.success) {
        toast.error(`Failed to toggle graphics window: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to toggle graphics window: ${errorMessage}`);
    }
  };

  // Load output information
  // CRITICAL FIX: Only update state if values actually changed to prevent unnecessary re-renders
  const loadOutputInfo = async () => {
    try {
      const [ndiResult, webResult] = await Promise.all([
        window.electronAPI.invoke('output:getNDIInfo'),
        window.electronAPI.invoke('output:getWebInfo')
      ]);

      if (ndiResult && ndiResult.success) {
        // Only update if the value actually changed (deep comparison of critical fields)
        setNdiInfo((prev: any) => {
          if (!prev && !ndiResult.data) return prev;
          if (!prev || !ndiResult.data) return ndiResult.data;

          // Compare critical fields to avoid unnecessary updates
          const changed = (
            prev.available !== ndiResult.data.available ||
            prev.active !== ndiResult.data.active ||
            prev.sourceName !== ndiResult.data.sourceName
          );

          if (changed) {
            console.log('[ProductionView] NDI info changed', {
              old: { available: prev.available, active: prev.active },
              new: { available: ndiResult.data.available, active: ndiResult.data.active }
            });
            return ndiResult.data;
          }

          return prev; // No change, return previous reference
        });
      } else if (ndiResult && !ndiResult.success) {
        toast.error(`Failed to load NDI info: ${ndiResult.error || 'Unknown error'}`);
      }

      if (webResult && webResult.success) {
        // Only update if the value actually changed (deep comparison of critical fields)
        setWebInfo((prev: any) => {
          if (!prev && !webResult.data) return prev;
          if (!prev || !webResult.data) return webResult.data;

          // Compare critical fields to avoid unnecessary updates
          const changed = (
            prev.isRunning !== webResult.data.isRunning ||
            prev.port !== webResult.data.port ||
            prev.localhostUrl !== webResult.data.localhostUrl
          );

          if (changed) {
            console.log('[ProductionView] Web info changed', {
              old: { isRunning: prev.isRunning, port: prev.port },
              new: { isRunning: webResult.data.isRunning, port: webResult.data.port }
            });
            return webResult.data;
          }

          return prev; // No change, return previous reference
        });
      } else if (webResult && !webResult.success) {
        toast.error(`Failed to load web info: ${webResult.error || 'Unknown error'}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to load output info: ${errorMessage}`);
    }
  };

  // Toggle NDI output
  const toggleNDI = async () => {
    if (!ndiInfo) return;

    try {
      if (ndiInfo.active) {
        await window.electronAPI.invoke('output:stopNDI');
        toast.success('NDI output stopped');
      } else {
        await window.electronAPI.invoke('output:startNDI');
        toast.success('NDI output started');
      }
      // Reload output info
      await loadOutputInfo();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to toggle NDI';
      toast.error(errorMessage);
      setError(errorMessage);
    }
  };

  const loadData = async () => {
    if (!projectId || !rundownId) {
      navigate('/');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Load project
      const projectResult = await window.electronAPI.invoke('project:load', projectId);
      if (!projectResult || !projectResult.success) {
        throw new Error(projectResult?.error || 'Failed to load project');
      }
      setProject(projectResult.data);

      // Load rundown
      const rundownResult = await window.electronAPI.invoke('rundown:load', projectId, rundownId);
      if (!rundownResult || !rundownResult.success) {
        throw new Error(rundownResult?.error || 'Failed to load rundown');
      }
      setRundown(rundownResult.data);

      // Validate data source configuration
      const rundownData = rundownResult.data;
      if (rundownData.dataSource) {
        const sourceId = rundownData.dataSource.sourceId;

        // Check if data source is missing or empty
        if (!sourceId || sourceId === '') {
          toast.error('This rundown needs a data source configured. Please configure it in Project View.');
        } else {
          // Verify the data source exists
          const dataSourcesResult = await window.electronAPI.invoke('dataSource:getAll');
          if (dataSourcesResult && dataSourcesResult.success) {
            const dataSources = dataSourcesResult.data || [];
            const dataSourceExists = dataSources.some((ds: any) => ds.id === sourceId);

            if (!dataSourceExists) {
              toast.error(`Data source '${sourceId}' not found. Please select a valid data source in Project View.`);
            }
          }
        }
      }

      // Track rundown access for recent items
      trackRundownAccess(
        projectResult.data.id,
        projectResult.data.name,
        rundownResult.data.id,
        rundownResult.data.name,
        rundownResult.data.items?.length || 0
      );

      // Load templates
      const templatesResult = await window.electronAPI.invoke('templates:getAll');
      if (templatesResult && templatesResult.success) {
        const templates = templatesResult.templates || [];
        setTemplates(templates);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handlePlayItem = async (itemId: string) => {
    if (!project || !rundown) return;

    // Check if this item has solo playback mode
    const playingItem = rundown.items.find(i => i.id === itemId);
    if (!playingItem) return;

    const template = templates.find(t => t.manifest.id === playingItem.templateId);
    const playbackMode = playingItem.playbackMode || template?.manifest.playbackMode || 'stackable';
    const isSolo = playbackMode === 'solo';

    // OPTIMISTIC UPDATE: Update UI immediately for better responsiveness
    // If solo mode, stop all other playing items
    setRundown({
      ...rundown,
      items: rundown.items.map(item => {
        if (item.id === itemId) {
          return { ...item, onair: true };
        } else if (isSolo && item.onair) {
          // Solo mode: stop all other playing items
          return { ...item, onair: false };
        }
        return item;
      })
    });

    // Send command to backend and reload to get currentStep
    window.electronAPI.invoke('playback:play', project.id, rundown.id, itemId)
      .then(() => {
        // Reload rundown to get updated currentStep
        // This ensures the Data Preview shows the correct next step
        loadData();
      })
      .catch(err => {
        const errorMessage = err instanceof Error ? err.message : 'Failed to play item';
        setError(errorMessage);
        toast.error(errorMessage);

        // Revert optimistic update on error
        setRundown(prev => prev ? {
          ...prev,
          items: prev.items.map(item =>
            item.id === itemId ? { ...item, onair: false } : item
          )
        } : prev);
      });
  };

  const handleStopItem = async (itemId: string) => {
    if (!project || !rundown) return;

    // OPTIMISTIC UPDATE: Update UI immediately for better responsiveness
    setRundown({
      ...rundown,
      items: rundown.items.map(item =>
        item.id === itemId ? { ...item, onair: false } : item
      )
    });

    // Send command to backend (don't await - fire and forget for UI responsiveness)
    window.electronAPI.invoke('playback:stop', project.id, rundown.id, itemId)
      .catch(err => {
        const errorMessage = err instanceof Error ? err.message : 'Failed to stop item';
        setError(errorMessage);
        toast.error(errorMessage);

        // Revert optimistic update on error
        setRundown(prev => prev ? {
          ...prev,
          items: prev.items.map(item =>
            item.id === itemId ? { ...item, onair: true } : item
          )
        } : prev);
      });
  };

  const handleNextStep = async (itemId: string) => {
    if (!project || !rundown) return;

    // OPTIMISTIC UPDATE: Update currentStep locally for immediate UI response
    // This prevents the full page refresh that occurs when calling loadData()
    const item = rundown.items.find(i => i.id === itemId);
    if (!item) return;

    const newStep = (item.currentStep || 0) + 1;

    setRundown({
      ...rundown,
      items: rundown.items.map(i =>
        i.id === itemId ? { ...i, currentStep: newStep } : i
      )
    });

    // Send command to backend (fire and forget for UI responsiveness)
    window.electronAPI.invoke('playback:next', project.id, rundown.id, itemId)
      .catch(err => {
        const errorMessage = err instanceof Error ? err.message : 'Failed to advance to next step';
        setError(errorMessage);
        toast.error(errorMessage);

        // Revert optimistic update on error by reloading data
        loadData();
      });
  };

  const handlePreviousStep = async (itemId: string) => {
    if (!project || !rundown) return;

    // OPTIMISTIC UPDATE: Update currentStep locally for immediate UI response
    // This prevents the full page refresh that occurs when calling loadData()
    const item = rundown.items.find(i => i.id === itemId);
    if (!item) return;

    const newStep = Math.max(0, (item.currentStep || 1) - 1);

    setRundown({
      ...rundown,
      items: rundown.items.map(i =>
        i.id === itemId ? { ...i, currentStep: newStep } : i
      )
    });

    // Send command to backend (fire and forget for UI responsiveness)
    window.electronAPI.invoke('playback:previous', project.id, rundown.id, itemId)
      .catch(err => {
        const errorMessage = err instanceof Error ? err.message : 'Failed to go to previous step';
        setError(errorMessage);
        toast.error(errorMessage);

        // Revert optimistic update on error by reloading data
        loadData();
      });
  };

  const handleExitProduction = () => {
    navigate(`/project/${projectId}`);
  };

  const handleAddTemplate = async (templateId: string) => {
    if (!project || !rundown) return;

    try {
      const template = templates.find(t => t.manifest.id === templateId);
      if (!template) {
        setError('Template not found');
        return;
      }

      // Add item to rundown with default playbackMode
      const result = await window.electronAPI.invoke('rundown:addItem',
        project.id,
        rundown.id,
        {
          templateId: template.manifest.id,
          templatePath: template.directoryName,
          fields: {},
          layer: '1',
          out: 'animate',
          playbackMode: 'stackable' // Default to stackable, can be changed per item
        }
      );

      if (result && result.success && result.data) {
        // Update local state by adding the new item
        setRundown({
          ...rundown,
          items: [...rundown.items, result.data]
        });
        setShowTemplateSelector(false);

        // Select the newly added item
        setSelectedItemId(result.data.id);
      } else {
        setError(result?.error || 'Failed to add template');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add template');
    }
  };

  const handleNextItem = () => {
    if (!rundown || !rundown.items.length) return;
    const currentIndex = selectedItemId ? rundown.items.findIndex(i => i.id === selectedItemId) : -1;
    const nextIndex = (currentIndex + 1) % rundown.items.length;
    setSelectedItemId(rundown.items[nextIndex].id);
  };

  const handlePreviousItem = () => {
    if (!rundown || !rundown.items.length) return;
    const currentIndex = selectedItemId ? rundown.items.findIndex(i => i.id === selectedItemId) : -1;
    const prevIndex = currentIndex <= 0 ? rundown.items.length - 1 : currentIndex - 1;
    setSelectedItemId(rundown.items[prevIndex].id);
  };

  const handleClearAll = async () => {
    // OPTIMISTIC UPDATE: Update UI immediately for better responsiveness
    if (rundown) {
      setRundown({
        ...rundown,
        items: rundown.items.map(item => ({ ...item, onair: false }))
      });
    }

    // Send command to backend (don't await - fire and forget for UI responsiveness)
    window.electronAPI.invoke('playback:clear')
      .catch(err => {
        const errorMessage = err instanceof Error ? err.message : 'Failed to clear all graphics';
        setError(errorMessage);
        toast.error(errorMessage);
        // Note: We don't revert the optimistic update for clearAll since it's a destructive operation
        // and reverting would be confusing. The error message is sufficient.
      });
  };

  // Keyboard shortcuts
  useKeyboardShortcuts({
    shortcuts: [
      {
        key: 'Escape',
        description: 'Clear all graphics / Close modal',
        handler: () => {
          // If keyboard shortcuts modal is open, close it
          if (showKeyboardShortcuts) {
            setShowKeyboardShortcuts(false);
          } else {
            // Otherwise, clear all graphics
            handleClearAll();
          }
        },
        preventDefault: true
      },

      {
        key: 'ArrowDown',
        description: 'Select next item',
        handler: handleNextItem,
        preventDefault: true
      },
      {
        key: 'ArrowUp',
        description: 'Select previous item',
        handler: handlePreviousItem,
        preventDefault: true
      },
      {
        key: ' ',
        description: 'Play/Stop selected item',
        handler: () => {
          if (!selectedItemId) return;
          const item = rundown?.items.find(i => i.id === selectedItemId);
          if (!item) return;

          // Toggle play/stop based on current state
          // Don't await - let handlers run asynchronously for immediate UI response
          if (item.onair) {
            handleStopItem(selectedItemId);
          } else {
            handlePlayItem(selectedItemId);
          }
        },
        preventDefault: true
      },
      {
        key: 'ArrowRight',
        description: 'Next step (multi-step graphics)',
        handler: () => {
          if (!selectedItemId) return;
          const item = rundown?.items.find(i => i.id === selectedItemId);
          if (!item || !item.onair) return;

          // Get template info to check stepCount
          const template = templates.find(t => t.directoryName === item.templateId);
          // Show if stepCount is 0 (auto) or > 1 (explicit multi-step)
          if (!template || !(template.manifest.stepCount === 0 || (template.manifest.stepCount && template.manifest.stepCount > 1))) return;

          // Advance to next step
          handleNextStep(selectedItemId);
        },
        preventDefault: true
      },
      {
        key: 'ArrowLeft',
        description: 'Previous step (multi-step graphics)',
        handler: () => {
          if (!selectedItemId) return;
          const item = rundown?.items.find(i => i.id === selectedItemId);
          if (!item || !item.onair) return;

          // Get template info to check stepCount
          const template = templates.find(t => t.directoryName === item.templateId);
          // Show if stepCount is 0 (auto) or > 1 (explicit multi-step)
          if (!template || !(template.manifest.stepCount === 0 || (template.manifest.stepCount && template.manifest.stepCount > 1))) return;

          // Go to previous step
          handlePreviousStep(selectedItemId);
        },
        preventDefault: true
      },
      // Number keys 1-9 and 0 for quick item selection
      ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((key, index) => ({
        key,
        description: `Select item ${index + 1}`,
        handler: () => {
          if (!rundown || !rundown.items.length) return;

          // 0 = 10th item, 1 = 1st item, etc.
          const itemIndex = key === '0' ? 9 : index;

          if (itemIndex < rundown.items.length) {
            const item = rundown.items[itemIndex];
            setSelectedItemId(item.id);

            // Scroll item into view
            const element = document.querySelector(`[data-item-id="${item.id}"]`);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }
        },
        preventDefault: true
      }))
    ]
  });

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0a0a0a',
        color: '#fff'
      }}>
        <div>Loading production mode...</div>
      </div>
    );
  }

  if (error || !project || !rundown) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0a0a0a',
        color: '#fff',
        gap: '1rem'
      }}>
        <div style={{ color: '#ff4444' }}>{error || 'Failed to load production data'}</div>
        <button
          onClick={handleExitProduction}
          style={{
            padding: '0.5rem 1rem',
            background: '#333',
            border: '1px solid #555',
            borderRadius: '4px',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          Back to Project
        </button>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#0a0a0a',
      color: '#fff',
      overflow: 'hidden'
    }}>
      {/* Header Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1rem',
        background: '#1a1a1a',
        borderBottom: '1px solid #333'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={handleExitProduction}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: '#333',
              border: '1px solid #555',
              borderRadius: '4px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            <ArrowLeft size={16} />
            Exit Production Mode
          </button>
          <div style={{ borderLeft: '1px solid #555', height: '24px' }} />
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '1rem' }}>{rundown.name}</div>
            <div style={{ fontSize: '0.75rem', color: '#888' }}>{project.name}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Keyboard Shortcuts Button */}
          <button
            onClick={() => setShowKeyboardShortcuts(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: '#555',
              border: '1px solid #666',
              borderRadius: '4px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: '500'
            }}
            title="Keyboard Shortcuts"
          >
            <Keyboard size={16} />
            Shortcuts
          </button>

          {/* Add Template Button */}
          <button
            onClick={() => setShowTemplateSelector(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: '#4a7c9e',
              border: '1px solid #5a8cae',
              borderRadius: '4px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: '500'
            }}
            title="Add Template to Rundown"
          >
            <Plus size={16} />
            Add Template
          </button>

          <div style={{ borderLeft: '1px solid #555', height: '24px' }} />

          {/* Graphics Window Toggle */}
          <button
            onClick={toggleGraphicsWindow}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: graphicsWindowVisible ? '#4a9e4a' : '#333',
              border: `1px solid ${graphicsWindowVisible ? '#5ab85a' : '#555'}`,
              borderRadius: '4px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
            title={graphicsWindowVisible ? 'Hide Graphics Window' : 'Show Graphics Window'}
          >
            {graphicsWindowVisible ? <Monitor size={16} /> : <MonitorOff size={16} />}
            {graphicsWindowVisible ? 'Graphics ON' : 'Graphics OFF'}
          </button>

          <div style={{ fontSize: '0.875rem', color: '#888' }}>
            {rundown.items.length} items
          </div>
        </div>
      </div>

      {/* Main Production Area - 4 Panel Layout */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem', overflow: 'hidden' }}>
        {/* Top Section - Preview Panels (40% height) - HIDDEN FOR NOW */}
        {/* <div style={{ height: '40%', display: 'flex', gap: '1rem' }}>
          {/* Data Preview Panel Placeholder */}
          {/* <div style={{
            flex: 1,
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#666',
            fontSize: '0.875rem'
          }}>
            Data Preview Panel (To be rebuilt)
          </div> */}
          {/* Program Preview Panel Placeholder */}
          {/* <div style={{
            flex: 1,
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#666',
            fontSize: '0.875rem'
          }}>
            Program Preview Panel (To be rebuilt)
          </div>
        </div> */}

        {/* Bottom Section - Rundown List + Settings Panel (100% height) */}
        <div style={{ flex: 1, display: 'flex', gap: '1rem', overflow: 'hidden' }}>
          {/* Rundown List - Left Side */}
          <div style={{
            flex: '0 0 60%',
            display: 'flex',
            flexDirection: 'column',
            minWidth: '400px'
          }}>
            <RundownItemList
              items={rundown.items}
              templates={templates}
              selectedItemId={selectedItemId}
              onSelectItem={(itemId) => {
                setSelectedItemId(itemId);
              }}
              onPlayItem={handlePlayItem}
              onStopItem={handleStopItem}
              onNextStep={handleNextStep}
              onDeleteItem={async (itemId) => {
                if (!project || !rundown) return;

                try {
                  // Remove item from rundown using the correct IPC handler
                  const result = await window.electronAPI.invoke('rundown:removeItem', project.id, rundown.id, itemId);

                  if (result && result.success) {
                    // Update local state by removing the item
                    setRundown({
                      ...rundown,
                      items: rundown.items.filter(item => item.id !== itemId)
                    });

                    // Clear selection if deleted item was selected
                    if (selectedItemId === itemId) {
                      setSelectedItemId(null);
                    }
                  } else {
                    setError(result?.error || 'Failed to delete item');
                  }
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to delete item');
                }
              }}
              onReorderItems={async (itemIds) => {
                if (!project || !rundown) return;

                // OPTIMISTIC UPDATE: Update UI immediately
                const itemMap = new Map(rundown.items.map(item => [item.id, item]));
                const reorderedItems = itemIds.map(id => itemMap.get(id)!).filter(Boolean);

                setRundown({
                  ...rundown,
                  items: reorderedItems
                });

                // Send command to backend
                try {
                  const result = await window.electronAPI.invoke('rundown:reorderItems', project.id, rundown.id, itemIds);

                  if (!result || !result.success) {
                    setError(result?.error || 'Failed to reorder items');
                    // Revert on error - reload rundown
                    const reloadedRundown = await window.electronAPI.invoke('rundown:get', project.id, rundown.id);
                    if (reloadedRundown && reloadedRundown.success && reloadedRundown.data) {
                      setRundown(reloadedRundown.data);
                    }
                  }
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to reorder items');
                  // Revert on error - reload rundown
                  try {
                    const reloadedRundown = await window.electronAPI.invoke('rundown:get', project.id, rundown.id);
                    if (reloadedRundown && reloadedRundown.success && reloadedRundown.data) {
                      setRundown(reloadedRundown.data);
                    }
                  } catch (reloadErr) {
                    // Ignore reload error
                  }
                }
              }}
            />
          </div>

          {/* Template Settings Panel - Right Side (Always Visible) */}
          <div style={{ flex: '0 0 40%', minWidth: '350px', display: 'flex', flexDirection: 'column' }}>
            <TemplateSettingsPanel
              item={selectedItemId ? rundown.items.find(i => i.id === selectedItemId) || null : null}
              template={selectedItemId ? templates.find(t => t.manifest.id === rundown.items.find(i => i.id === selectedItemId)?.templateId) || null : null}
              project={project}
              rundown={rundown}
              onPlay={handlePlayItem}
              onStop={handleStopItem}
              onNextStep={handleNextStep}
              onSave={async (itemId, data) => {
                if (!project || !rundown) return;

                try {
                  // Update the rundown item
                  await window.electronAPI.invoke('rundown:updateItem',
                    project.id,
                    rundown.id,
                    itemId,
                    data
                  );

                  // Find the item to check if it's currently playing
                  const item = rundown.items.find(i => i.id === itemId);

                  // If the item is currently playing and has LiveResults data, update the graphic
                  if (item?.onair && item?.liveResultsData?.competitionId && item?.liveResultsData?.className) {
                    try {
                      // Fetch fresh data with the updated datasource values
                      const template = templates.find(t => t.manifest.id === item.templateId);
                      if (template?.dataSourceConfig) {
                        const mappedData = await window.electronAPI.invoke('data:fetchMappedData', {
                          dataSourceConfig: template.dataSourceConfig,
                          competitionId: rundown.dataSource?.competitionId || item.liveResultsData.competitionId,
                          dataSourceValues: item.liveResultsData.dataSourceValues || {},
                          rundownSettings: rundown.settings,
                          dataSourceId: rundown.dataSource?.sourceId
                        });

                        // Update the playing graphic with new data
                        if (mappedData.success) {
                          await window.electronAPI.invoke('playback:update',
                            project.id,
                            rundown.id,
                            itemId,
                            mappedData.data
                          );
                        }
                      }
                    } catch (updateErr) {
                      console.warn('Failed to update playing graphic:', updateErr);
                      // Don't fail the save if graphic update fails
                    }
                  }

                  // Update local state
                  setRundown({
                    ...rundown,
                    items: rundown.items.map(i =>
                      i.id === itemId ? { ...i, ...data } : i
                    )
                  });

                  toast.success('Item saved successfully');
                } catch (err) {
                  const errorMessage = err instanceof Error ? err.message : 'Failed to save item';
                  toast.error(errorMessage);
                  setError(errorMessage);
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Output Information Footer */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.5rem 1rem',
        background: '#1a1a1a',
        borderTop: '1px solid #333',
        fontSize: '0.75rem',
        gap: '1rem'
      }}>
        {/* Web Server Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: webInfo?.isRunning ? '#4a9e4a' : '#9e4a4a'
            }} />
            <span style={{ color: '#888' }}>Web Server:</span>
            <span style={{ fontFamily: 'monospace', color: '#4a7c9e' }}>
              {webInfo?.localUrls?.[0]?.url || webInfo?.localhostUrl || 'http://localhost:5657/output'}
            </span>
          </div>
        </div>

        {/* NDI Output Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {ndiInfo?.available ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: '#888' }}>NDI:</span>
                <span style={{ fontFamily: 'monospace' }}>
                  {ndiInfo.name || 'OL-Grafik Output'}
                </span>
              </div>
              <button
                onClick={toggleNDI}
                style={{
                  padding: '0.25rem 0.75rem',
                  background: ndiInfo.active ? '#4a9e4a' : '#333',
                  border: `1px solid ${ndiInfo.active ? '#5ab85a' : '#555'}`,
                  borderRadius: '3px',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.75rem'
                }}
              >
                {ndiInfo.active ? 'ON' : 'OFF'}
              </button>
              {ndiInfo.active && (
                <span style={{ color: '#888' }}>
                  {ndiInfo.frameCount || 0} frames @ {ndiInfo.fps || 30} fps
                </span>
              )}
            </>
          ) : (
            <span style={{ color: '#666' }}>NDI: Not Available</span>
          )}
        </div>
      </div>

      {/* Template Selector Modal */}
      {showTemplateSelector && (() => {
        // Filter templates based on rundown's allowedTemplates
        // If allowedTemplates is undefined or empty, show all templates
        const filteredTemplates = rundown?.allowedTemplates && rundown.allowedTemplates.length > 0
          ? templates.filter(t => rundown.allowedTemplates!.includes(t.manifest.id))
          : templates;

        return (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}
            onClick={() => setShowTemplateSelector(false)}
          >
            <div
              style={{
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '8px',
                padding: '1.5rem',
                maxWidth: '800px',
                maxHeight: '80vh',
                overflow: 'auto',
                width: '90%'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Select Template</h2>
              {rundown?.allowedTemplates && rundown.allowedTemplates.length > 0 && (
                <p style={{ fontSize: '0.875rem', color: '#888', marginBottom: '1rem' }}>
                  Showing {filteredTemplates.length} allowed template{filteredTemplates.length !== 1 ? 's' : ''} for this rundown
                </p>
              )}
              {filteredTemplates.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
                  <p>No templates available for this rundown.</p>
                  <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
                    Configure the template allowlist in Project View to add templates.
                  </p>
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: '1rem'
                }}>
                  {filteredTemplates.map((template) => (
                <div
                  key={template.manifest.id}
                  onClick={() => handleAddTemplate(template.manifest.id)}
                  style={{
                    padding: '1rem',
                    background: '#0a0a0a',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#4a7c9e';
                    e.currentTarget.style.background = '#1a1a1a';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#333';
                    e.currentTarget.style.background = '#0a0a0a';
                  }}
                >
                  <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                    {template.manifest.name}
                  </div>
                  {template.manifest.description && (
                    <div style={{ fontSize: '0.75rem', color: '#888', lineHeight: '1.4' }}>
                      {template.manifest.description}
                    </div>
                  )}
                  </div>
                ))}
              </div>
              )}
              <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowTemplateSelector(false)}
                  style={{
                    padding: '0.5rem 1rem',
                    background: '#333',
                    border: '1px solid #555',
                    borderRadius: '4px',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Keyboard Shortcuts Modal */}
      {showKeyboardShortcuts && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setShowKeyboardShortcuts(false)}
        >
          <div
            style={{
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '8px',
              padding: '1.5rem',
              maxWidth: '600px',
              width: '90%'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0 }}>Keyboard Shortcuts</h2>
              <button
                onClick={() => setShowKeyboardShortcuts(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#888',
                  cursor: 'pointer',
                  padding: '0.25rem'
                }}
                title="Close (Esc)"
              >
                <X size={24} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: '#222', borderRadius: '4px' }}>
                <span>Play/Stop selected item</span>
                <kbd style={{ background: '#333', padding: '0.25rem 0.5rem', borderRadius: '4px', fontFamily: 'monospace' }}>Space</kbd>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: '#222', borderRadius: '4px' }}>
                <span>Clear all graphics</span>
                <kbd style={{ background: '#333', padding: '0.25rem 0.5rem', borderRadius: '4px', fontFamily: 'monospace' }}>Escape</kbd>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: '#222', borderRadius: '4px' }}>
                <span>Select previous item</span>
                <kbd style={{ background: '#333', padding: '0.25rem 0.5rem', borderRadius: '4px', fontFamily: 'monospace' }}>↑</kbd>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: '#222', borderRadius: '4px' }}>
                <span>Select next item</span>
                <kbd style={{ background: '#333', padding: '0.25rem 0.5rem', borderRadius: '4px', fontFamily: 'monospace' }}>↓</kbd>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: '#222', borderRadius: '4px' }}>
                <span>Previous step (multi-step graphics)</span>
                <kbd style={{ background: '#333', padding: '0.25rem 0.5rem', borderRadius: '4px', fontFamily: 'monospace' }}>←</kbd>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: '#222', borderRadius: '4px' }}>
                <span>Next step (multi-step graphics)</span>
                <kbd style={{ background: '#333', padding: '0.25rem 0.5rem', borderRadius: '4px', fontFamily: 'monospace' }}>→</kbd>
              </div>
            </div>

            <div style={{ marginTop: '1.5rem', textAlign: 'right' }}>
              <button
                onClick={() => setShowKeyboardShortcuts(false)}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#4a7c9e',
                  border: '1px solid #5a8cae',
                  borderRadius: '4px',
                  color: '#fff',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

