import { describe, expect, it } from 'vitest';
import { assign, createActor, enqueueActions, fromPromise, setup } from 'xstate';
import { freshKey, makes, type MadeEvent, type Making } from '../../src/fe/makes.ts';

type Outcome = { ok: true; value: string } | { ok: false; why: string };

/** Asks answered when the test says so, each recording what it was asked with and whether it was given up */
function desk() {
  const asked: { name: string; input: unknown; answer(outcome: Outcome): void; givenUp: boolean }[] = [];
  const logic = (name: string) => fromPromise<Outcome, { path?: string }>(({ input, signal }) => new Promise((resolve) => {
    const one = { name, input, answer: resolve, givenUp: false };
    signal.addEventListener('abort', () => { one.givenUp = true; });
    asked.push(one);
  }));
  return { asked, logic };
}

function board() {
  const it = desk();
  const made = makes(({ one, each }) => ({ push: one(it.logic('push')), stage: each(it.logic('stage')) }));
  type Event =
    | { type: 'PUSH' } | { type: 'STOP' } | { type: 'STAGE'; path: string } | { type: 'UNSTAGE'; path?: string } | { type: 'BOTH' } | { type: 'LEAVE' }
    | MadeEvent<typeof made>;
  const machine = setup({
    types: {} as { context: { making: Making<typeof made>; heard: string[]; atEnd: string[] }; events: Event },
    actors: made.actors,
  }).createMachine({
    context: { making: made.none(), heard: [], atEnd: [] },
    initial: 'open',
    on: {
      [made.done]: { actions: made.settle() },
      PUSH: { actions: enqueueActions(({ enqueue }) => made.make(enqueue, 'push', {})) },
      STOP: { actions: enqueueActions(({ enqueue, context }) => made.drop(enqueue, context, 'push')) },
      STAGE: { actions: enqueueActions(({ enqueue, event }) => made.make(enqueue, 'stage', event.path, { path: event.path })) },
      UNSTAGE: { actions: enqueueActions(({ enqueue, context, event }) => made.drop(enqueue, context, 'stage', event.path)) },
      BOTH: { actions: enqueueActions(({ enqueue }) => { made.make(enqueue, 'stage', 'a', { path: 'a' }); made.make(enqueue, 'stage', 'b', { path: 'b' }); }) },
      'made.push': [
        { guard: ({ event }) => !event.outcome.ok, target: '.refused', actions: assign({ atEnd: ({ context }) => [...context.atEnd, `push:${context.making.push}`] }) },
        { actions: assign({ heard: ({ context, event }) => [...context.heard, event.outcome.ok ? event.outcome.value : ''], atEnd: ({ context }) => [...context.atEnd, `push:${context.making.push}`] }) },
      ],
      'made.stage': { actions: assign({ heard: ({ context, event }) => [...context.heard, `${event.key}=${event.outcome.ok ? event.outcome.value : event.outcome.why}`], atEnd: ({ context, event }) => [...context.atEnd, `${event.key}:${event.key in context.making.stage}`] }) },
    },
    states: { open: {}, refused: {} },
  });
  const actor = createActor(machine).start();
  /** Answers an ask, and resolves once the machine has taken its end */
  const answer = (one: { answer(outcome: Outcome): void }, outcome: Outcome) => new Promise<void>((resolve) => {
    const heard = actor.subscribe(() => { heard.unsubscribe(); resolve(); });
    one.answer(outcome);
  });
  return { ...it, actor, answer, context: () => actor.getSnapshot().context, of: (name: string) => it.asked.filter((one) => one.name === name) };
}

