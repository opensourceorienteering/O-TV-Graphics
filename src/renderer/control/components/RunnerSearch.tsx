/**
 * Runner Search Component
 * Search for runners by name or bib number with autocomplete
 */

import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

interface Runner {
  id: string;
  name: string;
  bib: string;
  club?: string;
  className?: string;
  startTime?: string;
}

interface RunnerSearchProps {
  competitionId: number;
  className?: string; // Optional: filter runners by class
  selectedRunnerId?: string;
  onSelect: (runner: Runner | null) => void;
  searchBy?: 'bib' | 'name' | 'both';
  placeholder?: string;
}

export function RunnerSearch({
  competitionId,
  className,
  selectedRunnerId,
  onSelect,
  searchBy = 'both',
  placeholder = 'Search by name or bib number...'
}: RunnerSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [runners, setRunners] = useState<Runner[]>([]);
  const [filteredRunners, setFilteredRunners] = useState<Runner[]>([]);
  const [selectedRunner, setSelectedRunner] = useState<Runner | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load runners when competition or class changes
  useEffect(() => {
    if (!competitionId) {
      setRunners([]);
      return;
    }

    loadRunners();
  }, [competitionId, className]);

  // Sync selected runner when prop or runners list changes
  useEffect(() => {
    if (selectedRunnerId && runners.length > 0) {
      const runner = runners.find(r => r.id === selectedRunnerId);
      if (runner) {
        setSelectedRunner(runner);
        setSearchQuery(runner.name);
      }
    } else if (!selectedRunnerId) {
      setSelectedRunner(null);
      setSearchQuery('');
    }
  }, [selectedRunnerId, runners]);

  // Filter runners when search query changes
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredRunners([]);
      setShowDropdown(false);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = runners.filter((runner) => {
      if (searchBy === 'bib') {
        return runner.bib.toLowerCase().includes(query);
      } else if (searchBy === 'name') {
        return runner.name.toLowerCase().includes(query);
      } else {
        // both
        return runner.name.toLowerCase().includes(query) || runner.bib.toLowerCase().includes(query);
      }
    });

    setFilteredRunners(filtered.slice(0, 10)); // Limit to 10 results
    setShowDropdown(filtered.length > 0);
  }, [searchQuery, runners, searchBy]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadRunners = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.invoke('data:getRunners', {
        competitionId,
        className // Optional: if provided, only fetch runners from this class
      });

      // Check if result is undefined (IPC handler not registered or channel not whitelisted)
      if (!result) {
        throw new Error('IPC handler returned undefined. Please restart the application.');
      }

      if (result.success) {
        setRunners(result.data || []);
      } else {
        throw new Error(result.error || 'Failed to load runners');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load runners';
      setError(errorMessage);
      setRunners([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRunner = (runner: Runner) => {
    setSelectedRunner(runner);
    setSearchQuery(runner.name);
    setShowDropdown(false);
    onSelect(runner);
  };

  const handleClearSelection = () => {
    setSelectedRunner(null);
    setSearchQuery('');
    setFilteredRunners([]);
    onSelect(null);
  };

  if (loading) {
    return (
      <div style={{
        padding: '0.5rem',
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: '4px',
        color: '#888',
        fontSize: '0.875rem'
      }}>
        Loading runners...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: '0.5rem',
        background: '#2a1a1a',
        border: '1px solid #9e4a4a',
        borderRadius: '4px',
        color: '#9e4a4a',
        fontSize: '0.875rem'
      }}>
        {error}
      </div>
    );
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* Search Input */}
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          className="input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => {
            if (filteredRunners.length > 0) {
              setShowDropdown(true);
            }
          }}
          placeholder={placeholder}
          style={{
            width: '100%',
            paddingLeft: '2.5rem',
            paddingRight: selectedRunner ? '2.5rem' : '0.75rem',
            fontSize: '0.875rem'
          }}
        />
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
        {selectedRunner && (
          <button
            onClick={handleClearSelection}
            style={{
              position: 'absolute',
              right: '0.5rem',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Dropdown Results */}
      {showDropdown && filteredRunners.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '0.25rem',
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '4px',
          maxHeight: '300px',
          overflowY: 'auto',
          zIndex: 1000,
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)'
        }}>
          {filteredRunners.map((runner) => (
            <div
              key={runner.id}
              onClick={() => handleSelectRunner(runner)}
              style={{
                padding: '0.75rem',
                cursor: 'pointer',
                borderBottom: '1px solid #2a2a2a',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#2a2a2a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: '500', fontSize: '0.875rem', color: '#fff' }}>
                    {runner.name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.125rem' }}>
                    {runner.club} • {runner.className}
                  </div>
                </div>
                <div style={{
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  color: '#4a7c9e',
                  padding: '0.25rem 0.5rem',
                  background: '#1a2a3a',
                  borderRadius: '3px'
                }}>
                  #{runner.bib}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected Runner Display */}
      {selectedRunner && (
        <div style={{
          marginTop: '0.5rem',
          padding: '0.5rem',
          background: '#1a2a1a',
          border: '1px solid #3a5a3a',
          borderRadius: '4px',
          fontSize: '0.75rem',
          color: '#888'
        }}>
          Selected: <strong style={{ color: '#4a9e4a' }}>{selectedRunner.name}</strong> (#{selectedRunner.bib})
        </div>
      )}
    </div>
  );
}

