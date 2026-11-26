// The actions surface holds what the user is doing — which action is open, how far down the list they've read, the
// form — and the rows are its views' (`views.spec.ts`). What it hears of a view is `ACTION.LOADED`, which the canvas
// sends when the open action's view reads something: it fills the form once per opening, keeps the breadcrumb's
// label, and leaves the detail view when the action is gone. Nothing it does asks the backend for a row.
import { expect, it } from 'vitest';
import { system, type EventsOf, type Outcome } from '@apackdev/state';
import { defectGuard, waitFor } from '@apackdev/state/testing';
import type { ActionEntity } from '@apackdev/sdk';
import type { EARS } from '#generated/ears.ts';
import actionsState, { ACTIONS_PAGE_SIZE, actionsChrome } from '#features/actions/fe/state.ts';

const id = (name: string) => name as EARS.EntityId;
/** An action as its view reads it; only the fields these assertions touch are real */
const aAction = (name: string, label = name) =>
  ({ id: id(name), label, description: '', category: '', input: {}, actionFn: `return "${label}"` }) as unknown as ActionEntity;
const loaded = (name: string, action: ActionEntity | null) =>
  ({ type: 'ACTION.LOADED' as const, actionId: id(name), action });

function start(nextOutcome?: () => Outcome<unknown> | undefined) {
  const asks: Array<{ to: string; name: string; args: unknown; done: (outcome: Outcome<unknown>) => void }> = [];
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({
    tell: () => {},
    ask: (to, name, args, _progress, done) => {
      asks.push({ to, name, args, done });
      const immediate = nextOutcome?.();
      if (immediate) queueMicrotask(() => done(immediate));
      return () => {};
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/actions', actionsState);
  return {
    sys,
    handle,
    asks,
    read: () => sys.read(handle),
    send: (event: EventsOf<typeof actionsState>) => sys.send(handle, event),
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

it('opens an action without asking the backend for it, and fills the form from its view once', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'ACTION.SELECT', actionId: id('Action-p1') });
    expect(ctx.read().at).toBe('detail');
    expect(ctx.asks, 'the view reads the action; nothing is asked for').toHaveLength(0);

    ctx.send(loaded('Action-p1', aAction('Action-p1', 'first')));
    ctx.send({ type: 'FORM.UPDATE_LABEL', label: 'typed' });
    // Another window renames it: the breadcrumb follows, the form the user is typing in doesn't
    ctx.send(loaded('Action-p1', aAction('Action-p1', 'renamed elsewhere')));

    const { data } = ctx.read();
    expect(data.selectedLabel).toBe('renamed elsewhere');
    expect(data.formData.label).toBe('typed');
    expect(data.formData.actionFn).toBe('return "first"');
  } finally {
    ctx.cleanup();
  }
});

it('ignores what a view read for an action the user has moved on from', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'ACTION.SELECT', actionId: id('Action-p1') });
    ctx.send({ type: 'ACTION.SELECT', actionId: id('Action-p2') });

    ctx.send(loaded('Action-p1', aAction('Action-p1')));
    ctx.send(loaded('Action-p1', null));

    expect(ctx.read().at).toBe('detail');
    expect(ctx.read().data).toMatchObject({ selectedActionId: 'Action-p2', selectedLabel: undefined, formFor: undefined });
  } finally {
    ctx.cleanup();
  }
});

it('returns to the list when the open action is gone, deleted here or in another window', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'ACTION.SELECT', actionId: id('Action-p1') });
    ctx.send(loaded('Action-p1', aAction('Action-p1')));
    ctx.send({ type: 'ACTION.DELETE', actionId: id('Action-p1') });
    expect(ctx.asks.at(-1)).toMatchObject({
      to: 'default-setup/actions',
      name: 'DELETE_ACTION',
      args: { actionId: 'Action-p1' },
    });
    expect(ctx.read().at, 'still open until its view says it is gone').toBe('detail');

    ctx.send(loaded('Action-p1', null));
    expect(ctx.read().at).toBe('list');
    expect(ctx.read().data.selectedActionId).toBeUndefined();
  } finally {
    ctx.cleanup();
  }
});

it('fills the form afresh when an action is reopened from the list', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'ACTION.SELECT', actionId: id('Action-p1') });
    ctx.send(loaded('Action-p1', aAction('Action-p1', 'first')));
    ctx.send({ type: 'FORM.UPDATE_LABEL', label: 'abandoned' });
    ctx.send({ type: 'VIEW_LIST' });

    ctx.send({ type: 'ACTION.SELECT', actionId: id('Action-p1') });
    ctx.send(loaded('Action-p1', aAction('Action-p1', 'as stored')));
    expect(ctx.read().data.formData.label).toBe('as stored');
  } finally {
    ctx.cleanup();
  }
});

