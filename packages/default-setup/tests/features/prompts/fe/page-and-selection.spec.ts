// The prompts surface holds what the user is doing — which prompt is open, how far down the list they've read, the
// form — and the rows are its views' (`views.spec.ts`). What it hears of a view is `PROMPT.LOADED`, which the canvas
// sends when the open prompt's view reads something: it fills the form once per opening, keeps the breadcrumb's
// label, and leaves the detail view when the prompt is gone. Nothing it does asks the backend for a row.
import { expect, it } from 'vitest';
import { system, type EventsOf, type Outcome } from '@apackdev/state';
import { defectGuard, waitFor } from '@apackdev/state/testing';
import type { PromptEntity } from '@apackdev/sdk';
import type { EARS } from '#generated/ears.ts';
import promptsState, { PROMPTS_PAGE_SIZE, promptsChrome } from '#features/prompts/fe/state.ts';

const id = (name: string) => name as EARS.EntityId;
/** A prompt as its view reads it; only the fields these assertions touch are real */
const aPrompt = (name: string, label = name) =>
  ({ id: id(name), label, description: '', category: '', inputs: {}, templateFn: `return "${label}"` }) as unknown as PromptEntity;
const loaded = (name: string, prompt: PromptEntity | null) =>
  ({ type: 'PROMPT.LOADED' as const, promptId: id(name), prompt });

function start() {
  const asks: Array<{ to: string; name: string; args: unknown; done: (outcome: Outcome<unknown>) => void }> = [];
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({
    tell: () => {},
    ask: (to, name, args, _progress, done) => {
      asks.push({ to, name, args, done });
      return () => {};
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/prompts', promptsState);
  return {
    sys,
    handle,
    asks,
    read: () => sys.read(handle),
    send: (event: EventsOf<typeof promptsState>) => sys.send(handle, event),
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

it('opens a prompt without asking the backend for it, and fills the form from its view once', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p1') });
    expect(ctx.read().at).toBe('detail');
    expect(ctx.asks, 'the view reads the prompt; nothing is asked for').toHaveLength(0);

    ctx.send(loaded('Prompt-p1', aPrompt('Prompt-p1', 'first')));
    ctx.send({ type: 'FORM.UPDATE_LABEL', label: 'typed' });
    // Another window renames it: the breadcrumb follows, the form the user is typing in doesn't
    ctx.send(loaded('Prompt-p1', aPrompt('Prompt-p1', 'renamed elsewhere')));

    const { data } = ctx.read();
    expect(data.selectedLabel).toBe('renamed elsewhere');
    expect(data.formData.label).toBe('typed');
    expect(data.formData.templateFn).toBe('return "first"');
  } finally {
    ctx.cleanup();
  }
});

it('ignores what a view read for a prompt the user has moved on from', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p1') });
    ctx.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p2') });

    ctx.send(loaded('Prompt-p1', aPrompt('Prompt-p1')));
    ctx.send(loaded('Prompt-p1', null));

    expect(ctx.read().at).toBe('detail');
    expect(ctx.read().data).toMatchObject({ selectedPromptId: 'Prompt-p2', selectedLabel: undefined, formFor: undefined });
  } finally {
    ctx.cleanup();
  }
});

it('returns to the list when the open prompt is gone, deleted here or in another window', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p1') });
    ctx.send(loaded('Prompt-p1', aPrompt('Prompt-p1')));
    ctx.send({ type: 'PROMPT.DELETE', promptId: id('Prompt-p1') });
    expect(ctx.asks.at(-1)).toMatchObject({
      to: 'default-setup/prompts',
      name: 'DELETE_PROMPT',
      args: { promptId: 'Prompt-p1' },
    });
    expect(ctx.read().at, 'still open until its view says it is gone').toBe('detail');

    ctx.send(loaded('Prompt-p1', null));
    expect(ctx.read().at).toBe('list');
    expect(ctx.read().data.selectedPromptId).toBeUndefined();
  } finally {
    ctx.cleanup();
  }
});

it('fills the form afresh when a prompt is reopened from the list', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p1') });
    ctx.send(loaded('Prompt-p1', aPrompt('Prompt-p1', 'first')));
    ctx.send({ type: 'FORM.UPDATE_LABEL', label: 'abandoned' });
    ctx.send({ type: 'VIEW_LIST' });

    ctx.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p1') });
    ctx.send(loaded('Prompt-p1', aPrompt('Prompt-p1', 'as stored')));
    expect(ctx.read().data.formData.label).toBe('as stored');
  } finally {
    ctx.cleanup();
  }
});

