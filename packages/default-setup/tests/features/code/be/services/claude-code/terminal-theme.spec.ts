import vm from 'node:vm'
import {claudeTerminalUiRuntime} from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'
function fixture(){
 let palette={text:'#123456',inverseText:'#654321',suggestion:'#654321',success:'rgb(17,34,51)',warning:'#abcdef'}
 const publish=vi.fn(),clients=new Set(['app'])
 const provider=()=>{},output={},value={themeSetting:'custom:research',get resolvedTheme(){return palette}}
 const root={container:{current:{type:provider,child:{memoizedProps:{value}}}}}
 const n={themeRoots:{ai:()=>new Map([[output,root]])},themePreferences:{dEn:provider}}
 const start=claudeTerminalUiRuntime.indexOf('function nativeThemeProvider('),end=claudeTerminalUiRuntime.indexOf('async function initialize(){',start)
 const methods=vm.runInNewContext(claudeTerminalUiRuntime.slice(start,end)+';({draw:nativeThemeTree,refresh:refreshNativeTheme,palette:nativeThemePalette})',{clients,publish,process:{stdout:output}})
 return{n,clients,publish,read:(context:unknown)=>methods.palette(context),draw:(tree:unknown)=>methods.draw(n,tree),refresh:()=>methods.refresh(n),change(){palette={...palette,success:'#998877'}}}
}
it('resolves native Text/Box/hover colors without mutating the native drawing or action identity',()=>{
 const f=fixture(),press={plugin:'native',handle:1},tree={type:'Box',props:{backgroundColor:'inverseText',borderColor:'warning'},children:[{type:'Text',props:{color:'success'},children:['label']},{type:'Button',press,props:{},hover:{color:'warning'}}]}
 const before=JSON.stringify(tree),draw=f.draw(tree)
 expect(draw.props).toEqual({backgroundColor:'#654321',borderColor:'#abcdef'})
 expect(draw.children[0].props.color).toBe('rgb(17,34,51)');expect(draw.children[1].hover.color).toBe('#abcdef')
 expect(draw.children[1].press).toBe(press);expect(JSON.stringify(tree)).toBe(before)
 expect(f.n.themePreferences.dEn).toBeTypeOf('function')
})
it('preserves explicit colors and Client props while resolving default/inherited text and inverse background',()=>{
 const f=fixture(),tree={type:'Box',props:{backgroundColor:'#010203'},children:[{type:'Text',props:{color:'rebeccapurple'},children:[{type:'Text',props:{inverse:true},children:['nested']}]},{type:'Text',children:['default']},{type:'Client',props:{color:'success',module:'private',data:{color:'warning'}}}]}
 const draw=f.draw(tree)
 expect(draw.children[0].children[0].props).toEqual({inverse:true,color:'rebeccapurple',backgroundColor:'#010203'})
 expect(draw.children[1].props.color).toBe('#123456');expect(draw.children[2].props).toBe(tree.children[2]!.props)
})
it('invalidates attached drawings once per original resolved-theme change',()=>{
 const f=fixture();f.refresh();f.refresh();expect(f.publish).not.toHaveBeenCalled()
 f.change();f.refresh();f.refresh();expect(f.publish).toHaveBeenCalledExactlyOnceWith({type:'system',subtype:'ui_invalidate',event:'ui.render'})
 f.clients.clear();f.change();f.refresh();expect(f.publish).toHaveBeenCalledOnce()
})

it('reads only the committed original provider and rejects missing or changed provider contracts',()=>{
 const f=fixture(),provider=f.n.themePreferences.dEn
 const native={type:provider,child:{memoizedProps:{value:{themeSetting:'dark',resolvedTheme:{text:'#010203'}}}}}
 const rooted=(current:unknown)=>({themePreferences:{dEn:provider},themeRoots:{ai:()=>({get:()=>({container:{current}})})}})
 expect(f.read(rooted({type:()=>{},memoizedProps:{value:{resolvedTheme:{text:'wrong'}}},child:native}))).toEqual({text:'#010203'})
 expect(()=>f.read(rooted({type:()=>{},child:null}))).toThrow('not mounted')
 expect(()=>f.read(rooted({type:provider,child:{memoizedProps:{value:{resolvedTheme:{text:'#fff'}}}}}))).toThrow('contract changed')
 const cycle:{type:()=>void;child?:unknown}={type:()=>{}};cycle.child=cycle
 expect(()=>f.read(rooted(cycle))).toThrow('not mounted')
})
it('resolves implicit primary/plain button roles while inline text inherits live hover paint',()=>{
 const f=fixture(),draw=f.draw({type:'Box',children:[{type:'Button',props:{variant:'primary',hotkey:'1'},hover:{color:'warning'},children:[{type:'Text',children:['primary']}]},{type:'Button',props:{variant:'primary',plain:true},children:['plain']}]})
 const themed=draw
 expect(themed.children[0].props.color).toBe('#654321');expect(themed.children[0].hover.color).toBe('#abcdef')
 expect(themed.children[0].children[0].props.color).toBeUndefined()
 expect(themed.children[1].props).toMatchObject({color:'#123456',hotkeyColor:'#654321'})
})
