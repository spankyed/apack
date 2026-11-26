// The host `application` system keeps the app shell's state: which surfaces' tabs the user showed or hid, and
// the surface last open. It stores them in AppState, and tells the application surface the visibility again whenever
// a choice or a pack's defaults change, so every window agrees.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { system as createStateSystem, type EventsOf } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import { isState } from '@apackdev/sdk/framework';
import { resetTestData } from '@apackdev/sdk/testing';
import '../../packs/runtime/test-host.ts';
import { registry } from '../../packs/runtime/test-host.ts';
import { appState } from '../../../src/app-state/index.ts';
import { createApplicationSystem } from '../../../src/features/application/be/system.ts';
import { documentRepository } from '@apackdev/sdk/repositories';
import { COMMANDS_DOCUMENT_TYPE } from '@apackdev/sdk/commands';

/** A registry whose features declare `defaults` as their tabs' visibility */
const withDefaults = (visibility: Record<string, boolean>, surfaceIds: string[] = []) => ({
  surfaceDefaults: () => visibility,
  surfaceIds: () => surfaceIds,
  loadedPacks: () => [],
  getPackRuntime: () => null,
});

const commandNames = (event: unknown) => ((event as { commands: Array<{ name: string }> }).commands).map((command) => command.name);

/** The watcher compares on a microtask, so a write's effect is one turn away */
const settle = () => Promise.resolve();

/** A stored command: one field of one document of the commands type, which is all a command is */
const storeCommand = (name: string, placeholder: string) => documentRepository.create({
  name: `${name} list`,
  content: [{ type: 'field', fields: [{ key: name, value: placeholder }] }],
  documentType: COMMANDS_DOCUMENT_TYPE,
});

type SentMessage = { to: string; event: { type: string; [key: string]: unknown } };

let stop: (() => void) | undefined;

/** The application system, and what it sends to surfaces */
function runApplicationSystem(
  defaultsOrRegistry: Record<string, boolean> | Pick<typeof registry, 'surfaceDefaults' | 'loadedPacks' | 'getPackRuntime'> = {},
  surfaceIds: string[] = [],
) {
  const sent: SentMessage[] = [];
  const guard = defectGuard();
  const sys = createStateSystem({ side: 'backend', onDefect: guard.onDefect });
  sys.attach({
    tell: (to, event) => { sent.push({ to, event: event as SentMessage['event'] }); },
    ask: (_to, _name, _args, _progress, done) => {
      done({ ok: false, failure: { kind: 'unavailable', message: 'unused' } });
      return () => {};
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'unused' });
      return { stop: () => {} };
    },
  });
  const reg = 'surfaceDefaults' in defaultsOrRegistry
    ? defaultsOrRegistry as Pick<typeof registry, 'surfaceDefaults' | 'loadedPacks' | 'getPackRuntime'>
    : withDefaults(defaultsOrRegistry as Record<string, boolean>, surfaceIds);
  const stateDef = createApplicationSystem(reg);
  expect(isState(stateDef)).toBe(true);
  const handle = sys.start('host/application', stateDef);
  stop = () => {
    sys.stop();
    guard.assertNone();
    guard[Symbol.dispose]();
    stop = undefined;
  };
  const visibilitySent = () => sent.filter((message) => message.event.type === 'SURFACE_VISIBILITY_UPDATED');
  const commandsSent = () => sent.filter((message) => message.event.type === 'COMMANDS_UPDATED');
  return {
    sent,
    send: (event: EventsOf<typeof stateDef>) => sys.send(handle, event),
    ask: (name: 'ENTITY_EXISTS', args: { id: string }) => sys.ask(handle, name, args),
    visibilitySent,
    commandsSent,
    stop: () => stop?.(),
  };
}

beforeEach(() => resetTestData());
afterEach(() => stop?.());

