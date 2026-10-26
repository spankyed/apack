// API keys in the API: the secrets procedures (the only way a value reaches the backend), and logs and error reports
// that redact keys.
//
// The vault-failure cases repeat a condition `@apackdev/host` already covers, on purpose, and the level they add is
// the procedure boundary. `apack-host/tests/secrets/store.spec.ts` drives a failing vault straight into
// `createSecretsStore` (which takes `osVault`/`fileVault`) and asserts the store's own status and transitions. What
// it cannot assert is what a renderer learns: that `secrets.add` rejects naming the backend, that a CHANGED event
// still reaches the client, and that `secrets.list` carries the unavailable status out. That is tRPC over the host
// store over the vault, which only exists composed — the same reason `boot-recovery.spec.ts` beside this one repeats
// two host unit tests through the real boot.
//
// It mocks the vault module rather than injecting one because the procedures use the module-level `secretsStore`
// singleton, which builds its own vaults; injection is reachable from host's suite and not from here. `@apackdev/host`
// publishes `./secrets/vault` so this names it as a specifier instead of reaching into another package's `src/`
// (`repo-checks/tests/spec-placement.spec.ts`).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@apackdev/sdk/events';
import type { EARS } from '@apackdev/ears';

// The test environment keeps the data key in a file vault; `vaultDown` swaps it for an OS credential store that fails,
// the way a system without one (or a locked keyring) does
const vaultDown = vi.hoisted(() => ({ value: false }));
vi.mock('@apackdev/host/secrets/vault', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apackdev/host/secrets/vault')>();
  const fail = () => { throw new actual.KeyVaultUnavailableError('Secret Service', new Error('no dbus')); };
  const down = { backend: 'Secret Service', protection: 'os-keystore' as const, get: fail, set: fail, delete: fail };
  return { ...actual, fileKeyVault: (file: string) => vaultDown.value ? down : actual.fileKeyVault(file) };
});

// The host init opens the app's stores: point them at a throwaway data dir (the test environment keeps keys' data key in a file)
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-secrets-'));
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-secrets-logs-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;
process.env.APACK_LOG_DIR = logDir;
const { openAppStore } = await import('../../src/runtime/index.ts');
const { database: store, engine, packs } = openAppStore();
const { secretsRouter } = await import('../../src/transport/secrets.ts');
const { rootEvents } = await import('../../src/transport/emitter.ts');
const { createLogger, reportError } = await import('@apackdev/sdk/logger');
const { originalConsole, initializeLogCapture, restoreConsole } = await import('../../src/adapters/logging.ts');
const { secretsStore, forwardSecretsChanges } = await import('@apackdev/host/secrets');
const { boundHost } = await import('@apackdev/sdk/runtime/internals');
const { services } = boundHost();
const { _getSecretsFilePath } = await import('@apackdev/sdk/utils');
const { setup } = await import('xstate');

const KEY = 'sk-proj-SPECKEY1234567890abcdefghij';
const caller = secretsRouter.createCaller({ client: 'c-test', closed: new AbortController().signal });
// What the API's boot registers; the settings system is registered in the first test, once it checks changes made before
forwardSecretsChanges(packs);
// A pack with a settings feature, whose system isn't running yet: a system is sent the event because it declares
// it, not because of any role it plays
packs.catalog.setNative([...packs.catalog.getSnapshot().native, { id: 'test', eventContracts: { settings: { system: { incoming: ['SECRETS_CHANGED'], outgoing: [] } } }, features: { settings: { description: 'Feature declaration fixture.',} } }]);
packs.registerPack({ id: 'test', features: { settings: {} } });
// The same pack again, now running that feature's system, which declares the event and so is sent it
const registerSettingsSystem = () => {
  packs.unregisterPack('test');
  packs.registerPack({ id: 'test', features: { settings: { system: { machine: setup({}).createMachine({}), receives: ['SECRETS_CHANGED'] } } } });
};

/** The incoming events `run` sends */
async function incomingDuring(run: () => Promise<unknown> | unknown): Promise<Message[]> {
  const incoming: Message[] = [];
  const stop = rootEvents.onIncoming((event) => { incoming.push(event); });
  try {
    await run();
  } finally {
    stop();
  }
  return incoming;
}
const CHANGED = { to: 'test/settings', event: { type: 'SECRETS_CHANGED' } };

afterAll(() => {
  store.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(logDir, { recursive: true, force: true });
});
beforeEach(() => secretsStore.clearAll());

