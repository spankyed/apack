// Unit tests for a pack without the app, on the pack's own @apackdev/sdk (registrations are the ones
// the pack's code sees). Two tiers:
// - data: the pack's content, repositories and content writers against an in-memory EARS, with its
//   dependencies' content behaviour (their content runtimes);
// - runtime (with `registration`): also its systems, services and steps, and its dependencies' full
//   runtimes, run under the app's bus core with `startApp`.
//
//   // tests/setup.ts (vitest setupFiles, after isolatedDataDir's)
//   import { contentRuntime } from '#generated/content-runtime';
//   import { registration } from '#generated/pack-entry';
//   import { setupPackTests } from '@apackdev/testing/harness';
//   await setupPackTests({ contentRuntime, registration });
import { assertCheckoutPackagesFresh } from './checkout-freshness.ts';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, inject, type RunnerTask, type RunnerTestCase } from 'vitest';
import { resetTestData as resetSdkTestData, startTestRuntime, takeSystemErrors, addTestSecret, fakeInference, nativePackDeclarationFixture, type FakeInference } from '@apackdev/sdk/testing';
import type { PackRegistryView } from '@apackdev/sdk/runtime';
import { _settingsAdmin, type SettingsAdmin } from '@apackdev/sdk/services';
import type { FeatureRef } from '@apackdev/sdk/ids';
import { _parseEventContracts, type PackEventContracts, type PackRegistration } from '@apackdev/sdk/framework';
import { GENERATED_EVENT_CONTRACTS_FILE } from '@apackdev/sdk/build';
import { createPackRegistry, readCachedDependency, readPackBuild, assertPackServiceRequirements, type PackOrigin } from '@apackdev/host/packs';
import { APPLICATION_SYSTEM_EVENTS, createApplicationSystem, createPacksSystem, createSettingsSystem, hostRegistration, hostDeclaration, packsEvents, settingsEvents } from '@apackdev/host/features';
import { appState, HOST_ENTITY_TYPES } from '@apackdev/host/app-state';
import { createSettingsService, createSettingsStore } from '@apackdev/host/settings';
import { getSettingsCatalog, onPackCatalogChanged, type ContentRuntime } from '@apackdev/sdk/framework';
import { loadDependencyRuntime } from './dependency-runtime.ts';
import { assertSharedEars } from './shared-ears.ts';
import { setAppPacks, stopRunningApps } from './app.ts';
import { startShell as startShellFor, stopRunningShells, type StartShellOptions, type TestShell } from './shell.ts';
import { PROJECT_ROOT_KEY } from './vitest-teardown.ts';
import { compileFlowDSL, compilePack, compileHelp, parseContentIndex, resolveContentSources, CONTENT_INDEX_FILE, ManifestSchema, parseSnapshot, _declarationRevision, _snapshotFormatMismatch, _cliFormatMismatchMessage, type FlowDSL, type PackManifest, type PackSnapshot, type ContentDependency } from '@apackdev/sdk/build';
import { actionRepository, flowRepository, promptRepository } from '@apackdev/sdk/repositories';
import { boundEars, untypedQuery } from '@apackdev/sdk/ears';
import { _getMediaPath, importCompiledContent, type ImportMode, type ImportResult, type ContentApplier } from '@apackdev/sdk/utils';

export { takeSystemErrors, addTestSecret, type ContentRuntime };

/**
 * Where the media a test's content wrote lands: the store itself, or one row's folder
 * (`media/<entityId>/<file>`). A pack's tests read and assert on it through this; the path itself is
 * the app's, and the data dir is this package's contract (`isolatedDataDir`).
 */
export function testMediaPath(entityId?: string): string {
  return entityId ? path.join(_getMediaPath(), entityId) : _getMediaPath();
}

/**
 * Empties what a test wrote: the in-memory database and the stored keys (the SDK's `resetTestData`),
 * and the media store with them, which is what a test between tests expects. The harness calls it
 * before each test; a test that re-applies mid-run calls it itself.
 */
export function resetTestData(): void {
  resetSdkTestData();
  fs.rmSync(testMediaPath(), { recursive: true, force: true });
}
export { startApp, type StartAppOptions, type TestApp, type TestView, type Message, type SurfaceEvent, type FlowRun, type FlowRunStep, type RunFlowOptions } from './app.ts';

