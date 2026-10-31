import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { _nativePackDeclarationProblem, type NativePackDeclaration } from '@apackdev/sdk/framework';
import { resetTestData, startTestRuntime } from '@apackdev/sdk/testing';
import { HOST_ENTITY_TYPES, appState } from '../../src/app-state/index.ts';
import { createPackRegistry } from '../../src/packs/registry.ts';
import { createNativePackTestRegistry } from '../../src/testing/pack-registry.ts';
import { runAppMigrations, runPackMigrations } from '../../src/migrations/index.ts';
import { startPacks } from '../../src/packs/runtime/start.ts';

const declared = { description: 'Initialize native data', up: 'absent/migration.ts#up' };
const declaration: NativePackDeclaration = {
  id: 'native-migrations', version: '2.0.0', migrations: { app: { '1.0.0': declared }, pack: { '1.0.0': declared } },
};
const entry = (up: () => void = vi.fn()) => ({ target: '1.0.0', description: declared.description, up });

beforeEach(() => {
  vi.stubEnv('APACK_ENV', 'test');
  startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, appVersion: '4.0.0' });
  resetTestData();
  appState.update({ version: '0.0.0' });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('discovers native migration data without modules and executes both lines through normal startup', async () => {
  const order: string[] = [];
  const registry = createPackRegistry({ nativeDeclarations: [{ ...declaration, lifecycle: { onInit: 'absent/hooks.ts#onInit' } }] });
  const metadata = registry.catalog.getSnapshot().native[0];
  expect(metadata.migrations).toEqual(declaration.migrations);
  registry.registerPack({ id: declaration.id, lifecycle: { onInit: () => { order.push('init'); } },
    migrations: { app: [entry(() => { order.push('app'); })], pack: [entry(() => { order.push('pack'); })] },
  });
  expect(order).toEqual([]);
  expect(registry.packMigrationTargets('pack')).toMatchObject([{ packId: declaration.id, version: '2.0.0' }]);
  expect(registry.packContentTargets()).toEqual([]);
  await startPacks(registry);
  expect(order).toEqual(['init', 'app', 'pack']);
  expect(appState.get()).toMatchObject({ version: '4.0.0', packVersions: { [declaration.id]: '2.0.0' } });
  registry.unregisterPack(declaration.id);
  expect(registry.packMigrationTargets('app')).toEqual([]);
  expect(registry.packMigrationTargets('pack')).toEqual([]);
  expect(registry.catalog.getSnapshot().native[0]).toBe(metadata);
});

it('runs native app-line migrations without a pack version and uses the app cap', () => {
  const registry = createPackRegistry({ nativeDeclarations: [{ id: 'app-only', migrations: {
    app: { '1.0.0': declared, '5.0.0': declared },
  } }] });
  const current = vi.fn(); const future = vi.fn();
  registry.registerPack({ id: 'app-only', migrations: { app: [entry(current), { ...entry(future), target: '5.0.0' }] } });
  expect(registry.packMigrationTargets('pack')).toEqual([]);
  expect(runAppMigrations(registry)).toBe(true);
  expect(current).toHaveBeenCalledOnce(); expect(future).not.toHaveBeenCalled();
  expect(appState.get().version).toBe('4.0.0');
  expect(appState.get().packVersions['app-only']).toBeUndefined();
});

it('requires a native version only when pack-line migrations declare targets', () => {
  expect(_nativePackDeclarationProblem({ id: 'unversioned', migrations: { pack: { '1.0.0': declared } } }))
    .toContain('Native pack-line migrations require');
  expect(_nativePackDeclarationProblem({ id: 'empty', migrations: { pack: {} } })).toBeUndefined();
  expect(_nativePackDeclarationProblem({ ...declaration, version: 'next' })).toContain('version');
});

it.each([
  ['migrations.app', { app: [] }],
  ['migrations.pack', { app: [entry()] }],
  ['migrations.app.1.0.0', { app: [{ ...entry(), description: 'Changed' }], pack: [entry()] }],
  ['migrations.pack.1.0.0', { app: [entry()], pack: [{ ...entry(), up: null }] }],
  ['migrations', { app: [entry()], pack: [entry()], unknown: [] }],
  ['migrations.pack', { app: [entry()], pack: [entry(), entry()] }],
] as const)('refuses mismatched native %s before granting authority', (field, migrations) => {
  const registry = createPackRegistry({ nativeDeclarations: [declaration] });
  const before = registry.catalog.getSnapshot(); const bindServices = vi.fn();
  expect(() => registry.registerPack({ id: declaration.id, migrations, bindServices } as never))
    .toThrow(`Native pack "${declaration.id}" runtime ${field} does not match its admitted declarations`);
  expect(bindServices).not.toHaveBeenCalled();
  expect(registry.getPackRegistration(declaration.id)).toBeNull();
  expect(registry.packMigrationTargets('app')).toEqual([]);
  expect(registry.catalog.getSnapshot()).toBe(before);
});

it('captures migration targets, callbacks and version before caller mutation and cache refresh', () => {
  const up = vi.fn();
  const runtime = { id: declaration.id, migrations: { app: [entry()], pack: [entry(up)] } };
  const registry = createPackRegistry({ nativeDeclarations: [declaration, { id: 'peer' }] });
  registry.registerPack(runtime);
  registry.catalog.setNative([{ ...declaration, version: '9.0.0' }, { id: 'peer' }]);
  runtime.migrations.pack[0].target = '9.0.0';
  runtime.migrations.pack[0].description = 'Changed';
  runtime.migrations.pack[0].up = vi.fn(() => { throw new Error('Mutated callback'); });
  runtime.migrations.pack.push({ ...entry(), target: '8.0.0' });
  registry.registerPack({ id: 'peer' });
  const targets = registry.packMigrationTargets('pack');
  expect(targets).toMatchObject([{ packId: declaration.id, version: '2.0.0', migrations: [
    { target: '1.0.0', description: declared.description, up },
  ] }]);
  runPackMigrations(targets);
  expect(up).toHaveBeenCalledOnce();
  expect(appState.get().packVersions[declaration.id]).toBe('2.0.0');
});

