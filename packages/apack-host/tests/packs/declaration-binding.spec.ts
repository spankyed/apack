import { createNativePackTestRegistry } from '@apackdev/host/testing';
import { expect, it } from 'vitest';
import { ManifestSchema } from '@apackdev/pack-format';
import { backendBindingProblem } from '../../src/packs/declaration-binding.ts';

const manifest = ManifestSchema.parse({
  id: 'example', name: 'Example', version: '1.0.0',
  features: {
    notes: { description: 'Feature declaration fixture.',
      designation: 'notes', system: { entry: 'system.ts' },
      surface: { label: 'Fixture', state: 'surface.ts', defaultVisible: false },
      services: { notes: 'notes.ts#notes' }, repositories: { noteQueries: 'notes.ts#queries' },
    },
    preferences: { description: 'Feature declaration fixture.',},
  },
  extensions: { services: { shared: 'shared.ts#shared' } },
});

function binding() {
  return { features: {
    notes: { designation: 'notes', system: { machine: {}, receives: [] }, surface: { receives: [] }, services: ['notes'] },
    preferences: {},
  }, services: { notes: {}, shared: {} }, repositories: { noteQueries: {} } };
}

it('accepts exactly declared identities independently of registration order', () => {
  const registration = binding();
  registration.services = { shared: {}, notes: {} };
  expect(backendBindingProblem(manifest, registration, { notes: { system: { incoming: [], outgoing: [] }, surface: { receives: [] } } })).toBeUndefined();
});

it.each([
  ['extra feature', (value: ReturnType<typeof binding>) => Object.assign(value.features, { ghost: {} }), 'features'],
  ['missing feature', (value: ReturnType<typeof binding>) => Reflect.deleteProperty(value.features, 'preferences'), 'features'],
  ['role', (value: ReturnType<typeof binding>) => { value.features.notes.designation = 'other'; }, 'features.notes.designation'],
  ['system', (value: ReturnType<typeof binding>) => Reflect.deleteProperty(value.features.notes, 'system'), 'features.notes.system'],
  ['surface', (value: ReturnType<typeof binding>) => Reflect.deleteProperty(value.features.notes, 'surface'), 'features.notes.surface'],
  ['feature service', (value: ReturnType<typeof binding>) => { value.features.notes.services = ['shared']; }, 'features.notes.services'],
  ['duplicate feature service', (value: ReturnType<typeof binding>) => { value.features.notes.services = ['notes', 'notes']; }, 'features.notes.services'],
  ['extra service', (value: ReturnType<typeof binding>) => Object.assign(value.services, { ghost: {} }), 'services'],
  ['missing service', (value: ReturnType<typeof binding>) => Reflect.deleteProperty(value.services, 'shared'), 'services'],
  ['extra repository', (value: ReturnType<typeof binding>) => Object.assign(value.repositories, { ghost: {} }), 'repositories'],
  ['missing repository', (value: ReturnType<typeof binding>) => Reflect.deleteProperty(value.repositories, 'noteQueries'), 'repositories'],
] as const)('refuses a mismatched %s and identifies the owner and contribution', (_name, change, path) => {
  const registration = binding();
  change(registration);
  expect(backendBindingProblem(manifest, registration, { notes: { system: { incoming: [], outgoing: [] }, surface: { receives: [] } } })).toBe(`Pack "example" runtime ${path} does not match its accepted declarations`);
});

it.each([null, [], { features: [] }, { features: { notes: null, preferences: {} } }])('refuses malformed runtime records: %j', registration => {
  expect(backendBindingProblem(manifest, registration, { notes: { system: { incoming: [], outgoing: [] }, surface: { receives: [] } } })).toBeDefined();
});

it.each(['features', 'services', 'repositories'])('refuses explicit null %s even when nothing is declared', key => {
  const empty = ManifestSchema.parse({ id: 'empty', name: 'Empty', version: '1.0.0' });
  expect(backendBindingProblem(empty, { [key]: null })).toContain(`runtime ${key}`);
  expect(backendBindingProblem(empty, {})).toBeUndefined();
});

it('refuses undeclared services before registration, catalog publication or authority binding', () => {
  const registry = createNativePackTestRegistry();
  const catalog = registry.settingsCatalog();
  let bound = false;
  const empty = ManifestSchema.parse({ id: 'undeclared', name: 'Undeclared', version: '1.0.0' });
  expect(() => registry.registerPack({ id: empty.id, services: { ghost: {} }, bindServices: () => { bound = true; return () => {}; } }, {
    id: empty.id, name: empty.name, version: empty.version, dir: '/packs/undeclared',
    declarationRevision: 'accepted', manifest: empty,
  })).toThrow('runtime services does not match');
  expect(bound).toBe(false);
  expect(registry.getPackRegistration(empty.id)).toBeNull();
  expect(registry.getRegisteredServices()).not.toHaveProperty('ghost');
  expect(registry.settingsCatalog()).toBe(catalog);
});

