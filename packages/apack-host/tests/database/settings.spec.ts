import { expect, it } from 'vitest';
import { storedSettings } from '../../src/database/settings.ts';

it.each([
  { value: undefined, expected: {} },
  { value: null, expected: null },
  { value: { app: { projects: 'invalid' } }, expected: { app: { projects: 'invalid' } } },
])('distinguishes absent preferences from malformed stored data: %j', ({ value, expected }) => {
  expect(storedSettings({ getAttr: () => value })).toEqual(expected);
});
