// @slow: each case builds a TypeScript program over generated settings modules, which is the subject rather than a detail
import { buildSync } from 'esbuild';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { execFileWhileWorking } from '../../../src/progress.ts';
import { setupPackFixture, dependency, facade, generatePackFiles, manifest, root, write, writeSurfaceState } from './_support/pack.ts';
import { typecheck } from './_support/typecheck.ts';

setupPackFixture();

describe('generated settings compile', () => {
  it('derives pack group values from schemas, preserving enums, optional fields and local references', async () => {
    const files = await generatePackFiles(manifest({ extensions: { settings: {
      other: {
        schema: { type: 'object', additionalProperties: false,
          definitions: { label: { type: 'number' } },
          properties: { label: { $ref: '#/definitions/label' } }, required: ['label'],
        },
        defaults: { label: 1 },
      },
      assistant: {
        title: 'Assistant preferences',
        schema: {
          type: 'object', additionalProperties: false,
          definitions: { label: { type: 'string' } },
          properties: {
            mode: { type: 'string', enum: ['quick', 'thorough'] },
            limit: { type: 'number' },
            label: { $ref: '#/definitions/label' },
            optional: { type: 'boolean' },
            nullable: { type: ['string', 'null'] },
            labels: { type: 'object', additionalProperties: { type: 'string' } },
          },
          required: ['mode', 'limit', 'label', 'nullable', 'labels'],
        },
        defaults: { mode: 'quick', limit: 10, label: 'Default', nullable: null, labels: {} },
      },
    } } }), { packRoot: root });
    write('src/probe.ts', `
      import type { PackGroupSettings } from './__generated__/settings.ts';
      const settings: PackGroupSettings['assistant'] = {
        mode: 'thorough', limit: 20, label: 'Other', nullable: 'present', labels: { first: 'one' },
      };
      const other: PackGroupSettings['other'] = { label: 2 };
      // @ts-expect-error groups with identically named schema definitions stay independent
      other.label = settings.label;
      settings.optional = false;
      settings.nullable = null;
      // @ts-expect-error the enum is closed
      settings.mode = 'unknown';
      // @ts-expect-error defaults do not determine numeric types
      settings.limit = '20';
      // @ts-expect-error local references retain their value type
      settings.label = 1;
      // @ts-expect-error record values follow their schema
      settings.labels.first = false;
      // @ts-expect-error undeclared group
      type Missing = PackGroupSettings['missing'];
    `);
    expect(typecheck(files, ['src/probe.ts'])).toEqual([]);
    expect(files['src/__generated__/pack-types.ts']).toContain('PackGroupSettings');
  });

  it('pairs schema-derived paths and values in backend accessors and custom forms', async () => {
    const declaration = { schema: { type: 'object', additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' }, paths: { type: 'object', additionalProperties: { type: 'string' } },
        chat: { type: 'object', additionalProperties: false, properties: { mode: { type: 'string' } } },
        items: { type: 'array', items: { type: 'string' } },
      }, required: ['enabled', 'paths', 'chat', 'items'],
    }, defaults: { enabled: true, paths: {}, chat: {}, items: [] } };
    const files = await generatePackFiles(manifest({ features: [
      { id: 'notes', settings: declaration },
      { id: 'hidden', surface: { label: 'Fixture', state: writeSurfaceState('src/hidden.ts'), defaultVisible: false } },
    ] }), { packRoot: root, depSnapshots: new Map([['base-pack', dependency({
      features: [{ id: 'calendar', settings: declaration }],
    }, facade({ PackFeatureSettings: "{ calendar: { weekStartsOn: number } }" }))]]) });
    write('src/probe.ts', `
      import { featureSettings, type SettingUpdate } from './__generated__/settings.ts';
      import { useSettings } from './__generated__/settings-fe.ts';
      const notes = featureSettings.forFeature('notes');
      const enabled: boolean = notes.get().enabled;
      notes.set({ path: ['enabled'], value: enabled });
      notes.set({ path: ['enabled'] as const, value: false });
      notes.set({ path: ['paths', 'claude'], value: '/usr/bin/claude' });
      notes.set({ path: ['chat', 'mode'], value: 'focused' });
      // @ts-expect-error JSON writes do not encode undefined
      notes.set({ path: ['chat', 'mode'], value: undefined });
      notes.set({ path: ['items'], value: ['one'] });
      notes.reset();
      featureSettings.forFeature('base-pack/calendar').set({ path: ['weekStartsOn'], value: 1 });
      useSettings('base-pack/calendar').set({ path: ['weekStartsOn'], value: 2 });
      const update: SettingUpdate<'notes'> = { path: ['enabled'], value: false };
      useSettings('notes').set(update);
      // @ts-expect-error boolean field cannot accept a string
      notes.set({ path: ['enabled'], value: 'false' });
      // @ts-expect-error array elements are not independently addressable
      notes.set({ path: ['items', '0'], value: 'one' });
      // @ts-expect-error undeclared setting
      notes.set({ path: ['missing'], value: true });
      // @ts-expect-error undeclared feature
      featureSettings.forFeature('missing');
      // @ts-expect-error visibility-only declaration has no settings schema
      featureSettings.forFeature('hidden');
      // @ts-expect-error frontend enforces the same value type
      useSettings('notes').set({ path: ['enabled'], value: 1 });
    `);
    expect(typecheck(files, ['src/probe.ts'])).toEqual([]);
    expect(files['src/__generated__/settings-fe.ts']).not.toContain('sdk/services');
    expect(files['src/__generated__/settings-fe.ts']).not.toContain('src/settings.ts');
  });
});

