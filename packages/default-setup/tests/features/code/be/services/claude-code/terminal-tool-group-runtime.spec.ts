import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalToolGroupRuntime } from '#features/code/be/services/claude-code/terminal-tool-group-runtime.ts'
function fixture(){
 const output={},component=()=>{},call={type:'tool_use',id:'one',name:'Read',input:{file_path:'original.txt'}},result={type:'user',toolUseResult:{file:'original'},interrupted:false}
 const props={message:{type:'collapsed_read_search',uuid:'native-group',messages:[{type:'assistant',message:{content:[call]}}]},lookups:{toolResultByToolUseID:new Map([['one',result]]),erroredToolUseIDs:new Set()},inProgressToolUseIDs:new Set(['one']),isActiveCollapsedGroup:true}
 const fiber:any={type:component,memoizedProps:props},state:{viewingAgentTaskId?:string}={}
 const n={themeRoots:{ai:()=>new Map([[output,{container:{current:fiber}}]])},toolRendering:{h3:component},engine:{aK:{isInterruptedCall:(row:any)=>row?.interrupted===true}},nativeClients:{release:vi.fn(),suspend:vi.fn()}}
 const publish=vi.fn(),f=vm.runInNewContext(`${claudeTerminalToolGroupRuntime};({groups:nativeToolGroups,list:nativeToolGroupList,frames:toolGroupFrames,check:currentToolGroupAction,draw:toolGroupDrawing,press:runToolGroupAction,refresh:refreshNativeToolGroups})`,{process:{stdout:output},createHash,AbortController,originalContext:{toolContext:()=>({getAppState:()=>state})},clients:new Set(['view']),clientViewCurrent:()=>true,instanceLifetimes:{active:(_request:any,revision:number)=>revision===1},randomUUID:()=> 'scope',nativeDrawingUsesEngine:(tree:any)=>tree.type==='engine',publish})
 return{n,f,props,fiber,state,call,result,publish}
}
it('reads original group identity, first tool blocks, running/results and refuses selected Agent fallback',()=>{
 const x=fixture(),group=x.f.groups(x.n).get('native-group')
 expect(group).toMatchObject({id:'native-group',isActive:true,calls:[{tool_use_id:'one',tool:'Read',input:x.call.input,isRunning:true,isErrored:false,isInterrupted:false,output:x.result.toolUseResult}]})
 expect(x.f.list(x.n,'view')[0]).toMatchObject({id:'native-group',members:[{toolUseId:'one',revision:expect.any(String)}],usesEngine:true,initialized:false,isExpanded:false})
 x.state.viewingAgentTaskId='agent';expect(x.f.groups(x.n).size).toBe(0)
})
it('deduplicates identical original fibers and refuses contradictory or repeated membership',()=>{
 const x=fixture();x.fiber.sibling={...x.fiber};expect(x.f.groups(x.n).size).toBe(1)
 x.fiber.sibling.memoizedProps={...x.props,isActiveCollapsedGroup:false};expect(x.f.groups(x.n).size).toBe(0)
 delete x.fiber.sibling;x.props.message.messages.push(x.props.message.messages[0]!);expect(x.f.groups(x.n).size).toBe(0)
})
it('keeps expansion per client and consumes current disclosure actions without executing a tool',()=>{
 const x=fixture(),group=x.f.groups(x.n).get('native-group'),key=JSON.stringify(['view','native-group'])
 x.f.frames.set(key,{clientId:'view',id:'native-group',revision:group.revision,expanded:false,shownExpanded:false,needsRender:false})
 const tree=x.f.draw({client_id:'view',instance_id:'native-group'},{type:'engine'},1),button=tree.children[0],request={subtype:'ui_press',client_id:'view',component:'ToolGroup',instance_id:'native-group',instance_revision:1,key:'expand-group',...button.press}
 expect(x.f.press(x.n,{...request,client_id:'foreign'},new AbortController())).toEqual({handled:false})
 expect(x.f.press(x.n,{...request,instance_revision:2},new AbortController())).toEqual({handled:false})
 expect(x.f.press(x.n,request,new AbortController())).toEqual({handled:true})
 expect(x.f.list(x.n,'view')[0].isExpanded).toBe(true);expect(x.f.list(x.n,'other')[0].isExpanded).toBe(false)
 expect(x.f.press(x.n,request,new AbortController())).toEqual({handled:false})
 x.result.interrupted=true;expect(()=>x.f.check(x.n,request)).toThrow('changed or expired')
 x.f.refresh(x.n);expect(x.n.nativeClients.suspend).toHaveBeenCalledWith([{surface:'desktop',component:'ToolGroup',requestId:'native-group'}])
 expect(x.call.input).toEqual({file_path:'original.txt'})
})

it('retires group Client work and reports one invalidation when source traversal cannot establish ownership',()=>{
 const x=fixture();x.f.frames.set('frame',{clientId:'view',id:'native-group',revision:'old',expanded:false,shownExpanded:false})
 let node=x.fiber;for(let i=0;i<4096;i++){node.child={};node=node.child}
 x.f.refresh(x.n);expect(x.n.nativeClients.release).toHaveBeenCalledWith('view','ToolGroup','native-group');expect(x.publish).toHaveBeenCalledOnce()
 x.f.refresh(x.n);expect(x.publish).toHaveBeenCalledOnce()
})
