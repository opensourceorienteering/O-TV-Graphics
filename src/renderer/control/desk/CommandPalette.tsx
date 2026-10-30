import { t as tr } from "../i18n";
/**
 * Command palette (Ctrl/Cmd+K): type "<graphic> <class> <runner|control> …", see what it means
 * as you type, pick suggestions with the arrow keys, and load a complete command as a draft.
 * The palette never sends anything to air: Show is always a separate, explicit action.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { applySuggestion, commandSyntax, parseCommand, type PaletteData, type Suggestion } from './command';
import type { DeskDraft } from '../../../shared/desk';

export interface RecentCommand { input: string; label: string; detail: string }

/** Recent commands belong to one event: class and bib numbers mean nothing in another */
const recentKey = (eventId: string) => `olg.desk.recent.${eventId}`;

export function loadRecent(eventId: string): RecentCommand[] {
  try {
    // The old list was shared by every event; drop it so it never leaks into one
    localStorage.removeItem('olg.desk.recent');
    return JSON.parse(localStorage.getItem(recentKey(eventId)) || '[]');
  } catch { return []; }
}

export function rememberRecent(eventId: string, cmd: RecentCommand) {
  try {
    const list = [cmd, ...loadRecent(eventId).filter(r => r.input !== cmd.input)].slice(0, 8);
    localStorage.setItem(recentKey(eventId), JSON.stringify(list));
  } catch { /* storage optional */ }
}

