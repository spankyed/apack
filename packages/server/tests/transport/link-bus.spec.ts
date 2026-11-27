import { afterEach, describe, expect, it, vi } from 'vitest';
import { dial, join, memoryPair, type Port } from '@apackdev/link';
import { state, system as createStateSystem } from '@apackdev/state';
import { createParticipantClaims, HOST, type BackendBus } from '@apackdev/host/bus';
import {
  BUS_CLAIM_ASK,
  BUS_LINK_TARGET,
  BUS_SEND_ASK,
  decodeBusEnvelope,
  decodeDiagnosticCause,
  encodeBusSendPayload,
  encodeDiagnosticSending,
  LINK_CLAIM_CONFLICT,
} from '@apackdev/host/transport/link-protocol';
import type { ViewHost } from '@apackdev/host/views';
import { currentClient, type Message } from '@apackdev/sdk/events';
import type { ViewUpdate } from '@apackdev/sdk/framework';
import { bindHost } from '@apackdev/sdk/runtime';
import { RootEventEmitter } from '../../src/transport/emitter.ts';
import { createLinkBus, type LinkBusPacks } from '../../src/transport/link-bus.ts';

function createNoopPort(onTell?: (to: string, event: unknown, cause?: string) => void): Port {
  return {
    tell: (to, event, how) => onTell?.(to, event, how?.cause),
    ask: (_to, _name, _args, _heard, ended) => {
      ended({ ok: false, failure: { kind: 'unavailable', message: 'not implemented' } });
      return () => {};
    },
    follow: (_feature, _view, _args, _shown, over) => {
      over({ kind: 'unavailable', message: 'not implemented' });
      return { stop: () => {} };
    },
  };
}

function askPromise(port: Port, to: string, name: string, args: unknown, cause?: string) {
  return new Promise<{ ok: true; value: unknown } | { ok: false; failure: { kind: string; message: string } }>((resolve) => {
    port.ask(to, name, args, () => {}, (outcome) => resolve(outcome), cause ? { cause } : undefined);
  });
}

const sharedEmitter = new RootEventEmitter();
bindHost({ transport: { rootEvents: sharedEmitter } } as never);

