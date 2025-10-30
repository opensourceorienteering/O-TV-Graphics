/**
 * Template Field Editor Component
 * Dynamic form generator for OGRAF template fields
 */

import { useState, useEffect } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { OGrafManifest, JSONSchemaProperty } from '../../../shared/types/ograf';

interface TemplateFieldEditorProps {
  manifest: OGrafManifest;
  initialData?: Record<string, any>;
  onChange: (data: Record<string, any>) => void;
  onSave?: () => void;
  onCancel?: () => void;
  showActions?: boolean;

  /** LiveResults integration */
  competitionId?: number;
  className?: string;
  enableAutoFill?: boolean;

  /** Fields to exclude from rendering (e.g., auto-populated API fields) */
  excludeFields?: string[];
}

export function TemplateFieldEditor({
  manifest,
  initialData = {},
  onChange,
  onSave,
  onCancel,
  showActions = true,
  competitionId,
  className,
  enableAutoFill = false,
  excludeFields = []
}: TemplateFieldEditorProps) {
  const [formData, setFormData] = useState<Record<string, any>>(initialData);
  const [autoFilling, setAutoFilling] = useState(false);
  const [autoFillError, setAutoFillError] = useState<string | null>(null);

  // Update form data when initial data changes
  // Use JSON.stringify to do deep comparison and avoid unnecessary updates
  useEffect(() => {
    const initialDataStr = JSON.stringify(initialData);
    const formDataStr = JSON.stringify(formData);

    if (initialDataStr !== formDataStr) {
      setFormData(initialData);
    }
  }, [initialData]); // Remove formData from dependencies to avoid loop

  const handleFieldChange = (fieldName: string, value: any) => {
    const newFormData = {
      ...formData,
      [fieldName]: value
    };
    setFormData(newFormData);
    // Call onChange immediately when user makes a change
    onChange(newFormData);
  };

  const handleAutoFill = async () => {
    if (!competitionId || !className) {
      setAutoFillError('Competition and class must be selected');
      return;
    }

    setAutoFilling(true);
    setAutoFillError(null);

    try {
      // Get competition data
      const compResult = await window.electronAPI.invoke('data:getCachedCompetitions');
      if (!compResult.success) {
        throw new Error('Failed to get competition data');
      }

      const competition = compResult.data?.find((c: any) => c.id === competitionId);
      if (!competition) {
        throw new Error('Competition not found');
      }

      // Get class results
      const resultsResult = await window.electronAPI.invoke('data:getResults', competitionId, className);
      if (!resultsResult.success) {
        throw new Error(resultsResult.error || 'Failed to get results');
      }

      // Auto-map data using the mapper
      const mapResult = await window.electronAPI.invoke('data:autoMapTemplate', {
        competition,
        className,
        classResult: resultsResult.data,
        templateId: manifest.id
      });

      if (mapResult.success && mapResult.data) {
        setFormData(mapResult.data);
        // Notify parent of the auto-filled data
        onChange(mapResult.data);
        setAutoFillError(null);
      } else {
        throw new Error(mapResult.error || 'Failed to map data');
      }
    } catch (err) {
      setAutoFillError(err instanceof Error ? err.message : 'Auto-fill failed');
    } finally {
      setAutoFilling(false);
    }
  };

  const renderField = (fieldName: string, schema: JSONSchemaProperty) => {
    const value = formData[fieldName] ?? schema.default ?? '';

    // Determine field type from schema
    const fieldType = schema.type;
    const enumValues = schema.enum;

    // Text input (string without enum)
    if (fieldType === 'string' && !enumValues) {
      return (
        <input
          type="text"
          className="input"
          value={value}
          onChange={(e) => handleFieldChange(fieldName, e.target.value)}
          placeholder={schema.description || fieldName}
        />
      );
    }

    // Number input
    if (fieldType === 'number') {
      return (
        <input
          type="number"
          className="input"
          value={value}
          onChange={(e) => handleFieldChange(fieldName, parseFloat(e.target.value))}
          placeholder={schema.description || fieldName}
          min={schema.minimum}
          max={schema.maximum}
          step={0.1}
        />
      );
    }

    // Boolean (checkbox)
    if (fieldType === 'boolean') {
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => handleFieldChange(fieldName, e.target.checked)}
            style={{ width: 'auto' }}
          />
          <span>{schema.description || 'Enable'}</span>
        </label>
      );
    }

    // Dropdown (enum values)
    if (enumValues && enumValues.length > 0) {
      return (
        <select
          className="input"
          value={value}
          onChange={(e) => handleFieldChange(fieldName, e.target.value)}
        >
          <option value="">-- Select --</option>
          {enumValues.map((enumValue) => (
            <option key={String(enumValue)} value={String(enumValue)}>
              {String(enumValue)}
            </option>
          ))}
        </select>
      );
    }

    // Default: text input
    return (
      <input
        type="text"
        className="input"
        value={value}
        onChange={(e) => handleFieldChange(fieldName, e.target.value)}
        placeholder={schema.description || fieldName}
      />
    );
  };

  const properties = manifest.schema?.properties || {};
  const requiredFields = manifest.schema?.required || [];

  // Filter out excluded fields (e.g., auto-populated API fields)
  const visibleProperties = Object.fromEntries(
    Object.entries(properties).filter(([fieldName]) => !excludeFields.includes(fieldName))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Template Info */}
      <div style={{
        padding: '0.75rem',
        background: '#1a1a1a',
        borderRadius: '4px',
        border: '1px solid #333'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
              {manifest.name}
            </div>
            {manifest.description && (
              <div style={{ fontSize: '0.875rem', color: '#888' }}>
                {manifest.description}
              </div>
            )}
          </div>

          {/* Auto-fill Button */}
          {enableAutoFill && competitionId && className && (
            <button
              className="btn btn-sm"
              onClick={handleAutoFill}
              disabled={autoFilling}
              title="Auto-fill from LiveResults"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: '#2a4a2a',
                borderColor: '#4a9e4a'
              }}
            >
              {autoFilling ? (
                <RefreshCw size={14} className="spin" />
              ) : (
                <Sparkles size={14} />
              )}
              Auto-fill
            </button>
          )}
        </div>

        {/* Auto-fill Error */}
        {autoFillError && (
          <div style={{
            marginTop: '0.5rem',
            padding: '0.5rem',
            background: '#3a1a1a',
            border: '1px solid #9e4a4a',
            borderRadius: '4px',
            color: '#ff6b6b',
            fontSize: '0.75rem'
          }}>
            {autoFillError}
          </div>
        )}
      </div>

      {/* Fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {Object.entries(visibleProperties).map(([fieldName, schema]) => (
          <div key={fieldName}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
              {schema.title || fieldName}
              {requiredFields.includes(fieldName) && (
                <span style={{ color: '#ff6b6b', marginLeft: '0.25rem' }}>*</span>
              )}
            </label>
            {schema.description && schema.type !== 'boolean' && (
              <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>
                {schema.description}
              </div>
            )}
            {renderField(fieldName, schema)}
          </div>
        ))}
      </div>

      {/* No fields message */}
      {Object.keys(visibleProperties).length === 0 && (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          color: '#666',
          background: '#1a1a1a',
          borderRadius: '4px',
          border: '1px dashed #333'
        }}>
          {excludeFields.length > 0 ? (
            <>
              <div style={{ marginBottom: '0.5rem' }}>All fields are auto-populated from API</div>
              <div style={{ fontSize: '0.75rem', color: '#888' }}>
                Configure data source settings above to populate template fields
              </div>
            </>
          ) : (
            'No editable fields for this template'
          )}
        </div>
      )}

      {/* Actions */}
      {showActions && (onSave || onCancel) && (
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          justifyContent: 'flex-end',
          paddingTop: '0.5rem',
          borderTop: '1px solid #333'
        }}>
          {onCancel && (
            <button className="btn" onClick={onCancel}>
              Cancel
            </button>
          )}
          {onSave && (
            <button className="btn btn-primary" onClick={onSave}>
              Save Changes
            </button>
          )}
        </div>
      )}
    </div>
  );
}

