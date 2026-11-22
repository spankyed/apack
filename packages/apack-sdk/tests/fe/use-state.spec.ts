// `useState`, held by rendering: real machines, read by real components that Vue's own runtime mounts into a tree of
// plain objects in place of a page. What is counted is what Vue did, how often each component rendered, since the
// point of it is which components a change renders.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, defineComponent, h, nextTick, ref, type Component } from 'vue';
import { assign, createActor, setup, type ActorRefFrom } from 'xstate';
import { _mirrored, useState, type UsedState } from '../../src/fe/use-state.ts';

// ── what is rendered into ───────────────────────────────────────────────────────────────────────────────────────────

interface Node { type: string; text: string; children: Node[]; parent: Node | undefined }
const node = (type: string, text = ''): Node => ({ type, text, children: [], parent: undefined });
const { createApp } = createRenderer<Node, Node>({
  createElement: (type) => node(type),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (of, text) => { of.text = text; },
  setElementText: (of, text) => { of.children = [Object.assign(node('#text', text), { parent: of })]; },
  insert: (child, parent, anchor) => {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = parent;
    const at = anchor ? parent.children.indexOf(anchor) : -1;
    if (at < 0) parent.children.push(child); else parent.children.splice(at, 0, child);
  },
  remove: (child) => { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); child.parent = undefined; },
  parentNode: (of) => of.parent ?? null,
  nextSibling: (of) => { const among = of.parent?.children ?? []; return among[among.indexOf(of) + 1] ?? null; },
  patchProp: () => {},
});
const shown = (of: Node): string => (of.type === '#text' ? of.text : of.type === '#comment' ? '' : of.children.map(shown).filter(Boolean).join(' | '));

// ── the machines ────────────────────────────────────────────────────────────────────────────────────────────────────

class Repository { constructor(readonly directory: string) {} }

type BoardEvent =
  | { type: 'RETITLE'; title: string }
  | { type: 'SAY'; id: string; text: string }
  | { type: 'ADD'; id: string }
  | { type: 'FORGET'; id: string }
  | { type: 'MOVE'; directory: string }
  | { type: 'OPEN' }
  | { type: 'SEND' }
  | { type: 'CLOSE' }
  | { type: 'NOTHING' };

const board = setup({
  types: { context: {} as { title: string; messages: Record<string, string[]>; repository: Repository }, events: {} as BoardEvent },
}).createMachine({
  context: { title: 'Board', messages: { a: [], b: [] }, repository: new Repository('/a') },
  initial: 'list',
  on: {
    RETITLE: { actions: assign({ title: ({ event }) => event.title }) },
    // As a machine changes what it holds: a new object for what changed, and the rest kept as it was
    SAY: { actions: assign({ messages: ({ context, event }) => ({ ...context.messages, [event.id]: [...(context.messages[event.id] ?? []), event.text] }) }) },
    ADD: { actions: assign({ messages: ({ context, event }) => ({ ...context.messages, [event.id]: [] }) }) },
    FORGET: { actions: assign({ messages: ({ context, event }) => Object.fromEntries(Object.entries(context.messages).filter(([id]) => id !== event.id)) }) },
    MOVE: { actions: assign({ repository: ({ event }) => new Repository(event.directory) }) },
    NOTHING: {},
  },
  states: {
    list: { on: { OPEN: 'thread' } },
    thread: {
      initial: 'idle',
      on: { CLOSE: 'list' },
      states: { idle: { on: { SEND: 'sending' } }, sending: {} },
    },
  },
});
type Board = ActorRefFrom<typeof board>;

