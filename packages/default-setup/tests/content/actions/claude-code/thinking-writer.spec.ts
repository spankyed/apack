// What the thinking writer makes of Claude's *native* stream: its assistant messages repeat the same prose
// as whole blocks, and a later model cycle reopens thinking the window had already seen finished.
//
// **The cost of a growing block is covered where the writer's own cases are** (`_helpers/`): the row, the
// feed and the bounded multiple. What is here is the native layer over them.
import { createThinkingWriter } from '../../../../src/content/actions/claude-code/_helpers/thinking-writer.ts'
import type { Services, EntityId } from '#generated/services.ts'
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => vi.useRealTimers())
function fixture() {
  const update = vi.fn(() => 'block-one' as EntityId)
  // A block is a row: written by its id, appended to as it grows, and fed to the windows through a channel
  // that stores nothing. A fixture about what the writer makes of the text records the row's writes.
  const services = {
    chat: {
      updateMessageBlock: update,
      appendMessageBlockText: vi.fn(),
      streamMessageBlockText: vi.fn(),
      updateMessageState: vi.fn(),
    },
  } as unknown as Services
  return { writer: createThinkingWriter(services, 'message-one' as EntityId), update, services }
}
it('retains thinking from a later model cycle and counts active thinking time rather than tool wait time', async () => {
  const { writer } = fixture()
  writer.push('First summary.'); await vi.advanceTimersByTimeAsync(1000); writer.finalise()
  await vi.advanceTimersByTimeAsync(10000)
  writer.push('Second summary.'); expect(writer.isStreaming).toBe(true)
  await vi.advanceTimersByTimeAsync(1000); writer.finalise()
  expect(writer.buildBlock()?.props).toMatchObject({ content: 'First summary.\n\nSecond summary.', state: 'done', label: 'Thought for 2.0s' })
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