describe('createLinkBus (@apackdev/link bus hub)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const fn of cleanups.splice(0).reverse()) fn();
    sharedEmitter.removeAllListeners();
  });

  function setup(options: {
    bus?: BackendBus;
    views?: ViewHost;
    packs?: LinkBusPacks;
  } = {}) {
    const emitter = sharedEmitter;
    const claims = createParticipantClaims();
    const packs: LinkBusPacks = options.packs ?? {
      getEventValidationMap: () => new Map([
        ['memo-pack/memos', new Set(['ADD_MEMO'])],
        [HOST.settings, new Set(['GET_SETTINGS', 'UPDATE_SETTINGS', 'RESET_APP'])],
        [HOST.application, new Set(['ENTITY_EXISTS'])],
      ]),
      getSurfaceEventValidationMap: () => new Map([
        ['memo-pack/memos', new Set(['MEMO_ADDED'])],
        [HOST.settings, new Set(['SETTINGS_LOADED'])],
      ]),
      askKinds: (ref, type) => (ref === HOST.application && type === 'ENTITY_EXISTS' ? [] : undefined),
    };
    const views: ViewHost = options.views ?? {
      watch: () => () => {},
      stats: () => ({ views: 0, subscriptions: 0 }),
      close: () => {},
    };
    const acceptor = createLinkBus({
      packs: () => packs,
      bus: () => options.bus,
      views: () => views,
      claims,
      rootEvents: emitter,
    });
    cleanups.push(() => acceptor.close('ended'));

    const connectClient = (owner: string) => {
      const [clientTransport, serverTransport] = memoryPair();
      const received: Message[] = [];
      const link = dial(clientTransport);
      const remote = join(link, createNoopPort((to, payload, cause) => {
        const msg = decodeBusEnvelope(to, payload, decodeDiagnosticCause(cause));
        if (msg) received.push(msg);
      }));
      acceptor.take(serverTransport, owner);
      cleanups.push(() => link.close());
      return { link, remote, received, owner };
    };

    return { emitter, claims, packs, views, acceptor, connectClient };
  }

  it('carries every Message envelope field (Required<Omit<Message, "client">>) and stamps connectionId', async () => {
    const { emitter, connectClient } = setup();
    const incoming: Message[] = [];
    emitter.onIncoming((message) => incoming.push(message));

    const client = connectClient('window:1:1');
    const whole: Required<Omit<Message, 'client'>> = {
      diagnostics: { traceparent: '00-11111111111111111111111111111111-2222222222222222-01' },
      to: 'memo-pack/memos',
      event: { type: 'ADD_MEMO' },
      from: 'default-setup',
      via: 'action:Summarise',
      sender: 'memo-pack/memos',
      call: 'c-1',
      answering: 'c-0',
    };

    const outcome = await askPromise(
      client.remote,
      BUS_LINK_TARGET,
      BUS_SEND_ASK,
      { ...encodeBusSendPayload(whole), client: 'forged-client' },
      encodeDiagnosticSending(whole.diagnostics)?.cause,
    );
    expect(outcome).toEqual({ ok: true, value: undefined });
    expect(incoming).toEqual([{ ...whole, client: 'window:1:1' }]);
  });

  it('refuses unaddressable senders and refuses SETTINGS_MUTATIONS over the link lane', async () => {
    const { connectClient } = setup();
    const client = connectClient('window:2:1');

    const badSender = await askPromise(
      client.remote,
      BUS_LINK_TARGET,
      BUS_SEND_ASK,
      encodeBusSendPayload({ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' }, sender: 'memo-pack/typo' }),
    );
    expect(badSender).toMatchObject({ ok: false, failure: { kind: 'BAD_REQUEST' } });

    const forbiddenSettings = await askPromise(
      client.remote,
      BUS_LINK_TARGET,
      BUS_SEND_ASK,
      encodeBusSendPayload({ to: HOST.settings, event: { type: 'UPDATE_SETTINGS' } }),
    );
    expect(forbiddenSettings).toMatchObject({ ok: false, failure: { kind: 'FORBIDDEN' } });

    const forbiddenAsk = await askPromise(client.remote, HOST.settings, 'UPDATE_SETTINGS', {});
    expect(forbiddenAsk).toMatchObject({ ok: false, failure: { kind: 'FORBIDDEN' } });
  });

  it('enforces exclusive participant claims, accepts claimed senders, and releases claims when the link ends', async () => {
    const { emitter, connectClient, acceptor } = setup();
    const incoming: Message[] = [];
    emitter.onIncoming((message) => incoming.push(message));

    const first = connectClient('tool:1');
    const second = connectClient('tool:2');

    expect(await askPromise(first.remote, BUS_LINK_TARGET, BUS_CLAIM_ASK, { as: HOST.drive })).toEqual({ ok: true, value: undefined });
    expect(await askPromise(second.remote, BUS_LINK_TARGET, BUS_CLAIM_ASK, { as: HOST.drive })).toMatchObject({
      ok: false,
      failure: { kind: LINK_CLAIM_CONFLICT },
    });

    // Claimed participant is accepted as a sender
    expect(await askPromise(
      first.remote,
      BUS_LINK_TARGET,
      BUS_SEND_ASK,
      encodeBusSendPayload({ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' }, sender: HOST.drive }),
    )).toEqual({ ok: true, value: undefined });
    expect(incoming.at(-1)).toMatchObject({ sender: HOST.drive, client: 'tool:1' });

    // Closing the first owner releases the claim for the second
    acceptor.gone('tool:1');
    await vi.waitFor(async () => {
      const outcome = await askPromise(second.remote, BUS_LINK_TARGET, BUS_CLAIM_ASK, { as: HOST.drive });
      expect(outcome).toEqual({ ok: true, value: undefined });
    });
  });

  it('scopes outgoing messages to the addressed connection while broadcasting unaddressed messages to all links', async () => {
    const { emitter, connectClient } = setup();
    const connected = vi.fn();
    emitter.onConnected(connected);

    const a = connectClient('window:10:1');
    const b = connectClient('window:20:1');

    await vi.waitFor(() => expect(connected).toHaveBeenCalledTimes(2));

    emitter.emitOutgoing({ to: 'memo-pack/memos', event: { type: 'MEMO_ADDED', id: 'all' } });
    emitter.emitOutgoing({ to: 'memo-pack/memos', event: { type: 'MEMO_ADDED', id: 'only-a' }, client: 'window:10:1' });
    emitter.emitOutgoing({ to: 'memo-pack/memos', event: { type: 'MEMO_ADDED', id: 'only-b' }, client: 'window:20:1' });

    await vi.waitFor(() => {
      expect(a.received).toHaveLength(2);
      expect(b.received).toHaveLength(2);
    });
    expect(a.received.map((m) => m.event.id)).toEqual(['all', 'only-a']);
    expect(b.received.map((m) => m.event.id)).toEqual(['all', 'only-b']);
  });

  it('forwards native system asks with cancellation via @apackdev/link left frames', async () => {
    const cancelled = vi.fn();
    let resolvePending: ((outcome: { ok: true; value: unknown }) => void) | undefined;
    const fakeBus = {
      getSystem: (id: string) => (id === HOST.application ? {} : undefined),
      port: {
        ask: (_to: string, _name: string, args: unknown, _heard: unknown, ended: (o: { ok: true; value: unknown }) => void) => {
          if ((args as { id: string }).id === 'slow') {
            resolvePending = ended;
            return () => { cancelled(); };
          }
          ended({ ok: true, value: { exists: (args as { id: string }).id === 'Note-1' } });
          return () => {};
        },
      },
    } as unknown as BackendBus;

    const { connectClient } = setup({ bus: fakeBus });
    const client = connectClient('window:30:1');

    expect(await askPromise(client.remote, HOST.application, 'ENTITY_EXISTS', { id: 'Note-1' })).toEqual({
      ok: true,
      value: { exists: true },
    });
    expect(await askPromise(client.remote, HOST.application, 'ENTITY_EXISTS', { id: 'Note-missing' })).toEqual({
      ok: true,
      value: { exists: false },
    });

    const cancel = client.remote.ask(HOST.application, 'ENTITY_EXISTS', { id: 'slow' }, () => {}, () => {});
    await vi.waitFor(() => expect(resolvePending).toBeDefined());
    cancel();
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
  });

  it('preserves currentClient() and aborts on disconnect for native @apackdev/link asks', async () => {
    let observedClient: string | undefined;
    let askAborted = false;
    let releaseAsk: (() => void) | undefined;

    type AskDefs = {
      ENTITY_EXISTS: { args: { id: string }; answer: { exists: boolean; client?: string } };
    };
    const appState = state<{}, never, AskDefs>()({
      answers: {
        ENTITY_EXISTS: async (args, { signal }) => {
          observedClient = currentClient();
          if (args.id === 'hold') {
            await new Promise<void>((resolve) => {
              releaseAsk = resolve;
              signal.addEventListener('abort', () => {
                askAborted = true;
                resolve();
              }, { once: true });
            });
          }
          return { exists: true, client: observedClient };
        },
      },
    });

    const sys = createStateSystem({ side: 'backend' });
    sys.start(HOST.application, appState);
    cleanups.push(() => sys.stop());

    const liveBus = {
      getSystem: (id: string) => (id === HOST.application ? {} : undefined),
      port: sys.port,
    } as unknown as BackendBus;

    const { connectClient, acceptor } = setup({ bus: liveBus });
    const client = connectClient('window:31:1:session-a');

    const immediate = await askPromise(client.remote, HOST.application, 'ENTITY_EXISTS', { id: 'fast' });
    expect(immediate).toEqual({ ok: true, value: { exists: true, client: 'window:31:1:session-a' } });
    expect(observedClient).toBe('window:31:1:session-a');

    // Start a long-running native ask and disconnect the link -> handler's AbortSignal must abort
    client.remote.ask(HOST.application, 'ENTITY_EXISTS', { id: 'hold' }, () => {}, () => {});
    await vi.waitFor(() => expect(releaseAsk).toBeDefined());
    expect(askAborted).toBe(false);

    acceptor.gone('window:31:1:session-a');
    await vi.waitFor(() => expect(askAborted).toBe(true));
  });

  it('streams EARS view updates via follow and stops watches on unfollow or link close', async () => {
    const watchers = new Map<string, { emit: (u: ViewUpdate) => void; stopped: boolean }>();
    const views: ViewHost = {
      watch: (request, observer) => {
        const entry = { emit: observer, stopped: false };
        watchers.set(`${request.ref}:${request.view}`, entry);
        queueMicrotask(() => observer({ ok: true, value: ['v1'], commit: 1 }));
        return () => { entry.stopped = true; };
      },
      stats: () => ({ views: watchers.size, subscriptions: watchers.size }),
      close: () => {},
    };

    const { connectClient, acceptor } = setup({ views });
    const client = connectClient('window:40:1');
    const seen: ViewUpdate[] = [];
    const sub = client.remote.follow(
      'memo-pack/memos',
      'list',
      { filter: 'all' },
      (update) => seen.push(update as ViewUpdate),
      () => {},
    );

    await vi.waitFor(() => expect(seen).toEqual([{ ok: true, value: ['v1'], commit: 1 }]));
    watchers.get('memo-pack/memos:list')!.emit({ ok: true, value: ['v1', 'v2'], commit: 2 });
    await vi.waitFor(() => expect(seen).toHaveLength(2));

    sub.stop();
    await vi.waitFor(() => expect(watchers.get('memo-pack/memos:list')!.stopped).toBe(true));

    // Also verify link close stops active watches
    client.remote.follow('memo-pack/memos', 'detail', {}, () => {}, () => {});
    await vi.waitFor(() => expect(watchers.has('memo-pack/memos:detail')).toBe(true));
    acceptor.gone('window:40:1');
    await vi.waitFor(() => expect(watchers.get('memo-pack/memos:detail')!.stopped).toBe(true));
  });
});