const serviceMocks = new Map<string, unknown>();
/**
 * Whether a test (with its beforeEach and afterEach hooks) is running, so mocks have a test to last for. Mocks,
 * the database and running apps are per file, not per test: the harness rejects concurrent tests.
 */
let inTest = false;

/** The test file's registered packs: the pack under test and its dependencies, and any other pack a test registers */
const registry = createPackRegistry({ nativeDeclarations: [hostDeclaration], serviceOverrides: serviceMocks, settingsForPack: (packId) => _settingsAdmin().forPack(packId) });
// The app's own surfaces (the shell, the Packs tab, Settings), which a pack's systems may send to. The harness runs
// three of the host's systems: settings, because a feature's own settings are the app's to store and hand back and a
// pack's code reads them in almost every test; packs, which owns content import and preview — a pack's tests write
// their own compiled output constantly, and that is the system those events reach; and application, which publishes
// the facts a window holds whatever surface is open, so a pack contributing one (the chat's commands, through the
// `commands` designation) is tested through the system that serves it rather than through a fake.
registry.registerPack(hostRegistration({
  settings: { machine: createSettingsSystem(), receives: [...settingsEvents] },
  packs: { machine: createPacksSystem(registry), receives: [...packsEvents] },
  application: { machine: createApplicationSystem(registry), receives: APPLICATION_SYSTEM_EVENTS },
}));
setAppPacks(registry);

/**
 * The systems and surfaces the packs' manifests declare, when the harness registers content runtimes, which carry no
 * features: an action a test runs sends to them through `services.emitter`, which resolves against these
 */
const declaredRefs = { systems: new Set<string>(), surfaces: new Set<string>() };

/** Records the refs of the features `manifest` declares */
function declareFeatures(manifest: Pick<PackManifest, 'id' | 'features'>): void {
  for (const [id, feature] of Object.entries(manifest.features ?? {})) {
    if (feature.system) declaredRefs.systems.add(`${manifest.id}/${id}`);
    if (feature.surface) declaredRefs.surfaces.add(`${manifest.id}/${id}`);
  }
}

/** The runtime also recognizes declared refs before their actors start. */
const runtimePacks: PackRegistryView = {
  ...registry,
  systemIds: () => [...new Set([...registry.systemIds(), ...declaredRefs.systems])] as FeatureRef[],
  surfaceIds: () => [...new Set([...registry.surfaceIds(), ...declaredRefs.surfaces])] as FeatureRef[],
};

/**
 * Registers another pack in the test file's registry, as the app registers an installed one: its commands, feature
 * settings, appliers, services and the rest are what the pack under test then reads. Unregister it when the test is done.
 */
export function registerPack(registration: PackRegistration): void {
  const declaration = nativePackDeclarationFixture(registration);
  const before = registry.catalog.getSnapshot().native;
  registry.catalog.setNative([...before.filter(pack => pack.id !== declaration.id), declaration]);
  try { registry.registerPack(registration); }
  catch (error) { registry.catalog.setNative(before); throw error; }
}

/** Unregisters a pack `registerPack` registered */
export function unregisterPack(packId: string): void {
  registry.unregisterPack(packId);
  registry.catalog.setNative(registry.catalog.getSnapshot().native.filter(pack => pack.id !== packId));
}

/**
 * Replaces a service in `services` for the current test, restored after it: call it in the test or a
 * `beforeEach`, not `beforeAll`. Type it with the pack's services (`mockService<Services>('scheduler',
 * { registerSchedule: … })`); give only the members the code under test uses. Code that imports a
 * service module directly instead of using `services` isn't affected.
 */
export function mockService<S extends object = Record<string, object>, K extends keyof S & string = keyof S & string>(name: K, implementation: Partial<S[K]>): void {
  if (!inTest) {
    throw new Error(`mockService('${name}') ran outside a test: a mock lasts for the test it's made in, so make it in the test or a beforeEach`);
  }
  serviceMocks.set(name, implementation);
}

/** Host administration for fixture setup and assertions; pack code uses its generated settings service. */
export function getTestSettings(): SettingsAdmin {
  if (!inTest) throw new Error('getTestSettings() requires an active harness test');
  return _settingsAdmin();
}

/**
 * Mocks `services.inference` for the current test with a `fakeInference` whose language model answers `reply` and
 * whose other models answer `replies`; returns it, so the test can assert its `calls`.
 */
export function mockInference(...args: Parameters<typeof fakeInference>): FakeInference {
  const inference = fakeInference(...args);
  mockService('inference', inference);
  return inference;
}

