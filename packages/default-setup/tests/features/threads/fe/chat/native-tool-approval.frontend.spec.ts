import { createApp, h, reactive, nextTick } from 'vue'
import NativeToolApproval from '#features/threads/fe/chat/NativeToolApproval.vue'

it('renders native path/reason literally and emits only the selected one-time response', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const respond = vi.fn(), pause = vi.fn(), props = reactive({ toolName: 'Read' as const, title: 'Read file', question: 'Allow?', filePath: '/tmp/<script>fixture</script>', reason: '<img onerror=bad()>', disabled: false })
  const app = createApp({ render: () => h(NativeToolApproval, { ...props, onRespond: respond, onPause: pause }) }); app.mount(root)
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

it('keeps the Bash command and working directory literal and offers only a one-time allow', () => {
  const root = document.createElement('div'); document.body.append(root)
  const respond = vi.fn()
  const app = createApp({ render: () => h(NativeToolApproval, { toolName: 'Bash', title: 'Run shell command', question: 'Run?', command: 'printf "<script>literal</script>"\nprintf second', cwd: '/tmp/<b>workspace</b>', disabled: false, onRespond: respond }) }); app.mount(root)
  try {
    expect(root.querySelector('script,b')).toBeNull()
    expect(root.querySelector('[data-testid="native-bash-command"]')?.textContent).toBe('printf "<script>literal</script>"\nprintf second')
    expect(root.querySelector('[data-testid="native-bash-cwd"]')?.textContent).toBe('/tmp/<b>workspace</b>')
    Array.from(root.querySelectorAll('button')).find(button => button.textContent === 'Allow once')!.click()
    expect(respond).toHaveBeenCalledWith({ approved: true })
  } finally { app.unmount(); root.remove() }
})

it.each([false, true])('shows literal file changes or the native withheld warning: %s', withheld => {
  const root = document.createElement('div'); document.body.append(root)
  const app = createApp({ render: () => h(NativeToolApproval, { toolName: 'Edit', title: 'Edit file', question: 'Allow edit?', filePath: '/fixture', disabled: false, review: withheld ? { withheld: true, notice: 'Cannot review this change' } : { withheld: false, before: '<script>before</script>', after: '<img>after', replaceAll: true } }) }); app.mount(root)
  try {
    expect(root.querySelector('script,img')).toBeNull()
    if (withheld) { expect(root.textContent).toContain('Cannot review this change'); expect(root.querySelector('[data-testid="native-file-before"],[data-testid="native-file-after"]')).toBeNull() }
    else { expect(root.querySelector('[data-testid="native-file-before"]')?.textContent).toBe('<script>before</script>'); expect(root.querySelector('[data-testid="native-file-after"]')?.textContent).toBe('<img>after'); expect(root.textContent).toContain('Replace all matching occurrences') }
  } finally { app.unmount(); root.remove() }
})
