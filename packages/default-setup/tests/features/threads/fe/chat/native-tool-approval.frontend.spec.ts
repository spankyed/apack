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

it('shows only offered standing choices and emits the native token and edited prefix', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const respond = vi.fn(), bash = { token: 'a'.repeat(64), choices: [{ value: 'yes', label: 'Yes' }, { value: 'yes-prefix-edited', label: 'Remember command prefix', prefix: 'npm *' }, { value: 'no', label: 'No' }] }
  const app = createApp({ render: () => h(NativeToolApproval, { toolName: 'Bash', title: 'Run', question: 'Run?', command: 'npm run build', disabled: false, bash, onRespond: respond }) }); app.mount(root)
  try {
    const select = root.querySelector('select')!
    expect(Array.from(select.options).map(option => option.value)).toEqual(['yes', 'yes-prefix-edited'])
    select.value = 'yes-prefix-edited'; select.dispatchEvent(new Event('change')); await nextTick()
    const input = root.querySelector('input')!; expect(input.value).toBe('npm *')
    input.value = 'npm run *'; input.dispatchEvent(new Event('input')); await nextTick()
    Array.from(root.querySelectorAll('button')).find(button => button.textContent === 'Continue')!.click()
    expect(respond).toHaveBeenLastCalledWith({ approved: true, choice: 'yes-prefix-edited', choiceToken: bash.token, prefix: 'npm run *' })
    expect(root.querySelector('[data-testid="native-bash-command"]')?.textContent).toBe('npm run build')
  } finally { app.unmount(); root.remove() }
})

it('preserves an edited prefix through same-dialog presentation refreshes and temporary choice withdrawal', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const bash = reactive({ token: 'a'.repeat(64), choices: [{ value: 'yes', label: 'Yes' }, { value: 'yes-prefix-edited', label: 'Remember', prefix: 'npm *' }] })
  const respond = vi.fn(), app = createApp({ render: () => h(NativeToolApproval, { toolName: 'Bash', title: 'Run', question: 'Run?', command: 'npm run build', disabled: false, bash, onRespond: respond }) }); app.mount(root)
  try {
    const select = root.querySelector('select')!; select.value = 'yes-prefix-edited'; select.dispatchEvent(new Event('change')); await nextTick()
    const input = root.querySelector('input')!; input.value = 'npm run *'; input.dispatchEvent(new Event('input')); await nextTick()
    bash.token = 'b'.repeat(64); bash.choices = bash.choices.map(choice => ({ ...choice })); await nextTick()
    expect(root.querySelector('input')!.value).toBe('npm run *')
    const standing = bash.choices[1]!; bash.choices = [bash.choices[0]!]; await nextTick()
    expect(Array.from(root.querySelectorAll('button')).find(button => button.textContent === 'Continue')?.disabled).toBe(true)
    bash.choices = [bash.choices[0]!, standing]; await nextTick()
    expect(root.querySelector('input')!.value).toBe('npm run *')
    Array.from(root.querySelectorAll('button')).find(button => button.textContent === 'Continue')!.click()
    expect(respond).toHaveBeenLastCalledWith({ approved: true, choice: 'yes-prefix-edited', choiceToken: bash.token, prefix: 'npm run *' })
  } finally { app.unmount(); root.remove() }
})

it('shows the original file grant scope, respects native readiness and forwards only its selected token', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const respond = vi.fn(), pause = vi.fn()
  const file = reactive({ ready: false, token: 'a'.repeat(64), choices: [
    { value: 'yes', label: 'Yes', decision: 'allow' as const, feedback: true },
    { value: 'yes-session', label: 'Original native session permission scope', decision: 'allow' as const, feedback: false },
    { value: 'no', label: 'No', decision: 'deny' as const, feedback: true },
  ] })
  const app = createApp({ render: () => h(NativeToolApproval, { file, toolName: 'Write', title: 'Write file', question: 'Allow?', disabled: false, onRespond: respond, onPause: pause }) }); app.mount(root)
  const button = (text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === text)!
  try {
    expect(button('Allow once').disabled).toBe(true); expect(button('Cancel').disabled).toBe(false)
    file.ready = true; await nextTick()
    const select = root.querySelector('select')!; select.value = 'yes-session'; select.dispatchEvent(new Event('change')); await nextTick()
    expect(root.querySelector('[data-testid="native-file-permission-choice-description"]')?.textContent).toBe(file.choices[1].label)
    button('Continue').click()
    expect(respond).toHaveBeenLastCalledWith({ approved: true, choice: 'yes-session', choiceToken: file.token })
    const reason = root.querySelector('textarea')!; reason.value = 'Leave it unchanged'; reason.dispatchEvent(new Event('input')); await nextTick(); button('Deny').click()
    expect(respond).toHaveBeenLastCalledWith({ approved: false, reason: 'Leave it unchanged', choice: 'no', choiceToken: file.token })
    file.choices.splice(1, 1); file.token = 'b'.repeat(64); await nextTick()
    expect(button('Continue').disabled).toBe(true)
  } finally { app.unmount(); root.remove() }
})

