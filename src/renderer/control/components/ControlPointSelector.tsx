/**
 * Control Point Selector Component
 * Allows selecting control points from a competition
 */

import { useState, useEffect } from 'react';

interface ControlPoint {
  code: string;
  name?: string;
  order?: number;
}

interface ControlPointSelectorProps {
  competitionId: number;
  className?: string;
  selectedControlCode?: string;
  onSelect: (controlCode: string | null) => void;
  multiple?: boolean;
  includeFinish?: boolean;
  compact?: boolean;
}

export function ControlPointSelector({
  competitionId,
  className,
  selectedControlCode,
  onSelect,
  includeFinish = false,
  compact = false
}: ControlPointSelectorProps) {
  const [controlPoints, setControlPoints] = useState<ControlPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!competitionId || !className) {
      setControlPoints([]);
      return;
    }

    loadControlPoints();
  }, [competitionId, className]);

  const loadControlPoints = async () => {
    setLoading(true);
    setError(null);

    try {
      // Validate inputs
      if (!competitionId || !className) {
        throw new Error('Competition ID and class name are required');
      }

      console.log('[ControlPointSelector] Fetching split controls', {
        competitionId,
        className
      });

      // Fetch split controls from LiveResults API via IPC
      const result = await window.electronAPI.invoke('data:getClassResults', {
        competitionId,
        className
      });

      console.log('[ControlPointSelector] IPC response received', {
        result,
        resultType: typeof result,
        hasSuccess: result?.success !== undefined
      });

      // Handle undefined or malformed response
      if (!result) {
        throw new Error('IPC handler returned undefined response');
      }

      if (result.success === undefined) {
        throw new Error('IPC response missing success field - response may be malformed');
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to load control points');
      }

      const classResult = result.data;
      if (!classResult) {
        throw new Error('No class result data returned from API');
      }

      const splitControls = classResult.splitcontrols || [];

      console.log('[ControlPointSelector] Split controls loaded', {
        count: splitControls.length,
        controls: splitControls,
        firstControlType: splitControls.length > 0 ? typeof splitControls[0] : 'N/A',
        firstControl: splitControls.length > 0 ? splitControls[0] : null
      });

      // Validate and normalize split controls to ensure they are strings
      const normalizedControls = splitControls.map((control: any) => {
        // Handle case where control might be an object with a code property
        if (typeof control === 'object' && control !== null && 'code' in control) {
          return String(control.code);
        }
        // Handle case where control is already a string
        if (typeof control === 'string') {
          return control;
        }
        // Fallback: convert to string
        return String(control);
      });

      console.log('[ControlPointSelector] Normalized controls', {
        count: normalizedControls.length,
        controls: normalizedControls
      });

      // Convert split control codes to ControlPoint objects
      const controlPointsList: ControlPoint[] = normalizedControls.map((code: string, index: number) => {
        // Ensure code is a string and not an object
        const codeStr = typeof code === 'string' ? code : String(code);
        return {
          code: codeStr,
          name: `Control ${codeStr}`,
          order: index
        };
      });

      // Add Start option at the beginning
      controlPointsList.unshift({ code: 'Start', name: 'Start', order: -1 });

      if (includeFinish) {
        controlPointsList.push({ code: 'F', name: 'Finish', order: 999 });
      }

      setControlPoints(controlPointsList);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load control points';
      console.error('[ControlPointSelector] Error loading control points', {
        error: errorMessage,
        competitionId,
        className
      });
      setError(errorMessage);
      setControlPoints([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        padding: compact ? '0.5rem' : '0.75rem',
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: '4px',
        color: '#888',
        fontSize: compact ? '0.75rem' : '0.875rem'
      }}>
        Loading control points...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: compact ? '0.5rem' : '0.75rem',
        background: '#2a1a1a',
        border: '1px solid #9e4a4a',
        borderRadius: '4px',
        color: '#9e4a4a',
        fontSize: compact ? '0.75rem' : '0.875rem'
      }}>
        {error}
      </div>
    );
  }

  if (controlPoints.length === 0) {
    return (
      <div style={{
        padding: compact ? '0.5rem' : '0.75rem',
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: '4px',
        color: '#888',
        fontSize: compact ? '0.75rem' : '0.875rem'
      }}>
        No control points available
      </div>
    );
  }

  return (
    <select
      className="input"
      value={selectedControlCode || ''}
      onChange={(e) => onSelect(e.target.value || null)}
      style={{
        width: '100%',
        fontSize: compact ? '0.75rem' : '0.875rem',
        padding: compact ? '0.375rem' : '0.5rem',
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: '4px',
        color: '#fff'
      }}
    >
      <option value="">-- Select Control Point --</option>
      {controlPoints.map((cp, index) => {
        // Ensure key is always a string primitive
        const keyValue = typeof cp.code === 'string' ? cp.code : String(cp.code);
        const displayValue = typeof cp.code === 'string' ? cp.code : String(cp.code);

        if (typeof keyValue !== 'string') {
          console.warn('[ControlPointSelector] Invalid key type for control point', {
            index,
            cp,
            keyType: typeof keyValue,
            keyValue
          });
        }

        return (
          <option key={keyValue} value={displayValue}>
            {cp.name || `Control ${displayValue}`}
          </option>
        );
      })}
    </select>
  );
}

