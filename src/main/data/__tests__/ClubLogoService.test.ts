import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../utils/logger', () => {
  const l = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: l, getLogger: () => l };
});

import { ClubLogoService, normaliseClubName } from '../ClubLogoService';

describe('ClubLogoService (bundled + manual logos)', () => {
  let bundled: string, user: string;
  beforeEach(() => {
    bundled = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-'));
    user = fs.mkdtempSync(path.join(os.tmpdir(), 'user-'));
    const set = path.join(bundled, 'eventor.orientering.se');
    fs.mkdirSync(path.join(set, 'logos'), { recursive: true });
    fs.writeFileSync(path.join(set, 'logos', '321.png'), 'png');
    fs.writeFileSync(path.join(set, 'logos', '654.png'), 'png');
    fs.writeFileSync(path.join(set, 'index.json'), JSON.stringify({
      source: 'https://eventor.orientering.se', downloadedAt: 1793000000000, logoType: 'LargeIcon',
      organisations: [
        { id: '321', name: 'OK Linné', shortName: 'OK Linné', file: '321.png' },
        { id: '654', name: 'Järfälla OK', shortName: 'Järfälla', file: '654.png' },
        { id: '999', name: 'No Logo IF' }
      ]
    }));
  });
  afterEach(() => {
    fs.rmSync(bundled, { recursive: true, force: true });
    fs.rmSync(user, { recursive: true, force: true });
  });

  it('normalises club names for matching', () => {
    expect(normaliseClubName('OK Linné 2')).toBe('ok linne'); // relay team suffix and accents
    expect(normaliseClubName('  Järfälla  OK ')).toBe('jarfalla ok');
  });

  it('matches clubs to the logos shipped with the app', () => {
    const service = new ClubLogoService(bundled, user);
    expect(service.lookup('OK Linné')).toBe('/club-logos/bundled/eventor.orientering.se/logos/321.png');
    expect(service.lookup('ok linne 3')).toBe('/club-logos/bundled/eventor.orientering.se/logos/321.png');
    expect(service.lookup('Järfälla')).toBe('/club-logos/bundled/eventor.orientering.se/logos/654.png'); // short name
    expect(service.lookup('No Logo IF')).toBeUndefined();
    expect(service.status()).toMatchObject({ bundled: [{ folder: 'eventor.orientering.se', clubs: 3, logos: 2 }], manualLogos: 0 });
  });

  it('prefers logos added by hand', () => {
    const service = new ClubLogoService(bundled, user);
    fs.writeFileSync(path.join(user, 'manual', 'OK Linné.svg'), '<svg/>');
    expect(service.status().manualLogos).toBe(1);
    expect(service.lookup('OK Linne')).toBe('/club-logos/manual/OK%20Linn%C3%A9.svg');
  });

  it('works without bundled logos', () => {
    const service = new ClubLogoService(path.join(bundled, 'missing'), user);
    expect(service.lookup('OK Linné')).toBeUndefined();
    expect(service.status().bundled).toEqual([]);
  });
});
