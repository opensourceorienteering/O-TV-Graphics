import { t as tr } from "../i18n";
/**
 * Live desk: the operator screen for producing graphics during a broadcast.
 *
 * Left: graphics (numbered for the command palette). Middle: the draft for the selected graphic,
 * its fields and favourites. Right: Program (on air) and Preview (the draft), with explicit
 * Show / Update / Hide / Hide all. Editing never changes the output; only those actions do.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { call } from '../events/api';
import { CommandPalette } from './CommandPalette';
import { MonitorHead, PreviewVideo, ProgramVideo } from './DeskMonitor';
import { type PaletteControl, type PaletteData, type PaletteRunner } from './command';
import { DESK_SHORTCUTS, DESK_TEMPLATES, sameDraft, type DeskCommandMap, type DeskDraft, type DeskFavorite, type DeskState } from '../../../shared/desk';
import type { EventStartList, StartListEntry } from '../../../shared/types/event';
import './desk.css';
import { SchemaField } from './SchemaField';

type DeskTemplateInfo = (typeof DESK_TEMPLATES)[number] & {
  templateId: string | null; available: boolean; schema: Record<string, any>; requiredFields: string[]; multiStep: boolean;
  /** Settings → Templates */
  hidden?: boolean; liveUpdatesDefault?: boolean; fieldDefaults?: Record<string, any>;
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"]');

