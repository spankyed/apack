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


it('routes one complete handback only to its started task owner, including a late root binding', () => {
  const activity=createClaudeNestedActivity(),receive=vi.fn()
  const start={type:'system',subtype:'task_started',task_type:'local_agent',task_id:'child',tool_use_id:'root',session_id:'session',run_id:'run'} as StreamLine
  const report={type:'system',subtype:'task_notification',task_id:'child',tool_use_id:'root',session_id:'session',run_id:'run',status:'completed',handback:'send',handback_report:{text:'Complete report\n<script>literal</script>',warning:'Original safety warning'},uuid:'report'} as StreamLine
  expect(activity.receive(start)).toBe(false)
  expect(activity.receive({...report,session_id:'foreign'})).toBe(false)
  expect(activity.receive({...report,run_id:'old'})).toBe(false)
  expect(activity.receive({...report,tool_use_id:'foreign'})).toBe(false)
  expect(activity.receive({...report,handback_report:{text:'x',warning:42}} as StreamLine)).toBe(false)
  expect(activity.receive(report)).toBe(true)
  activity.register('foreign',receive);expect(receive).not.toHaveBeenCalled()
  activity.register('root',receive);expect(receive).toHaveBeenCalledExactlyOnceWith(report)
  activity.receive({...report,uuid:'duplicate',handback_report:{text:'Do not replace the delivered report'}} as StreamLine)
  expect(receive).toHaveBeenCalledTimes(1)
  const resumed=vi.fn();activity.register('resumed-root',resumed)
  activity.receive({...start,run_id:'resumed',tool_use_id:'resumed-root'})
  const resumedReport={...report,run_id:'resumed',tool_use_id:'resumed-root',uuid:'resumed-report'}
  expect(activity.receive(resumedReport)).toBe(true)
  expect(resumed).toHaveBeenCalledExactlyOnceWith(resumedReport)
  activity.receive(report);expect(receive).toHaveBeenCalledTimes(1)
  expect(activity.takeAccounting()).toEqual({toolCallCount:0,mutatedPaths:[],hadErrors:false})
  activity.close();activity.receive(report);expect(receive).toHaveBeenCalledTimes(1)
})
