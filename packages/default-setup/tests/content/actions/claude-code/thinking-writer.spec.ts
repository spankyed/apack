import { createToolActivityWriter } from '../../../../src/content/actions/claude-code/_helpers/tool-activity-writer.ts'
import { createThinkingWriter } from '../../../../src/content/actions/claude-code/_helpers/thinking-writer.ts'
import type { Services, EntityId } from '#generated/services.ts'
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => vi.useRealTimers())
function fixture() {
  const update = vi.fn()
  const services = { chat: { updateMessageState: update } } as unknown as Services
  return { writer: createThinkingWriter(services, 'message-one' as EntityId, { intervalMs: 250 }), update, services }
}
it('retains thinking from a later model cycle and counts active thinking time rather than tool wait time', async () => {
  const { writer } = fixture()
  writer.push('First summary.'); await vi.advanceTimersByTimeAsync(1000); writer.finalise()
  await vi.advanceTimersByTimeAsync(10000)
  writer.push('Second summary.'); expect(writer.isStreaming).toBe(true)
  await vi.advanceTimersByTimeAsync(1000); writer.finalise()
  expect(writer.buildBlock()?.props).toMatchObject({ content: 'First summary.\n\nSecond summary.', state: 'done', label: 'Thought for 2.0s' })
})
it('publishes later thinking through the tool-activity owner without replacing its blocks', async () => {
  const { writer, update, services } = fixture()
  writer.push('First.'); writer.finalise(); update.mockClear()
  const activity = createToolActivityWriter(services, 'message-one' as EntityId, { getThinkingBlock: () => writer.buildBlock(), intervalMs: 250 })
  activity.append({ id: 'native-tool', tool: 'Bash', summary: 'Private fixture', status: 'running' })
  const owned = vi.fn(() => activity.flush())
  writer.stopDirectWrites(owned)
  writer.push('Second.'); await vi.advanceTimersByTimeAsync(250)
  expect(owned).toHaveBeenCalledOnce()
  expect(update).toHaveBeenLastCalledWith('message-one', { blocks: [expect.objectContaining({ props: expect.objectContaining({ content: 'First.\n\nSecond.', state: 'streaming' }) }), expect.objectContaining({ type: 'tool-activity', props: expect.objectContaining({ entries: [expect.objectContaining({ id: 'native-tool', status: 'running' })] }) })] })
  writer.finalise(); activity.finalise('done'); const completed = owned.mock.calls.length
  await vi.advanceTimersByTimeAsync(1000); expect(owned).toHaveBeenCalledTimes(completed)
})

it('captures eligible native summary ranges and heals partial or completed-only text without exposing signatures', () => {
  const { writer } = fixture(), signature = 'Eg0KC0IJbmFycmF0aW9u'
  writer.push('First')
  writer.acceptNativeMessage({ uuid: 'summary-a', sessionId: 'session', apiMessageId: 'reply-a', text: 'First summary.', signature })
  writer.finalise()
  writer.acceptNativeMessage({ uuid: 'ordinary-b', sessionId: 'session', apiMessageId: 'reply-b', text: 'Ordinary thinking.', signature: 'not-a-narration-signature' })
  const block = writer.buildBlock()!
  expect(block.props.content).toBe('First summary.\n\nOrdinary thinking.')
  expect(block.props.nativeMessages).toEqual([
    { uuid: 'summary-a', sessionId: 'session', apiMessageId: 'reply-a', text: 'First summary.', start: 0, end: 14, isSummary: true },
    { uuid: 'ordinary-b', sessionId: 'session', apiMessageId: 'reply-b', text: 'Ordinary thinking.', start: 16, end: 34 },
  ])
  expect(JSON.stringify(block)).not.toContain(signature)
  writer.acceptNativeMessage({ uuid: 'summary-a', sessionId: 'session', text: 'First summary.', signature: 'changed' })
  expect(writer.buildBlock()?.props.nativeMessages?.[0].isSummary).toBe(true)
  writer.finalise()
})

it('does not grant summary identity to whitespace-only thinking or nested activity', () => {
  const { writer, update } = fixture(), signature = 'Eg0KC0IJbmFycmF0aW9u'
  writer.acceptNativeMessage({ uuid: 'child', sessionId: 'session', text: 'Child summary', signature, parentToolUseId: 'agent-tool' })
  expect(writer.buildBlock()).toBeNull(); expect(update).not.toHaveBeenCalled()
  writer.acceptNativeMessage({ uuid: 'empty', sessionId: 'session', text: '  ', signature })
  expect(writer.buildBlock()?.props.nativeMessages?.[0].isSummary).toBeUndefined()
  writer.finalise()
})