/** "in 1:05" / "now" for a start that is ms away */
function startsIn(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 2) return 'now';
  return `in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function emptyDraft(key: string): DeskDraft {
  return { key, values: {}, fields: {} };
}

function favLabel(draft: DeskDraft, def?: DeskTemplateInfo): string {
  const v = draft.values;
  const parts = [v.runnerName, v.className, v.controlCode ? `control ${v.controlCode}` : undefined,
    draft.fields.text, draft.fields.commentators, draft.fields.title].filter(Boolean);
  return parts.slice(0, 2).join(' · ') || def?.label || 'Favourite';
}

/** Runner field: type a name or bib, pick from matches (filtered by class when one is chosen) */
function RunnerSearch({ runners, value, onPick, onClear, id }: {
  runners: PaletteRunner[]; value: DeskDraft['values']; onPick: (r: PaletteRunner) => void; onClear: () => void; id: string;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = value.runnerName ? `${value.runnerBib ? value.runnerBib + ' · ' : ''}${value.runnerName}` : '';
  const q = text.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return runners.slice(0, 8);
    const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return runners
      .map(r => {
        const bib = (r.bib || r.virtualBib || '').toLowerCase();
        const n = fold(r.name);
        const f = fold(q);
        const score = bib === f ? 0 : bib.startsWith(f) ? 1 : n.startsWith(f) ? 2 : n.includes(f) ? 3 : -1;
        return { r, score };
      })
      .filter(x => x.score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 8)
      .map(x => x.r);
  }, [runners, q]);
  const pick = (r?: PaletteRunner) => {
    if (!r) return;
    onPick(r);
    setText('');
    setOpen(false);
  };
  return (
    <div className="combo">
      <input
        id={id}
        className="d-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        placeholder={shown || 'Type a name or bib'}
        value={open ? text : shown}
        onFocus={() => { setOpen(true); setText(''); setActive(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={e => { setText(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(matches.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
          else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            // Enter picks the highlighted runner (if any) and leaves the field, like every desk field
            e.preventDefault();
            if (open && matches.length) pick(matches[active]);
            e.currentTarget.blur();
          }
          else if (e.key === 'Backspace' && !text && value.runnerName) onClear();
        }}
      />
      {open && (
        <ul className="combo-list" id={`${id}-list`} role="listbox">
          {matches.length ? matches.map((r, i) => (
            <li key={`${r.className}|${r.name}|${r.club}`} role="option" aria-selected={i === active} onMouseDown={e => { e.preventDefault(); pick(r); }}>
              <span className="bib">{r.bib || r.virtualBib || '—'}</span>
              <span className="who"><span>{r.name}</span><small>{[r.className, r.club].filter(Boolean).join(' · ')}</small></span>
            </li>
          )) : <li aria-disabled="true"><span className="who"><small>{runners.length ? tr("No runner matches") : tr("No start list loaded")}</small></span></li>}
        </ul>
      )}
    </div>
  );
}

/** A manual field from the graphic's manifest schema */
/**
 * Fields to edit for the graphic the event's look actually uses: the desk's usual fields that
 * this graphic has, plus any field it requires (older graphics such as Classic's countdown
 * timer name their fields differently). Fields the timing data fills are never listed.
 */
function deskFields(def: DeskTemplateInfo): string[] {
  const schema = def.schema || {};
  const usual = (def.fields || []).filter(f => schema[f]);
  const required = (def.requiredFields || []).filter(f => schema[f] && !usual.includes(f) && !DATA_FIELDS.has(f));
  const list = [...usual, ...required];
  if (list.length || def.params.length) return list;
  // Nothing matched: offer the graphic's own fields
  return Object.keys(schema).filter(f => !DATA_FIELDS.has(f));
}
const DATA_FIELDS = new Set(['className', 'results', 'runnerName', 'runnerClub', 'runnerBib', 'controlCode', 'splitControls', 'startList']);

export function LiveDesk() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<any>(null);
  const [templates, setTemplates] = useState<DeskTemplateInfo[]>([]);
  const [commands, setCommands] = useState<DeskCommandMap>({});
  const [classes, setClasses] = useState<string[]>([]);
  const [runners, setRunners] = useState<PaletteRunner[]>([]);
  const [controls, setControls] = useState<Record<string, PaletteControl[]>>({});
  const [favorites, setFavorites] = useState<Record<string, DeskFavorite[]>>({});
  const [selected, setSelected] = useState('runner-identity');
  const [drafts, setDrafts] = useState<Record<string, DeskDraft>>({});
  const [desk, setDesk] = useState<DeskState>({ eventId: null, onAir: [], otherOnAir: 0 });
  const [output, setOutput] = useState<{ web?: boolean; ndi?: boolean }>({});
  const [previewError, setPreviewError] = useState('');
  const [preparedAt, setPreparedAt] = useState<number | null>(null);
  const [palette, setPalette] = useState(false);
  const [dialog, setDialog] = useState<'' | 'keys' | 'commands'>('');
  const [toast, setToast] = useState<{ text: string; kind?: 'err' | 'air' } | null>(null);
  const [monitors, setMonitors] = useState<string[]>([]);
  const [polling, setPolling] = useState<import('../../../shared/types/event').ControlState['polling']>([]);
  const [dataCheck, setDataCheck] = useState<{ ok: boolean; at: number; message?: string } | null>(null);
  const [weather, setWeather] = useState<{ reading: any; source: string; error?: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Version of the last draft a control surface (Companion, web API) put in Preview */
  const remoteSeen = useRef<number | null>(null);
  /** Runner start follows the next starter from the start list until the operator picks a runner */
  const [followNext, setFollowNext] = useState(true);
  /** Class the next starter is taken from ('' = all classes) */
  const [nextClass, setNextClass] = useState('');

  const applyStartList = (entries: StartListEntry[]) => {
    const loadedRunners: PaletteRunner[] = entries.map(e => ({
      name: e.name,
      club: e.club,
      className: e.className,
      bib: e.bib,
      virtualBib: e.virtualBib,
      startTimeMs: e.startTimeMs
    }));
    setRunners(loadedRunners);
  };

  const say = useCallback((text: string, kind?: 'err' | 'air') => {
    setToast({ text, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), kind === 'err' ? 5000 : 2200);
  }, []);

  // --- load ---
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ev, list, map, favs, sl] = await Promise.all([
          call('event:get', eventId), call<DeskTemplateInfo[]>('desk:templates', eventId), call<DeskCommandMap>('desk:commands'),
          call('desk:favorites', eventId), call<EventStartList>('startlist:get', eventId)
        ]);
        if (!alive) return;
        setEvent(ev.event);
        setTemplates(list);
        setCommands(map);
        setFavorites(favs);
        applyStartList(sl.entries || []);
        const first = list.find(t => t.available);
        if (first && !list.find(t => t.key === selected && t.available)) setSelected(first.key);
        await call('live:enter', eventId);
        call<string[]>('event:classes', eventId).then(c => alive && setClasses(c)).catch(() => undefined);
      } catch (e) {
        say((e as Error).message, 'err');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // --- poll on-air state, outputs, monitors ---
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [d, l, m, p] = await Promise.all([
          call<DeskState>('desk:state', eventId), call('live:state'), call<string[]>('window:monitors'),
          call<{ version: number; origin: 'desk' | 'remote'; draft: DeskDraft | null }>('live:prepared')
        ]);
        if (!alive) return;
        setDesk(d);
        setOutput(l?.output || {});
        setDataCheck(l?.data ?? null);
        setPolling(l?.polling || []);
        setMonitors(m);
        // A Stream Deck button prepared a favourite or runner: show it here as the draft
        if (p.origin === 'remote' && p.draft && remoteSeen.current !== null && p.version > remoteSeen.current) {
          const remote = p.draft;
          if (remote.key === 'runner-start' && remote.values?.runnerName) setFollowNext(false);
          setSelected(remote.key);
          setDrafts(all => ({ ...all, [remote.key]: remote }));
          say('Draft prepared from a control surface');
        }
        if (p.origin === 'remote' || remoteSeen.current === null) remoteSeen.current = p.version;
      } catch { /* keep last state */ }
      if (alive) setNow(Date.now());
    };
    void tick();
    const t = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [eventId, say]);

  const def = templates.find(t => t.key === selected);

  // --- weather: the graphic fills itself; show the operator what it will say ---
  const weatherDraft = drafts.weather;
  const loadWeather = useCallback(async (force = false) => {
    try {
      setWeather(await call('desk:weather', eventId, force));
      // A fresh reading: prepare Preview again so it shows the new values
      if (force) await call('preview:draft', eventId, weatherDraft ?? emptyDraft('weather')).catch(() => undefined);
    } catch (e) { setWeather({ reading: null, source: 'none', error: (e as Error).message }); }
  }, [eventId, weatherDraft]);
  useEffect(() => {
    if (selected !== 'weather') return;
    void loadWeather();
    const t = setInterval(() => void loadWeather(), 60_000);
    return () => clearInterval(t);
  }, [selected, loadWeather]);
  const weatherAuto: Record<string, string> = weather?.reading ? {
    condition: weather.reading.condition,
    temperature: String(weather.reading.temperature),
    wind: String(weather.reading.windSpeed),
    humidity: String(weather.reading.humidity)
  } : {};
  const draft = drafts[selected] ?? emptyDraft(selected);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const setDraft = (next: DeskDraft) => setDrafts(d => ({ ...d, [next.key]: next }));
  const onAirSel = desk.onAir.find(o => o.key === selected);
  const changed = !!onAirSel && !sameDraft(onAirSel.draft, draft);
  // Held live data on air with newer results waiting: Update brings the graphic up to date
  const freshData = !!onAirSel?.newData;
  const numberOf = (key: string) => Object.entries(commands).find(([, k]) => k === key)?.[0];

  const loadControls = useCallback((cls: string) => {
    if (!cls || controls[cls]) return;
    call<PaletteControl[]>('event:controls', eventId, cls)
      .then(list => setControls(c => ({ ...c, [cls]: list })))
      .catch(() => setControls(c => ({ ...c, [cls]: [] })));
  }, [controls, eventId]);

  useEffect(() => {
    if (def?.params.includes('control') && draft.values.className) loadControls(draft.values.className);
  }, [def, draft.values.className, loadControls]);

  // --- preview: every draft change prepares Preview (never the output) ---
  const prepare = useCallback(async (d: DeskDraft) => {
    try {
      await call('preview:draft', eventId, d);
      setPreviewError('');
      setPreparedAt(Date.now());
    } catch (e) {
      setPreviewError((e as Error).message);
      await call('preview:clear').catch(() => undefined);
    }
  }, [eventId]);
  useEffect(() => {
    if (!def?.available) return;
    const t = setTimeout(() => void prepare(draft), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(draft), def?.available]);

  // --- actions ---
  const act = useCallback(async (fn: () => Promise<DeskState>, success: string, kind?: 'air') => {
    try {
      setDesk(await fn());
      say(success, kind);
    } catch (e) {
      say((e as Error).message, 'err');
    }
  }, [say]);

  const show = () => {
    if (!def?.available) return say('This graphic is not in the event’s look', 'err');
    if (onAirSel) return act(() => call('desk:hide', eventId, selected), `${def.label} hidden`);
    if (previewError) return say(previewError, 'err');
    return act(() => call('desk:show', eventId, draft), `${def.label} on air`, 'air');
  };
  const update = () => onAirSel && (changed || freshData)
    ? act(() => call('desk:update', eventId, draft), `${def?.label} updated on air`, 'air')
    : say(onAirSel ? 'No changes to apply' : 'Not on air; use Show', 'err');
  const hideActive = () => act(() => call('desk:hide', eventId, onAirSel ? selected : undefined), 'Hidden');
  const hideAll = () => act(() => call('desk:hideAll', eventId), 'All graphics hidden');
  const page = (delta: 1 | -1) => act(() => call('desk:page', eventId, delta), delta > 0 ? 'Next page' : 'Previous page');
  const addFavorite = async () => {
    try {
      setFavorites(await call('desk:saveFavorite', eventId, favLabel(draft, def), draft));
      say('Saved to favourites');
    } catch (e) { say((e as Error).message, 'err'); }
  };
  /** Director start alerts in the browser; the LAN address works on phones and tablets */
  const openDirector = async () => {
    try {
      const ds = event?.dataSource;
      const urls = await call<{ local: string; lan: string }>('director:getUrl', ds?.sourceId, ds?.competitionId);
      await call('window:openExternal', urls.local).catch(() => undefined);
      say(`Director page opened · on other devices: ${urls.lan}`);
    } catch (e) { say((e as Error).message, 'err'); }
  };
  const openMonitor = async (kind: 'preview' | 'program' | 'both') => {
    try {
      await call('window:openMonitor', kind);
      say(`${kind === 'both' ? 'Preview and Program' : kind === 'preview' ? 'Preview' : 'Program'} opened in a separate window`);
    } catch (e) {
      say((e as Error).message, 'err');
    }
  };
  /** Leave Live: control surfaces stop acting on this event; graphics on air can be hidden first */
  const endLive = async () => {
    if (desk.onAir.length && !confirm(`${desk.onAir.length} graphic${desk.onAir.length === 1 ? ' is' : 's are'} on air. Hide everything and end Live?`)) return;
    try {
      if (desk.onAir.length) await call('desk:hideAll', eventId);
      await call('live:exit');
      navigate(`/events/${eventId}/plan`);
    } catch (e) { say((e as Error).message, 'err'); }
  };
  const removeFavorite = async (id: string) => {
    try { setFavorites(await call('desk:deleteFavorite', eventId, selected, id)); } catch (e) { say((e as Error).message, 'err'); }
  };
  const recall = (f: DeskFavorite) => {
    if (selected === 'runner-start' && f.draft.values?.runnerName) setFollowNext(false);
    setDraft({ ...f.draft, key: selected });
    say(`Prepared: ${f.label} · Space to Show`);
  };

  // --- keyboard ---
  const graphicFor = (n: string) => {
    const key = commands[n];
    return templates.find(t => t.key === key && t.available)?.key;
  };
  const actions = useRef({ show, update, hideActive, hideAll, page, addFavorite, graphicFor });
  actions.current = { show, update, hideActive, hideAll, page, addFavorite, graphicFor };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      // The palette opens from anywhere, also while typing in a field
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return; }
      if (palette || dialog) return;
      if (e.key === 'Escape') {
        if (isTyping(e.target)) { (e.target as HTMLElement).blur(); return; }
        e.preventDefault(); void actions.current.hideAll(); return;
      }
      // Everything else is a single key, and never fires while typing
      if (isTyping(e.target) || e.repeat || mod || e.altKey) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === ' ' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); void actions.current.show(); return; }
      if (key === 'u') { e.preventDefault(); void actions.current.update(); return; }
      if (key === 'h') { e.preventDefault(); void actions.current.hideActive(); return; }
      if (key === 'f') { e.preventDefault(); void actions.current.addFavorite(); return; }
      if (key === 'ArrowRight') { e.preventDefault(); void actions.current.page(1); return; }
      if (key === 'ArrowLeft') { e.preventDefault(); void actions.current.page(-1); return; }
      if (/^\d$/.test(key)) {
        const target = actions.current.graphicFor(key);
        if (target) { e.preventDefault(); setSelected(target); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [palette, dialog]);

  const navKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const avail = templates.filter(t => t.available && !t.hidden);
    const i = avail.findIndex(t => t.key === selected);
    const next = avail[Math.max(0, Math.min(avail.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      setSelected(next.key);
      document.getElementById(`tpl-${next.key}`)?.focus();
    }
  };

  // --- palette data ---
  const paletteData: PaletteData = useMemo(() => ({
    commands,
    available: new Set(templates.filter(t => t.available).map(t => t.key)),
    hidden: new Set(templates.filter(t => t.hidden).map(t => t.key)),
    classes,
    runners,
    controls: (cls: string) => controls[cls]
  }), [commands, templates, classes, runners, controls]);

  const tz = event?.info?.timeZone;
  const clock = (() => { try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', ...(tz ? { timeZone: tz } : {}) }).format(now); } catch { return new Date(now).toTimeString().slice(0, 8); } })();
  // Re-tested in the background while Live; polled with the rest of the state
  const lastCheck = dataCheck ?? event?.dataSource?.lastCheck;
  // While Runner start follows the start list, search uses the follow filter, not the auto-picked class
  const searchClass = selected === 'runner-start' && followNext ? nextClass : draft.values.className;
  const classRunners = searchClass ? runners.filter(r => r.className === searchClass) : runners;

  // --- runner start: keep the draft on the next starter (manual pick overrides) ---
  const upcoming = useMemo(
    () => runners
      .filter(r => typeof r.startTimeMs === 'number' && r.startTimeMs >= now && (!nextClass || r.className === nextClass))
      .sort((a, b) => a.startTimeMs! - b.startTimeMs!),
    [runners, now, nextClass]
  );
  const nextUp = upcoming[0];
  const following = selected === 'runner-start' && followNext;
  useEffect(() => {
    if (!followNext) return;
    setDrafts(all => {
      const cur = all['runner-start'] ?? emptyDraft('runner-start');
      const bib = nextUp ? nextUp.bib || nextUp.virtualBib : undefined;
      if (cur.values.runnerName === nextUp?.name && cur.values.runnerBib === bib && cur.values.className === nextUp?.className) return all;
      return {
        ...all,
        'runner-start': {
          ...cur,
          values: nextUp
            ? { className: nextUp.className, runnerName: nextUp.name, runnerClub: nextUp.club, runnerBib: bib }
            : { className: nextClass || undefined }
        }
      };
    });
  }, [followNext, nextUp, nextClass]);
  const programOnAir = desk.onAir[0];
  // Paging acts on the most recent paged graphic on air (results, start list …)
  const pagedOnAir = desk.onAir.find(o => templates.find(t => t.key === o.key)?.multiStep);
  const detached = monitors.includes('both');
  const programAway = detached || monitors.includes('program');
  const previewAway = detached || monitors.includes('preview');
  const eventPageDuration = Math.max(0, Number(event?.settings?.presentation?.autoPageDurationSeconds) || 0);

  const status = onAirSel
    ? changed ? `${tr(def?.label || '')} · ${tr('on air')} · ${tr('changes not applied')}`
      : freshData ? `${tr(def?.label || '')} · ${tr('on air')} · ${tr('new results waiting · U updates')}`
      : `${tr(def?.label || '')} · ${tr('on air')}${onAirSel.held ? ` · ${tr('live updates held')}` : ''}`
    : previewError ? previewError : def?.available ? 'Ready to show' : 'This graphic is not in the event’s look';

  const set = (values: Partial<DeskDraft['values']>) => setDraft({ ...draft, values: { ...draft.values, ...values } });

  return (
    <div className="desk">
      <header className="desk-header">
        <Link className="desk-brand" to="/" aria-label={tr("All events")}><BrandMark /></Link>
        <div className="desk-event"><b>{event?.name || 'Event'}</b><span>{[event?.info?.location, event?.info?.date].filter(Boolean).map(x => ` / ${x}`).join('')}</span></div>
        <span className="desk-res">1920×1080</span>
        <details className="monitor-menu">
          <summary className="d-btn">{tr("Separate window")} <span aria-hidden="true">▾</span></summary>
          <div className="monitor-menu-popover" role="menu" aria-label={tr("Choose monitor window")}>
            {(['preview', 'program', 'both'] as const).map(kind => {
              const active = monitors.includes(kind);
              const label = kind === 'both' ? 'Preview and Program' : kind === 'preview' ? 'Preview' : 'Program';
              return (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  onClick={e => {
                    e.currentTarget.closest('details')?.removeAttribute('open');
                    void openMonitor(kind);
                  }}
                >
                  <span>{tr(label)}</span><span className="monitor-menu-state">{active ? tr("Open") : '↗'}</span>
                </button>
              );
            })}
          </div>
        </details>
        <button type="button" className="d-btn" onClick={() => setPalette(true)}>{tr("Command palette")} <kbd>Ctrl+K</kbd></button>
        <button type="button" className="d-btn danger" onClick={hideAll}>{tr("Force hide all")} <kbd>Esc</kbd></button>
      </header>

      <div className="desk-context">
        <h1>{tr("Live desk")}</h1>
        <span className="div" />
        <span className={`status ${onAirSel ? 'air' : ''}`} role="status">{tr(status)}</span>
        <Link to={`/events/${eventId}/plan`}>{tr("Settings")}</Link>
        <button type="button" className="ctx-link" onClick={() => void openDirector()} title={tr("Start alerts for the director, on any device on the network")}>{tr("Director page")}</button>
        <button type="button" className="ctx-link" onClick={() => void endLive()}>{tr("End Live")}</button>
        <span className="clock">{clock}</span>
      </div>

      <div className="desk-work">
        <nav className="desk-nav" aria-label={tr("Graphics")}>
          <span className="desk-label">{tr("Templates")}</span>
          <ul role="listbox" aria-label={tr("Graphics")} onKeyDown={navKey}>
            {templates.filter(t => !t.hidden || desk.onAir.some(o => o.key === t.key)).map(t => {
              const n = numberOf(t.key);
              const air = desk.onAir.some(o => o.key === t.key);
              return (
                <li key={t.key}>
                  <button
                    id={`tpl-${t.key}`}
                    type="button"
                    role="option"
                    aria-selected={t.key === selected}
                    tabIndex={t.key === selected ? 0 : -1}
                    disabled={!t.available}
                    title={t.available ? undefined : tr("Not in this event’s look")}
                    onClick={() => setSelected(t.key)}
                  >
                    <span className="num">{n ?? ''}</span>{tr(t.label)}{air && <span className="onair-dot" aria-label={tr("on air")}>●</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="navfoot">
            <span>{event?.templateSet?.toUpperCase()}  {tr("graphics · selecting never changes Program")}</span>
            <button type="button" onClick={() => setDialog('commands')}>{tr("Command numbers ↗")}</button>
          </div>
        </nav>

        <section
          className="desk-inspector"
          aria-label={tr("Prepare")}
          onKeyDown={e => {
            // Enter in a field: leave it and prepare Preview now (Tab keeps moving between fields)
            if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            const el = e.target as HTMLElement;
            const field = el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(el.type));
            if (!field) return;
            if (!e.defaultPrevented) e.preventDefault();
            el.blur();
            // Let the last keystroke's state update land, then prepare with the newest draft
            setTimeout(() => { if (def?.available) void prepare(latestDraft.current); }, 0);
          }}
        >
          {def && (
            <>
              <div className="insp-head">
                <div>
                  <div className="eyebrow">{tr("Prepare /")} {def.kind} · ID {numberOf(def.key) ?? '–'}</div>
                  <h2>{tr(def.label)}</h2>
                </div>
                <div className={`state ${onAirSel ? 'air' : ''}`}>
                  {onAirSel ? (changed ? tr("On air · draft changed · Update applies") : tr("On air · Space: Hide")) : previewError ? tr("Draft incomplete") : tr("Draft ready · Space: Show")}
                </div>
              </div>
              <div className="d-sep" />

              {def.params.includes('class') && (
                <div className="d-field">
                  <label htmlFor="d-class">{tr("Class")}{def.required.includes('class') ? '' : ' · optional filter'}</label>
                  <select id="d-class" className="d-select" value={following ? nextClass : draft.values.className ?? ''} onChange={e => following ? setNextClass(e.target.value) : set({ className: e.target.value || undefined, controlCode: undefined })}>
                    <option value="">{def.required.includes('class') ? tr("Choose a class") : tr("All classes")}</option>
                    {classes.map((c, i) => <option key={c} value={c}>{c} · ID {i + 1}</option>)}
                  </select>
                </div>
              )}
              {def.params.includes('control') && (
                <div className="d-field">
                  <span className="lbl">{tr("Timing point")}</span>
                  <div className="d-row2">
                    <div className="d-segment" role="group" aria-label={tr("Timing point")}>
                      {selected === 'runner-start' && <button type="button" aria-pressed={!draft.values.controlCode} onClick={() => set({ controlCode: undefined })}>{tr("Start")}</button>}
                      {selected === 'runner-start'
                        ? <button type="button" aria-pressed={draft.values.controlCode === 'F'} onClick={() => set({ controlCode: 'F' })}>{tr("Finish")}</button>
                        : <button type="button" aria-pressed={!draft.values.controlCode} onClick={() => set({ controlCode: undefined })}>{tr("Finish")}</button>}
                      <button type="button" aria-pressed={!!draft.values.controlCode && draft.values.controlCode !== 'F'} onClick={() => set({ controlCode: String(controls[draft.values.className ?? '']?.[0]?.code ?? '') || undefined })} disabled={!controls[draft.values.className ?? '']?.length}>{tr("Control")}</button>
                    </div>
                    <select aria-label={tr("Control")} className="d-select" value={draft.values.controlCode === 'F' ? '' : draft.values.controlCode ?? ''} disabled={!draft.values.controlCode || draft.values.controlCode === 'F'} onChange={e => set({ controlCode: e.target.value || undefined })}>
                      <option value="">{tr("Finish")}</option>
                      {(controls[draft.values.className ?? ''] || []).map(c => <option key={c.code} value={String(c.code)}>{c.code} · {c.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {def.params.includes('runner') && (
                <div className="d-field">
                  <label htmlFor="d-runner">{tr("Runner · type name or bib")}{def.required.includes('runner') ? '' : ' · optional highlight'}</label>
                  <RunnerSearch
                    id="d-runner"
                    runners={classRunners}
                    value={draft.values}
                    onPick={r => { if (selected === 'runner-start') setFollowNext(false); set({ runnerName: r.name, runnerClub: r.club, runnerBib: r.bib || r.virtualBib, className: searchClass || r.className }); }}
                    onClear={() => { if (selected === 'runner-start') setFollowNext(false); set({ runnerName: undefined, runnerClub: undefined, runnerBib: undefined }); }}
                  />
                  {draft.values.runnerName && <span className="d-note">{[draft.values.runnerClub, draft.values.className].filter(Boolean).join(' / ')}</span>}
                  {selected === 'runner-start' && (
                    <div className={`d-next ${followNext ? 'on' : ''}`} role="status">
                      {followNext ? (
                        nextUp ? (
                          <span>
                            <b>{tr("Next starter")}</b> · {new Date(nextUp.startTimeMs!).toLocaleTimeString()} · {startsIn(nextUp.startTimeMs! - now)}
                            {upcoming.length > 1 && <small> · {tr("then")} {upcoming.slice(1, 3).map(r => `${r.name} ${new Date(r.startTimeMs!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`).join(', ')}</small>}
                          </span>
                        ) : <span>{runners.some(r => r.startTimeMs) ? tr("No more starters") + (nextClass ? ` in ${nextClass}` : '') : tr("The start list has no start times")}</span>
                      ) : <span>{tr("Manual pick · the draft stays on this runner")}</span>}
                      {followNext
                        ? <small className="d-note">{tr("Follows the start list automatically. Pick a runner to override.")}</small>
                        : <button type="button" className="d-btn sm" onClick={() => setFollowNext(true)}>{tr("Follow next starter")}</button>}
                    </div>
                  )}
                  {!runners.length && (
                    <span className="d-note warn">
                       {tr("No start list yet.")} <button type="button" className="d-btn sm" onClick={async () => {
                        try { const sl = await call<EventStartList>('startlist:refresh', eventId); applyStartList(sl.entries); say(`${sl.entries.length} runners loaded`); }
                        catch (e) { say((e as Error).message, 'err'); }
                      }}>{tr("Load runners from timing")}</button>
                    </span>
                  )}
                </div>
              )}
              {def.params.includes('page') && (
                <div className="d-field">
                  <label htmlFor="d-page">{tr("First page")}</label>
                  <input id="d-page" className="d-input" type="number" min={1} value={draft.page ?? 1} onChange={e => setDraft({ ...draft, page: Math.max(1, Number(e.target.value) || 1) })} />
                </div>
              )}
              {def.live && (
                <div className="d-field">
                  <label className="d-toggle" htmlFor="d-live-updates">
                    <input id="d-live-updates" type="checkbox" checked={draft.liveUpdates ?? def.liveUpdatesDefault ?? true}
                      onChange={e => { const next = { ...draft }; if (e.target.checked === (def.liveUpdatesDefault ?? true)) delete next.liveUpdates; else next.liveUpdates = e.target.checked; setDraft(next); }} />
                    {tr("Live updates on air")}
                  </label>
                  <span className={`d-note${onAirSel?.newData ? ' warn' : ''}`}>
                    {(draft.liveUpdates ?? def.liveUpdatesDefault ?? true) === false
                      ? onAirSel?.newData ? tr("Held · new results are waiting · U updates the graphic") : tr("Held · the graphic keeps the results it went on air with until you press Update (U)")
                      : tr("New times, places and runners appear on air as they come in")}
                  </span>
                </div>
              )}
              {def.multiStep && (
                <div className="d-field">
                  <label htmlFor="d-page-timing">{tr("Automatic pagination")}</label>
                  <div className="d-row2">
                    <input id="d-page-timing" className="d-input" type="number" min={0} step={1}
                      aria-label={tr("Seconds per page")}
                      value={draft.autoPageDurationSeconds ?? eventPageDuration}
                      onChange={e => setDraft({ ...draft, autoPageDurationSeconds: Math.max(0, Number(e.target.value) || 0) })} />
                    <button type="button" className="d-btn sm" title={tr("Reset to event default")} aria-label={tr("Reset to event default")}
                      disabled={draft.autoPageDurationSeconds === undefined}
                      onClick={() => { const inherited = { ...draft }; delete inherited.autoPageDurationSeconds; setDraft(inherited); }}>↺</button>
                  </div>
                  <span className="d-note">{tr("Seconds per page · 0 = manual. Reset follows the event default. The final page uses the same hold, then animates off air.")}</span>
                </div>
              )}
              {selected === 'weather' && (
                <div className="d-auto" role="status">
                  {weather?.reading ? (
                    <span>
                      <b>{tr("Automatic weather")}</b> · {weather.reading.condition} · {weather.reading.temperature}  {tr("°C · wind")} {weather.reading.windSpeed} km/h · {weather.reading.humidity} %
                      <small> · {weather.source === 'saved' ? 'last saved reading (service unreachable)' : `updated ${new Date(weather.reading.fetchedAt).toLocaleTimeString()}`}  {tr("· refreshes every 5 min while on air. Type in a field to override it.")}</small>
                    </span>
                  ) : (
                    <span className="bad">{weather ? `No automatic weather: ${weather.error}` : tr("Checking the weather…")}</span>
                  )}
                  <button type="button" className="d-btn" onClick={() => void loadWeather(true)}>{tr("Check now")}</button>
                </div>
              )}
              {deskFields(def).map(f => (
                <SchemaField key={f} name={f} schema={def.schema[f]} value={draft.fields[f]} fallback={def.fieldDefaults?.[f]} auto={selected === 'weather' ? weatherAuto[f] : undefined} onChange={v => setDraft({ ...draft, fields: { ...draft.fields, [f]: v } })} />
              ))}

              <div className={`d-note ${previewError ? 'err' : preparedAt ? 'ok' : ''}`} role="status">
                {previewError ? `✕ ${tr(previewError)}` : preparedAt ? `✓ Preview prepared ${new Date(preparedAt).toLocaleTimeString('en-GB')}` : ' '}
              </div>

              <div className="d-actions">
                <button type="button" className="d-btn" onClick={() => { void prepare(draft); }}>{tr("Refresh preview")}</button>
                <button type="button" className="d-btn" onClick={addFavorite}>{tr("Add to favourites")} <kbd>F</kbd></button>
              </div>
              <div className="d-sep" />
              <div className="favs">
                <div className="favs-head"><span className="desk-label">{tr("Favourites ·")} {tr(def.label)}</span></div>
                {(favorites[selected] || []).length ? (favorites[selected] || []).map(f => (
                  <div key={f.id} className="fav" role="button" tabIndex={0}
                    onClick={() => recall(f)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); recall(f); } }}>
                    <span className="star">☆</span><span className="name">{f.label}</span><span className="hint">{tr("Prepare only")}</span>
                    <button type="button" className="del" aria-label={`Delete favourite ${f.label}`} onClick={e => { e.stopPropagation(); void removeFavorite(f.id); }}>×</button>
                  </div>
                )) : <span className="d-note">{tr("Save the current fields to recall them later. Recalling only prepares; Show sends it.")}</span>}
              </div>
            </>
          )}
        </section>

        <section className="desk-view" aria-label={tr("Output")}>
          <div className="mon program">
            <MonitorHead title={programOnAir ? `PROGRAM · ${programOnAir.name}` : 'PROGRAM'} onAir={!!programOnAir || desk.otherOnAir > 0} since={programOnAir?.since} />
            {programAway ? (
              <div className="mon-away">
                <h3>{tr("Program in separate window")}</h3>
                <div className="row">
                  <button type="button" className="d-btn sm" onClick={() => call('window:openMonitor', detached ? 'both' : 'program')}>{tr("Focus window ↗")}</button>
                  <button type="button" className="d-btn sm" onClick={() => call('window:closeMonitor', detached ? 'both' : 'program')}>{tr("Re-dock")}</button>
                </div>
              </div>
            ) : <ProgramVideo />}
            <div className="mon-pager">
              <button type="button" className="d-btn sm" onClick={() => page(-1)} disabled={!pagedOnAir || (pagedOnAir.step ?? 1) <= 1}>{tr("Previous")} <kbd>←</kbd></button>
              <span className="pos">{pagedOnAir ? `${pagedOnAir.name} · page ${pagedOnAir.step ?? 1}` : programOnAir ? tr("Single page") : '—'}<small>{tr("PROGRAM PAGES")}</small></span>
              <button type="button" className="d-btn sm" onClick={() => page(1)} disabled={!pagedOnAir}>{tr("Next")} <kbd>→</kbd></button>
            </div>
          </div>

          <div className="desk-lower">
            <div className="desk-controls">
              <button type="button" className="d-btn primary big" onClick={show} disabled={!def?.available || (!onAirSel && !!previewError)}>
                {onAirSel ? tr("Hide") : tr("Show")} <kbd>{tr("Space")}</kbd>
              </button>
              <div className="pair">
                <button type="button" className="d-btn big" style={{ fontSize: 17 }} onClick={update} disabled={!onAirSel || (!changed && !freshData)}>{tr("Update")} <kbd>U</kbd></button>
                <button type="button" className="d-btn big" style={{ fontSize: 14 }} onClick={hideActive} disabled={!desk.onAir.length}>{tr("Hide active")} <kbd>H</kbd></button>
              </div>
              <p>{tr("Space shows / hides the selected graphic. U applies draft changes to it on air. Shortcuts are off while you type in a field or the palette.")}</p>
              {desk.otherOnAir > 0 && <p>{desk.otherOnAir}  {tr("other graphic")}{desk.otherOnAir === 1 ? '' : 's'}  {tr("on air (e.g. the output test pattern) · Force hide all clears everything.")}</p>}
            </div>
            <div className="mon preview">
              <MonitorHead title={tr("PREVIEW · DRAFT")} onAir={false} tools={!previewAway && <button type="button" onClick={() => call('window:openMonitor', 'preview')}>{tr("Pop out ↗")}</button>} />
              {previewAway ? (
                <div className="mon-away">
                  <h3>{tr("Preview in separate window")}</h3>
                  <div className="row">
                    <button type="button" className="d-btn sm" onClick={() => call('window:openMonitor', detached ? 'both' : 'preview')}>{tr("Focus window ↗")}</button>
                    <button type="button" className="d-btn sm" onClick={() => call('window:closeMonitor', detached ? 'both' : 'preview')}>{tr("Re-dock")}</button>
                  </div>
                </div>
              ) : <PreviewVideo />}
            </div>
          </div>
        </section>
      </div>

      <footer className="desk-footer">
        <span>
          <span className={(polling?.length ? polling.every(p => p.lastPoll && !p.lastError && !p.errorCount && now - p.lastPoll <= Math.max(30000, (p.interval || 10000) * 3)) : lastCheck?.ok) ? 'ok' : 'bad'}>● </span>
          {polling?.length ? polling.map(p => `${p.className}: ${p.lastError ? `error · ${p.lastError}` : !p.lastPoll ? tr("waiting for first poll") : `${now - p.lastPoll > Math.max(30000, (p.interval || 10000) * 3) ? `${tr('STALE')} · ` : ''}${tr('polled')} ${Math.max(0, Math.floor((now - p.lastPoll) / 1000))} ${tr('s ago')}`} · ${tr('every')} ${(p.interval || 10000) / 1000} s${p.lastUpdate ? ` · ${tr('data changed')} ${Math.max(0, Math.floor((now - p.lastUpdate) / 1000))} ${tr('s ago')}` : ` · ${tr('no changes received')}`}`).join(' | ') : lastCheck ? `${tr('Connection test')} ${lastCheck.ok ? tr("passed") : tr("failed")} · ${lastCheck.message || ''} · ${Math.max(0, Math.round((now - lastCheck.at) / 60000))} ${tr('min ago')} · ${tr('live polling starts when a timing graphic is on air')}` : tr("Timing not tested (Settings → Data)")}
        </span>
        <span>
          <button type="button" onClick={() => setDialog('keys')}>{tr("Keyboard shortcuts")}</button>
          {' · '}
          <button type="button" onClick={() => setDialog('commands')}>{tr("Command numbers")}</button>
        </span>
        <span className="outs">
          <span><span className={output.ndi ? 'ok' : 'bad'}>● </span>NDI {output.ndi ? 'on' : 'off'}</span>
          <span><span className={output.web ? 'ok' : 'bad'}>● </span>{tr("Web output")} {output.web ? 'on' : 'off'}</span>
        </span>
      </footer>

      {palette && (
        <CommandPalette
          eventId={eventId}
          data={paletteData}
          onNeedControls={loadControls}
          onClose={() => setPalette(false)}
          onLoad={d => {
            setPalette(false);
            if (d.key === 'runner-start' && d.values.runnerName) setFollowNext(false);
            setSelected(d.key);
            setDraft(d);
            say('Draft loaded into Preview · Space to Show');
          }}
        />
      )}
      {dialog === 'keys' && <KeysDialog onClose={() => setDialog('')} />}
      {dialog === 'commands' && (
        <CommandsDialog
          map={commands}
          templates={templates}
          onClose={() => setDialog('')}
          onSave={async map => {
            try { setCommands(await call('desk:saveCommands', map)); setDialog(''); say('Command numbers saved'); }
            catch (e) { say((e as Error).message, 'err'); }
          }}
        />
      )}
      {toast && <div className={`desk-toast ${toast.kind ?? ''}`} role={toast.kind === 'err' ? 'alert' : 'status'}>{tr(toast.text)}</div>}
    </div>
  );
}


function KeysDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="palette-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette d-dialog" role="dialog" aria-modal="true" aria-labelledby="keys-title">
        <div className="palette-head"><h2 id="keys-title">{tr("Keyboard shortcuts")}</h2><button type="button" onClick={onClose} autoFocus>Esc</button></div>
        <table><tbody>{DESK_SHORTCUTS.map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td>{v}</td></tr>)}</tbody></table>
        <p className="sub">{tr("Shortcuts never fire while you type in a field or in the palette.")}</p>
      </div>
    </div>
  );
}

function CommandsDialog({ map, templates, onClose, onSave }: {
  map: DeskCommandMap; templates: DeskTemplateInfo[]; onClose: () => void; onSave: (m: DeskCommandMap) => void;
}) {
  const [nums, setNums] = useState<Record<string, string>>(() =>
    Object.fromEntries(templates.map(t => [t.key, Object.entries(map).find(([, k]) => k === t.key)?.[0] ?? ''])));
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  const dupes = Object.values(nums).filter((n, i, a) => n !== '' && a.indexOf(n) !== i);
  return (
    <div className="palette-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette d-dialog" role="dialog" aria-modal="true" aria-labelledby="cmd-title">
        <div className="palette-head"><h2 id="cmd-title">{tr("Command numbers")}</h2><button type="button" onClick={onClose}>Esc</button></div>
        <p className="sub">{tr("The first number of a palette command picks the graphic. Then come its parameters, e.g. class and bib.")}</p>
        <table>
          <thead><tr><th>{tr("No.")}</th><th>{tr("Graphic")}</th><th>{tr("Then")}</th></tr></thead>
          <tbody>{templates.map(t => (
            <tr key={t.key}>
              <td><input className="d-input mono" aria-label={`Number for ${t.label}`} value={nums[t.key]} onChange={e => setNums(n => ({ ...n, [t.key]: e.target.value.replace(/\D/g, '').slice(0, 2) }))} /></td>
              <td>{tr(t.label)}{t.available ? '' : ' (not in this look)'}</td>
              <td className="d-note">{t.params.join(' · ') || '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        {dupes.length > 0 && <p className="msg bad">{tr("Each number can only be used once (")}{[...new Set(dupes)].join(', ')})</p>}
        <div className="d-actions">
          <button type="button" className="d-btn primary" disabled={dupes.length > 0}
            onClick={() => onSave(Object.fromEntries(Object.entries(nums).filter(([, n]) => n !== '').map(([k, n]) => [n, k])))}>{tr("Save")}</button>
          <button type="button" className="d-btn" onClick={() => setNums(Object.fromEntries(DESK_TEMPLATES.map((t, i) => [t.key, String(i)])))}>{tr("Reset to")} 0–{DESK_TEMPLATES.length - 1}</button>
        </div>
      </div>
    </div>
  );
}
