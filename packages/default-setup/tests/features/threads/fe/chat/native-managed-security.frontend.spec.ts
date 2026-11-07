import { createApp, h, nextTick, reactive, type App } from 'vue'
import type { ClaudeNativeNotice } from '#features/code/common/native-notice.ts'
import NativeManagedSecurityReview from '#features/threads/fe/chat/NativeManagedSecurityReview.vue'
let app: App | undefined
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }))
afterEach(async () => { app?.unmount(); await nextTick(); document.body.replaceChildren(); vi.unstubAllGlobals() })
async function fixture() {
  const notice: Extract<ClaudeNativeNotice, { kind: 'managed_settings_security' }> = { id: 'policy', revision: 'first', sessionId: 'session', kind: 'managed_settings_security', title: 'Managed settings require approval', paragraphs: ['Original introduction', 'Original bounded changes', 'Original advice', 'Original risk'], paragraphsAnsi: ['Original introduction', 'Original bounded changes', 'Original advice', '\x1b[33mOriginal risk\x1b[0m'], preferredChoice: 'policy_reject', choices: [{ value: 'policy_reject', label: 'No, exit Claude Code' }, { value: 'policy_approve', label: 'Yes, I trust these settings' }] }
  const state = reactive({ notice, pending: false, problem: undefined as string | undefined }), answer = vi.fn(), root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(NativeManagedSecurityReview, { ...state, onAnswer: answer }) }); app.mount(root); await nextTick()
  return { state, answer, dialog: () => document.querySelector('[role="alertdialog"]')! }
}
it('presents original risk styling and choices with native preferred focus', async () => {
  const f = await fixture(); await vi.waitFor(() => expect(document.activeElement?.textContent).toBe('No, exit Claude Code'))
  expect(f.dialog().textContent).toContain('Original bounded changes'); expect(f.dialog().textContent).toContain('Original risk')
  expect(f.dialog().querySelector('[style*="color"]')).not.toBeNull()
  f.dialog().querySelector<HTMLButtonElement>('[data-policy-decision="policy_approve"]')!.click()
  expect(f.answer).toHaveBeenCalledExactlyOnceWith({ id: 'policy', revision: 'first', sessionId: 'session', decision: 'policy_approve' }); expect(f.dialog()).toBeTruthy()
})
it('routes Escape to native rejection without locally dismissing the review', async () => {
  const f = await fixture(); f.dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await vi.waitFor(() => expect(f.answer).toHaveBeenCalledWith({ id: 'policy', revision: 'first', sessionId: 'session', decision: 'policy_reject' })); expect(f.dialog()).toBeTruthy()
})
it('keeps streamed review text current and blocks decisions while a native reply is pending', async () => {
  const f = await fixture(); f.state.notice = { ...f.state.notice, revision: 'replacement', paragraphs: ['Replacement introduction', 'Replacement changes', 'Replacement advice', 'Replacement risk'], paragraphsAnsi: ['Replacement introduction', 'Replacement changes', 'Replacement advice', 'Replacement risk'] }; await nextTick()
  expect(f.dialog().textContent).toContain('Replacement changes'); expect(f.dialog().textContent).not.toContain('Original bounded changes')
  f.state.pending = true; f.state.problem = 'Native review changed'; await nextTick()
  for (const button of f.dialog().querySelectorAll<HTMLButtonElement>('button')) expect(button.disabled).toBe(true)
  f.dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick(); expect(f.answer).not.toHaveBeenCalled()
  expect(f.dialog().querySelector('[role="alert"]')?.textContent).toBe('Native review changed')
})

it('keeps a queued click bound to the review rendered before a streamed replacement', async () => {
  const f = await fixture(), button = f.dialog().querySelector<HTMLButtonElement>('[data-policy-decision="policy_approve"]')!
  f.state.notice = { ...f.state.notice, revision: 'replacement' }
  button.click()
  expect(f.answer).toHaveBeenCalledExactlyOnceWith({ id: 'policy', revision: 'first', sessionId: 'session', decision: 'policy_approve' })
  await nextTick(); button.click()
  expect(f.answer).toHaveBeenLastCalledWith({ id: 'policy', revision: 'replacement', sessionId: 'session', decision: 'policy_approve' })
})
