import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SettingsDefinition } from '@apackdev/sdk/framework';
import { compileSettingsDefinition } from '../../../src/features/settings/compile.ts';

const features = JSON.parse(readFileSync(new URL('../../../../default-setup/apack.json', import.meta.url), 'utf8')).features as Record<string, { settings: SettingsDefinition }>;

/** Protect the real constraints preserved when the shipped feature schemas moved out of executable modules. */
describe('shipped feature settings declarations', () => {
  it('validates every explicit baseline as JSON data', () => {
    expect(Object.keys(features)).toHaveLength(11);
    for (const feature of Object.values(features)) {
      expect(compileSettingsDefinition(feature.settings).validate(feature.settings.defaults)).toEqual([]);
    }
  });

  it.each([
    ['code', ['maxTerminals'], -1],
    ['code', ['maxTerminals'], 1.5],
    ['code', ['autoFetchIntervalSeconds'], 59],
    ['code', ['baseDirectory'], 1],
    ['code', ['cliPaths'], { shell: 1 }],
    ['code', ['terminalScripts'], [{ id: 'x', label: 'X' }]],
    ['database', ['hotkeys'], { executeQuery: { key: 'Enter', modifiers: [1] } }],
    ['logs', ['maxLogs'], 99],
    ['logs', ['maxLogs'], 10001],
    ['notes', ['tasklistPanelPosition'], 'center'],
    ['threads', ['recentThreadsSortOrder'], 'unknown'],
    ['threads', ['recentThreadsLimit'], -1],
    ['threads', ['recordingLimitMinutes'], 0],
    ['threads', ['recordingLimitMinutes'], 61],
    ['threads', ['chat', 'modes'], [{ id: 'x', name: 'X', description: 'Mode', extra: true }]],
    ['library', ['tags'], [{ name: 'Tag', color: false }]],
  ] satisfies Array<[string, string[], unknown]>)('refuses %s.%s = %j', (featureId, path, value) => {
    const definition = features[featureId].settings;
    const defaults = structuredClone(definition.defaults);
    let parent = defaults;
    for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
    parent[path.at(-1)!] = value;
    expect(compileSettingsDefinition(definition).validate(defaults).length).toBeGreaterThan(0);
  });

  it('preserves nullable directories and optional tag colors', () => {
    const code = features.code.settings;
    expect(compileSettingsDefinition(code).validate({ ...code.defaults, baseDirectory: null })).toEqual([]);
    expect(compileSettingsDefinition(code).validate({ ...code.defaults, baseDirectory: '/tmp' })).toEqual([]);
    const library = features.library.settings;
    expect(compileSettingsDefinition(library).validate({ ...library.defaults, tags: [{ name: 'Tag' }] })).toEqual([]);
  });
});
