// Reading another surface's state by ref: the untyped escape hatch beside the typed readers `#generated/fe`
// generates, for code with no SurfaceScope — an extension component the host renders wherever it belongs. The actor
// comes from the shell's registry, so nothing keeps its own, and the shell's snapshot is what says to look again.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectScope, watchSyncEffect, type Ref } from 'vue';
import type { AnyActorRef } from 'xstate';
import { _replyTo, _sendToLocalSurface, untypedBroadcastToSurface } from '../../src/events/index.ts';
import { _runDelivery } from '../../src/events/delivery.ts';
import { readUntypedSurfaceState, useUntypedSurfaceState } from '../../src/fe/surface-state.ts';
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';
import { bindHost, unbindHost } from '../../src/runtime/host-runtime.ts';

type Snapshot = { context: { notes: string[] } };

/** A surface actor as the shell's registry holds one: a snapshot, and subscribers told when it changes */
function fakeSurface(notes: string[]) {
  const listeners = new Set<(snapshot: Snapshot) => void>();
  let snapshot: Snapshot = { context: { notes } };
  return {
    actor: {
      getSnapshot: () => snapshot,
      subscribe: (fn: (snapshot: Snapshot) => void) => {
        listeners.add(fn);
        return { unsubscribe: () => listeners.delete(fn) };
      },
    } as unknown as AnyActorRef,
    change(next: string[]) {
      snapshot = { context: { notes: next } };
      for (const fn of listeners) fn(snapshot);
    },
    get subscribers() { return listeners.size; },
  };
}

let notes: ReturnType<typeof fakeSurface>;
/** The shell's registry of running surfaces, and its snapshot stream: a pack's frontend loading changes both */
let running: Record<string, AnyActorRef>;
let shellChanged: () => void;

beforeEach(() => {
  notes = fakeSurface(['a']);
  running = { 'default-setup/notes': notes.actor };
  const shellListeners = new Set<() => void>();
  // The copy is the point: a listener may subscribe while this runs, and a Set visits what is added during
  // iteration — without it, one that re-subscribes loops forever.
  // eslint-disable-next-line no-useless-spread
  shellChanged = () => { for (const fn of [...shellListeners]) fn(); };
  bindFeHost({ catalog: {} as never,
    application: {
      system: { get: (ref: string) => running[ref] },
      subscribe: (fn: () => void) => { shellListeners.add(fn); return { unsubscribe: () => shellListeners.delete(fn) }; },
    } as never,
    secrets: {} as never,
    settings: {} as never,
    client: { send() {}, watchView: () => () => {} },
    packs: {} as never,
  });
});

afterEach(() => unbindFeHost());

const read = (s: Snapshot) => s.context.notes;

