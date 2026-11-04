import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createActor, createMachine } from 'xstate';
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing';
import { SurfaceScope, type ArtifactFrontendBinding, type BlockFrontendBinding } from '@apackdev/sdk/fe';
import type { ArtifactCatalogEntry, BlockCatalogEntry } from '@apackdev/sdk/framework';
import ContentViewer from '#features/threads/fe/canvas/agent/content-viewer.vue';
import ChatMessage from '#features/threads/fe/chat/message.vue';
import type { MessageEntity } from '#generated/types.ts';
import ConversationViewer from '@apackdev/ui/components/tiptap/ConversationViewer';

let app: App | undefined;
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); stopFeTestRuntime(); vi.unstubAllGlobals(); });

function fixture() {
  const owner = { packId: 'external', origin: 'native' as const, enabled: true };
  const artifact: ArtifactCatalogEntry = { ...owner, type: 'card', declaration: { icon: 'Folder', fe: 'src/card.vue' } };
  const block: BlockCatalogEntry = { ...owner, type: 'approval', declaration: { kind: 'input', fe: 'src/approval.vue' } };
  const state = { artifacts: [artifact], blocks: [block] };
  const artifacts = new Map<string, ArtifactFrontendBinding>(); const blocks = new Map<string, BlockFrontendBinding>();
  const catalogListeners = new Set<() => void>(); const bindingListeners = new Set<() => void>();
  const actor = createActor(createMachine({}));
  startFeTestRuntime({
    application: { system: { get: () => actor }, subscribe: () => ({ unsubscribe() {} }) } as never,
    catalog: { status: () => 'ready', problem: () => undefined, references: () => [], frontend: () => [], steps: () => [],
      artifacts: () => state.artifacts, blocks: () => state.blocks, events: () => [], dsl: () => [],
      subscribe(listener) { catalogListeners.add(listener); return () => { catalogListeners.delete(listener); }; } },
    packs: { artifactBindings: () => artifacts, blockBindings: () => blocks, textEditor: () => [],
      onChanged(listener: () => void) { bindingListeners.add(listener); return () => { bindingListeners.delete(listener); }; } } as never,
  });
  const publish = (listeners = catalogListeners) => { for (const listener of listeners) listener(); };
  const root = document.createElement('div'); document.body.appendChild(root);
  return { artifact, block, state, artifacts, blocks, catalogListeners, bindingListeners, publish, root };
}

it('updates an already-mounted artifact list and viewer across independent declaration and binding publications', async () => {
  const f = fixture();
  app = createApp(ContentViewer, { artifacts: [{ id: 'a', type: 'card', title: 'Saved card', content: 'Saved text' }], selectedArtifactId: 'a' });
  app.mount(f.root);
  expect(f.root.textContent).toContain('Saved text'); expect(f.root.querySelector('.lucide-folder')).not.toBeNull();
  const component = { render: () => h('div', { class: 'custom-viewer' }, 'Custom card') };
  f.artifacts.set('card', { packId: 'external', declaration: f.artifact.declaration,
    binding: { type: 'card', fe: { icon: {}, component } } });
  f.publish(f.bindingListeners); await nextTick();
  expect(f.root.querySelector('.custom-viewer')).not.toBeNull();
  f.state.artifacts = [{ ...f.artifact, declaration: { icon: 'FileText', fe: 'src/new-card.vue' } }];
  f.publish(); await nextTick();
  expect(f.root.querySelector('.custom-viewer')).toBeNull();
  expect(f.root.textContent).toContain('Saved text'); expect(f.root.querySelector('.lucide-file-text')).not.toBeNull();
  app.unmount(); app = undefined;
  expect(f.catalogListeners.size).toBe(0); expect(f.bindingListeners.size).toBe(0);
});

