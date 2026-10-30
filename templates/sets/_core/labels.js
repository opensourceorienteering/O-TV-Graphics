/** Event label overrides. 'set' preserves the graphic family's original wording. */
const labels = {
  en: { noResults: 'No results yet', standingsAt: 'Standings at', noStarters: 'No start list', startList: 'Start list', noSplits: 'No split times yet', finishShort: 'F', positionHistory: 'Position history', podium: 'Podium', start: 'Start', length: 'Length', climb: 'Climb', controls: 'Controls', winningTime: 'Winning time', startInterval: 'Start interval', course: 'Course', condition: 'Conditions', temperature: 'Temperature', wind: 'Wind', humidity: 'Humidity', weather: 'Weather', commentators: 'Commentators', split: 'Split', control: 'Control', toSplit: 'To split', toFinish: 'To finish', finish: 'Finish' },
  sv: { noResults: 'Inga resultat ännu', standingsAt: 'Ställning vid', noStarters: 'Ingen startlista', startList: 'Startlista', noSplits: 'Inga mellantider ännu', finishShort: 'M', positionHistory: 'Positionsutveckling', podium: 'Prispall', start: 'Start', length: 'Längd', climb: 'Stigning', controls: 'Kontroller', winningTime: 'Segrartid', startInterval: 'Startintervall', course: 'Bana', condition: 'Förhållanden', temperature: 'Temperatur', wind: 'Vind', humidity: 'Luftfuktighet', weather: 'Väder', commentators: 'Kommentatorer', split: 'Mellantid', control: 'Kontroll', toSplit: 'Mot mellantid', toFinish: 'Mot mål', finish: 'Mål' },
  nb: { noResults: 'Ingen resultater ennå', standingsAt: 'Stilling ved', noStarters: 'Ingen startliste', startList: 'Startliste', noSplits: 'Ingen mellomtider ennå', finishShort: 'M', positionHistory: 'Plasseringsutvikling', podium: 'Seierspall', start: 'Start', length: 'Lengde', climb: 'Stigning', controls: 'Poster', winningTime: 'Vinnertid', startInterval: 'Startintervall', course: 'Løype', condition: 'Forhold', temperature: 'Temperatur', wind: 'Vind', humidity: 'Luftfuktighet', weather: 'Vær', commentators: 'Kommentatorer', split: 'Mellomtid', control: 'Post', toSplit: 'Mot mellomtid', toFinish: 'Mot mål', finish: 'Mål' },
  cs: { noResults: 'Zatím bez výsledků', standingsAt: 'Pořadí na', noStarters: 'Bez startovní listiny', startList: 'Startovní listina', noSplits: 'Zatím bez mezičasů', finishShort: 'C', positionHistory: 'Vývoj pořadí', podium: 'Stupně vítězů', start: 'Start', length: 'Délka', climb: 'Převýšení', controls: 'Kontroly', winningTime: 'Čas vítěze', startInterval: 'Startovní interval', course: 'Trať', condition: 'Podmínky', temperature: 'Teplota', wind: 'Vítr', humidity: 'Vlhkost', weather: 'Počasí', commentators: 'Komentátoři', split: 'Mezičas', control: 'Kontrola', toSplit: 'Na mezičas', toFinish: 'Do cíle', finish: 'Cíl' }
};
export function eventLabels(language, defaults = {}) {
  return { ...defaults, ...(labels[language] || {}) };
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
