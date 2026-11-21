import { projectClaudeTerminalHistory } from '#features/threads/be/claude-terminal-history.ts'
const sessionId = '11111111-1111-1111-1111-111111111111', uuid = '22222222-2222-2222-2222-222222222222'
const row = { sessionId, uuid, type: 'assistant', message: { id: 'api', role: 'assistant', content: [{ type: 'text', text: ' Actual native text ' }] } }
it('retains exact native text and groups display rows by the real API identity', () => {
  const value = projectClaudeTerminalHistory({ sessionId, row })!
  expect(value.text).toBe(' Actual native text ')
  expect(value.context.claudeNativeMessages).toEqual([{ sessionId, uuid, apiMessageId: 'api', text: value.text, start: 0, end: value.text.length }])
  const summary = projectClaudeTerminalHistory({ sessionId, row: { ...row, isSummary: true } })!
  expect(summary.text).toBe(''); expect(summary.blocks[0]?.type).toBe('thinking')
  expect(summary.blocks[0]?.props.nativeMessages[0]).toMatchObject({ uuid, sessionId, isSummary: true })
})
it('excludes child, metadata and tool-result rows from the visible user history', () => {
  for (const extra of [{ isSidechain: true }, { agentId: 'child' }, { isMeta: true }, { parent_tool_use_id: 'tool' }, { type: 'user', origin: { kind: 'task-notification' } }]) expect(projectClaudeTerminalHistory({ sessionId, row: { ...row, ...extra } })).toBeUndefined()
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...row, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool', content: 'Result' }] } } })).toBeUndefined()
})
it('preserves native image bytes as image references without treating non-image media as URLs', () => {
  const value = projectClaudeTerminalHistory({ sessionId, row: { ...row, type: 'user', message: { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } }] } } })!
  expect(value.references?.images).toEqual([{ name: 'Native image', url: 'data:image/png;base64,YWJj' }])
})

it('uses native human provenance for composer rows and never guesses it for unstamped SDK rows', () => {
  const human = projectClaudeTerminalHistory({ sessionId, row: { ...row, type: 'user', origin: { kind: 'human' } } })!
  expect(human.context.claudeNativeUserMessage).toMatchObject({ origin: { kind: 'composer' } })
  const unstamped = projectClaudeTerminalHistory({ sessionId, row: { ...row, type: 'user' } })!
  expect(unstamped.context.claudeNativeUserMessage).toMatchObject({ origin: { kind: 'unclassified' } })
})

it('retains structured plan-reset continuations without calling them human composer inputs', () => {
  const continuation = { ...row, type: 'user', origin: { kind: 'auto-continuation' }, planContent: '# Approved plan', queueSkipAttachments: true, message: { role: 'user', content: 'Implement the following plan:\n\n# Approved plan' } }
  const projected = projectClaudeTerminalHistory({ sessionId, row: continuation })!
  expect(projected.text).toBe(continuation.message.content)
  expect(projected.context).toMatchObject({ cliUuid: uuid, claudePlanContinuation: true, claudeTerminalMessage: { origin: continuation.origin } })
  expect(projected.context.claudeNativeUserMessage).toBeUndefined()
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...continuation, planContent: undefined } })).toBeUndefined()
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...continuation, isMeta: true } })).toBeUndefined()
})


