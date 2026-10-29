import { t as tr } from "../i18n";
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { useToast } from "../contexts/ToastContext";

interface WebOutputInfo {
  hostname: string;
  port: number;
  wsPort: number;
  enabled: boolean;
  cors: boolean;
  isRunning: boolean;
  localUrls: Array<{ address: string; url: string; wsUrl: string }>;
  localhostUrl: string;
  localhostWsUrl: string;
}

export function WebOutputPanel() {
  const toast = useToast();
  const [info, setInfo] = useState<WebOutputInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await window.electronAPI.invoke("output:getWebInfo");
      if (!result.success)
        throw new Error(result.error || "Unable to read web output status.");
      setInfo(result.data);
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : "Unable to read web output status."} Check the output settings and try again.`,
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const copy = async (url: string, key: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 2000);
      toast.success("Output URL copied.");
    } catch {
      toast.error("Unable to copy the URL. Select it and copy it manually.");
    }
  };

  if (loading)
    return (
      <section className="connection-card screen-state" role="status">
        <RefreshCw className="icon-spin" aria-hidden="true" />
        <p>{tr("Checking web output…")}</p>
      </section>
    );
  if (!info)
    return (
      <section className="connection-card">
        <h3>{tr("Web output")}</h3>
        <p className="studio-error" role="alert">
          {error}
        </p>
        <button className="studio-button" onClick={() => void load()}>
           {tr("Check again")} </button>
      </section>
    );

  const urls = [
    { key: "local", label: "This computer", url: info.localhostUrl },
    ...info.localUrls.map((item, index) => ({
      key: `network-${index}`,
      label: item.address,
      url: item.url,
    })),
  ];
  return (
    <section className="connection-card">
      <div className="connection-card-heading">
        <div>
          <h3>{tr("Web output")}</h3>
          <p>{tr("Use a browser source in OBS, vMix, or another production tool.")}</p>
        </div>
        <span
          className={`connection-status ${info.isRunning ? tr("ready") : "off"}`}
        >
          {info.isRunning ? "● Running" : "○ Stopped"}
        </span>
      </div>
      <div className="connection-list">
        {urls.map(({ key, label, url }) => (
          <div className="connection-url" key={key}>
            <label>
              {tr(label)}
              <input readOnly value={url} />
            </label>
            <button
              className="icon-button"
              aria-label={`Copy ${label} URL`}
              onClick={() => void copy(url, key)}
            >
              {copied === key ? <Check size={16} /> : <Copy size={16} />}
            </button>
            <button
              className="studio-button"
              onClick={() => window.open(url, "_blank")}
            >
              <ExternalLink size={15} aria-hidden="true" />
               {tr("Open")} </button>
          </div>
        ))}
      </div>
      <details className="settings-disclosure">
        <summary>{tr("Connection details")}</summary>
        <dl className="detail-list">
          <div>
            <dt>{tr("Host")}</dt>
            <dd>{info.hostname}</dd>
          </div>
          <div>
            <dt>{tr("Web port")}</dt>
            <dd>{info.port}</dd>
          </div>
          <div>
            <dt>{tr("WebSocket port")}</dt>
            <dd>{info.wsPort}</dd>
          </div>
          <div>
            <dt>{tr("Cross-origin access")}</dt>
            <dd>{info.cors ? "Allowed" : "Restricted"}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
