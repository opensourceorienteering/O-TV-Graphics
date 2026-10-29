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
