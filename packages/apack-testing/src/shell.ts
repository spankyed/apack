import { boundEars } from '@apackdev/sdk/ears';
// The app shell in a pack's unit tests: the host's own shell machine, run over the in-memory bus the harness's test
// apps use, with the test pack's surfaces registered, so a pack's frontend (navigation, the shell's state, sends to
// its systems) is tested as the app runs it rather than against a stand-in.
import { createActor, type AnyActorRef, type AnyStateMachine } from 'xstate';
import { createFePackRegistry, createShellMachine, describeFailure, HOST, type ShellClient, type ShellConnection } from '@apackdev/host/fe';
import type { Message } from '@apackdev/sdk/events';
import { resolveName, type FeatureRef } from '@apackdev/sdk/ids';
import type { HostShell, SurfaceDefinition, PackFERegistration } from '@apackdev/sdk/fe';
import { nativeFrontendDeclarationFixture, startFeTestRuntime, testRootEvents } from '@apackdev/sdk/testing';
import { _isFeHostBound, type FePackRegistryView, type PackExtensionsView } from '@apackdev/sdk/runtime';
import { testViews } from './app.ts';

/** One of the pack's surfaces, as a test registers it: its state machine, and whatever else of its definition it needs */
export type TestSurface = { state: AnyStateMachine } & Partial<Omit<SurfaceDefinition, 'state'>>;

export interface StartShellOptions {
  /**
   * The pack's surfaces the shell runs, by feature id: each one's state machine. A surface's components import `.vue`
   * files, which a unit test doesn't load, so the test passes the machines rather than the surface modules
   */
  surfaces: Record<string, TestSurface>;
  /** The feature whose surface the shell opens first, as the pack's default; the first listed when unset */
  defaultSurface?: string;
  /** Roles the features play (`apack.json` `features[].designation`), by feature id */
  designations?: Record<string, string>;
}

export interface TestShell {
  /**
   * The shell, as frontend code reaches it (the SDK's `HostShell`). Published declarations name only published
   * packages, and the shell's machine is the host's
   */
  actor: HostShell;
  /** The ref of the surface open */
  opened(): string;
  /** A surface's running actor, named as the pack names it (its own by feature id, any other as `<packId>/<featureId>`) */
  surface(name: string): AnyActorRef;
  /** What the shell told the user went wrong: `title` and `detail`, a toast or the error page, in order */
  notices: Array<{ title: string; detail?: string }>;
  /** Stops the shell and forgets the frontend host it bound; the harness does it after each test */
  stop(): void;
}

const running = new Set<TestShell>();

/**
 * `frontend`, with the lookups it shares with the backend (roles, artifacts, blocks) answered by `backend`
 * first. The SDK reads those through a bound frontend host whenever one is bound, which in the renderer is right; in
 * a test that also runs the pack's systems, it would hide their shared contributions. Backend steps use the
 * backend host directly. The frontend comes second, for a role only a surface in this test plays.
 */
function backendFirst(frontend: FePackRegistryView, backend: PackExtensionsView): FePackRegistryView {
  return {
    onChanged: listener => frontend.onChanged(listener),
    surfaces: () => frontend.surfaces(),
    textEditor: () => frontend.textEditor(),
    stepBindings: () => frontend.stepBindings(),
    artifactBindings: () => frontend.artifactBindings(),
    blockBindings: () => frontend.blockBindings(),
    referenceTypes: () => frontend.referenceTypes(),
    referenceCategories: () => frontend.referenceCategories(),
    appExtension: (slot) => frontend.appExtension(slot),
    designation: (role) => backend.designation(role) ?? frontend.designation(role),
    artifact: (type) => backend.artifact(type) ?? frontend.artifact(type),
    artifacts: () => byType(backend.artifacts(), frontend.artifacts()),
    block: (type) => backend.block(type) ?? frontend.block(type),
    blocks: () => byType(backend.blocks(), frontend.blocks()),
  };
}

/**
 * The backend's definitions, with any the frontend has and it does not — the plural counterpart of the
 * `backend.x(type) ?? frontend.x(type)` above, which the three list lookups did without, so a definition
 * only the frontend had was missing from a listing while being found by name.
 *
 * `startShell` registers no step, artifact or block of its own (its frontend registration is built from
 * `options.surfaces`), so the frontend half is empty in every test today. It is here because the asymmetry
 * is the kind that is invisible until something relies on it.
 */
function byType<T extends { type: string }>(backend: readonly T[], frontend: readonly T[]): T[] {
  const merged = new Map(frontend.map((item) => [item.type, item]));
  for (const item of backend) merged.set(item.type, item);
  return [...merged.values()];
}

/** Stops every shell a test started; the harness calls it after each test */
export function stopRunningShells(): void {
  // The copy is the point: `stop()` deletes from `running`, so this iterates a set the body is shortening.
  // eslint-disable-next-line no-useless-spread
  for (const shell of [...running]) shell.stop();
}