it('emits settings modules that compile with unused-import checking for a pack without settings', async () => {
  const files = await generatePackFiles(manifest({}), { packRoot: root });
  const diagnostics = typecheck(files, ['src/__generated__/settings.ts', 'src/__generated__/settings-fe.ts'], true);
  expect(diagnostics.filter(d => /^src\/__generated__\/settings(?:-fe)?\.ts:/.test(d))).toEqual([]);
});

it('allows feature services to create settings handles during module initialization', async () => {
  write('src/service.ts', `import { featureSettings } from './__generated__/settings.ts';
    export const notesService = { settings: featureSettings.forFeature('notes') };`);
  const files = await generatePackFiles(manifest({ features: [{
    id: 'notes', settings: { schema: { type: 'object', properties: { limit: { type: 'number' } }, required: ['limit'] }, defaults: { limit: 10 } }, services: { notes: 'src/service.ts#notesService' },
  }] }), { packRoot: root });
  write('src/probe.ts', `import './__generated__/services.ts';
    import { notesService } from './service.ts';
    if (typeof notesService.settings.get !== 'function') throw new Error('Missing settings handle');`);
  expect(typecheck(files, ['src/probe.ts'])).toEqual([]);
  const outfile = path.join(root, 'probe.mjs');
  buildSync({ entryPoints: [path.join(root, 'src/probe.ts')], outfile,
    bundle: true, platform: 'node', format: 'esm', external: ['@apackdev/sdk/*'] });
  await execFileWhileWorking(process.execPath, [outfile]);
});

it('runs generated frontend settings through its entry binding without ambient host administration', async () => {
  const definition = { schema: { type: 'object', properties: { limit: { type: 'number' } }, required: ['limit'] }, defaults: { limit: 10 } };
  const files = await generatePackFiles(manifest({ features: [{ id: 'notes', settings: definition }],
    extensions: { settings: { shared: definition } },
  }), { packRoot: root });
  write('src/probe.ts', `
    import { effectScope } from 'vue';
    import type { SettingsPort } from '@apackdev/sdk/fe';
    import entry from './__generated__/pack-entry-fe.ts';
    import { useSettings, usePackSettings, useAppSettings } from './__generated__/settings-fe.ts';
    const updates: unknown[] = [];
    const port: SettingsPort = {
      get: <T,>() => ({ limit: 10 } as T), status: () => 'ready', subscribe: () => () => {},
      update: async (target, path, value, condition) => { updates.push({ target, path, value, condition }); return { status: 'saved' }; },
      reset: async target => { updates.push({ target }); return { status: 'saved' }; },
    };
    const binding = entry.bindSettings(port);
    binding.activate();
    const scope = effectScope();
    const handles = scope.run(() => ({ notes: useSettings('notes'), shared: usePackSettings('shared'), app: useAppSettings() }))!;
    await handles.notes.set({ path: ['limit'], value: 20 });
    await handles.shared.set({ path: ['limit'], value: 30 });
    await handles.app.set({ path: ['personal', 'name'], value: 'Ada' });
    if (JSON.stringify(updates) !== JSON.stringify([
      { target: { kind: 'feature', featureRef: 'demo-pack/notes' }, path: ['limit'], value: 20 },
      { target: { kind: 'pack', packId: 'demo-pack', groupId: 'shared' }, path: ['limit'], value: 30 },
      { target: { kind: 'app' }, path: ['personal', 'name'], value: 'Ada' },
    ])) throw new Error('Generated settings did not reach their bound targets');
    binding.dispose();
    if ((await handles.app.reset()).status !== 'refused') throw new Error('Retained app handle remained writable');
    if ((await handles.notes.reset()).status !== 'refused') throw new Error('Retained handle remained writable');
    const next = entry.bindSettings(port);
    next.activate();
    if ((await handles.shared.reset()).status !== 'refused') throw new Error('Rebinding revived an old handle');
    next.dispose();
    scope.stop();
  `);
  expect(typecheck(files, ['src/probe.ts'])).toEqual([]);
  const outfile = path.join(root, 'probe.mjs');
  buildSync({ entryPoints: [path.join(root, 'src/probe.ts')], outfile,
    bundle: true, platform: 'node', format: 'esm', external: ['@apackdev/sdk/*', 'vue'] });
  await execFileWhileWorking(process.execPath, ['--conditions=@apackdev/source', outfile]);
});

