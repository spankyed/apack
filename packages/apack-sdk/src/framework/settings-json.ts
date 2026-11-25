import type { SettingsProblem } from './settings-definition.ts';
import { hasOwn } from '../utils/shared.ts';

/** Validate the transport/storage contract too: Ajv treats an explicit undefined as absent. */
export function _settingsJsonProblems(value: unknown): SettingsProblem[] {
  const problems: SettingsProblem[] = [];
  const ancestors = new Set<object>();
  function visit(value: unknown, path: string[]): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
    if (typeof value !== 'object' || ancestors.has(value)
      || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
      problems.push({ path, keyword: 'json', message: 'Settings values must be finite, acyclic JSON data; use reset instead of undefined' });
      return;
    }
    ancestors.add(value);
    const array = Array.isArray(value);
    if (Object.getOwnPropertySymbols(value).length) problems.push({ path, keyword: 'json', message: 'Settings cannot contain symbol keys' });
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (array && key === 'length') continue;
      const index = Number(key);
      const extra = array && (String(index) !== key || !Number.isInteger(index) || index < 0 || index >= value.length);
      if (!descriptor.enumerable || !('value' in descriptor) || extra) {
        problems.push({ path: [...path, key], keyword: 'json', message: 'Settings must contain ordinary JSON data properties' });
      } else visit(descriptor.value, [...path, key]);
    }
    if (array) {
      let index = 0;
      while (index < value.length && hasOwn(value, index)) index++;
      if (index < value.length) problems.push({ path: [...path, String(index)], keyword: 'json', message: 'Settings arrays cannot contain holes' });
    }
    ancestors.delete(value);
  }
  visit(value, []);
  return problems;
}
