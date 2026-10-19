import { claudeAssistantDisplayText } from '#features/code/common/claude-message-display.ts'
import { selectClaudeTranscriptRows } from '#features/code/be/services/claude-code/ui-transcript-rows.ts'
const row = (uuid: string, start = 0, text = 'Native text', apiMessageId = 'provider') => ({ uuid, sessionId: 'session', apiMessageId, text, start, end: start + text.length })
const message = (id: string, rows: ReturnType<typeof row>[], text = rows.map(value => value.text).join('\n')) => ({ id, sender: 'assistant', text, context: { claudeNativeMessages: rows } })
it('derives reply opening from all persisted native rows, including rows outside the mounted selection', () => {
  const messages = [message('app-a', [row('native-a')]), message('app-b', [row('native-b')]), message('app-c', [row('native-c', 0, 'Next', 'next-provider')])]
  expect(selectClaudeTranscriptRows(messages, 'session', new Set(['app-b', 'app-c']))).toEqual([
    { component: 'AssistantMessage', messageId: 'app-b', uuid: 'native-b', sessionId: 'session', text: 'Native text', start: 0, end: 11, isFirstOfReply: false },
    { component: 'AssistantMessage', messageId: 'app-c', uuid: 'native-c', sessionId: 'session', text: 'Next', start: 0, end: 4, isFirstOfReply: true },
  ])
})
it('rejects foreign sessions, stale text, overlaps, forged types and missing membership', () => {
  const valid = message('app', [row('a'), row('b', 12)], 'Native text\nNative text')
  expect(selectClaudeTranscriptRows([valid], 'session', new Set(['other']))).toEqual([])
  expect(selectClaudeTranscriptRows([valid], 'foreign', new Set(['app']))).toEqual([])
  expect(selectClaudeTranscriptRows([{ ...valid, text: 'Edited transcript' }], 'session', new Set(['app']))).toEqual([])
  expect(selectClaudeTranscriptRows([message('app', [row('a'), row('b')], 'Native text')], 'session', new Set(['app']))).toHaveLength(1)
  expect(selectClaudeTranscriptRows([{ id: 'app', sender: 'assistant', text: 'Native text', context: { claudeNativeMessages: [null, { ...row('a'), start: '0' }] } }], 'session', new Set(['app']))).toEqual([])
})
it('rejects duplicate UUIDs across persisted messages rather than sharing native callback identity', () => {
  expect(selectClaudeTranscriptRows([message('app-a', [row('same')]), message('app-b', [row('same')])], 'session', new Set(['app-a', 'app-b']))).toEqual([])
})
it('keeps stored source intact while matching native context and memory-tag display filtering', () => {
  const source = '\n<context>Hidden\ncontext</context>\n<commit_analysis>Private</commit_analysis>\n<cc-memory filenames="a.md">Remembered text</cc-memory>\nVisible <contextual>literal</contextual>'
  expect(claudeAssistantDisplayText(source)).toBe('Remembered text\nVisible <contextual>literal</contextual>')
  expect(source).toContain('Hidden')
  expect(claudeAssistantDisplayText('<CC_MEMORY>Text</CC_MEMORY>')).toBe('Text')
  expect(claudeAssistantDisplayText('<cc-memory-other>Literal</cc-memory-other>')).toBe('<cc-memory-other>Literal</cc-memory-other>')
})


it('uses only accepted user provenance and the owning view expansion state', () => {
  const user = { id: 'app-user', sender: 'user', text: 'Typed prompt', context: { cliUuid: 'native-user', claudeNativeUserMessage: { uuid: 'native-user', sessionId: 'session', text: 'Typed prompt', origin: { kind: 'unclassified' } } } }
  expect(selectClaudeTranscriptRows([user], 'session', new Set(['app-user']), new Map([['app-user', false]]))).toEqual([
    { component: 'UserMessage', messageId: 'app-user', uuid: 'native-user', sessionId: 'session', text: 'Typed prompt', start: 0, end: 12, origin: { kind: 'unclassified' }, isExpanded: false },
  ])
  expect(selectClaudeTranscriptRows([user], 'session', new Set(['app-user']))[0]).toMatchObject({ isExpanded: true })
  expect(selectClaudeTranscriptRows([user], 'other-session', new Set(['app-user']))).toEqual([])
  expect(selectClaudeTranscriptRows([{ ...user, status: 'queued' }], 'session', new Set(['app-user']))).toEqual([])
  expect(selectClaudeTranscriptRows([{ ...user, text: 'Edited prompt' }], 'session', new Set(['app-user']))).toEqual([])
  expect(selectClaudeTranscriptRows([{ ...user, context: { ...user.context, claudeNativeUserMessage: { ...user.context.claudeNativeUserMessage, origin: { kind: 'composer' } } } }], 'session', new Set(['app-user']))).toEqual([])
})

