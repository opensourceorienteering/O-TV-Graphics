import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EventInfoForm } from '../EventInfoForm';

vi.mock('../api', () => ({ call: vi.fn() }));
vi.mock('../../i18n', () => ({ t: (s: string) => s }));

const render = (presentation: object, look?: object) =>
  renderToStaticMarkup(createElement(EventInfoForm as any, {
    event: { name: 'Test', settings: { presentation } },
    setEvent: () => {}, folders: [], busy: false, onSave: () => {}, onLink: () => {}, onDefaults: () => {},
    look,
  }));
const checked = (html: string) => {
  const grid = html.slice(html.indexOf('logo-choice-grid'), html.indexOf('event-logo-file'));
  return [...grid.matchAll(/<label class="(selected)?"[^>]*>.*?<strong>([^<]+)<\/strong>/g)].filter((m) => m[1]).map((m) => m[2]);
};

describe('event logo choice', () => {
  it('offers the look\'s logo, a custom logo or none, and no OK Tyr logo', () => {
    const html = render({}, { id: 'iof', name: 'IOF', templateCount: 17, logoPreview: 'data:image/svg+xml;base64,AA' });
    expect(html).toContain('Use template logo');
    expect(html).toContain('Upload custom logo');
    expect(html).toContain('No logotype');
    expect(html).not.toMatch(/tyr/i);
    expect(html).toContain('data:image/svg+xml;base64,AA');
    expect(checked(html)).toEqual(['Use template logo']);
  });

  it('says when a look has no logo of its own', () => {
    expect(render({}, { id: 'standard', name: 'Standard', templateCount: 17 })).toContain('This look has no logo of its own');
  });

  it('shows the saved choice', () => {
    expect(checked(render({ logoMode: 'none' }))).toEqual(['No logotype']);
    expect(checked(render({ logoUrl: 'data:image/png;base64,BB' }))).toEqual(['Upload custom logo']);
    expect(checked(render({ logoUrl: '/built-in-assets/tyr-logo.png' }))).toEqual(['Use template logo']);
  });
});
