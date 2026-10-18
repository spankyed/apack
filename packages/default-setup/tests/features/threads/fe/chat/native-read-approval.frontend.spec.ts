import { createApp, h, reactive, nextTick } from 'vue'
import NativeReadApproval from '#features/threads/fe/chat/NativeReadApproval.vue'

it('renders native path/reason literally and emits only the selected one-time response', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const respond = vi.fn(), pause = vi.fn(), props = reactive({ title: 'Read file', question: 'Allow?', filePath: '/tmp/<script>fixture</script>', reason: '<img onerror=bad()>', disabled: false })
  const app = createApp({ render: () => h(NativeReadApproval, { ...props, onRespond: respond, onPause: pause }) }); app.mount(root)
  try {
    expect(root.querySelector('script,img')).toBeNull()
    expect(root.querySelector('code')?.textContent).toBe(props.filePath)
    const buttons = () => Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
    buttons().find(button => button.textContent === 'Approve')!.click()
    expect(respond).toHaveBeenLastCalledWith({ approved: true })
    const feedback = root.querySelector('textarea')!; feedback.value = '  Not this file  '; feedback.dispatchEvent(new Event('input')); await nextTick()
    buttons().find(button => button.textContent === 'Deny')!.click()
    expect(respond).toHaveBeenLastCalledWith({ approved: false, reason: 'Not this file' })
    buttons().find(button => button.textContent === 'Cancel')!.click(); expect(pause).toHaveBeenCalledOnce()
    props.disabled = true; await nextTick()
    expect(buttons().every(button => button.disabled)).toBe(true)
  } finally { app.unmount(); root.remove() }
})