it('generates owner-writable and dependency-readonly handles for both settings owners', async () => {
  const shared = {
    schema: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'], additionalProperties: false },
    defaults: { enabled: true },
  };
  const owner = { ...shared, access: 'owner' as const };
  const files = await generatePackFiles(manifest({ id: 'consumer-pack',
    extensions: { settings: { local: owner } }, features: [{ id: 'local', settings: owner }],
  }), { packRoot: root, depSnapshots: new Map([['base-pack', dependency({
    extensions: { settings: { shared, private: owner } },
    features: [{ id: 'shared', settings: shared }, { id: 'private', settings: owner }],
  }, facade({
    PackFeatureSettings: '{ shared: { enabled: boolean }; private: { enabled: boolean } }',
    PackGroupSettings: '{ shared: { enabled: boolean }; private: { enabled: boolean } }',
  }))]]) });
  write('src/probe.ts', `
    import { featureSettings, packSettings } from './__generated__/settings.ts';
    import { useSettings, usePackSettings } from './__generated__/settings-fe.ts';
    featureSettings.forFeature('local').set({ path: ['enabled'], value: false });
    featureSettings.forFeature('consumer-pack/local').reset();
    packSettings.forGroup('local').reset();
    packSettings.forGroup('consumer-pack/local').set({ path: ['enabled'], value: true });
    useSettings('local').reset();
    usePackSettings('consumer-pack/local').set({ path: ['enabled'], value: false });
    featureSettings.forFeature('base-pack/shared').set({ path: ['enabled'], value: false });
    packSettings.forGroup('base-pack/shared').reset();
    useSettings('base-pack/shared').reset();
    usePackSettings('base-pack/shared').set({ path: ['enabled'], value: false });
    const serialized: import('@apackdev/sdk/types').SettingsTarget = { kind: 'feature', featureRef: 'base-pack/private' };
    void serialized;
    // @ts-expect-error serialized feature targets still require a qualified ref
    const bare: import('@apackdev/sdk/types').SettingsTarget = { kind: 'feature', featureRef: 'private' };
    void bare;
    const feature = featureSettings.forFeature('base-pack/private');
    const group = packSettings.forGroup('base-pack/private');
    const enabled: boolean = feature.get().enabled;
    const stop = group.onChange(value => { const enabled: boolean = value.enabled; void enabled; });
    stop(); void enabled;
    // @ts-expect-error restricted dependencies are readable but not writable
    feature.set({ path: ['enabled'], value: false });
    // @ts-expect-error reset is also a mutation
    group.reset();
    // @ts-expect-error frontend uses the same feature policy
    useSettings('base-pack/private').set({ path: ['enabled'], value: false });
    // @ts-expect-error frontend uses the same group policy
    usePackSettings('base-pack/private').reset();
    // @ts-expect-error undeclared group
    usePackSettings('missing');
    // @ts-expect-error declared group value comes from its schema
    packSettings.forGroup('base-pack/shared').set({ path: ['enabled'], value: 'false' });
  `);
  expect(typecheck(files, ['src/probe.ts'])).toEqual([]);
});
