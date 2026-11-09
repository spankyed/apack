import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App, type Component } from 'vue'
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import ConversationViewer from '@apackdev/ui/components/tiptap/ConversationViewer'
import ChatMessage from '#features/threads/fe/chat/message.vue'
import type { MessageEntity } from '#generated/types.ts'
import type { ClaudeUiTranscriptFrame } from '#features/code/be/services/claude-code/ui-presentation.ts'

let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); stopFeTestRuntime(); vi.unstubAllGlobals() })
async function settle() { for (let i = 0; i < 6; i++) await nextTick() }

it('keeps ordinary Claude messages in one shared editor through native drawing replacement and retirement', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  startFeTestRuntime({ packs: { textEditor: () => [], onChanged: () => () => {} } as never })
  const messages = ref([{ id: 'first-message', entityType: 'Message', timestamp: 1, createdAt: 1, sender: 'assistant', text: '**First reply**' },
    { id: 'second-message', entityType: 'Message', timestamp: 2, createdAt: 2, sender: 'assistant', text: 'Second reply' }] as MessageEntity[])
  const frames = ref<ClaudeUiTranscriptFrame[]>([])
  const root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(ConversationViewer, { messages: messages.value }, {
    default: ({ id, content }: { id: string; content: Component }) => h(ChatMessage, {
      message: messages.value.find(message => message.id === id)!, isClaudeCodeThread: true, nativeFrames: frames.value,
    }, { default: () => h(content) }),
  }) })
  app.mount(root); await settle()
  expect(root.querySelectorAll('.ProseMirror')).toHaveLength(1)
  expect(root.querySelector('[data-message-id="first-message"] strong')?.textContent).toBe('First reply')
  const first = root.querySelector('[data-message-id="first-message"]')
  frames.value = [{ instanceRevision: 1, component: 'AssistantMessage', messageId: 'first-message', sessionId: 'session',
    uuid: 'native-first', text: '**First reply**', start: 0, end: 15, displayText: 'Native replacement', isFirstOfReply: true,
    body: { status: 'live', tree: { kind: 'box', children: [{ kind: 'text', text: 'Native replacement' }] } },
  }]
  await settle()
  expect(root.querySelector('[data-native-assistant]')?.textContent).toContain('Native replacement')
  expect(root.querySelector('[data-message-id="second-message"]')?.textContent).toContain('Second reply')
  frames.value = []; messages.value[1].text = '**Updated reply**'; await settle()
  expect(root.querySelector('[data-native-assistant]')).toBeNull()
  expect(root.querySelector('[data-message-id="first-message"]')).toBe(first)
  expect(root.querySelector('[data-message-id="first-message"] strong')?.textContent).toBe('First reply')
  expect(root.querySelector('[data-message-id="second-message"] strong')?.textContent).toBe('Updated reply')
  expect(root.querySelectorAll('.ProseMirror')).toHaveLength(1)
})