it('shows a page more each time the list is read to its end', () => {
  const ctx = start();
  try {
    expect(ctx.read().data.listLimit).toBe(PROMPTS_PAGE_SIZE);
    ctx.send({ type: 'PROMPTS.LOAD_MORE' });
    ctx.send({ type: 'PROMPTS.LOAD_MORE' });
    expect(ctx.read().data.listLimit).toBe(3 * PROMPTS_PAGE_SIZE);
    expect(ctx.asks).toHaveLength(0);
  } finally {
    ctx.cleanup();
  }
});

it('saves the form it holds, as an update of the open prompt or a new one', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p1') });
    ctx.send(loaded('Prompt-p1', aPrompt('Prompt-p1', 'first')));
    ctx.send({ type: 'FORM.UPDATE_LABEL', label: 'edited' });
    ctx.send({ type: 'PROMPT.SAVE' });
    expect(ctx.asks.at(-1)).toMatchObject({
      to: 'default-setup/prompts',
      name: 'UPDATE_PROMPT',
      args: expect.objectContaining({ promptId: 'Prompt-p1', label: 'edited' }),
    });
    expect(ctx.read().at).toBe('list');

    ctx.send({ type: 'PROMPT.CREATE' });
    ctx.send({ type: 'FORM.UPDATE_LABEL', label: 'new' });
    ctx.send({ type: 'PROMPT.SAVE' });
    expect(ctx.asks.at(-1)).toMatchObject({
      to: 'default-setup/prompts',
      name: 'CREATE_PROMPT',
      args: expect.objectContaining({ label: 'new' }),
    });
  } finally {
    ctx.cleanup();
  }
});

it('opens its entity from the create view and refuses unrelated entity types', () => {
  const ctx = start();
  try {
    ctx.send({ type: 'PROMPT.CREATE' });
    ctx.send({ type: 'OPEN_ENTITY', id: 'Note-unrelated' });
    expect(ctx.read().at).toBe('create');
    ctx.send({ type: 'OPEN_ENTITY', id: 'Prompt-p1' });
    expect(ctx.read().at).toBe('detail');
    expect(ctx.read().data.selectedPromptId).toBe('Prompt-p1');
  } finally {
    ctx.cleanup();
  }
});

it('shows a write it asked for that was refused, until the user dismisses it', async () => {
  const ctx = start();
  try {
    ctx.send({ type: 'PROMPT.UPDATE_LABEL', promptId: 'Missing', label: 'renamed' });
    expect(ctx.read().pending.updatePrompt).toBe(1);
    ctx.asks[0].done({ ok: false, failure: { kind: 'failed', message: 'No such prompt' } });
    await waitFor(ctx.sys, ctx.handle, (v) => v.pending.updatePrompt === 0);
    expect(ctx.read().data.writeError).toBe('No such prompt');
    expect(ctx.read().pending.updatePrompt, 'the ask that ended is not kept').toBe(0);
    ctx.send({ type: 'CLEAR_WRITE_ERROR' });
    expect(ctx.read().data.writeError).toBeNull();
  } finally {
    ctx.cleanup();
  }
});

it('shows nothing for a write that landed', async () => {
  const ctx = start();
  try {
    ctx.send({ type: 'PROMPT.UPDATE_LABEL', promptId: 'Prompt-p1', label: 'renamed' });
    ctx.asks[0].done({ ok: true, value: undefined });
    await waitFor(ctx.sys, ctx.handle, (v) => v.pending.updatePrompt === 0);
    expect(ctx.read().pending.updatePrompt).toBe(0);
    expect(ctx.read().data.writeError).toBeNull();
  } finally {
    ctx.cleanup();
  }
});

it('tracks import/export pending state and exposes declarative chrome for each view', async () => {
  const ctx = start();
  try {
    ctx.send({ type: 'PROMPTS.IMPORT', prompts: [] });
    expect(ctx.read().pending.importPrompts).toBe(true);
    ctx.asks[0].done({ ok: true, value: { count: 2 } });
    await waitFor(ctx.sys, ctx.handle, (v) => !v.pending.importPrompts);
    expect(ctx.read().pending.importPrompts).toBe(false);
    expect(ctx.read().data.imported).toEqual({ ok: true, value: { count: 2 } });

    ctx.send({ type: 'PROMPT.SELECT', promptId: id('Prompt-p1') });
    ctx.send(loaded('Prompt-p1', aPrompt('Prompt-p1', 'My Prompt')));
    const detailCrumb = typeof promptsChrome.states?.detail?.breadcrumb === 'function'
      ? promptsChrome.states.detail.breadcrumb(ctx.read())
      : promptsChrome.states?.detail?.breadcrumb;
    expect(detailCrumb).toEqual({ label: 'My Prompt', target: 'detail' });

    ctx.send({ type: 'TRAIL_CLICK', target: 'list' });
    expect(ctx.read().at).toBe('list');
    expect(ctx.read().data.selectedPromptId).toBeUndefined();
  } finally {
    ctx.cleanup();
  }
});
