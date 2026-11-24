import { describe, expect, it } from 'vitest';
import { deskEntriesForLook, resolveDeskDeclaration } from '../deskDeclaration';
import type { OGrafTemplateInfo } from '../types/ograf';
import type { OGrafManifest } from '../types/ograf';

const manifest = (extra: Record<string, unknown> = {}) => ({
  id: 'custom', name: 'Custom', main: 'graphic.js', $schema: '',
  supportsRealTime: true, supportsNonRealTime: false, ...extra
}) as OGrafManifest;

describe('manifest desk declarations', () => {
  it('keeps legacy kind defaults and fallback IDs', () => {
    expect(resolveDeskDeclaration(manifest({ v_olgrafik_kind: 'results' })).desk).toMatchObject({ key: 'results', previewData: 'results', live: true });
    expect(resolveDeskDeclaration(manifest({ id: 'countdown-timer' })).desk?.key).toBe('timer');
    expect(resolveDeskDeclaration(manifest()).desk).toBeUndefined();
  });
  it('accepts a new graphic built from standard blocks', () => {
    const result = resolveDeskDeclaration(manifest({
      v_olgrafik_kind: 'relay-overview', schema: { properties: { title: { type: 'string' } } },
      v_olgrafik_desk: { label: 'Relay overview', inputs: ['class', 'page'], required: ['class'], fields: ['title'], feeds: ['timing'], behaviours: ['holdOnAir', 'titleFromClass'], previewData: 'results' }
    }));
    expect(result.warnings).toEqual([]);
    expect(result.desk).toMatchObject({ key: 'relay-overview', short: 'Relay overview', live: true, params: ['class', 'page'] });
  });
  it('supports partial overrides and explicitly clearing defaults', () => {
    const result = resolveDeskDeclaration(manifest({ v_olgrafik_kind: 'results', v_olgrafik_desk: { label: 'Final standings', fields: [], behaviours: [], previewData: null } }));
    expect(result.warnings).toEqual([]);
    expect(result.desk).toMatchObject({ key: 'results', label: 'Final standings', fields: [], behaviours: [], previewData: undefined });
  });
  it.each([null, [], 'invalid', { feeds: ['gps'] }, { inputs: ['class', 'class'] }, { previewData: 'gps' }, { surprise: true }, { inputs: [], required: ['class'] }, { inputs: [], required: [], behaviours: ['freeze'] }, { fields: ['missing'] }])('falls back safely for malformed declaration %j', declaration => {
    const result = resolveDeskDeclaration(manifest({ v_olgrafik_kind: 'results', v_olgrafik_desk: declaration }));
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.desk?.label).toBe('Results table');
  });
  it('ignores invalid new entries without hiding the graphic', () => {
    const result = resolveDeskDeclaration(manifest({ v_olgrafik_desk: { label: 'Unknown', feeds: ['gps'] } }));
    expect(result.desk).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it('accepts timing plugin fields a graphic needs, and rejects malformed ones', () => {
    const ok = resolveDeskDeclaration(manifest({
      v_olgrafik_kind: 'gps-board',
      v_olgrafik_desk: { label: 'GPS board', inputs: ['class'], feeds: ['timing'], sourceFields: ['results[].x.gps-track.speedKmh', 'x.gps-track.sponsor'] }
    }));
    expect(ok.warnings).toEqual([]);
    expect(ok.desk?.sourceFields).toEqual(['results[].x.gps-track.speedKmh', 'x.gps-track.sponsor']);
    for (const bad of [['speedKmh'], ['results[].x.GPS.speed'], 'x.gps.speed', ['x.gps']]) {
      const result = resolveDeskDeclaration(manifest({ v_olgrafik_kind: 'results', v_olgrafik_desk: { sourceFields: bad } }));
      expect(result.warnings.join(' ')).toContain('sourceFields');
      expect(result.desk?.sourceFields).toBeUndefined();
    }
  });
});

describe('desk entries for a look', () => {
  const info = (id: string, kind: string) => ({ manifest: manifest({ id, name: id, v_olgrafik_kind: kind }), setId: 'iof' }) as unknown as OGrafTemplateInfo;
  const look = [info('iof-free-text', 'free-text'), info('iof-results', 'results'), info('guest-strap', 'guest-strap-kind')];

  it('gives a replaced graphic\'s desk key to the graphic that replaces it', () => {
    const entries = deskEntriesForLook(look, { 'guest-strap': 'iof-free-text' });
    expect(entries.get('free-text')?.template.manifest.id).toBe('guest-strap');
    expect([...entries.values()].some(e => e.template.manifest.id === 'iof-free-text')).toBe(false);
    expect(entries.get('results')?.template.manifest.id).toBe('iof-results');
  });
  it('without replacements, the first graphic of a key wins', () => {
    const entries = deskEntriesForLook([...look, info('second-free-text', 'free-text')], {});
    expect(entries.get('free-text')?.template.manifest.id).toBe('iof-free-text');
  });
  it('a replacement whose target is not in the look keeps its own key and leaves the others alone', () => {
    const entries = deskEntriesForLook([info('iof-results', 'results'), info('x', 'free-text')], { x: 'gone' });
    expect(entries.get('free-text')?.template.manifest.id).toBe('x');
  });
  it('ignores a replacement made by a graphic that is itself replaced (chains and cycles)', () => {
    const three = [info('iof-free-text', 'free-text'), info('b', 'results'), info('a', 'guest-strap-kind')];
    // a replaces b, b replaces iof-free-text: b is gone, so its own replacement is ignored
    const chain = deskEntriesForLook(three, { b: 'iof-free-text', a: 'b' });
    expect(chain.get('results')?.template.manifest.id).toBe('a');
    expect(chain.get('free-text')?.template.manifest.id).toBe('iof-free-text');
    const cycle = deskEntriesForLook(three, { a: 'b', b: 'a' });
    expect(cycle.get('results')?.template.manifest.id).toBe('b');
  });
});

describe('field map in the desk declaration', () => {
  it('reports a bad field map as a warning, so the graphic shows under Needs attention', () => {
    const m = manifest({ v_olgrafik_kind: 'results', schema: { properties: { headline: { type: 'string' } } }, v_olgrafik_fieldMap: { headline: 'shoeSize' } });
    const result = resolveDeskDeclaration(m);
    expect(result.desk).toBeDefined();
    expect(result.warnings).toEqual([expect.stringMatching(/^v_olgrafik_fieldMap: .*shoeSize/)]);
    expect(resolveDeskDeclaration(manifest({ v_olgrafik_kind: 'results', schema: { properties: { headline: {} } }, v_olgrafik_fieldMap: { headline: 'runnerName' } })).warnings).toEqual([]);
  });
});
