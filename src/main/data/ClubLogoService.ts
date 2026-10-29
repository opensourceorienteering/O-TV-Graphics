/**
 * Club logos for graphics.
 *
 *  - Bundled: club-logos/<eventor host>/ (index.json + logos/) ships with the app. Maintainers
 *    refresh it with `npm run logos:fetch` before a release (cleared with SOFT), so users never
 *    fetch logos from Eventor themselves and logos only change with a new build.
 *  - Manual: DATAROOT/club-logos/manual/<Club name>.png (or .svg/.jpg/.webp) added by the
 *    operator; these win over bundled logos.
 *
 * Graphics get result.clubLogo = "/club-logos/bundled/..." or "/club-logos/manual/...", matched
 * on the club name (name, short name or media name; case, accents and relay team numbers ignored).
 */

import fs from 'fs';
import path from 'path';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/** Maintainer-only settings read by scripts/fetch-club-logos.js (config.json "eventor") */
export interface EventorLogoSettings {
  baseUrl?: string;
  apiKey?: string;
  /** Maintainer-only API keys for bundled logo downloads, keyed by se/no/au. */
  apiKeys?: Partial<Record<'se' | 'no' | 'au', string>>;
}

export interface OrganisationEntry {
  id: string;
  name: string;
  shortName?: string;
  mediaName?: string;
  country?: string;
  type?: string;
  /** File name in logos/ when the club has a logo */
  file?: string;
}

export interface ClubLogoIndex {
  source: string;
  downloadedAt: number;
  logoType: string;
  organisations: OrganisationEntry[];
}

export interface BundledLogoSet {
  folder: string;
  source: string;
  downloadedAt: number;
  clubs: number;
  logos: number;
}

export interface ClubLogoStatus {
  /** Folder for logos added by hand */
  folder: string;
  bundled: BundledLogoSet[];
  manualLogos: number;
}

const IMAGE = ['.png', '.svg', '.jpg', '.jpeg', '.webp', '.gif'];

/** Comparable club name: lower case, no accents, no punctuation, no relay team number */
export function normaliseClubName(name: string): string {
  return String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+\d+$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const webPath = (rel: string) => `/club-logos/${rel.split('/').map(encodeURIComponent).join('/')}`;

export class ClubLogoService {
  private readonly manualDir: string;
  private readonly bundled: BundledLogoSet[] = [];
  private byName = new Map<string, string>();
  private manual = new Map<string, string>();
  private manualScannedAt = 0;

  constructor(private readonly bundledDir: string, userDir: string) {
    this.manualDir = path.join(userDir, 'manual');
    try {
      fs.mkdirSync(this.manualDir, { recursive: true });
    } catch (error) {
      logger.warn('Cannot create the manual club logo folder', { folder: this.manualDir, error: String(error) });
    }
    this.loadBundled();
  }

  getBundledDir(): string { return this.bundledDir; }
  getManualDir(): string { return this.manualDir; }

  private loadBundled(): void {
    if (!fs.existsSync(this.bundledDir)) {
      logger.info('No bundled club logos', { folder: this.bundledDir });
      return;
    }
    for (const entry of fs.readdirSync(this.bundledDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const indexPath = path.join(this.bundledDir, entry.name, 'index.json');
      try {
        const index: ClubLogoIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        let logos = 0;
        for (const o of index.organisations ?? []) {
          if (!o.file) continue;
          logos++;
          for (const n of [o.name, o.shortName, o.mediaName]) {
            const key = n ? normaliseClubName(n) : '';
            if (key && !this.byName.has(key)) this.byName.set(key, `bundled/${entry.name}/logos/${o.file}`);
          }
        }
        this.bundled.push({ folder: entry.name, source: index.source, downloadedAt: index.downloadedAt, clubs: index.organisations?.length ?? 0, logos });
      } catch (error) {
        logger.warn('Unreadable club logo index', { indexPath, error: String(error) });
      }
    }
    logger.info('Bundled club logos loaded', { sets: this.bundled.map(b => `${b.folder}: ${b.logos}`) });
  }

  private scanManual(): void {
    // Cheap rescan at most every 10 s so logos dropped in by hand show up without a restart
    if (Date.now() - this.manualScannedAt < 10_000) return;
    this.manualScannedAt = Date.now();
    this.manual.clear();
    try {
      for (const f of fs.readdirSync(this.manualDir)) {
        const ext = path.extname(f).toLowerCase();
        if (IMAGE.includes(ext)) this.manual.set(normaliseClubName(path.basename(f, ext)), `manual/${f}`);
      }
    } catch {
      // no manual folder: no manual logos
    }
  }

  /** Web path of a club's logo, or undefined */
  lookup(club: string | undefined): string | undefined {
    if (!club) return undefined;
    this.scanManual();
    const key = normaliseClubName(club);
    const rel = this.manual.get(key) ?? this.byName.get(key);
    return rel ? webPath(rel) : undefined;
  }

  status(): ClubLogoStatus {
    this.manualScannedAt = 0;
    this.scanManual();
    return { folder: this.manualDir, bundled: [...this.bundled], manualLogos: this.manual.size };
  }
}

let instance: ClubLogoService | null = null;

export function initClubLogoService(bundledDir: string, userDir: string): ClubLogoService {
  instance = new ClubLogoService(bundledDir, userDir);
  return instance;
}

/** The service, or null before startup finished (lookups then simply find nothing) */
export function getClubLogoService(): ClubLogoService | null {
  return instance;
}
