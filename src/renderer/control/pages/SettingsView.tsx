/**
 * Settings View Page
 * Comprehensive application settings management
 */

import { useState, useEffect } from 'react';
import {
  Settings,
  Save,
  RotateCcw,
  AlertCircle,
  CheckCircle,
  Server,
  Database,
  Monitor,
  Sliders,
  Info
} from 'lucide-react';
import { NDIOutputPanel } from '../components/NDIOutputPanel';
import { useToast } from '../contexts/ToastContext';
import { DataSourceManager } from '../components/DataSourceManager';

interface AppConfig {
  general: {
    hostname: string;
    port: number;
    wsPort: number;
    dataroot: string;
    logfolder: string;
    loglevel: 'error' | 'warn' | 'info' | 'verbose' | 'debug';
    langfile: string;
    launchBrowser: boolean;
    resolution: 'HD' | '4K' | 'AUTO';
  };
  output: {
    ndi: {
      enabled: boolean;
      name: string;
      fps: number;
      colorFormat: 'BGRA' | 'RGBA';
    };
    web: {
      enabled: boolean;
      cors: boolean;
    };
  };
}

type TabId = 'general' | 'output' | 'data' | 'advanced';

export function SettingsView() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [editedConfig, setEditedConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [paths, setPaths] = useState<{
    configPath: string;
    dataroot: string;
    logfolder: string;
    templatesDir: string;
  } | null>(null);

  // Load configuration on mount
  useEffect(() => {
    loadConfig();
    loadPaths();
  }, []);

  // Track changes
  useEffect(() => {
    if (config && editedConfig) {
      setHasChanges(JSON.stringify(config) !== JSON.stringify(editedConfig));
    }
  }, [config, editedConfig]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await window.electronAPI.invoke('settings:get');
      if (response.success) {
        setConfig(response.data);
        setEditedConfig(response.data);
      } else {
        setMessage({ type: 'error', text: `Failed to load settings: ${response.error}` });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Error loading settings: ${error}` });
    } finally {
      setLoading(false);
    }
  };

  const loadPaths = async () => {
    try {
      const response = await window.electronAPI.invoke('settings:getPaths');
      if (response.success) {
        setPaths(response.data);
      } else {
        toast.error(`Failed to load paths: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to load paths: ${errorMessage}`);
    }
  };

  const handleSave = async () => {
    if (!editedConfig) return;

    setSaving(true);
    setMessage(null);

    try {
      const response = await window.electronAPI.invoke('settings:update', editedConfig);

      if (response.success) {
        setConfig(editedConfig);
        setHasChanges(false);

        if (response.data?.requiresRestart) {
          setMessage({
            type: 'warning',
            text: 'Settings saved successfully! Please restart the application for changes to take effect.'
          });
        } else {
          setMessage({
            type: 'success',
            text: 'Settings saved successfully!'
          });

          // Auto-hide success message after 3 seconds
          setTimeout(() => setMessage(null), 3000);
        }
      } else {
        setMessage({ type: 'error', text: `Failed to save settings: ${response.error}` });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Error saving settings: ${error}` });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (config) {
      setEditedConfig(config);
      setHasChanges(false);
      setMessage(null);
    }
  };

  const updateConfig = (path: string, value: any) => {
    if (!editedConfig) return;

    // Deep clone the config to ensure React detects the change
    const newConfig = JSON.parse(JSON.stringify(editedConfig));
    const parts = path.split('.');

    let current: any = newConfig;
    for (let i = 0; i < parts.length - 1; i++) {
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;

    setEditedConfig(newConfig);
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <Settings size={48} style={{ opacity: 0.3 }} />
          <p>Loading settings...</p>
        </div>
      </div>
    );
  }

  if (!editedConfig) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <AlertCircle size={48} style={{ color: '#ef4444' }} />
          <p>Failed to load settings</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <Settings size={24} />
          <h1 style={styles.title}>Application Settings</h1>
        </div>
        <div style={styles.headerRight}>
          {hasChanges && (
            <>
              <button
                onClick={handleReset}
                style={styles.resetButton}
                disabled={saving}
              >
                <RotateCcw size={16} />
                Reset
              </button>
              <button
                onClick={handleSave}
                style={styles.saveButton}
                disabled={saving}
              >
                <Save size={16} />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Message Banner */}
      {message && (
        <div style={{
          ...styles.message,
          ...(message.type === 'success' ? styles.messageSuccess : {}),
          ...(message.type === 'error' ? styles.messageError : {}),
          ...(message.type === 'warning' ? styles.messageWarning : {})
        }}>
          {message.type === 'success' && <CheckCircle size={20} />}
          {message.type === 'error' && <AlertCircle size={20} />}
          {message.type === 'warning' && <Info size={20} />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          onClick={() => setActiveTab('general')}
          style={{
            ...styles.tab,
            ...(activeTab === 'general' ? styles.tabActive : {})
          }}
        >
          <Sliders size={18} />
          General
        </button>
        <button
          onClick={() => setActiveTab('output')}
          style={{
            ...styles.tab,
            ...(activeTab === 'output' ? styles.tabActive : {})
          }}
        >
          <Monitor size={18} />
          Output
        </button>
        <button
          onClick={() => setActiveTab('data')}
          style={{
            ...styles.tab,
            ...(activeTab === 'data' ? styles.tabActive : {})
          }}
        >
          <Database size={18} />
          Data
        </button>
        <button
          onClick={() => setActiveTab('advanced')}
          style={{
            ...styles.tab,
            ...(activeTab === 'advanced' ? styles.tabActive : {})
          }}
        >
          <Server size={18} />
          Advanced
        </button>
      </div>

      {/* Tab Content */}
      <div style={styles.content}>
        {activeTab === 'general' && renderGeneralTab()}
        {activeTab === 'output' && renderOutputTab()}
        {activeTab === 'data' && renderDataTab()}
        {activeTab === 'advanced' && renderAdvancedTab()}
      </div>
    </div>
  );

  // Tab render functions
  function renderGeneralTab() {
    if (!editedConfig) return null;

    return (
      <div style={styles.tabContent}>
        <h2 style={styles.sectionTitle}>General Settings</h2>

        <div style={styles.formGroup}>
          <label style={styles.label}>
            Application Name
            <span style={styles.restartBadge}>Requires Restart</span>
          </label>
          <input
            type="text"
            value={editedConfig.general.hostname}
            onChange={(e) => updateConfig('general.hostname', e.target.value)}
            style={styles.input}
            placeholder="OL-Grafik"
          />
          <p style={styles.helpText}>Display name for the application</p>
        </div>

        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>
              Web Server Port
              <span style={styles.restartBadge}>Requires Restart</span>
            </label>
            <input
              type="number"
              value={editedConfig.general.port}
              onChange={(e) => updateConfig('general.port', parseInt(e.target.value))}
              style={styles.input}
              min="1024"
              max="65535"
            />
            <p style={styles.helpText}>Port for web server (1024-65535)</p>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>
              WebSocket Port
              <span style={styles.restartBadge}>Requires Restart</span>
            </label>
            <input
              type="number"
              value={editedConfig.general.wsPort}
              onChange={(e) => updateConfig('general.wsPort', parseInt(e.target.value))}
              style={styles.input}
              min="1024"
              max="65535"
            />
            <p style={styles.helpText}>Port for WebSocket server (1024-65535)</p>
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>
            Graphics Resolution
            <span style={styles.restartBadge}>Requires Restart</span>
          </label>
          <select
            value={editedConfig.general.resolution}
            onChange={(e) => updateConfig('general.resolution', e.target.value)}
            style={styles.select}
          >
            <option value="HD">HD (1920x1080)</option>
            <option value="4K">4K (3840x2160)</option>
            <option value="AUTO">Auto (Match Display)</option>
          </select>
          <p style={styles.helpText}>Graphics window resolution</p>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Log Level</label>
          <select
            value={editedConfig.general.loglevel}
            onChange={(e) => updateConfig('general.loglevel', e.target.value)}
            style={styles.select}
          >
            <option value="error">Error</option>
            <option value="warn">Warning</option>
            <option value="info">Info</option>
            <option value="verbose">Verbose</option>
            <option value="debug">Debug</option>
          </select>
          <p style={styles.helpText}>Application logging level</p>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={editedConfig.general.launchBrowser}
              onChange={(e) => updateConfig('general.launchBrowser', e.target.checked)}
              style={styles.checkbox}
            />
            Launch browser on startup
          </label>
          <p style={styles.helpText}>Automatically open web interface when application starts</p>
        </div>
      </div>
    );
  }

  function renderOutputTab() {
    if (!editedConfig) return null;

    return (
      <div style={styles.tabContent}>
        <h2 style={styles.sectionTitle}>Output Settings</h2>

        {/* Web Server Section */}
        <div style={styles.section}>
          <h3 style={styles.subsectionTitle}>Web Server Output</h3>

          <div style={styles.formGroup}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={editedConfig.output.web.enabled}
                onChange={(e) => updateConfig('output.web.enabled', e.target.checked)}
                style={styles.checkbox}
              />
              Enable Web Server Output
            </label>
            <p style={styles.helpText}>Serve graphics via HTTP for OBS, vMix, and web browsers</p>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={editedConfig.output.web.cors}
                onChange={(e) => updateConfig('output.web.cors', e.target.checked)}
                style={styles.checkbox}
              />
              Enable CORS
              <span style={styles.restartBadge}>Requires Restart</span>
            </label>
            <p style={styles.helpText}>Allow cross-origin requests (required for some integrations)</p>
          </div>
        </div>

        {/* NDI Section */}
        <div style={styles.section}>
          <h3 style={styles.subsectionTitle}>NDI Output</h3>

          {/* NDI Output Panel Component */}
          <div style={{ marginTop: '16px' }}>
            <NDIOutputPanel />
          </div>

          <div style={{ marginTop: '16px', padding: '12px 16px', background: '#2a2a2a', borderRadius: '6px', border: '1px solid #3a3a3a' }}>
            <p style={{ margin: 0, fontSize: '13px', color: '#aaa', lineHeight: '1.6' }}>
              💡 <strong style={{ color: '#ccc' }}>Tip:</strong> Use the settings button (⚙️) in the NDI Output Panel above to configure the source name and frame rate. Changes take effect immediately without restarting the application.
            </p>
          </div>
        </div>
      </div>
    );
  }

  function renderDataTab() {
    if (!editedConfig) return null;

    return (
      <div style={styles.tabContent}>
        <h2 style={styles.sectionTitle}>Data Settings</h2>

        {/* Data Sources Section */}
        <div style={styles.section}>
          <DataSourceManager />
        </div>

        {/* Directories Section */}
        <div style={styles.section}>
          <h3 style={styles.subsectionTitle}>Directories</h3>

          <div style={styles.formGroup}>
            <label style={styles.label}>
              Data Root Directory
              <span style={styles.restartBadge}>Requires Restart</span>
            </label>
            <input
              type="text"
              value={editedConfig.general.dataroot}
              onChange={(e) => updateConfig('general.dataroot', e.target.value)}
              style={styles.input}
              placeholder="/path/to/DATAROOT"
            />
            <p style={styles.helpText}>Directory for projects and rundowns</p>
            {paths && <p style={styles.pathInfo}>Current: {paths.dataroot}</p>}
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>
              Log Folder
              <span style={styles.restartBadge}>Requires Restart</span>
            </label>
            <input
              type="text"
              value={editedConfig.general.logfolder}
              onChange={(e) => updateConfig('general.logfolder', e.target.value)}
              style={styles.input}
              placeholder="/path/to/LOG"
            />
            <p style={styles.helpText}>Directory for application logs</p>
            {paths && <p style={styles.pathInfo}>Current: {paths.logfolder}</p>}
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Templates Directory</label>
            <input
              type="text"
              value={paths?.templatesDir || ''}
              style={{ ...styles.input, ...styles.inputDisabled }}
              disabled
            />
            <p style={styles.helpText}>Templates directory (read-only)</p>
          </div>
        </div>
      </div>
    );
  }

  function renderAdvancedTab() {
    if (!editedConfig) return null;

    return (
      <div style={styles.tabContent}>
        <h2 style={styles.sectionTitle}>Advanced Settings</h2>

        <div style={styles.formGroup}>
          <label style={styles.label}>Language File</label>
          <input
            type="text"
            value={editedConfig.general.langfile}
            onChange={(e) => updateConfig('general.langfile', e.target.value)}
            style={styles.input}
            placeholder="en.json"
          />
          <p style={styles.helpText}>Language file for localization</p>
        </div>

        {/* Configuration File Info */}
        <div style={styles.section}>
          <h3 style={styles.subsectionTitle}>Configuration File</h3>
          {paths && (
            <div style={styles.infoBox}>
              <Info size={20} />
              <div>
                <p style={styles.infoText}>
                  <strong>Location:</strong> {paths.configPath}
                </p>
                <p style={styles.infoText}>
                  Settings are automatically saved to this file. You can manually edit it when the application is closed.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
}

// Styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#0a0a0a',
    color: '#fff'
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '1rem',
    color: '#666'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.5rem 2rem',
    borderBottom: '1px solid #333',
    background: '#111'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  },
  headerRight: {
    display: 'flex',
    gap: '0.75rem'
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: 600
  },
  saveButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 1rem',
    background: '#10b981',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500
  },
  resetButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 1rem',
    background: '#374151',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500
  },
  message: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '1rem 2rem',
    borderBottom: '1px solid #333'
  },
  messageSuccess: {
    background: '#064e3b',
    color: '#10b981'
  },
  messageError: {
    background: '#7f1d1d',
    color: '#ef4444'
  },
  messageWarning: {
    background: '#78350f',
    color: '#f59e0b'
  },
  tabs: {
    display: 'flex',
    gap: '0.5rem',
    padding: '1rem 2rem 0',
    borderBottom: '1px solid #333'
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.75rem 1.5rem',
    background: 'transparent',
    color: '#888',
    border: 'none',
    borderBottomWidth: '2px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500,
    transition: 'all 0.2s'
  },
  tabActive: {
    color: '#fff',
    borderBottomColor: '#3b82f6'
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '2rem'
  },
  tabContent: {
    maxWidth: '800px',
    margin: '0 auto'
  },
  sectionTitle: {
    margin: '0 0 1.5rem 0',
    fontSize: '1.25rem',
    fontWeight: 600
  },
  section: {
    marginTop: '2rem',
    paddingTop: '2rem',
    borderTop: '1px solid #333'
  },
  subsectionTitle: {
    margin: '0 0 1rem 0',
    fontSize: '1rem',
    fontWeight: 600,
    color: '#3b82f6'
  },
  formGroup: {
    marginBottom: '1.5rem'
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1rem',
    marginBottom: '1.5rem'
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#d1d5db'
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#d1d5db',
    cursor: 'pointer'
  },
  input: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    background: '#1a1a1a',
    color: '#fff',
    border: '1px solid #333',
    borderRadius: '4px',
    fontSize: '0.875rem',
    outline: 'none'
  },
  inputDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed'
  },
  select: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    background: '#1a1a1a',
    color: '#fff',
    border: '1px solid #333',
    borderRadius: '4px',
    fontSize: '0.875rem',
    outline: 'none',
    cursor: 'pointer'
  },
  checkbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer'
  },
  helpText: {
    margin: '0.25rem 0 0 0',
    fontSize: '0.75rem',
    color: '#888'
  },
  pathInfo: {
    margin: '0.5rem 0 0 0',
    fontSize: '0.75rem',
    color: '#666',
    fontFamily: 'monospace'
  },
  restartBadge: {
    padding: '0.125rem 0.5rem',
    background: '#78350f',
    color: '#f59e0b',
    borderRadius: '4px',
    fontSize: '0.625rem',
    fontWeight: 600,
    textTransform: 'uppercase'
  },
  infoBox: {
    display: 'flex',
    gap: '1rem',
    padding: '1rem',
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: '4px'
  },
  infoText: {
    margin: '0.5rem 0',
    fontSize: '0.875rem',
    color: '#d1d5db'
  }
};