/** A board on a page: components that each read one place of it, how often each rendered, and what the actor was asked */
function mounted(parts: string[] = ['title', 'where', 'a', 'b', 'which', 'folder']) {
  const actor = createActor(board).start();
  let subscriptions = 0;
  const subscribe = actor.subscribe.bind(actor);
  actor.subscribe = ((...given: Parameters<typeof subscribe>) => { subscriptions++; return subscribe(...given); }) as typeof actor.subscribe;

  const renders: Record<string, number> = {};
  const rendered = (name: string): void => { renders[name] = (renders[name] ?? 0) + 1; };
  const reads = (name: string, read: (state: UsedState<Board>['state']) => string): Component =>
    defineComponent(() => { const { state } = useState<Board>(actor); return () => { rendered(name); return h('p', read(state)); }; });
  const all: Record<string, Component> = {
    title: reads('title', (state) => state.value.data.title),
    where: reads('where', (state) => state.value.at),
    a: reads('a', (state) => (state.value.data.messages.a ?? []).join(',') || '-'),
    b: reads('b', (state) => (state.value.data.messages.b ?? []).join(',') || '-'),
    which: reads('which', (state) => Object.keys(state.value.data.messages).join('')),
    folder: reads('folder', (state) => state.value.data.repository.directory),
  };

  const page = node('page');
  const app = createApp(defineComponent(() => () => parts.map((part) => h(all[part]!))));
  app.mount(page);
  const since: Record<string, number> = { ...renders };
  return {
    actor,
    send: (event: BoardEvent) => actor.send(event),
    /** Which components rendered since this was last asked, once Vue has done what it had waiting */
    async ran(): Promise<string[]> {
      await nextTick();
      const names = Object.keys(renders).filter((name) => renders[name] !== since[name]).sort();
      Object.assign(since, renders);
      return names;
    },
    shows: () => shown(page),
    unmount: () => app.unmount(),
    subscriptions: () => subscriptions,
  };
}

let page: ReturnType<typeof mounted> | undefined;
const mount = (parts?: string[]) => (page = mounted(parts));
afterEach(() => { page?.unmount(); page?.actor.stop(); page = undefined; });

