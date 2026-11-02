import { describe, it, expect } from 'vitest';
import { logoModeOf, presentationForGraphics } from '../branding';

describe('event logo', () => {
  it('defaults to the look\'s own logo', () => {
    expect(logoModeOf(undefined)).toBe('template');
    expect(logoModeOf({})).toBe('template');
  });

  it('keeps what older events showed', () => {
    // the retired built-in logos now mean the look's own logo
    expect(logoModeOf({ logoUrl: '/built-in-assets/tyr-logo.png' })).toBe('template');
    expect(logoModeOf({ logoUrl: '/built-in-assets/iof-logo.svg' })).toBe('template');
    expect(logoModeOf({ logoUrl: 'data:image/png;base64,AAA' })).toBe('custom');
  });

  it('follows the choice, keeping an uploaded logo for later', () => {
    expect(logoModeOf({ logoMode: 'none', logoUrl: 'data:image/png;base64,AAA' })).toBe('none');
    expect(logoModeOf({ logoMode: 'template', logoUrl: 'data:image/png;base64,AAA' })).toBe('template');
    // custom without a logo falls back to the look's own
    expect(logoModeOf({ logoMode: 'custom' })).toBe('template');
  });

  it('gives graphics the uploaded logo only when it is chosen', () => {
    expect(presentationForGraphics({ logoMode: 'custom', logoUrl: '/assets/a.png', logoPlate: true }))
      .toMatchObject({ logoMode: 'custom', logoUrl: '/assets/a.png', logoPlate: true });
    const template = presentationForGraphics({ logoMode: 'template', logoUrl: '/assets/a.png', logoPlate: true });
    expect(template).toMatchObject({ logoMode: 'template' });
    expect(template.logoUrl).toBeUndefined();
    expect(template.logoPlate).toBeUndefined();
    expect(presentationForGraphics({ logoMode: 'none', logoUrl: '/assets/a.png' }).logoUrl).toBeUndefined();
  });
});
