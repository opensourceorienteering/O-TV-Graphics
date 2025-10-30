/**
 * Data Source UI Renderer
 * Dynamically renders UI controls based on template datasource configuration
 */

import { UIControl, FieldMapping } from '../../../shared/types/template-datasource';
import { ClassSelector } from './ClassSelector';
import { ControlPointSelector } from './ControlPointSelector';
import { RunnerSearch } from './RunnerSearch';

interface DataSourceUIRendererProps {
  controls: UIControl[];
  competitionId: number;
  values: Record<string, any>;
  onChange: (fieldName: string, value: any) => void;
  /** Optional: Field mappings to render overridable fields */
  fieldMappings?: FieldMapping[];
}

export function DataSourceUIRenderer({
  controls,
  competitionId,
  values,
  onChange,
  fieldMappings
}: DataSourceUIRendererProps) {
  /**
   * Render an overridable field as a text input
   */
  const renderOverridableField = (mapping: FieldMapping) => {
    const value = values[mapping.templateField] || '';
    const label = mapping.uiLabel || mapping.templateField;

    return (
      <div key={mapping.templateField} style={{ marginBottom: '0.75rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: '500' }}>
          {label}
          {mapping.required && <span style={{ color: '#9e4a4a', marginLeft: '0.25rem' }}>*</span>}
        </label>
        <input
          type="text"
          className="input"
          value={value}
          onChange={(e) => onChange(mapping.templateField, e.target.value)}
          placeholder={`Override ${label.toLowerCase()}`}
          style={{
            width: '100%',
            fontSize: '0.875rem',
            padding: '0.5rem',
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '4px',
            color: '#fff'
          }}
        />
        {mapping.uiHelpText && (
          <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.25rem' }}>
            {mapping.uiHelpText}
          </div>
        )}
      </div>
    );
  };

  const renderControl = (control: UIControl) => {
    switch (control.type) {
      case 'class-selector':
        return (
          <div key={control.storeAs} style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: '500' }}>
              {control.label}
              {control.required && <span style={{ color: '#9e4a4a', marginLeft: '0.25rem' }}>*</span>}
            </label>
            <ClassSelector
              key={`class-selector-${competitionId}`}
              competitionId={competitionId}
              selectedClassName={values[control.storeAs]}
              onSelect={(className) => onChange(control.storeAs, className)}
              compact={control.compact}
            />
            {control.helpText && (
              <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.25rem' }}>
                {control.helpText}
              </div>
            )}
          </div>
        );

      case 'runner-search':
        return (
          <div key={control.storeAs} style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: '500' }}>
              {control.label}
              {control.required && <span style={{ color: '#9e4a4a', marginLeft: '0.25rem' }}>*</span>}
            </label>
            <RunnerSearch
              competitionId={competitionId}
              className={values.className} // Pass selected className to filter runners
              selectedRunnerId={values[control.storeAs]}
              onSelect={(runner) => {
                // Store the runner ID
                onChange(control.storeAs, runner?.id || null);

                // Populate additional fields if configured
                if (runner && control.populateFields) {
                  Object.entries(control.populateFields).forEach(([templateField, runnerProperty]) => {
                    const value = runner[runnerProperty as keyof typeof runner];
                    if (value !== undefined) {
                      onChange(templateField, value);
                    }
                  });
                }
              }}
              searchBy={control.searchBy}
              placeholder={control.placeholder}
            />
            {control.helpText && (
              <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.25rem' }}>
                {control.helpText}
              </div>
            )}
          </div>
        );

      case 'control-point-selector':
        return (
          <div key={control.storeAs} style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: '500' }}>
              {control.label}
              {control.required && <span style={{ color: '#9e4a4a', marginLeft: '0.25rem' }}>*</span>}
            </label>
            <ControlPointSelector
              competitionId={competitionId}
              className={values.className}
              selectedControlCode={values[control.storeAs]}
              onSelect={(controlCode) => onChange(control.storeAs, controlCode)}
              multiple={control.multiple}
              includeFinish={control.includeFinish}
              compact={true}
            />
            {control.helpText && (
              <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.25rem' }}>
                {control.helpText}
              </div>
            )}
          </div>
        );

      case 'leg-selector':
        return (
          <div key={control.storeAs} style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: '500' }}>
              {control.label}
              {control.required && <span style={{ color: '#9e4a4a', marginLeft: '0.25rem' }}>*</span>}
            </label>
            <select
              className="input"
              value={values[control.storeAs] || ''}
              onChange={(e) => onChange(control.storeAs, e.target.value || null)}
              style={{
                width: '100%',
                fontSize: '0.875rem',
                padding: '0.5rem',
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '4px',
                color: '#fff'
              }}
            >
              <option value="">-- Select Leg --</option>
              {Array.from({ length: control.maxLegs || 6 }, (_, i) => i + 1).map((leg) => (
                <option key={leg} value={leg}>
                  Leg {leg}
                </option>
              ))}
            </select>
            {control.helpText && (
              <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.25rem' }}>
                {control.helpText}
              </div>
            )}
          </div>
        );

      case 'team-search':
        // TODO: Implement TeamSearch component (similar to RunnerSearch)
        return (
          <div key={control.storeAs} style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: '500' }}>
              {control.label}
              {control.required && <span style={{ color: '#9e4a4a', marginLeft: '0.25rem' }}>*</span>}
            </label>
            <input
              type="text"
              className="input"
              value={values[control.storeAs] || ''}
              onChange={(e) => onChange(control.storeAs, e.target.value)}
              placeholder={control.placeholder || 'Search for team...'}
              style={{ width: '100%', fontSize: '0.875rem' }}
            />
            <div style={{ fontSize: '0.7rem', color: '#9e7c4a', marginTop: '0.25rem' }}>
              Team search not yet implemented - using text input
            </div>
            {control.helpText && (
              <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.25rem' }}>
                {control.helpText}
              </div>
            )}
          </div>
        );

      case 'custom':
        return (
          <div key={control.storeAs} style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: '500' }}>
              {control.label}
            </label>
            <div style={{
              padding: '0.75rem',
              background: '#2a2a1a',
              border: '1px solid #9e7c4a',
              borderRadius: '4px',
              color: '#9e7c4a',
              fontSize: '0.75rem'
            }}>
              Custom control "{control.component}" not implemented
            </div>
          </div>
        );

      default:
        return (
          <div key={(control as any).storeAs || 'unknown'} style={{ marginBottom: '0.75rem' }}>
            <div style={{
              padding: '0.75rem',
              background: '#2a1a1a',
              border: '1px solid #9e4a4a',
              borderRadius: '4px',
              color: '#9e4a4a',
              fontSize: '0.75rem'
            }}>
              Unknown control type: {(control as any).type}
            </div>
          </div>
        );
    }
  };

  // Filter field mappings to only show those with showInUI=true
  const overridableFields = fieldMappings?.filter(
    mapping => mapping.showInUI === true && mapping.allowOverride === true
  ) || [];

  if ((!controls || controls.length === 0) && overridableFields.length === 0) {
    return null;
  }

  return (
    <>
      {/* Render UI controls (class selector, runner search, etc.) */}
      {controls.map((control) => renderControl(control))}

      {/* Render overridable fields */}
      {overridableFields.length > 0 && (
        <>
          <div style={{
            marginTop: '1rem',
            marginBottom: '0.5rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid #333',
            fontSize: '0.75rem',
            fontWeight: '600',
            color: '#888',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Field Overrides
          </div>
          {overridableFields.map((mapping) => renderOverridableField(mapping))}
        </>
      )}
    </>
  );
}

