/**
 * The club name library: what graphics call a club, kept in the app settings (config.json)
 * so every event uses it. Keyed by the club name as the data source sends it
 * ("IFK Göteborg Orientering" -> "IFK Göteborg").
 *
 * Graphics use, in order: this library, the short name from the downloaded club lists
 * (club-logos/<eventor>/index.json, read-only), the name as sent.
 */

import { getConfig, saveConfig } from '../utils/config';
import { getClubLogoService } from './ClubLogoService';
import type { ClubNameRow } from '../../shared/types/event';

export function clubNameLibrary(): Record<string, string> {
  try {
    return getConfig().clubNames ?? {};
  } catch {
    return {};
  }
}

/** Add, change or (with an empty value) remove names. Returns the library. */
export async function setClubNames(updates: Record<string, string>): Promise<Record<string, string>> {
  const config = getConfig();
  const library = { ...(config.clubNames ?? {}) };
  for (const [rawName, rawValue] of Object.entries(updates ?? {})) {
    const name = String(rawName ?? '').trim();
    const value = String(rawValue ?? '').trim();
    if (!name) continue;
    if (value) library[name] = value;
    else delete library[name];
  }
  await saveConfig({ ...config, clubNames: library });
  return library;
}

/** Rows for review: each club with its automatic name and the library's name, sorted */
export function clubNameRows(clubs: Map<string, number>): ClubNameRow[] {
  const library = clubNameLibrary();
  const service = getClubLogoService();
  return [...clubs]
    .map(([name, runners]) => ({
      name,
      runners,
      automatic: service?.shortName(name) ?? name,
      ...(library[name] ? { override: library[name] } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

/** Every club in the library (runner counts are 0: the library is not tied to an event) */
export function libraryRows(): ClubNameRow[] {
  return clubNameRows(new Map(Object.keys(clubNameLibrary()).map((name) => [name, 0])));
}
