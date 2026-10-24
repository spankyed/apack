// The envelope crosses the tRPC boundary only because the input schema names its fields: zod strips what it isn't
// told about, and the outer object is not passthrough, so a field the schema omits arrives as `undefined` and the
// diagnostics written to name it can't. That is the whole path this covers — the schema, not the envelope.
//
// **The envelope has two kinds of field, and the schema is where they differ.** `to`, `event`, `from`, `via` and
// `sender` come from the sender, so the schema names them. `client` alone is stamped from the connection, and the
// schema leaves it out. The stamped cases are in their own describe below; what each of them can and cannot catch
// is on the case, because the two halves of that defence overlap.
//
// `sender` sits on the named side although it routes, which looks like the exception to the rule and is not: the
// client is the only one who knows which of its surfaces asked. It is checked for **existence** — it must name
// something a reply could reach, as `to` must — and not for identity, which is why the registry is mocked here
// at all. What that leaves open, and the bound `client` puts on it, is on `bus.ts`.
//
// Note that the last case, dropping a field nothing declares, passes just as happily while the dropped field is
// one the envelope *does* declare. It is not the guard for this; the `Required<…>` case is.
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@apackdev/sdk/events';

const received: Message[] = [];
vi.mock('@apackdev/host/bus', () => ({
  HOST: { settings: 'host/settings', drive: 'host/drive' },
  receiveClientEvent: (_registry: unknown, message: Message) => { received.push(message); },
  UnknownClientEventError: class extends Error {},
}));
/**
 * The refs a `sender` is checked against: the two validation maps, and whatever `claimed` holds.
 *
 * `claimed` is a variable because the third clause is the one the drive engine lives on — it claims
 * `host/drive`, which no pack registers, so it is in neither map — and a mock that always answers "nothing is
 * claimed" cannot exercise it.
 */
let claimed: string | undefined;
vi.mock('../../src/runtime/index.ts', () => ({ appStore: undefined,
  appPacks: {
    getEventValidationMap: () => new Map([['memo-pack/memos', new Set(['ADD_MEMO'])]]),
    getSurfaceEventValidationMap: () => new Map([['memo-pack/memos', new Set(['MEMO_ADDED'])]]),
  },
  appClaims: { clientFor: (ref: string) => (ref === claimed ? 'c-drive' : undefined) },
}));
vi.mock('../../src/transport/emitter.ts', () => ({ rootEvents: { onOutgoing: () => () => {}, emitConnected: () => {}, emitPackClientConnected: () => {} } }));

const { systemBusRouter } = await import('../../src/transport/bus.ts');

/**
 * One connection's caller. `client` is the context the API mints per WebSocket connection, and `closed` the
 * signal the adapter supplies with it — passed rather than cast away, so that a procedure which starts reading
 * it fails this spec's typecheck instead of finding `undefined` at runtime.
 */
const callerFor = (client: string) => systemBusRouter.createCaller({ client, closed: new AbortController().signal });
const caller = callerFor('c-one');

