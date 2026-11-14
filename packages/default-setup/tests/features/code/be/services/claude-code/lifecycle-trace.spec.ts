import { createClaudeLifecycleTrace } from '../../../../../../src/features/code/be/services/claude-code/lifecycle-trace.ts'
it('emits fixed content-free fields, correlates an owner and suppresses events after exit',()=>{
 const records:Record<string,unknown>[]=[]
 const trace=createClaudeLifecycleTrace('control',value=>records.push(value))
 trace('control_start');trace('control_end',{outcome:'ok',prompt:'secret',stderr:'secret',pid:4} as any);trace('exit',{outcome:'ok'});trace('exit');trace('ready')
 expect(records.map(r=>r.event)).toEqual(['control_start','control_end','exit'])
 expect(new Set(records.map(r=>r.owner)).size).toBe(1)
 expect(records[1]).not.toHaveProperty('prompt');expect(records[1]).not.toHaveProperty('stderr')
 expect(records[1]).toMatchObject({kind:'control',pid:4,outcome:'ok'})
})
it('records a dropped notification by route and count, and admits no route of its own',()=>{
 const records:Record<string,unknown>[]=[]
 const trace=createClaudeLifecycleTrace('terminal',value=>records.push(value))
 trace('notifications_dropped',{route:'append',count:3})
 trace('notifications_dropped',{route:'/append; rm -rf',count:1} as any)
 expect(records.map(r=>[r.event,r.route,r.count])).toEqual([['notifications_dropped','append',3],['notifications_dropped',undefined,1]])
})

it('never lets a broken logger affect execution',()=>{
 const trace=createClaudeLifecycleTrace('print',()=>{throw Error('logger unavailable')})
 expect(()=>{trace('launch');trace('exit')}).not.toThrow()
})