/** Where `apack pack build` caches a dependency's snapshot and build/ in a pack */
const DEPS_DIR = path.join('.apack', 'deps');
const CONTENT_RUNTIME_FILE = 'content-runtime.mjs';

export interface PackTestOptions {
  /** The pack's own content runtime: `import { contentRuntime } from '#generated/content-runtime'` */
  contentRuntime: ContentRuntime;
  /**
   * The pack's runtime registration, `import { registration } from '#generated/pack-entry'`: registers
   * its systems, services, steps and designations, and loads each dependency's full runtime instead
   * of its content runtime, for `startApp`.
   */
  registration?: PackRegistration;
  /**
   * Without `registration`, the pack's appliers, `import { appliers } from '#generated/appliers'`, which `importContent` runs
   * (a registration carries its own)
   */
  appliers?: ContentApplier[];
  /**
   * The pack root (with apack.json); defaults to the nearest one at or above the vitest project's root (`--root`,
   * `test.root`, a workspace project's dir), given by isolatedDataDir's globalSetup, else the working directory
   */
  packDir?: string;
}

interface PackContext {
  packDir: string;
  manifest: PackManifest;
  dependencies: Map<string, ContentDependency>;
  entityDestinations?: PackSnapshot['entityDestinations'];
}

let context: PackContext | undefined;

const runs = (task: RunnerTask): boolean => task.mode !== 'skip' && task.mode !== 'todo' && (task.type !== 'suite' || task.tasks.some(runs));
const contains = (task: RunnerTask, test: Readonly<RunnerTestCase>): boolean => task === test || (task.type === 'suite' && task.tasks.some((child) => contains(child, test)));

/**
 * Whether another test in the file can run while `test` does: vitest runs a suite's consecutive concurrent children
 * together, so `test`, or a suite holding it, is concurrent next to a sibling that runs tests too
 */
function runsAlongsideAnother(test: Readonly<RunnerTestCase>): boolean {
  const search = (suite: RunnerTask): boolean => {
    if (suite.type !== 'suite') return false;
    const holder = suite.tasks.find((child) => contains(child, test));
    if (!holder) return false;
    if (holder.concurrent === true) {
      const index = suite.tasks.indexOf(holder);
      let start = index;
      while (start > 0 && suite.tasks[start - 1].concurrent === true) start--;
      let end = index;
      while (end < suite.tasks.length - 1 && suite.tasks[end + 1].concurrent === true) end++;
      if (suite.tasks.slice(start, end + 1).some((child) => child !== holder && runs(child))) return true;
    }
    return search(holder);
  };
  return search(test.file);
}

/** The vitest project's root, when isolatedDataDir's globalSetup provided it */
function projectRoot(): string | undefined {
  const root = (inject as (key: string) => unknown)(PROJECT_ROOT_KEY);
  return typeof root === 'string' ? root : undefined;
}

function findPackDir(from: string): string {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'apack.json'))) return dir;
    if (path.dirname(dir) === dir) throw new Error(`No apack.json in ${from} or above it; pass packDir to setupPackTests`);
  }
}

type CachedDependency = ContentDependency & { snapshot: PackSnapshot; dir: string };

function readDependencies(packDir: string, manifest: PackManifest): Map<string, CachedDependency> {
  const dependencies = new Map<string, CachedDependency>();
  for (const depId of Object.keys(manifest.dependencies ?? {})) {
    const cached = readCachedDependency(packDir, depId);
    if (!cached) {
      throw new Error(`Dependency "${depId}" isn't in ${path.join(DEPS_DIR, depId)}. Run \`apack pack build\` once to fetch dependencies.`);
    }
    const dir = cached.directory;
    const snapshotFile = path.join(dir, 'types', 'snapshot.json');
    const raw = cached.snapshot;
    if (cached.resolution.kind !== 'build') throw new Error(`Dependency "${depId}" has no verified executable build. Run \`apack pack build\` to fetch its complete build.`);
    const mismatch = _snapshotFormatMismatch(raw);
    if (mismatch) throw new Error(`Dependency "${depId}" in ${path.join(DEPS_DIR, depId)}: ${_cliFormatMismatchMessage(mismatch)}. Run \`apack pack build\` to fetch it again.`);
    const result = parseSnapshot(raw);
    if (!result.snapshot) throw new Error(`Dependency "${depId}" in ${snapshotFile}: ${result.diagnostics.map(issue => issue.message).join('; ')}`);
    const snapshot = result.snapshot;
    if (snapshot.manifest.id !== depId) {
      throw new Error(`Dependency "${depId}" in ${snapshotFile} declares "${snapshot.manifest.id}". Rebuild its dependency cache.`);
    }
    const buildDir = path.join(dir, 'build');
    dependencies.set(depId, { snapshot, dir, manifest: snapshot.manifest, ...(fs.existsSync(buildDir) && { buildDir }) });
  }
  return dependencies;
}

