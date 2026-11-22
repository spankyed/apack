// A pack's surfaces join the shell when its frontend loads, and leave when the pack is
// deactivated. Only the surfaces the pack added are its own: a surface whose id the app already has stays.
// Each pack whose frontend load finished is announced once per establishment of this window's bus
// subscription, so its systems send their startup data.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActor, type Actor } from 'xstate';
import type { ShellEvent } from '../../../../src/features/application/fe/types.ts';
import type { Surface } from '@apackdev/sdk/fe';
import { createShellMachine, type ShellMachine } from '../../../../src/fe/index.ts';
import { fakeShell, surface, settle } from './fakes.ts';

let app: Actor<ShellMachine>;
let builtInNotes: Surface;
let shell: ReturnType<typeof fakeShell>;
// This window's pack frontend loader has nothing to load here; pack-loading.spec covers it
let fake: ReturnType<typeof fakeShell>['client'];
let packClientReady: typeof fake.packClientReady;

beforeEach(() => {
  builtInNotes = surface('notes');
  shell = fakeShell({ surfaces: [builtInNotes], hasWelcome: () => true });
  fake = shell.client;
  packClientReady = fake.packClientReady;
  app = createActor(createShellMachine(shell.options), {
    systemId: 'host/application',
    input: { ownsLastActiveSurface: false },
  }).start();
});

afterEach(() => app.stop());

/** The server's CLIENT_CONNECTED broadcast, which any window's connection sends every window */
const broadcastConnected = (hasOnboarded = true) =>
  fake.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded, surfaceVisibility: {} } });
/** This window's subscription is established: the server broadcasts its CLIENT_CONNECTED */
const connect = (hasOnboarded = true) => {
  fake.connect();
  broadcastConnected(hasOnboarded);
};
const dropConnection = () => fake.dropConnection();
const loaded = (event: Extract<ShellEvent, { type: 'PACK_FRONTEND_LOADED' }>) => {
  event.surfaces?.forEach(shell.acceptSurface);
  app.send(event);
};

describe('pack surfaces in the application actor', () => {
  it("asks for a pack's startup data once its surface actors exist, after the connection", () => {
    connect();
    let spawnedWhenAsked = false;
    packClientReady.mockImplementation(async () => { spawnedWhenAsked = app.system.get('ext/own') !== undefined; });

    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'ext', surfaces: [surface('ext/own')] });

    expect(packClientReady).toHaveBeenCalledTimes(1);
    expect(packClientReady).toHaveBeenCalledWith('ext', 'runtime');
    expect(spawnedWhenAsked).toBe(true);
  });

  it('asks once the connection comes for a pack whose surfaces loaded before it', () => {
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'ext', surfaces: [surface('ext/own')] });
    expect(app.system.get('ext/own')).toBeDefined();
    expect(packClientReady).not.toHaveBeenCalled();

    connect();
    expect(packClientReady).toHaveBeenCalledTimes(1);
    expect(packClientReady).toHaveBeenCalledWith('ext', 'runtime');
  });

  it('waits for frontend reacceptance before requesting startup data on reconnect', async () => {
    connect();
    await settle();
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'ext', surfaces: [surface('ext/own')] });
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'empty', surfaces: [] });
    packClientReady.mockClear();

    dropConnection();
    connect();
    await settle();
    expect(packClientReady).not.toHaveBeenCalled();
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'ext', surfaces: [surface('ext/own')] });
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'empty', surfaces: [] });
    expect(packClientReady.mock.calls).toEqual([['ext', 'runtime'], ['empty', 'runtime']]);
  });

  it('acknowledges frontend acceptance only while connected', async () => {
    connect();
    await settle();
    dropConnection();
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'ext', surfaces: [surface('ext/own')] });
    expect(packClientReady).not.toHaveBeenCalled();

    connect();
    await settle();
    expect(packClientReady).not.toHaveBeenCalled();
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'ext', surfaces: [surface('ext/own')] });
    expect(packClientReady).toHaveBeenCalledTimes(1);
  });

  it("doesn't ask again when another window's connection broadcasts CLIENT_CONNECTED", () => {
    connect();
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'ext', surfaces: [surface('ext/own')] });
    packClientReady.mockClear();

    broadcastConnected();
    broadcastConnected();
    expect(packClientReady).not.toHaveBeenCalled();
  });

  // Its systems are waiting for their startup data whatever its frontend turned out to hold
  it('asks for an accepted frontend that exports no surfaces', () => {
    connect();
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'exported-none', surfaces: [] });
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'empty', surfaces: [] });

    const { surfaces, packsWithFrontend } = app.getSnapshot().context;
    expect(surfaces).toEqual([builtInNotes]);
    expect(packsWithFrontend).toEqual(['exported-none', 'empty']);
    expect(packClientReady.mock.calls).toEqual([['exported-none', 'runtime'], ['empty', 'runtime']]);

    app.send({ type: 'PACK_SURFACES_UNLOADED', packId: 'empty' });
    expect(app.getSnapshot().context.packsWithFrontend).toEqual(['exported-none']);
  });

  it('asks on connecting during onboarding and on the error page, and not again when onboarding completes', async () => {
    connect(false);
    await settle();
    expect(app.getSnapshot().hasTag('onboarding')).toBe(true);
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'ext', surfaces: [surface('ext/own')] });
    packClientReady.mockClear();

    // The API restarts during onboarding
    dropConnection();
    connect(false);
    await settle();
    expect(packClientReady).not.toHaveBeenCalled();
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'ext', surfaces: [surface('ext/own')] });
    expect(packClientReady).toHaveBeenCalledTimes(1);

    app.send({ type: 'ONBOARDING_COMPLETE' });
    expect(packClientReady).toHaveBeenCalledTimes(1);

    app.send({ type: 'BACKEND_ERROR', error: 'crashed' });
    expect(app.getSnapshot().matches('error')).toBe(true);
    dropConnection();
    fake.connect();
    await settle();
    expect(packClientReady).toHaveBeenCalledTimes(1);
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'ext', surfaces: [surface('ext/own')] });
    expect(packClientReady).toHaveBeenCalledTimes(2);
  });

  // The surfaces arrive under the ids they run under, so a pack with a `notes` feature of its own is a
  // second surface beside the built-in one rather than a clash. What this pins is that unloading the pack
  // takes only its own.
  it("removes only the surfaces the pack added, leaving a built-in surface whose feature it shares", () => {
    connect();
    const notesActor = app.system.get('notes');
    loaded({ type: 'PACK_FRONTEND_LOADED', registrationId: 'runtime', packId: 'ext', surfaces: [surface('ext/notes'), surface('ext/pack-own')] });

    app.send({ type: 'PACK_SURFACES_UNLOADED', packId: 'ext' });

    const { surfaces, packsWithFrontend } = app.getSnapshot().context;
    expect(surfaces).toEqual([builtInNotes]);
    expect(packsWithFrontend).toEqual([]);
    expect(app.system.get('ext/pack-own')).toBeUndefined();
    expect(app.system.get('ext/notes')).toBeUndefined();
    expect(app.system.get('notes')).toBe(notesActor);
    expect(notesActor.getSnapshot().status).toBe('active');
  });
});
