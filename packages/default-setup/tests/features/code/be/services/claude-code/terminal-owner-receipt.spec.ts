import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'
function fixture() {
  const start = claudeTerminalUiRuntime.indexOf('let preparedPrompt;')
  const end = claudeTerminalUiRuntime.indexOf('async function prepareTerminalPrompt(')
  const read = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)}; (messages,id='submission') => { preparedPrompt={id:'submission',before:new Set(['existing'])};return promptOutcome({runtime:{ey:()=>({messages:()=>messages})}},id) }`, { originalContext: undefined }) as (messages: unknown[], id?: string) => any
  return read
}
const user = (uuid: string, content: unknown = 'Admitted native text') => ({ uuid, type: 'user', origin: { kind: 'human' }, message: { role: 'user', content } })
it('retains the native UUID, admitted text and origin without an append hook', () => {
  const read = fixture()
  expect(read([user('existing'), user('original-uuid')])).toEqual({ accepted: { uuid: 'original-uuid', door: 'prompt', origin: { kind: 'human' }, message: { type: 'user', content: [{ type: 'text', text: 'Admitted native text' }] } } })
  expect(read([user('original-uuid')], 'stale-submission')).toEqual({})
})
it('never turns metadata, virtual messages or tool results into a human submission receipt', () => {
  const read = fixture()
  expect(read([{ ...user('meta'), isMeta: true }, { ...user('virtual'), isVirtual: true }, user('tool', [{ type: 'tool_result', tool_use_id: 'tool', content: 'result' }])])).toEqual({})
})
it('refuses ambiguous native user rows and preserves an original refusal reason', () => {
  const read = fixture()
  expect(read([user('first'), user('second')])).toEqual({})
  expect(read([user('candidate'), { uuid: 'ending', promptSubmitEnding: { ending: { reason: 'Original native refusal' } } }])).toEqual({ drop: 'Original native refusal' })
})
