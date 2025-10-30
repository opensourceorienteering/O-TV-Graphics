/**
 * NDI Output Panel Component
 * Displays NDI output information and controls
 */

import { useState, useEffect } from 'react';
import { Radio, RefreshCw, AlertCircle, CheckCircle, XCircle, Play, Square, Settings, TestTube } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

interface NDIOutputInfo {
  available: boolean;
  version?: string;
  error?: string;
  initialized: boolean;
  enabled: boolean;
  active: boolean;
  name: string;
  fps: number;
  frameCount: number;
  lastFrameTime: number;
  capturing: boolean;
  captureFrameCount: number;
  captureErrors: number;
}

interface NDITestResults {
  available: boolean;
  version: string | null;
  cpuSupported: boolean;
  canInitialize: boolean;
  canCreateSender: boolean;
  error: string | null;
  details: string[];
}

export function NDIOutputPanel() {
  const toast = useToast();
  const [ndiInfo, setNdiInfo] = useState<NDIOutputInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTestResults, setShowTestResults] = useState(false);
  const [testResults, setTestResults] = useState<NDITestResults | null>(null);
  const [testing, setTesting] = useState(false);
  const [config, setConfig] = useState({
    name: 'OL-Grafik Graphics Output',
    fps: 30,
    colorFormat: 'BGRA' as 'BGRA' | 'RGBA'
  });

  const loadNDIInfo = async () => {
    setLoading(true);
    try {
      const response = await window.electronAPI.invoke('output:getNDIInfo');
      if (response.success) {
        setNdiInfo(response.data);
        setConfig({
          name: response.data.name,
          fps: response.data.fps,
          colorFormat: response.data.colorFormat || 'BGRA'
        });
      } else {
        toast.error(`Failed to load NDI output info: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Error loading NDI output info: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadNDIInfo();
  }, []);

  // Auto-refresh when active
  // NOTE: Auto-refresh disabled to prevent settings panel from reloading while user is configuring
  // The panel will update when user performs actions (start, stop, update config, etc.)
  // If real-time stats are needed in the future, consider updating only the stats section
  // without re-rendering the entire component

  // useEffect(() => {
  //   if (!ndiInfo?.active) {
  //     return;
  //   }
  //
  //   const interval = setInterval(() => {
  //     loadNDIInfo();
  //   }, 2000);
  //
  //   return () => clearInterval(interval);
  // }, [ndiInfo?.active]);

  const handleStart = async () => {
    setStarting(true);
    try {
      const response = await window.electronAPI.invoke('output:startNDI');
      if (response.success) {
        await loadNDIInfo();
        toast.success('NDI output started successfully');
      } else {
        toast.error(`Failed to start NDI output: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Error starting NDI output: ${errorMessage}`);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    try {
      const response = await window.electronAPI.invoke('output:stopNDI');
      if (response.success) {
        await loadNDIInfo();
        toast.success('NDI output stopped successfully');
      } else {
        toast.error(`Failed to stop NDI output: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Error stopping NDI output: ${errorMessage}`);
    } finally {
      setStopping(false);
    }
  };

  const handleUpdateConfig = async () => {
    try {
      // Update runtime configuration
      const response = await window.electronAPI.invoke('output:updateNDIConfig', config);
      if (response.success) {
        await loadNDIInfo();
        setShowSettings(false);
        toast.success('NDI configuration updated successfully');

        // Also update the config.json file by triggering a settings update
        // This ensures the changes persist across application restarts
        try {
          const currentSettings = await window.electronAPI.invoke('settings:get');
          if (currentSettings.success) {
            const updatedSettings = {
              ...currentSettings.data,
              output: {
                ...currentSettings.data.output,
                ndi: {
                  ...currentSettings.data.output.ndi,
                  name: config.name,
                  fps: config.fps,
                  colorFormat: config.colorFormat
                }
              }
            };

            // Save to config.json
            await window.electronAPI.invoke('settings:update', updatedSettings);
            // Settings saved successfully (no need to notify user again)
          }
        } catch (settingsError) {
          toast.warning('NDI config updated but failed to save to config.json');
          // Don't block the user - runtime config was updated successfully
        }
      } else {
        toast.error(`Failed to update configuration: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Error updating configuration: ${errorMessage}`);
    }
  };

  const handleTestNDI = async () => {
    setTesting(true);
    try {
      const response = await window.electronAPI.invoke('output:testNDI');
      if (response.success) {
        setTestResults(response.data);
        setShowTestResults(true);
        toast.success('NDI test completed successfully');
      } else {
        toast.error(`Failed to test NDI: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Error testing NDI: ${errorMessage}`);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="ndi-output-panel loading">
        <RefreshCw className="icon-spin" size={24} />
        <p>Loading NDI output information...</p>
      </div>
    );
  }

  if (!ndiInfo) {
    return (
      <div className="ndi-output-panel error">
        <XCircle size={24} />
        <p>Failed to load NDI output information</p>
        <button onClick={loadNDIInfo} className="btn-secondary">
          <RefreshCw size={16} />
          Retry
        </button>
      </div>
    );
  }

  // NDI SDK not available
  if (!ndiInfo.available) {
    return (
      <div className="ndi-output-panel">
        <div className="panel-header">
          <Radio size={20} />
          <h3>NDI Output</h3>
          <div className="header-actions">
            <button
              onClick={handleTestNDI}
              disabled={testing}
              className="btn-icon"
              title="Test NDI"
            >
              <TestTube size={16} />
            </button>
            <button onClick={loadNDIInfo} className="btn-icon" title="Refresh">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        <div className="status-section unavailable">
          <AlertCircle size={48} className="status-icon" />
          <h4>NDI Support Not Installed (Optional Feature)</h4>

          <div className="info-box" style={{ marginTop: '16px' }}>
            <h5 style={{ marginBottom: '8px', fontSize: '1rem' }}>ℹ️ What is NDI?</h5>
            <p style={{ marginBottom: '16px', color: '#ccc', lineHeight: '1.5' }}>
              NDI (Network Device Interface) enables low-latency video output over your network to other broadcast systems,
              video mixers, and production tools. It's an optional feature - OL-Grafik works perfectly without it.
            </p>

            <h5 style={{ marginBottom: '8px', fontSize: '1rem' }}>✅ Current Status</h5>
            <p style={{ marginBottom: '16px', color: '#ff9800', lineHeight: '1.5' }}>
              NDI Runtime is not installed on your system. All other features of OL-Grafik are working normally.
            </p>

            <h5 style={{ marginBottom: '8px', fontSize: '1rem' }}>📦 How to Enable NDI Output</h5>
            <div style={{ marginBottom: '16px' }}>
              <p style={{ marginBottom: '12px', color: '#ccc' }}>
                Follow these simple steps to enable NDI output:
              </p>
              <ol style={{ lineHeight: '1.8', color: '#ccc' }}>
                <li>
                  <strong>Download NDI Runtime:</strong>
                  <br />
                  Visit <a href="https://ndi.link/NDIRedistV5" target="_blank" rel="noopener noreferrer" style={{ color: '#4a9eff' }}>ndi.link/NDIRedistV5</a> and download the installer for your platform
                </li>
                <li>
                  <strong>Install NDI Runtime:</strong>
                  <br />
                  Run the installer and follow the installation wizard
                  <br />
                  <span style={{ fontSize: '0.875rem', color: '#888' }}>
                    • Windows: Run the .exe installer as Administrator
                    <br />
                    • macOS: Open the .pkg installer and follow prompts
                    <br />
                    • Linux: Extract and run the install script
                  </span>
                </li>
                <li>
                  <strong>Restart OL-Grafik:</strong>
                  <br />
                  Close and reopen OL-Grafik - NDI output will be automatically detected
                </li>
              </ol>
            </div>

            <div style={{
              padding: '12px',
              backgroundColor: 'rgba(74, 158, 255, 0.1)',
              borderLeft: '3px solid #4a9eff',
              borderRadius: '4px',
              marginBottom: '16px'
            }}>
              <p style={{ margin: 0, fontSize: '0.875rem', color: '#ccc' }}>
                💡 <strong>Tip:</strong> Click the test button (🧪) above to run diagnostics and see detailed information about your NDI installation status.
              </p>
            </div>

            {ndiInfo.error && (
              <div style={{
                padding: '12px',
                backgroundColor: 'rgba(255, 152, 0, 0.1)',
                borderLeft: '3px solid #ff9800',
                borderRadius: '4px'
              }}>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#ff9800' }}>
                  <strong>Technical Details:</strong> {ndiInfo.error}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Test Results Modal */}
        {showTestResults && testResults && (
          <div className="modal-overlay" onClick={() => setShowTestResults(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>
                  <TestTube size={20} />
                  NDI Test Results
                </h3>
                <button onClick={() => setShowTestResults(false)} className="btn-close">×</button>
              </div>
              <div className="modal-body">
                <div className="test-results">
                  {testResults.details.map((detail, index) => (
                    <div key={index} className="test-result-line">
                      {detail}
                    </div>
                  ))}
                </div>
                {testResults.error && (
                  <div className="test-error">
                    <AlertCircle size={16} />
                    <span>{testResults.error}</span>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button onClick={() => setShowTestResults(false)} className="btn-primary">
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // NDI SDK available
  return (
    <div className="ndi-output-panel">
      <div className="panel-header">
        <Radio size={20} />
        <h3>NDI Output</h3>
        <div className="header-actions">
          <button
            onClick={handleTestNDI}
            disabled={testing}
            className="btn-icon"
            title="Test NDI"
          >
            <TestTube size={16} />
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="btn-icon"
            title="Settings"
          >
            <Settings size={16} />
          </button>
          <button onClick={loadNDIInfo} className="btn-icon" title="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Status Section */}
      <div className="status-section">
        <div className="status-row">
          <span className="label">Status:</span>
          <span className={`status-badge ${ndiInfo.active ? 'active' : 'inactive'}`}>
            {ndiInfo.active ? (
              <>
                <CheckCircle size={14} />
                Active
              </>
            ) : (
              <>
                <XCircle size={14} />
                Inactive
              </>
            )}
          </span>
        </div>

        <div className="status-row">
          <span className="label">NDI Version:</span>
          <span className="value">{ndiInfo.version || 'Unknown'}</span>
        </div>

        <div className="status-row">
          <span className="label">Source Name:</span>
          <span className="value">{ndiInfo.name}</span>
        </div>

        <div className="status-row">
          <span className="label">Frame Rate:</span>
          <span className="value">{ndiInfo.fps} FPS</span>
        </div>

        {ndiInfo.active && (
          <>
            <div className="status-row">
              <span className="label">Frames Sent:</span>
              <span className="value">{ndiInfo.frameCount.toLocaleString()}</span>
            </div>

            <div className="status-row">
              <span className="label">Capturing:</span>
              <span className={`status-badge ${ndiInfo.capturing ? 'active' : 'inactive'}`}>
                {ndiInfo.capturing ? 'Yes' : 'No'}
              </span>
            </div>

            {ndiInfo.capturing && (
              <>
                <div className="status-row">
                  <span className="label">Captured Frames:</span>
                  <span className="value">{ndiInfo.captureFrameCount.toLocaleString()}</span>
                </div>

                {ndiInfo.captureErrors > 0 && (
                  <div className="status-row">
                    <span className="label">Capture Errors:</span>
                    <span className="value error">{ndiInfo.captureErrors}</span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Settings Section */}
      {showSettings && (
        <div className="settings-section">
          <h4>NDI Configuration</h4>
          
          <div className="form-group">
            <label htmlFor="ndi-name">Source Name:</label>
            <input
              id="ndi-name"
              type="text"
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              placeholder="OL-Grafik Graphics Output"
            />
          </div>

          <div className="form-group">
            <label htmlFor="ndi-fps">Frame Rate:</label>
            <select
              id="ndi-fps"
              value={config.fps}
              onChange={(e) => setConfig({ ...config, fps: parseInt(e.target.value) })}
            >
              <option value="25">25 FPS (PAL)</option>
              <option value="30">30 FPS (NTSC)</option>
              <option value="50">50 FPS (PAL Progressive)</option>
              <option value="60">60 FPS (NTSC Progressive)</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="ndi-color-format">Color Format:</label>
            <select
              id="ndi-color-format"
              value={config.colorFormat}
              onChange={(e) => setConfig({ ...config, colorFormat: e.target.value as 'BGRA' | 'RGBA' })}
            >
              <option value="BGRA">BGRA (Default - macOS/Windows/Linux)</option>
              <option value="RGBA">RGBA (Alternative)</option>
            </select>
            <small style={{ display: 'block', marginTop: '4px', color: '#888' }}>
              Change this if colors appear incorrect in NDI output (red/blue swapped)
            </small>
          </div>

          <div className="form-actions">
            <button onClick={handleUpdateConfig} className="btn-primary">
              Apply Changes
            </button>
            <button onClick={() => setShowSettings(false)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Control Buttons */}
      <div className="control-section">
        {!ndiInfo.active ? (
          <button
            onClick={handleStart}
            disabled={starting}
            className="btn-primary btn-large"
          >
            <Play size={20} />
            {starting ? 'Starting...' : 'Start NDI Output'}
          </button>
        ) : (
          <button
            onClick={handleStop}
            disabled={stopping}
            className="btn-danger btn-large"
          >
            <Square size={20} />
            {stopping ? 'Stopping...' : 'Stop NDI Output'}
          </button>
        )}
      </div>

      {/* Test Results Modal */}
      {showTestResults && testResults && (
        <div className="modal-overlay" onClick={() => setShowTestResults(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <TestTube size={20} />
                NDI Test Results
              </h3>
              <button onClick={() => setShowTestResults(false)} className="btn-close">×</button>
            </div>
            <div className="modal-body">
              <div className="test-results">
                {testResults.details.map((detail, index) => (
                  <div key={index} className="test-result-line">
                    {detail}
                  </div>
                ))}
              </div>
              {testResults.error && (
                <div className="test-error">
                  <AlertCircle size={16} />
                  <span>{testResults.error}</span>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowTestResults(false)} className="btn-primary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .ndi-output-panel {
          background: #1e1e1e;
          border-radius: 8px;
          overflow: hidden;
        }

        .ndi-output-panel.loading,
        .ndi-output-panel.error {
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

        .panel-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .header-actions {
          display: flex;
          gap: 8px;
        }

        .btn-icon {
          padding: 8px;
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          color: #aaa;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .btn-icon:hover {
          background: #3a3a3a;
          color: #fff;
        }

        .status-section {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .status-section.unavailable {
          align-items: center;
          text-align: center;
          padding: 40px 20px;
        }

        .status-icon {
          color: #f59e0b;
          margin-bottom: 16px;
        }

        .status-section h4 {
          margin: 0 0 8px 0;
          font-size: 18px;
          color: #fff;
        }

        .error-message {
          color: #888;
          margin-bottom: 24px;
        }

        .info-box {
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          border-radius: 8px;
          padding: 20px;
          text-align: left;
          max-width: 500px;
        }

        .info-box h5 {
          margin: 0 0 12px 0;
          font-size: 14px;
          color: #ccc;
        }

        .info-box ol {
          margin: 0;
          padding-left: 20px;
          color: #aaa;
          line-height: 1.8;
        }

        .info-box a {
          color: #3b82f6;
          text-decoration: none;
        }

        .info-box a:hover {
          text-decoration: underline;
        }

        .status-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid #2a2a2a;
        }

        .status-row:last-child {
          border-bottom: none;
        }

        .status-row .label {
          color: #888;
          font-size: 13px;
        }

        .status-row .value {
          color: #fff;
          font-size: 13px;
          font-weight: 500;
        }

        .status-row .value.error {
          color: #ef4444;
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

        .status-badge.active {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
        }

        .status-badge.inactive {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
        }

        .settings-section {
          padding: 20px;
          background: #252525;
          border-top: 1px solid #333;
        }

        .settings-section h4 {
          margin: 0 0 16px 0;
          font-size: 14px;
          color: #ccc;
        }

        .form-group {
          margin-bottom: 16px;
        }

        .form-group label {
          display: block;
          margin-bottom: 6px;
          font-size: 13px;
          color: #aaa;
        }

        .form-group input,
        .form-group select {
          width: 100%;
          padding: 8px 12px;
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          color: #fff;
          font-size: 13px;
        }

        .form-group input:focus,
        .form-group select:focus {
          outline: none;
          border-color: #3b82f6;
        }

        .form-actions {
          display: flex;
          gap: 8px;
          margin-top: 20px;
        }

        .btn-primary {
          flex: 1;
          padding: 10px 16px;
          background: #3b82f6;
          border: none;
          border-radius: 4px;
          color: #fff;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-primary:hover {
          background: #2563eb;
        }

        .btn-secondary {
          flex: 1;
          padding: 10px 16px;
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          border-radius: 4px;
          color: #fff;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-secondary:hover {
          background: #3a3a3a;
        }

        .control-section {
          padding: 20px;
          border-top: 1px solid #333;
        }

        .btn-large {
          width: 100%;
          padding: 14px 20px;
          font-size: 15px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-large:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-danger {
          background: #ef4444;
          color: #fff;
        }

        .btn-danger:hover:not(:disabled) {
          background: #dc2626;
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal-content {
          background: #1e1e1e;
          border-radius: 8px;
          border: 1px solid #333;
          max-width: 600px;
          width: 90%;
          max-height: 80vh;
          display: flex;
          flex-direction: column;
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid #333;
        }

        .modal-header h3 {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0;
          font-size: 18px;
        }

        .btn-close {
          background: none;
          border: none;
          color: #888;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
        }

        .btn-close:hover {
          background: #333;
          color: #fff;
        }

        .modal-body {
          padding: 20px;
          overflow-y: auto;
          flex: 1;
        }

        .test-results {
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 13px;
          line-height: 1.8;
          background: #0a0a0a;
          padding: 16px;
          border-radius: 4px;
          border: 1px solid #333;
        }

        .test-result-line {
          margin-bottom: 4px;
          white-space: pre-wrap;
        }

        .test-error {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 16px;
          padding: 12px;
          background: rgba(220, 38, 38, 0.1);
          border: 1px solid rgba(220, 38, 38, 0.3);
          border-radius: 4px;
          color: #ef4444;
        }

        .modal-footer {
          padding: 16px 20px;
          border-top: 1px solid #333;
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
      `}</style>
    </div>
  );
}

