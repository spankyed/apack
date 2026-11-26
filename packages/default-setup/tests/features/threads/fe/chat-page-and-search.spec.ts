// The chat's page of a thread's messages and the panel's message search, each a view the surface follows. Scrolling to
// the top asks for a longer page once per page and only while there is one; a message opened from search grows the page
// of its own thread until the page lists it; the search box follows one query's view, and its results are that query's.
import { expect, it } from 'vitest';
import { system, type EventsOf, type ViewHost, type ViewUpdate } from '@apackdev/state';
import { defectGuard, waitFor } from '@apackdev/state/testing';
import threadsState from '#features/threads/fe/state.ts';

interface WatchedView {
  readonly view: string;
  readonly args: unknown;
  open: boolean;
  readonly push: (update: ViewUpdate<unknown>) => void;
}

function startThreads() {
  const watched: WatchedView[] = [];
  const views: ViewHost = (_feature, view, args, updated) => {
    const entry: WatchedView = { view, args, open: true, push: updated };
    watched.push(entry);
    return () => { entry.open = false; };
  };
  const guard = defectGuard();
  const sys = system({ side: 'window', views, onDefect: guard.onDefect });
  sys.attach({
    tell: () => {},
    ask: () => () => {},
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/threads', threadsState);
  const asked = (view: string) => watched.filter(w => w.view === view).map(w => w.args);
  const following = (view: string) => watched.filter(w => w.view === view && w.open).map(w => w.args);
  const latest = (view: string) => watched.filter(w => w.view === view).at(-1)!;
  const pushPage = (threadId: string, messageIds: string[], hasMore: boolean) => {
    latest('chat').push({ ok: true, value: { id: threadId, messageIds, hasMore } });
  };
  return {
    sys,
    handle,
    watched,
    asked,
    following,
    latest,
    pushPage,
    read: () => sys.read(handle),
    send: (event: EventsOf<typeof threadsState>) => sys.send(handle, event),
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

function openThread(threadId = 'Thread-t1') {
  const ctx = startThreads();
  ctx.send({ type: 'OPEN_THREAD_CHAT', threadId });
  return ctx;
}

it('asks once for a longer page, and not again while that page is loading', () => {
  const ctx = openThread();
  try {
    ctx.pushPage('Thread-t1', ['m-2'], true);
    ctx.send({ type: 'LOAD_MORE_MESSAGES' });
    ctx.send({ type: 'LOAD_MORE_MESSAGES' });
    expect(ctx.asked('chat')).toEqual([{ threadId: 'Thread-t1', limit: 50 }, { threadId: 'Thread-t1', limit: 100 }]);
    expect(ctx.read().data.messagePagination.isLoading).toBe(true);
  } finally {
    ctx.cleanup();
  }
});

it('asks for nothing, and shows nothing loading, when the thread has no older message', () => {
  const ctx = openThread();
  try {
    ctx.pushPage('Thread-t1', ['m-1'], false);
    ctx.send({ type: 'LOAD_MORE_MESSAGES' });
    expect(ctx.asked('chat')).toEqual([{ threadId: 'Thread-t1', limit: 50 }]);
    expect(ctx.read().data.messagePagination.isLoading).toBe(false);
  } finally {
    ctx.cleanup();
  }
});

it("grows a message's own thread's page until the page lists it", async () => {
  const ctx = startThreads();
  try {
    ctx.send({ type: 'OPEN_MESSAGE', threadId: 'Thread-t1', messageId: 'm-old' });
    ctx.pushPage('Thread-t1', ['m-new'], true);
    await waitFor(ctx.sys, ctx.handle, v => v.data.chatLimit === 100);
    ctx.pushPage('Thread-t1', ['m-mid', 'm-new'], true);
    await waitFor(ctx.sys, ctx.handle, v => v.data.chatLimit === 150);
    ctx.pushPage('Thread-t1', ['m-old', 'm-mid', 'm-new'], true);
    expect(ctx.asked('chat').map(args => (args as { limit: number }).limit)).toEqual([50, 100, 150]);
    expect(ctx.read().data.focusMessage).toEqual({ threadId: 'Thread-t1', messageId: 'm-old' });
  } finally {
    ctx.cleanup();
  }
});

it('seeks in the thread already open, and gives up where the thread has no more', () => {
  const ctx = openThread();
  try {
    ctx.pushPage('Thread-t1', ['m-new'], false);
    ctx.send({ type: 'OPEN_MESSAGE', threadId: 'Thread-t1', messageId: 'm-gone' });
    expect(ctx.asked('chat')).toHaveLength(1);
    expect(ctx.read().data.focusMessage).toBeNull();
  } finally {
    ctx.cleanup();
  }
});

it('stops seeking when another thread opens in its place', () => {
  const ctx = startThreads();
  try {
    ctx.send({ type: 'OPEN_MESSAGE', threadId: 'Thread-t1', messageId: 'm-old' });
    ctx.send({ type: 'OPEN_THREAD_CHAT', threadId: 'Thread-t2' });
    ctx.pushPage('Thread-t2', ['n-1'], true);
    expect(ctx.asked('chat')).toEqual([{ threadId: 'Thread-t1', limit: 50 }, { threadId: 'Thread-t2', limit: 50 }]);
    expect(ctx.read().data.focusMessage).toBeNull();
  } finally {
    ctx.cleanup();
  }
});

it("follows the box's query alone, and takes no result of a query it replaced", () => {
  const ctx = startThreads();
  try {
    ctx.send({ type: 'SEARCH_MESSAGES', query: ' dep ' });
    const staleSub = ctx.latest('messageSearch');
    ctx.send({ type: 'SEARCH_MESSAGES', query: 'deploy' });
    expect(ctx.following('messageSearch')).toEqual([{ query: 'deploy' }]);
    // Late delivery on the replaced subscription is ignored by the kernel
    staleSub.push({ ok: true, value: [{ messageId: 'm-1' }] });
    expect(ctx.read().data.messageSearch).toEqual({ query: 'deploy', results: [], searching: true });
    ctx.latest('messageSearch').push({ ok: true, value: [{ messageId: 'm-2' }] });
    expect(ctx.read().data.messageSearch).toMatchObject({ results: [{ messageId: 'm-2' }], searching: false });

    ctx.send({ type: 'SEARCH_MESSAGES', query: '' });
    expect(ctx.following('messageSearch')).toEqual([]);
    expect(ctx.read().data.messageSearch).toEqual({ query: '', results: [], searching: false });
  } finally {
    ctx.cleanup();
  }
});
