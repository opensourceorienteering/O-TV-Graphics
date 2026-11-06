/** Event label overrides. 'set' preserves the graphic family's original wording. */
const labels = {
  en: { splitShort: 'Split {n}', noResults: 'No results yet', standingsAt: 'Standings at', noStarters: 'No start list', startList: 'Start list', noSplits: 'No split times yet', finishShort: 'F', positionHistory: 'Position history', podium: 'Podium', start: 'Start', length: 'Length', climb: 'Climb', controls: 'Controls', winningTime: 'Winning time', startInterval: 'Start interval', course: 'Course', condition: 'Conditions', temperature: 'Temperature', wind: 'Wind', humidity: 'Humidity', weather: 'Weather', commentators: 'Commentators', split: 'Split', control: 'Control', toSplit: 'To split', toFinish: 'To finish', finish: 'Finish', leg: 'Leg', changeover: 'Changeover', team: 'Team' },
  sv: { splitShort: 'M{n}', noResults: 'Inga resultat ännu', standingsAt: 'Ställning vid', noStarters: 'Ingen startlista', startList: 'Startlista', noSplits: 'Inga mellantider ännu', finishShort: 'M', positionHistory: 'Positionsutveckling', podium: 'Prispall', start: 'Start', length: 'Längd', climb: 'Stigning', controls: 'Kontroller', winningTime: 'Segrartid', startInterval: 'Startintervall', course: 'Bana', condition: 'Förhållanden', temperature: 'Temperatur', wind: 'Vind', humidity: 'Luftfuktighet', weather: 'Väder', commentators: 'Kommentatorer', split: 'Mellantid', control: 'Kontroll', toSplit: 'Mot mellantid', toFinish: 'Mot mål', finish: 'Mål', leg: 'Sträcka', changeover: 'Växling', team: 'Lag' },
  nb: { splitShort: 'M{n}', noResults: 'Ingen resultater ennå', standingsAt: 'Stilling ved', noStarters: 'Ingen startliste', startList: 'Startliste', noSplits: 'Ingen mellomtider ennå', finishShort: 'M', positionHistory: 'Plasseringsutvikling', podium: 'Seierspall', start: 'Start', length: 'Lengde', climb: 'Stigning', controls: 'Poster', winningTime: 'Vinnertid', startInterval: 'Startintervall', course: 'Løype', condition: 'Forhold', temperature: 'Temperatur', wind: 'Vind', humidity: 'Luftfuktighet', weather: 'Vær', commentators: 'Kommentatorer', split: 'Mellomtid', control: 'Post', toSplit: 'Mot mellomtid', toFinish: 'Mot mål', finish: 'Mål', leg: 'Etappe', changeover: 'Veksling', team: 'Lag' },
  cs: { splitShort: 'M{n}', noResults: 'Zatím bez výsledků', standingsAt: 'Pořadí na', noStarters: 'Bez startovní listiny', startList: 'Startovní listina', noSplits: 'Zatím bez mezičasů', finishShort: 'C', positionHistory: 'Vývoj pořadí', podium: 'Stupně vítězů', start: 'Start', length: 'Délka', climb: 'Převýšení', controls: 'Kontroly', winningTime: 'Čas vítěze', startInterval: 'Startovní interval', course: 'Trať', condition: 'Podmínky', temperature: 'Teplota', wind: 'Vítr', humidity: 'Vlhkost', weather: 'Počasí', commentators: 'Komentátoři', split: 'Mezičas', control: 'Kontrola', toSplit: 'Na mezičas', toFinish: 'Do cíle', finish: 'Cíl', leg: 'Úsek', changeover: 'Předávka', team: 'Družstvo' }
};
export function eventLabels(language, defaults = {}) {
  return { ...defaults, ...(labels[language] || {}) };
}

/**
 * The timing point a graphic shows, for the class / timing point header of the IOF, ČO and other
 * sets: "Mellantid 2 Önnestad" (short "M2"; English "Split 2 Önnestad" / "Split 2").
 * Start and finish carry only their name. `words` are the graphic's labels (split, splitShort,
 * control, finish). Control names come from the data, renamed in Plan → Radio controls.
 */
export function timingPoint(data, words = {}) {
  // labels the language lacks (undefined) keep the English defaults
  const w = { split: 'Split', splitShort: 'Split {n}', control: 'Control', finish: '',
    ...Object.fromEntries(Object.entries(words).filter(([, v]) => v != null && v !== '')) };
  const code = String(data?.controlCode ?? '').trim();
  const controls = Array.isArray(data?.splitControls) ? data.splitControls : [];
  const idx = controls.findIndex(c => String(c.code) === code);
  if (!code || /^(f|finish|1000)$/i.test(code) || idx < 0) {
    const name = !code || /^(f|finish|1000)$/i.test(code) ? (w.finish || broadcastControlLabel(data)) : broadcastControlLabel(data);
    return { full: name, short: name, split: false };
  }
  const c = controls[idx];
  const raw = String(c.name ?? '').trim();
  // LiveResults names radio controls "[110] Radio 2"; a bare number becomes "Control 62"
  const name = !raw || /^\d+$/.test(raw) ? `${w.control} ${raw || Number(c.code) % 1000}` : raw;
  const n = idx + 1;
  // A control named only by its split number ("Split 2", "Mellantid 2": Plan → Radio controls,
  // automatic names) shows the number once: "Mellantid 2", not "Mellantid 2 Split 2"
  const numberOnly = /^(split|mellantid|mellomtid|mezičas|m|s)\s*\d+$/i.test(name);
  return { full: numberOnly ? `${w.split} ${n}` : `${w.split} ${n} ${name}`, short: w.splitShort.replace('{n}', n), split: true };
}