it('checks native step data and runtime slots before granting settings or invoking functions', async () => {
  const { createPackRegistry } = await import('../../src/packs/registry.ts');
  const { vi } = await import('vitest');
  const handler = vi.fn();
  const bindServices = vi.fn();
  const registry = createPackRegistry({ nativeDeclarations: [{ id: 'native', steps: {
    memo: { node: { label: 'Memo', defaults: { tags: ['draft'] } }, runtime: { handler: 'native.ts#run', waits: true } },
  } }] });
  const step = { type: 'memo', node: { label: 'Memo', defaults: { tags: ['draft'] } }, runtime: { handler, waits: true as const } };
  const candidates = [
    { steps: [] },
    { steps: [step, step] },
    { steps: [{ ...step, node: { label: 'Changed' } }] },
    { steps: [{ ...step, runtime: { handler } }] },
    { steps: [{ ...step, runtime: { waits: true as const } }] },
  ];
  for (const candidate of candidates) {
    expect(() => registry.registerPack({ id: 'native', ...candidate, bindServices })).toThrow('does not match its admitted declarations');
    expect(registry.step('memo')).toBeUndefined();
  }
  expect(bindServices).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
  registry.registerPack({ id: 'native', steps: [step] });
  const accepted = registry.step('memo')!;
  expect(accepted.runtime!.handler).toBe(handler);
  step.node.defaults.tags.push('Caller mutation');
  Reflect.set(step.runtime, 'waits', false);
  expect(accepted.node!.defaults!.tags).toEqual(['draft']);
  expect(accepted.runtime!.waits).toBe(true);
  expect(handler).not.toHaveBeenCalled();
});

it('checks declared trigger registration slots without invoking their implementation', async () => {
  const { createPackRegistry } = await import('../../src/packs/registry.ts');
  const { vi } = await import('vitest');
  const register = vi.fn();
  const trigger = { trackField: 'event', compile: () => ({}), decompile: () => ({}) };
  const node = { label: 'Trigger' };
  for (const declared of [false, true]) {
    const registry = createPackRegistry({ nativeDeclarations: [{ id: 'native', steps: { signal: {
      kind: 'trigger', node, trigger: { trackField: "event", compile: 'native.ts#compile', decompile: 'native.ts#decompile', ...(declared && { register: 'native.ts#register' }) },
    } } }] });
    const bound = { type: 'signal', kind: 'trigger' as const, node, trigger: { ...trigger, ...(!declared && { register }) } };
    expect(() => registry.registerPack({ id: 'native', steps: [bound] })).toThrow('trigger.register');
    registry.registerPack({ id: 'native', steps: [{ ...bound, trigger: { ...trigger, ...(declared && { register }) } }] });
    expect(register).not.toHaveBeenCalled();
  }
});

it('does not normalize non-JSON runtime node data into a matching declaration', async () => {
  const { createPackRegistry } = await import('../../src/packs/registry.ts');
  class NotJson { value = 1; }
  const registry = createPackRegistry({ nativeDeclarations: [{ id: 'native', steps: {
    memo: { node: { label: 'Memo', defaults: { object: { value: 1 } } } },
  } }] });
  expect(() => registry.registerPack({ id: 'native', steps: [{ type: 'memo',
    node: { label: 'Memo', defaults: { object: new NotJson() } },
  }] })).toThrow('JSON data');
  expect(registry.step('memo')).toBeUndefined();
});


it.each(['trackField', 'persistent', 'queryFields', 'compile', 'decompile', 'validate', 'register', 'extra'])(
  'refuses changed or undeclared trigger %s before publishing a native runtime', async field => {
    const { createPackRegistry } = await import('../../src/packs/registry.ts');
    const { vi } = await import('vitest');
    const compile = vi.fn(() => ({}));
    const decompile = vi.fn(() => ({}));
    const validate = vi.fn(() => ({ valid: true, errors: [] }));
    const declaration = { kind: 'trigger' as const, node: { label: 'Pulse' }, trigger: {
      trackField: 'every', persistent: true, queryFields: ['interval'], compile: 'pulse.ts#compile',
      decompile: 'pulse.ts#decompile', validate: 'pulse.ts#validate',
    } };
    const registry = createPackRegistry({ nativeDeclarations: [{ id: 'author', steps: { pulse: declaration } }] });
    const trigger = { trackField: 'every', persistent: true, queryFields: ['interval'], compile, decompile, validate };
    const changed = { ...trigger, [field]: ({ trackField: 'other', persistent: false, queryFields: ['foreign'],
      compile: undefined, decompile: {}, validate: undefined, register: vi.fn(), extra: true } as Record<string, unknown>)[field] };
    expect(() => registry.registerPack({ id: 'author', steps: [{ type: 'pulse', kind: 'trigger', node: declaration.node, trigger: changed }] }))
      .toThrow(`trigger.${field}`);
    expect(registry.step('pulse')).toBeUndefined();
    registry.registerPack({ id: 'author', steps: [{ type: 'pulse', kind: 'trigger', node: declaration.node, trigger }] });
    expect(registry.step('pulse')!.trigger!.trackField).toBe('every');
    expect(compile).not.toHaveBeenCalled(); expect(validate).not.toHaveBeenCalled();
    registry.unregisterPack('author');
  },
);

it.each(['relation', 'decompile', 'branches'])('refuses undeclared build %s instead of silently changing compiler capabilities', async field => {
  const { createPackRegistry } = await import('../../src/packs/registry.ts');
  const declaration = { node: { label: 'Memo' }, build: { compile: 'memo.ts#compile', validate: 'memo.ts#validate', getLabel: 'memo.ts#getLabel' } };
  const registry = createPackRegistry({ nativeDeclarations: [{ id: 'author', steps: { memo: declaration } }] });
  const build = { compile: () => ({ entity: {}, relations: [] }), validate: () => [], getLabel: () => 'Memo' };
  const changed = { ...build, [field]: field === 'relation' ? { field: 'memoId', targetEntity: 'Memo' } : () => ({}) };
  expect(() => registry.registerPack({ id: 'author', steps: [{ type: 'memo', node: declaration.node, build: changed }] })).toThrow(`build.${field}`);
  expect(registry.step('memo')).toBeUndefined();
});
