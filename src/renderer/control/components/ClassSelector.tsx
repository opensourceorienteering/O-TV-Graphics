/**
 * Class Selector Component
 * Allows users to select a competition class for a rundown item
 */

import { useState, useEffect } from 'react';
import { RefreshCw, Check, X } from 'lucide-react';
import { LiveResultsClass } from '../../../shared/types/liveresults';
import { useToast } from '../contexts/ToastContext';

interface ClassSelectorProps {
  competitionId: number;
  selectedClassName?: string;
  onSelect: (className: string | null) => void;
  onClose?: () => void;
  showCloseButton?: boolean;
  compact?: boolean;
  sourceId?: string; // Optional data source ID (defaults to 'liveresults-default')
}

export function ClassSelector({
  competitionId,
  selectedClassName,
  onSelect,
  onClose,
  showCloseButton = false,
  compact = false,
  sourceId = 'liveresults-default'
}: ClassSelectorProps) {
  const toast = useToast();
  const [classes, setClasses] = useState<LiveResultsClass[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState<string | undefined>(selectedClassName);

  // Sync internal state when prop changes
  useEffect(() => {
    setSelectedClass(selectedClassName);
  }, [selectedClassName]);

  // Load classes when competition or sourceId changes
  useEffect(() => {
    if (competitionId) {
      console.log('[ClassSelector] Loading classes for competition', { competitionId, sourceId });
      loadClasses();
    }
  }, [competitionId, sourceId]);

  const loadClasses = async () => {
    console.log('[ClassSelector] loadClasses called', { competitionId, sourceId, timestamp: Date.now() });
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.invoke('dataSource:getClasses', sourceId, competitionId);
      console.log('[ClassSelector] Received classes response', {
        success: result.success,
        classCount: result.data?.length,
        timestamp: Date.now()
      });

      if (result.success) {
        // Ensure data is an array
        const data = result.data;
        if (Array.isArray(data)) {
          setClasses(data);
          console.log('[ClassSelector] Classes loaded successfully', { count: data.length });
        } else {
          setClasses([]);
          const errorMsg = 'Invalid data format received from server';
          setError(errorMsg);
          toast.error(errorMsg);
          console.error('[ClassSelector] Invalid data format', { data });
        }
      } else {
        const errorMsg = result.error || 'Failed to load classes';
        setError(errorMsg);
        toast.error(errorMsg);
        console.error('[ClassSelector] Failed to load classes', { error: errorMsg });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      toast.error(`Error loading classes: ${errorMsg}`);
      console.error('[ClassSelector] Exception loading classes', { error: errorMsg });
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (className: string) => {
    setSelectedClass(className);
    onSelect(className);
  };

  const handleClear = () => {
    setSelectedClass(undefined);
    onSelect(null);
  };

  if (compact) {
    // Compact dropdown mode
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            className="input"
            value={selectedClass || ''}
            onChange={(e) => {
              const value = e.target.value;
              if (value) {
                handleSelect(value);
              } else {
                handleClear();
              }
            }}
            disabled={loading || classes.length === 0}
            style={{ flex: 1 }}
          >
            <option value="">-- Select Class --</option>
            {Array.isArray(classes) && classes.map(cls => (
              <option key={cls.className} value={cls.className}>
                {cls.className}
              </option>
            ))}
          </select>

          <button
            className="btn btn-sm"
            onClick={loadClasses}
            disabled={loading}
            title="Refresh classes"
            style={{
              padding: '0.375rem 0.5rem',
              fontSize: '0.75rem',
              minWidth: 'auto'
            }}
          >
            {loading ? '⟳' : '↻'}
          </button>
        </div>

        {loading && (
          <div style={{
            fontSize: '0.75rem',
            color: '#888',
            padding: '0.25rem'
          }}>
            Loading classes...
          </div>
        )}

        {error && (
          <div style={{
            fontSize: '0.75rem',
            color: '#ff6b6b',
            padding: '0.25rem'
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
          Select Class
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-sm"
            onClick={loadClasses}
            disabled={loading}
            title="Refresh classes"
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

      {/* Error Message */}
      {error && (
        <div style={{
          padding: '0.75rem',
          background: '#3a1a1a',
          border: '1px solid #9e4a4a',
          borderRadius: '4px',
          color: '#ff6b6b',
          fontSize: '0.875rem'
        }}>
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          color: '#888'
        }}>
          Loading classes...
        </div>
      )}

      {/* Classes List */}
      {!loading && classes.length === 0 && !error && (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          color: '#888',
          background: '#0a0a0a',
          borderRadius: '4px',
          border: '1px dashed #333'
        }}>
          No classes available
        </div>
      )}

      {!loading && classes.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          maxHeight: '300px',
          overflowY: 'auto'
        }}>
          {/* Clear Selection Option */}
          {selectedClass && (
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

          {/* Class Items */}
          {Array.isArray(classes) && classes.map(cls => {
            const isSelected = selectedClass === cls.className;

            return (
              <div
                key={cls.className}
                onClick={() => handleSelect(cls.className)}
                style={{
                  padding: '0.5rem 0.75rem',
                  background: isSelected ? '#2a4a2a' : '#1a1a1a',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  border: isSelected ? '2px solid #4a9e4a' : '1px solid #333',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  fontSize: '0.875rem'
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = '#2a2a2a';
                    e.currentTarget.style.borderColor = '#555';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = '#1a1a1a';
                    e.currentTarget.style.borderColor = '#333';
                  }
                }}
              >
                {/* Selected Indicator */}
                {isSelected && (
                  <div style={{
                    position: 'absolute',
                    top: '0.4rem',
                    right: '0.5rem',
                    color: '#4a9e4a'
                  }}>
                    <Check size={16} />
                  </div>
                )}

                {/* Class Name */}
                <div style={{ paddingRight: isSelected ? '2rem' : 0, fontWeight: isSelected ? 'bold' : 'normal' }}>
                  {cls.className}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

