import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'
const start = claudeTerminalUiRuntime.indexOf('function questionShownInput(')
const end = claudeTerminalUiRuntime.indexOf('function questionCanonicalAnswer(')
const rewrite = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};questionShownInput`) as (native: unknown, payload: unknown, questions: unknown) => any
const native = { questionTool: { shownCardInput: (input: unknown) => input, inputSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) } } }
function fixture() {
  const question = (text: string, labels: string[]) => ({ question: text, header: text, multiSelect: false, options: labels.map(label => ({ label, description: label, preview: label + ' preview' })) })
  const input = { questions: [question('First?', ['Alpha', 'Beta']), question('Second?', ['Gamma', 'Delta'])], metadata: { source: 'fixture' } }
  return { input, drawn: structuredClone(input.questions) }
}
it('admits question/header/description relabeling while preserving original card metadata', () => {
  const { input, drawn } = fixture()
  drawn[0].question = 'First display?'; drawn[0].header = 'Display'; drawn[0].options[0].description = 'Display description'
  expect(rewrite(native, { input }, drawn)).toMatchObject({ questions: drawn, metadata: input.metadata })
})
it.each(['count', 'multi', 'labels', 'order', 'preview', 'original collision'])('keeps original card when a hook changes %s', change => {
  const { input, drawn } = fixture()
  if (change === 'count') drawn.pop()
  if (change === 'multi') drawn[0].multiSelect = true
  if (change === 'labels') drawn[0].options[0].label = 'Injected'
  if (change === 'order') drawn[0].options.reverse()
  if (change === 'preview') drawn[0].options[0].preview = 'Different preview'
  if (change === 'original collision') { drawn[0].question = 'Second?'; drawn[1].question = 'Other display?' }
  expect(rewrite(native, { input }, drawn)).toEqual(input)
})
it('retains original card when the original tool schema refuses a rewritten value', () => {
  const { input } = fixture()
  const refusing = { questionTool: { ...native.questionTool, inputSchema: { safeParse: () => ({ success: false }) } } }
  expect(rewrite(refusing, { input }, [])).toEqual(input)
})

it('uses the latest staged answers only for the original unanswered timeout and retires the store wrapper', () => {
  const start = claudeTerminalUiRuntime.indexOf('const nativeQuestionPartials=')
  const end = claudeTerminalUiRuntime.indexOf('// Pinned AskUserQuestion clarification builder', start)
  const frame = { token: 'token', shownInput: { questions: [] }, client: 'active' }
  const stage = vm.runInNewContext(claudeTerminalUiRuntime.slice(start, end) + ';stageNativeQuestionPartial', {
    questionCanonicalAnswer: (_native: unknown, _dialog: unknown, {answer}: {answer: unknown}) => ({kind: 'admitted', input: answer}),
    frozenQuestionFrames: new Map([['active', frame]]), clients: new Set(['active']),
    clientViewKey: () => 'view', clientViews: new Map([['active', 'view']]),
  })
  const item = { id: 'question' }, originalAnswer = vi.fn(), unsubscribe = vi.fn()
  const store = { answer: originalAnswer, subscribe: vi.fn(() => unsubscribe), getState: () => ({ open: [item] }) }
  const dialog = { item, store }
  stage({}, dialog, frame, { sequence: 2, answer: { answers: { First: 'Operators' } } })
  stage({}, dialog, frame, { sequence: 1, answer: { answers: { First: 'Developers' } } })
  const manual = { behavior: 'allow', updatedInput: { answers: { First: 'Manual' } } }
  store.answer(item.id, manual)
  expect(originalAnswer).toHaveBeenLastCalledWith(item.id, manual)
  expect(store.answer).toBe(originalAnswer)
  expect(unsubscribe).toHaveBeenCalledOnce()

  const draft = stage({}, dialog, frame, { sequence: 3, answer: { answers: { First: 'Operators' } } })
  const contentBlocks = [{type: 'image', source: {type: 'base64', data: 'cG5n', media_type: 'image/png'}}]
  draft.contentBlocks = contentBlocks
  const timeout = { behavior: 'allow', updatedInput: { answers: {}, afkTimeoutMs: 60000 } }
  store.answer(item.id, timeout)
  expect(originalAnswer).toHaveBeenLastCalledWith(item.id, { behavior: 'allow',
    updatedInput: { answers: { First: 'Operators' }, annotations: {}, afkTimeoutMs: 60000 }, contentBlocks })
  expect(timeout.updatedInput.answers).toEqual({})
  expect(store.answer).toBe(originalAnswer)
})
