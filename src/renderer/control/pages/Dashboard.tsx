/**
 * Dashboard Page
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, FileText, Play, AlertCircle, CheckCircle } from 'lucide-react';
import './Dashboard.css';
import { getRecentItems, formatRelativeTime, RecentItem } from '../utils/recentItems';

interface SystemStatus {
  webSocket: {
    running: boolean;
    port: number;
    clientCount: number;
  };
  webServer: {
    running: boolean;
    port: number;
  };
  liveResults: {
    configured: boolean;
    connected: boolean;
    activePolls: number;
    competitionsLoaded: number;
  };
  ndi: {
    available: boolean;
    active: boolean;
    version?: string;
    error?: string;
  };
}

export function Dashboard() {
  const navigate = useNavigate();
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Load recent items on mount
  useEffect(() => {
    const items = getRecentItems();
    setRecentItems(items);
  }, []);

  // Load system status and poll every 5 seconds
  useEffect(() => {
    const loadStatus = async () => {
      try {
        const result = await window.electronAPI.invoke('system:getStatus');
        if (result.success) {
          setSystemStatus(result.data);
        }
      } catch (error) {
        console.error('Failed to load system status:', error);
      } finally {
        setStatusLoading(false);
      }
    };

    // Load immediately
    loadStatus();

    // Poll every 5 seconds
    const interval = setInterval(loadStatus, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleOpenRecent = (item: RecentItem) => {
    // All items are rundowns now, so always navigate to production view
    if (item.rundownId) {
      navigate(`/production/${item.projectId}/${item.rundownId}`);
    }
  };

  const mostRecent = recentItems[0];
  const otherRecent = recentItems.slice(1, 5); // Show up to 4 more

  // Calculate overall system health
  const getSystemHealth = (): 'healthy' | 'degraded' | 'critical' | 'loading' => {
    if (statusLoading || !systemStatus) return 'loading';

    const criticalServices = [
      systemStatus.webSocket.running,
      systemStatus.webServer.running
    ];

    if (criticalServices.some(s => !s)) return 'critical';
    if (!systemStatus.ndi.available && systemStatus.ndi.error) return 'degraded';

    return 'healthy';
  };

  const systemHealth = getSystemHealth();

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="dashboard-header-left">
          <h1>Welcome to OL-Grafik</h1>
          <p className="dashboard-subtitle">
            Cross-platform graphics software for orienteering competitions
          </p>
        </div>
        <div className="dashboard-header-right">
          {systemHealth === 'loading' ? (
            <div className="health-badge health-loading">
              <div className="health-spinner"></div>
              <span>Checking Status...</span>
            </div>
          ) : systemHealth === 'healthy' ? (
            <div className="health-badge health-ok">
              <CheckCircle size={20} />
              <span>All Systems Operational</span>
            </div>
          ) : systemHealth === 'degraded' ? (
            <div className="health-badge health-warning">
              <AlertCircle size={20} />
              <span>Some Services Degraded</span>
            </div>
          ) : (
            <div className="health-badge health-error">
              <AlertCircle size={20} />
              <span>Critical Services Down</span>
            </div>
          )}
        </div>
      </div>

      {/* Recent Rundowns Section */}
      <section className="recent-section">
        <h2 className="section-title">Recent Rundowns</h2>

        {recentItems.length === 0 ? (
          <div className="empty-state-large">
            <Play size={64} className="empty-icon" />
            <h3>No Recent Rundowns</h3>
            <p>Get started by creating a project and opening a rundown in production mode</p>
            <div className="empty-actions">
              <button
                className="btn btn-primary"
                onClick={() => navigate('/project/new')}
              >
                Create New Project
              </button>
            </div>
          </div>
        ) : (
          <div className="recent-grid">
            {/* Most Recent - Hero Card */}
            {mostRecent && (
              <div
                className="recent-card recent-card-hero"
                onClick={() => handleOpenRecent(mostRecent)}
              >
                <div className="recent-badge">Last Opened</div>
                <div className="recent-icon">
                  <Play size={32} />
                </div>
                <div className="recent-content">
                  <h3 className="recent-title">{mostRecent.rundownName}</h3>
                  <div className="recent-subtitle">{mostRecent.projectName}</div>
                  <div className="recent-meta">
                    {mostRecent.itemCount !== undefined && (
                      <span className="recent-meta-item">
                        <FileText size={14} />
                        {mostRecent.itemCount} item{mostRecent.itemCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    <span className="recent-meta-item">
                      <Clock size={14} />
                      {formatRelativeTime(mostRecent.lastAccessed)}
                    </span>
                  </div>
                </div>
                <button className="btn btn-primary recent-open-btn">
                  Open Production View →
                </button>
              </div>
            )}

            {/* Other Recent Items */}
            {otherRecent.map((item, index) => (
              <div
                key={`${item.projectId}-${item.rundownId}-${index}`}
                className="recent-card"
                onClick={() => handleOpenRecent(item)}
              >
                <div className="recent-icon-small">
                  <Play size={20} />
                </div>
                <div className="recent-content">
                  <h4 className="recent-title-small">{item.rundownName}</h4>
                  <div className="recent-subtitle-small">{item.projectName}</div>
                  <div className="recent-meta-small">
                    {item.itemCount !== undefined && (
                      <span>{item.itemCount} items</span>
                    )}
                    <span>{formatRelativeTime(item.lastAccessed)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Information Boxes Row */}
      <div className="info-grid">
        <div className="card">
          <div className="card-header">Quick Start</div>
          <div className="card-body">
            <ol className="quick-start-list">
              <li>Create or open a project</li>
              <li>Add OGRAF templates to your project</li>
              <li>Create a rundown with graphics items</li>
              <li>Connect to LiveResults API</li>
              <li>Control graphics in real-time</li>
            </ol>
          </div>
        </div>

        <div className="card">
          <div className="card-header">System Status</div>
          <div className="card-body">
            {statusLoading || !systemStatus ? (
              <div className="status-loading">Loading status...</div>
            ) : (
              <>
                <div className="status-item">
                  <span>WebSocket Server:</span>
                  <span className={systemStatus.webSocket.running ? 'status-ok' : 'status-error'}>
                    {systemStatus.webSocket.running ? `✓ Running (${systemStatus.webSocket.clientCount} clients)` : '✗ Stopped'}
                  </span>
                </div>
                <div className="status-item">
                  <span>Web Server:</span>
                  <span className={systemStatus.webServer.running ? 'status-ok' : 'status-error'}>
                    {systemStatus.webServer.running ? `✓ Running (port ${systemStatus.webServer.port})` : '✗ Stopped'}
                  </span>
                </div>
                <div className="status-item">
                  <span>LiveResults:</span>
                  {!systemStatus.liveResults.configured ? (
                    <span className="status-disabled">○ Not configured</span>
                  ) : systemStatus.liveResults.connected ? (
                    <span className="status-ok">
                      ✓ Connected ({systemStatus.liveResults.activePolls} active polls)
                    </span>
                  ) : (
                    <span className="status-pending">⚠ Configured but not connected</span>
                  )}
                </div>
                <div className="status-item">
                  <span>NDI Output:</span>
                  {!systemStatus.ndi.available ? (
                    <span className="status-disabled">○ Not available</span>
                  ) : systemStatus.ndi.active ? (
                    <span className="status-ok">✓ Active</span>
                  ) : (
                    <span className="status-pending">⚠ Available but inactive</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">Documentation</div>
          <div className="card-body">
            <ul className="doc-links">
              <li><a href="#" className="doc-link">Getting Started Guide</a></li>
              <li><a href="#" className="doc-link">OGRAF Template Development</a></li>
              <li><a href="#" className="doc-link">LiveResults API Integration</a></li>
              <li><a href="#" className="doc-link">Keyboard Shortcuts</a></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