export function CommandPalette({ eventId, data, onLoad, onClose, onNeedControls }: {
  /** Recent commands are kept per event */
  eventId: string;
  data: PaletteData;
  onLoad: (draft: DeskDraft) => void;
  onClose: () => void;
  /** Ask the desk to fetch a class's controls (palette data refreshes when they arrive) */
  onNeedControls: (className: string) => void;
}) {
  const [input, setInput] = useState('');
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  /** Pointer position of the last mouse move; hover selects only when the pointer really moves */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const recent = useMemo(() => loadRecent(eventId), [eventId]);
  const parsed = useMemo(() => parseCommand(input, data), [input, data]);
  // The chosen graphic's whole command: what is done, what is being typed, what comes next
  const syntax = useMemo(() => commandSyntax(input, parsed, data), [input, parsed, data]);
  const currentPart = syntax?.parts.find(p => p.state === 'current');

  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [input]);
  // Fetch controls for the chosen class when the command needs them
  useEffect(() => {
    if (parsed.template?.params.includes('control') && parsed.draft?.values.className && data.controls(parsed.draft.values.className) === undefined)
      onNeedControls(parsed.draft.values.className);
  }, [parsed, data, onNeedControls]);

  // Empty input: recent commands first, then the graphics (hints) — one list for ↑↓
  const empty = !input.trim();
  const showRecent = empty && recent.length > 0;
  const items: (Suggestion & { recent?: boolean })[] = empty
    ? [...recent.map(r => ({ token: r.input, label: r.label, detail: r.detail, recent: true })), ...parsed.suggestions]
    : parsed.suggestions;
  const current = Math.min(active, Math.max(0, items.length - 1));

  // Keep the highlighted row visible when it moves past the edge of the palette
  useEffect(() => {
    list.current?.children[current]?.scrollIntoView({ block: 'nearest' });
  }, [current, items.length]);

  const load = () => {
    if (!parsed.complete || !parsed.draft) return;
    rememberRecent(eventId, { input: input.trim(), label: parsed.template!.label, detail: parsed.interpretation.slice(1).join(' / ') });
    onLoad(parsed.draft);
  };

  const choose = (index: number) => {
    const item = items[index];
    if (!item) return;
    if (item.recent) { setInput(`${item.token} `); return; }
    setInput(applySuggestion(input, item, parsed));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      // Wraps around, so ↑ from the top reaches the last row
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + items.length) % items.length);
      return;
    }
    if (e.key === 'Tab') {
      // Tab completes the highlighted suggestion and moves on to the next parameter
      if (items.length) { e.preventDefault(); choose(current); }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Enter on an incomplete command picks the suggestion; on a complete one it loads
      if (parsed.complete && !(items.length && current > 0)) load();
      else if (items.length) choose(current);
    }
  };

  const summary = parsed.complete && parsed.draft ? [
    ['Graphic', parsed.template!.label],
    ...(parsed.draft.values.className ? [['Class', `${parsed.draft.values.className} · ID ${data.classes.indexOf(parsed.draft.values.className) + 1}`]] : []),
    ...(parsed.draft.values.controlCode !== undefined && parsed.template!.params.includes('control') ? [['Timing point', parsed.draft.values.controlCode ? `Control ${parsed.draft.values.controlCode}` : 'Finish']] : []),
    ...(parsed.draft.values.runnerName ? [['Runner', `${parsed.draft.values.runnerBib ? parsed.draft.values.runnerBib + ' · ' : ''}${parsed.draft.values.runnerName} · ${parsed.draft.values.runnerClub ?? ''}`]] : []),
    ...(parsed.draft.page ? [['Page', String(parsed.draft.page)]] : [])
  ] : [];

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-labelledby="palette-title">
        <div className="palette-head">
          <h2 id="palette-title">{tr("Command palette")}</h2>
          <button type="button" onClick={onClose}>Esc</button>
        </div>
        <p className="sub">{tr("Load a draft. Never transmit.")}</p>
        <input
          ref={field}
          className={`palette-input ${parsed.error ? 'bad' : ''}`}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={tr("Type command or recall recent…")}
          aria-label={tr("Command")}
          aria-describedby="palette-msg"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="palette-list"
          aria-activedescendant={items.length ? `palette-opt-${current}` : undefined}
          spellCheck={false}
          autoComplete="off"
        />
        {showRecent ? (
          <p className="sub">{tr("RECENT COMMANDS, THEN GRAPHICS · ↑↓ TO CHOOSE · ENTER TO RECALL")}</p>
        ) : input.trim() ? (
          <div className="interp">
            <span>{parsed.interpretation.filter(x => !x.startsWith('Runner:')).join(' / ') || '—'}</span>
            {parsed.error && parsed.errorToken ? <span className="bad">{parsed.errorToken}</span>
              : parsed.complete ? <span className="done">{tr("✓ Ready")}</span>
              : parsed.interpretation[parsed.interpretation.length - 1]?.startsWith('Runner:') ? <span className="next">{parsed.interpretation[parsed.interpretation.length - 1]}</span>
              : parsed.next && !syntax ? <span className="next">{tr("Next:")} {tr(parsed.next)}</span> : null}
          </div>
        ) : null}
        {!showRecent && syntax && (
          <div className="syntax" aria-label={`${tr("Command for")} ${tr(syntax.label)}`}>
            <div className="syntax-line">
              <span className="syn-part syn-graphic"><span className="syn-tok">{syntax.number}</span>{tr(syntax.label)}</span>
              {syntax.favorite !== undefined
                ? <span className="syn-part done"><span className="syn-tok">F{syntax.favorite}</span>{tr("Favourite")}</span>
                : syntax.parts.map(p => (
                  <span key={p.param} className={`syn-part ${p.state}${p.optional ? ' optional' : ''}`}
                    aria-current={p.state === 'current' ? 'step' : undefined}>
                    {p.state === 'done'
                      ? <>{p.token && <span className="syn-tok">{p.token}</span>}{tr(p.value ?? '')}</>
                      : `${p.optional ? '[' : ''}${tr(p.label)}${p.optional ? ']' : ''}`}
                  </span>
                ))}
              {syntax.favorite === undefined && syntax.parts.length === 0 && <span className="syn-none">{tr("no parameters")}</span>}
              {syntax.favorite === undefined && syntax.favorites.length > 0 && (
                <span className="syn-or">{tr("or favourite")} {syntax.favorites.join(' ')}</span>
              )}
            </div>
            {currentPart && (
              <p className="syn-hint">
                <b>{tr(currentPart.label)}</b>: {tr(currentPart.hint)}{currentPart.range ? ` (${currentPart.range})` : ''}
                {currentPart.optional && parsed.complete ? ` · ${tr("optional, Enter loads without it")}` : ''}
              </p>
            )}
          </div>
        )}
        {!showRecent && (
          <p id="palette-msg" className={`msg ${parsed.error ? 'bad' : ''}`} role={parsed.error ? 'alert' : 'status'}>
            {parsed.complete ? tr("✓ Complete command · ready to load") : parsed.message}
          </p>
        )}
        {summary.length > 0 && (
          <dl className="summary">{summary.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
        )}
        {items.length > 0 && (
          <ul
            ref={list}
            id="palette-list"
            role="listbox"
            aria-label={showRecent ? tr("Recent commands and graphics") : 'Suggestions'}
            onMouseMove={e => {
              // Rows move under a resting pointer while you type; only a real move selects
              const last = pointer.current;
              pointer.current = { x: e.clientX, y: e.clientY };
              if (!last || (last.x === e.clientX && last.y === e.clientY)) return;
              const row = (e.target as HTMLElement).closest('li');
              const i = row ? Array.prototype.indexOf.call(list.current?.children ?? [], row) : -1;
              if (i >= 0 && i !== current) setActive(i);
            }}
          >
            {items.map((s, i) => (
              <li
                key={`${s.recent ? 'r' : 's'}:${s.token}:${s.label}`}
                id={`palette-opt-${i}`}
                role="option"
                aria-selected={i === current}
                className={s.recent ? 'recent' : undefined}
                onMouseDown={e => { e.preventDefault(); choose(i); field.current?.focus(); }}
              >
                <span className="tok">{s.recent ? '↺' : s.token.length <= 6 ? s.token : '—'}</span>
                <span className="what"><b>{s.recent ? s.token : tr(s.label)}</b><small>{s.recent ? `${tr(s.label)}${s.detail ? ' · ' + s.detail : ''}` : s.detail}</small></span>
                {i === current && <span className="enter">↵</span>}
              </li>
            ))}
          </ul>
        )}
        {!showRecent && parsed.next === 'runner' && !parsed.draft?.values.className && (
          <p className="sub">{tr("Blank class searches the whole competition.")}</p>
        )}
        <button type="button" className="d-btn primary" style={{ height: 40 }} disabled={!parsed.complete} onClick={load}>
           {tr("Load preview")} <kbd>Enter</kbd>
        </button>
        <p className="sub">{parsed.complete ? tr("No transmission. After loading, the palette closes; then press Space to Show.") : tr("Complete the command to load it. Esc keeps the current draft.")}</p>
        <div className="legend">
          <span>{tr("↑↓ Select · Tab completes · Esc dismiss")}</span>
          <span>{tr("Enter selects a suggestion · Enter again loads a complete command")}</span>
          <span className="warn">{tr("Space inserts text here · output suppressed")}</span>
        </div>
      </div>
    </div>
  );
}
