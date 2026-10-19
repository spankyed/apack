import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalHistoryPlacementRuntime } from '#features/code/be/services/claude-code/terminal-history-placement-runtime.ts'
function fixture(component='TurnDuration'){
 function Eg(){return 'original computed duration'}
 function yd(){return 'original computed notice'}
 const trusted=new Map([[Function.prototype.toString.call(Eg),'bae302522b9c14ab6c8c71b843f47f1c52e70b334e7a32d51b1f9e8c4132e451'],[Function.prototype.toString.call(yd),'b9e8fced6d2763d7e2373765523e8c6219f677ea5cdd8473f5c292ed9639787f']])
 const crypto=(algorithm:string)=>{let input='';return{update(value:string){input+=value;return this},digest(){return trusted.get(input)??createHash(algorithm).update(input).digest('hex')}}}
 const drawing={type:'native computed layout',props:{text:'Waiting for 2 background agents'}},cache:any[]=[];cache[component==='TurnDuration'?33:2]=drawing
 const source:any={component,id:component==='TurnDuration'?'duration':'notice:'+'x'.repeat(1000),input:{surface:'terminal',component,requestId:component==='TurnDuration'?'duration':'notice:'+'x'.repeat(1000),viewport:{columns:100,rows:30},props:component==='TurnDuration'?{word:'Worked',durationMs:1000}:{text:'A notice',command:'/model'}},fingerprint:'original-source',fiber:{child:{type:component==='TurnDuration'?Eg:yd,updateQueue:{memoCache:{data:[cache]}}}}}
 source.props=source.input.props
 const tree:any={type:'Box',children:[{type:'engine',ref:1},{type:'Button',props:{key:'inspect',label:'Inspect'},press:{plugin:'native',handle:2}}]},onScreen={first:0,last:1,of:2}
 const n={engine:{r5:{hostedButtonsOf:vi.fn(()=>[{hosted:902,button:{handle:2,tag:'Button',surface:'terminal',component,requestId:source.input.requestId}}])},vfe:{askedOnScreen:vi.fn(()=>onScreen),settled:vi.fn((_input:unknown)=>tree)},aK:{hasRenderHooksFor:()=>true,heldRenderInput:()=>({component,props:{...source.props,onScreen,word:'Rewritten'}})}},runtime:{ey:()=>({messages:()=>[{type:'assistant',uuid:'assistant'},{type:'user',uuid:'tool-result'},{type:'system',subtype:'turn_duration',uuid:'duration'}]})},nativeClients:{suspendInstance:vi.fn()},jsx:{e:(type:unknown,props:unknown)=>({type,props})},staticRender:{v6e:vi.fn(async()=> 'Native computed layout')}}
 const api=vm.runInNewContext(claudeTerminalHistoryPlacementRuntime+`;({list:terminalPlacementList,facts:terminalPlacementFacts,current:currentTerminalPlacementAction,render:renderTerminalPlacement,frames:terminalPlacementFrames,refresh:refreshTerminalPlacements})`,{createHash:crypto,nativeComposerInputs:()=>new Map([['source',source]]),composerFunctionHashes:new WeakMap(),composerFactoryIds:new WeakMap(),composerFactorySequence:0,nativeDrawingUsesEngine:(tree:any)=>JSON.stringify(tree).includes('engine'),originalContext:undefined,nativeThemeTree:(_n:unknown,tree:unknown)=>tree,nativeThemeProvider:()=>({type:'theme',value:{resolvedTheme:{text:'#fff'}}}),clients:new Set(['view']),clientViewCurrent:()=>true,publish:vi.fn(),instanceLifetimes:{active:()=>true}})
 return{api,n,source,tree,onScreen,cache,drawing}
}
it('reuses the settled terminal drawing with original readonly viewport and canonical history anchors',()=>{
 const f=fixture(),[item]=f.api.list(f.n)
 expect(item).toMatchObject({component:'TurnDuration',id:'duration',anchorIds:['tool-result','assistant']})
 expect(f.n.engine.vfe.settled).toHaveBeenCalledWith(expect.objectContaining({surface:'terminal',props:expect.objectContaining({onScreen:f.onScreen})}))
 expect(f.api.facts(f.n,'TurnDuration','duration').props.word).toBe('Rewritten')
})
it('uses the native computed default without creating another task store or rerunning hooks',async()=>{
 const f=fixture(),[item]=f.api.list(f.n)
 const result=await f.api.render(f.n,{component:item.component,instance_id:item.id,props:{source_revision:item.revision}},'view',1,new AbortController())
 expect(result).toMatchObject({tree:{type:'Box',children:[{type:'engine',ref:1},{type:'Button',press:{plugin:'native',handle:902}}]},engine_output:'Native computed layout'})
 expect(f.n.staticRender.v6e).toHaveBeenCalledWith({type:'theme',props:{value:{resolvedTheme:{text:'#fff'}},children:f.drawing}},{columns:80})
})
it('bounds long notice identities by hashing rather than truncating the original request',()=>{
 const f=fixture('InfoNotice'),[item]=f.api.list(f.n),facts=f.api.facts(f.n,'InfoNotice',item.id)
 expect(item.id).toMatch(/^notice-[a-f0-9]{64}$/);expect(facts.input.requestId).toHaveLength(1007)
 const other=fixture('InfoNotice');other.source.id+='y';other.source.input.requestId+='y'
 expect(other.api.list(other.n)[0].id).not.toBe(item.id)
})
it('rejects stale actions after a computed context changes despite an unchanged request id',()=>{
 const f=fixture(),[item]=f.api.list(f.n),request={client_id:'view',component:item.component,instance_id:item.id}
 f.api.frames.set(JSON.stringify(['view',item.component,item.id]),{fingerprint:item.revision})
 expect(()=>f.api.current(f.n,request)).not.toThrow()
 f.cache[33]={type:'native changed context'}
 expect(()=>f.api.current(f.n,request)).toThrow('changed or expired')
})
it('preserves native offscreen null and refuses absent or lookalike default drawings',()=>{
 const f=fixture();f.n.engine.vfe.askedOnScreen.mockReturnValue(null as any);f.api.list(f.n)
 expect(f.n.engine.vfe.settled).toHaveBeenCalledWith(expect.objectContaining({props:expect.objectContaining({onScreen:null})}))
 f.source.fiber.child.type=function Eg(){return 'impostor'}
 expect(f.api.list(f.n)).toEqual([])
})
it('does not evaluate pending native hooks or acquire their Clients under a different surface',()=>{
 const f=fixture();f.n.engine.vfe.settled.mockReturnValue(undefined as any);expect(f.api.list(f.n)).toEqual([])
 f.n.engine.vfe.settled.mockReturnValue({type:'Client',props:{key:'native'}});expect(f.api.list(f.n)).toEqual([])
})

it('maps sandbox handles only to their uniquely hosted terminal owner',()=>{
 const f=fixture('InfoNotice'),[item]=f.api.list(f.n),facts=f.api.facts(f.n,'InfoNotice',item.id)
 expect(facts.tree.children[1].press.handle).toBe(902)
 expect(f.n.engine.r5.hostedButtonsOf).toHaveBeenCalledWith('native','inspect')
 f.n.engine.r5.hostedButtonsOf.mockReturnValue([{hosted:903,button:{handle:2,tag:'Button',surface:'desktop',component:'InfoNotice',requestId:f.source.input.requestId}}])
 expect(f.api.list(f.n)).toEqual([])
})
