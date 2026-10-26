// The SDK reaches the app only through the runtime bound with bindHost: bound once, required by what goes over
// the app's bus or its services, and not by logging, which writes to the console without an app (tooling)
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { _createTestEngine } from '../../src/testing/index.ts';
import { untypedQuery, untypedCreate } from '@apackdev/sdk/ears';
import { repository } from '@apackdev/sdk/services';
import { bindHost, unbindHost, boundHost, type HostRuntime } from '../../src/runtime/host-runtime.ts';
import { _rootEvents } from '../../src/runtime/root-events.ts';
import { onConnected, onIncoming, untypedBroadcastToSurface, untypedSendToSystem } from '../../src/events/index.ts';
import { createLogger, onLog, reportError } from '../../src/logger/index.ts';
import { _createPackServices, _settingsHandle } from '../../src/services/index.ts';
import * as serviceModule from '../../src/services/index.ts';
import type { PackServiceAccess } from '../../src/services/index.ts';
import type { SettingsService } from '../../src/services/settings.ts';
import { getAppVersion } from '../../src/env/index.ts';
import { getDesignated, hasDesignation } from '../../src/designations/index.ts';
import { stepRegistry } from '../../src/steps/registry.ts';
import { artifactRegistry } from '../../src/artifacts/registry.ts';
import { blockRegistry } from '../../src/blocks/registry.ts';
import { _contentWriterRegistry } from '../../src/content/writers.ts';
import { getSettingsCatalog, onPackCatalogChanged } from '../../src/framework/index.ts';
import { getCommands } from '../../src/commands/index.ts';
import { importCompiledContent, registeredContentKeys } from '../../src/utils/apply.ts';
import { getDslDeclarations } from '../../src/fe/dsl-reader.ts';
import { textEditorExtensionsRegistry } from '../../src/fe/text-editor-extensions.ts';
import { testPacksView } from '../../src/testing/packs.ts';

const serviceAccess = (settings: SettingsService): PackServiceAccess => ({ services: { settings }, servicesForAction: () => ({ settings }) });

const unused = () => { throw new Error('unused'); };
const engine = _createTestEngine({ entityTypes: ['Memo'] });
const runtime: HostRuntime = {
  transport: { rootEvents: _rootEvents },
  ears: engine,
  packs: testPacksView(),
  appVersion: '1.2.3',
  services: {
    onboarding: { isComplete: unused, complete: unused },
    appData: { reset: unused, exportBackup: unused, importBackup: unused, readBackupSummary: unused },
    runHistory: { start: unused, finish: unused, update: unused, get: unused, findChildren: unused, tree: unused, findRuns: unused, stopActive: unused, prune: unused },
    inference: {
      generateText: unused, streamText: unused, createAgent: unused, embed: unused, embedMany: unused,
      generateImage: unused, generateSpeech: unused, transcribe: unused, rerank: unused,
    },
    secrets: { status: unused, list: unused, select: unused, rename: unused, delete: unused },
    filesystem: { writeFile: unused, readFile: unused, exists: unused, mkdir: unused, readDir: unused, remove: unused, rename: unused, stat: unused },
    settings: {
      get: unused, set: unused, reset: unused, getAll: unused, getSnapshot: unused, getOverrides: unused,
      enterRecovery: unused, getRecovery: unused, recover: unused,
      replaceAll: unused, removeOverrides: unused, resetAll: unused, whileReplacingData: unused,
      forPack: unused, onChange: unused,
    },
  },
};


afterEach(() => {
  unbindHost();
  vi.restoreAllMocks();
});

