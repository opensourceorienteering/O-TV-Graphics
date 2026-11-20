import { describe, expect, it, vi } from 'vitest';
import { createRulesVersionGate } from '../rulesVersionGate';

describe('output page and changed content rules', () => {
  it('keeps the version it started with', () => {
    const reload = vi.fn();
    const gate = createRulesVersionGate({ reload, showing: () => 0 });
    gate.version(3);
    gate.version(3);
    expect(reload).not.toHaveBeenCalled();
  });
  it('reloads when it reconnects to newer rules and shows nothing', () => {
    const reload = vi.fn();
    const gate = createRulesVersionGate({ reload, showing: () => 0 });
    gate.version(3);
    gate.version(4);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('waits until nothing is shown before reloading', () => {
    const reload = vi.fn();
    let showing = 1;
    const gate = createRulesVersionGate({ reload, showing: () => showing });
    gate.version(3);
    gate.version(4);
    expect(reload).not.toHaveBeenCalled();
    gate.check();
    expect(reload).not.toHaveBeenCalled();
    showing = 0;
    gate.check();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
