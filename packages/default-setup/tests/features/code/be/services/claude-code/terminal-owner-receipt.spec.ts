import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'
function fixture() {
  const start = claudeTerminalUiRuntime.indexOf('let preparedPrompt;')
  const end = claudeTerminalUiRuntime.indexOf('async function prepareTerminalPrompt(')
  const read = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)}; (messages,id='submission',text='Admitted native text') => { preparedPrompt={id:'submission',text,before:new Set(['existing'])};return promptOutcome({commandInput:{IS:value=>{const match=/^\\/([^ ]+)/.exec(value);return match?{commandName:match[1]}:null;}},runtime:{ey:()=>({messages:()=>messages})}},id) }`, { originalContext: undefined, nativeInterruptionModule: async () => ({ Sh: (row: { uuid: string }) => row.uuid === 'marker' }) }) as (messages: unknown[], id?: string, text?: string) => Promise<any>
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

const warning = (content:string,uuid='native-warning') => ({uuid,type:'system',subtype:'informational',isMeta:false,level:'warning',content})
it('returns the new original unknown-command warning without inventing a human receipt',async()=>{
 const read=fixture(),text='/missing-review arg',reason='Unknown command: /missing-review. Did you mean /review?'
 expect(await read([warning(reason)],'submission',text)).toEqual({drop:reason})
 expect(await read([warning('Unknown command: /'+'x'.repeat(200)+'…')],'submission','/'+'x'.repeat(201))).toEqual({drop:'Unknown command: /'+'x'.repeat(200)+'…'})
 expect(await read([warning(reason),user('accepted')],'submission',text)).toMatchObject({accepted:{uuid:'accepted'}})
})
it('refuses stale, ambiguous, unrelated or path-like warnings as command outcomes',async()=>{
 const read=fixture(),text='/missing-review'
 for(const rows of [[warning('Unknown command: /missing-review','existing')],[warning('Unknown command: /missing-review-longer')],[warning('Other warning')],[{...warning('Unknown command: /missing-review'),level:'error'}],[{...warning('Unknown command: /missing-review'),subtype:'other'}],[warning('Unknown command: /missing-review','first'),warning('Unknown command: /missing-review','second')]])expect(await read(rows,'submission',text)).toEqual({})
 expect(await read([warning('Unknown command: /tmp/file')],'submission','/tmp/file')).toEqual({})
 expect(await read([warning('Unknown command: /missing-review')],'stale-submission',text)).toEqual({})
})
it('reports refusal and queue outcomes on a pending heartbeat and only acknowledges acceptance when requested', async () => {
  const start = claudeTerminalUiRuntime.indexOf('async function reportPendingPromptOutcome(')
  const end = claudeTerminalUiRuntime.indexOf('const ownerTimer=', start)
  const reason = 'Unknown command: /missing'
  type Outcome = { drop?: string; queued?: string; accepted?: { uuid: string } }
  const control = vi.fn(async (): Promise<Outcome> => ({ drop: reason }))
  const post = vi.fn(async (_path: string, _body: unknown) => ({}))
  const pid = 123
  const report = vm.runInNewContext(
    claudeTerminalUiRuntime.slice(start, end) + ';reportPendingPromptOutcome',
    { control, ownerPost: post, AbortController, process: { pid } },
  ) as (id?: string, includeAccepted?: boolean) => Promise<void>

  await report(undefined)
  expect(control).not.toHaveBeenCalled()
  await report('refused')
  expect(control).toHaveBeenCalledExactlyOnceWith(
    { subtype: 'apack_prompt_outcome', submission_id: 'refused' },
    expect.any(AbortController),
  )
  expect(post).toHaveBeenCalledExactlyOnceWith('/submission', { id: 'refused', drop: reason })

  control.mockResolvedValueOnce({ queued: 'waiting-in-claude' })
  await report('queued')
  expect(post).toHaveBeenLastCalledWith('/submission', { id: 'queued', queued: 'waiting-in-claude', pid })

  const accepted = { uuid: 'original' }
  control.mockResolvedValue({ accepted })
  await report('ordinary')
  expect(post).toHaveBeenCalledTimes(2)

  await report('confirmed', true)
  expect(post.mock.calls).toEqual([
    ['/submission', { id: 'refused', drop: reason }],
    ['/submission', { id: 'queued', queued: 'waiting-in-claude', pid }],
    ['/append', { ...accepted, submissionId: 'confirmed' }],
    ['/submission', { id: 'confirmed', accepted: true }],
  ])
})
