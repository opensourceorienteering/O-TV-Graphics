import { t as tr } from "../i18n";
/**
 * Timing plugins: what is loaded from the plugins folder, what failed, and the extra fields
 * each plugin gives templates (x.<plugin>.<key>).
 */

import { useEffect, useState } from "react";
import type { TimingPluginList } from "../../../shared/types/dataSource";
import { useToast } from "../contexts/ToastContext";

/** "my-plugin/index.js" or "club.yaml": the path inside the plugins folder */
function relativeName(file: string, folder: string | null): string {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const f = norm(file);
  const base = folder ? norm(folder).replace(/\/+$/, "") + "/" : "";
  return base && f.startsWith(base) ? f.slice(base.length) : f.split("/").pop() ?? f;
}

export function TimingPluginsPanel({ onReloaded }: { onReloaded?: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<TimingPluginList | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const result = await window.electronAPI.invoke("timingPlugins:list");
    if (result.success) setList(result.data);
  };

  useEffect(() => {
    void load();
  }, []);

  const reload = async () => {
    setBusy(true);
    try {
      const result = await window.electronAPI.invoke("timingPlugins:reload");
      if (result.success) {
        setList(result.data);
        const n = result.data.failures.length;
        if (n) toast.error(`${n} plugin file(s) failed to load. See the list below.`);
        else toast.success("Timing plugins reloaded.");
        onReloaded?.();
      } else {
        toast.error(`Reload failed: ${result.error}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const openFolder = async () => {
    const result = await window.electronAPI.invoke("timingPlugins:openFolder");
    if (!result.success) toast.error(`Could not open the folder: ${result.error}`);
  };

  if (!list) return null;
  const external = list.plugins.filter((p) => p.kind !== "builtin");

  return (
    <div className="timing-plugins">
      <div className="data-source-header">
        <h3>{tr("Timing plugins")}</h3>
        <div className="data-source-actions">
          <button className="studio-button" onClick={openFolder}>
            {tr("Open plugins folder")}
          </button>
          <button className="studio-button" onClick={reload} disabled={busy}>
            {busy ? tr("Reloading...") : tr("Reload")}
          </button>
        </div>
      </div>
      <p className="help-text">
        {tr("Put a plugin folder or an SQL profile (.yaml) in the plugins folder, then press Reload. Plugins run with full access to this computer: only install plugins you trust.")}
        {list.folder && (
          <>
            <br />
            <code>{list.folder}</code>
          </>
        )}
      </p>

      {external.length === 0 && list.failures.length === 0 && (
        <p className="help-text">{tr("No plugins installed.")}</p>
      )}

      <div className="data-source-list">
        {external.map((p) => (
          <div key={p.id} className="data-source-item enabled">
            <div className="data-source-info">
              <div className="data-source-name">
                <strong>{p.name}</strong>
                <span className="data-source-type">{p.kind === "sql-profile" ? tr("SQL profile") : tr("Plugin")}</span>
                <span className="data-source-type">{p.id}</span>
                <span className="data-source-type">v{p.version}</span>
              </div>
              {p.description && <div className="data-source-config">{p.description}</div>}
              {p.extFields.length > 0 && (
                <div className="data-source-config">
                  {tr("Extra fields:")}{" "}
                  {p.extFields.map((f) => (
                    <code key={`${f.on}.${f.key}`} title={f.description ?? f.label}>
                      {f.on === "entry" ? `results[].x.${p.id}.${f.key}` : `x.${p.id}.${f.key}`}{" "}
                    </code>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {list.failures.map((f) => (
          <div key={f.path} className="data-source-item disabled">
            <div className="data-source-info">
              <div className="data-source-name">
                <strong>{relativeName(f.path, list.folder)}</strong>
                <span className="badge-disabled">{tr("Not loaded")}</span>
              </div>
              <div className="data-source-config">{f.error}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
