import { describe, expect, it } from 'vitest';
import { lookCards, needsAttention, searchGraphics } from '../libraryModel';
import type { OGrafTemplateInfo, TemplateSetInfo } from '../../../../shared/types/ograf';

const set = (id: string, name: string, source: 'built-in' | 'imported' = 'built-in'): TemplateSetInfo =>
  ({ id, name, source, templateCount: 0 });
const g = (id: string, name: string, setId: string, extra: Partial<OGrafTemplateInfo> = {}): OGrafTemplateInfo =>
  ({ type: 'ograf', manifestPath: '', description: '', uicolor: 0, webplayout: '', directoryName: id, setId,
     manifest: { id, name, main: 'm.js' } as any, ...extra });

const sets = [set('custom', 'Custom'), set('club', 'Club look', 'imported'), set('standard', 'Standard'), set('bold', 'Bold')];
const templates = [
  g('std-strap', 'Name strap', 'standard'), g('std-results', 'Results', 'standard', { deskWarnings: ['x'] }),
  g('club-a', 'Alpha', 'club'), g('loose', 'Studio strap', 'custom'),
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
});
