import { t as tr } from "../i18n";
/**
 * Data Source Manager Component
 * Manages data source configurations in Settings > Data tab
 */

import { useState, useEffect } from "react";
import {
  DataSourceConfig,
  DataSourceRegistryEntry,
} from "../../../shared/types/dataSource";
import { useToast } from "../contexts/ToastContext";
import "./DataSourceManager.css";

export function DataSourceManager() {
  const toast = useToast();
  const [dataSources, setDataSources] = useState<DataSourceConfig[]>([]);
  const [availableTypes, setAvailableTypes] = useState<
    DataSourceRegistryEntry[]
  >([]);
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
      const result = await window.electronAPI.invoke("dataSource:getAll");
      if (result.success) {
        setDataSources(result.data || []);
      } else {
        toast.error(
          `Failed to load data sources: ${result.error || "Unknown error"}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to load data sources: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableTypes = async () => {
    try {
      const result = await window.electronAPI.invoke("dataSource:getTypes");
      if (result.success) {
        setAvailableTypes(result.data || []);
      } else {
        toast.error(
          `Failed to load data source types: ${result.error || "Unknown error"}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
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
      const result = await window.electronAPI.invoke("dataSource:delete", id);
      if (result.success) {
        toast.success("Data source deleted.");
        await loadDataSources();
      } else {
        toast.error(
          `Failed to delete data source: ${result.error || "Unknown error"}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to delete data source: ${errorMessage}`);
    }
  };

  const handleTest = async (config: DataSourceConfig) => {
    setTestingId(config.id);
    try {
      const result = await window.electronAPI.invoke("dataSource:test", config);
      if (result.success) {
        toast.success("Connection succeeded.");
      } else {
        toast.error(
          `Connection failed: ${result.error || "Check the connection settings and try again."}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      toast.error(`Connection failed: ${errorMessage}`);
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleEnabled = async (config: DataSourceConfig) => {
    const updatedConfig = { ...config, enabled: !config.enabled };

    try {
      const result = await window.electronAPI.invoke(
        "dataSource:update",
        config.id,
        updatedConfig,
      );
      if (result.success) {
        toast.success(
          `Data source ${updatedConfig.enabled ? "enabled" : "disabled"}`,
        );
        await loadDataSources();
      } else {
        toast.error(
          `Failed to update data source: ${result.error || "Unknown error"}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to update data source: ${errorMessage}`);
    }
  };

  if (loading) {
    return (
      <div className="data-source-manager loading">{tr("Loading data sources...")}</div>
    );
  }

  return (
    <div className="data-source-manager">
      <div className="data-source-header">
        <h3>{tr("Configured sources")}</h3>
        <button className="studio-button primary" onClick={handleAdd}>
           {tr("Add data source")} </button>
      </div>

      {dataSources.length === 0 ? (
        <div className="empty-state">
          <h4>{tr("No data sources configured")}</h4>
          <p className="help-text">
             {tr("Add the timing service or file source used by your events.")} </p>
        </div>
      ) : (
        <div className="data-source-list">
          {dataSources.map((ds) => (
            <div
              key={ds.id}
              className={`data-source-item ${ds.enabled ? "enabled" : "disabled"}`}
            >
              <div className="data-source-info">
                <div className="data-source-name">
                  <strong>{ds.name}</strong>
                  {ds.builtIn && (
                    <span className="data-source-type">{tr("Built in")}</span>
                  )}
                  <span className="data-source-type">{ds.type}</span>
                  {!ds.enabled && (
                    <span className="badge-disabled">{tr("Disabled")}</span>
                  )}
                </div>
                <div className="data-source-config">
                  {ds.type === "liveresults" && (
                    <span className="config-detail">
                      URL: {(ds.config as any).baseUrl || "Not configured"}
                    </span>
                  )}
                  {ds.type === "mysql" && (
                    <span className="config-detail">
                       {tr("Host:")} {(ds.config as any).host || "Not configured"} |
                      Database:{" "}
                      {(ds.config as any).database || "Not configured"}
                    </span>
                  )}
                  {ds.type === "meos" && (
                    <span className="config-detail">
                      MeOS: {(ds.config as any).url || "http://localhost:2009"}
                    </span>
                  )}
                  {ds.type === "iofxml" && (
                    <span className="config-detail">
                       {tr("File:")} {(ds.config as any).filePath || "Not configured"}
                    </span>
                  )}
                </div>
              </div>
              <div className="data-source-actions">
                <button
                  className="studio-button"
                  onClick={() => handleTest(ds)}
                  disabled={testingId === ds.id}
                >
                  {testingId === ds.id ? "Testing..." : tr("Test")}
                </button>
                <button
                  className="studio-button"
                  onClick={() => handleToggleEnabled(ds)}
                >
                  {ds.enabled ? "Disable" : "Enable"}
                </button>
                {!ds.builtIn && (
                  <>
                    <button
                      className="studio-button"
                      onClick={() => handleEdit(ds.id)}
                    >
                       {tr("Edit")} </button>
                    <button
                      className="studio-button danger"
                      onClick={() => handleDelete(ds.id)}
                    >
                       {tr("Delete")} </button>
                  </>
                )}
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
          editingConfig={dataSources.find((ds) => ds.id === editingId)}
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

function DataSourceDialog({
  availableTypes,
  editingConfig,
  onClose,
  onSave,
}: DataSourceDialogProps) {
  const toast = useToast();
  const [config, setConfig] = useState<Partial<DataSourceConfig>>(
    editingConfig || {
      id: "",
      name: "",
      type: "liveresults",
      enabled: true,
      config: {},
    },
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    // Validation
    if (!config.id || !config.name || !config.type) {
      toast.error("Please fill in all required fields");
      return;
    }

    setSaving(true);
    try {
      const result = editingConfig
        ? await window.electronAPI.invoke(
            "dataSource:update",
            editingConfig.id,
            config as DataSourceConfig,
          )
        : await window.electronAPI.invoke(
            "dataSource:create",
            config as DataSourceConfig,
          );

      if (result.success) {
        toast.success(
          `Data source ${editingConfig ? "updated" : "created"} successfully`,
        );
        onSave();
      } else {
        toast.error(
          `Failed to save data source: ${result.error || "Unknown error"}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to save data source: ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-source-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id="data-source-dialog-title">
            {editingConfig ? tr("Edit data source") : tr("Add data source")}
          </h3>
          <button
            className="icon-button"
            aria-label={tr("Close data source editor")}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>ID *</label>
            <input
              type="text"
              value={config.id || ""}
              onChange={(e) => setConfig({ ...config, id: e.target.value })}
              disabled={!!editingConfig}
              placeholder="e.g., liveresults-default"
            />
          </div>
          <div className="form-group">
            <label>{tr("Name *")}</label>
            <input
              type="text"
              value={config.name || ""}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              placeholder="e.g., LiveResults (Default)"
            />
          </div>
          <div className="form-group">
            <label>{tr("Type *")}</label>
            <select
              value={config.type || "liveresults"}
              onChange={(e) =>
                setConfig({ ...config, type: e.target.value as any })
              }
              disabled={!!editingConfig}
            >
              {availableTypes.map((type) => (
                <option key={type.type} value={type.type}>
                  {type.displayName}
                </option>
              ))}
            </select>
          </div>
          {config.type === "liveresults" && (
            <>
              <div className="form-group">
                <label>{tr("Base URL *")}</label>
                <input
                  type="text"
                  value={(config.config as any)?.baseUrl || ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        baseUrl: e.target.value,
                      },
                    })
                  }
                  placeholder="https://api.orienteering.services"
                />
              </div>
              <div className="form-group">
                <label>{tr("Poll interval (ms)")}</label>
                <input
                  type="number"
                  value={(config.config as any)?.cacheInterval || 10000}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        cacheInterval: parseInt(e.target.value),
                      },
                    })
                  }
                />
                <small className="help-text">
                   {tr("Minimum 10000 for api.orienteering.services, 15000 for the legacy api.php")} </small>
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={(config.config as any)?.push !== false}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        config: {
                          ...(config.config || {}),
                          push: e.target.checked,
                        },
                      })
                    }
                  />
                   {tr("Instant updates (push)")} </label>
                <small className="help-text">
                   {tr("REST API only: refetch as soon as Liveresultat signals a change. Polling continues as a fallback.")} </small>
              </div>
              <div className="form-group">
                <label>{tr("Timeout (ms)")}</label>
                <input
                  type="number"
                  value={(config.config as any)?.timeout || 10000}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        timeout: parseInt(e.target.value),
                      },
                    })
                  }
                />
              </div>
            </>
          )}
          {config.type === "meos" && (
            <>
              <div className="form-group">
                <label>{tr("MeOS information server *")}</label>
                <input
                  type="text"
                  value={(config.config as any)?.url || ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: { ...(config.config || {}), url: e.target.value },
                    })
                  }
                  placeholder="http://localhost:2009"
                />
                <small className="help-text">
                   {tr("In MeOS, start Services &gt; Information server. Use the MeOS computer's address if it is on another machine.")} </small>
              </div>
              <div className="form-group">
                <label>{tr("Poll interval (ms)")}</label>
                <input
                  type="number"
                  value={(config.config as any)?.pollIntervalMs || 1000}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        pollIntervalMs: parseInt(e.target.value) || undefined,
                      },
                    })
                  }
                />
                <small className="help-text">
                   {tr("Default 1000, minimum 500. Only changes are transferred after the first download.")} </small>
              </div>
              <div className="form-group">
                <label>{tr("Competition id")}</label>
                <input
                  type="number"
                  value={(config.config as any)?.competitionId || 1}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        competitionId: parseInt(e.target.value) || 1,
                      },
                    })
                  }
                />
              </div>
              <div className="form-group">
                <label>{tr("Event time zone")}</label>
                <input
                  type="text"
                  value={(config.config as any)?.timezone || ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        timezone: e.target.value || undefined,
                      },
                    })
                  }
                  placeholder="Europe/Stockholm"
                />
              </div>
            </>
          )}
          {config.type === "iofxml" && (
            <>
              <div className="form-group">
                <label>{tr("IOF XML file *")}</label>
                <input
                  type="text"
                  value={(config.config as any)?.filePath || ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        filePath: e.target.value,
                      },
                    })
                  }
                  placeholder={"C:\\OE\\export\\results.xml"}
                />
                <small className="help-text">
                   {tr("ResultList or StartList (IOF XML 3.0). Set your timing software to export it every few seconds.")} </small>
              </div>
              <div className="form-group">
                <label>{tr("Competition id")}</label>
                <input
                  type="number"
                  value={(config.config as any)?.competitionId || 1}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        competitionId: parseInt(e.target.value) || 1,
                      },
                    })
                  }
                />
              </div>
              <div className="form-group">
                <label>{tr("Event time zone")}</label>
                <input
                  type="text"
                  value={(config.config as any)?.timezone || ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        timezone: e.target.value || undefined,
                      },
                    })
                  }
                  placeholder="Europe/Stockholm"
                />
              </div>
              <div className="form-group">
                <label>{tr("Radio controls")}</label>
                <input
                  type="text"
                  value={((config.config as any)?.radioControls || []).join(
                    ", ",
                  )}
                  onChange={(e) => {
                    const codes = e.target.value
                      .split(/[\s,]+/)
                      .map((v) => parseInt(v, 10))
                      .filter((n) => Number.isFinite(n));
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        radioControls: codes.length ? codes : undefined,
                      },
                    });
                  }}
                  placeholder={tr("e.g. 31, 45, 100 (empty = all controls)")}
                />
                <small className="help-text">
                   {tr("Control codes to show as split times")} </small>
              </div>
            </>
          )}
          {config.type === "mysql" && (
            <>
              <div className="form-group">
                <label>{tr("Host *")}</label>
                <input
                  type="text"
                  value={(config.config as any)?.host || ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        host: e.target.value,
                      },
                    })
                  }
                  placeholder="localhost"
                />
                <small className="help-text">
                   {tr("Database host (e.g., localhost, 192.168.1.100)")} </small>
              </div>
              <div className="form-group">
                <label>{tr("Port")}</label>
                <input
                  type="number"
                  value={(config.config as any)?.port || 3306}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        port: parseInt(e.target.value),
                      },
                    })
                  }
                />
                <small className="help-text">{tr("Default: 3306")}</small>
              </div>
              <div className="form-group">
                <label>{tr("Database Name *")}</label>
                <input
                  type="text"
                  value={(config.config as any)?.database || ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        database: e.target.value,
                      },
                    })
                  }
                  placeholder="mop"
                />
              </div>
              <div className="form-group">
                <label>{tr("Username *")}</label>
                <input
                  type="text"
                  value={(config.config as any)?.user || ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        user: e.target.value,
                      },
                    })
                  }
                  placeholder="root"
                />
              </div>
              <div className="form-group">
                <label>{tr("Password *")}</label>
                <input
                  type="password"
                  value={(config.config as any)?.password || ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        password: e.target.value,
                      },
                    })
                  }
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
                <small className="help-text">
                   {tr("Stored in plain text in config.json. Use a read-only database user.")} </small>
              </div>
              <div className="form-group">
                <label>{tr("Event time zone")}</label>
                <input
                  type="text"
                  value={(config.config as any)?.timezone || ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        timezone: e.target.value || undefined,
                      },
                    })
                  }
                  placeholder="Europe/Stockholm"
                />
                <small className="help-text">
                   {tr("IANA zone of the event, used for running clocks. Leave empty for Swedish time.")} </small>
              </div>
              <div className="form-group">
                <label>{tr("Live poll interval (ms)")}</label>
                <input
                  type="number"
                  min={1000}
                  value={(config.config as any)?.pollIntervalMs || 2000}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        pollIntervalMs: parseInt(e.target.value),
                      },
                    })
                  }
                />
                <small className="help-text">
                   {tr("How often on-air graphics re-read the database (minimum 1000)")} </small>
              </div>
              <div className="form-group">
                <label>{tr("Connection Timeout (ms)")}</label>
                <input
                  type="number"
                  value={(config.config as any)?.connectTimeout || 10000}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      config: {
                        ...(config.config || {}),
                        connectTimeout: parseInt(e.target.value),
                      },
                    })
                  }
                />
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={(config.config as any)?.ssl?.enabled || false}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        config: {
                          ...(config.config || {}),
                          ssl: {
                            enabled: e.target.checked,
                            rejectUnauthorized: true,
                          },
                        },
                      })
                    }
                  />
                   {tr("Enable SSL/TLS")} </label>
                <small className="help-text">
                   {tr("Use encrypted connection to database")} </small>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="studio-button" onClick={onClose} disabled={saving}>
             {tr("Cancel")} </button>
          <button
            className="studio-button primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : tr("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