it('shows original command envelopes as commands/results without claiming human or assistant model provenance', () => {
  const command = { ...row, type: 'user', entrypoint: 'cli', message: { content: '<command-name>/compact</command-name>\n  <command-message>compact</command-message>\n  <command-args>Keep &lt;api&gt; &amp; tests</command-args>' } }
  const invocation = projectClaudeTerminalHistory({ sessionId, row: command })!
  expect(invocation).toMatchObject({ uuid, sessionId, sender: 'user', text: '/compact Keep <api> & tests' })
  expect(invocation.context.claudeNativeCommand).toMatchObject({ kind: 'invocation', name: '/compact' })
  expect(invocation.context.claudeNativeUserMessage).toBeUndefined()
  for (const stream of ['stdout', 'stderr']) {
    const output = projectClaudeTerminalHistory({ sessionId, row: { ...command, message: { content: `<local-command-${stream}>\u001b[2mDone &amp; &lt;ready&gt;\u001b[22m</local-command-${stream}>` } } })!
    expect(output).toMatchObject({ uuid, sessionId, sender: 'assistant', text: 'Done & <ready>' })
    expect(output.context.claudeNativeCommand).toMatchObject({ kind: 'output', stream })
    expect(output.context.claudeNativeUserMessage).toBeUndefined(); expect(output.context.claudeNativeMessages).toBeUndefined()
  }
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...command, message: { content: '<local-command-stdout> </local-command-stdout>' } } })).toBeUndefined()
})
it('keeps quoted, malformed, mixed-media and genuinely human command-like markup literal', () => {
  for (const text of ['Explain <local-command-stdout>text</local-command-stdout>', '<local-command-stdout>missing end', '<local-command-stdout>text</local-command-stderr>', '<command-name>/compact</command-name>']) {
    expect(projectClaudeTerminalHistory({ sessionId, row: { ...row, type: 'user', entrypoint: 'cli', message: { content: text } } })?.text).toBe(text)
  }
  const text = '<local-command-stdout>&amp;lt; literal</local-command-stdout>'
  const base = { ...row, type: 'user', entrypoint: 'cli', message: { content: text } }
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...base, origin: { kind: 'human' } } })?.text).toBe(text)
  expect(projectClaudeTerminalHistory({ sessionId, row: base })?.text).toBe('&lt; literal')
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...base, message: { content: [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } }] } } })?.text).toBe(text)
})

it('projects native system command journal rows without turning other system output into chat', () => {
  const base = { ...row, type: 'system', subtype: 'local_command', entrypoint: 'cli', message: undefined }
  const invocation = projectClaudeTerminalHistory({ sessionId, row: { ...base, content: '<command-name>/config</command-name>\n<command-message>config</command-message>\n<command-args>researchUnknownSetting=true</command-args>' } })!
  expect(invocation).toMatchObject({ uuid, sessionId, sender: 'user', text: '/config researchUnknownSetting=true' })
  expect(invocation.context.claudeNativeUserMessage).toBeUndefined()
  const content = "<local-command-stdout>researchUnknownSetting isn't a /config setting.</local-command-stdout>"
  const output = projectClaudeTerminalHistory({ sessionId, row: { ...base, content } })!
  expect(output).toMatchObject({ uuid, sessionId, sender: 'assistant', text: "researchUnknownSetting isn't a /config setting." })
  expect(output.context.claudeNativeCommand).toMatchObject({ kind: 'output', stream: 'stdout' })
  expect(output.context.claudeNativeMessages).toBeUndefined()
  for (const invalid of [{ ...base, subtype: 'other', content }, { ...base, origin: { kind: 'human' }, content }, { ...base, content: 'Unclassified system detail' }]) {
    expect(projectClaudeTerminalHistory({ sessionId, row: invalid })).toBeUndefined()
  }
})

it('projects only source-stamped inbound channels as inert transcript messages', () => {
  const server = 'plugin:fakechat:fakechat'
  const body = 'Review <b>literal markup</b>\nLonger second line'
  const packet = `<channel source="${server}" user="web">\n${body}\n</channel>`
  const channel = { ...row, type: 'user', entrypoint: 'cli', isMeta: true, origin: { kind: 'channel', server },
    message: { content: packet } }
  const values = [
    channel,
    { ...channel, message: { content: [{ type: 'text', text: `A message arrived from ${server} while you were working:\n${packet}\n\nModel-only suffix` }] } },
  ]
  for (const value of values) {
    const projected = projectClaudeTerminalHistory({ sessionId, row: value })!
    expect(projected).toMatchObject({ uuid, sessionId, text: body, sender: 'system', blocks: [],
      context: { cliUuid: uuid, claudeTerminalMessage: { uuid, sessionId }, claudeNativeChannel: { server } } })
    expect(projected.context.claudeNativeUserMessage).toBeUndefined()
  }
  for (const changes of [
    { sessionId: 'foreign' }, { entrypoint: 'sdk' }, { agentId: 'child' }, { isSidechain: true },
    { isVirtual: true }, { origin: undefined }, { origin: { kind: 'channel', server: 'different' } },
    { message: { content: packet.replace('</channel>', '') } },
    { message: { content: [{ type: 'text', text: packet }, { type: 'tool_result' }] } },
  ]) expect(projectClaudeTerminalHistory({ sessionId, row: { ...channel, ...changes } })).toBeUndefined()
  const human = { ...channel, isMeta: false, origin: { kind: 'human' } }
  expect(projectClaudeTerminalHistory({ sessionId, row: human })).toMatchObject({ sender: 'user', text: packet })
})

