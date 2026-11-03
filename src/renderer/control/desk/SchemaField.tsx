import { useState } from 'react';
import type { PaletteRunner } from './command';
import { t as tr } from '../i18n';

/**
 * One input for a graphic field from its manifest schema (Live inspector and Settings → Templates).
 * `fallback` is what applies when the field is left empty (the event's template default, else the
 * manifest default); it shows as the placeholder or the checkbox state. `inherited` is what the
 * graphic fills in by itself when there is no fallback (event setup, automatic weather, the class).
 * An empty text field says under it what goes on air, so the operator never guesses.
 */
export function SchemaField({ name, schema, value, onChange, inherited, fallback, idPrefix = 'field', controlChoices = [], excludedControl, runnerChoices = [], onRefreshRunners }: {
  name: string;
  schema: any;
  value: any;
  onChange: (v: any) => void;
  inherited?: { value: string; from: string };
  fallback?: any;
  idPrefix?: string;
  controlChoices?: { code: string | number; name: string }[];
  excludedControl?: string;
  runnerChoices?: PaletteRunner[];
  onRefreshRunners?: () => void;
}) {
  const id = `${idPrefix}-${name}`;
  if (!schema) return null;
  const base = fallback ?? schema.default;
  if (schema.v_olgrafik_control === 'runner-multi-select') {
    return <RunnerMultiSelect defaultFavorites={schema.v_olgrafik_default === 'favourites'} id={id} title={schema.title || name} description={schema.description} runners={runnerChoices} onRefresh={onRefreshRunners} value={value ?? base} onChange={onChange} />;
  }
  if (schema.v_olgrafik_control === 'radio-control') {
    return <div className="d-field">
      <label htmlFor={id}>{tr(schema.title || name)}</label>
      <select id={id} className="d-select" value={value ?? base ?? ''} onChange={e => onChange(e.target.value || undefined)}>
        <option value="">{tr('Choose a radio control')}</option>
        {schema.v_olgrafik_includeFinish && <option value="F">{tr('Finish')}</option>}
        {controlChoices.filter(c => Number(c.code) > 0 && Number(c.code) !== 1000).map(c =>
          <option key={c.code} value={String(c.code)} disabled={String(c.code) === excludedControl}>{c.code} · {c.name}</option>)}
      </select>
      {!controlChoices.length && <span className="d-note">{tr('No radio controls found for this class or event')}</span>}
    </div>;
  }
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

/** Schema-driven picker: stores stable name/club pairs, including runners without real bibs. */
function RunnerMultiSelect({ id, title, description, runners, value, onChange, onRefresh, defaultFavorites }: {
  id: string; title: string; description?: string; runners: PaletteRunner[];
  defaultFavorites?: boolean;
  onRefresh?: () => void;
  value: unknown; onChange: (value: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const keyOf = (runner: PaletteRunner) => JSON.stringify([runner.name || '', runner.club || '']);
  const selected = new Set<string>(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string')
    : defaultFavorites ? runners.filter(r => r.favourite).map(keyOf) : []);
  const choices = [...new Map(runners.map(r => [keyOf(r), r])).values()];
  const q = query.trim().toLocaleLowerCase();
  const matches = choices.filter(r => `${r.name} ${r.club} ${r.bib || ''} ${r.virtualBib || ''}`.toLocaleLowerCase().includes(q));
  const selectedLabel = (key: string) => {
    try { const pair = JSON.parse(key); return Array.isArray(pair) ? pair.filter(Boolean).join(' · ') : key; } catch { return key; }
  };
  return (
    <fieldset className="d-field d-runner-picks">
      <legend>{tr(title)}</legend>
      {description && <span className="d-note">{tr(description)}</span>}
      <label htmlFor={`${id}-search`}>{tr('Find runners')}</label>
      <input id={`${id}-search`} type="search" className="d-input" value={query} placeholder={tr('Name, club or bib')}
        onChange={e => setQuery(e.target.value)} />
      <div className="d-runner-picks-list">
        {matches.map(r => {
          const key = keyOf(r);
          return <label key={key} className="d-toggle">
            <input type="checkbox" checked={selected.has(key)} onChange={e => {
              const next = new Set(selected);
              if (e.target.checked) next.add(key); else next.delete(key);
              onChange([...next]);
            }} />
            <span>{r.bib || r.virtualBib ? `${r.bib || r.virtualBib} · ` : ''}{r.name}<small className="d-note"> · {r.club}</small></span>
          </label>;
        })}
        {!matches.length && <span className="d-note">{tr(runners.length ? 'No runner matches' : 'Load the start list to pick runners')}</span>}
      </div>
      {!runners.length && onRefresh && <button type="button" className="d-btn sm" onClick={onRefresh}>{tr("Load runners from timing")}</button>}
      <span className="d-note" role="status">{selected.size} {tr('selected · presented in start-list order')}</span>
      {[...selected].filter(key => !choices.some(r => keyOf(r) === key)).map(key => (
        <button key={key} type="button" className="d-btn sm" onClick={() => onChange([...selected].filter(k => k !== key))}>
          {selectedLabel(key)} · {tr('unavailable · remove')}
        </button>
      ))}
      {selected.size > 0 && <button type="button" className="d-btn sm" onClick={() => onChange([])}>{tr('Clear selection')}</button>}
    </fieldset>
  );
}
