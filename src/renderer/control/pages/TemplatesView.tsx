/**
 * Templates View Page
 */

import { useState, useEffect } from 'react';
import { RefreshCw, Package } from 'lucide-react';
import { OGrafTemplateInfo } from '../../../shared/types/ograf';

export function TemplatesView() {
  const [templates, setTemplates] = useState<OGrafTemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load templates on mount
  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.invoke('templates:getAll');

      if (result.success) {
        setTemplates(result.templates || []);
      } else {
        setError(result.error || 'Failed to load templates');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleReload = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.invoke('templates:reload');

      if (result.success) {
        setTemplates([]);
        // Reload templates after clearing cache
        await loadTemplates();
      } else {
        setError(result.error || 'Failed to reload templates');
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  };

  const getColorClass = (uicolor: number): string => {
    const colors = ['gray', 'red', 'orange', 'green', 'blue', 'pink', 'violet', 'black'];
    return colors[uicolor] || 'gray';
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Templates</h1>
        <button
          className="btn btn-primary"
          onClick={handleReload}
          disabled={loading}
        >
          <RefreshCw size={18} />
          Reload Templates
        </button>
      </div>

      {error && (
        <div className="alert alert-error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading templates...</p>
        </div>
      ) : templates.length === 0 ? (
        <div className="empty-state">
          <Package size={64} />
          <h2>No Templates Found</h2>
          <p>Place OGRAF templates in the <code>templates/</code> directory</p>
          <button className="btn btn-primary" onClick={handleReload}>
            <RefreshCw size={18} />
            Scan for Templates
          </button>
        </div>
      ) : (
        <div className="templates-grid">
          {templates.map((template) => (
            <div
              key={template.manifest.id}
              className={`template-card color-${getColorClass(template.uicolor)}`}
            >
              <div className="template-header">
                <h3>{template.manifest.name}</h3>
                <span className="template-version">v{template.manifest.version}</span>
              </div>
              <p className="template-description">{template.description}</p>
              <div className="template-meta">
                <span className="template-id">{template.manifest.id}</span>
                {template.manifest.author && (
                  <span className="template-author">by {template.manifest.author.name}</span>
                )}
              </div>
              <div className="template-features">
                {template.manifest.supportsRealTime && (
                  <span className="feature-badge">Real-time</span>
                )}
                {template.manifest.stepCount !== undefined && (
                  <span className="feature-badge">
                    {template.manifest.stepCount === 0 ? 'Auto' :
                     template.manifest.stepCount === 1 ? 'Single' :
                     `${template.manifest.stepCount} steps`}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