/** Markup for a timing point: both forms; fitTimingPoints() shows the short one when needed */
export function timingPointHtml(tp, esc) {
  return `<span class="tp${tp.split ? ' tp--split' : ''}"><span class="tp-full">${esc(tp.full)}</span>` +
    `<span class="tp-short">${esc(tp.short)}</span></span>`;
}

/** Show the short form ("M2") where the long one makes its header or footer overflow */
export function fitTimingPoints(root) {
  for (const tp of root.querySelectorAll('.tp')) {
    tp.classList.remove('is-short');
    const bar = tp.closest('.hdr, .ftr, .header') || tp.parentElement;
    if (!bar) continue;
    // the class name keeps its room first: shorten the timing point before the class gets "…"
    const cut = (el) => el.scrollWidth > el.clientWidth + 1;
    if (cut(bar) || [...bar.querySelectorAll('.hdr-title, .ftr-label, .h-class')].some(cut)) tp.classList.add('is-short');
  }
}

export function broadcastControlLabel(data) {
  const name = String(data?.controlName || '').trim();
  const language = data?.presentation?.language;
  const words = { sv: { Finish: 'Mål', Start: 'Start' }, nb: { Finish: 'Mål', Start: 'Start' }, cs: { Finish: 'Cíl', Start: 'Start' } };
  return words[language]?.[name || 'Finish'] || name || 'Finish';
}

/** Weather conditions as the weather service words them (English), per graphic language */
const conditions = {
  sv: {
    'Clear': 'Klart', 'Mostly clear': 'Mestadels klart', 'Partly cloudy': 'Växlande molnighet', 'Overcast': 'Mulet',
    'Fog': 'Dimma', 'Freezing fog': 'Underkyld dimma', 'Light drizzle': 'Lätt duggregn', 'Drizzle': 'Duggregn',
    'Heavy drizzle': 'Kraftigt duggregn', 'Freezing drizzle': 'Underkylt duggregn', 'Light rain': 'Lätt regn', 'Rain': 'Regn',
    'Heavy rain': 'Kraftigt regn', 'Freezing rain': 'Underkylt regn', 'Light snow': 'Lätt snöfall', 'Snow': 'Snöfall',
    'Heavy snow': 'Kraftigt snöfall', 'Snow grains': 'Kornsnö', 'Rain showers': 'Regnskurar', 'Heavy rain showers': 'Kraftiga regnskurar',
    'Snow showers': 'Snöbyar', 'Heavy snow showers': 'Kraftiga snöbyar', 'Thunderstorm': 'Åska', 'Thunderstorm with hail': 'Åska med hagel',
    'Current conditions': 'Aktuellt väder'
  },
  nb: {
    'Clear': 'Klarvær', 'Mostly clear': 'Stort sett klart', 'Partly cloudy': 'Delvis skyet', 'Overcast': 'Overskyet',
    'Fog': 'Tåke', 'Freezing fog': 'Underkjølt tåke', 'Light drizzle': 'Lett yr', 'Drizzle': 'Yr',
    'Heavy drizzle': 'Kraftig yr', 'Freezing drizzle': 'Underkjølt yr', 'Light rain': 'Lett regn', 'Rain': 'Regn',
    'Heavy rain': 'Kraftig regn', 'Freezing rain': 'Underkjølt regn', 'Light snow': 'Lett snø', 'Snow': 'Snø',
    'Heavy snow': 'Kraftig snø', 'Snow grains': 'Kornsnø', 'Rain showers': 'Regnbyger', 'Heavy rain showers': 'Kraftige regnbyger',
    'Snow showers': 'Snøbyger', 'Heavy snow showers': 'Kraftige snøbyger', 'Thunderstorm': 'Torden', 'Thunderstorm with hail': 'Torden med hagl',
    'Current conditions': 'Aktuelt vær'
  },
  cs: {
    'Clear': 'Jasno', 'Mostly clear': 'Skoro jasno', 'Partly cloudy': 'Polojasno', 'Overcast': 'Zataženo',
    'Fog': 'Mlha', 'Freezing fog': 'Mrznoucí mlha', 'Light drizzle': 'Slabé mrholení', 'Drizzle': 'Mrholení',
    'Heavy drizzle': 'Silné mrholení', 'Freezing drizzle': 'Mrznoucí mrholení', 'Light rain': 'Slabý déšť', 'Rain': 'Déšť',
    'Heavy rain': 'Silný déšť', 'Freezing rain': 'Mrznoucí déšť', 'Light snow': 'Slabé sněžení', 'Snow': 'Sněžení',
    'Heavy snow': 'Silné sněžení', 'Snow grains': 'Sněhová zrna', 'Rain showers': 'Dešťové přeháňky', 'Heavy rain showers': 'Silné dešťové přeháňky',
    'Snow showers': 'Sněhové přeháňky', 'Heavy snow showers': 'Silné sněhové přeháňky', 'Thunderstorm': 'Bouřka', 'Thunderstorm with hail': 'Bouřka s krupobitím',
    'Current conditions': 'Aktuální počasí'
  }
};

/** The condition in the graphic's language; text the operator typed themselves passes through */
export function weatherCondition(text, language) {
  const value = String(text ?? '').trim();
  return conditions[language]?.[value] ?? text;
}