describe('useUntypedSurfaceState', () => {
  it('follows the surface until the scope is disposed, and unsubscribes with it', () => {
    const scope = effectScope();
    let selected!: Readonly<Ref<string[] | undefined>>;
    scope.run(() => { selected = useUntypedSurfaceState('default-setup/notes', read); });

    expect(selected.value).toEqual(['a']);
    expect(notes.subscribers).toBe(1);

    notes.change(['a', 'b']);
    expect(selected.value).toEqual(['a', 'b']);

    scope.stop();
    expect(notes.subscribers).toBe(0);
  });

  it('runs only in a reactive scope, so its subscription is always released', () => {
    expect(() => useUntypedSurfaceState('default-setup/notes', read))
      .toThrow(/runs in a component's setup or an effect scope/);
  });

  // A ref names a surface; nothing about a name says it is running. Another pack's frontend may still be loading,
  // so absence is a value to render, not a throw — the generated readers narrow it away where the pack ships the
  // surface itself. A name that isn't a ref is still a mistake, and still throws.
  it('reads a surface that is not running as undefined, and refuses a name that is not a ref', () => {
    const scope = effectScope();
    expect(scope.run(() => useUntypedSurfaceState('default-setup/memos', read)?.value)).toBeUndefined();
    expect(readUntypedSurfaceState('default-setup/memos', read)).toBeUndefined();
    expect(() => scope.run(() => useUntypedSurfaceState('notes', read)))
      .toThrow(`"notes" doesn't name a surface`);
    scope.stop();
  });

  // The ref is written only when the selected value changed, so a component reading one field of a busy
  // surface's context isn't re-rendered every time another field moves.
  it('writes the ref only when the selected value changed', () => {
    const scope = effectScope();
    let writes = 0;
    scope.run(() => {
      const selected = useUntypedSurfaceState('default-setup/notes', read) as Ref<string[]>;
      // A dependency on the ref, counted each time it is written
      const stop = watchSyncEffect(() => { void selected.value; writes += 1; });
      expect(writes).toBe(1);
      const same = selected.value;
      notes.change(same);        // a new snapshot, the same selected value
      expect(writes).toBe(1);
      notes.change(['a', 'b']);  // a changed value
      expect(writes).toBe(2);
      stop();
    });
    scope.stop();
  });
});
describe('readUntypedSurfaceState', () => {
  it('takes the value once, outside any scope, and never follows it', () => {
    expect(readUntypedSurfaceState('default-setup/notes', read)).toEqual(['a']);
    notes.change(['c']);
    expect(readUntypedSurfaceState('default-setup/notes', read)).toEqual(['c']);
    expect(notes.subscribers).toBe(0);
  });
});

// The renderer half of sending: straight to this window's actor, with no bus between. A backend `untypedBroadcastToSurface`
// reaches every window showing the surface, which is why the two have different names.
// A read made while another pack's frontend is still loading has nothing to read yet. Resolving the actor once
// left it `undefined` for the life of the scope, which made the cross-pack read — the reason the value is typed
// `T | undefined` at all — useless in exactly the case the type exists for.
describe('following a surface that is not running yet', () => {
  it('fills in when the surface arrives, and follows it from then on', () => {
    const scope = effectScope();
    let selected!: Readonly<Ref<string[] | undefined>>;
    scope.run(() => { selected = useUntypedSurfaceState('memo-pack/memos', read); });
    expect(selected.value).toBeUndefined();

    const memos = fakeSurface(['m1']);
    running['memo-pack/memos'] = memos.actor;
    shellChanged();

    expect(selected.value).toEqual(['m1']);
    memos.change(['m1', 'm2']);
    expect(selected.value).toEqual(['m1', 'm2']);
    scope.stop();
    expect(memos.subscribers).toBe(0);
  });

  it("follows the new actor when a surface's pack reloads, and drops the old one", () => {
    const scope = effectScope();
    let selected!: Readonly<Ref<string[] | undefined>>;
    scope.run(() => { selected = useUntypedSurfaceState('default-setup/notes', read); });
    expect(selected.value).toEqual(['a']);

    const reloaded = fakeSurface(['fresh']);
    running['default-setup/notes'] = reloaded.actor;
    shellChanged();

    expect(selected.value).toEqual(['fresh']);
    expect(notes.subscribers).toBe(0);
    reloaded.change(['fresh', 'more']);
    expect(selected.value).toEqual(['fresh', 'more']);
    scope.stop();
  });

  it('reads as undefined again when the surface goes away', () => {
    const scope = effectScope();
    let selected!: Readonly<Ref<string[] | undefined>>;
    scope.run(() => { selected = useUntypedSurfaceState('default-setup/notes', read); });
    expect(selected.value).toEqual(['a']);

    delete running['default-setup/notes'];
    shellChanged();

    expect(selected.value).toBeUndefined();
    expect(notes.subscribers).toBe(0);
    scope.stop();
  });

  it('stops listening to the shell when the scope is disposed', () => {
    const scope = effectScope();
    scope.run(() => { useUntypedSurfaceState('memo-pack/memos', read); });
    scope.stop();

    running['memo-pack/memos'] = fakeSurface(['m1']).actor;
    expect(() => shellChanged()).not.toThrow();
  });
});

describe('_sendToLocalSurface', () => {
  // It asks the shell rather than the actor: the shell owns whether that surface is here yet, and answers the same
  // question for `OPEN_SURFACE`. What it must not do is open the surface — a send is not a navigation.
  it("asks the shell to hand this window's surface the event, without opening it", () => {
    const sent: unknown[] = [];
    unbindFeHost();
    bindFeHost({ catalog: {} as never,
      application: { send: (event: unknown) => sent.push(event), system: { get: () => undefined } } as never,
      secrets: {} as never,
      settings: {} as never,
      client: { send() {}, watchView: () => () => {} },
      packs: {} as never,
    });

    _sendToLocalSurface('default-setup/threads', { type: 'SELECT_ARTIFACT', artifactId: 'a1' });

    expect(sent).toEqual([{ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', call: expect.any(String), events: [{ type: 'SELECT_ARTIFACT', artifactId: 'a1' }] }]);
  });

  // The two sends share a signature, so picking the wrong one compiles. Worse, a pack test that starts both an
  // app and a shell binds both hosts, where the wrong one would work — so each says which it is by name.
  it('says which send it is when only the other half is bound', () => {
    unbindFeHost();
    expect(() => _sendToLocalSurface('default-setup/notes', { type: 'X' }))
      .toThrow(/No frontend host is bound/);

    bindHost({ transport: { rootEvents: { emitSurfaceSend() {} } } } as never);
    try {
      expect(() => _sendToLocalSurface('default-setup/notes', { type: 'X' }))
        .toThrow(/sendToSurface.*is the renderer's.*broadcastToSurface/s);
    } finally {
      unbindHost();
    }
  });

  it("says broadcastToSurface is the backend's when only a window is bound", () => {
    expect(() => untypedBroadcastToSurface('default-setup/notes', { type: 'X' }))
      .toThrow(/broadcastToSurface.*is the backend's.*sendToSurface/s);
  });

  /**
   * **Where the in-window channel is decided, and the only place it can be.** This send stays inside the
   * window by construction, so what answers it answers an actor beside the sender — the shell is handed the
   * address already built and carries it whole, rather than carrying a ref and rebuilding a channel four hops
   * later from a fact about this queue that was a guess.
   *
   * It is the window's counterpart of the bus's `askerOf`, and the mutation is the same for both: change the
   * `kind` here and `apack-host`'s `surface-reply.spec.ts` fails on an answer leaving for the backend.
   */
  it("names the sending surface as a window asker, from the delivery it is sent inside", () => {
    const sent: unknown[] = [];
    unbindFeHost();
    bindFeHost({ catalog: {} as never,
      application: { send: (event: unknown) => sent.push(event), system: { get: () => undefined } } as never,
      secrets: {} as never, settings: {} as never, client: { send() {}, watchView: () => () => {} }, packs: {} as never,
    });

    _runDelivery({ receiver: 'default-setup/threads' }, () => {
      _sendToLocalSurface('default-setup/notes', { type: 'ASK' });
    });

    expect(sent).toEqual([{
      type: 'SEND_TO_SURFACE',
      surface: 'default-setup/notes',
      call: expect.any(String), 
      events: [{ type: 'ASK' }],
      asker: { kind: 'window', ref: 'default-setup/threads' },
    }]);
  });

  /**
   * **`reply` is what marks a send as an answer**, and nothing else does. The shell uses that to decide
   * whether a surface that isn't there is worth telling the user about — a command someone gave is, an answer
   * to a machine's question is not (`apack-host`'s `open-surface.spec.ts`).
   *
   * Here rather than there because the host's cases build the flag by hand, so they hold what the shell does
   * with it and say nothing about who sets it. Measured by mutation: with this case absent, dropping
   * `{ answering: true }` from `_replyTo` failed nothing anywhere.
   */
  it('marks an answer as one, so a window can tell it from a command', () => {
    const sent: unknown[] = [];
    unbindFeHost();
    bindFeHost({ catalog: {} as never,
      application: { send: (event: unknown) => sent.push(event), system: { get: () => undefined } } as never,
      secrets: {} as never, settings: {} as never, client: { send() {}, watchView: () => () => {} }, packs: {} as never,
    });

    // The call the asker sent under, which `reply` reads off the delivery rather than off the event — so an
    // answer built after an `await` still names the request it is for
    const reply = _replyTo({ receiver: 'default-setup/notes', asker: { kind: 'window', ref: 'default-setup/threads' }, call: 'c-the-ask' });
    reply?.({ type: 'ANSWER' });

    expect(sent).toEqual([{
      type: 'SEND_TO_SURFACE',
      surface: 'default-setup/threads',
      // Its own, because a reply is a send and may itself be answered
      call: expect.any(String),
      events: [{ type: 'ANSWER' }],
      asker: { kind: 'window', ref: 'default-setup/notes' },
      answering: 'c-the-ask',
    }]);
  });

  // And an ordinary send is not marked, which is what makes the flag mean anything
  it('leaves an ordinary in-window send unmarked', () => {
    const sent: Array<{ answering?: string }> = [];
    unbindFeHost();
    bindFeHost({ catalog: {} as never,
      application: { send: (event: unknown) => sent.push(event as { answering?: string }), system: { get: () => undefined } } as never,
      secrets: {} as never, settings: {} as never, client: { send() {}, watchView: () => () => {} }, packs: {} as never,
    });

    _sendToLocalSurface('default-setup/notes', { type: 'ASK' });

    expect(sent[0]?.answering).toBeUndefined();
  });

  // A surface that isn't here yet is the shell's to wait for and, once loading settles, to report through `notify`
  // (`apack-host/tests/features/application/fe/open-surface.spec.ts`). Nothing throws here any more: this half
  // knows only that it asked.
  it('hands the shell a ref no pack provides, rather than throwing on the caller', () => {
    const sent: unknown[] = [];
    unbindFeHost();
    bindFeHost({ catalog: {} as never,
      application: { send: (event: unknown) => sent.push(event), system: { get: () => undefined } } as never,
      secrets: {} as never, settings: {} as never, client: { send() {}, watchView: () => () => {} }, packs: {} as never,
    });

    _sendToLocalSurface('default-setup/memos', { type: 'X' });

    expect(sent).toEqual([{ type: 'SEND_TO_SURFACE', surface: 'default-setup/memos', call: expect.any(String), events: [{ type: 'X' }] }]);
  });
});
