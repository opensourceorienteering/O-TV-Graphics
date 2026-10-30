import { describe, expect, it } from 'vitest';
import { DESK_TEMPLATES, orderDeskTemplates } from '../desk';

describe('orderDeskTemplates', () => {
  const keys = (list: { key: string }[]) => list.map((t) => t.key);

  it('keeps the default order when the event has none', () => {
    expect(keys(orderDeskTemplates(DESK_TEMPLATES))).toEqual(keys(DESK_TEMPLATES));
  });

  it("follows the event's order and keeps graphics missing from it after, in default order", () => {
    const list = orderDeskTemplates(DESK_TEMPLATES, ['results', 'runner-identity', 'gone-in-this-version']);
    expect(keys(list).slice(0, 2)).toEqual(['results', 'runner-identity']);
    const rest = keys(DESK_TEMPLATES).filter((k) => k !== 'results' && k !== 'runner-identity');
    expect(keys(list).slice(2)).toEqual(rest);
    expect(list).toHaveLength(DESK_TEMPLATES.length);
  });
});
