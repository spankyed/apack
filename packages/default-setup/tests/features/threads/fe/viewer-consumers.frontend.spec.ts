import { afterEach, expect, it } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createActor, createMachine } from 'xstate';
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing';
import { SurfaceScope, type ArtifactFrontendBinding, type BlockFrontendBinding } from '@apackdev/sdk/fe';
import type { ArtifactCatalogEntry, BlockCatalogEntry } from '@apackdev/sdk/framework';
import ContentViewer from '#features/threads/fe/canvas/agent/content-viewer.vue';
import InteractionContainer from '#features/threads/fe/chat/interactions/InteractionContainer.vue';
import ChatMessage from '#features/threads/fe/chat/message.vue';
import type { MessageEntity } from '#generated/types.ts';

let app: App | undefined;
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); stopFeTestRuntime(); });

function fixture() {
  const owner = { packId: 'external', origin: 'native' as const, enabled: true };
  const artifact: ArtifactCatalogEntry = { ...owner, type: 'card', declaration: { icon: 'Folder', fe: 'src/card.vue' } };
  const block: BlockCatalogEntry = { ...owner, type: 'answer', declaration: { kind: 'input', fe: 'src/answer.vue' } };
  const state = { artifacts: [artifact], blocks: [block] };
  const artifacts = new Map<string, ArtifactFrontendBinding>(); const blocks = new Map<string, BlockFrontendBinding>();
  const catalogListeners = new Set<() => void>(); const bindingListeners = new Set<() => void>();
  const actor = createActor(createMachine({}));
  startFeTestRuntime({
    application: { system: { get: () => actor }, subscribe: () => ({ unsubscribe() {} }) } as never,
    catalog: { status: () => 'ready', problem: () => undefined, references: () => [], frontend: () => [], steps: () => [],
      artifacts: () => state.artifacts, blocks: () => state.blocks, events: () => [], dsl: () => [],
      subscribe(listener) { catalogListeners.add(listener); return () => { catalogListeners.delete(listener); }; } },
    packs: { artifactBindings: () => artifacts, blockBindings: () => blocks,
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

it('renders input props only with the current block declaration and drops a disabled component', async () => {
  const f = fixture();
  const component = { props: ['disabled', 'response'], setup: (props: { disabled: boolean; response: { text: string } }) =>
    () => h('div', { class: 'custom-input' }, `${props.disabled}:${props.response.text}`) };
  app = createApp({ render: () => h(SurfaceScope, { surface: 'external/threads' }, {
    default: () => h(InteractionContainer, { blocks: [{ type: 'answer', props: {} }], messageId: 'message', isDisabled: true, response: { _source: 'answer', text: 'saved response' } }),
  }) });
  app.mount(f.root); expect(f.root.querySelector('.custom-input')).toBeNull();
  f.blocks.set('answer', { packId: 'external', declaration: f.block.declaration,
    binding: { type: 'answer', kind: 'input', fe: { component } } });
  f.publish(f.bindingListeners); await nextTick();
  expect(f.root.querySelector('.custom-input')?.textContent).toBe('true:saved response');
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
