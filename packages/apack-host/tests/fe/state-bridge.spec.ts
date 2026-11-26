import { afterEach, describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { createRenderer, defineComponent, h } from 'vue';
import { forNet } from '@apackdev/state';
import { vueBinding } from '@apackdev/state/vue';
import type { Surface, SurfaceChrome, SurfaceLifecycleEvent } from '@apackdev/sdk/fe';
import type { ViewUpdate } from '@apackdev/sdk/framework';
import { resolveName, type FeatureRef } from '@apackdev/sdk/ids';
import { createShellMachine, HOST, stateSystemOf } from '../../src/fe/index.ts';
import { fakeShell, settle, surface as xstateSurface } from '../features/application/fe/fakes.ts';

const PACK_ID = 'notes-pack';
const NOTES_REF = `${PACK_ID}/notes` as FeatureRef;
const OTHER_REF = 'other-pack/board' as FeatureRef;

interface NotesNet {
  systems: {
    notes: {
      events: { type: 'PING'; noteId: string };
      asks: {
        LIST_NOTES: { args: {}; answer: { items: string[] }; progress: number };
        SAVE_NOTE: { args: { id: string; title: string }; answer: { ok: true }; refuses: 'invalid' };
      };
    };
  };
  surfaces: {
    notes: { events: NotesEvents };
  };
  views: {
    notes: {
      summary: { args: {}; result: { count: number } };
    };
  };
}

type NotesShape = {
  data: {
    started: boolean;
    ownsAppLayout: boolean;
    items: string[];
    progressChunks: number[];
    selectedId: string | null;
    summaryCount: number | null;
    summaryError: string | null;
    saveError: string | null;
    savedCount: number;
  };
  calls: {
    save: { one: { id: string; title: string } };
  };
  states: {
    list: {};
    detail: {};
  };
};

type NotesEvents =
  | SurfaceLifecycleEvent
  | { type: 'OPEN_DETAIL'; id: string }
  | { type: 'TRAIL_CLICK'; target: string }
  | { type: 'SEND_PING'; noteId: string }
  | { type: 'SAVE'; id: string; title: string }
  | { type: 'CANCEL_SAVE' };

const notesForNet = forNet<NotesNet>((name) => resolveName(name, PACK_ID));

function buildNotesState(hooks: { onExit?: () => void } = {}) {
  return notesForNet<NotesShape, NotesEvents, {}>()({
    data: {
      started: false,
      ownsAppLayout: false,
      items: [],
      progressChunks: [],
      selectedId: null,
      summaryCount: null,
      summaryError: null,
      saveError: null,
      savedCount: 0,
    },
    initial: 'list',
    run: ({ onExit }) => {
      onExit(() => { hooks.onExit?.(); });
    },
    loads: (load) => ({
      items: load('notes', 'LIST_NOTES', {
        progress: (chunks, { data }) => ({
          data: { progressChunks: [...data.progressChunks, ...chunks] },
        }),
        done: (outcome) => {
          if (outcome.ok) return { data: { items: outcome.value.items } };
        },
      }),
    }),
    follows: (follow) => ({
      summary: follow('notes', 'summary', {
        updated: (update) => {
          if (update.ok) return { data: { summaryCount: update.value.count, summaryError: null } };
          return { data: { summaryError: update.failure.message } };
        },
      }),
    }),
    calls: ({ one }) => ({
      save: one('notes', 'SAVE_NOTE', {
        done: (outcome, { data }) => {
          if (outcome.ok) return { data: { savedCount: data.savedCount + 1, saveError: null } };
          return { data: { saveError: `${outcome.failure.kind}:${outcome.failure.message}` } };
        },
      }),
    }),
    on: {
      SURFACE_STARTED: (ev) => ({ data: { started: true, ownsAppLayout: ev.ownsAppLayout } }),
      OPEN_DETAIL: (ev) => ({ at: 'detail', data: { selectedId: ev.id } }),
      TRAIL_CLICK: (ev) => {
        if (ev.target === 'list') return { at: 'list', data: { selectedId: null } };
      },
      SEND_PING: (ev, { tell }) => {
        tell('notes', { type: 'PING', noteId: ev.noteId });
      },
      SAVE: (ev, { call }) => {
        call('save', { id: ev.id, title: ev.title });
      },
      CANCEL_SAVE: (_ev, { cancel }) => {
        cancel('save');
      },
    },
    states: {
      list: {},
      detail: {},
    },
  });
}

const notesChrome: SurfaceChrome<{ readonly at?: string; readonly data: { readonly selectedId: string | null } }> = {
  default: { label: 'Notes', target: 'list' },
  menu: [{ label: 'New Note', event: { type: 'NEW_NOTE' } }],
  states: {
    list: {
      breadcrumb: { label: 'Notes', target: 'list' },
    },
    detail: {
      breadcrumb: (s) => ({ label: `Note ${s.data.selectedId ?? ''}`, target: 'detail' }),
      menu: (s) => [{ label: 'Delete Note', event: { type: 'DELETE_NOTE', id: s.data.selectedId ?? '' } }],
    },
  },
};

type BoardEvent = SurfaceLifecycleEvent | { type: 'SET_FILTER'; filter: string };

const boardForNet = forNet<{ systems: {}; surfaces: {}; views: {} }>((name) => resolveName(name, 'other-pack'));
function buildBoardState(hooks: { onExit?: () => void } = {}) {
  return boardForNet<{ data: { startedCount: number; filter: string } }, BoardEvent, {}>()({
    data: { startedCount: 0, filter: '' },
    run: ({ onExit }) => { onExit(() => hooks.onExit?.()); },
    on: {
      SURFACE_STARTED: (_ev, { data }) => ({ data: { startedCount: data.startedCount + 1 } }),
      SET_FILTER: (ev) => ({ data: { filter: ev.filter } }),
    },
  });
}

const activeActors: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const actor of activeActors.splice(0)) actor.stop();
});