describe('bus.send carries the sender across the boundary', () => {
  /**
   * `Required<Omit<Message, 'client'>>` cannot be satisfied without naming every field a *sender* may set, so
   * this is one case rather than one per field, and it guards both halves: a field added to `Message` stops this
   * file compiling until it is named here (`npm run typecheck:api` covers these tests), and then fails the
   * assertion until `bus.send`'s schema names it too.
   *
   * One field is omitted from the type deliberately, and the `Omit` is what forces that choice to be made
   * rather than defaulted into: `client` routes, so it is the API's to stamp, and a new field like it belongs
   * in the stamped cases below. `answering` was omitted too, on the reasoning that every reader of it was in
   * the window or on the backend that built the message — which carrying a `call` made false, since a round
   * trip only correlates if both ends of it survive the boundary.
   */
  it('carries every field a sender may set, whatever the envelope grows', async () => {
    received.length = 0;
    const whole: Required<Omit<Message, 'client'>> = { to: 'memo-pack/memos', event: { type: 'ADD_MEMO' }, from: 'default-setup', via: 'action:Summarise', sender: 'memo-pack/memos', call: 'c-1', answering: 'c-0' };
    await caller.send(whole);
    expect(received).toEqual([{ ...whole, client: 'c-one' }]);
  });

  // A partial envelope is the ordinary case, and the schema must not invent what it wasn't sent
  it('accepts a send with no sender, and adds none', async () => {
    received.length = 0;
    await caller.send({ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' } });
    expect(received).toEqual([{ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' }, client: 'c-one' }]);
  });

  /**
   * A `sender` naming nothing is refused, which is the symmetric half of the check `to` already gets.
   *
   * Without it the send is accepted and the answer is what fails: `reply` addresses a ref no surface holds, the
   * bus drops it with a diagnostic, and the report is one step removed from the call that caused it. Refusing
   * here puts the error on the send.
   */
  it('refuses a sender that names nothing addressable', async () => {
    await expect(caller.send({ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' }, sender: 'memo-pack/typo' }))
      .rejects.toThrow(/names no registered system/);
  });

  /**
   * A claimed name is a sender, and this is the clause the drive engine depends on entirely.
   *
   * `host/drive` is claimed on a connection rather than registered by a pack, so it appears in neither
   * validation map. Drop the claims clause from `addressable` and every send the drive engine makes is refused
   * — which nothing caught until this case, the mock having answered "nothing is claimed" for every ref.
   */
  it('accepts a sender a connection claimed, which no pack registers', async () => {
    claimed = 'host/drive';
    received.length = 0;
    try {
      await caller.send({ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' }, sender: 'host/drive' });
      expect(received).toEqual([{ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' }, sender: 'host/drive', client: 'c-one' }]);
    } finally {
      claimed = undefined;
    }
  });

  // And the same name is refused once nothing holds it, so the clause is a lookup and not a allow-list of one
  it('refuses that same name when the claim has gone', async () => {
    await expect(caller.send({ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' }, sender: 'host/drive' }))
      .rejects.toThrow(/no claimed participant/);
  });

  /**
   * **`answering` crosses the boundary, and it has to.** A system asking a window is answered *inbound*, so
   * the round trip correlates only if the answer's call survives `bus.send`'s whitelist — the field names a
   * call, not a boolean, and the asker holding that call is on the other side. It routes nothing, so the
   * worst a forged one buys is an asker confused about its own request.
   */
  it('carries answering, so an answer to a system names the call it answers', async () => {
    received.length = 0;
    await caller.send({ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' }, answering: 'c-the-ask' });
    expect(received[0]?.answering).toBe('c-the-ask');
  });

  // The fields are named rather than the object made passthrough, so the boundary stays closed to the rest
  it('still drops a field nothing declares', async () => {
    received.length = 0;
    // The cast is the case: `spoofed` is a field the schema does not name, so sending it is the whole point
    // and the compiler refusing it would say the boundary works without the run proving it
    await caller.send({ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' }, spoofed: 'x' } as never);
    expect(received[0]).not.toHaveProperty('spoofed');
  });
});

describe('the return address comes from the connection, not the sender', () => {
  it('stamps the connection the send arrived on', async () => {
    received.length = 0;
    await callerFor('c-two').send({ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' } });
    expect(received[0].client, 'the message says which connection to answer').toBe('c-two');
  });

  it('tells two connections apart', async () => {
    received.length = 0;
    await callerFor('c-two').send({ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' } });
    await callerFor('c-three').send({ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' } });
    expect(received.map((message) => message.client)).toEqual(['c-two', 'c-three']);
  });

  /**
   * The forgery case: a client that sends a `client` of its own must not be believed.
   *
   * **Two independent things stop it, and this case fires only when both are gone** — measured, not assumed.
   * `bus.send`'s input schema does not name `client`, so a supplied one is stripped; and the stamp is applied
   * as `{ ...input, client: ctx.client }`, so it overwrites whatever survived. Naming `client` in the schema
   * leaves this passing, and reversing the spread leaves it passing; doing both fails it. So this guards the
   * property rather than either mechanism, and the comment says so instead of crediting the wrong one.
   */
  it('ignores a client id the sender supplied', async () => {
    received.length = 0;
    // Likewise: `client` is deliberately omitted from the schema, so a sender claiming one must be
    // expressible here for the case to send it
    await callerFor('c-two').send({ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' }, client: 'c-someone-else' } as never);
    expect(received[0].client, 'the connection it arrived on, never the one it claimed').toBe('c-two');
  });
});
