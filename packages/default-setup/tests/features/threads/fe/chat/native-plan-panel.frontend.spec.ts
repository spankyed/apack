import { createApp, h, nextTick } from 'vue'
import NativePlanPanel from '#features/threads/fe/chat/NativePlanPanel.vue'
vi.mock('@apackdev/ui/components/tiptap/TiptapEditor', async () => { const { h } = await import('vue'); return { default: { props: ['modelValue'], render(this: { modelValue: string }) { return h('pre', this.modelValue) } } } })
it('retains edited plan/feedback and sends the selected native reset choice through the approval flow', async () => {
  const root = document.createElement('div'); document.body.append(root); const respond = vi.fn()
  const presentation = { plan: '# Original', initialChoice: 'yes-default-keep-context', empty: false, withheld: false, choices: [{ value: 'yes-default-keep-context', label: 'Keep context and manually approve edits', mode: 'default' as const, clearContext: false }, { value: 'yes-auto-clear-context', label: 'Clear context and use auto mode', mode: 'auto' as const, clearContext: true }] }
  const app = createApp({ render: () => h(NativePlanPanel, { entering: false, presentation, disabled: false, onRespond: respond }) }); app.mount(root)
  try {
    const buttons = () => Array.from(root.querySelectorAll('button'))
    buttons().find(button => button.textContent === 'Edit plan')!.click(); await nextTick()
    const editor = root.querySelector<HTMLTextAreaElement>('[aria-label="Edit proposed plan"]')!; editor.value = '# Revised <script>literal</script>'; editor.dispatchEvent(new Event('input'))
    const feedback = root.querySelector<HTMLTextAreaElement>('[aria-label="Plan feedback"]')!; feedback.value = '  Keep tests  '; feedback.dispatchEvent(new Event('input'))
    root.querySelector<HTMLInputElement>('[value="yes-auto-clear-context"]')!.click(); await nextTick()
    buttons().find(button => button.textContent === 'Approve plan')!.click()
    expect(respond).toHaveBeenCalledWith({ approved: true, choice: 'yes-auto-clear-context', reason: 'Keep tests', plan: '# Revised <script>literal</script>' })
    expect(respond.mock.calls[0][0].clearContext).toBeUndefined()
    expect(root.querySelector('script')).toBeNull()
  } finally { app.unmount(); root.remove() }
})
it('withholds approval for an unreviewable plan while retaining feedback and cancellation', () => {
  const root = document.createElement('div'); document.body.append(root); const respond = vi.fn(), pause = vi.fn()
  const app = createApp({ render: () => h(NativePlanPanel, { entering: false, presentation: { plan: '', initialChoice: '', empty: false, withheld: true, choices: [] }, disabled: false, onRespond: respond, onPause: pause }) }); app.mount(root)
  try {
    expect(root.querySelector('[data-testid="native-plan-withheld"]')).not.toBeNull()
    expect(root.textContent).not.toContain('Approve plan')
    const buttons = Array.from(root.querySelectorAll('button')); buttons.find(button => button.textContent === 'Keep planning')!.click(); buttons.find(button => button.textContent === 'Cancel')!.click()
    expect(respond).toHaveBeenCalledWith({ approved: false, reason: undefined }); expect(pause).toHaveBeenCalledOnce()
  } finally { app.unmount(); root.remove() }
})