it.each([false, true])('uses native Workflow script visibility and approval eligibility: withheld %s', withheld => {
  const root = document.createElement('div'); document.body.append(root)
  const respond = vi.fn(), workflow = { token: 'a'.repeat(64), ready: true, withheld, ...(withheld ? {} : { script: '<script>literal workflow</script>' }), choices: [...(withheld ? [] : [{ value: 'yes' as const, label: 'Yes, run it', decision: 'allow' as const, feedback: true }]), { value: 'no' as const, label: 'No', decision: 'deny' as const, feedback: true }] }
  const app = createApp({ render: () => h(NativeToolApproval, { toolName: 'Workflow', title: 'Review workflow', question: 'Run?', disabled: false, workflow, onRespond: respond }) }); app.mount(root)
  try {
    expect(root.querySelector('script')).toBeNull()
    const allow = root.querySelector<HTMLButtonElement>('button.approve')!
    expect(allow.disabled).toBe(withheld)
    if (!withheld) { expect(root.querySelector('[data-testid="native-workflow-script"]')?.textContent).toBe(workflow.script); allow.click(); expect(respond).toHaveBeenLastCalledWith({ approved: true, choice: 'yes', choiceToken: workflow.token }) }
    root.querySelector<HTMLButtonElement>('button.deny')!.click()
    expect(respond).toHaveBeenLastCalledWith({ approved: false, reason: undefined, choice: 'no', choiceToken: workflow.token })
  } finally { app.unmount(); root.remove() }
})

it('switches native-derived Workflow summary/raw presentation without answering and resets on replacement', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const respond = vi.fn(), edit = vi.fn(), workflow = reactive({ token: 'a'.repeat(64), ready: true, withheld: false, canEdit: true, script: 'original script', raw: false,
    summary: [{ title: '<script>Review</script>', detail: 'Original detail', prompts: ['Inspect migration notes'] }],
    choices: [{ value: 'yes' as const, label: 'Yes, run it', decision: 'allow' as const, feedback: true }, { value: 'no' as const, label: 'No', decision: 'deny' as const, feedback: true }] })
  const app = createApp({ render: () => h(NativeToolApproval, { toolName: 'Workflow', title: 'Review workflow', question: 'Run?', disabled: false, workflow, onRespond: respond, 'onEdit-workflow': edit }) }); app.mount(root)
  const button = (text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === text)!
  try {
    button('Edit in native interface').click(); expect(edit).toHaveBeenCalledOnce(); expect(respond).not.toHaveBeenCalled()
    expect(root.querySelector('script')).toBeNull(); expect(root.querySelector('[data-testid="native-workflow-summary"]')?.textContent).toContain('Inspect migration notes')
    button('View raw script').click(); await nextTick(); expect(root.querySelector('[data-testid="native-workflow-script"]')?.textContent).toBe('original script'); expect(respond).not.toHaveBeenCalled()
    workflow.token = 'b'.repeat(64); await nextTick(); expect(root.querySelector('[data-testid="native-workflow-summary"]')).not.toBeNull()
    button('View raw script').click(); await nextTick(); button('View workflow summary').click(); await nextTick(); expect(respond).not.toHaveBeenCalled()
    button('Yes, run it').click(); expect(respond).toHaveBeenLastCalledWith({ approved: true, choice: 'yes', choiceToken: workflow.token })
  } finally { app.unmount(); root.remove() }
})