describe('useState', () => {
  it('renders where a machine is and what it holds', () => {
    expect(mount().shows()).toBe('Board | list | - | - | ab | /a');
  });

  it('renders only the components that read the field that changed', async () => {
    const it = mount();
    it.send({ type: 'RETITLE', title: 'Another' });
    expect(await it.ran()).toEqual(['title']);
    it.send({ type: 'SAY', id: 'a', text: 'hello' });
    expect(await it.ran()).toEqual(['a', 'b', 'which']);
    it.send({ type: 'MOVE', directory: '/b' });
    expect(await it.ran()).toEqual(['folder']);
    expect(it.shows()).toBe('Another | list | hello | - | ab | /b');
  });

  it('follows a field as its keys come and go', async () => {
    const it = mount();
    it.send({ type: 'ADD', id: 'c' });
    it.send({ type: 'FORGET', id: 'a' });
    await it.ran();
    expect(it.shows()).toBe('Board | list | - | - | bc | /a');
  });

  it('gives where a machine is as a path, and renders its reader when it moves', async () => {
    const it = mount();
    it.send({ type: 'OPEN' });
    expect(await it.ran()).toEqual(['where']);
    it.send({ type: 'SEND' });
    expect(await it.ran()).toEqual(['where']);
    expect(it.shows()).toBe('Board | thread.sending | - | - | ab | /a');
  });

  it('renders nothing for an event that changed nothing', async () => {
    const it = mount();
    it.send({ type: 'NOTHING' });
    expect(await it.ran()).toEqual([]);
  });

  it("hands a component the machine's own values: the object it reads is the one the machine holds", async () => {
    const it = mount(['title']);
    let mine: UsedState<Board>['state'] | undefined;
    const app = createApp(defineComponent(() => { mine = useState<Board>(it.actor).state; return () => h('p', mine!.value.data.title); }));
    app.mount(node('page'));
    const held = () => it.actor.getSnapshot().context;
    expect(mine!.value.data.messages).toBe(held().messages);
    // What is not plain data is handed over as it is, an instance of its own class
    expect(mine!.value.data.repository).toBe(held().repository);
    expect(mine!.value.data.repository).toBeInstanceOf(Repository);
    it.send({ type: 'SAY', id: 'a', text: 'hello' });
    await nextTick();
    expect(mine!.value.data.messages).toBe(held().messages);
    expect(mine!.value.data.messages.b).toBe(held().messages.b);
    expect(() => structuredClone(mine!.value.data.messages)).not.toThrow();
    app.unmount();
  });

  it('renders the reader of a field the machine replaced, though with a value equal to the one before', async () => {
    const it = mount();
    it.send({ type: 'MOVE', directory: '/a' });
    expect(await it.ran()).toEqual(['folder']);
  });

  it('renders once for many changes made before Vue renders', async () => {
    const it = mount();
    for (let said = 0; said < 50; said++) it.send({ type: 'SAY', id: 'a', text: `${said}` });
    it.send({ type: 'RETITLE', title: 'One' });
    it.send({ type: 'RETITLE', title: 'Two' });
    expect(await it.ran()).toEqual(['a', 'b', 'title', 'which']);
    expect(it.shows().startsWith('Two | list | 0,1,2')).toBe(true);
  });

  it('subscribes to a machine once, however many components read it, and lets go when the last has gone', () => {
    const it = mount();
    expect(it.subscriptions()).toBe(1);
    expect(_mirrored()).toBe(1);
    it.unmount();
    expect(_mirrored()).toBe(0);
    // With nobody reading, the machine goes on and nothing is mirrored
    it.send({ type: 'RETITLE', title: 'Unread' });
    expect(_mirrored()).toBe(0);
  });

  it('goes on following a machine for the readers left when one has gone', async () => {
    const it = mount(['title']);
    const other = createApp(defineComponent(() => { const { state } = useState<Board>(it.actor); return () => h('p', state.value.data.title); }));
    const root = node('page');
    other.mount(root);
    const third = createApp(defineComponent(() => { const { state } = useState<Board>(it.actor); return () => h('p', state.value.data.title); }));
    third.mount(node('page'));
    third.unmount();
    it.unmount();
    it.send({ type: 'RETITLE', title: 'Still read' });
    await nextTick();
    expect(shown(root)).toBe('Still read');
    expect(_mirrored()).toBe(1);
    other.unmount();
    expect(_mirrored()).toBe(0);
  });

  it('hands a component fields it cannot write: a write changes nothing, for it or for any other reader', async () => {
    const it = mount();
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let mine: UsedState<Board>['state'] | undefined;
    const app = createApp(defineComponent(() => { mine = useState<Board>(it.actor).state; return () => h('p', mine!.value.data.title); }));
    const root = node('page');
    app.mount(root);
    (mine!.value.data as { title: string }).title = 'Written by a component';
    (mine!.value as { at: string }).at = 'elsewhere';
    expect(await it.ran()).toEqual([]);
    expect([shown(root), it.shows()]).toEqual(['Board', 'Board | list | - | - | ab | /a']);
    expect(it.actor.getSnapshot().context.title).toBe('Board');
    // It goes on following the machine
    it.send({ type: 'RETITLE', title: 'From the machine' });
    await nextTick();
    expect(shown(root)).toBe('From the machine');
    app.unmount();
    warned.mockRestore();
  });

  it('sends to the machine', async () => {
    const actor = createActor(board).start();
    let send: ((event: BoardEvent) => void) | undefined;
    const app = createApp(defineComponent(() => { const used = useState<Board>(actor); send = used.send; return () => h('p', used.state.value.data.title); }));
    const root = node('page');
    app.mount(root);
    send!({ type: 'RETITLE', title: 'Sent' });
    await nextTick();
    expect(shown(root)).toBe('Sent');
    app.unmount();
    actor.stop();
  });

  it('follows the actor it is given as a function, and reads as nothing while there is none', async () => {
    const first = createActor(board).start();
    const second = createActor(board).start();
    second.send({ type: 'RETITLE', title: 'Second' });
    const which = ref<Board | undefined>(undefined);
    const app = createApp(defineComponent(() => { const { state } = useState(() => which.value); return () => h('p', state.value?.data.title ?? 'nothing'); }));
    const root = node('page');
    app.mount(root);
    expect(shown(root)).toBe('nothing');
    expect(_mirrored()).toBe(0);

    which.value = first;
    await nextTick();
    expect(shown(root)).toBe('Board');

    which.value = second;
    await nextTick();
    expect(shown(root)).toBe('Second');
    // The one it left is no longer mirrored, and a change to it renders nothing here
    expect(_mirrored()).toBe(1);
    first.send({ type: 'RETITLE', title: 'Left behind' });
    await nextTick();
    expect(shown(root)).toBe('Second');

    app.unmount();
    expect(_mirrored()).toBe(0);
    first.stop();
    second.stop();
  });

  it('refuses to be called outside a component, where nothing would end its reading', () => {
    const actor = createActor(board).start();
    expect(() => useState<Board>(actor)).toThrow(/called in a component's setup/);
    actor.stop();
  });
});