it('selects only open, classified narration from exact persisted thinking ranges', () => {
  const summary = { ...row('summary', 0, '  Narration  '), isSummary: true }
  const raw = row('raw', 15, 'Raw thought')
  const blocks = [{ type: 'tool-activity', props: {} }, { type: 'thinking', props: { content: '  Narration  \n\nRaw thought', nativeMessages: [summary, raw] } }]
  const source = { ...message('app', [row('text')]), blocks }
  const open = new Map([['app', new Set([1])]])
  expect(selectClaudeTranscriptRows([source], 'session', new Set(['app']))).toHaveLength(1)
  expect(selectClaudeTranscriptRows([source], 'session', new Set(['app']), new Map(), open)).toEqual([
    { component: 'AssistantMessage', isSummary: true, blockIndex: 1, isFirstOfReply: true, messageId: 'app', uuid: 'summary', sessionId: 'session', text: '  Narration  ', start: 0, end: 13 },
    expect.objectContaining({ uuid: 'text' }),
  ])
  expect(selectClaudeTranscriptRows([source], 'foreign', new Set(['app']), new Map(), open)).toEqual([])
  blocks[1].props = { content: 'Edited thinking', nativeMessages: [summary, raw] }
  expect(selectClaudeTranscriptRows([source], 'session', new Set(['app']), new Map(), open)).toHaveLength(1)
})
it('rejects duplicate native identity even when the other thinking block is closed', () => {
  const source = { ...message('app', [row('same')]), blocks: [{ type: 'thinking', props: { content: 'Summary', nativeMessages: [{ ...row('same', 0, 'Summary'), isSummary: true }] } }] }
  expect(selectClaudeTranscriptRows([source], 'session', new Set(['app']))).toEqual([])
})

it('accepts composer provenance only with a matching native human journal identity', () => {
  const user = { id: 'app-user', sender: 'user', text: 'Native prompt', context: { cliUuid: 'native-user', claudeTerminalMessage: { uuid: 'native-user', sessionId: 'session', origin: { kind: 'human' } }, claudeNativeUserMessage: { uuid: 'native-user', sessionId: 'session', text: 'Native prompt', origin: { kind: 'composer' } } } }
  expect(selectClaudeTranscriptRows([user], 'session', new Set(['app-user']))[0]).toMatchObject({ component: 'UserMessage', origin: { kind: 'composer' } })
  expect(selectClaudeTranscriptRows([{ ...user, context: { ...user.context, claudeTerminalMessage: { ...user.context.claudeTerminalMessage, uuid: 'foreign' } } }], 'session', new Set(['app-user']))).toEqual([])
})

it('binds command output to exact native history identity and rejects stale or duplicate sources', () => {
  const command = { id: 'app-command', sender: 'assistant', text: 'Result', context: { cliUuid: 'native-command', claudeTerminalMessage: { uuid: 'native-command', sessionId: 'session' }, claudeNativeCommand: { kind: 'output', text: 'Result', stream: 'stderr' } } }
  const selected = new Set(['app-command'])
  expect(selectClaudeTranscriptRows([command], 'session', selected)).toEqual([{ component: 'CommandOutput', messageId: 'app-command', uuid: 'native-command', sessionId: 'session', text: 'Result', start: 0, end: 6, isErrored: true }])
  expect(selectClaudeTranscriptRows([command], 'foreign', selected)).toEqual([])
  expect(selectClaudeTranscriptRows([command], 'session', new Set())).toEqual([])
  expect(selectClaudeTranscriptRows([{ ...command, text: 'Changed' }], 'session', selected)).toEqual([])
  expect(selectClaudeTranscriptRows([{ ...command, context: { ...command.context, cliUuid: 'foreign' } }], 'session', selected)).toEqual([])
  expect(selectClaudeTranscriptRows([command, { ...command, id: 'unmounted' }], 'session', selected)).toEqual([])
})

it('renders result hooks only for expanded native tool rows with exact session/result provenance', () => {
  const entry = { id: 'tool-id', tool: 'Read', status: 'ok', details: { output: 'Original text' }, nativeResult: { uuid: '11111111-1111-1111-1111-111111111111', sessionId: 'session' } }
  const source = { id: 'app-tool', sender: 'assistant', text: '', context: { cliUuid: '22222222-2222-2222-2222-222222222222', claudeTerminalMessage: { uuid: '22222222-2222-2222-2222-222222222222', sessionId: 'session' } }, blocks: [{ type: 'tool-activity', props: { entries: [entry] } }] }
  const selected = new Set(['app-tool']), open = new Map([['app-tool', new Set([0])]])
  expect(selectClaudeTranscriptRows([source], 'session', selected)).toEqual([])
  expect(selectClaudeTranscriptRows([source], 'session', selected, new Map(), open)).toEqual([expect.objectContaining({ component: 'ToolUse', uuid: 'tool-id', assistantUuid: source.context.cliUuid }), expect.objectContaining({component:'ToolProgress',uuid:'tool-id'}), expect.objectContaining({ component: 'ToolResult', uuid: 'tool-id', resultUuid: entry.nativeResult.uuid, blockIndex: 0, text: 'Original text' })])
  expect(selectClaudeTranscriptRows([source], 'foreign', selected, new Map(), open)).toEqual([])
  expect(selectClaudeTranscriptRows([source, { ...source, id: 'duplicate' }], 'session', selected, new Map(), open)).toEqual([])
  entry.nativeResult.sessionId = 'foreign'
  expect(selectClaudeTranscriptRows([source], 'session', selected, new Map(), open).map(row => row.component)).toEqual(['ToolUse','ToolProgress'])
})

it('mounts a pending ToolUse without fabricating a result or trusting app running flags', () => {
 const source={id:'pending',sender:'assistant',text:'',context:{cliUuid:'22222222-2222-2222-2222-222222222222',claudeTerminalMessage:{uuid:'22222222-2222-2222-2222-222222222222',sessionId:'session'}},blocks:[{type:'tool-activity',props:{entries:[{id:'pending-tool',tool:'Write',status:'running',summary:'file.txt'}]}}]}
 expect(selectClaudeTranscriptRows([source],'session',new Set(['pending']),new Map(),new Map([['pending',new Set([0])]]))).toEqual([expect.objectContaining({component:'ToolUse',uuid:'pending-tool',activityStatus:'running',text:'file.txt'}),expect.objectContaining({component:'ToolProgress',uuid:'pending-tool'})])
})