describe('with no app bound', () => {
  it('throws, naming bindHost, for what needs the app', async () => {
    const needsApp: Array<[string, () => unknown]> = [
      ['untypedBroadcastToSurface', () => untypedBroadcastToSurface('memos', { type: 'MEMO_ADDED' })],
      ['untypedSendToSystem', () => untypedSendToSystem('memos', { type: 'ADD_MEMO' })],
      ['onConnected', () => onConnected(() => {})],
      ['onIncoming', () => onIncoming(() => {})],
      ['onLog', () => onLog(() => {})],
      ['reportError', () => reportError({ error: new Error('boom'), source: 'memos' })],
      ['_rootEvents', () => _rootEvents.emitLog({ level: 'info', message: 'x' })],
      ['getAppVersion', () => getAppVersion()],
      ['services.inference', () => boundHost().services.inference.generateText({ model: 'openai:gpt-5', prompt: 'hi' })],
      ['services.appData', () => boundHost().services.appData.reset()],
      ['services.onboarding', () => boundHost().services.onboarding.isComplete()],
      ['services.runHistory', () => boundHost().services.runHistory.findRuns()],
      ['services.secrets', () => boundHost().services.secrets.list()],
      ['services.filesystem', () => boundHost().services.filesystem.readFile('/tmp/x')],
      ['repository', () => repository.memoQueries],
    ];
    for (const [name, use] of [['untypedQuery', () => untypedQuery('Memo')], ['untypedCreate', () => untypedCreate('Memo')]] as const) {
      expect(use, name).toThrow('No EARS engine is bound');
    }
    for (const [name, use] of needsApp) expect(use, name).toThrow('bindHost');
  });

  it('throws, naming bindHost (or bindFeHost in the frontend), for what packs registered', () => {
    const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unbound-content-'));
    fs.writeFileSync(path.join(contentDir, 'content.json'), JSON.stringify({ version: 1, packId: 'memo-pack', entries: [] }));
    onTestFinished(() => fs.rmSync(contentDir, { recursive: true, force: true }));
    const lookups: Array<[string, () => unknown]> = [
      ['getDesignated', () => getDesignated('brain')],
      ['hasDesignation', () => hasDesignation('brain')],
      ['artifactRegistry.get', () => artifactRegistry.get('code')],
      ['artifactRegistry.all', () => artifactRegistry.all()],
      ['blockRegistry.get', () => blockRegistry.get('choice')],
      ['blockRegistry.all', () => blockRegistry.all()],
    ];
    for (const [name, use] of lookups) {
      expect(use, name).toThrow(/bindHost\(runtime\).*\(the renderer with bindFeHost\(runtime\)\)/);
    }
    const backendLookups: Array<[string, () => unknown]> = [
      ['stepRegistry.get', () => stepRegistry.get('action')],
      ['stepRegistry.all', () => stepRegistry.all()],
      ['stepRegistry.triggers', () => stepRegistry.triggers()],
      ['_contentWriterRegistry.get', () => _contentWriterRegistry.get('Memo')],
      ['importCompiledContent', () => importCompiledContent({ compiledDir: contentDir })],
      ['registeredContentKeys', () => registeredContentKeys('memo-pack')],
      ['getSettingsCatalog', () => getSettingsCatalog()],
      ['onPackCatalogChanged', () => onPackCatalogChanged(() => {})],
      ['getCommands', () => getCommands()],
    ];
    for (const [name, use] of backendLookups) expect(use, name).toThrow('bindHost(runtime)');
    for (const [name, use] of [['getDslDeclarations', () => getDslDeclarations()], ['textEditorExtensionsRegistry.getAll', () => textEditorExtensionsRegistry.getAll()]] as const) {
      expect(use, name).toThrow('bindFeHost(runtime)');
    }
  });

  it('logs to the console, redacted', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    createLogger('installed-packs').info('Installed', { pack: 'memos' });
    createLogger().error('key sk-proj-abcdef1234567890 rejected');
    expect(info.mock.calls).toEqual([['[installed-packs]', 'Installed', { pack: 'memos' }]]);
    expect(error.mock.calls).toEqual([['key [redacted] rejected']]);
  });
});

describe('bindHost', () => {
  it('preserves the draft comparison through the caller-bound services facade', () => {
    const preferences: SettingsService = {
      get: vi.fn() as SettingsService['get'], set: vi.fn(), reset: vi.fn(), onChange: vi.fn(),
    };

    bindHost(runtime);
    const target = { kind: 'pack', packId: 'memo-pack', groupId: 'assistant' } as const;
    const condition = { runId: 'backend-run', expected: { exists: true, value: 'Ada' } };
    const generated = _createPackServices();
    const revoke = generated.bindServices(serviceAccess(preferences));
    generated.services.settings.set(target, ['name'], 'Grace', condition);
    revoke();
    expect(() => generated.services.settings.reset(target)).toThrow('until the host accepts');
    expect(preferences.set).toHaveBeenCalledWith(target, ['name'], 'Grace', condition);
    expect(Object.hasOwn(serviceModule, 'services')).toBe(false);
  });

  it('binds once: binding again throws', () => {
    bindHost(runtime);
    expect(getAppVersion()).toBe('1.2.3');
    expect(() => bindHost(runtime)).toThrow('already bound');
  });

  it("binds the app's engine for the SDK's engine operations, until unbound", () => {
    bindHost(runtime);
    const id = untypedCreate('Memo').set('title', 'bound').id();
    expect(engine.query.ids(id).pickOne()).toMatchObject({ title: 'bound' });
    expect(untypedQuery('Memo').ids()).toEqual([id]);
    unbindHost();
    expect(() => untypedQuery('Memo')).toThrow('No EARS engine is bound');
  });

  it("reads the bound app's services on each call", () => {
    bindHost(runtime);
    expect(() => boundHost().services.secrets.list()).toThrow('unused');
  });
});