/**
 * Starts the app shell with `options.surfaces` registered as `packId`'s and binds the frontend host to it, so
 * `openSurface`, `untypedOpenSurface` and `useShell()` reach it. Its client is the harness's bus: what the shell and
 * `sendToSystem` send reaches a test app's systems, and what those systems send surfaces reaches the surfaces' actors.
 * Lookups the backend shares with it (roles, artifacts, blocks) read `backend` first. Resolves once the shell
 * is connected and has read the (empty) loaded packs, as a window is once the app is up.
 */
export async function startShell(packId: string, options: StartShellOptions, backend: PackExtensionsView, entityDestinations: Readonly<Record<string, string>>): Promise<TestShell> {
  if (_isFeHostBound()) {
    throw new Error(
      'A frontend host is already bound in this test file: startShell() binds its own, so use it in place of '
      + 'startFeTestRuntime(), and start one shell per test (the harness stops it after each)',
    );
  }
  const ids = Object.keys(options.surfaces);
  if (ids.length === 0) throw new Error('startShell() needs at least one surface: the shell opens one when it starts');
  const defaultSurface = options.defaultSurface ?? ids[0];
  if (!ids.includes(defaultSurface)) throw new Error(`defaultSurface "${defaultSurface}" isn't one of the surfaces: ${ids.join(', ')}`);

  const packs = createFePackRegistry();
  const registration: PackFERegistration = {
    id: packId,
    features: Object.fromEntries(ids.map((id) => [id, {
      surface: { label: id, icon: {}, canvas: {}, ...options.surfaces[id] },
      ...(options.designations?.[id] && { designation: options.designations[id] }),
      ...(id === defaultSurface && { default: true as const }),
    }])),
  };
  packs.registerPackFE({ kind: 'native', declaration: { ...nativeFrontendDeclarationFixture(registration),
    entityDestinations: Object.fromEntries(Object.entries(entityDestinations).filter(([, feature]) => ids.includes(feature))) } }, registration);

  const stops: Array<() => void> = [];
  // What the systems send while the shell is starting (a surface asking for its data as it's spawned is answered at
  // once over the in-memory bus) is held until the shell subscribes, as a socket would deliver it later
  let connection: ShellConnection | undefined;
  const held: Message[] = [];
  stops.push(testRootEvents.onOutgoing((message) => {
    if (connection) connection.onMessage(message);
    else held.push(message);
  }));
  const client: ShellClient = {
    send: (message) => testRootEvents.emitIncoming(message),
    subscribe: (next) => {
      // Connected once the shell has started, and told the app's state as a window is on connecting
      queueMicrotask(() => {
        connection = next;
        next.onConnected();
        next.onMessage({ to: HOST.application, event: { type: 'CLIENT_CONNECTED', hasOnboarded: true, surfaceVisibility: {} } });
        for (const message of held.splice(0)) next.onMessage(message);
      });
      return () => { if (connection === next) connection = undefined; };
    },
    packClientReady: async (id) => testRootEvents.emitPackClientConnected(id),
    // The test's surfaces are registered up front, as a built-in pack's are: no external pack frontends to load
    loadedPacks: async () => [],
    entityExists: async (id, signal) => { signal.throwIfAborted(); return boundEars().query.ids(id).exists(); },
    // The test file's views, which a test app's watchView shares: a component's useView is one more subscriber
    watchView: (request, observer) => testViews().watch(request, observer),
    describeConnection: async () => 'A unit test\'s shell: its client is the harness\'s in-memory bus',
  };

  const notices: TestShell['notices'] = [];
  const actor = createActor(createShellMachine({
    packs,
    catalog: { status: () => 'ready', subscribe: () => () => {}, surfaces: () => [...packs.surfaceBindings()].map(([featureRef, accepted]) => ({
      featureRef: featureRef as FeatureRef, packId: accepted.packId, origin: 'native' as const, enabled: true, declaration: accepted.declaration, opens: accepted.opens,
    })) },
    client,
    packFrontends: { load: async () => null, unload: () => {} },
    storage: { loadPanelSizes: () => undefined, savePanelSizes: () => {} },
    notify: {
      error: (title, detail) => { notices.push({ title, detail }); },
      errorPage: (title, detail) => { notices.push({ title, detail: describeFailure(detail) }); },
    },
  }), { systemId: HOST.application, input: { ownsLastActiveSurface: false } });
  // Bound before the shell starts: starting it spawns the surfaces' actors, which may reach the frontend host
  stops.push(startFeTestRuntime({ application: actor, client, packs: backendFirst(packs, backend) }));
  const started = actor.start();
  stops.unshift(() => started.stop());

  const shell: TestShell = {
    actor: started,
    opened: () => started.getSnapshot().context.activeSurface.id,
    surface: (name) => {
      const ref = resolveName(name, packId);
      const surface = started.system.get(ref) as AnyActorRef | undefined;
      if (!surface) throw new Error(`No surface is running at "${ref}"`);
      return surface;
    },
    notices,
    stop: () => {
      if (!running.delete(shell)) return;
      for (const stop of stops) stop();
    },
  };
  running.add(shell);

  // Connected, and the loaded packs read: until they are, the shell holds a surface it's asked for that isn't there
  await new Promise((resolve) => setTimeout(resolve, 0));
  return shell;
}
