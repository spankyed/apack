import { afterEach, expect, it, vi } from 'vitest';
import { formatMessageTime } from '../../../src/features/threads/fe/chat/message-time.ts';

const NativeFormatter = Intl.DateTimeFormat;
const options = { hour: '2-digit', minute: '2-digit' } as const;
afterEach(async () => { await Promise.resolve(); vi.restoreAllMocks(); });

it('shares one formatter within a batch and resolves locale/timezone again for the next', async () => {
  const environments = [
    ['en-US', 'America/New_York'], ['en-GB', 'Europe/London'],
    ['ar-EG', 'Asia/Kathmandu'], ['ja-JP', 'Australia/Lord_Howe'],
  ] as const;
  const dates = [
    '2025-03-09T06:59:00Z', '2025-03-09T07:01:00Z',
    '2025-11-02T05:59:00Z', '2025-11-02T06:01:00Z',
    '2025-10-04T15:29:00Z', '2025-10-04T15:31:00Z',
  ].map(value => new Date(value));
  let environment = environments[0] as typeof environments[number];
  const create = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (_locales, settings) {
    return new NativeFormatter(environment[0], { ...settings, timeZone: environment[1] });
  });
  for (const next of environments) {
    environment = next;
    const expected = new NativeFormatter(environment[0], { ...options, timeZone: environment[1] });
    create.mockClear();
    for (const date of dates) expect(formatMessageTime(date)).toBe(expected.format(date));
    expect(create).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  }
});

it('preserves Date invalid-value behavior', () => {
  const invalid = new Date(NaN);
  expect(formatMessageTime(invalid)).toBe(invalid.toLocaleTimeString([], options));
});