it('retains native editor access for a withheld Workflow without exposing or approving its script', () => {
  const root = document.createElement('div'); document.body.append(root)
  const edit = vi.fn(), respond = vi.fn(), workflow = { token: 'a'.repeat(64), ready: true, withheld: true, canEdit: true, choices: [{ value: 'no' as const, label: 'No', decision: 'deny' as const, feedback: true }] }
  const app = createApp({ render: () => h(NativeToolApproval, { toolName: 'Workflow', title: 'Review workflow', question: 'Run?', disabled: false, workflow, onRespond: respond, 'onEdit-workflow': edit }) }); app.mount(root)
  try {
    expect(root.querySelector('[data-testid="native-workflow-script"],[data-testid="native-workflow-summary"]')).toBeNull()
    const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Edit in native interface')!
    expect(button.disabled).toBe(false); button.click(); expect(edit).toHaveBeenCalledOnce(); expect(respond).not.toHaveBeenCalled(); expect(root.querySelector<HTMLButtonElement>('button.approve')!.disabled).toBe(true)
  } finally { app.unmount(); root.remove() }
})

it.each(['replace', 'insert', 'delete'] as const)('shows NotebookEdit %s cell semantics and escapes native cell content', mode => {
  const root = document.createElement('div'); document.body.append(root)
  const app = createApp({ render: () => h(NativeToolApproval, { toolName: 'NotebookEdit', title: 'Edit notebook', question: 'Allow this cell change?', filePath: '/fixture/review.ipynb', disabled: false, review: { withheld: false, notebook: { editMode: mode, cellId: 'analysis', cellType: 'code' }, ...(mode === 'insert' ? {} : { before: '<script>before</script>' }), ...(mode === 'delete' ? {} : { after: '<img>after' }) } }) }); app.mount(root)
  try {
    expect(root.querySelector('script,img')).toBeNull()
    expect(root.querySelector('[data-testid="native-notebook-operation"]')?.textContent).toContain({ replace: 'Replace cell', insert: 'Insert cell', delete: 'Delete cell' }[mode])
    expect(root.textContent).toContain('analysis'); expect(root.textContent).toContain('/fixture/review.ipynb')
    if (mode === 'delete') { expect(root.querySelector('[data-testid="native-file-after"]')).toBeNull(); expect(root.textContent).toContain('This cell will be removed.') }
    else expect(root.querySelector('[data-testid="native-file-after"]')?.textContent).toBe('<img>after')
    if (mode === 'insert') { expect(root.querySelector('[data-testid="native-file-before"]')).toBeNull(); expect(root.textContent).toContain('New cell'); expect(root.textContent).not.toContain('New file') }
  } finally { app.unmount(); root.remove() }
})
it('does not manufacture a cell diff when the original notebook preview is withheld', () => {
  const root = document.createElement('div'); document.body.append(root)
  const app = createApp({ render: () => h(NativeToolApproval, { toolName: 'NotebookEdit', title: 'Edit notebook', question: 'Allow?', filePath: '/fixture/review.ipynb', disabled: false, review: { withheld: true, notice: 'Notebook is too large to preview', notebook: { editMode: 'delete', cellId: 'analysis' } } }) }); app.mount(root)
  try { expect(root.textContent).toContain('Notebook is too large to preview'); expect(root.querySelector('[data-testid="native-file-before"],[data-testid="native-file-after"]')).toBeNull(); expect(root.textContent).not.toContain('This cell will be removed.') }
  finally { app.unmount(); root.remove() }
})

it('shows only original WebFetch scopes and native preview, gates readiness and sends the current choice token', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const tool = reactive({ token: 'a'.repeat(64), ready: false, title: 'Fetch', details: [{ label: 'URL', value: 'Original withheld URL marker' }], choices: [
    { value: 'yes', label: 'Yes', decision: 'allow' as const, feedback: false },
    { value: 'yes-dont-ask-again-domain', label: 'Original domain permission scope', decision: 'allow' as const, feedback: false },
    { value: 'no', label: 'No', decision: 'deny' as const, feedback: false },
  ] })
  const respond = vi.fn(), app = createApp({ render: () => h(NativeToolApproval, { toolName: 'WebFetch', title: tool.title, question: 'Fetch this content?', disabled: false, tool, onRespond: respond }) }); app.mount(root)
  try {
    expect(root.textContent).toContain('Original withheld URL marker')
    expect(root.querySelector('textarea')).toBeNull()
    expect(root.querySelector<HTMLButtonElement>('.approve')!.disabled).toBe(true)
    expect(root.querySelector<HTMLButtonElement>('.deny')!.disabled).toBe(true)
    tool.ready = true; tool.token = 'b'.repeat(64); await nextTick()
    const select = root.querySelector('select')!
    expect(Array.from(select.options).map(option => option.value)).toEqual(['yes', 'yes-dont-ask-again-domain'])
    select.value = 'yes-dont-ask-again-domain'; select.dispatchEvent(new Event('change')); await nextTick()
    expect(root.querySelector('[data-testid="native-tool-permission-choice-description"]')?.textContent).toBe('Original domain permission scope')
    root.querySelector<HTMLButtonElement>('.approve')!.click()
    expect(respond).toHaveBeenLastCalledWith({ approved: true, choice: 'yes-dont-ask-again-domain', choiceToken: tool.token })
    tool.choices.splice(1, 1); await nextTick()
    expect(root.querySelector<HTMLButtonElement>('.approve')!.disabled).toBe(true)
  } finally { app.unmount(); root.remove() }
})

