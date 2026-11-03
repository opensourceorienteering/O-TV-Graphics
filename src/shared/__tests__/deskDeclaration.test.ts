import { describe, expect, it } from 'vitest';
import { resolveDeskDeclaration } from '../deskDeclaration';
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
});