it('projects original informational notice rows as inert system text with native identity', () => {
  const notice = { sessionId, uuid, type: 'system', subtype: 'informational', level: 'notice', entrypoint: 'cli',
    content: 'native-plugin: <b>literal review</b>', timestamp: '2026-10-25T02:13:07.922Z' }
  const value = projectClaudeTerminalHistory({ sessionId, row: notice })!
  expect(value).toMatchObject({ uuid, sessionId, sender: 'system', text: notice.content, blocks: [],
    timestamp: Date.parse(notice.timestamp), context: { cliUuid: uuid, claudeTerminalMessage: { uuid, sessionId } } })
  expect(value.context.claudeNativeUserMessage).toBeUndefined()
  expect(value.context.claudeNativeMessages).toBeUndefined()
  for (const changes of [{sessionId:'foreign'}, {entrypoint:'sdk'}, {isSidechain:true}, {agentId:'worker'},
    {parent_tool_use_id:'parent'}, {isMeta:true}, {uuid:'invalid'}, {content:''}]) {
    expect(projectClaudeTerminalHistory({sessionId,row:{...notice,...changes}})).toBeUndefined()
  }
  expect(projectClaudeTerminalHistory({sessionId,row:{...notice,level:'debug'}})).toBeUndefined()
})

it('shows only the native unknown MCP outcome as a system notice', () => {
  const summary = 'MCP task owned-review-1 (research/review) expired on the server: outcome unknown.'
  const notification = { ...row, type: 'user', entrypoint: 'cli', promptSource: 'system', turnOrigin: 'task_notification',
    origin: { kind: 'task-notification', producer: 'session-task', taskKind: 'mcp-task' },
    message: { content: `<task-notification>\n<task-id>owner1</task-id>\n<status>stopped</status>\n<summary>${summary}</summary>\n<result>\nTask outcome unknown: extra model instructions and raw server text.\n</result>\n</task-notification>` } }
  expect(projectClaudeTerminalHistory({sessionId,row:notification})).toMatchObject({sender:'system',text:summary,blocks:[],
    context:{cliUuid:uuid,claudeTerminalMessage:{uuid,sessionId}}})
  for(const changes of [
    { sessionId:'foreign' }, { isSidechain:true }, { isMeta:true }, { promptSource:'user' },
    { origin:{...notification.origin,taskKind:'local-agent'} },
    { message:{content:notification.message.content.replace('<status>stopped','<status>completed')} },
  ]) expect(projectClaudeTerminalHistory({sessionId,row:{...notification,...changes}})).toBeUndefined()
  const human = { ...notification, origin: { kind: 'human' }, promptSource: 'user' }
  expect(projectClaudeTerminalHistory({sessionId,row:human})).toMatchObject({sender:'user',text:notification.message.content})
})

it('shows the native MCP completion summary without showing its result payload', () => {
  const summary = 'MCP task owned-review-1 (local-review/review) completed.'
  const content = `<task-notification>\n<task-id>owner1</task-id>\n<status>completed</status>\n<summary>${summary}</summary>\n<result>\nRaw server result and model context\n</result>\n</task-notification>`
  const notification = { ...row, type: 'user', entrypoint: 'cli', promptSource: 'system', turnOrigin: 'task_notification',
    origin: { kind: 'task-notification', producer: 'session-task', taskKind: 'mcp-task' }, message: { content } }
  expect(projectClaudeTerminalHistory({ sessionId, row: notification })).toMatchObject({
    sender: 'system', text: summary, blocks: [], context: { cliUuid: uuid, claudeTerminalMessage: { uuid, sessionId } },
  })
  for (const changes of [
    { promptSource: 'user' }, { origin: { ...notification.origin, taskKind: 'local-agent' } },
    { message: { content: content.replace(' completed.', ': outcome unknown.') } },
    { message: { content: content.replace('<status>completed', '<status>stopped') } },
  ]) expect(projectClaudeTerminalHistory({ sessionId, row: { ...notification, ...changes } })).toBeUndefined()
})

