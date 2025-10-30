/**
 * Web Output Panel Component
 * Displays web output information and controls
 */

import { useState, useEffect } from 'react';
import { Monitor, Copy, Check, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

interface WebOutputInfo {
  hostname: string;
  port: number;
  wsPort: number;
  enabled: boolean;
  cors: boolean;
  isRunning: boolean;
  localUrls: Array<{
    address: string;
    url: string;
    wsUrl: string;
  }>;
  localhostUrl: string;
  localhostWsUrl: string;
}

export function WebOutputPanel() {
  const toast = useToast();
  const [webInfo, setWebInfo] = useState<WebOutputInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const loadWebInfo = async () => {
    setLoading(true);
    try {
      const response = await window.electronAPI.invoke('output:getWebInfo');
      if (response.success) {
        setWebInfo(response.data);
      } else {
        toast.error(`Failed to load web output info: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Error loading web output info: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWebInfo();
  }, []);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(label);
      setTimeout(() => setCopiedUrl(null), 2000);
      toast.success(`${label} copied to clipboard`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to copy to clipboard: ${errorMessage}`);
    }
  };

  const openInBrowser = (url: string) => {
    window.open(url, '_blank');
  };

  if (loading) {
    return (
      <div className="web-output-panel loading">
        <RefreshCw className="icon-spin" size={24} />
        <p>Loading web output information...</p>
      </div>
    );
  }

  if (!webInfo) {
    return (
      <div className="web-output-panel error">
        <WifiOff size={24} />
        <p>Failed to load web output information</p>
        <button onClick={loadWebInfo} className="btn-secondary">
          <RefreshCw size={16} />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="web-output-panel">
      <div className="panel-header">
        <div className="header-left">
          <Monitor size={20} />
          <h3>Web Output</h3>
        </div>
        <div className="header-right">
          {webInfo.isRunning ? (
            <span className="status-badge status-running">
              <Wifi size={14} />
              Running
            </span>
          ) : (
            <span className="status-badge status-stopped">
              <WifiOff size={14} />
              Stopped
            </span>
          )}
        </div>
      </div>

      <div className="panel-content">
        {/* Localhost URL */}
        <div className="url-section">
          <label>Localhost URL</label>
          <div className="url-row">
            <input
              type="text"
              value={webInfo.localhostUrl}
              readOnly
              className="url-input"
            />
            <button
              onClick={() => copyToClipboard(webInfo.localhostUrl, 'localhost')}
              className="btn-icon"
              title="Copy to clipboard"
            >
              {copiedUrl === 'localhost' ? <Check size={16} /> : <Copy size={16} />}
            </button>
            <button
              onClick={() => openInBrowser(webInfo.localhostUrl)}
              className="btn-secondary btn-sm"
            >
              Open
            </button>
          </div>
          <p className="url-hint">Use this URL on the same machine (e.g., OBS on this computer)</p>
        </div>

        {/* Network URLs */}
        {webInfo.localUrls.length > 0 && (
          <div className="url-section">
            <label>Network URLs</label>
            {webInfo.localUrls.map((urlInfo, index) => (
              <div key={index} className="url-row">
                <input
                  type="text"
                  value={urlInfo.url}
                  readOnly
                  className="url-input"
                />
                <button
                  onClick={() => copyToClipboard(urlInfo.url, `network-${index}`)}
                  className="btn-icon"
                  title="Copy to clipboard"
                >
                  {copiedUrl === `network-${index}` ? <Check size={16} /> : <Copy size={16} />}
                </button>
                <button
                  onClick={() => openInBrowser(urlInfo.url)}
                  className="btn-secondary btn-sm"
                >
                  Open
                </button>
              </div>
            ))}
            <p className="url-hint">
              Use these URLs from other devices on the same network (e.g., OBS on another computer, vMix, tablets)
            </p>
          </div>
        )}

        {/* Configuration Info */}
        <div className="config-section">
          <h4>Configuration</h4>
          <div className="config-grid">
            <div className="config-item">
              <span className="config-label">Hostname:</span>
              <span className="config-value">{webInfo.hostname}</span>
            </div>
            <div className="config-item">
              <span className="config-label">Web Port:</span>
              <span className="config-value">{webInfo.port}</span>
            </div>
            <div className="config-item">
              <span className="config-label">WebSocket Port:</span>
              <span className="config-value">{webInfo.wsPort}</span>
            </div>
            <div className="config-item">
              <span className="config-label">CORS:</span>
              <span className="config-value">{webInfo.cors ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>
        </div>

        {/* Usage Instructions */}
        <div className="instructions-section">
          <h4>How to Use</h4>
          <ul className="instructions-list">
            <li>
              <strong>OBS Studio:</strong> Add a "Browser Source", paste the URL, set size to 1920x1080
            </li>
            <li>
              <strong>vMix:</strong> Add "Web Browser" input, paste the URL
            </li>
            <li>
              <strong>Remote Browser:</strong> Open the network URL on any device with a web browser
            </li>
            <li>
              <strong>Debug Mode:</strong> Add <code>?debug=true</code> to the URL to show connection status overlay
            </li>
          </ul>
        </div>
      </div>

      <style>{`
        .web-output-panel {
          background: #1e1e1e;
          border-radius: 8px;
          overflow: hidden;
        }

        .web-output-panel.loading,
        .web-output-panel.error {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          gap: 16px;
          color: #888;
        }

        .icon-spin {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          background: #252525;
          border-bottom: 1px solid #333;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .header-left h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
        }

        .status-running {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
        }

        .status-stopped {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
        }

        .panel-content {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .url-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .url-section label {
          font-size: 13px;
          font-weight: 600;
          color: #aaa;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .url-row {
          display: flex;
          gap: 8px;
        }

        .url-input {
          flex: 1;
          padding: 8px 12px;
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          color: #fff;
          font-family: 'Courier New', monospace;
          font-size: 13px;
        }

        .url-hint {
          font-size: 12px;
          color: #666;
          margin-top: 4px;
        }

        .btn-icon {
          padding: 8px;
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          color: #aaa;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-icon:hover {
          background: #3a3a3a;
          color: #fff;
        }

        .btn-secondary {
          padding: 8px 16px;
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          color: #fff;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .btn-secondary:hover {
          background: #3a3a3a;
        }

        .btn-sm {
          padding: 6px 12px;
          font-size: 13px;
        }

        .config-section h4,
        .instructions-section h4 {
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 12px;
          color: #ccc;
        }

        .config-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }

        .config-item {
          display: flex;
          justify-content: space-between;
          padding: 8px 12px;
          background: #2a2a2a;
          border-radius: 4px;
        }

        .config-label {
          color: #888;
          font-size: 13px;
        }

        .config-value {
          color: #fff;
          font-size: 13px;
          font-weight: 500;
        }

        .instructions-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .instructions-list li {
          padding: 12px;
          background: #2a2a2a;
          border-radius: 4px;
          font-size: 13px;
          line-height: 1.6;
          color: #ccc;
        }

        .instructions-list strong {
          color: #fff;
          font-weight: 600;
        }

        .instructions-list code {
          background: #1a1a1a;
          padding: 2px 6px;
          border-radius: 3px;
          font-family: 'Courier New', monospace;
          color: #22c55e;
        }
      `}</style>
    </div>
  );
}

