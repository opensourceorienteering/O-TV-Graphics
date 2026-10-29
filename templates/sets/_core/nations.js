/**
 * Nations: IOC / ISO 3166 alpha-3 codes and English names -> flag file (ISO alpha-2).
 * Covers IOF member federations and other nations seen at international events.
 * Flags: flag-icons (MIT), bundled in ./flags.
 */

// IOC code -> [iso2, English name, other aliases...]
const NATIONS = {
  ALB: ['al', 'Albania'], ALG: ['dz', 'Algeria', 'DZA'], AND: ['ad', 'Andorra'], ARG: ['ar', 'Argentina'],
  ARM: ['am', 'Armenia'], AUS: ['au', 'Australia'], AUT: ['at', 'Austria'], AZE: ['az', 'Azerbaijan'],
  BEL: ['be', 'Belgium'], BIH: ['ba', 'Bosnia and Herzegovina'], BLR: ['by', 'Belarus'], BOL: ['bo', 'Bolivia'],
  BRA: ['br', 'Brazil'], BUL: ['bg', 'Bulgaria', 'BGR'], CAN: ['ca', 'Canada'], CHI: ['cl', 'Chile', 'CHL'],
  CHN: ['cn', 'China'], COL: ['co', 'Colombia'], CRC: ['cr', 'Costa Rica'], CRO: ['hr', 'Croatia', 'HRV'],
  CUB: ['cu', 'Cuba'], CYP: ['cy', 'Cyprus'], CZE: ['cz', 'Czechia', 'Czech Republic'], DEN: ['dk', 'Denmark', 'DNK'],
  ECU: ['ec', 'Ecuador'], EGY: ['eg', 'Egypt'], ENG: ['gb-eng', 'England'], ESP: ['es', 'Spain'],
  EST: ['ee', 'Estonia'], FIN: ['fi', 'Finland'], FRA: ['fr', 'France'], FRO: ['fo', 'Faroe Islands'],
  GBR: ['gb', 'Great Britain', 'United Kingdom', 'UK'], GEO: ['ge', 'Georgia'], GER: ['de', 'Germany', 'DEU'],
  GHA: ['gh', 'Ghana'], GRE: ['gr', 'Greece', 'GRC'], HKG: ['hk', 'Hong Kong'], HUN: ['hu', 'Hungary'],
  INA: ['id', 'Indonesia', 'IDN'], IND: ['in', 'India'], IRI: ['ir', 'Iran', 'IRN'], IRL: ['ie', 'Ireland'],
  ISL: ['is', 'Iceland'], ISR: ['il', 'Israel'], ITA: ['it', 'Italy'], JPN: ['jp', 'Japan'],
  KAZ: ['kz', 'Kazakhstan'], KEN: ['ke', 'Kenya'], KGZ: ['kg', 'Kyrgyzstan'], KOR: ['kr', 'Korea', 'South Korea'],
  KOS: ['xk', 'Kosovo'], LAT: ['lv', 'Latvia', 'LVA'], LIE: ['li', 'Liechtenstein'], LTU: ['lt', 'Lithuania'],
  LUX: ['lu', 'Luxembourg'], MAC: ['mo', 'Macau'], MAR: ['ma', 'Morocco'], MAS: ['my', 'Malaysia', 'MYS'],
  MDA: ['md', 'Moldova'], MEX: ['mx', 'Mexico'], MGL: ['mn', 'Mongolia', 'MNG'], MKD: ['mk', 'North Macedonia'],
  MLT: ['mt', 'Malta'], MNE: ['me', 'Montenegro'], MON: ['mc', 'Monaco', 'MCO'], NED: ['nl', 'Netherlands', 'NLD'],
  NGR: ['ng', 'Nigeria', 'NGA'], NIR: ['gb-nir', 'Northern Ireland'], NOR: ['no', 'Norway'], NZL: ['nz', 'New Zealand'],
  PAK: ['pk', 'Pakistan'], PAR: ['py', 'Paraguay', 'PRY'], PER: ['pe', 'Peru'], PHI: ['ph', 'Philippines', 'PHL'],
  POL: ['pl', 'Poland'], POR: ['pt', 'Portugal', 'PRT'], PRK: ['kp', 'North Korea'], PUR: ['pr', 'Puerto Rico'],
  ROU: ['ro', 'Romania'], RSA: ['za', 'South Africa', 'ZAF'], RUS: ['ru', 'Russia'], SCO: ['gb-sct', 'Scotland'],
  SGP: ['sg', 'Singapore'], SLO: ['si', 'Slovenia', 'SVN'], SMR: ['sm', 'San Marino'], SRB: ['rs', 'Serbia'],
  SUI: ['ch', 'Switzerland', 'CHE'], SVK: ['sk', 'Slovakia'], SWE: ['se', 'Sweden'], THA: ['th', 'Thailand'],
  TPE: ['tw', 'Chinese Taipei', 'TWN'], TUN: ['tn', 'Tunisia'], TUR: ['tr', 'Türkiye', 'Turkey'], UKR: ['ua', 'Ukraine'],
  URU: ['uy', 'Uruguay', 'URY'], USA: ['us', 'United States', 'USA'], UZB: ['uz', 'Uzbekistan'], VEN: ['ve', 'Venezuela'],
  VIE: ['vn', 'Vietnam', 'VNM'], WAL: ['gb-wls', 'Wales'], ZIM: ['zw', 'Zimbabwe', 'ZWE']
};

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const LOOKUP = new Map();
for (const [ioc, [iso2, ...names]] of Object.entries(NATIONS)) {
  LOOKUP.set(fold(ioc), ioc);
  LOOKUP.set(fold(iso2), ioc);
  for (const n of names) LOOKUP.set(fold(n), ioc);
}

/** IOC code for a code or English name ("SWE", "SE", "Sweden", "DEU" -> "GER"), else '' */
export function nationCode(value) {
  if (!value) return '';
  const key = fold(value);
  if (LOOKUP.has(key)) return LOOKUP.get(key);
  // Relay teams: "Sweden 1", "SWE 2"
  const m = /^(.*?)\s+\d+$/.exec(key);
  if (m && LOOKUP.has(m[1])) return LOOKUP.get(m[1]);
  return '';
}

/** Flag image URL for a nation (any form nationCode understands), else '' */
export function flagUrl(value) {
  const ioc = nationCode(value);
  return ioc ? new URL(`./flags/${NATIONS[ioc][0]}.svg`, import.meta.url).href : '';
}

/** Country of a runner: the source's country field, else a club that is a nation (WOC-style data) */
export function runnerNation(runner) {
  return nationCode(runner?.country) || nationCode(runner?.nationality) || nationCode(runner?.club);
}
