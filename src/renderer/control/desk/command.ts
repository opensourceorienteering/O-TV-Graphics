/**
 * Command palette grammar: "<graphic> <param> <param> ...", e.g. "2 2 101" = runner identity,
 * class 2, bib 101; "1 2 213" = live split, class 2, control 213. The graphic numbers come from
 * the configurable command map; the parameters follow the graphic's order (see DESK_TEMPLATES).
 *
 * A favourite is picked by its F-number after the graphic: "2 F1" = runner identity, favourite F1.
 *
 * Classes are numbered 1..n in the competition's class order (or typed by name). Runners are
 * found by bib or by name, inside the chosen class or, with no class, the whole competition.
 * Parsing never activates output: a complete command only loads a draft for Preview.
 */

import { bibMatch, bibStartsWith, findByBib } from '../../../shared/bibs';
import { DESK_TEMPLATES, hasBehaviour, sameDraft, type DeskCommandMap, type DeskDraft, type DeskFavorite, type DeskParam, type DeskTemplate } from '../../../shared/desk';

export interface PaletteRunner { name: string; club: string; className: string; bib?: string; virtualBib?: string; startTimeMs?: number }
export interface PaletteControl { code: number | string; name: string }

export function nextStarter(runners: readonly PaletteRunner[], now = Date.now()): PaletteRunner | undefined {
  return runners.reduce<PaletteRunner | undefined>((next, runner) => {
    const startTimeMs = runner.startTimeMs;
    if (typeof startTimeMs !== 'number' || !Number.isFinite(startTimeMs) || startTimeMs < now) return next;
    return !next || startTimeMs < (next.startTimeMs ?? Infinity) ? runner : next;
  }, undefined);
}

export interface PaletteData {
  commands: DeskCommandMap;
  /** Templates the event's look provides (keys) */
  available: Set<string>;
  /** Templates hidden from Live in Settings → Templates (keys) */
  hidden?: Set<string>;
  classes: string[];
  runners: PaletteRunner[];
  /** Controls per class (loaded on demand) */
  controls: (className: string) => PaletteControl[] | undefined;
  /** Saved favourites per graphic key ("<graphic> F<n>") */
  favorites?: Record<string, DeskFavorite[]>;
}

export interface Suggestion {
  /** Text that replaces the token being typed */
  token: string;
  label: string;
  detail: string;
}

export interface ParsedCommand {
  template?: DeskTemplate;
  /** "Runner identity / Men Elite / Jan Novák" */
  interpretation: string[];
  /** Parameter being typed or required next */
  next?: DeskParam | 'graphic' | 'favourite';
  /** What to tell the operator */
  message: string;
  /** Problem with the current input (shown in red; Load is disabled) */
  error?: string;
  /** Text of the invalid token, e.g. "Control 999" */
  errorToken?: string;
  suggestions: Suggestion[];
  complete: boolean;
  draft?: DeskDraft;
  /** Token index where the parameter being completed starts (a suggestion replaces from here) */
  tokenStart?: number;
  /** F-number of the favourite the command loads ("<graphic> F<n>") */
  favorite?: number;
}

/** One part of a graphic's command, for the syntax line under the palette input */
export interface SyntaxPart {
  param: DeskParam;
  /** "Class", "Runner" ... (translated by the palette) */
  label: string;
  /** What was typed for it, as a number or code: "1", "101", "213", "F" */
  token?: string;
  /** What that matched: "Damer Lång", "Jan Novák", "Finish" */
  value?: string;
  state: 'done' | 'current' | 'todo';
  optional: boolean;
  /** What the part accepts, e.g. "bib or name" (a fixed text, translated by the palette) */
  hint: string;
  /** Valid numbers, e.g. "1–25" for classes */
  range?: string;
}

export interface CommandSyntax {
  /** Graphic number as typed */
  number: string;
  label: string;
  parts: SyntaxPart[];
  /** The graphic's favourites, e.g. ["F1", "F2"] */
  favorites: string[];
  /** The command loads this favourite instead of parameters */
  favorite?: number;
}