it('shows a page more each time the list is read to its end', () => {
  const ctx = start();
  try {
    expect(ctx.read().data.listLimit).toBe(ACTIONS_PAGE_SIZE);
    ctx.send({ type: 'ACTIONS.LOAD_MORE' });
    ctx.send({ type: 'ACTIONS.LOAD_MORE' });
    expect(ctx.read().data.listLimit).toBe(3 * ACTIONS_PAGE_SIZE);
    expect(ctx.asks).toHaveLength(0);
  } finally {
    ctx.cleanup();
  }
});

it('saves the form it holds, as an update of the open action or a new one', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'ACTION.SELECT', actionId: id('Action-p1') });
    ctx.send(loaded('Action-p1', aAction('Action-p1', 'first')));
    ctx.send({ type: 'FORM.UPDATE_LABEL', label: 'edited' });
    ctx.send({ type: 'ACTION.SAVE' });
    expect(ctx.asks.at(-1)).toMatchObject({
      to: 'default-setup/actions',
      name: 'UPDATE_ACTION',
      args: expect.objectContaining({ actionId: 'Action-p1', label: 'edited' }),
    });
    expect(ctx.read().at).toBe('list');

    ctx.send({ type: 'ACTION.CREATE' });
    ctx.send({ type: 'FORM.UPDATE_LABEL', label: 'new' });
    ctx.send({ type: 'ACTION.SAVE' });
    expect(ctx.asks.at(-1)).toMatchObject({
      to: 'default-setup/actions',
      name: 'CREATE_ACTION',
      args: expect.objectContaining({ label: 'new' }),
    });
  } finally {
    ctx.cleanup();
  }
});

it('opens its entity from the create view and refuses unrelated entity types', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'ACTION.CREATE' });
    ctx.send({ type: 'OPEN_ENTITY', id: 'Note-unrelated' });
    expect(ctx.read().at).toBe('create');
    ctx.send({ type: 'OPEN_ENTITY', id: 'Action-p1' });
    expect(ctx.read().at).toBe('detail');
    expect(ctx.read().data.selectedActionId).toBe('Action-p1');
  } finally {
    ctx.cleanup();
  }
});

it('shows a write it asked for that was refused, until the user dismisses it', async () => {
  const ctx = start();
  try {
    ctx.send({ type: 'ACTION.UPDATE_LABEL', actionId: 'Missing', label: 'renamed' });
    expect(ctx.read().pending.updateAction).toBe(1);
    ctx.asks[0].done({ ok: false, failure: { kind: 'failed', message: 'No such action' } });
    await waitFor(ctx.sys, ctx.handle, (v) => v.pending.updateAction === 0);
    expect(ctx.read().data.writeError).toBe('No such action');
    expect(ctx.read().pending.updateAction, 'the ask that ended is not kept').toBe(0);
    ctx.send({ type: 'CLEAR_WRITE_ERROR' });
    expect(ctx.read().data.writeError).toBeNull();
  } finally {
    ctx.cleanup();
  }
});

it('shows nothing for a write that landed', async () => {
  const ctx = start();
  try {
    ctx.send({ type: 'ACTION.UPDATE_LABEL', actionId: 'Action-p1', label: 'renamed' });
    ctx.asks[0].done({ ok: true, value: undefined });
    await waitFor(ctx.sys, ctx.handle, (v) => v.pending.updateAction === 0);
    expect(ctx.read().pending.updateAction).toBe(0);
    expect(ctx.read().data.writeError).toBeNull();
  } finally {
    ctx.cleanup();
  }
});

it('tracks import/export pending state and exposes declarative chrome for each view', async () => {
  const ctx = start();
  try {
    ctx.send({ type: 'ACTIONS.IMPORT', actions: [] });
    expect(ctx.read().pending.importActions).toBe(true);
    ctx.asks[0].done({ ok: true, value: { count: 2 } });
    await waitFor(ctx.sys, ctx.handle, (v) => !v.pending.importActions);
    expect(ctx.read().pending.importActions).toBe(false);
    expect(ctx.read().data.imported).toEqual({ ok: true, value: { count: 2 } });

    ctx.send({ type: 'ACTION.SELECT', actionId: id('Action-p1') });
    ctx.send(loaded('Action-p1', aAction('Action-p1', 'My Action')));
    const detailCrumb = typeof actionsChrome.states?.detail?.breadcrumb === 'function'
      ? actionsChrome.states.detail.breadcrumb(ctx.read())
      : actionsChrome.states?.detail?.breadcrumb;
    expect(detailCrumb).toEqual({ label: 'My Action', target: 'detail' });

    ctx.send({ type: 'TRAIL_CLICK', target: 'list' });
    expect(ctx.read().at).toBe('list');
    expect(ctx.read().data.selectedActionId).toBeUndefined();
  } finally {
    ctx.cleanup();
  }
});
