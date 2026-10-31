import { t as tr } from '../i18n';

/**
 * One input for a graphic field from its manifest schema (Live inspector and Settings → Templates).
 * `fallback` is what applies when the field is left empty (the event's template default, else the
 * manifest default); it shows as the placeholder or the checkbox state. `inherited` is what the
 * graphic fills in by itself when there is no fallback (event setup, automatic weather, the class).
 * An empty text field says under it what goes on air, so the operator never guesses.
 */
export function SchemaField({ name, schema, value, onChange, inherited, fallback, idPrefix = 'field' }: {
  name: string;
  schema: any;
  value: any;
  onChange: (v: any) => void;
  inherited?: { value: string; from: string };
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
  const uses = fallback !== undefined && fallback !== '' ? { value: String(fallback), from: 'Settings → Templates' }
    : inherited?.value ? inherited
    : schema.default !== undefined && schema.default !== '' ? { value: String(schema.default), from: 'graphic default' }
    : undefined;
  const placeholder = uses?.value ?? '';
  const empty = value === undefined || value === '';
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
      {empty && uses && (
        <span className="d-uses">{tr("On air:")} <b>{uses.value}</b> · {tr("from")} {tr(uses.from)}</span>
      )}
    </div>
  );
}
