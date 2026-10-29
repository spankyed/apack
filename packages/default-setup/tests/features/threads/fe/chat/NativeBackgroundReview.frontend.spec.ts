import { createApp, nextTick, reactive } from 'vue'
import NativeBackgroundReview from '#features/threads/fe/chat/NativeBackgroundReview.vue'
import type { ClaudeBackgroundReviewState } from '#features/code/common/native-background.ts'
it('retains native disclosure/focus and rejects old controls after review replacement', async () => {
  const state = reactive<ClaudeBackgroundReviewState>({ status: 'ready', review: { revision: crypto.randomUUID(), title: 'Background this session?', paragraphs: ['The active reviewer will restart.'], confirmLabel: 'Background with running review', cancelLabel: 'Stay', defaultFocus: 'confirm' } })
  const answer = vi.fn(), root = document.createElement('div'); document.body.append(root)
  const app = createApp(NativeBackgroundReview, { panelId: 'panel', state, onAnswer: answer }); app.mount(root)
  try {
    await nextTick(); expect(root.textContent).toContain('The active reviewer will restart.')
    const old = [...root.querySelectorAll('button')].find(button => button.textContent === 'Background with running review')!
    state.review = { ...state.review!, revision: crypto.randomUUID(), paragraphs: ['The replacement reviewer will restart.'] }; await nextTick()
    old.click(); expect(answer).not.toHaveBeenCalled()
    const current = [...root.querySelectorAll('button')].find(button => button.textContent === 'Background with running review')!
    await vi.waitFor(() => expect(document.activeElement).toBe(current))
    root.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(answer).toHaveBeenCalledExactlyOnceWith({ panelId: 'panel', revision: state.review!.revision, decision: 'cancel' })
    state.status = 'pending'; await nextTick(); current.click(); expect(answer).toHaveBeenCalledOnce()
  } finally { app.unmount(); root.remove() }
})
