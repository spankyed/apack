import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'
function fixture() {
  const start = claudeTerminalUiRuntime.indexOf('let preparedPrompt;')
  const end = claudeTerminalUiRuntime.indexOf('async function prepareTerminalPrompt(')
  const read = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)}; (messages,id='submission') => { preparedPrompt={id:'submission',before:new Set(['existing'])};return promptOutcome({runtime:{ey:()=>({messages:()=>messages})}},id) }`, { originalContext: undefined, nativeInterruptionModule: async () => ({ Sh: (row: { uuid: string }) => row.uuid === 'marker' }) }) as (messages: unknown[], id?: string) => Promise<any>
  return read
}
const user = (uuid: string, content: unknown = 'Admitted native text') => ({ uuid, type: 'user', origin: { kind: 'human' }, message: { role: 'user', content } })
it('retains the native UUID, admitted text and origin without an append hook', async () => {
  const read = fixture()
  expect(await read([user('existing'), user('original-uuid')])).toEqual({ accepted: { uuid: 'original-uuid', door: 'prompt', origin: { kind: 'human' }, message: { type: 'user', content: [{ type: 'text', text: 'Admitted native text' }] } } })
  expect(await read([user('original-uuid')], 'stale-submission')).toEqual({})
})
it('never turns metadata, virtual messages or tool results into a human submission receipt', async () => {
  const read = fixture()
  expect(await read([{ ...user('meta'), isMeta: true }, { ...user('virtual'), isVirtual: true }, user('tool', [{ type: 'tool_result', tool_use_id: 'tool', content: 'result' }])])).toEqual({})
})
it('refuses ambiguous native user rows and preserves an original refusal reason', async () => {
  const read = fixture()
  expect(await read([user('first'), user('second')])).toEqual({})
  expect(await read([user('candidate'), { uuid: 'ending', promptSubmitEnding: { ending: { reason: 'Original native refusal' } } }])).toEqual({ drop: 'Original native refusal' })
})

it('does not acknowledge a native interruption marker as a submitted person prompt',async()=>{const read=fixture(),marker={...user('marker',[{type:'text',text:'[Request interrupted by user for tool use]'}]),origin:undefined};expect(await read([marker])).toEqual({});expect(await read([marker,user('fresh')])).toMatchObject({accepted:{uuid:'fresh'}})})
