import { t as tr } from '../i18n';

/**
 * One input for a graphic field from its manifest schema (Live inspector and Settings → Templates).
 * `fallback` is what applies when the field is left empty (the event's template default, else the
 * manifest default); it shows as the placeholder or the checkbox state.
 */
export function SchemaField({ name, schema, value, onChange, auto, fallback, idPrefix = 'field' }: {
  name: string;
  schema: any;
  value: any;
  onChange: (v: any) => void;
  auto?: string;
  fallback?: any;
  idPrefix?: string;
}) {
  const id = `${idPrefix}-${name}`;
  if (!schema) return null;
  const base = fallback ?? schema.default;
  if (schema.type === 'boolean') {
    const on = value ?? base ?? false;
    return (
      <label className="d-toggle" htmlFor={id}>
        <input id={id} type="checkbox" checked={!!on} onChange={e => onChange(e.target.checked)} />
        {tr(schema.title || name)}
      </label>
    );
  }
  const label = <label htmlFor={id}>{tr(schema.title || name)}{schema.description ? ` · ${tr(schema.description)}` : ''}</label>;
  if (Array.isArray(schema.enum)) {
    const names: string[] = Array.isArray(schema.enumNames) ? schema.enumNames : schema.enum;
    return (
      <div className="d-field">
        {label}
        <select id={id} className="d-select" value={value ?? base ?? ''} onChange={e => onChange(e.target.value === '' && fallback === undefined ? undefined : e.target.value)}>
          {schema.enum.map((o: string, i: number) => <option key={o} value={o}>{tr(names[i] ?? o)}</option>)}
        </select>
      </div>
    );
  }
  const placeholder = auto ? `Automatic: ${auto}` : base !== undefined && base !== '' ? String(base) : '';
  return (
    <div className="d-field">
      {label}
      {schema.multiline ? (
        <textarea id={id} className="d-input d-textarea" rows={3} value={value ?? ''} placeholder={placeholder}
          onChange={e => onChange(e.target.value)} />
      ) : (
        <input
          id={id}
          className="d-input"
          type={schema.type === 'number' ? 'number' : 'text'}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={e => onChange(schema.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)}
        />
      )}
    </div>
  );
}