describe('secrets procedures', () => {
  it('tell no one of changes before the settings system is registered', async () => {
    const warn = vi.spyOn(originalConsole, 'warn');
    const incoming = await incomingDuring(() => caller.add({ provider: 'openai', label: 'Work', value: KEY }));
    expect(incoming).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    registerSettingsSystem();
    expect(await incomingDuring(() => caller.rename({ id: secretsStore.list()[0].id, label: 'Old work' }))).toEqual([CHANGED]);
  });

  it('add, select, rename and delete keys, return no values, and tell the settings system without one', async () => {
    let added!: Awaited<ReturnType<typeof caller.add>>;
    let listed!: Awaited<ReturnType<typeof caller.list>>;
    let personal!: (typeof added)['secrets'][number];
    const incoming = await incomingDuring(async () => {
      added = await caller.add({ provider: 'openai', label: 'Work', value: KEY });
      personal = (await caller.add({ provider: 'openai', label: 'Personal', value: 'sk-personal-1234567890abcdef' })).secrets[1];
      await caller.select({ id: personal.id });
      await caller.rename({ id: added.secrets[0].id, label: 'Old work' });
      listed = await caller.list();
    });

    expect(listed.secrets.map((secret) => [secret.label, secret.selected])).toEqual([['Old work', false], ['Personal', true]]);
    expect(listed.status).toEqual({ protection: 'unprotected', backend: 'a file on this system' });
    expect(secretsStore.keyFor('openai')).toBe('sk-personal-1234567890abcdef');
    expect(JSON.stringify([added, listed])).not.toContain('sk-');
    expect(incoming).toEqual(Array(4).fill(CHANGED));

    await caller.delete({ id: personal.id });
    expect(() => secretsStore.keyFor('openai')).toThrow();
  });

  it('tell the settings system when packs change keys through services.secrets', async () => {
    const work = (await caller.add({ provider: 'openai', label: 'Work', value: KEY })).secrets[0];
    const incoming = await incomingDuring(() => {
      services.secrets.rename(work.id, 'Old work');
      services.secrets.select(work.id);
      services.secrets.delete(work.id);
    });
    expect(incoming).toEqual(Array(3).fill(CHANGED));
  });

  it("tell the settings system when adding a key fails for want of a credential store, so it can offer unprotected storage", async () => {
    // The first key stored: its data key is made now (clearing keeps the one already in use)
    fs.rmSync(_getSecretsFilePath(), { force: true });
    vaultDown.value = true;
    try {
      const incoming = await incomingDuring(() => expect(caller.add({ provider: 'openai', label: 'Work', value: KEY })).rejects.toThrow("Secret Service isn't available"));
      expect(incoming).toEqual([CHANGED]);
      expect((await caller.list()).status).toEqual({ protection: 'unavailable', backend: 'Secret Service' });
    } finally {
      vaultDown.value = false;
    }
  });

  it('rejects input that names no provider or carries no value', async () => {
    await expect(caller.add({ provider: 'nope' as never, label: 'Work', value: KEY })).rejects.toThrow();
    await expect(caller.add({ provider: 'openai', label: 'Work', value: '' })).rejects.toThrow();
  });

  it('services.secrets gives packs the metadata, without values', async () => {
    await caller.add({ provider: 'anthropic', label: 'Work', value: 'sk-ant-api03-1234567890abcdef' });
    expect(services.secrets.list()).toEqual([expect.objectContaining({ provider: 'anthropic', label: 'Work', selected: true })]);
    expect(JSON.stringify(services.secrets.list())).not.toContain('sk-ant');
    expect('value' in services.secrets.list()[0]).toBe(false);
  });

  it('services.appData.reset deletes stored keys once the database is emptied', async () => {
    await caller.add({ provider: 'openai', label: 'Work', value: KEY });
    engine.create('Prompt', { id: 'Prompt-before-reset' as EARS.EntityId, label: 'gone by then', inputs: {}, templateFn: 'return ""' });
    const rowAtChange: boolean[] = [];
    const stop = secretsStore.onChange(() => rowAtChange.push(engine.getRow('Prompt-before-reset' as EARS.EntityId) !== undefined));
    try {
      await services.appData.reset();
    } finally {
      stop();
    }
    expect(services.secrets.list()).toEqual([]);
    expect(rowAtChange).toEqual([false]);
  });

  it.each([
    ['is not JSON', '{"format": 1, "secrets": [tru'],
    ['is in a format the store does not know', JSON.stringify({ format: 99, secrets: [] })],
  ])('services.appData.reset completes when the stored keys file %s, and deletes it', async (_name, contents) => {
    fs.writeFileSync(_getSecretsFilePath(), contents);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(services.appData.reset()).resolves.toBeUndefined();
    } finally {
      warn.mockRestore();
    }
    expect(fs.existsSync(_getSecretsFilePath())).toBe(false);
    expect(services.secrets.list()).toEqual([]);
  });
});