/**
 * The chosen graphic's whole command: done parts with their values, the part being typed,
 * the parts still to come, and its favourites. Null until the graphic number is recognised.
 */
export function commandSyntax(input: string, parsed: ParsedCommand, data: PaletteData): CommandSyntax | null {
  const template = parsed.template;
  if (!template) return null;
  const number = input.trim().split(/\s+/)[0] ?? '';
  const values = parsed.draft?.values ?? {};
  const classCount = data.classes.length;
  const hints: Record<DeskParam, string> = {
    class: 'number or name',
    runner: 'bib or name',
    control: hasBehaviour(template, 'startControl') ? 'S start · radio code · F finish' : 'radio code · F finish',
    page: 'page number'
  };
  const focusStart = hasBehaviour(template, 'startControl') && parsed.interpretation.includes('Start');
  /** [typed token, what it matched] for a part that is filled in */
  const filled = (param: DeskParam): [string | undefined, string] | undefined => {
    if (param === 'class') {
      if (!values.className) return undefined;
      const i = data.classes.indexOf(values.className);
      return [i >= 0 ? String(i + 1) : undefined, values.className];
    }
    if (param === 'runner') return values.runnerName ? [values.runnerBib || undefined, values.runnerName] : undefined;
    if (param === 'control') {
      if (values.controlCode === undefined) return focusStart ? ['S', 'Start'] : undefined;
      if (values.controlCode === '' || values.controlCode === 'F') return ['F', 'Finish'];
      const name = values.className ? data.controls(values.className)?.find(c => String(c.code) === values.controlCode)?.name : undefined;
      return [values.controlCode, name || `Control ${values.controlCode}`];
    }
    return parsed.draft?.page ? [String(parsed.draft.page), 'Page'] : undefined;
  };
  const LABELS: Record<DeskParam, string> = { class: 'Class', runner: 'Runner', control: 'Control', page: 'Page' };
  const parts: SyntaxPart[] = parsed.favorite !== undefined ? [] : template.params.map(param => {
    const done = filled(param);
    const state: SyntaxPart['state'] = parsed.next === param ? 'current' : done ? 'done' : 'todo';
    const range = param === 'class' && classCount ? `1–${classCount}` : undefined;
    return { param, label: LABELS[param], token: done?.[0], value: done?.[1], state, optional: !template.required.includes(param), hint: hints[param], range };
  });
  const favorites = [...(data.favorites?.[template.key] ?? [])].sort((a, b) => a.n - b.n).map(f => `F${f.n}`);
  return { number, label: template.label, parts, favorites, favorite: parsed.favorite };
}

const PARAM_LABEL: Record<DeskParam, string> = { class: 'class', runner: 'runner', control: 'control', page: 'page' };
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function runnersFor(data: PaletteData, className?: string) {
  return className ? data.runners.filter(r => r.className === className) : data.runners;
}

function runnerBib(r: PaletteRunner) {
  return r.bib || r.virtualBib || '';
}

