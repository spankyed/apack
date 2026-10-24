import { createApp, h, nextTick, ref, type App } from 'vue'
import ToolActivityBlock from '#extensions/blocks/display/ToolActivityBlock.vue'
vi.mock('#generated/events.ts', () => ({ sendToSurface: vi.fn() }))
vi.mock('@apackdev/ui/components/JsonHoverPopup', () => ({ default: { inheritAttrs: false, setup: (_: unknown, { slots }: { slots: { default?: () => unknown } }) => () => slots.default?.() } }))
let app: App | undefined
afterEach(() => { app?.unmount(); document.body.replaceChildren() })
it('retains Agent status focus while native completion text refreshes', async () => {
  const agent = ref({ id: 'agent-a', name: 'Worker', status: 'running', statusText: 'Working' } as { id: string; name: string; status: 'running' | 'completed'; statusText?: string })
  const root = document.createElement('div'); document.body.append(root)
  app = createApp({ setup: () => () => h(ToolActivityBlock, { label: 'Native tools', state: 'done', defaultOpen: true, entries: [{ id: 'tool-a', tool: 'Agent', summary: 'Work', status: 'ok', nativeAgent: agent.value }] }) })
  app.mount(root); await nextTick()
  root.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click(); await nextTick()
  const viewport = root.querySelector<HTMLElement>('[data-testid="native-agent-status-text"]')!
  expect(viewport, root.innerHTML).not.toBeNull()
  viewport.focus(); expect(document.activeElement).toBe(viewport)
  agent.value = { id: 'agent-a', name: 'Worker', status: 'completed' }; await nextTick()
  expect(root.querySelector('[data-testid="native-agent-status-text"]')).toBe(viewport)
  expect(document.activeElement).toBe(viewport); expect(viewport.tabIndex).toBe(-1)
  agent.value.statusText = 'Completed'; await nextTick()
  expect(viewport.textContent).toBe('Completed'); expect(viewport.tabIndex).toBe(0)
  expect(document.activeElement).toBe(viewport)
})
