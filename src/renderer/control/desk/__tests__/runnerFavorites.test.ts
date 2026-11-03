import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SchemaField } from '../SchemaField';
vi.mock('../../i18n', () => ({ t: (s: string) => s }));
const runners = [
  { name: 'Anna Runner', club: 'OK One', className: 'D21', favourite: true },
  { name: 'Bea Runner', club: 'OK Two', className: 'D21' },
];
const render = (value?: string[]) => renderToStaticMarkup(createElement(SchemaField, {
  name: 'highlightRunners', schema: { type: 'array', v_olgrafik_control: 'runner-multi-select', v_olgrafik_default: 'favourites' },
  runnerChoices: runners, value, onChange: () => {},
}));
it('checks favourites automatically but preserves an explicit clear or different selection', () => {
  const checkboxStates = (html: string) => [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map(m => m[0].includes('checked'));
  expect(checkboxStates(render())).toEqual([true, false]);
  expect(checkboxStates(render([]))).toEqual([false, false]);
  expect(checkboxStates(render([JSON.stringify(['Bea Runner', 'OK Two'])]))).toEqual([false, true]);
});
