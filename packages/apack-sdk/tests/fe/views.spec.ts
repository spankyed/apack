// A view in a component: `untypedUseView` subscribes over the window's client and hands back the state a template
// reads. It subscribes again only when its arguments ask for something different, leaves the view idle while they're
// absent, and ends its subscription with the scope — and nothing an ended subscription delivers reaches the state.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import type { ViewRequest, ViewUpdate } from '../../src/framework/views.ts';
import { untypedUseView } from '../../src/fe/views.ts';
import { startFeTestRuntime } from '../../src/testing/fe-runtime.ts';

/** The window's subscriptions as the client holds them: what each asked for, and a way to deliver to it */
let subscriptions: Array<{ request: ViewRequest; deliver: (update: ViewUpdate) => void; open: boolean }>;
let stop: () => void;

beforeEach(() => {
  subscriptions = [];
  stop = startFeTestRuntime({
    client: {
      watchView: (request, observer) => {
        const subscription = { request, deliver: observer, open: true };
        subscriptions.push(subscription);
        return () => { subscription.open = false; };
      },
    },
  });
});
afterEach(() => stop());

const open = () => subscriptions.filter((subscription) => subscription.open);

describe('untypedUseView', () => {
  it('is loading until the first result, then ready with it, and keeps the last result through an error', () => {
    const scope = effectScope();
    const view = scope.run(() => untypedUseView<string[]>('notes/notes', 'titles'))!;
    expect(view.status).toBe('loading');
    expect(open().map((subscription) => subscription.request)).toEqual([{ ref: 'notes/notes', view: 'titles' }]);

    open()[0].deliver({ ok: true, value: ['a'], commit: 3 });
    expect(view).toMatchObject({ status: 'ready', data: ['a'], commit: 3 });

    open()[0].deliver({ ok: false, error: 'the view threw', commit: 4 });
    expect(view).toMatchObject({ status: 'error', error: 'the view threw', data: ['a'], commit: 4 });

    // A failed subscription knows no commit, and the state doesn't move back for it
    open()[0].deliver({ ok: false, error: 'socket gone', commit: 0 });
    expect(view.commit).toBe(4);
    scope.stop();
  });

  it('subscribes again when its arguments ask for something else, and not for the same values in a new object', async () => {
    const page = ref({ page: 1, size: 10 });
    const scope = effectScope();
    const view = scope.run(() => untypedUseView('notes/notes', 'page', page))!;
    open()[0].deliver({ ok: true, value: 'page 1', commit: 1 });

    page.value = { size: 10, page: 1 };
    await nextTick();
    expect(subscriptions, 'the same arguments, so the same subscription').toHaveLength(1);

    page.value = { page: 2, size: 10 };
    await nextTick();
    expect(subscriptions[0].open).toBe(false);
    expect(open().map((subscription) => subscription.request.args)).toEqual([{ page: 2, size: 10 }]);
    expect(view, 'new arguments start again from no result').toMatchObject({ status: 'loading', data: undefined });

    // The old subscription delivering late reaches nothing
    subscriptions[0].deliver({ ok: true, value: 'page 1, late', commit: 2 });
    expect(view.data).toBeUndefined();
    scope.stop();
  });

  it('keeps the last result while new arguments load, when asked to, as a pager does', async () => {
    const limit = ref(20)
    const scope = effectScope()
    const view = scope.run(() => untypedUseView('notes/notes', 'list', () => ({ limit: limit.value }), { keepPrevious: true }))!
    open()[0].deliver({ ok: true, value: ['first page'], commit: 1 })

    limit.value = 40
    await nextTick()
    expect(view, 'still showing the first page while the longer one loads').toMatchObject({ status: 'loading', data: ['first page'] })
    open()[0].deliver({ ok: true, value: ['first page', 'second page'], commit: 2 })
    expect(view.data).toEqual(['first page', 'second page'])
    scope.stop()
  })

  it('is idle while its arguments are absent, and unsubscribes with its scope', async () => {
    const id = ref<string | null>(null);
    const scope = effectScope();
    const view = scope.run(() => untypedUseView('notes/notes', 'byId', () => (id.value ? { id: id.value } : null)))!;
    expect(view.status).toBe('idle');
    expect(subscriptions).toHaveLength(0);

    id.value = 'n-1';
    await nextTick();
    expect(open().map((subscription) => subscription.request.args)).toEqual([{ id: 'n-1' }]);

    id.value = null;
    await nextTick();
    expect(view.status).toBe('idle');
    expect(open()).toHaveLength(0);

    id.value = 'n-2';
    await nextTick();
    scope.stop();
    expect(open(), 'the scope ending ends the subscription').toHaveLength(0);
  });

  it('refuses to run outside a scope, which is what would end it', () => {
    expect(() => untypedUseView('notes/notes', 'titles')).toThrow(/setup or an effect scope/);
  });
});
