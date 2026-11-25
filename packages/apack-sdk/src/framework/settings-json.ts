import type { SettingsDefinition, SettingsProblem, SettingsSchema } from './settings-definition.ts';
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

/** No external/local-file references or nested bases; annotations contain data, not subschemas. */
function checkSettingsSchemaReferences(schema: SettingsSchema): void {
  function visit(value: unknown, root = false): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(child => visit(child)); return; }
    for (const [key, child] of Object.entries(value)) {
      if (['default', 'const', 'enum', 'examples'].includes(key)) continue;
      if (key === '$async') throw new Error('Settings schemas must use synchronous draft-07 validation; $async is unsupported');
      if (key === '$ref' && typeof child === 'string' && child !== '#' && !child.startsWith('#/')) {
        throw new Error(`Settings schemas require document-local JSON Pointer references: ${child}`);
      }
      if (key === '$id' && !root) throw new Error('Nested settings schema identifiers are unsupported; use definitions and document-local references');
      if (['properties', 'patternProperties', 'definitions', 'dependencies'].includes(key) && child && typeof child === 'object') {
        Object.values(child).forEach(entry => visit(entry));
      } else visit(child);
    }
  }
  visit(schema, true);
}

/**
 * @internal Pure zero-dependency structural and reference checks for a settings definition.
 * Full draft-07 schema compilation and defaults validation run via Ajv in `@apackdev/host`.
 */
export function _assertSettingsDefinitionStructure(definition: SettingsDefinition): void {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new Error('Settings definition must be an object');
  const allowed = new Set(['schema', 'defaults', 'title', 'description', 'form', 'access']);
  for (const key of Object.keys(definition)) if (!allowed.has(key)) throw new Error(`Unknown settings definition field "${key}"`);
  for (const key of ['title', 'description', 'form'] as const) {
    const value = definition[key];
    if (value !== undefined && (typeof value !== 'string' || (key !== 'description' && value.length === 0))) {
      throw new Error(`Settings ${key} must be ${key === 'description' ? 'a string' : 'a nonempty string'}`);
    }
  }
  if (definition.access !== undefined && !['shared', 'owner'].includes(definition.access)) throw new Error('Settings access must be shared or owner');
  const schemaProblems = _settingsJsonProblems(definition.schema);
  if (schemaProblems.length) throw new Error(`Settings schema must be JSON data: ${schemaProblems[0].message}`);
  if (definition.schema?.type !== 'object') throw new Error('Settings schema must declare an object at its root');
  checkSettingsSchemaReferences(definition.schema);
}