export function parseCommand(input: string, data: PaletteData): ParsedCommand {
  const endsWithSpace = /\s$/.test(input);
  const tokens = input.trim() ? input.trim().split(/\s+/) : [];
  const out: ParsedCommand = { interpretation: [], suggestions: [], complete: false, message: '' };

  // --- graphic ---
  const graphicSuggestions = () =>
    Object.entries(data.commands)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([n, key]) => ({ n, t: DESK_TEMPLATES.find(t => t.key === key)! }))
      .filter(x => x.t && data.available.has(x.t.key) && !data.hidden?.has(x.t.key));
  if (!tokens.length) {
    out.next = 'graphic';
    out.tokenStart = 0;
    out.message = 'Type a graphic number, then its parameters';
    out.suggestions = graphicSuggestions().map(x => ({ token: x.n, label: x.t.label, detail: x.t.params.length ? `Then: ${x.t.params.map(p => PARAM_LABEL[p]).join(', ')}` : 'No parameters' }));
    return out;
  }
  const typingGraphic = tokens.length === 1 && !endsWithSpace;
  out.tokenStart = 0;
  const key = data.commands[tokens[0]];
  const template = DESK_TEMPLATES.find(t => t.key === key);
  if (!template || !data.available.has(template.key) || data.hidden?.has(template.key)) {
    const matches = graphicSuggestions().filter(x => x.n.startsWith(tokens[0]) || fold(x.t.label).includes(fold(tokens[0])));
    if (typingGraphic && matches.length) {
      out.next = 'graphic';
      out.message = 'Choose a graphic';
      out.suggestions = matches.map(x => ({ token: x.n, label: x.t.label, detail: `Number ${x.n}` }));
      return out;
    }
    out.next = 'graphic';
    out.error = !template ? `No graphic has number ${tokens[0]}`
      : data.hidden?.has(template.key) ? `${template.label} is hidden in Settings → Templates`
      : `${template.label} is not in this event's look`;
    out.errorToken = `Graphic ${tokens[0]}`;
    out.message = out.error;
    out.suggestions = graphicSuggestions().slice(0, 8).map(x => ({ token: x.n, label: x.t.label, detail: `Number ${x.n}` }));
    return out;
  }
  out.template = template;
  out.tokenStart = undefined;
  out.interpretation.push(template.short);
  const draft: DeskDraft = { key: template.key, values: {}, fields: {} };

  // --- favourite: "<graphic> F<n>" loads a saved draft instead of parameters ---
  const favs = [...(data.favorites?.[template.key] ?? [])].sort((a, b) => a.n - b.n);
  const favSuggestions = (digits = '') =>
    favs.filter(f => String(f.n).startsWith(digits)).map(f => ({ token: `F${f.n}`, label: f.label, detail: 'Favourite' }));
  const first = tokens[1];
  if (first !== undefined && (/^f\d+$/i.test(first) || (/^f$/i.test(first) && favs.length > 0))) {
    out.tokenStart = 1;
    const digits = first.slice(1);
    const fav = digits ? favs.find(f => f.n === Number(digits)) : undefined;
    if (tokens.length === 2 && !endsWithSpace && (!fav || favSuggestions(digits).length > 1)) {
      // Still typing the F-number (F1 vs F12): offer the matches
      out.next = 'favourite';
      out.suggestions = favSuggestions(digits);
      if (fav) {
        out.interpretation.push(`F${fav.n} ${fav.label}`);
        out.draft = { ...fav.draft, key: template.key };
        out.favorite = fav.n;
        out.complete = true;
        out.message = 'Favourite ready · Enter loads it into Preview';
      } else {
        out.message = out.suggestions.length ? 'Choose a favourite' : `${template.label} has no favourite ${first.toUpperCase()}`;
        if (!out.suggestions.length) { out.error = out.message; out.errorToken = first.toUpperCase(); }
      }
      return out;
    }
    if (!fav) {
      out.next = 'favourite';
      out.error = `${template.label} has no favourite ${first.toUpperCase()}`;
      out.errorToken = first.toUpperCase();
      out.message = out.error;
      out.suggestions = favSuggestions();
      return out;
    }
    if (tokens.length > 2) {
      out.error = 'A favourite takes no parameters';
      out.errorToken = tokens[2];
      out.message = out.error;
      return out;
    }
    out.interpretation.push(`F${fav.n} ${fav.label}`);
    out.draft = { ...fav.draft, key: template.key };
    out.favorite = fav.n;
    out.complete = true;
    out.message = 'Favourite ready · Enter loads it into Preview';
    return out;
  }

  // --- parameters, in the graphic's order ---
  const params = template.params;
  let ti = 1;
  for (let pi = 0; pi < params.length; pi++) {
    const param = params[pi];
    // A runner may be typed as a name with spaces: it takes the rest of the input
    let rest = tokens.slice(ti);
    // Runner focus: "… <runner> <timing point>"; a typed name stops before the timing point
    const controlFollows = param === 'runner' && params[pi + 1] === 'control';
    if (controlFollows && rest.length > 1 && /^(s|start|f|finish|\d+)$/i.test(rest[rest.length - 1]) && !/^\d+$/.test(rest[0])) rest = rest.slice(0, -1);
    const token = param === 'runner' && rest.length > 1 && !/^\d+$/.test(rest[0]) ? rest.join(' ') : tokens[ti];
    const isLast = param === 'runner' && token === rest.join(' ') && ti + rest.length === tokens.length ? true : ti === tokens.length - 1;
    const typing = token !== undefined && isLast && !endsWithSpace;

    out.tokenStart = ti;
    if (token === undefined) {
      // Nothing typed for this parameter yet
      const required = template.required.includes(param);
      out.next = param;
      // Right after the graphic, its favourites come first (F1, F2 ...)
      out.suggestions = [...(ti === 1 ? favSuggestions() : []), ...suggest(param, '', draft, data)];
      if (required) {
        out.message = `Choose a ${PARAM_LABEL[param]} to complete the command`;
        out.draft = draft;
        return out;
      }
      out.message = `Optional: ${PARAM_LABEL[param]}`;
      break;
    }

    if (param === 'class') {
      const byNumber = /^\d+$/.test(token) ? data.classes[Number(token) - 1] : undefined;
      const byName = data.classes.find(c => fold(c) === fold(token));
      const cls = byNumber || byName;
      if (!cls || typing) {
        const s = suggest('class', token, draft, data);
        if (typing && s.length && !(cls && s.length === 1)) {
          out.next = 'class'; out.suggestions = s; out.message = 'Choose a class'; out.draft = draft;
          if (cls) { draft.values.className = cls; out.interpretation.push(cls); }
          return finish(out, template, draft, typing);
        }
        if (!cls) return fail(out, `Class ${token} does not exist`, `Class ${token}`, 'class', suggest('class', '', draft, data));
      }
      draft.values.className = cls;
      out.interpretation.push(cls!);
      ti++;
      continue;
    }

    if (param === 'control') {
      const cls = draft.values.className;
      const controls = cls ? data.controls(cls) : undefined;
      const focus = hasBehaviour(template, 'startControl');
      if (focus && /^(s|start)$/i.test(token)) {
        // Runner focus: no control = the start
        out.interpretation.push('Start');
        ti++;
        continue;
      }
      if (/^(f|finish|0)$/i.test(token)) {
        // Elsewhere no control = the finish; Runner focus marks the finish explicitly
        if (focus) draft.values.controlCode = 'F';
        else draft.values.controlCode = '';
        out.interpretation.push('Finish');
        ti++;
        continue;
      }
      if (controls === undefined) {
        if (cls) return { ...out, next: 'control', message: `Loading controls for ${cls}…`, draft, suggestions: [] };
        return fail(out, 'Choose a class before a control', `Control ${token}`, 'class', suggest('class', '', draft, data));
      }
      const match = controls.find(c => String(c.code) === token || String(Number(c.code) % 1000) === token);
      if (!match || typing) {
        const s = suggest('control', token, draft, data);
        if (typing && s.length && !(match && s.length === 1)) {
          out.next = 'control'; out.suggestions = s; out.message = 'Choose a control';
          if (match) { draft.values.controlCode = String(match.code); out.interpretation.push(`Control ${token}`); }
          return finish(out, template, draft, typing);
        }
        if (!match) return fail(out, `Control ${token} is unavailable for ${cls}`, `Control ${token}`, 'control', suggest('control', '', draft, data));
      }
      draft.values.controlCode = String(match.code);
      out.interpretation.push(`Control ${token}`);
      ti++;
      continue;
    }

    if (param === 'runner') {
      const pool = runnersFor(data, draft.values.className);
      // A bib: real bibs, or virtual bibs with or without their V ("101" finds V101)
      const exact = /^[a-z]?\d+$/i.test(token)
        ? findByBib(pool, token)
        : pool.filter(r => fold(r.name) === fold(token));
      const s = suggest('runner', token, draft, data);
      if (exact.length !== 1 || (typing && s.length > 1)) {
        if (!s.length) return fail(out, `No runner ${/^\d+$/.test(token) ? 'with bib ' : ''}${token}${draft.values.className ? ` in ${draft.values.className}` : ''}`, `Runner ${token}`, 'runner', suggest('runner', '', draft, data));
        out.next = 'runner';
        out.suggestions = s;
        out.message = 'Choose a runner to complete the command';
        out.interpretation.push(`Runner: ${token}…`);
        out.tokenStart = ti;
        out.draft = draft;
        return out;
      }
      const r = exact[0];
      Object.assign(draft.values, { runnerName: r.name, runnerClub: r.club, runnerBib: runnerBib(r) || undefined });
      if (!draft.values.className) draft.values.className = r.className;
      out.interpretation.push(r.name);
      // a bib is one token; a typed name takes the words up to a trailing timing point
      ti += token.split(/\s+/).length;
      continue;
    }

    if (param === 'page') {
      if (!/^\d+$/.test(token) || Number(token) < 1) return fail(out, `Page ${token} is not a page number`, `Page ${token}`, 'page', []);
      draft.page = Number(token);
      out.interpretation.push(`Page ${token}`);
      ti++;
      continue;
    }
  }
  // A graphic without parameters is complete at once; its favourites stay on offer
  if (!params.length && tokens.length === 1) out.suggestions = favSuggestions();
  if (ti < tokens.length) return fail(out, `${template.label} takes no more than ${params.length} parameter${params.length === 1 ? '' : 's'}`, tokens.slice(ti).join(' '), undefined, []);
  return finish(out, template, draft, false);
}

