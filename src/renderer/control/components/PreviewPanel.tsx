/**
 * Preview Panel Component
 * Shows preview of selected graphic with data
 */

import { Monitor, Database, Info } from 'lucide-react';
import { OGrafManifest } from '../../../shared/types/ograf';

interface PreviewPanelProps {
  manifest: OGrafManifest | null;
  data: Record<string, any>;
  isPlaying: boolean;
}

export function PreviewPanel({ manifest, data, isPlaying }: PreviewPanelProps) {
  if (!manifest) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#666',
        gap: '1rem'
      }}>
        <Monitor size={48} style={{ opacity: 0.3 }} />
        <p>Select an item to preview</p>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      gap: '1rem'
    }}>
      {/* Preview Header */}
      <div style={{
        padding: '0.75rem',
        background: '#1a1a1a',
        borderRadius: '4px',
        border: '1px solid #333'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <Monitor size={18} />
          <span style={{ fontWeight: 'bold' }}>{manifest.name}</span>
          {isPlaying && (
            <span style={{
              padding: '0.125rem 0.5rem',
              background: '#4a9e4a',
              color: 'white',
              fontSize: '0.7rem',
              fontWeight: 'bold',
              borderRadius: '3px'
            }}>
              ON AIR
            </span>
          )}
        </div>
        {manifest.description && (
          <div style={{ fontSize: '0.875rem', color: '#888' }}>
            {manifest.description}
          </div>
        )}
      </div>

      {/* Visual Preview Placeholder */}
      <div style={{
        flex: 1,
        background: '#0a0a0a',
        borderRadius: '4px',
        border: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '200px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Aspect ratio guide (16:9) */}
        <div style={{
          width: '100%',
          maxWidth: '400px',
          aspectRatio: '16/9',
          background: 'linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%)',
          border: '2px dashed #333',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '0.5rem',
          padding: '1rem'
        }}>
          <Monitor size={32} style={{ opacity: 0.3 }} />
          <div style={{ fontSize: '0.875rem', color: '#666', textAlign: 'center' }}>
            Visual Preview
          </div>
          <div style={{ fontSize: '0.75rem', color: '#555', textAlign: 'center' }}>
            1920 × 1080 (16:9)
          </div>
        </div>
      </div>

      {/* Data Preview */}
      <div style={{
        background: '#1a1a1a',
        borderRadius: '4px',
        border: '1px solid #333',
        maxHeight: '300px',
        overflow: 'auto'
      }}>
        <div style={{
          padding: '0.75rem',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontWeight: 'bold',
          position: 'sticky',
          top: 0,
          background: '#1a1a1a',
          zIndex: 1
        }}>
          <Database size={16} />
          Data Preview
        </div>
        <div style={{ padding: '0.75rem' }}>
          {Object.keys(data).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {Object.entries(data).map(([key, value]) => (
                <div
                  key={key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr',
                    gap: '0.5rem',
                    padding: '0.5rem',
                    background: '#0a0a0a',
                    borderRadius: '3px',
                    fontSize: '0.875rem'
                  }}
                >
                  <div style={{ color: '#888', fontWeight: '500' }}>{key}:</div>
                  <div style={{
                    color: '#fff',
                    wordBreak: 'break-word',
                    fontFamily: 'monospace'
                  }}>
                    {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              padding: '2rem',
              textAlign: 'center',
              color: '#666',
              fontSize: '0.875rem'
            }}>
              No data available
            </div>
          )}
        </div>
      </div>

      {/* Template Info */}
      <div style={{
        padding: '0.75rem',
        background: '#1a1a1a',
        borderRadius: '4px',
        border: '1px solid #333',
        fontSize: '0.75rem'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.5rem',
          fontWeight: 'bold'
        }}>
          <Info size={14} />
          Template Info
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#888' }}>
          <div><strong>ID:</strong> {manifest.id}</div>
          <div><strong>Version:</strong> {manifest.version}</div>
          {manifest.author && (
            <div><strong>Author:</strong> {manifest.author.name}</div>
          )}
          <div>
            <strong>Real-time:</strong> {manifest.supportsRealTime ? 'Yes' : 'No'}
          </div>
          {manifest.stepCount !== undefined && (
            <div><strong>Steps:</strong> {manifest.stepCount === 0 ? 'Auto' : manifest.stepCount}</div>
          )}
        </div>
      </div>
    </div>
  );
}

