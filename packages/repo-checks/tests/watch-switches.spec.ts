// The two switches over how a run is bounded, read from the environment by `scripts/lib/step-budgets.ts`: the watchdog is
// on unless set to off, the ceiling held to its size unless set to loose, and each refuses any other value, since a
// misspelt setting that did nothing would look like it had.
import { describe, expect, it } from 'vitest';
import { ceilingSetting, watchdogEnabled } from '../../../scripts/lib/step-budgets.ts';

describe('APACK_WATCHDOG', () => {
  it.each([[undefined, true], ['on', true], ['off', false]])('reads %s', (value, enabled) => {
    expect(watchdogEnabled(value === undefined ? {} : { APACK_WATCHDOG: value })).toBe(enabled);
  });

  it('refuses a value that is neither', () => {
    expect(() => watchdogEnabled({ APACK_WATCHDOG: 'false' })).toThrow(/set it to off/);
  });
});

describe('APACK_CEILING', () => {
  it.each([[undefined, 'on'], ['on', 'on'], ['loose', 'loose']])('reads %s', (value, setting) => {
    expect(ceilingSetting(value === undefined ? {} : { APACK_CEILING: value })).toBe(setting);
  });

  it('refuses a value that is neither, the old off included', () => {
    expect(() => ceilingSetting({ APACK_CEILING: 'off' })).toThrow(/set it to loose/);
  });
});