function startFakeShell(surfaces: Surface[]) {
  const fake = fakeShell({ surfaces });
  const shell = createActor(createShellMachine(fake.options), {
    systemId: HOST.application,
    input: { ownsLastActiveSurface: true },
  }).start();
  activeActors.push(shell);
  fake.client.connect();
  return { fake, shell };
}

describe('frontend @apackdev/state shell bridge', () => {
  it('delivers SURFACE_STARTED, bridges loads/calls asks with progress and cancellation, tells, and follows views', async () => {
    const viewObservers: Array<(u: ViewUpdate) => void> = [];
    let viewStops = 0;

    const notesState = buildNotesState();
    const notesSurface: Surface = {
      id: NOTES_REF,
      label: 'Notes',
      state: notesState,
      chrome: notesChrome,
      canvas: {},
    };
    const fake = fakeShell({ surfaces: [notesSurface] });
    fake.client.watchView.mockImplementation((_req, observer) => {
      viewObservers.push(observer);
      return () => { viewStops++; };
    });
    const shell = createActor(createShellMachine(fake.options), {
      systemId: HOST.application,
      input: { ownsLastActiveSurface: true },
    }).start();
    activeActors.push(shell);
    fake.client.connect();
    await settle();

    const notesActor = shell.system.get(NOTES_REF)!;
    expect(notesActor.getSnapshot()).toMatchObject({
      status: 'active',
      value: 'list',
      context: expect.objectContaining({ started: true, ownsAppLayout: true }),
    });

    // 1. `loads` issued LIST_NOTES over client.send
    const listCall = fake.client.send.mock.calls.find(([m]) => m.event.type === 'LIST_NOTES')?.[0];
    expect(listCall).toMatchObject({ to: NOTES_REF, sender: HOST.application, event: { type: 'LIST_NOTES' } });

    fake.client.receive({
      to: HOST.application,
      answering: listCall!.call,
      event: { type: 'ASK_PROGRESS', asked: 'LIST_NOTES', update: 50 },
    });
    fake.client.receive({
      to: HOST.application,
      answering: listCall!.call,
      event: { type: 'ASK_ANSWERED', asked: 'LIST_NOTES', answer: { items: ['alpha', 'beta'] } },
    });
    await settle();

    expect(notesActor.getSnapshot().context).toMatchObject({
      items: ['alpha', 'beta'],
      progressChunks: [50],
    });

    // 2. `tell` routes to client.send
    notesActor.send({ type: 'SEND_PING', noteId: 'n1' });
    expect(fake.client.send).toHaveBeenCalledWith(expect.objectContaining({
      to: NOTES_REF,
      event: { type: 'PING', noteId: 'n1' },
    }));

    // 3. `calls` imperative ask + refusal + cancellation
    notesActor.send({ type: 'SAVE', id: 'n1', title: '' });
    const saveCall1 = fake.client.send.mock.calls.find(([m]) => m.event.type === 'SAVE_NOTE')?.[0];
    expect(saveCall1).toMatchObject({ to: NOTES_REF, event: { type: 'SAVE_NOTE', id: 'n1', title: '' } });

    fake.client.receive({
      to: HOST.application,
      answering: saveCall1!.call,
      event: { type: 'ASK_FAILED', asked: 'SAVE_NOTE', failure: { kind: 'invalid', message: 'Title required' } },
    });
    await settle();
    expect(notesActor.getSnapshot().context.saveError).toBe('invalid:Title required');

    // Start second save and cancel it
    notesActor.send({ type: 'SAVE', id: 'n2', title: 'Draft' });
    const saveCalls = fake.client.send.mock.calls.filter(([m]) => m.event.type === 'SAVE_NOTE');
    const saveCall2 = saveCalls[saveCalls.length - 1]![0];
    notesActor.send({ type: 'CANCEL_SAVE' });
    expect(fake.client.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: NOTES_REF, answering: saveCall2.call, event: { type: 'ASK_CANCELLED' } }),
      expect.any(Function),
    );

    // 4. `follows` view updates (ok + error)
    expect(viewObservers).toHaveLength(1);
    viewObservers[0]!({ ok: true, value: { count: 7 }, commit: 1 });
    await settle();
    expect(notesActor.getSnapshot().context).toMatchObject({ summaryCount: 7, summaryError: null });

    viewObservers[0]!({ ok: false, error: 'view failed', commit: 2 });
    await settle();
    expect(notesActor.getSnapshot().context).toMatchObject({ summaryError: 'view failed' });

    shell.stop();
    expect(viewStops).toBe(1);
  });

  it('computes SurfaceChrome breadcrumbs and merged contextMenu via trail.ts and handles TRAIL_CLICK', async () => {
    const notesSurface: Surface = {
      id: NOTES_REF,
      label: 'Notes',
      state: buildNotesState(),
      chrome: notesChrome,
      canvas: {},
    };
    const plainSurface: Surface = {
      id: OTHER_REF,
      label: 'Board',
      state: buildBoardState(),
      canvas: {},
    };
    const { shell } = startFakeShell([notesSurface, plainSurface]);
    await settle();

    // Initial state: list
    expect(shell.getSnapshot().context.breadcrumbs).toEqual([{ label: 'Notes', target: 'list' }]);
    expect(shell.getSnapshot().context.contextMenuItems).toEqual([{ label: 'New Note', event: { type: 'NEW_NOTE' } }]);
    expect(shell.getSnapshot().context.targetView).toBe('list');

    // Move to detail: prepends default crumb and merges state menu with separator
    shell.system.get(NOTES_REF)!.send({ type: 'OPEN_DETAIL', id: '42' });
    await settle();
    expect(shell.getSnapshot().context.breadcrumbs).toEqual([
      { label: 'Notes', target: 'list' },
      { label: 'Note 42', target: 'detail' },
    ]);
    expect(shell.getSnapshot().context.contextMenuItems).toEqual([
      { label: 'New Note', event: { type: 'NEW_NOTE' } },
      { label: 'Delete Note', event: { type: 'DELETE_NOTE', id: '42' }, separator: true },
    ]);
    expect(shell.getSnapshot().context.targetView).toBe('detail');

    // TRAIL_CLICK returns to list
    shell.send({ type: 'TRAIL_CLICK', target: 'list' });
    await settle();
    expect(shell.getSnapshot().context.breadcrumbs).toEqual([{ label: 'Notes', target: 'list' }]);

    // Switching to a @apackdev/state surface without chrome falls back to capitalized featureId
    shell.send({ type: 'SELECT_SURFACE', surface: OTHER_REF });
    await settle();
    expect(shell.getSnapshot().context.breadcrumbs).toEqual([{ label: 'Board', target: '' }]);
  });

  it('works with @apackdev/state/vue vueBinding(resolve) provide/useState', async () => {
    const notesState = buildNotesState();
    const notesSurface: Surface = {
      id: NOTES_REF,
      label: 'Notes',
      state: notesState,
      canvas: {},
    };
    const { shell } = startFakeShell([notesSurface]);
    await settle();

    const { provide, useState } = vueBinding<{ notes: typeof notesState }>((name) => resolveName(name, PACK_ID));
    let observedAt = '';
    let observedSelected: string | null = null;
    let sendFn: ((ev: NotesEvents) => void) | undefined;

    const { createApp } = createRenderer<object, object>({
      createElement: () => ({}),
      createText: () => ({}),
      createComment: () => ({}),
      setText: () => {},
      setElementText: () => {},
      insert: () => {},
      remove: () => {},
      patchProp: () => {},
      parentNode: () => null,
      nextSibling: () => null,
    });

    const Comp = defineComponent({
      setup() {
        const { state, send } = useState('notes');
        sendFn = send;
        return () => {
          observedAt = state.value.at;
          observedSelected = state.value.data.selectedId;
          return h('div');
        };
      },
    });

    const app = createApp(Comp);
    provide(app, stateSystemOf(shell));
    app.mount({});

    expect(observedAt).toBe('list');
    expect(observedSelected).toBeNull();

    sendFn!({ type: 'OPEN_DETAIL', id: 'vue-1' });
    await settle();
    expect(observedAt).toBe('detail');
    expect(observedSelected).toBe('vue-1');

    app.unmount();
  });

  it('stops one @apackdev/state surface on pack unload without restarting sibling surfaces or resetting their state', async () => {
    let notesExits = 0;
    let boardExits = 0;
    const makeNotesSurface = (): Surface => ({
      id: NOTES_REF,
      label: 'Notes',
      state: buildNotesState({ onExit: () => { notesExits++; } }),
      canvas: {},
    });
    const boardSurface: Surface = {
      id: OTHER_REF,
      label: 'Board',
      state: buildBoardState({ onExit: () => { boardExits++; } }),
      canvas: {},
    };

    const { fake, shell } = startFakeShell([xstateSurface('host/packs'), makeNotesSurface(), boardSurface]);
    await settle();
    expect(stateSystemOf(shell).read({ ref: NOTES_REF })).toBeDefined();
    expect(stateSystemOf(shell).read({ ref: OTHER_REF })).toBeDefined();

    // Mutate sibling board's in-memory state before unloading notes-pack
    shell.system.get(OTHER_REF)!.send({ type: 'SET_FILTER', filter: 'keep-me' });
    await settle();
    expect(shell.system.get(OTHER_REF)!.getSnapshot().context).toEqual({ startedCount: 1, filter: 'keep-me' });

    // Unload notes-pack: stops only notes via per-ref handle; sibling board stays running untouched
    shell.send({ type: 'PACK_SURFACES_UNLOADED', packId: PACK_ID });
    await settle();
    expect(notesExits).toBe(1);
    expect(stateSystemOf(shell).read({ ref: NOTES_REF })).toBeUndefined();
    expect(boardExits).toBe(0);
    expect(stateSystemOf(shell).read({ ref: OTHER_REF })).toMatchObject({
      data: { startedCount: 1, filter: 'keep-me' },
    });
    expect(shell.system.get(OTHER_REF)!.getSnapshot().context).toEqual({ startedCount: 1, filter: 'keep-me' });

    // Reload notes-pack: starts fresh with no duplicate-ref collision and still does not disturb board
    const reloaded = makeNotesSurface();
    fake.acceptSurface(reloaded);
    shell.send({ type: 'PACK_FRONTEND_LOADED', packId: PACK_ID, registrationId: 'reg-2', surfaces: [reloaded] });
    await settle();
    expect(stateSystemOf(shell).read({ ref: NOTES_REF })).toBeDefined();
    expect(shell.system.get(NOTES_REF)!.getSnapshot()).toMatchObject({ status: 'active', value: 'list' });
    expect(boardExits).toBe(0);
    expect(shell.system.get(OTHER_REF)!.getSnapshot().context).toEqual({ startedCount: 1, filter: 'keep-me' });

    // Stopping shell stops all remaining surfaces cleanly
    shell.stop();
    expect(notesExits).toBe(2);
    expect(boardExits).toBe(1);
  });
});
