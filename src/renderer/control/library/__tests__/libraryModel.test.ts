import { describe, expect, it } from 'vitest';
import { graphicDetails, graphicTitle, lookCards, needsAttention, replacedBy, searchGraphics } from '../libraryModel';
import type { OGrafTemplateInfo, TemplateSetInfo } from '../../../../shared/types/ograf';

const set = (id: string, name: string, source: 'built-in' | 'imported' = 'built-in'): TemplateSetInfo =>
  ({ id, name, source, templateCount: 0 });
const g = (id: string, name: string, setId: string, extra: Partial<OGrafTemplateInfo> = {}): OGrafTemplateInfo =>
  ({ type: 'ograf', manifestPath: '', description: '', uicolor: 0, webplayout: '', directoryName: id, setId,
     manifest: { id, name, main: 'm.js' } as any, ...extra });

const sets = [set('custom', 'Custom'), set('club', 'Club look', 'imported'), set('standard', 'Standard'), set('bold', 'Bold')];
const live = { desk: { key: 'k', kind: 'k', label: 'K', short: 'K', params: [], required: [], live: false } } as Partial<OGrafTemplateInfo>;
const templates = [
  g('std-strap', 'Name strap', 'standard', live), g('std-results', 'Results', 'standard', { ...live, deskWarnings: ['x'] }),
  g('club-a', 'Alpha', 'club', live), g('loose', 'Studio strap', 'custom'),
];

describe('library model', () => {
  it('lists looks built-in first then imported, by name, without the custom set', () => {
    expect(lookCards(sets, templates).map((c) => c.set.id)).toEqual(['bold', 'standard', 'club']);
  });
  it('sorts each look graphics by name', () => {
    expect(lookCards(sets, templates).find((c) => c.set.id === 'standard')!.graphics.map((t) => t.manifest.id)).toEqual(['std-strap', 'std-results']);
  });
  it('gives no cards when there are no looks', () => {
    expect(lookCards([], [])).toEqual([]);
  });
  it('flags graphics outside a look and graphics with desk warnings', () => {
    expect(needsAttention(templates).map((t) => t.manifest.id)).toEqual(['std-results', 'loose']);
  });
  it('searches every look and names the look of each result', () => {
    expect(searchGraphics(templates, sets, 'STRAP').map((r) => [r.template.manifest.id, r.lookName]))
      .toEqual([['std-strap', 'Standard'], ['loose', 'Not in a look']]);
  });
  it('finds nothing for an empty search', () => {
    expect(searchGraphics(templates, sets, '  ')).toEqual([]);
  });
  it('lists a graphic id, version and author, skipping what the manifest leaves out', () => {
    const full = g('std-strap', 'Name strap', 'standard', { manifest: { id: 'std-strap', name: 'Name strap', main: 'm.js', version: '1.2.0', author: { name: 'Split Control' } } as any });
    expect(graphicDetails(full)).toEqual([['ID', 'std-strap'], ['Version', '1.2.0'], ['Author', 'Split Control']]);
    expect(graphicDetails(g('loose', 'Loose', 'custom'))).toEqual([['ID', 'loose']]);
  });
});

describe('replacements in a look', () => {
  it('names the graphic that replaces each replaced one', () => {
    const look = [g('standard-free-text', 'Free text', 'standard'), g('guest-strap', 'Guest strap', 'standard', { addition: true })];
    expect(replacedBy(look, { 'guest-strap': 'standard-free-text' })).toEqual(new Map([['standard-free-text', 'Guest strap']]));
  });
  it('ignores replacements whose graphics are not in the look', () => {
    const look = [g('standard-free-text', 'Free text', 'standard')];
    expect(replacedBy(look, { gone: 'standard-free-text', 'standard-free-text': 'missing' }).size).toBe(0);
  });
});

describe('graphic titles', () => {
  it("uses the desk label, but an added graphic's own name", () => {
    const desk = { label: 'Identity plate' } as OGrafTemplateInfo['desk'];
    expect(graphicTitle(g('standard-free-text', 'Free text', 'standard', { desk }))).toBe('Identity plate');
    expect(graphicTitle(g('guest-strap', 'Guest strap', 'standard', { desk, addition: true }))).toBe('Guest strap');
  });
});

describe('needs attention', () => {
  it('lists a look graphic Live has no entry for, but not the system test pattern', () => {
    const list = needsAttention([...templates, g('std-lower', 'Runner lower third', 'standard'), g('pattern', 'Test pattern', 'system')]);
    expect(list.map((t) => t.manifest.id)).toContain('std-lower');
    expect(list.map((t) => t.manifest.id)).not.toContain('pattern');
  });
});
