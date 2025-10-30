/**
 * Data Source Selector Component
 * Allows users to select a LiveResults data source for a rundown
 */

import { useState, useEffect } from 'react';
import { RefreshCw, Check, X, Database } from 'lucide-react';
import { DataSourceConfig } from '../../../shared/types/dataSource';
import { useToast } from '../contexts/ToastContext';

interface DataSourceSelectorProps {
  selectedSourceId?: string;
  onSelect: (sourceId: string | null, dataSource: DataSourceConfig | null) => void;
  onClose?: () => void;
  showCloseButton?: boolean;
  compact?: boolean;
  filterType?: 'liveresults' | 'mysql'; // Filter by data source type
}

export function DataSourceSelector({
  selectedSourceId,
  onSelect,
  onClose,
  showCloseButton = false,
  compact = false,
  filterType = 'liveresults'
}: DataSourceSelectorProps) {
  const toast = useToast();
  const [dataSources, setDataSources] = useState<DataSourceConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(selectedSourceId);

  // Sync internal state when prop changes
  useEffect(() => {
    setSelectedId(selectedSourceId);
  }, [selectedSourceId]);

  // Load data sources on mount
  useEffect(() => {
    loadDataSources();
  }, []);

  const loadDataSources = async () => {
    console.log('[DataSourceSelector] Loading data sources', { timestamp: Date.now() });
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.invoke('dataSource:getAll');
      console.log('[DataSourceSelector] Received data sources response', {
        success: result.success,
        count: result.data?.length,
        timestamp: Date.now()
      });

      if (result.success) {
        // Filter by type if specified
        let sources = result.data || [];
        if (filterType) {
          sources = sources.filter((ds: DataSourceConfig) => ds.type === filterType);
        }
        
        // Only show enabled data sources
        sources = sources.filter((ds: DataSourceConfig) => ds.enabled);
        
        setDataSources(sources);
        
        if (sources.length === 0) {
          setError(`No ${filterType} data sources configured. Please add one in Settings > Data.`);
        }
      } else {
        throw new Error(result.error || 'Failed to load data sources');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load data sources';
      console.error('[DataSourceSelector] Failed to load data sources', { error: errorMessage });
      setError(errorMessage);
      toast?.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (sourceId: string) => {
    const dataSource = dataSources.find(ds => ds.id === sourceId);
    setSelectedId(sourceId);
    onSelect(sourceId, dataSource || null);
    
    if (dataSource) {
      toast?.success(`Selected: ${dataSource.name}`);
    }
  };

  const handleClear = () => {
    setSelectedId(undefined);
    onSelect(null, null);
    toast?.info('Data source selection cleared');
  };

  if (compact) {
    // Compact dropdown mode
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            className="input"
            value={selectedId || ''}
            onChange={(e) => {
              const value = e.target.value;
              if (value) {
                handleSelect(value);
              } else {
                handleClear();
              }
            }}
            disabled={loading || dataSources.length === 0}
            style={{ flex: 1 }}
          >
            <option value="">-- Select Data Source --</option>
            {dataSources.map(ds => (
              <option key={ds.id} value={ds.id}>
                {ds.name} ({ds.config.baseUrl})
              </option>
            ))}
          </select>
          
          <button
            className="btn btn-sm"
            onClick={loadDataSources}
            disabled={loading}
            title="Refresh data sources"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>

        {error && (
          <div style={{
            padding: '0.5rem',
            background: '#2a1a1a',
            border: '1px solid #9e4a4a',
            borderRadius: '4px',
            color: '#9e4a4a',
            fontSize: '0.75rem'
          }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // Full panel mode
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem',
      padding: '1rem',
      background: '#1a1a1a',
      borderRadius: '4px',
      border: '1px solid #333'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 'bold' }}>
          Select Data Source
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-sm"
            onClick={loadDataSources}
            disabled={loading}
            title="Refresh data sources"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
          {showCloseButton && onClose && (
            <button
              className="btn btn-sm"
              onClick={onClose}
              title="Close"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          color: '#888',
          fontSize: '0.875rem'
        }}>
          <RefreshCw size={20} className="spin" style={{ marginBottom: '0.5rem' }} />
          <div>Loading data sources...</div>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div style={{
          padding: '1rem',
          background: '#2a1a1a',
          border: '1px solid #9e4a4a',
          borderRadius: '4px',
          color: '#9e4a4a',
          fontSize: '0.875rem'
        }}>
          {error}
        </div>
      )}

      {/* Data Source List */}
      {!loading && dataSources.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          maxHeight: '300px',
          overflowY: 'auto'
        }}>
          {/* Clear Selection Option */}
          {selectedId && (
            <div
              onClick={handleClear}
              style={{
                padding: '0.5rem 0.75rem',
                background: '#2a2a2a',
                borderRadius: '4px',
                cursor: 'pointer',
                border: '1px solid #666',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontStyle: 'italic',
                color: '#888',
                fontSize: '0.875rem'
              }}
            >
              <X size={14} />
              Clear selection
            </div>
          )}

          {/* Data Source Items */}
          {dataSources.map(ds => {
            const isSelected = selectedId === ds.id;
            
            return (
              <div
                key={ds.id}
                onClick={() => handleSelect(ds.id)}
                style={{
                  padding: '0.75rem',
                  background: isSelected ? '#2a4a2a' : '#2a2a2a',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  border: isSelected ? '1px solid #4a9e4a' : '1px solid #333',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = '#333';
                    e.currentTarget.style.borderColor = '#555';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = '#2a2a2a';
                    e.currentTarget.style.borderColor = '#333';
                  }
                }}
              >
                <Database size={16} style={{ color: isSelected ? '#4a9e4a' : '#888' }} />
                
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontWeight: isSelected ? 'bold' : 'normal',
                    fontSize: '0.875rem',
                    marginBottom: '0.25rem'
                  }}>
                    {ds.name}
                  </div>
                  <div style={{
                    fontSize: '0.75rem',
                    color: '#888'
                  }}>
                    {ds.config.baseUrl}
                  </div>
                </div>
                
                {isSelected && (
                  <Check size={16} style={{ color: '#4a9e4a' }} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

