import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalWorkflowRuntime } from '#features/code/be/services/claude-code/terminal-workflow-runtime.ts'

function fixture() {
  const stdout = {}, payload = { input: { script: 'original script' } }, item = { payload }, open = [item], calls: unknown[] = [], cache: any[] = []
  let ready = true, revision = 'original'
  cache[26] = payload; cache[27] = 'original script'; cache[28] = false
  cache[24] = { applies: [{ scope: 'original named workflow' }] }
  cache[30] = (value: string, feedback?: string) => { calls.push({ value, feedback, input: payload.input }); open.splice(0); return true }
  cache[63] = [{ value: 'yes', label: 'Yes, run it', feedbackConfig: {} }, { value: 'yes-always', label: 'Remember native workflow' }, { value: 'toggle', label: 'View raw script' }, { value: 'no', label: 'No', feedbackConfig: {} }]
  const fiber = { type: function Gt() {}, memoizedProps: { payload, wouldTakeAnswer: () => ready }, updateQueue: { memoCache: { data: [cache] } } }
  const d = { payload, item, revision, store: { getState: () => ({ open }) } }
  const n = { jsx: { e: (_type: unknown, props: { children: unknown }) => props.children }, staticRender: { $bn: async (tree: unknown) => String(tree) }, themeRoots: { ai: () => new Map([[stdout, { container: { current: fiber } }]]) } }
  const crypto = () => { let data = ''; return { update(value: string) { data += value; return this }, digest() { return data.startsWith('function Gt') ? '6823a3f796c86b23af27d79c7298106e83e975be017609701b37268da846db9b' : createHash('sha256').update(data).digest('hex') } } }
  const api = vm.runInNewContext(claudeTerminalWorkflowRuntime + ';({nativeWorkflowPresentation,answerNativeWorkflow})', { process: { stdout }, composerFunctionHashes: new WeakMap(), createHash: crypto, nativeDialog: () => ({ ...d, revision }), nativeThemeProvider: () => ({ type: 'theme', value: {} }), setTimeout, Promise })
  return { n, d, api, cache, calls, ready(value: boolean) { ready = value }, revision(value: string) { revision = value } }
}
it('invokes only the original offered callback with its current input and feedback', async () => {
  const f = fixture(), shown = (await f.api.nativeWorkflowPresentation(f.n, f.d)).presentation
  expect(shown.choices.map((choice: any) => choice.value)).toEqual(['yes', 'yes-always', 'no'])
  await f.api.answerNativeWorkflow(f.n, f.d, { decision: 'deny', choice: 'no', choiceToken: shown.token, feedback: 'Keep it local' })
  expect(f.calls).toEqual([{ value: 'no', feedback: 'Keep it local', input: { script: 'original script' } }])
})
it.each(['script', 'grant', 'held', 'revision', 'forged'])('rejects an outdated or forged native choice: %s', async change => {
  const f = fixture(), shown = (await f.api.nativeWorkflowPresentation(f.n, f.d)).presentation
  if (change === 'script') f.cache[27] = 'replacement script'
  if (change === 'grant') f.cache[24].applies = [{ scope: 'different native grant' }]
  if (change === 'held') f.ready(false)
  if (change === 'revision') f.revision('replacement')
  await expect(f.api.answerNativeWorkflow(f.n, f.d, { decision: 'allow', choice: 'yes', choiceToken: change === 'forged' ? 'forged' : shown.token })).rejects.toThrow(/expired/)
  expect(f.calls).toEqual([])
})
it('withholds native blocked script and preserves denial without inventing an allow choice', async () => {
  const f = fixture(); f.cache[28] = true; f.cache[63] = [{ value: 'no', label: 'No', feedbackConfig: {} }]
  const shown = (await f.api.nativeWorkflowPresentation(f.n, f.d)).presentation
  expect(shown.script).toBeUndefined(); expect(shown.withheld).toBe(true)
  await expect(f.api.answerNativeWorkflow(f.n, f.d, { decision: 'allow', choice: 'yes', choiceToken: shown.token })).rejects.toThrow('Invalid')
  await f.api.answerNativeWorkflow(f.n, f.d, { decision: 'deny', choice: 'no', choiceToken: shown.token })
  expect(f.calls).toHaveLength(1)
})

it('borrows only the original admitted summary and keeps its script callback authoritative', async () => {
  const f = fixture()
  f.cache[12] = [{ title: 'Review', detail: 'Original phase detail', prompts: ['Inspect the migration notes'] }]
  f.cache[39] = false; f.cache[48] = 'Original native description'
  const shown = (await f.api.nativeWorkflowPresentation(f.n, f.d)).presentation
  expect(shown.summary).toEqual(f.cache[12]); expect(shown.raw).toBe(false); expect(shown.description).toBe('Original native description')
  f.cache[12][0].title = 'Replacement phase'
  expect(shown.summary[0].title).toBe('Review')
  await expect(f.api.answerNativeWorkflow(f.n, f.d, { decision: 'allow', choice: 'yes', choiceToken: shown.token })).rejects.toThrow('expired')
  const fresh = (await f.api.nativeWorkflowPresentation(f.n, f.d)).presentation
  await f.api.answerNativeWorkflow(f.n, f.d, { decision: 'allow', choice: 'yes', choiceToken: fresh.token })
  expect(f.calls).toEqual([{ value: 'yes', feedback: undefined, input: { script: 'original script' } }])
})
it('never leaks withheld summary data and falls back to the raw script for oversized summaries', async () => {
  const f = fixture(); f.cache[12] = [{ title: 'private', prompts: [] }]; f.cache[28] = true
  expect((await f.api.nativeWorkflowPresentation(f.n, f.d)).presentation.summary).toBeUndefined()
  f.cache[28] = false; f.cache[12] = [{ title: 'x'.repeat(200001), prompts: [] }]
  const shown = (await f.api.nativeWorkflowPresentation(f.n, f.d)).presentation
  expect(shown.summary).toBeUndefined(); expect(shown.summaryUnavailable).toBe(true); expect(shown.script).toBe('original script')
})
