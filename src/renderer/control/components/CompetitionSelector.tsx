/**
 * Competition Selector Component
 * Allows users to select a LiveResults competition for the project
 * Enhanced with search/filter functionality
 */

import { useState, useEffect } from 'react';
import { RefreshCw, Check, X, Search } from 'lucide-react';
import { LiveResultsCompetition } from '../../../shared/types/liveresults';
import { useToast } from '../contexts/ToastContext';

interface CompetitionSelectorProps {
  selectedCompetitionId?: number;
  onSelect: (competition: LiveResultsCompetition | null) => void;
  onClose?: () => void;
  showCloseButton?: boolean;
  sourceId?: string; // Optional data source ID (defaults to 'liveresults-default')
}

export function CompetitionSelector({
  selectedCompetitionId,
  onSelect,
  onClose,
  showCloseButton = false,
  sourceId = 'liveresults-default'
}: CompetitionSelectorProps) {
  const toast = useToast();
  const [competitions, setCompetitions] = useState<LiveResultsCompetition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | undefined>(selectedCompetitionId);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Load competitions on mount or when sourceId changes
  useEffect(() => {
    loadCompetitions();
  }, [sourceId]);

  const loadCompetitions = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.invoke('dataSource:getCompetitions', sourceId);

      if (result.success) {
        // Ensure data is an array
        const data = result.data;

        if (Array.isArray(data)) {
          setCompetitions(data);
        } else {
          setCompetitions([]);
          const errorMsg = 'Invalid data format received from server';
          setError(errorMsg);
          toast.error(errorMsg);
        }
      } else {
        const errorMsg = result.error || 'Failed to load competitions';
        setError(errorMsg);
        toast.error(errorMsg);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      toast.error(`Error loading competitions: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (competition: LiveResultsCompetition) => {
    setSelectedId(competition.id);
    onSelect(competition);
  };

  const handleClear = () => {
    setSelectedId(undefined);
    onSelect(null);
  };

  // Filter competitions based on search query
  const filteredCompetitions = competitions.filter(competition => {
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    return (
      competition.name.toLowerCase().includes(query) ||
      competition.organizer.toLowerCase().includes(query) ||
      competition.date.toLowerCase().includes(query)
    );
  });

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
          Select Competition
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-sm"
            onClick={loadCompetitions}
            disabled={loading}
            title="Refresh competitions"
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

      {/* Search Input */}
      {!loading && competitions.length > 0 && (
        <div style={{ position: 'relative' }}>
          <Search
            size={16}
            style={{
              position: 'absolute',
              left: '0.75rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#888',
              pointerEvents: 'none'
            }}
          />
          <input
            type="text"
            className="input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search competitions..."
            style={{
              width: '100%',
              paddingLeft: '2.5rem',
              fontSize: '0.875rem'
            }}
          />
        </div>
      )}

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
          Loading competitions...
        </div>
      )}

      {/* Competitions List */}
      {!loading && competitions.length === 0 && !error && (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          color: '#888',
          background: '#0a0a0a',
          borderRadius: '4px',
          border: '1px dashed #333'
        }}>
          No competitions available
        </div>
      )}

      {!loading && competitions.length > 0 && filteredCompetitions.length === 0 && (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          color: '#888',
          background: '#0a0a0a',
          borderRadius: '4px',
          border: '1px dashed #333'
        }}>
          No competitions match your search
        </div>
      )}

      {!loading && filteredCompetitions.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          maxHeight: '400px',
          overflowY: 'auto'
        }}>
          {/* Clear Selection Option */}
          {selectedId && (
            <div
              onClick={handleClear}
              style={{
                padding: '0.75rem',
                background: '#2a2a2a',
                borderRadius: '4px',
                cursor: 'pointer',
                border: '1px solid #666',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontStyle: 'italic',
                color: '#888'
              }}
            >
              <X size={16} />
              Clear selection
            </div>
          )}

          {/* Competition Items */}
          {filteredCompetitions.map(competition => {
            const isSelected = selectedId === competition.id;

            return (
              <div
                key={competition.id}
                onClick={() => handleSelect(competition)}
                style={{
                  padding: '0.75rem',
                  background: isSelected ? '#2a4a2a' : '#1a1a1a',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  border: isSelected ? '2px solid #4a9e4a' : '1px solid #333',
                  transition: 'all 0.2s ease',
                  position: 'relative'
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
                    top: '0.5rem',
                    right: '0.5rem',
                    color: '#4a9e4a'
                  }}>
                    <Check size={18} />
                  </div>
                )}

                {/* Competition Info */}
                <div style={{ paddingRight: isSelected ? '2rem' : 0 }}>
                  <div style={{
                    fontWeight: 'bold',
                    marginBottom: '0.25rem',
                    fontSize: '0.95rem'
                  }}>
                    {competition.name}
                  </div>
                  <div style={{
                    fontSize: '0.75rem',
                    color: '#888',
                    display: 'flex',
                    gap: '1rem'
                  }}>
                    <span>📅 {competition.date}</span>
                    <span>🏢 {competition.organizer}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