it('preserves exact native-supported Skill feedback for allow and deny, and excludes it from standing choices', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const tool = { token: 'a'.repeat(64), ready: true, title: 'Use skill?', details: [{ label: 'Skill', value: 'release-review' }], choices: [
    { value: 'yes', label: 'Yes', decision: 'allow' as const, feedback: true },
    { value: 'yes-exact', label: 'Remember this original skill', decision: 'allow' as const, feedback: false },
    { value: 'no', label: 'No', decision: 'deny' as const, feedback: true },
  ] }
  const respond = vi.fn(), app = createApp({ render: () => h(NativeToolApproval, { toolName: 'Skill', title: tool.title, question: 'Use this skill?', disabled: false, tool, onRespond: respond }) }); app.mount(root)
  try {
    const feedback = root.querySelector('textarea')!
    expect(feedback.getAttribute('aria-label')).toBe('Feedback for Claude')
    feedback.value = '  Review the migration notes first.  '; feedback.dispatchEvent(new Event('input')); await nextTick()
    root.querySelector<HTMLButtonElement>('.approve')!.click()
    expect(respond).toHaveBeenLastCalledWith({ approved: true, choice: 'yes', choiceToken: tool.token, reason: feedback.value })
    root.querySelector<HTMLButtonElement>('.deny')!.click()
    expect(respond).toHaveBeenLastCalledWith({ approved: false, choice: 'no', choiceToken: tool.token, reason: feedback.value })
    const select = root.querySelector('select')!; select.value = 'yes-exact'; select.dispatchEvent(new Event('change')); await nextTick()
    expect(feedback.disabled).toBe(true)
    root.querySelector<HTMLButtonElement>('.approve')!.click()
    expect(respond).toHaveBeenLastCalledWith({ approved: true, choice: 'yes-exact', choiceToken: tool.token })
  } finally { app.unmount(); root.remove() }
})


it('shows only native generic choices and explanations, then withdraws a changed grant without a fallback', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const tool = reactive({ token: 'a'.repeat(64), ready: true, title: 'Tool use', details: [{ label: 'Parameters', value: 'Original native withheld marker' }], choices: [
    { value: 'yes', label: 'Yes', decision: 'allow' as const, feedback: true },
    { value: 'yes-enable-auto-mode', label: 'Original offered mode', decision: 'allow' as const, feedback: false },
    { value: 'no', label: 'No', decision: 'deny' as const, feedback: true },
  ] })
  const respond = vi.fn(), app = createApp({ render: () => h(NativeToolApproval, { toolName: 'mcp__research__echo', title: tool.title, question: 'Do you want to proceed?', disabled: false, tool, choiceDescriptions: { 'yes-enable-auto-mode': 'Original mode explanation <script>literal</script>' }, onRespond: respond }) }); app.mount(root)
  try {
    expect(root.textContent).toContain('Original native withheld marker')
    const select = root.querySelector('select')!; select.value = 'yes-enable-auto-mode'; select.dispatchEvent(new Event('change')); await nextTick()
    expect(root.textContent).toContain('Original mode explanation <script>literal</script>'); expect(root.querySelector('script')).toBeNull()
    root.querySelector<HTMLButtonElement>('.approve')!.click()
    expect(respond).toHaveBeenLastCalledWith({ approved: true, choice: 'yes-enable-auto-mode', choiceToken: tool.token })
    tool.choices.splice(1, 1); tool.token = 'b'.repeat(64); await nextTick()
    expect(root.querySelector<HTMLButtonElement>('.approve')!.disabled).toBe(true)
    expect(root.querySelector('select')).toBeNull()
  } finally { app.unmount(); root.remove() }
})