it.each([
  ['failed', 'Task failed: private server failure detail'],
  ['cancelled', 'Task cancelled: private server cancellation detail'],
  ['cancelled', 'Task was cancelled by the server.'],
])('shows the native %s MCP summary as a system row', (status, result) => {
  const summary = `MCP task owned-review-1 (research/review) ${status}.`
  const content = `<task-notification>\n<task-id>owner1</task-id>\n<status>${status}</status>\n<summary>${summary}</summary>\n<result>\n${result}\n</result>\n</task-notification>`
  const notification = { ...row, type: 'user', entrypoint: 'cli', promptSource: 'system', turnOrigin: 'task_notification',
    origin: { kind: 'task-notification', producer: 'session-task', taskKind: 'mcp-task' }, message: { content } }
  expect(projectClaudeTerminalHistory({ sessionId, row: notification })).toMatchObject({
    sender: 'system', text: summary, blocks: [], context: { cliUuid: uuid, claudeTerminalMessage: { uuid, sessionId } },
  })
  const mismatchedResult = { ...notification, message: { content: content.replace(result, 'Raw task output') } }
  expect(projectClaudeTerminalHistory({ sessionId, row: mismatchedResult })).toBeUndefined()
})

it('omits native empty-command stdout while preserving literal user text and stderr', () => {
  const stdout = '<local-command-stdout>\u001b[2m(no content)\u001b[22m</local-command-stdout>'
  const command = { ...row, type: 'user', entrypoint: 'cli', message: { content: stdout } }
  expect(projectClaudeTerminalHistory({ sessionId, row: command })).toBeUndefined()
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...command, type: 'system', subtype: 'local_command', content: stdout, message: undefined } })).toBeUndefined()
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...command, origin: { kind: 'human' } } })?.text).toBe(stdout)
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...command, message: { content: '(no content)' } } })?.text).toBe('(no content)')
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...command, message: { content: '<local-command-stderr>(no content)</local-command-stderr>' } } })?.text).toBe('(no content)')
})
it('does not project native interruption envelopes as user bubbles but preserves literal human input',()=>{
 const entry={sessionId:'session',row:{sessionId:'session',type:'user',uuid:'11111111-1111-4111-8111-111111111111',message:{content:[{type:'text',text:'[Request interrupted by user for tool use]'}]}}}
 expect(projectClaudeTerminalHistory(entry)).toMatchObject({sender:'system',uuid:entry.row.uuid,text:'[Request interrupted by user for tool use]',context:{cliUuid:entry.row.uuid,claudeNativeInterruption:{sessionId:'session',uuid:entry.row.uuid}}})
 expect(projectClaudeTerminalHistory({...entry,sessionId:'foreign'})).toBeUndefined()
 expect(projectClaudeTerminalHistory({...entry,row:{...entry.row,isSidechain:true}})).toBeUndefined()
 expect(projectClaudeTerminalHistory({...entry,row:{...entry.row,agentId:'child'}})).toBeUndefined()
 expect(projectClaudeTerminalHistory({...entry,row:{...entry.row,origin:{kind:'human'}}})?.sender).toBe('user')
 expect(projectClaudeTerminalHistory({...entry,row:{...entry.row,message:{content:'[Request interrupted by user for tool use]'}}})?.sender).toBe('user')
})

it('projects original main-session compaction as journal-addressed system history', () => {
  const boundary = { sessionId, uuid, type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' }
  const summary = { sessionId, uuid, type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true,
    message: { content: [{ type: 'text', text: '  Recovered context  ' }] } }
  expect(projectClaudeTerminalHistory({ sessionId, row: boundary })).toMatchObject({
    uuid, sender: 'system', text: 'Conversation compacted',
    context: { cliUuid: uuid, claudeNativeCompaction: 'boundary', claudeTerminalMessage: { uuid, sessionId } },
  })
  const projected = projectClaudeTerminalHistory({ sessionId, row: summary })
  expect(projected).toMatchObject({ uuid, sender: 'system', text: '  Recovered context  ', blocks: [],
    context: { cliUuid: uuid, claudeNativeCompaction: 'summary', claudeTerminalMessage: { uuid, sessionId } } })
  expect(projected?.context.claudeNativeUserMessage).toBeUndefined()
  for (const scope of [{ sessionId: 'foreign' }, { agentId: 'agent' }, { isSidechain: true }, { parent_tool_use_id: 'parent' }]) {
    expect(projectClaudeTerminalHistory({ sessionId, row: { ...summary, ...scope } })).toBeUndefined()
    expect(projectClaudeTerminalHistory({ sessionId, row: { ...boundary, ...scope } })).toBeUndefined()
  }
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...summary, message: { content: [] } } })).toBeUndefined()
})
