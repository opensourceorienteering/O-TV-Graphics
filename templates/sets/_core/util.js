/**
 * Shared helpers for Split Control template sets: escaping, times, names, identity (club/flag/logo).
 */

import { broadcastControlLabel } from './labels.js';
import { flagUrl, nationCode, runnerNation } from './nations.js';

export const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Resolve an app-served path ("/club-logos/12.png") against the server this module came from */
export function serverUrl(path) {
  if (!path) return '';
  if (/^(https?:|data:)/.test(path)) return path;
  return new URL(path, import.meta.url).href;
}

// --- time -------------------------------------------------------------------------------

/** "1:02:03" / "23:45" / "23:45.6" -> seconds (NaN when not a time) */
export function parseClock(value) {
  const s = String(value ?? '').trim().replace(/^[+-]/, '').replace(',', '.');
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s)) return NaN;
  return s.split(':').reduce((acc, part) => acc * 60 + parseFloat(part), 0);
}

/** seconds -> "M:SS" or "H:MM:SS"; broadcast graphics never show fractions */
export function clock(seconds, { sign = false, forceHours = false } = {}) {
  if (!Number.isFinite(seconds)) return '';
  const neg = seconds < 0;
  let s = Math.floor(Math.abs(seconds));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const body = h > 0 || forceHours
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
  return `${neg ? '-' : sign ? '+' : ''}${body}`;
}

/** A time string from the data, without fractions ("23:45.67" -> "23:45") */
export const time = (v) => {
  const sec = parseClock(v);
  return Number.isFinite(sec) ? clock(sec) : String(v ?? '');
};

/** A behind-leader string: "+1:24"; empty for the leader */
export const diff = (v) => {
  const sec = parseClock(v);
  if (!Number.isFinite(sec) || sec <= 0) return '';
  return clock(sec, { sign: true });
};

/** Server-corrected "now" in ms (data.clockOffsetMs from the app) */
export const now = (data) => Date.now() + (Number(data?.clockOffsetMs) || 0);

/** "HH:MM:SS" (24 h) of an epoch ms in the event's time zone (falls back to local) */
export function timeOfDay(ms, timeZone, withSeconds = true) {
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}),
      hourCycle: 'h23', ...(timeZone ? { timeZone } : {})
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toTimeString().slice(0, withSeconds ? 8 : 5);
  }
}

// --- results helpers --------------------------------------------------------------------

export const isRanked = (r) => Number(r?.statusCode ?? 0) === 0 && String(r?.position ?? '').trim() !== '' && String(r?.position) !== '-';
/** Place for display; runners who are not OK (running, MP, DNF, DNS ...) never get one */
export const placeOf = (r) => {
  if (Number(r?.statusCode ?? 0) !== 0) return '';
  const p = String(r?.position ?? '').trim();
  return p === '=' ? '=' : (/^\d+$/.test(p) ? p : '');
};

/** Status label for non-OK runners, short broadcast forms */
export function statusLabel(r) {
  switch (Number(r?.statusCode)) {
    case 1: return 'DNS';
    case 2: return 'DNF';
    case 3: return 'MP';
    case 4: return 'DSQ';
    case 5: return 'OT';
    case 11: return 'WO';
    default: return '';
  }
}

/** Runner time cell: leader time, others +diff, or status */
export function resultCell(r, isLeader) {
  const st = statusLabel(r);
  if (st) return st;
  if (isLeader) return time(r.time);
  return diff(r.diff) || time(r.time);
}

// --- names ------------------------------------------------------------------------------

/** Split "Given Family" (LiveResults order) into parts */
export function nameParts(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!n) return { given: '', family: '' };
  if (n.includes(',')) { // "Family, Given"
    const [family, given] = n.split(',').map(s => s.trim());
    return { given, family };
  }
  const parts = n.split(' ');
  if (parts.length === 1) return { given: '', family: n };
  return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] };
}

/**
 * Name markup. style:
 *  - 'full'           Given Family (family wrapped for themes that emphasise it)
 *  - 'initial'        G. Family
 *  - 'family-initial' Family G.
 *  - 'family'         Family
 *  - 'given-initial'  Given F.
 * Team names (relay "OK Exempel 1") are passed with style 'team' to keep them as they are.
 */