describe('generated settings authority', () => {
  const target = { kind: 'app' } as const;
  const preferences = (): SettingsService => ({
    get: vi.fn() as SettingsService['get'], set: vi.fn(), reset: vi.fn(), onChange: () => vi.fn(),
  });

  it('accepts a predeclared handle once and permanently revokes it across rebind', () => {
    const generated = _createPackServices();
    const handle = generated.settingsHandle(target);
    for (const operation of [() => handle.get(), () => handle.set({ path: [], value: {} }),
      () => handle.reset(), () => handle.onChange(() => {})]) {
      expect(operation).toThrow('until the host accepts');
    }
    const first = preferences();
    const revoke = generated.bindServices(serviceAccess(first));
    handle.reset();
    expect(first.reset).toHaveBeenCalledOnce();
    revoke();
    const next = preferences();
    generated.bindServices(serviceAccess(next));
    for (const operation of [() => handle.get(), () => handle.set({ path: [], value: {} }),
      () => handle.reset(), () => handle.onChange(() => {})]) {
      expect(operation).toThrow('revoked');
    }
    generated.settingsHandle(target).reset();
    expect(next.reset).toHaveBeenCalledOnce();
  });

  it('permanently revokes retained services and handles across a new binding', () => {
    const generated = _createPackServices();
    expect(() => generated.services.settings).toThrow('until the host accepts');
    const first = preferences();
    const revoke = generated.bindServices(serviceAccess(first));
    const retained = generated.services.settings;
    const handle = _settingsHandle(target, retained);
    expect(() => generated.bindServices(serviceAccess(first))).toThrow('already bound');
    handle.reset();
    expect(first.reset).toHaveBeenCalledOnce();
    revoke();
    const next = preferences();
    const revokeNext = generated.bindServices(serviceAccess(next));
    revoke();
    for (const call of [() => retained.get(target), () => retained.set(target, [], {}),
      () => retained.reset(target), () => retained.onChange(() => {}),
      () => handle.get(), () => handle.set({ path: [], value: {} }), () => handle.reset()]) {
      expect(call).toThrow('revoked');
    }
    generated.services.settings.reset(target);
    expect(next.reset).toHaveBeenCalledOnce();
    revokeNext();
  });

  it('attempts every unsubscribe, suppresses late notifications and makes revocation idempotent', () => {
    const generated = _createPackServices();
    const stopFirst = vi.fn(() => { throw new Error('broken unsubscribe'); });
    const stopSecond = vi.fn();
    const callbacks: Array<Parameters<SettingsService['onChange']>[0]> = [];
    const first = preferences();
    first.onChange = listener => { callbacks.push(listener); return callbacks.length === 1 ? stopFirst : stopSecond; };
    const revoke = generated.bindServices(serviceAccess(first));
    const listener = vi.fn();
    const stop = generated.services.settings.onChange(listener);
    generated.services.settings.onChange(listener);
    callbacks[0]('written');
    expect(listener).toHaveBeenCalledOnce();
    expect(revoke).toThrow(AggregateError);
    expect(stopFirst).toHaveBeenCalledOnce();
    expect(stopSecond).toHaveBeenCalledOnce();
    expect(stop).not.toThrow();
    expect(revoke).not.toThrow();
    callbacks[0]('written'); callbacks[1]('written');
    expect(listener).toHaveBeenCalledOnce();
    expect(() => generated.services.settings).toThrow('until the host accepts');
    generated.bindServices(serviceAccess(preferences()))();
  });
});
