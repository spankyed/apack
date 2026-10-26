// The view host: each request runs the feature's view in the registered pack on the engine, subscribers asking for
// the same view and arguments share one engine watch, the last to leave stops it, and the registry changing is what
// a view's code changing is.
import { beforeEach, describe, expect, it } from 'vitest';
import type { EarsEngine } from '@apackdev/ears';
import { defineViews, type PackRegistration, type ViewUpdate } from '@apackdev/sdk/framework';
import { _createTestEngine } from '@apackdev/sdk/testing';
import { createNativePackTestRegistry } from '../../src/testing/pack-registry.ts';
import { createViewHost, type ViewHost } from '../../src/views/index.ts';

let engine: EarsEngine;
let packs: ReturnType<typeof createNativePackTestRegistry>;
let views: ViewHost;

beforeEach(() => {
  engine = _createTestEngine({ entityTypes: ['Note'] });
  packs = createNativePackTestRegistry();
  views = createViewHost({ ears: () => engine, packs });
  return () => views.close();
});

/** The notes pack, its views reading titles through the engine as a pack's repository would */
const notesPack = (prefix = ''): PackRegistration => ({
  id: 'notes',
  features: {
    notes: {
      views: defineViews({
        titles: () => engine.query('Note').ids().map((id) => `${prefix}${String(engine.getAttr(id, 'title'))}`),
        byId: ({ id }: { id: string }) => engine.getAttr(id as never, 'title') ?? null,
        broken: () => { throw new Error('the view threw'); },
      }),
    },
  },
});

/** A window's subscription: what it heard, and how to leave */
function subscribe(view: string, args?: unknown) {
  const heard: ViewUpdate[] = [];
  const stop = views.watch({ ref: 'notes/notes', view, ...(args === undefined ? {} : { args }) }, (update) => heard.push(update));
  return { heard, last: () => heard.at(-1), stop };
}

/** Every commit before the call delivered, and the deliveries' own microtasks run */
const settled = async () => {
  await engine.admin.watchesSettled();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('views', () => {
  it("hands each subscriber its own view's result, and each changed result after it", async () => {
    packs.registerPack(notesPack());
    const note = engine.create('Note', { title: 'one' }).id();
    const list = subscribe('titles');
    const open = subscribe('byId', { id: note });
    await settled();
    expect(list.last()).toMatchObject({ ok: true, value: ['one'] });
    expect(open.last()).toMatchObject({ ok: true, value: 'one' });

    engine.create('Note', { title: 'two' });
    await settled();
    expect(list.last()).toMatchObject({ ok: true, value: ['one', 'two'], commit: engine.lastCommit() });
    expect(open.heard, 'a note the open view never read changes nothing it shows').toHaveLength(1);
  });

  it('shares one engine watch between subscribers asking for the same view and arguments, whatever their key order', async () => {
    packs.registerPack(notesPack());
    const note = engine.create('Note', { title: 'one' }).id();
    const first = subscribe('byId', { id: note, extra: 1 });
    const second = subscribe('byId', { extra: 1, id: note });
    await settled();
    expect(views.stats()).toEqual({ views: 1, subscriptions: 2 });
    expect(engine.admin.watchStats().watches).toBe(1);
    expect(first.last()).toMatchObject({ ok: true, value: 'one' });
    expect(second.last()).toMatchObject({ ok: true, value: 'one' });

    // One that joins a running watch is handed its last result rather than waiting for the next commit
    const late = subscribe('byId', { id: note, extra: 1 });
    await settled();
    expect(late.last()).toMatchObject({ ok: true, value: 'one' });
    expect(engine.admin.watchStats().watches).toBe(1);
  });

  it('stops the engine watch when the last subscriber leaves, and not before', async () => {
    packs.registerPack(notesPack());
    const first = subscribe('titles');
    const second = subscribe('titles');
    await settled();
    first.stop();
    expect(engine.admin.watchStats().watches).toBe(1);
    engine.create('Note', { title: 'after' });
    await settled();
    expect(first.heard, 'nothing reaches a subscriber that left').toHaveLength(1);
    expect(second.last()).toMatchObject({ ok: true, value: ['after'] });

    second.stop();
    expect(views.stats()).toEqual({ views: 0, subscriptions: 0 });
    expect(engine.admin.watchStats()).toEqual({ watches: 0, keys: 0, ranges: 0 });
  });

  it("runs a pack's views again on its new code when the pack is replaced, and errors while it is gone", async () => {
    packs.registerPack(notesPack());
    engine.create('Note', { title: 'one' });
    const list = subscribe('titles');
    await settled();
    expect(list.last()).toMatchObject({ ok: true, value: ['one'] });

    packs.replacePack(notesPack('v2: '));
    await settled();
    expect(list.last()).toMatchObject({ ok: true, value: ['v2: one'] });

    packs.unregisterPack('notes');
    await settled();
    expect(list.last()).toMatchObject({ ok: false, error: expect.stringContaining(`pack "notes" isn't running`) });
    packs.registerPack(notesPack());
    await settled();
    expect(list.last()).toMatchObject({ ok: true, value: ['one'] });
    expect(engine.admin.watchStats().watches).toBe(1);
  });

  it('delivers what a view threw, and why a request names no view, as errors that keep the subscription', async () => {
    packs.registerPack(notesPack());
    const broken = subscribe('broken');
    const missing = subscribe('nothing');
    const unaddressed = views.watch({ ref: 'not a ref', view: 'titles' }, () => {});
    await settled();
    expect(broken.last()).toMatchObject({ ok: false, error: 'the view threw' });
    expect(missing.last()).toMatchObject({ ok: false, error: expect.stringContaining('"titles", "byId", "broken"') });
    expect(views.stats().views).toBe(3);
    unaddressed();
  });
});