describe('makes: the asks a machine makes, by name', () => {
  it('holds an ask as under way from when it is made until it ends, and hands the machine how it ended', async () => {
    const it = board();
    expect(it.context().making).toEqual({ push: false, stage: {} });
    it.actor.send({ type: 'PUSH' });
    expect(it.context().making.push).toBe(true);
    await it.answer(it.of('push')[0]!, { ok: true, value: 'pushed' });
    expect(it.context().making.push).toBe(false);
    expect(it.context().heard).toEqual(['pushed']);
    expect(Object.keys(it.actor.getSnapshot().children)).toEqual([]);
  });

  it('has cleared an ask from making by the time its end is handled', async () => {
    const it = board();
    it.actor.send({ type: 'PUSH' });
    it.actor.send({ type: 'STAGE', path: 'a' });
    await it.answer(it.of('push')[0]!, { ok: true, value: 'pushed' });
    await it.answer(it.of('stage')[0]!, { ok: true, value: 'staged' });
    expect(it.context().atEnd).toEqual(['push:false', 'a:false']);
  });

  it('ends an ask as an event a guard and a target are written for', async () => {
    const it = board();
    it.actor.send({ type: 'PUSH' });
    await it.answer(it.of('push')[0]!, { ok: false, why: 'rejected' });
    expect(it.actor.getSnapshot().value).toBe('refused');
  });

  it('keeps one under way per key, each ending as its own', async () => {
    const it = board();
    it.actor.send({ type: 'STAGE', path: 'src/a.b.ts' });
    it.actor.send({ type: 'STAGE', path: 'c' });
    expect(it.context().making.stage).toEqual({ 'src/a.b.ts': true, c: true });
    await it.answer(it.of('stage')[1]!, { ok: true, value: 'second' });
    expect(it.context().making.stage).toEqual({ 'src/a.b.ts': true });
    await it.answer(it.of('stage')[0]!, { ok: false, why: 'locked' });
    expect(it.context().making.stage).toEqual({});
    expect(it.context().heard).toEqual(['c=second', 'src/a.b.ts=locked']);
  });

  it('records every ask made in one action', () => {
    const it = board();
    it.actor.send({ type: 'BOTH' });
    expect(it.context().making.stage).toEqual({ a: true, b: true });
    expect(it.of('stage').map((one) => one.input)).toEqual([{ path: 'a' }, { path: 'b' }]);
  });

  it('gives up the one before when an ask is made again, and hears only the one made last', async () => {
    const it = board();
    it.actor.send({ type: 'STAGE', path: 'a' });
    it.actor.send({ type: 'STAGE', path: 'a' });
    const [first, second] = it.of('stage');
    expect(first!.givenUp).toBe(true);
    expect(second!.givenUp).toBe(false);
    // The one given up is answered first, and is not heard: what is heard next is the one made last
    first!.answer({ ok: true, value: 'first' });
    await it.answer(second!, { ok: true, value: 'second' });
    expect(it.context().heard).toEqual(['a=second']);
    expect(it.context().making.stage).toEqual({});
  });

  it('drops an ask: it is given up, no longer under way, and its end is never heard', async () => {
    const it = board();
    it.actor.send({ type: 'PUSH' });
    it.actor.send({ type: 'STOP' });
    expect(it.of('push')[0]!.givenUp).toBe(true);
    expect(it.context().making.push).toBe(false);
    // Answered all the same, and not heard: what is heard next is a push made after it
    it.of('push')[0]!.answer({ ok: true, value: 'dropped' });
    it.actor.send({ type: 'PUSH' });
    await it.answer(it.of('push')[1]!, { ok: true, value: 'pushed again' });
    expect(it.context().heard).toEqual(['pushed again']);
  });

  it('drops one key of an ask, or with no key every one', () => {
    const it = board();
    for (const path of ['a', 'b', 'c']) it.actor.send({ type: 'STAGE', path });
    it.actor.send({ type: 'UNSTAGE', path: 'b' });
    expect(it.context().making.stage).toEqual({ a: true, c: true });
    expect(it.of('stage').map((one) => one.givenUp)).toEqual([false, true, false]);
    it.actor.send({ type: 'UNSTAGE' });
    expect(it.context().making.stage).toEqual({});
    expect(it.of('stage').map((one) => one.givenUp)).toEqual([true, true, true]);
  });

  it('leaves making the same object when what was dropped was not under way', () => {
    const it = board();
    it.actor.send({ type: 'STAGE', path: 'a' });
    const before = it.context().making;
    it.actor.send({ type: 'STOP' });
    it.actor.send({ type: 'UNSTAGE', path: 'never-staged' });
    expect(it.context().making).toBe(before);
  });

  it('refuses a name that holds a dot, an ask nobody declared, and a keyed ask made without its key', () => {
    const it = desk();
    expect(() => makes(({ one }) => ({ 'a.b': one(it.logic('x')) }))).toThrow(/holds a dot/);
    const made = makes(({ each }) => ({ stage: each(it.logic('stage')) }));
    const enqueue = { spawnChild: () => {}, stopChild: () => {}, assign: () => {} };
    expect(() => (made.make as (...given: unknown[]) => void)(enqueue, 'push', {})).toThrow(/No ask is declared as "push"/);
    expect(() => (made.make as (...given: unknown[]) => void)(enqueue, 'stage', { path: 'a' })).toThrow(/once per key/);
  });

  it('gives a key no other ask has', () => {
    expect(freshKey()).not.toBe(freshKey());
  });
});
