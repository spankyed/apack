// The frontend host a pack's unit tests run against. bindFeHost is the renderer's, bound once at boot
// and never taken back; a test binds and unbinds per file, so that lifecycle lives here, next to
// startTestRuntime, rather than a pack reaching for the host's own unbind.
import { bindFeHost, unbindFeHost, type FeClient, type FeHostRuntime, type FePackRegistryView } from '../runtime/fe-host.ts';
import type { SecretsClient } from '../fe/secrets-client.ts';
import type { PackCatalogView } from '../framework/catalog-view.ts';
import type { HostShell } from '../fe/shell.ts';
import type { SettingsPort } from '../fe/settings.ts';

/** A frontend with nothing registered: what a test sees before its own pack's frontend is bound */
const noFrontends: FePackRegistryView = {
  onChanged: () => () => {},
  designation: () => undefined,
  artifact: () => undefined,
  artifacts: () => [],
  block: () => undefined,
  blocks: () => [],
  surfaces: () => [],
  textEditor: () => [],
  stepBindings: () => new Map(),
  artifactBindings: () => new Map(),
  blockBindings: () => new Map(),
  referenceTypes: () => new Map(),
  referenceCategories: () => new Map(),
  appExtension: () => undefined,
};

/**
 * The shell a test gets when it passes none. The shell is the host's, which the SDK doesn't carry, so reaching this
 * one says where the real one is: `startShell()` from `@apackdev/testing/harness` binds it
 */
const noShell = new Proxy({} as HostShell, {
  get: (_target, member) => {
    throw new Error(`This test has no app shell (it reached for its ${String(member)}): start one with startShell() from @apackdev/testing/harness, which binds the frontend host itself`);
  },
});

/**
 * The settings a test gets when it passes none. Reaching them without saying what they are is a test that can't know
 * what it asserts, so this says where the usable one is rather than answering with an empty document.
 */
const noSettings = new Proxy({} as SettingsPort, {
  get: (_target, member) => {
    throw new Error(`This test has no settings (it reached for their ${String(member)}): pass settings: fakeSettings({ … }) from @apackdev/sdk/testing to startFeTestRuntime`);
  },
});

const noSecrets = new Proxy({} as SecretsClient, {
  get: (_target, member) => { throw new Error(`This test has no secrets client (it reached for ${String(member)}): pass secrets to startFeTestRuntime`); },
});

const noClient = new Proxy({} as FeClient, {
  get: (_target, member) => { throw new Error(`This test has no API client (it reached for ${String(member)}): pass client to startFeTestRuntime`); },
});

const noCatalog = new Proxy({} as PackCatalogView, {
  get: (_target, member) => { throw new Error(`This test has no declaration catalog (it reached for ${String(member)}): pass catalog to startFeTestRuntime`); },
});

/** What a test overrides of the frontend host; everything else stands in as unusable, since a test that reaches it means the test is wrong */
export interface FeTestRuntimeOptions extends Partial<Omit<FeHostRuntime, 'client'>> {
  /** The members of the API client the test uses; the others throw, naming themselves, when reached */
  client?: Partial<FeClient>;
}

/** The client a test passed, with each member it didn't pass standing in as unusable */
const partClient = (given: Partial<FeClient>): FeClient => new Proxy(given as FeClient, {
  get: (target, member) => {
    if (member in target) return target[member as keyof FeClient];
    throw new Error(`This test's API client has no ${String(member)}: pass it in client to startFeTestRuntime`);
  },
});

/**
 * Binds a frontend host for this test file, and returns the function that forgets it again:
 *
 *     const stopFeTestRuntime = startFeTestRuntime();
 *     afterAll(stopFeTestRuntime);
 *
 * Nothing is registered unless the test passes it, so an extension that registers itself on import
 * shows up as one this returned.
 */
export function startFeTestRuntime(options: FeTestRuntimeOptions = {}): () => void {
  bindFeHost({
    ...(options.diagnostics && { diagnostics: options.diagnostics }),
    catalog: options.catalog ?? noCatalog,
    application: options.application ?? noShell,
    secrets: options.secrets ?? noSecrets,
    settings: options.settings ?? noSettings,
    client: options.client ? partClient(options.client) : noClient,
    packs: options.packs ?? noFrontends,
  });
  return stopFeTestRuntime;
}

/** Forgets the frontend host `startFeTestRuntime` bound, so the next test file binds its own */
export function stopFeTestRuntime(): void {
  unbindFeHost();
}