describe('logs and error reports', () => {
  it('redact key-shaped strings and credential fields in every sink', () => {
    const logged: Array<Record<string, unknown>> = [];
    const stop = rootEvents.onLog((event) => { logged.push(event); });
    const console = vi.spyOn(originalConsole, 'error').mockImplementation(() => {});

    createLogger('spec').error(`Provider said: Incorrect API key provided: ${KEY}`, {
      event: { type: 'UPDATE', value: { apiKey: 'plain-credential', note: `pasted ${KEY}` } },
      error: new Error(`401 for ${KEY}`),
    });
    stop();
    const printed = JSON.stringify(console.mock.calls);
    console.mockRestore();

    const file = fs.readFileSync(path.join(logDir, 'app-events.log'), 'utf-8');
    for (const sink of [JSON.stringify(logged), printed, file]) {
      expect(sink).not.toContain('SPECKEY');
      expect(sink).not.toContain('plain-credential');
      expect(sink).toContain('[redacted]');
    }
  });

  /** What `run`'s console calls print through the console method `method` replaces, and emit as log events */
  function captureConsole(method: 'log' | 'error', run: () => void) {
    const logged: Array<Record<string, unknown>> = [];
    const stop = rootEvents.onLog((event) => { logged.push(event); });
    // The capture keeps the console method it replaces: spy on it first
    const printed = vi.spyOn(originalConsole, method).mockImplementation(() => {});
    initializeLogCapture();
    try {
      run();
    } finally {
      restoreConsole();
      stop();
    }
    const calls = printed.mock.calls;
    printed.mockRestore();
    return { printed: calls, logged };
  }

  it('redact what console calls print and capture', () => {
    const { printed, logged } = captureConsole('error', () => {
      console.error(new Error(`401 for ${KEY}`), { apiKey: 'plain-credential', body: `echo ${KEY}` });
    });

    expect(printed).toEqual([[expect.stringContaining('Error: 401 for [redacted]')]]);
    const file = fs.readFileSync(path.join(logDir, 'app-events.log'), 'utf-8');
    for (const sink of [JSON.stringify(logged), JSON.stringify(printed), file]) {
      expect(sink).not.toContain('SPECKEY');
      expect(sink).not.toContain('plain-credential');
      expect(sink).toContain('[redacted]');
    }
  });

  it('print console arguments the way the console does, without changing them', () => {
    const error = Object.assign(new Error('request failed', { cause: new Error('socket hang up') }), { code: 'ECONNRESET' });
    const shared = { label: 'Work' };
    const argument = { at: new Date('2026-01-02T03:04:05Z'), ids: new Map([['a', 1]]), tags: new Set(['x']), first: shared, second: shared, bytes: Buffer.from('hello') };
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let depth = 0; depth < 20_000; depth++) deep = (deep.next = {}) as Record<string, unknown>;

    const { printed, logged } = captureConsole('log', () => {
      console.log('%s failed:', 'sync', error, argument);
      console.log(root);
    });

    const [[text], [deepText]] = printed as string[][];
    expect(text).toMatch(/^sync failed: Error: request failed/);
    expect(text).toContain("code: 'ECONNRESET'");
    expect(text).toContain('[cause]: Error: socket hang up');
    expect(text).toContain('2026-01-02T03:04:05.000Z');
    expect(text).toContain("Map(1) { 'a' => 1 }");
    expect(text).toContain("Set(1) { 'x' }");
    expect(text).toMatch(/first: \{ label: 'Work' \},\s+second: \{ label: 'Work' \}/);
    expect(text).toContain('<Buffer 68 65 6c 6c 6f>');
    expect(deepText).toContain('[Object]');
    expect(logged.map((event) => event.message)).toEqual([text, deepText]);
    expect(argument.bytes).toBeInstanceOf(Buffer);
    expect(error.message).toBe('request failed');
  });

  it('redact a prefix-less key the app has used this session, wherever it is printed, and leave other long tokens alone', async () => {
    // Mistral and Cohere keys have no recognizable shape: the store registers a digest of each value it handles
    const MISTRAL = 'not-a-real-key-with-no-prefix-01';
    const OTHER = 'not-a-real-token-no-prefix-0003';
    await caller.add({ provider: 'mistral', label: 'Work', value: MISTRAL });
    expect(secretsStore.keyFor('mistral')).toBe(MISTRAL);

    const logged: Array<Record<string, unknown>> = [];
    const outgoing: Message[] = [];
    const stopLog = rootEvents.onLog((event) => { logged.push(event); });
    const stopOutgoing = rootEvents.onOutgoing((event) => { outgoing.push(event); });
    const printedError = vi.spyOn(originalConsole, 'error').mockImplementation(() => {});
    createLogger('spec').error(`Provider said: Incorrect API key provided: ${MISTRAL} (job ${OTHER})`);
    reportError({ error: new Error(`401 for ${MISTRAL} (job ${OTHER})`), source: 'spec' });
    stopLog();
    stopOutgoing();
    const printed = JSON.stringify(printedError.mock.calls);
    printedError.mockRestore();

    const captured = captureConsole('error', () => { console.error(`echo ${MISTRAL} (job ${OTHER})`); });
    const file = fs.readFileSync(path.join(logDir, 'app-events.log'), 'utf-8');
    for (const sink of [JSON.stringify(logged), printed, JSON.stringify(outgoing), JSON.stringify(captured), file]) {
      expect(sink).not.toContain(MISTRAL);
      expect(sink).toContain('[redacted]');
      expect(sink).toContain(OTHER);
    }
  });

  it('redact keys from system error reports', () => {
    const outgoing: Message[] = [];
    const stop = rootEvents.onOutgoing((event) => { outgoing.push(event); });
    reportError({ error: new Error(`Incorrect API key provided: ${KEY}`), source: 'spec' });
    stop();
    expect(JSON.stringify(outgoing)).not.toContain('SPECKEY');
    expect(JSON.stringify(outgoing)).toContain('[redacted]');
  });
});