it('renders current block bindings inside conversation node views and drops disabled contributions', async () => {
  const f = fixture();
  const component = { props: ['disabled', 'response'], setup: (props: { disabled: boolean; response: { approved: boolean } }) =>
    () => h('div', { class: 'custom-input' }, `${props.disabled}:${props.response.approved}`) };
  const message: MessageEntity = { id: 'Message-block', entityType: 'Message', timestamp: 0, createdAt: 0,
    sender: 'assistant', text: 'Body', blocks: [{ type: 'approval', props: {} }], responseTimestamp: 1,
    blockResponse: { approved: true } };
  app = createApp({ render: () => h(SurfaceScope, { surface: 'external/threads' }, {
    default: () => h(ConversationViewer, { messages: [message] }, {
      default: ({ content }: { content: object }) => h(ChatMessage, { message }, { default: () => h(content) }),
    }),
  }) });
  app.mount(f.root);
  await vi.waitFor(() => expect(f.root.querySelector('[data-message-id="Message-block"]')).not.toBeNull());
  expect(f.root.querySelector('.custom-input')).toBeNull();
  f.blocks.set('approval', { packId: 'external', declaration: f.block.declaration,
    binding: { type: 'approval', kind: 'input', fe: { component } } });
  f.publish(f.bindingListeners); await nextTick();
  expect(f.root.querySelector('.custom-input')?.textContent).toBe('true:true');
  f.state.blocks = [{ ...f.block, enabled: false }]; f.publish(); await nextTick();
  expect(f.root.querySelector('.custom-input')).toBeNull();
  app.unmount(); app = undefined;
  expect(f.catalogListeners.size).toBe(0); expect(f.bindingListeners.size).toBe(0);
});

it('keeps a message body mounted when its aside is expanded and collapsed', async () => {
  const f = fixture();
  const message: MessageEntity = { id: 'Message-viewer', entityType: 'Message', timestamp: 0, createdAt: 0,
    sender: 'assistant', text: 'Body', autoHide: true, asideText: 'Summary' };
  app = createApp({ render: () => h(ChatMessage, { message }, {
    default: () => h('p', { 'data-body': '' }, 'Body'),
  }) });
  app.mount(f.root); await nextTick();
  const body = f.root.querySelector('[data-body]')!;
  expect(body).not.toBeNull();
  const bubble = body.closest<HTMLElement>('.group > .relative')!;
  expect(bubble.style.display).toBe('none');
  f.root.querySelector<HTMLElement>('.cursor-pointer')!.click(); await nextTick();
  expect(bubble.style.display).toBe('');
  f.root.querySelector<HTMLButtonElement>('[title="Collapse"]')!.click(); await nextTick();
  expect(bubble.style.display).toBe('none');
  expect(f.root.querySelector('[data-body]')).toBe(body);
});

it('preserves normal sidebar wheel scrolling and consumes compact wheel only when the strip moves', () => {
  const f = fixture();
  app = createApp(ContentViewer, { artifacts: [], compact: false }); app.mount(f.root);
  let list = f.root.querySelector('[data-onboarding-id="agent-artifacts"]')!.firstElementChild as HTMLElement;
  const wheel = (target: HTMLElement, input: WheelEventInit) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...input });
    target.dispatchEvent(event); return event.defaultPrevented;
  };
  expect(wheel(list, { deltaY: 80 })).toBe(false);
  app.unmount();
  app = createApp(ContentViewer, { artifacts: [], compact: true }); app.mount(f.root);
  list = f.root.querySelector('[data-onboarding-id="agent-artifacts"]')!.firstElementChild as HTMLElement;
  Object.defineProperties(list, { scrollWidth: { value: 500 }, clientWidth: { value: 200 } });
  expect(wheel(list, { deltaY: 80 })).toBe(true); expect(list.scrollLeft).toBe(80);
  expect(wheel(list, { deltaY: 400 })).toBe(true); expect(list.scrollLeft).toBe(300);
  expect(wheel(list, { deltaY: 80 })).toBe(false); expect(list.scrollLeft).toBe(300);
  expect(wheel(list, { deltaY: -60 })).toBe(true); expect(list.scrollLeft).toBe(240);
  expect(wheel(list, { deltaX: 20, deltaY: 40 })).toBe(false);
  expect(wheel(list, { deltaY: 40, ctrlKey: true })).toBe(false);
  expect(wheel(list, { deltaY: 40, shiftKey: true })).toBe(false);
  expect(list.scrollLeft).toBe(240);
});