it('orders native and installed migrations together before narrowing a subset', () => {
  const order: string[] = [];
  const registry = createPackRegistry({ nativeDeclarations: [{ id: 'provider', version: '1.0.0', migrations: { pack: { '1.0.0': declared } } }] });
  const manifest = { id: 'consumer', name: 'Consumer', version: '1.0.0', dependencies: { provider: '*' }, migrations: { pack: { '1.0.0': declared } } };
  registry.registerPack({ id: 'consumer', dependencies: manifest.dependencies, migrations: { pack: [entry(() => { order.push('consumer'); })] } },
    { id: manifest.id, name: manifest.name, version: manifest.version, manifest, dir: '/absent/installed', declarationRevision: 'fixture' });
  registry.registerPack({ id: 'provider', migrations: { pack: [entry(() => { order.push('provider'); })] } });
  expect(registry.packMigrationTargets('pack').map(target => target.packId)).toEqual(['provider', 'consumer']);
  expect(registry.packMigrationTargets('pack', ['consumer']).map(target => target.packId)).toEqual(['consumer']);
  runPackMigrations(registry.packMigrationTargets('pack'));
  expect(order).toEqual(['provider', 'consumer']);
});

it('retains a failed native pack version, retries, and caps work at its own version', () => {
  const registry = createPackRegistry({ nativeDeclarations: [{ id: 'retry-native', version: '2.0.0',
    migrations: { pack: { '1.0.0': declared, '2.0.0': declared, '3.0.0': declared } },
  }] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let fails = true;
  const first = vi.fn(() => { if (fails) throw new Error('Retry native migration'); });
  const second = vi.fn(); const future = vi.fn();
  registry.registerPack({ id: 'retry-native', migrations: { pack: [entry(first),
    { ...entry(second), target: '2.0.0' }, { ...entry(future), target: '3.0.0' },
  ] } });
  const migrate = () => runPackMigrations(registry.packMigrationTargets('pack'));
  migrate();
  expect(appState.get().packVersions['retry-native']).toBeUndefined();
  expect(second).not.toHaveBeenCalled(); expect(future).not.toHaveBeenCalled();
  fails = false;
  migrate(); migrate();
  expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledOnce();
  expect(future).not.toHaveBeenCalled();
  expect(appState.get().packVersions['retry-native']).toBe('2.0.0');
});

it('uses explicitly supplied native fixture metadata for a migration version', () => {
  const registry = createNativePackTestRegistry({ nativeDeclarations: [{ id: 'fixture-native', version: '2.0.0' }] });
  registry.registerPack({ id: 'fixture-native', migrations: { pack: [entry()] } });
  expect(registry.packMigrationTargets('pack')).toMatchObject([{ packId: 'fixture-native', version: '2.0.0' }]);
  expect(registry.catalog.getSnapshot().native[0].migrations?.pack?.['1.0.0'].description).toBe(declared.description);
  const unversioned = createNativePackTestRegistry();
  expect(() => unversioned.registerPack({ id: 'unversioned', migrations: { pack: [entry()] } }))
    .toThrow('Native pack-line migrations require');
});

it('refuses installed migration bindings without accepted manifest declarations instead of ignoring them', () => {
  const registry = createPackRegistry(); const bindServices = vi.fn();
  expect(() => registry.registerPack({ id: 'unaccepted-installed', migrations: { app: [entry()] }, bindServices } as never,
    { id: 'unaccepted-installed', name: 'Unaccepted', version: '1.0.0', dir: '/absent', declarationRevision: 'fixture' }))
    .toThrow('runtime migrations.app has no accepted migration declarations');
  expect(bindServices).not.toHaveBeenCalled();
  expect(registry.getPackRegistration('unaccepted-installed')).toBeNull();
});

it('records a pack ID matching an inherited object key as its own version', () => {
  const registry = createPackRegistry({ nativeDeclarations: [{ id: 'constructor', version: '2.0.0',
    migrations: { pack: { '1.0.0': declared } },
  }] });
  const up = vi.fn();
  registry.registerPack({ id: 'constructor', migrations: { pack: [entry(up)] } });
  runPackMigrations(registry.packMigrationTargets('pack'));
  expect(up).toHaveBeenCalledOnce();
  expect(Object.hasOwn(appState.get().packVersions, 'constructor')).toBe(true);
  expect(appState.get().packVersions.constructor).toBe('2.0.0');
});

it('does not rerun a migrated native version carrying SemVer build metadata', () => {
  const registry = createPackRegistry({ nativeDeclarations: [{ id: 'build-metadata', version: '1.0.0+native.1',
    migrations: { pack: { '1.0.0': declared } },
  }] });
  const up = vi.fn();
  registry.registerPack({ id: 'build-metadata', migrations: { pack: [entry(up)] } });
  runPackMigrations(registry.packMigrationTargets('pack'));
  runPackMigrations(registry.packMigrationTargets('pack'));
  expect(up).toHaveBeenCalledOnce();
  expect(appState.get().packVersions['build-metadata']).toBe('1.0.0+native.1');
});
