// services.emitter names systems and surfaces `<packId>/<featureId>`: an action is content, so a bare name would
// rebind on a copy into another pack. Both sends resolve against what the bound registry has registered, and a
// name nothing is registered under throws at the call, naming the form to write — rather than being dropped by
// the bus. `createActionEmitter` below is the same sends with a sender bound; what changes is the stamp on the
// message, never what a name means.
import * as os from 'node:os';
import { describe, expect, it } from 'vitest';
import { createActionEmitter } from '../../src/services/index.ts';
import { startTestRuntime, testRootEvents } from '../../src/testing/index.ts';
import { testPacks } from '../../src/testing/packs.ts';

process.env.APACK_ENV ??= 'test';
process.env.APACK_USER_DATA_DIR ??= os.tmpdir();
// No registry: the refs a test declares are what the sends resolve against
startTestRuntime();
for (const ref of ['default-setup/notes', 'ext/notes', 'host/packs']) testPacks.systems.add(ref);
for (const ref of ['default-setup/threads', 'host/application']) testPacks.surfaces.add(ref);

function sent(send: () => void): unknown[] {
  const received: unknown[] = [];
  const stops = [testRootEvents.onIncoming((event) => received.push(event)), testRootEvents.onSurfaceSend((event) => received.push(event))];
  try {
    send();
  } finally {
    stops.forEach((stop) => stop());
  }
  return received;
}

describe('services.emitter', () => {
  it('sends to the system a <packId>/<featureId> name resolves to', () => {
    expect(sent(() => {
      createActionEmitter().tell('default-setup/notes', { type: 'GET_NOTES' });
      createActionEmitter().tell('ext/notes', { type: 'GET_NOTES' });
    })).toEqual([{ to: 'default-setup/notes', call: expect.any(String), event: { type: 'GET_NOTES' } }, { to: 'ext/notes', call: expect.any(String), event: { type: 'GET_NOTES' } }]);
  });

  it("sends to the surface a <packId>/<featureId> name is, the host's included", () => {
    expect(sent(() => {
      createActionEmitter().broadcast('default-setup/threads', { type: 'SET_PHASE', phase: 'Edit' });
      createActionEmitter().broadcast('host/application', { type: 'APPLICATION_HOTKEYS', hotkeys: {} });
    })).toEqual([
      { to: 'default-setup/threads', call: expect.any(String), event: { type: 'SET_PHASE', phase: 'Edit' } },
      { to: 'host/application', call: expect.any(String), event: { type: 'APPLICATION_HOTKEYS', hotkeys: {} } },
    ]);
  });

  // The host is a pack: its surfaces are named like any other's
  it("throws for a host surface's bare id, naming its ref", () => {
    expect(() => createActionEmitter().broadcast('application', { type: 'APPLICATION_HOTKEYS', hotkeys: {} }))
      .toThrow('No registered surface is named "application": actions name a surface "<packId>/<featureId>" — did you mean "host/application"?');
  });

  // The documented form before surfaces were addressed per pack: an action a user wrote then still says this
  it('throws for a bare feature name, naming the pack it most likely means, and sends nothing', () => {
    expect(sent(() => {
      expect(() => createActionEmitter().broadcast('threads', { type: 'SET_PHASE', phase: 'Edit' }))
        .toThrow('No registered surface is named "threads": actions name a surface "<packId>/<featureId>" — did you mean "default-setup/threads"?');
      expect(() => createActionEmitter().tell('notes', { type: 'GET_NOTES' }))
        .toThrow('No registered system is named "notes": actions name a system "<packId>/<featureId>"');
    })).toEqual([]);
  });

  it('throws for a name no pack registered', () => {
    expect(() => createActionEmitter().broadcast('ext/threads', { type: 'X' })).toThrow('No registered surface is named "ext/threads"');
    expect(() => createActionEmitter().tell('other/notes', { type: 'X' })).toThrow('No registered system is named "other/notes"');
  });

  // `services.emitter` is what pack code reaches through `services`: only the pack that ran an action knows which
  // action it was, so reached this way there is nothing to stamp
  it('stamps nothing when no action is running', () => {
    const [surface, system] = sent(() => {
      createActionEmitter().broadcast('default-setup/threads', { type: 'SET_PHASE', phase: 'Edit' });
      createActionEmitter().tell('default-setup/notes', { type: 'GET_NOTES' });
    }) as Array<Record<string, unknown>>;
    expect(surface).not.toHaveProperty('from');
    expect(surface).not.toHaveProperty('via');
    expect(system).not.toHaveProperty('from');
    expect(system).not.toHaveProperty('via');
  });
});

// What a pack running user-authored code builds per run (default-setup's `runActionCode`). The stamp is the whole
// difference: the names it takes are refs either way, because an action is content that can be copied to another
// pack, where a bare name would rebind (`emitter.spec.ts` above, and `facade-typing.spec.ts` in the CLI).
describe('createActionEmitter', () => {
  const emitter = createActionEmitter({ from: 'default-setup', via: 'action:Summarise Thread' });

  it("stamps the pack running the action and the action itself on what it sends", () => {
    expect(sent(() => {
      emitter.broadcast('default-setup/threads', { type: 'SET_PHASE', phase: 'Edit' });
      emitter.tell('ext/notes', { type: 'GET_NOTES' });
    })).toEqual([
      { to: 'default-setup/threads', call: expect.any(String), event: { type: 'SET_PHASE', phase: 'Edit' }, from: 'default-setup', via: 'action:Summarise Thread' },
      { to: 'ext/notes', call: expect.any(String), event: { type: 'GET_NOTES' }, from: 'default-setup', via: 'action:Summarise Thread' },
    ]);
  });

  it('still refuses a bare feature name, so the stamp buys no new way to name things', () => {
    expect(sent(() => {
      expect(() => emitter.broadcast('threads', { type: 'SET_PHASE', phase: 'Edit' }))
        .toThrow('No registered surface is named "threads"');
    })).toEqual([]);
  });
});
