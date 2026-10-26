// @vitest-environment jsdom
// What a surface's component holds for the user survives the remount a reconnect causes: the shell replaces the
// surface's actor, `SurfaceScope` remounts the surface for it, and the draft is handed back, kept by the surface's ref.
import { afterEach, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createActor, setup } from 'xstate';
import type { AnyActorRef } from 'xstate';
import { SurfaceScope } from '../../src/fe/actor-system.ts';
import { useSurfaceDraft } from '../../src/fe/surface-draft.ts';
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';

afterEach(() => unbindFeHost());

/** A window whose shell runs one actor per ref, which `replace` swaps the way a reconnect does */
function aWindow() {
  const running = new Map<string, AnyActorRef>();
  const shell = createActor(setup({}).createMachine({ on: { CHANGED: {} } })).start();
  const spawn = (ref: string) => running.set(ref, createActor(setup({}).createMachine({}), { id: ref }).start());
  bindFeHost({ catalog: {} as never, application: {
    system: { get: (ref: string) => running.get(ref) },
    subscribe: (listener: () => void) => shell.subscribe(listener),
  } as never, secrets: {} as never, settings: {} as never, client: { send() {}, watchView: () => () => {} }, packs: {} as never });
  return {
    spawn,
    replace(ref: string) { running.get(ref)!.stop(); spawn(ref); shell.send({ type: 'CHANGED' }); },
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

it('hands the remounted surface what was typed before its actor was replaced', async () => {
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