/** Where a pack came from, as the app records it */
function originOf(manifest: PackManifest, dir: string, eventContracts?: Readonly<PackEventContracts>): PackOrigin {
  // `shipped` is about the app having installed this copy, which a test app never did — and nothing a pack's
  // own tests exercise reads it
  return { id: manifest.id, name: manifest.name, version: manifest.version, declarationRevision: _declarationRevision(manifest), dir, manifest,
    ...(eventContracts && { eventContracts }) };
}

/**
 * Starts the in-memory runtime for the pack's tests: entity types of the SDK, the pack and its
 * dependencies; each dependency's content runtime (its repositories and content writers) and the pack's own
 * registered in the test file's registry; the database emptied before each test. Call it once, from a vitest setup file.
 */
export async function setupPackTests(options: PackTestOptions): Promise<void> {
  // From a checkout, this bundle is built on demand: refuse to test yesterday's packages silently
  assertCheckoutPackagesFresh();
  if (context) {
    throw new Error(
      'setupPackTests() already ran in this process. Call it once, from a vitest setup file, and keep vitest\'s ' +
      '`isolate` on (the default): the harness keeps one registry, database and set of mocks per test file, ' +
      'so test files sharing a module instance (`isolate: false`) would register the same packs twice',
    );
  }
  if (!process.env.APACK_USER_DATA_DIR) {
    throw new Error('APACK_USER_DATA_DIR is unset: use isolatedDataDir() from @apackdev/testing/vitest in vitest.config.ts');
  }
  const packDir = options.packDir ?? findPackDir(projectRoot() ?? process.cwd());
  assertSharedEars(packDir);
  const parsed = ManifestSchema.safeParse(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')));
  if (!parsed.success) throw new Error(`Invalid source pack manifest: ${parsed.error.issues.map(issue => issue.message).join('; ')}`);
  const manifest = parsed.data;
  const revision = _declarationRevision(manifest);
  if (options.contentRuntime.id !== manifest.id || options.contentRuntime.declarationRevision !== revision
    || (options.registration && (options.registration.id !== manifest.id || options.registration.declarationRevision !== revision))) {
    throw new Error(`Pack "${manifest.id}" generated declarations are stale. Run apack pack generate-entries before testing.`);
  }
  const dependencies = readDependencies(packDir, manifest);
  // The source entry and this data are one codegen output; runtime tests need no compiled app bundle.
  const eventContracts = options.registration
    ? _parseEventContracts(JSON.parse(fs.readFileSync(path.join(packDir, GENERATED_EVENT_CONTRACTS_FILE), 'utf8')), manifest.features)
    : undefined;
  registry.catalog.setSources([{ manifest, dir: packDir, declarationRevision: revision,
    ...(eventContracts && { eventContracts }), ...(manifest.extensions?.help && { help: compileHelp(packDir, manifest) }) }]);
  registry.catalog.replace([...dependencies.values()].map(({ snapshot, dir }) => ({ snapshot, dir, enabled: true })));

  startTestRuntime({
    // The host's entity types (AppState) too: the app's state lives in the database, as in the app
    entityTypes: [...HOST_ENTITY_TYPES, ...[...dependencies.values()].flatMap(({ snapshot }) => Object.values(snapshot.types.entities))],
    relationKinds: [...dependencies.values()].flatMap(({ snapshot }) => Object.values(snapshot.types.relKinds)),
    roles: [...dependencies.values()].flatMap(({ snapshot }) => Object.values(snapshot.types.roles)),
    packs: runtimePacks,
    serviceOverrides: serviceMocks,
    onboarding: {
      isComplete: () => appState.get().hasOnboarded,
      complete: () => appState.update({ hasOnboarded: true }),
    },
    // The app's own settings store, so a test writes and reads settings the way the app does rather than a fake
    settings: createSettingsService(createSettingsStore({ ears: boundEars,
      catalog: getSettingsCatalog,
      onCatalogChanged: onPackCatalogChanged,
    })),
  });
  if (options.registration) {
    await registerRuntimes(packDir, manifest, dependencies, options.registration, eventContracts);
  } else {
    for (const [depId, dependency] of dependencies) {
      const file = dependency.buildDir && path.join(dependency.buildDir, CONTENT_RUNTIME_FILE);
      if (!file || !fs.existsSync(file)) {
        throw new Error(`Dependency "${depId}" has no ${CONTENT_RUNTIME_FILE}; rebuild it, or update apack for built-in packs, then run \`apack pack build\` again`);
      }
      const { contentRuntime } = await import(pathToFileURL(file).href) as { contentRuntime: ContentRuntime };
      startTestRuntime({ entityTypes: Object.values(contentRuntime.entities), relationKinds: Object.values(contentRuntime.relKinds), roles: Object.values(contentRuntime.roles), rowRules: contentRuntime.rowRules });
      registry.registerContentRuntime(contentRuntime, originOf(dependency.manifest, dependency.dir));
      declareFeatures(dependency.manifest);
    }
    startTestRuntime({ entityTypes: Object.values(options.contentRuntime.entities), relationKinds: Object.values(options.contentRuntime.relKinds), roles: Object.values(options.contentRuntime.roles), rowRules: options.contentRuntime.rowRules });
    registry.registerContentRuntime(options.contentRuntime, originOf(manifest, packDir), options.appliers);
    declareFeatures(manifest);
    setAppPacks(registry, manifest.id);
  }

  context = { packDir, manifest, dependencies };
  beforeEach(({ task }) => {
    if (task.concurrent && runsAlongsideAnother(task)) {
      throw new Error(`"${task.name}" runs concurrently: harness tests share one database, service mocks and apps per file, so run them sequentially (no .concurrent or sequence.concurrent)`);
    }
    inTest = true;
    resetTestData();
  });
  afterEach(() => {
    inTest = false;
    // Every cleanup runs, whichever fails
    const failures: unknown[] = [];
    for (const stop of [stopRunningShells, stopRunningApps]) {
      try {
        stop();
      } catch (error) {
        failures.push(error);
      }
    }
    serviceMocks.clear();
    const errors = takeSystemErrors();
    if (errors.length > 0) {
      const described = errors.map((e) => `${e.source ?? 'unknown'}: ${e.message}`);
      failures.push(new Error(`Systems reported errors the test didn't take (takeSystemErrors()):\n  ${described.join('\n  ')}`));
    }
    if (failures.length > 0) throw failures.length === 1 ? failures[0] : new AggregateError(failures, 'Cleaning up after the test failed');
  });
}

export type { StartShellOptions, TestShell, TestSurface } from './shell.ts';

/**
 * Starts the app shell, the host's own, with `options.surfaces` registered as this pack's, and binds the frontend host
 * to it: `openSurface`, `untypedOpenSurface` and `useShell()` reach it, and a test app's systems (`startApp`) and the
 * surfaces reach each other over the harness's bus. It stops after the test.
 */
export async function startShell(options: StartShellOptions): Promise<TestShell> {
  if (!context) throw new Error('startShell() runs in a test: call setupPackTests() from a vitest setup file first');
  if (!context.entityDestinations) {
    const { snapshot } = readPackBuild(path.join(context.packDir, 'dist'));
    if (snapshot.declarationRevision !== _declarationRevision(context.manifest)) {
      throw new Error('The built declarations differ from the test pack manifest. Run `apack pack build` before starting a shell.');
    }
    context.entityDestinations = snapshot.entityDestinations;
  }
  return startShellFor(context.manifest.id, options, runtimePacks, context.entityDestinations);
}

/** Registers the pack's runtime and its dependencies' (loaded from their cached runtime/index.cjs), as the app does */
async function registerRuntimes(packDir: string, manifest: PackManifest, dependencies: ReadonlyMap<string, CachedDependency>,
  registration: PackRegistration, eventContracts?: Readonly<PackEventContracts>): Promise<void> {
  for (const [depId, dependency] of dependencies) {
    assertPackServiceRequirements(registry.catalog.getSnapshot(), { origin: 'installed', declaration: dependency.manifest });
    const runtimeEntry = path.join(dependency.dir, 'runtime', 'index.cjs');
    if (!fs.existsSync(runtimeEntry)) {
      throw new Error(`Dependency "${depId}" has no runtime/index.cjs in ${path.relative(packDir, dependency.dir)}; rebuild it, or update apack for built-in packs, then run \`apack pack build\` again`);
    }
    const contentDir = path.join(dependency.dir, 'runtime', 'content');
    const runtime = await loadDependencyRuntime(packDir, depId, runtimeEntry, fs.existsSync(contentDir) ? contentDir : undefined);
    startTestRuntime({ entityTypes: Object.values(runtime.registration.ears?.entities ?? {}), relationKinds: Object.values(runtime.registration.ears?.relKinds ?? {}), roles: Object.values(runtime.registration.ears?.roles ?? {}), rowRules: runtime.registration.ears?.rowRules });
    registry.registerPack(runtime.registration, originOf(dependency.manifest, dependency.dir, dependency.snapshot.eventContracts));
  }
  startTestRuntime({ entityTypes: Object.values(registration.ears?.entities ?? {}), relationKinds: Object.values(registration.ears?.relKinds ?? {}), roles: Object.values(registration.ears?.roles ?? {}), rowRules: registration.ears?.rowRules });
  registry.registerPack(registration, originOf(manifest, packDir, eventContracts));
  setAppPacks(registry, manifest.id);
}

export interface ImportContentOptions {
  /** Content entries to write; defaults to every entry naming a format without a pack applier (actions and flows need the app) */
  keys?: string[];
  mode?: ImportMode;
}

/**
 * Compiles the pack's content entries (with its own and its dependencies' formats) and content them into
 * the in-memory database, through the registered content writers. Returns each key's counts.
 */
export async function importContent(options: ImportContentOptions = {}): Promise<Record<string, ImportResult>> {
  if (!context) throw new Error('Call setupPackTests() from a vitest setup file before importContent()');
  const { packDir, manifest, dependencies } = context;
  const resolved = resolveContentSources(manifest, packDir, dependencies);
  const keys = options.keys ?? Object.entries(resolved).filter(([, source]) => source.kind === 'format' && !source.applier).map(([key]) => key);
  const unknown = keys.filter((key) => !(key in resolved));
  if (unknown.length > 0) throw new Error(`No content sources ${unknown.join(', ')} in apack.json`);

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-pack-content-'));
  const { register, tsImport } = await import('tsx/esm/api');
  // The SDK's own compilers import TypeScript sources (flows, actions) that use the pack's #generated imports
  const unregister = register();
  try {
    await compilePack({
      packDir,
      outputDir,
      packConfig: { name: manifest.id, sources: Object.fromEntries(keys.map((key) => [key, resolved[key]])) },
      // Flows validate against the registered steps (the pack's and its dependencies' runtimes)
      definitions: { steps: registry.steps(), artifacts: registry.artifacts(), blocks: registry.blocks() },
      importModule: (file) => tsImport(file, import.meta.url) as Promise<Record<string, unknown>>,
      log: () => {},
    });
    // Registered appliers whose key wasn't compiled find no content file and skip
    const index = parseContentIndex(JSON.parse(fs.readFileSync(path.join(outputDir, CONTENT_INDEX_FILE), 'utf-8')));
    const written = new Set(index.entries.filter((entry) => entry.written).map((entry) => entry.key));
    const result = importCompiledContent({ compiledDir: outputDir, mode: options.mode });
    return Object.fromEntries(Object.entries(result).filter(([key]) => written.has(key)));
  } finally {
    await unregister();
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

/**
 * Compiles flow DSL and imports it as the flow applier does (the SDK's flow repository): steps name actions and
 * prompts and flows already in the database, and a flow marked `root: true` is the root flow the brain runs when the app starts.
 * Import before `startApp`. In the app, other flows run as subflows the root flow spawns:
 *
 *   importFlows({ 'Root Flow': { root: true, tracks: [entry([subflow('Memo Flow')], [keepAlive()])] } });
 */
export function importFlows(dsl: FlowDSL): void {
  const byLabel = (rows: Array<{ id: string; label?: string }>) => new Map(rows.map((row) => [String(row.label), row.id]));
  const flows = byLabel(untypedQuery('Flow').pickAll() as Array<{ id: string; label?: string }>);
  flowRepository.importFromDSL(compileFlowDSL(dsl, { actions: byLabel(actionRepository.all()), prompts: byLabel(promptRepository.all()), flows }));
}