function finish(out: ParsedCommand, template: DeskTemplate, draft: DeskDraft, typing: boolean): ParsedCommand {
  out.draft = draft;
  const missing = template.required.filter(p =>
    (p === 'class' && !draft.values.className) || (p === 'runner' && !draft.values.runnerName));
  if (missing.length) {
    out.next = out.next || missing[0];
    out.message = out.message || `Choose a ${PARAM_LABEL[missing[0]]} to complete the command`;
    return out;
  }
  if (typing && out.suggestions.length) return out;
  out.complete = true;
  out.message = 'Complete command · ready to load';
  return out;
}

function fail(out: ParsedCommand, error: string, token: string, next: DeskParam | undefined, suggestions: Suggestion[]): ParsedCommand {
  return { ...out, error, errorToken: token, message: error, next, suggestions, complete: false };
}

export function suggest(param: DeskParam, text: string, draft: DeskDraft, data: PaletteData): Suggestion[] {
  const q = fold(text.trim());
  if (param === 'class') {
    return data.classes
      .map((c, i) => ({ c, n: String(i + 1) }))
      .filter(({ c, n }) => !q || n.startsWith(q) || fold(c).includes(q))
      .slice(0, 8)
      .map(({ c, n }) => ({ token: n, label: c, detail: `Class ${n}` }));
  }
  if (param === 'control') {
    const controls = draft.values.className ? data.controls(draft.values.className) ?? [] : [];
    const finish: Suggestion = { token: 'F', label: 'Finish', detail: `${draft.values.className ?? ''} · finish` };
    const start: Suggestion[] = hasBehaviour(draft.key, 'startControl') ? [{ token: 'S', label: 'Start', detail: 'countdown, then running time' }] : [];
    return [...start, finish, ...controls.map(c => ({ token: String(c.code), label: c.name || `Control ${c.code}`, detail: `${draft.values.className} · control ${c.code}` }))]
      .filter(s => !q || fold(s.token).startsWith(q) || fold(s.label).includes(q))
      .slice(0, 8);
  }
  if (param === 'runner') {
    const pool = runnersFor(data, draft.values.className);
    const scored = pool
      .map(r => {
        const name = fold(r.name);
        const exact = q ? bibMatch(r, q) : -1;
        const score = !q ? 1 : exact >= 0 ? 0 : bibStartsWith(r, q) ? 1 : name.startsWith(q) ? 2 : name.includes(q) ? 3 : -1;
        return { r, score };
      })
      .filter(x => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.r.name.localeCompare(b.r.name));
    return scored.slice(0, 8).map(({ r }) => ({
      token: runnerBib(r) || r.name,
      label: r.name,
      detail: [runnerBib(r) && `Bib ${runnerBib(r)}`, r.className, r.club].filter(Boolean).join(' · ')
    }));
  }
  return [];
}