export function nameHtml(name, style = 'full') {
  if (style === 'team') return `<span class="nm-team">${esc(name)}</span>`;
  const { given, family } = nameParts(name);
  const initial = given ? `${given.split(/[\s-]/).map(p => p.charAt(0)).join('.')}.` : '';
  const g = (t) => t ? `<span class="nm-given">${esc(t)}</span> ` : '';
  const f = `<span class="nm-family">${esc(family)}</span>`;
  switch (style) {
    case 'initial': return `${g(initial)}${f}`;
    case 'family-initial': return `${f}${initial ? ` <span class="nm-given">${esc(initial)}</span>` : ''}`;
    case 'family': return f;
    case 'family-given': return `${f}${given ? ` <span class="nm-given">${esc(given)}</span>` : ''}`;
    // "Kasper F."
    case 'given-initial': return `${g(given)}<span class="nm-family">${esc(family.charAt(0))}.</span>`;
    default: return `${g(given)}${f}`;
  }
}

// --- identity: club, flag, club logo -----------------------------------------------------

export const isRelayClass = (data) => !!data?.isRelay || /-\d+$/.test(String(data?.className ?? ''));

/**
 * What to show next to a name. presentation.identity:
 *  - 'auto' (default): national events show the club; international individual races the flag;
 *    international relays club + flag (the co-stream-gfx rule)
 *  - 'club' | 'flag' | 'both' force it
 * A flag is only shown when a nation can be found; club logos (Eventor) go with the club.
 */
export function identity(runner, data) {
  const p = data?.presentation ?? {};
  const mode = p.identity || 'auto';
  const nation = runnerNation(runner);
  let showClub, showFlag;
  if (mode === 'club') { showClub = true; showFlag = false; }
  else if (mode === 'flag') { showClub = !nation; showFlag = !!nation; }
  else if (mode === 'both') { showClub = true; showFlag = !!nation; }
  else if (!p.international) { showClub = true; showFlag = false; }
  else if (isRelayClass(data)) { showClub = true; showFlag = !!nation; }
  else { showClub = !nation; showFlag = !!nation; }
  const clubIsNation = !!nationCode(runner?.club) && nationCode(runner?.club) === nation;
  return {
    club: showClub && !(showFlag && clubIsNation) ? String(runner?.club ?? '') : '',
    nation: showFlag ? nation : '',
    flag: showFlag ? flagUrl(nation) : '',
    logo: showClub && p.clubLogos !== false && runner?.clubLogo ? serverUrl(runner.clubLogo) : ''
  };
}

/** Identity markup: [logo] club | CODE [flag] */
export function identityHtml(runner, data, { code = true } = {}) {
  const id = identity(runner, data);
  let out = '';
  if (id.logo) out += `<img class="id-logo" src="${esc(id.logo)}" alt="">`;
  if (id.club) out += `<span class="id-club">${esc(id.club)}</span>`;
  if (id.nation && code) out += `<span class="id-code">${esc(id.nation)}</span>`;
  if (id.flag) out += `<img class="id-flag" src="${esc(id.flag)}" alt="${esc(id.nation)}">`;
  return out ? `<span class="id">${out}</span>` : '';
}

/** Find the operator's selected runner in results (by bib, then name) */
export function findRunner(results, data) {
  const list = Array.isArray(results) ? results : [];
  const bib = String(data?.runnerBib ?? '').trim();
  const name = String(data?.runnerName ?? '').trim().toLowerCase();
  return (bib && list.find(r => String(r.bib ?? '').trim() === bib))
    || (name && list.find(r => String(r.name ?? '').trim().toLowerCase() === name))
    || null;
}

/** Control label: "Finish", "Control 45" -> broadcast text */
export function controlLabel(data) {
  return broadcastControlLabel(data);
}

export const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

/** Shared by the original Classic graphics and the generated set graphics. */
export function eventLogoHtml(data) {
  const url = data?.presentation?.logoUrl;
  return url ? `<img src="${esc(serverUrl(url))}" alt="">` : '';
}
export function updateEventLogo(root, data) {
  const box = root?.querySelector('.logo');
  if (box) box.innerHTML = eventLogoHtml(data);
}
