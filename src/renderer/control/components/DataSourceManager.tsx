/**
 * Data Source Manager Component
 * Manages data source configurations in Settings > Data tab
 */

import { useState, useEffect } from 'react';
import { DataSourceConfig, DataSourceRegistryEntry } from '../../../shared/types/dataSource';
import { useToast } from '../contexts/ToastContext';
import './DataSourceManager.css';

export function DataSourceManager() {
  const toast = useToast();
  const [dataSources, setDataSources] = useState<DataSourceConfig[]>([]);
  const [availableTypes, setAvailableTypes] = useState<DataSourceRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    loadDataSources();
    loadAvailableTypes();
  }, []);

  const loadDataSources = async () => {
    try {
      const result = await window.electronAPI.invoke('dataSource:getAll');
      if (result.success) {
        setDataSources(result.data || []);
      } else {
        toast.error(`Failed to load data sources: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to load data sources: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableTypes = async () => {
    try {
      const result = await window.electronAPI.invoke('dataSource:getTypes');
      if (result.success) {
        setAvailableTypes(result.data || []);
      } else {
        toast.error(`Failed to load data source types: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to load data source types: ${errorMessage}`);
    }
  };

  const handleAdd = () => {
    setShowAddDialog(true);
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Are you sure you want to delete this data source?`)) {
      return;
    }

    try {
      const result = await window.electronAPI.invoke('dataSource:delete', id);
      if (result.success) {
        toast.success('Data source deleted successfully');
        await loadDataSources();
      } else {
        toast.error(`Failed to delete data source: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to delete data source: ${errorMessage}`);
    }
  };

  const handleTest = async (config: DataSourceConfig) => {
    setTestingId(config.id);
    try {
      const result = await window.electronAPI.invoke('dataSource:test', config);
      if (result.success) {
        toast.success('Connection test successful!');
      } else {
        toast.error(`Connection test failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Connection test failed: ${errorMessage}`);
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleEnabled = async (config: DataSourceConfig) => {
    const updatedConfig = { ...config, enabled: !config.enabled };
    
    try {
      const result = await window.electronAPI.invoke('dataSource:update', config.id, updatedConfig);
      if (result.success) {
        toast.success(`Data source ${updatedConfig.enabled ? 'enabled' : 'disabled'}`);
        await loadDataSources();
      } else {
        toast.error(`Failed to update data source: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to update data source: ${errorMessage}`);
    }
  };

  if (loading) {
    return <div className="data-source-manager loading">Loading data sources...</div>;
  }

  return (
    <div className="data-source-manager">
      <div className="data-source-header">
        <h3>Data Sources</h3>
        <button className="btn-primary" onClick={handleAdd}>
          + Add Data Source
        </button>
      </div>

      {dataSources.length === 0 ? (
        <div className="empty-state">
          <p>No data sources configured.</p>
          <p className="help-text">
            Data sources provide competition data for graphics templates.
            Click "Add Data Source" to configure LiveResults or other data providers.
          </p>
        </div>
      ) : (
        <div className="data-source-list">
          {dataSources.map((ds) => (
            <div key={ds.id} className={`data-source-item ${ds.enabled ? 'enabled' : 'disabled'}`}>
              <div className="data-source-info">
                <div className="data-source-name">
                  <strong>{ds.name}</strong>
                  <span className="data-source-type">{ds.type}</span>
                  {!ds.enabled && <span className="badge-disabled">Disabled</span>}
                </div>
                <div className="data-source-config">
                  {ds.type === 'liveresults' && (
                    <span className="config-detail">
                      URL: {(ds.config as any).baseUrl || 'Not configured'}
                    </span>
                  )}
                  {ds.type === 'mysql' && (
                    <span className="config-detail">
                      Host: {(ds.config as any).host || 'Not configured'} |
                      Database: {(ds.config as any).database || 'Not configured'}
                    </span>
                  )}
                </div>
              </div>
              <div className="data-source-actions">
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => handleTest(ds)}
                  disabled={testingId === ds.id}
                >
                  {testingId === ds.id ? 'Testing...' : 'Test'}
                </button>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => handleToggleEnabled(ds)}
                >
                  {ds.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => handleEdit(ds.id)}
                >
                  Edit
                </button>
                <button
                  className="btn-danger btn-sm"
                  onClick={() => handleDelete(ds.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddDialog && (
        <DataSourceDialog
          availableTypes={availableTypes}
          onClose={() => setShowAddDialog(false)}
          onSave={async () => {
            setShowAddDialog(false);
            await loadDataSources();
          }}
        />
      )}

      {editingId && (
        <DataSourceDialog
          availableTypes={availableTypes}
          editingConfig={dataSources.find(ds => ds.id === editingId)}
          onClose={() => setEditingId(null)}
          onSave={async () => {
            setEditingId(null);
            await loadDataSources();
          }}
        />
      )}
    </div>
  );
}

interface DataSourceDialogProps {
  availableTypes: DataSourceRegistryEntry[];
  editingConfig?: DataSourceConfig;
  onClose: () => void;
  onSave: () => void;
}

function DataSourceDialog({ availableTypes, editingConfig, onClose, onSave }: DataSourceDialogProps) {
  const toast = useToast();
  const [config, setConfig] = useState<Partial<DataSourceConfig>>(
    editingConfig || {
      id: '',
      name: '',
      type: 'liveresults',
      enabled: true,
      config: {}
    }
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    // Validation
    if (!config.id || !config.name || !config.type) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSaving(true);
    try {
      const result = editingConfig
        ? await window.electronAPI.invoke('dataSource:update', editingConfig.id, config as DataSourceConfig)
        : await window.electronAPI.invoke('dataSource:create', config as DataSourceConfig);

      if (result.success) {
        toast.success(`Data source ${editingConfig ? 'updated' : 'created'} successfully`);
        onSave();
      } else {
        toast.error(`Failed to save data source: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to save data source: ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{editingConfig ? 'Edit Data Source' : 'Add Data Source'}</h3>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>ID *</label>
            <input
              type="text"
              value={config.id || ''}
              onChange={(e) => setConfig({ ...config, id: e.target.value })}
              disabled={!!editingConfig}
              placeholder="e.g., liveresults-default"
            />
          </div>
          <div className="form-group">
            <label>Name *</label>
            <input
              type="text"
              value={config.name || ''}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              placeholder="e.g., LiveResults (Default)"
            />
          </div>
          <div className="form-group">
            <label>Type *</label>
            <select
              value={config.type || 'liveresults'}
              onChange={(e) => setConfig({ ...config, type: e.target.value as any })}
              disabled={!!editingConfig}
            >
              {availableTypes.map((type) => (
                <option key={type.type} value={type.type}>
                  {type.displayName}
                </option>
              ))}
            </select>
          </div>
          {config.type === 'liveresults' && (
            <>
              <div className="form-group">
                <label>Base URL *</label>
                <input
                  type="text"
                  value={(config.config as any)?.baseUrl || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    config: { ...(config.config || {}), baseUrl: e.target.value }
                  })}
                  placeholder="https://liveresultat.orientering.se"
                />
              </div>
              <div className="form-group">
                <label>Cache Interval (ms)</label>
                <input
                  type="number"
                  value={(config.config as any)?.cacheInterval || 15000}
                  onChange={(e) => setConfig({
                    ...config,
                    config: { ...(config.config || {}), cacheInterval: parseInt(e.target.value) }
                  })}
                />
              </div>
              <div className="form-group">
                <label>Timeout (ms)</label>
                <input
                  type="number"
                  value={(config.config as any)?.timeout || 10000}
                  onChange={(e) => setConfig({
                    ...config,
                    config: { ...(config.config || {}), timeout: parseInt(e.target.value) }
                  })}
                />
              </div>
            </>
          )}
          {config.type === 'mysql' && (
            <>
              <div className="form-group">
                <label>Host *</label>
                <input
                  type="text"
                  value={(config.config as any)?.host || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    config: { ...(config.config || {}), host: e.target.value }
                  })}
                  placeholder="localhost"
                />
                <small className="help-text">Database host (e.g., localhost, 192.168.1.100)</small>
              </div>
              <div className="form-group">
                <label>Port</label>
                <input
                  type="number"
                  value={(config.config as any)?.port || 3306}
                  onChange={(e) => setConfig({
                    ...config,
                    config: { ...(config.config || {}), port: parseInt(e.target.value) }
                  })}
                />
                <small className="help-text">Default: 3306</small>
              </div>
              <div className="form-group">
                <label>Database Name *</label>
                <input
                  type="text"
                  value={(config.config as any)?.database || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    config: { ...(config.config || {}), database: e.target.value }
                  })}
                  placeholder="mop"
                />
              </div>
              <div className="form-group">
                <label>Username *</label>
                <input
                  type="text"
                  value={(config.config as any)?.user || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    config: { ...(config.config || {}), user: e.target.value }
                  })}
                  placeholder="root"
                />
              </div>
              <div className="form-group">
                <label>Password *</label>
                <input
                  type="password"
                  value={(config.config as any)?.password || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    config: { ...(config.config || {}), password: e.target.value }
                  })}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
                <small className="help-text">Password is stored securely in config.json</small>
              </div>
              <div className="form-group">
                <label>Connection Timeout (ms)</label>
                <input
                  type="number"
                  value={(config.config as any)?.connectTimeout || 10000}
                  onChange={(e) => setConfig({
                    ...config,
                    config: { ...(config.config || {}), connectTimeout: parseInt(e.target.value) }
                  })}
                />
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={(config.config as any)?.ssl?.enabled || false}
                    onChange={(e) => setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        ssl: { enabled: e.target.checked, rejectUnauthorized: true }
                      }
                    })}
                  />
                  Enable SSL/TLS
                </label>
                <small className="help-text">Use encrypted connection to database</small>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

