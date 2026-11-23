/**
 * OGraf v1 manifest validation, including the optional fields added to v1 during 2025-11..2026-06
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger, getLogger: () => logger };
});
import fs from 'fs';
import path from 'path';
import { OGrafValidator } from '../OGrafValidator';

const validator = new OGrafValidator();
const TEMPLATES_DIR = path.resolve(__dirname, '../../../../templates');

const minimal = {
  $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
  id: 'minimal',
  name: 'Minimal',
  main: 'graphic.mjs',
  supportsRealTime: true,
  supportsNonRealTime: false
};

describe('OGrafValidator', () => {
  // Every .ograf.json below templates/ (template sets live in templates/sets/<set>/<graphic>/)
  const manifests = (fs.readdirSync(TEMPLATES_DIR, { recursive: true }) as string[])
    .filter(f => f.endsWith('.ograf.json'))
    .map(f => path.join(TEMPLATES_DIR, f));

  it('finds the bundled templates', () => {
    expect(manifests.length).toBeGreaterThanOrEqual(39); // the generated set graphics
  });

  it.each(manifests.map(m => [path.basename(m), m]))('accepts bundled manifest %s', (_name, file) => {
    const result = validator.validate(JSON.parse(fs.readFileSync(file, 'utf8')));
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts a spec-minimal manifest (version and schema are optional)', () => {
    expect(validator.validate(minimal).valid).toBe(true);
  });

  it('requires supportsNonRealTime like the official schema', () => {
    const { supportsNonRealTime: _omit, ...rest } = minimal;
    expect(validator.validate(rest).valid).toBe(false);
  });

  it('accepts the 2026 optional fields', () => {
    const result = validator.validate({
      ...minimal,
      stepCount: -1,
      thumbnails: [{ file: 'thumb.png', resolution: { width: 1920, height: 1080 } }],
      actionDurations: [{ type: 'playAction', duration: 500 }, { type: 'stopAction', duration: -1 }],
      renderRequirements: [{ engine: [{ type: 'CEF', version: { min: '139' } }] }],
      v_olgrafik: { anything: true }
    });
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('still rejects unknown non-vendor fields', () => {
    expect(validator.validate({ ...minimal, notInSpec: 1 }).valid).toBe(false);
  });
});

describe('OGrafValidator against official EBU example shapes', () => {
  it('accepts a non-semver version and a null custom action schema (ebu/ograf v1/examples)', () => {
    const result = validator.validate({
      ...minimal,
      version: '0',
      customActions: [{ id: 'highlight', name: 'Highlight', description: 'No parameters', schema: null }]
    });
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('OGrafValidator follows the official EBU schema exactly', () => {
  const base = {
    $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
    id: 'com.example.lower-third', name: 'Lower third', main: 'graphic.mjs', supportsRealTime: true, supportsNonRealTime: false,
  };
  const validator = new OGrafValidator();
  it.each([
    ['a main file without .js', { main: 'graphic' }],
    ['a schema with no fields', { schema: { type: 'object', properties: {} } }],
    ['internet access as ideal only', { renderRequirements: [{ accessToPublicInternet: { ideal: true } }] }],
    ['action durations', { actionDurations: [{ type: 'playAction', duration: 500, steps: [{ step: 0, duration: 800 }] }, { type: 'stopAction', duration: 300 }] }],
    ['thumbnails', { thumbnails: [{ file: 'thumb.png', resolution: { width: 640, height: 360 } }] }],
    ['an engine requirement', { renderRequirements: [{ engine: [{ type: 'CEF', version: { min: '139' } }] }] }],
  ])('accepts %s', (_name, extra) => {
    expect(validator.validate({ ...base, ...extra })).toEqual({ valid: true });
  });
  it.each([
    ['an unknown field without v_', { playbackMode: 'solo' }],
    ['a thumbnail resolution missing its height', { thumbnails: [{ file: 't.png', resolution: { width: 640 } }] }],
    ['an author field that is not in the spec', { author: { name: 'A', phone: '1' } }],
    ['a wrong $schema', { $schema: 'https://example.com/schema.json' }],
    ['a custom action without a name', { customActions: [{ id: 'x' }] }],
  ])('rejects %s', (_name, extra) => {
    expect(validator.validate({ ...base, ...extra }).valid).toBe(false);
  });
});