/** Replace the parameter being typed (or append the next one) with a chosen suggestion */
export function applySuggestion(input: string, s: Suggestion, parsed: ParsedCommand): string {
  const tokens = input.trim() ? input.trim().split(/\s+/) : [];
  const start = parsed.tokenStart ?? tokens.length;
  return `${[...tokens.slice(0, start), s.token].join(' ')} `;
}

/**
 * The palette command that loads a draft, e.g. "3 6 101 F", for the recent list when a graphic
 * goes on air some other way (desk buttons, keys, a control surface). A draft that matches a
 * favourite becomes "<graphic> F<n>". Null when no command can express it.
 */
export function commandForDraft(draft: DeskDraft, data: PaletteData): string | null {
  const number = Object.entries(data.commands).find(([, k]) => k === draft.key)?.[0];
  const template = DESK_TEMPLATES.find(t => t.key === draft.key);
  if (number === undefined || !template) return null;
  const fav = (data.favorites?.[draft.key] ?? []).find(f => sameDraft({ ...f.draft, key: draft.key }, draft));
  if (fav) return `${number} F${fav.n}`;
  const v = draft.values ?? {};
  const tokens: (string | undefined)[] = template.params.map(param => {
    if (param === 'class') {
      if (!v.className) return undefined;
      const i = data.classes.indexOf(v.className);
      if (i >= 0) return String(i + 1);
      return /\s/.test(v.className) ? undefined : v.className;
    }
    if (param === 'runner') return v.runnerBib || v.runnerName || undefined;
    if (param === 'control') {
      if (v.controlCode === undefined) return hasBehaviour(template, 'startControl') ? 'S' : undefined;
      return v.controlCode === '' || v.controlCode === 'F' ? 'F' : v.controlCode;
    }
    return draft.page && draft.page > 1 ? String(draft.page) : undefined;
  });
  // Trailing parameters left open are simply not typed; an open one before a typed one breaks the order
  while (tokens.length && tokens[tokens.length - 1] === undefined) tokens.pop();
  // No control means the finish; spell it out when a page follows it
  const ci = template.params.indexOf('control');
  if (ci >= 0 && ci < tokens.length && tokens[ci] === undefined) tokens[ci] = 'F';
  // Runner focus: "S" (the start) is the default, so it needs no token at the end
  if (hasBehaviour(template, 'startControl') && tokens[tokens.length - 1] === 'S') tokens.pop();
  if (tokens.some(t => t === undefined)) return null;
  const input = [number, ...tokens].join(' ');
  // Only offer what the palette reads back as the same graphic and parameters
  const check = parseCommand(input, { ...data, controls: cls => data.controls(cls) ?? (v.controlCode ? [{ code: v.controlCode, name: '' }] : []) });
  if (!check.complete || !check.draft) return null;
  const same = (a: DeskDraft['values'], b: DeskDraft['values']) =>
    (a.className ?? '') === (b.className ?? '') && (a.runnerName ?? '') === (b.runnerName ?? '') &&
    (a.controlCode ?? '') === (b.controlCode ?? '');
  return same(check.draft.values, v) ? input : null;
}
