import vm from 'node:vm'
import {createHash} from 'node:crypto'
import {claudeTerminalHelpRuntime} from '#features/code/be/services/claude-code/terminal-help-runtime.ts'

function fixture(){
 const Owner=()=>{},Wrapper=()=>{},Tab=()=>{},Body=()=>{},List=()=>{}
 const hashes=new WeakMap<Function,string>([[Owner,'070e5819763820f34cc9ad3f553c8e6551f01bb3bf939145a8d7253c4be7acb5'],[Wrapper,'a2ed848a66ba4a3055694ea64f27b7f1b126f093b0b13c9c56f98c72d41a242c'],[List,'2769c59607086f715df3b4d768ee939feb9ecd289d35dcde4971ac6727494ad7']])
 const originalProps={onClose:vi.fn(),commands:[]},dismiss=vi.fn(),ownerCache=Array(41).fill(null);ownerCache[3]=dismiss
 const text:any={tag:6,memoizedProps:'Original shortcut reading'},body:any={type:Body,memoizedProps:{id:'general',children:{}},child:text}
 const tabs=['General','Commands','Custom commands'].map(title=>({type:Tab,memoizedProps:{title,isCurrent:title==='General',onClick:vi.fn(()=>{for(const tab of tabs)tab.memoizedProps.isCurrent=tab.memoizedProps.title===title;body.memoizedProps.id={'General':'general','Commands':'commands','Custom commands':'custom'}[title]})},sibling:undefined as any}))
 tabs.forEach((tab,index)=>{tab.sibling=tabs[index+1]??body})
 const wrapper:any={type:Wrapper,memoizedProps:{title:'Help'},child:tabs[0]},owner:any={type:Owner,memoizedProps:originalProps,child:wrapper,updateQueue:{memoCache:{data:[ownerCache]}}}
 const root:any={child:owner},entry={originalProps,current:vi.fn(),closed:false,answered:false},panelGuard=vi.fn()
 const api=vm.runInNewContext(claudeTerminalHelpRuntime+';({nativeHelpFrame,nativeHelpPanel,nativeHelpDismissCallback})',{process,createHash,composerFunctionHashes:hashes,setTimeout,nativeSettingsPanel:panelGuard})
 const n={themeRoots:{ai:()=>new Map([[process.stdout,{container:{current:root}}]])}}
 return {api,n,entry,root,owner,wrapper,tabs,body,text,List,hashes,dismiss,panelGuard,read:()=>api.nativeHelpFrame(n,entry),navigate:(tab:string,revision?:string)=>api.nativeHelpPanel(n,entry,{operation:'helpTab',tab,revision:revision??api.nativeHelpFrame(n,entry).snapshot.revision},new AbortController())}
}
it('reads only the original owned Help tree and uses its native tab callback',async()=>{
 const f=fixture();f.owner.sibling={tag:6,memoizedProps:'Foreign dialog'}
 expect(f.read().snapshot.help.paragraphs).toEqual(['Original shortcut reading'])
 const result=await f.navigate('Commands')
 expect(result.snapshot.help.selectedTab).toBe('Commands');expect(f.tabs[1].memoizedProps.onClick).toHaveBeenCalledTimes(1);expect(f.panelGuard).toHaveBeenCalled()
})
it('rejects retired, duplicate and changed native producers',()=>{
 const f=fixture();f.entry.closed=true;expect(f.read).toThrow('expired')
 const g=fixture();g.root.child.sibling={...g.owner};expect(g.read).toThrow('not uniquely mounted')
 const h=fixture();h.hashes.set(h.wrapper.type,'changed');expect(h.read).toThrow('tabs changed')
})
it('refuses stale revisions, unknown tabs and aborted actions without invoking callbacks',async()=>{
 const f=fixture();await expect(f.navigate('Commands','stale')).rejects.toThrow('changed')
 await expect(f.navigate('Unknown')).rejects.toThrow('unavailable')
 const abort=new AbortController();abort.abort()
 await expect(f.api.nativeHelpPanel(f.n,f.entry,{operation:'read'},abort)).rejects.toThrow()
 expect(f.tabs.every(tab=>tab.memoizedProps.onClick.mock.calls.length===0)).toBe(true)
})
it('projects original filtered command descriptions and refuses ambiguous lists',()=>{
 const f=fixture(),cache=Array(13).fill(null);cache[1]=[{name:'help',label:'/help',description:'Original description'}]
 const list:any={type:f.List,memoizedProps:{commands:[]},updateQueue:{memoCache:{data:[cache]}}};f.body.child=list
 expect(f.read().snapshot.help.commands).toEqual(cache[1])
 list.sibling={...list};expect(f.read).toThrow('ambiguous')
})
it('returns the original guarded dismissal callback and refuses a changed callback cache',()=>{
 const f=fixture();expect(f.api.nativeHelpDismissCallback(f.n,f.entry)).toBe(f.dismiss)
 f.owner.updateQueue.memoCache.data[0][3]=undefined
 expect(()=>f.api.nativeHelpDismissCallback(f.n,f.entry)).toThrow('dismissal changed')
})
