import { createApp, h, nextTick, ref } from 'vue'
import NativePlanPanel, { type ClaudePlanReviewDraft } from '#features/threads/fe/chat/NativePlanPanel.vue'
import type { ClaudePlanPresentation } from '#features/code/common/native-plan.ts'
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


it('emits the displayed decision scope for Cancel and keeps an earlier delivery immutable',async()=>{
 const scope=ref({ownerId:'owner',sessionId:'session',messageId:'message',id:'dialog',revision:'revision',requestId:'request',toolName:'EnterPlanMode'});
 const pause=vi.fn(),root=document.createElement('div');document.body.append(root);
 const app=createApp({render:()=>h(NativePlanPanel,{entering:true,presentation:{plan:'',initialChoice:'',empty:true,withheld:false,choices:[]},pauseScope:scope.value,disabled:false,onPause:pause})});app.mount(root);
 try{
  const cancel=()=>[...root.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Cancel')!;
  cancel().click();expect(pause).toHaveBeenLastCalledWith(scope.value);const captured=pause.mock.calls[0][0];
  scope.value={...scope.value,ownerId:'replacement-owner',revision:'replacement-revision'};await nextTick();
  cancel().click();expect(pause).toHaveBeenLastCalledWith(scope.value);
  expect(captured).toMatchObject({ownerId:'owner',revision:'revision'});
 }finally{app.unmount();root.remove()}
});


it.each([false, true])('keeps plan edits after a choice is withdrawn (panel remounted: %s)', async remount => {
  const auto = { value: 'auto', label: 'Clear context and use auto mode', mode: 'auto' as const, clearContext: true }
  const accept = { value: 'accept', label: 'Clear context and auto-accept edits', mode: 'acceptEdits' as const, clearContext: true }
  const presentation = ref<ClaudePlanPresentation>({ plan: '# Original', initialChoice: auto.value, empty: false, withheld: false, choices: [auto] })
  const root = document.createElement('div')
  document.body.append(root)
  const respond = vi.fn()
  const visible = ref(true), review = ref<ClaudePlanReviewDraft>()
  const app = createApp({ render: () => visible.value ? h(NativePlanPanel, {
    entering: false, presentation: presentation.value, disabled: false, onRespond: respond, review: review.value,
    'onUpdate:review': draft => { review.value = draft },
  }) : null })
  app.mount(root)
  const button = (label: string) => Array.from(root.querySelectorAll('button')).find(item => item.textContent === label)!
  const field = (label: string) => root.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!
  const fill = (label: string, text: string) => {
    const target = field(label)
    target.value = text
    target.dispatchEvent(new Event('input'))
  }
  try {
    button('Edit plan').click()
    await nextTick()
    fill('Edit proposed plan', '# Revised')
    fill('Plan feedback', 'Keep the checklist')
    if (remount) {
      visible.value = false
      await nextTick()
    }
    presentation.value = { ...presentation.value, choices: [accept], initialChoice: accept.value }
    visible.value = true
    await nextTick()
    expect(field('Edit proposed plan').value).toBe('# Revised')
    expect(field('Plan feedback').value).toBe('Keep the checklist')
    expect(root.querySelector('input:checked')).toBeNull()
    expect(root.querySelector('[role="status"]')?.textContent).toContain('Choose how to continue')
    expect(button('Approve plan').disabled).toBe(true)
    button('Approve plan').click()
    expect(respond).not.toHaveBeenCalled()

    root.querySelector<HTMLInputElement>('input[value="accept"]')!.click()
    await nextTick()
    expect(root.querySelector('[role="status"]')).toBeNull()
    button('Approve plan').click()
    expect(respond).toHaveBeenCalledExactlyOnceWith({ approved: true, choice: accept.value, reason: 'Keep the checklist', plan: '# Revised' })

    presentation.value = { ...presentation.value, plan: '# New native plan' }
    await nextTick()
    expect(field('Edit proposed plan')).toBeNull()
    expect(field('Plan feedback').value).toBe('')
    expect(root.textContent).toContain('# New native plan')
  } finally { app.unmount(); root.remove() }
})
