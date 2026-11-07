// The two switches over how a run is bounded, read from the environment by `scripts/lib/step-budgets.ts`: each is
// on unless set to off, and refuses any other value, since a misspelt `off` that did nothing would look like it had.
import { describe, expect, it } from 'vitest';
import { ceilingEnabled, watchdogEnabled } from '../../../scripts/lib/step-budgets.ts';

describe('APACK_WATCHDOG', () => {
  it.each([[undefined, true], ['on', true], ['off', false]])('reads %s', (value, enabled) => {
    expect(watchdogEnabled(value === undefined ? {} : { APACK_WATCHDOG: value })).toBe(enabled);
  });

  it('refuses a value that is neither', () => {
    expect(() => watchdogEnabled({ APACK_WATCHDOG: 'false' })).toThrow(/set it to off/);
  });
});

describe('APACK_CEILING', () => {
  it.each([[undefined, true], ['on', true], ['off', false]])('reads %s', (value, enabled) => {
    expect(ceilingEnabled(value === undefined ? {} : { APACK_CEILING: value })).toBe(enabled);
  });

  it('refuses a value that is neither', () => {
    expect(() => ceilingEnabled({ APACK_CEILING: '0' })).toThrow(/set it to off/);
  });
});
