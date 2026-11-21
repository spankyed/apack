import vm from 'node:vm'
import { claudeNativeToolResultRuntime } from '#features/code/be/services/claude-code/native-tool-result-runtime.ts'
function fixture(output: unknown = { new_source: 'reviewed', cell_id: 'analysis' }) {
  const call = { type: 'tool_use', id: 'edit', name: 'NotebookEdit', input: { notebook_path: '/owned/review.ipynb' } }
  const result = { uuid: 'result', type: 'user', sourceToolAssistantUUID: 'assistant', message: { content: [{ type: 'tool_result', tool_use_id: 'edit', content: 'Updated cell analysis', is_error: false }] }, toolUseResult: output }
  const rows = [{ uuid: 'assistant', type: 'assistant', message: { content: [call] } }, result]
  const value = { component: 'ToolResult', surface: 'desktop', requestId: 'edit', props: { session_id: 'session', source_uuid: 'result', assistant_uuid: 'assistant', tool: 'NotebookEdit', text: 'Updated cell analysis', isErrored: false } }
  const api = vm.runInNewContext(claudeNativeToolResultRuntime + ';({nativePrintToolRender,nativeToolResultWireProps})')
  return { api, rows, result, value, binding: { messages: () => rows } }
}
it('passes the original structured object to print hooks without JSON conversion or address markers', () => {
  const f = fixture(), rendered = f.api.nativePrintToolRender(f.value, f.binding, 'session')
  expect(rendered.props).toEqual({ tool_use_id: 'edit', tool: 'NotebookEdit', output: f.result.toolUseResult, isErrored: false })
  expect(rendered.props.output).toBe(f.result.toolUseResult); expect(f.value.props).toHaveProperty('source_uuid')
})
it('preserves native Error object identity instead of serializing it to an empty object', () => {
  const error = new Error('Original native failure'), f = fixture(error)
  expect(f.api.nativePrintToolRender(f.value, f.binding, 'session').props.output).toBe(error)
})
it.each(['session', 'result', 'assistant', 'text', 'duplicate'] as const)('refuses %s mismatch before calling a hook', change => {
  const f = fixture()
  if (change === 'session') f.value.props.session_id = 'foreign'
  if (change === 'result') f.value.props.source_uuid = 'foreign'
  if (change === 'assistant') f.result.sourceToolAssistantUUID = 'foreign'
  if (change === 'text') f.value.props.text = 'forged'
  if (change === 'duplicate') f.rows.push(f.result)
  expect(() => f.api.nativePrintToolRender(f.value, f.binding, 'session')).toThrow()
})
it('leaves original native callers that carry public props untouched', () => {
  const f = fixture(), value = { component: 'ToolResult', props: { output: 'original public caller' } }
  expect(f.api.nativePrintToolRender(value, undefined, 'session')).toBe(value)
})

it('retains large native image props for original hooks while omitting payload from app wire props',()=>{
 const output={stdout:'data:image/png;base64,'+'A'.repeat(700000),stderr:'',isImage:true},f=fixture(output)
 const rendered=f.api.nativePrintToolRender(f.value,f.binding,'session')
 expect(rendered.props.output).toBe(output)
 const wire=f.api.nativeToolResultWireProps(rendered.props)
 expect(wire.output_in_native_process).toBe(true);expect(wire.props).not.toHaveProperty('output')
 expect(wire.props.tool_use_id).toBe('edit');expect(output.stdout.length).toBeGreaterThan(65536)
 expect(rendered.props.output).toBe(output)
})
it('preserves small structured wire props and rejects original payloads above the local bound',()=>{
 const f=fixture();const rendered=f.api.nativePrintToolRender(f.value,f.binding,'session')
 expect(f.api.nativeToolResultWireProps(rendered.props).props).toBe(rendered.props)
 const oversized=fixture({stdout:'A'.repeat(32*1024*1024),isImage:true})
 expect(()=>oversized.api.nativePrintToolRender(oversized.value,oversized.binding,'session')).toThrow()
})
