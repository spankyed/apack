import { createApp, h, reactive, nextTick } from 'vue'
import type { ClaudeQuestionPresentation } from '#features/code/common/native-question.ts'
import NativeQuestionPanel from '#features/threads/fe/chat/NativeQuestionPanel.vue'

function mount(card: Record<string, unknown>, presentation?: ClaudeQuestionPresentation) {
  const root = document.createElement('div'); document.body.append(root)
  const props = reactive({ card, presentation, disabled: false, renderToken: 'initial-token' }), respond = vi.fn(), pause = vi.fn(), started = vi.fn()
  const app = createApp({ render: () => h(NativeQuestionPanel, { ...props, onRespond: respond, onPause: pause, onStarted: started }) }); app.mount(root)
  const button = (text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === text)!
  const input = async (selector: string, text: string) => { const element = root.querySelector<HTMLInputElement>(selector)!; element.value = text; element.dispatchEvent(new Event('input', { bubbles: true })); await nextTick() }
  return { root, props, respond, pause, started, button, input, close() { app.unmount(); root.remove() } }
}
const option = (label: string, preview?: string) => ({ label, description: label + ' description', ...(preview ? { preview } : {}) })
it('retains custom/multi/annotation drafts across navigation and identical owner projections', async () => {
  const f = mount({ questions: [{ question: 'First?', header: 'First', options: [option('Alpha'), option('Beta')] }, { question: 'Second?', header: 'Second', multiSelect: true, options: [option('Gamma', '<script>literal</script>'), option('Delta')] }] })
  try {
    await f.input('.answer textarea', 'Custom Alpha'); f.button('Next').click(); await nextTick()
    const inputs = f.root.querySelectorAll<HTMLInputElement>('input[type=checkbox]'); inputs[0].click(); inputs[1].click(); await nextTick()
    await f.input('textarea[aria-label="Notes for this question"]', 'Native notes')
    expect(f.root.querySelector('script')).toBeNull(); expect(f.root.querySelector('pre')?.textContent).toBe('<script>literal</script>')
    f.button('Back').click(); await nextTick(); expect(f.root.querySelector<HTMLTextAreaElement>('.answer textarea')?.value).toBe('Custom Alpha')
    f.props.card = JSON.parse(JSON.stringify(f.props.card)); await nextTick()
    expect(f.root.querySelector<HTMLTextAreaElement>('.answer textarea')?.value).toBe('Custom Alpha')
    f.button('Next').click(); await nextTick(); f.button('Submit answers').click()
    expect(f.respond).toHaveBeenCalledWith({ answers: { 'First?': 'Custom Alpha', 'Second?': ['Gamma', 'Delta'] }, annotations: { 'Second?': { preview: '<script>literal</script>', notes: 'Native notes' } } })
  } finally { f.close() }
})
it('renders text/number fields and emits general response/follow-up only for extended forms', async () => {
  const f = mount({ title: 'Native form', questions: [{ question: 'Text?', header: 'Text', kind: 'text', placeholder: 'Write here' }, { question: 'Amount?', header: 'Amount', kind: 'number', min: 1, max: 10, step: 1, defaultValue: 4, unit: 'px' }] })
  try {
    await f.input('.answer textarea', 'Text answer'); f.button('Next').click(); await nextTick()
    expect(f.root.querySelector<HTMLInputElement>('input[type=number]')?.value).toBe('4')
    await f.input('input[type=number]', '6'); await f.input('textarea[aria-label="General response"]', 'One more thought')
    f.button('Ask again').click()
    expect(f.respond).toHaveBeenCalledWith({ answers: { 'Text?': 'Text answer', 'Amount?': '6' }, annotations: {}, response: 'One more thought', followUp: true })
  } finally { f.close() }
})
it('preserves unknown-format discoverability and disables navigation while a reply is pending', async () => {
  const f = mount({ questions: [{ question: 'Unknown?', header: 'Future', kind: 'future' }] })
  try {
    expect(f.root.textContent).toContain('Use native interface'); expect(f.button('Submit answers')).toBeUndefined()
    f.button('Cancel').click(); expect(f.pause).toHaveBeenCalledOnce()
    f.props.disabled = true; await nextTick(); expect(f.button('Cancel').disabled).toBe(true)
  } finally { f.close() }
})

it.each(['withheld', 'empty'] as const)('honors native %s preview projection without submitting its original content', async kind => {
  const f = mount({ questions: [{ question: 'First?', header: 'First', options: [option('Alpha', 'Original must not be drawn'), option('Beta')] }] }, {
    previewFormat: 'markdown', extendedQuestions: false, optionalDescriptions: false,
    previews: [{ question: 'First?', option: 'Alpha', kind }],
  })
  try {
    f.root.querySelector<HTMLInputElement>('input[type=radio]')!.click(); await nextTick()
    expect(f.root.textContent).not.toContain('Original must not be drawn')
    expect(!!f.root.querySelector('[data-testid="native-question-preview-withheld"]')).toBe(kind === 'withheld')
    f.button('Submit answers').click()
    expect(f.respond).toHaveBeenCalledWith({ answers: { 'First?': 'Alpha' }, annotations: {} })
  } finally { f.close() }
})

it('adopts pre-input rewrites but freezes the displayed card and token after first input', async () => {
  const questions = (question: string) => ({ questions: [{ question, header: 'First', options: [option('Alpha'), option('Beta')] }] })
  const f = mount(questions('Original?'))
  try {
    f.props.card = questions('Displayed?'); f.props.renderToken = 'displayed-token'; await nextTick()
    expect(f.root.textContent).toContain('Displayed?')
    await f.input('.answer textarea', 'Kept draft')
    f.props.card = questions('Later?'); f.props.renderToken = 'later-token'; await nextTick()
    expect(f.root.textContent).toContain('Displayed?'); expect(f.root.textContent).not.toContain('Later?')
    expect(f.root.querySelector<HTMLTextAreaElement>('.answer textarea')?.value).toBe('Kept draft')
    f.button('Submit answers').click()
    expect(f.started).toHaveBeenCalledExactlyOnceWith('displayed-token')
    expect(f.respond).toHaveBeenCalledWith({ answers: { 'Displayed?': 'Kept draft' }, annotations: {} })
  } finally { f.close() }
})

it('renders a native HTML preview in an opaque scriptless frame and submits the original annotation', async () => {
  const html = '<div style="color:orange"><strong>HTML option</strong><img src="https://preview.invalid/leak" onerror="top.poisoned=true"><a href="https://preview.invalid/nav">Link</a></div>'
  const f = mount({ questions: [{ question: 'HTML?', header: 'HTML', options: [option('Alpha', html), option('Beta')] }] }, {
    previewFormat: 'html', extendedQuestions: false, optionalDescriptions: false,
    previews: [{ question: 'HTML?', option: 'Alpha', kind: 'full', html }],
  })
  try {
    f.root.querySelector<HTMLInputElement>('input[type=radio]')!.click(); await nextTick()
    const frame = f.root.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.srcdoc).toContain('<strong>HTML option</strong>')
    expect(frame.srcdoc).toContain("script-src 'none'")
    expect(frame.srcdoc).not.toMatch(/preview\.invalid|onerror|poisoned/)
    expect(f.root.querySelector('strong')?.textContent).not.toBe('HTML option')
    f.button('Submit answers').click()
    expect(f.respond).toHaveBeenCalledWith({ answers: { 'HTML?': 'Alpha' }, annotations: { 'HTML?': { preview: html } } })
  } finally { f.close() }
})
