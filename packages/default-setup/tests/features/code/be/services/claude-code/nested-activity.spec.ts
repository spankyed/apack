import { createClaudeNestedActivity } from '#features/code/be/services/claude-code/nested-activity.ts'
import type { StreamLine } from '#features/code/be/services/claude-code/types.ts'
const frame = (parent: string, uuid: string, content: unknown[]): StreamLine => ({
  type: 'assistant', parent_tool_use_id: parent, uuid, message: { content },
}) as StreamLine

describe('process-owned nested Claude activity', () => {
  it('retains bindings after accounting drains, routes descendants and deduplicates replay', () => {
    const activity = createClaudeNestedActivity()
    const output = vi.fn()
    activity.register('root', output)
    const tool = frame('root', 'child-message', [{ type: 'tool_use', id: 'edit', name: 'Edit', input: { file_path: '/fixture.ts' } }])
    activity.receive(tool)
    activity.receive(tool)
    expect(output).toHaveBeenCalledOnce()
    expect(activity.takeAccounting()).toEqual({ toolCallCount: 1, mutatedPaths: ['/fixture.ts'], hadErrors: false })
    activity.receive(frame('edit', 'grandchild', [{ type: 'tool_result', is_error: true, content: 'failure' }]))
    expect(output).toHaveBeenCalledTimes(2)
    expect(activity.takeAccounting()).toEqual({ toolCallCount: 0, mutatedPaths: [], hadErrors: true })
    expect(activity.takeAccounting()).toEqual({ toolCallCount: 0, mutatedPaths: [], hadErrors: false })
  })

  it('buffers registration races and out-of-order descendants without accepting foreign roots', () => {
    const activity = createClaudeNestedActivity()
    const output = vi.fn()
    activity.receive(frame('nested-tool', 'grandchild', [{ type: 'text', text: 'later' }]))
    activity.receive(frame('root', 'child', [{ type: 'tool_use', id: 'nested-tool', name: 'Read', input: {} }]))
    activity.receive(frame('foreign', 'foreign-message', [{ type: 'tool_use', id: 'foreign-tool', name: 'Write', input: { path: '/foreign' } }]))
    activity.register('root', output)
    expect(output.mock.calls.map(([event]) => event.uuid)).toEqual(['child', 'grandchild'])
    expect(activity.takeAccounting()).toEqual({ toolCallCount: 1, mutatedPaths: [], hadErrors: false })
    activity.close()
    activity.receive(frame('root', 'after-close', [{ type: 'text', text: 'must not persist' }]))
    activity.register('foreign', output)
    expect(output).toHaveBeenCalledTimes(2)
  })

  it('swallows nested partial frames and bounds unbound output instead of growing indefinitely', () => {
    const activity = createClaudeNestedActivity()
    expect(activity.receive({ type: 'stream_event', parent_tool_use_id: 'root', event: {} } as StreamLine)).toBe(true)
    expect(activity.receive({ type: 'assistant', message: { content: [] } } as StreamLine)).toBe(false)
    expect(() => activity.receive(frame('foreign', 'large', [{ type: 'text', text: 'x'.repeat(2097152) }]))).toThrow('buffer limit')
  })
})
