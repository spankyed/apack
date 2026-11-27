// @vitest-environment jsdom
// What a surface's component holds for the user survives the remount a reconnect causes: the shell replaces the
// surface's handle, `SurfaceScope` remounts the surface for it, and the draft is handed back, kept by the surface's ref.
import { afterEach, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { SurfaceScope } from '../../src/fe/actor-system.ts';
import type { HostShellSurfaceRef } from '../../src/fe/shell.ts';
import { useSurfaceDraft } from '../../src/fe/surface-draft.ts';
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';

afterEach(() => unbindFeHost());

let nextSession = 0;

/** A window whose shell runs one handle per ref, which `replace` swaps the way a reconnect does */
function aWindow() {
  const running = new Map<string, HostShellSurfaceRef>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const fn of listeners) fn(); };
  const spawn = (ref: string) => {
    const sessionId = `s-${++nextSession}`;
    running.set(ref, {
      id: ref,
      sessionId,
      getSnapshot: () => ({ status: 'active', value: 'ready', context: {} }),
      subscribe: () => ({ unsubscribe() {} }),
      send() {},
    });
  };
  bindFeHost({
    catalog: {} as never,
    application: {
      surface: (ref: string) => running.get(ref),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return { unsubscribe: () => { listeners.delete(listener); } };
      },
    } as never,
    secrets: {} as never,
    settings: {} as never,
    client: { send() {}, watchView: () => () => {} },
    packs: {} as never,
  });
  return {
    spawn,
    replace(ref: string) { spawn(ref); notify(); },
  };
}

/** A component that edits a draft, as an editor's `v-model` would */
const Editor = defineComponent({
  props: { initial: { type: String, required: true } },
  setup(props) {
    const text = useSurfaceDraft('text', props.initial);
    return () => h('input', { value: text.value, onInput: (e: Event) => { text.value = (e.target as HTMLInputElement).value; } });
  },
});

function mount(surface: string, initial = 'initial') {
  const element = document.createElement('div');
  const app = createApp(defineComponent({ setup: () => () => h(SurfaceScope, { surface }, () => h(Editor, { initial })) }));
  app.mount(element);
  const input = () => element.querySelector('input')!;
  return {
    value: () => input().value,
    type(value: string) { input().value = value; input().dispatchEvent(new Event('input')); },
    unmount: () => app.unmount(),
  };
}

it('hands the remounted surface what was typed before its handle was replaced', async () => {
  const window = aWindow();
  window.spawn('pack/notes');
  const editor = mount('pack/notes');
  editor.type('typed');
  await nextTick();

  window.replace('pack/notes');
  await nextTick();

  expect(editor.value(), 'the draft survives the remount a reconnect causes').toBe('typed');
  editor.unmount();
});

it("keeps each surface's draft to itself, and starts a newly bound window with none", async () => {
  const window = aWindow();
  window.spawn('pack/notes');
  window.spawn('pack/other');
  const notes = mount('pack/notes');
  const other = mount('pack/other');
  notes.type('notes text');
  await nextTick();
  expect(other.value(), 'another surface has a draft of its own').toBe('initial');
  notes.unmount();
  other.unmount();

  unbindFeHost();
  aWindow().spawn('pack/notes');
  const again = mount('pack/notes', 'fresh');
  expect(again.value(), 'a draft lasts as long as its window').toBe('fresh');
  again.unmount();
});