describe('the host application system', () => {
  it('records a tab shown or hidden, and sends the visibility, defaults included, to the application surface', () => {
    const app = runApplicationSystem({ 'default-setup/logs': false, 'default-setup/notes': true });

    app.send({ type: 'SET_SURFACE_VISIBILITY', surface: 'default-setup/notes', visible: false });

    expect(appState.get().surfaceVisibility).toEqual({ 'default-setup/notes': false });
    expect(app.visibilitySent()).toEqual([{
      to: 'host/application',
      event: { type: 'SURFACE_VISIBILITY_UPDATED', surfaceVisibility: { 'default-setup/logs': false, 'default-setup/notes': false } },
    }]);
  });

  it('records the surface last open', () => {
    const app = runApplicationSystem();

    app.send({ type: 'SET_LAST_ACTIVE_SURFACE', surface: 'default-setup/threads' });

    expect(appState.get().lastActiveSurface).toBe('default-setup/threads');
  });

  // A bare id names no surface, so nothing could ever read the choice back
  it('ignores a surface id that is not a ref', () => {
    const app = runApplicationSystem();

    app.send({ type: 'SET_SURFACE_VISIBILITY', surface: 'notes', visible: false });
    app.send({ type: 'SET_LAST_ACTIVE_SURFACE', surface: 'threads' });

    expect(appState.get()).toMatchObject({ surfaceVisibility: {} });
    expect(appState.get().lastActiveSurface).toBeUndefined();
    expect(app.visibilitySent()).toEqual([]);
  });

  it("sends the visibility when asked to publish, since a pack brings or takes its features' defaults", () => {
    const app = runApplicationSystem({ 'memo-pack/memos': false });

    app.send({ type: 'SEND_STATE' });

    expect(app.visibilitySent()).toEqual([{
      to: 'host/application',
      event: expect.objectContaining({ surfaceVisibility: { 'memo-pack/memos': false } }),
    }]);
  });

  // The window's second app-level fact: an editor's command popup reads the shell, never a surface, so a window
  // with no chat open still has the list. The whole path is in default-setup's `extensions/tiptap/command-items`
  it('sends the commands when asked to publish, so every window holds them whatever is open', () => {
    storeCommand('standup', 'Topic');
    const app = runApplicationSystem();

    app.send({ type: 'SEND_STATE' });

    expect(app.commandsSent()).toEqual([expect.objectContaining({
      to: 'host/application',
      event: { type: 'COMMANDS_UPDATED', commands: [{ name: 'standup', placeholder: 'Topic' }] },
    })]);
  });

  // No pack tells the app this. The repository announces that documents were written and the system's own
  // watcher derives the list again, so a command the user types is published by the act of storing it.
  it('sends them again when a stored document adds a command, and stops watching on exit', async () => {
    const app = runApplicationSystem();

    storeCommand('digest', 'Week');
    await settle();

    expect(app.commandsSent()).toHaveLength(1);
    expect(app.commandsSent()[0]!.event).toEqual({
      type: 'COMMANDS_UPDATED', commands: [{ name: 'digest', placeholder: 'Week' }],
    });

    app.stop();
    storeCommand('after-stop', 'Ignored');
    await settle();
    expect(app.commandsSent()).toHaveLength(1);
  });

  // The announcement carries no payload, so the watcher compares the derived list. Most document writes are
  // not commands, and a window is not told the commands moved when they did not.
  it('says nothing when a document write leaves the list as it was', async () => {
    const app = runApplicationSystem();

    documentRepository.create({ name: 'Notes to self', content: [{ type: 'text', text: 'nothing to serve' }] });
    await settle();

    expect(app.commandsSent()).toEqual([]);
  });

  // The announcement fires per write; the comparison is deferred, so one apply is one publication however
  // many documents it wrote — which is what a pack's content import is
  it('sends one list for a burst of writes, not one per document', async () => {
    const app = runApplicationSystem();

    storeCommand('first', 'A');
    storeCommand('second', 'B');
    storeCommand('third', 'C');
    await settle();

    expect(app.commandsSent()).toHaveLength(1);
    expect(commandNames(app.commandsSent()[0]!.event)).toEqual(['first', 'second', 'third']);
  });

  it('answers ENTITY_EXISTS for existing, missing, and invalid entity IDs', async () => {
    const app = runApplicationSystem();
    const doc = documentRepository.create({ name: 'Exists check', content: [{ type: 'text', text: 'hi' }] });

    expect(await app.ask('ENTITY_EXISTS', { id: doc.id })).toEqual({ ok: true, value: { exists: true } });
    expect(await app.ask('ENTITY_EXISTS', { id: 'Document-does-not-exist' })).toEqual({ ok: true, value: { exists: false } });
    expect(await app.ask('ENTITY_EXISTS', { id: 'not-an-id-without-hyphen'.replace(/-/g, '') })).toEqual({ ok: true, value: { exists: false } });
  });
});


it('publishes accepted runtime lifetimes through ordinary state requests without persisting them', () => {
  const app = runApplicationSystem(registry);
  const id = 'runtime-publication';
  const origin = { id, declarationRevision: 'fixture', name: 'Runtime publication', version: '1.0.0', dir: '/fixture/runtime-publication' };
  try {
    registry.registerPack({ id }, origin);
    const before = structuredClone(appState.get());
    app.send({ type: 'SEND_STATE' });
    expect(app.sent.find(message => message.event.type === 'PACK_RUNTIMES_UPDATED')?.event).toEqual({
      type: 'PACK_RUNTIMES_UPDATED', runtimes: { [id]: registry.getPackRuntime(id)!.registrationId },
    });
    const first = registry.getPackRuntime(id)!.registrationId;
    registry.replacePack({ id }, origin);
    app.sent.length = 0;
    app.send({ type: 'SEND_STATE' });
    const current = registry.getPackRuntime(id)!.registrationId;
    expect(current).not.toBe(first);
    expect(app.sent.find(message => message.event.type === 'PACK_RUNTIMES_UPDATED')?.event).toEqual({
      type: 'PACK_RUNTIMES_UPDATED', runtimes: { [id]: current },
    });
    registry.unregisterPack(id);
    app.sent.length = 0;
    app.send({ type: 'SEND_STATE' });
    expect(app.sent.find(message => message.event.type === 'PACK_RUNTIMES_UPDATED')?.event).toEqual({ type: 'PACK_RUNTIMES_UPDATED', runtimes: {} });
    expect(appState.get()).toEqual(before);
  } finally {
    if (registry.getPackRegistration(id)) registry.unregisterPack(id);
    app.stop();
  }
});
