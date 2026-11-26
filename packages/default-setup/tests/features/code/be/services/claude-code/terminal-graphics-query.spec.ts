import { createClaudeTerminalGraphicsQueryResponder } from '#features/code/be/services/claude-code/terminal-graphics-query.ts'
const apc=(header:string,payload='AAAA')=>`\x1b_G${header};${payload}\x1b\\`
it('answers a native byte probe at every PTY chunk boundary',()=>{
 const probe=apc('i=31,s=1,v=1,a=q,t=d,f=24')
 for(let split=0;split<=probe.length;split++){
  const reply=vi.fn(),feed=createClaudeTerminalGraphicsQueryResponder(reply)
  feed(probe.slice(0,split));feed(probe.slice(split));expect(reply.mock.calls).toEqual([['\x1b_Gi=31;OK\x1b\\']])
 }
})
it('refuses file/shared-memory probes without reading paths',()=>{
 const reply=vi.fn(),feed=createClaudeTerminalGraphicsQueryResponder(reply)
 for(const medium of ['f','t','s'])feed(apc(`i=24,a=q,t=${medium},f=32`,'private name'))
 expect(reply).toHaveBeenCalledTimes(3)
 for(const [response]of reply.mock.calls)expect(response).toContain('ENOTSUPPORTED:direct byte images only')
})
it.each(['i=0,a=q','i=4294967296,a=q','i=-1,a=q','i=2,a=T','i=2,a=t','i=2,a=d','i=2,a=q,q=2','i=2,a=q,q=3','i=2,a=q,q=1'])('keeps invalid/non-query/quiet frames silent: %s',header=>{
 const reply=vi.fn();createClaudeTerminalGraphicsQueryResponder(reply)(apc(header));expect(reply).not.toHaveBeenCalled()
})
it('drains oversized/invalid frames and recovers for the next query',()=>{
 const reply=vi.fn(),feed=createClaudeTerminalGraphicsQueryResponder(reply)
 feed(apc('i=31,a=q','x'.repeat(1000000)));feed(apc('i=31,a=q','bad\x1bX'));feed('normal output');feed(apc('i=31,a=q'))
 expect(reply.mock.calls).toEqual([['\x1b_Gi=31;OK\x1b\\']])
})
it('isolates owner parsers and reports unsupported formats in error-only mode',()=>{
 const a=vi.fn(),b=vi.fn(),first=createClaudeTerminalGraphicsQueryResponder(a),second=createClaudeTerminalGraphicsQueryResponder(b)
 first('\x1b_Gi=31,a=q;');second('AAAA\x1b\\');expect(b).not.toHaveBeenCalled();first('AAAA\x1b\\')
 second(apc('i=9,a=q,f=99,q=1'));expect(a).toHaveBeenCalledTimes(1);expect(b.mock.calls[0]![0]).toContain('ENOTSUPPORTED')
})
