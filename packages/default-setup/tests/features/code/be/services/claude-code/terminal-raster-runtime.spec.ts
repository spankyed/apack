import vm from 'node:vm'
import {claudeTerminalRasterRuntime} from '#features/code/be/services/claude-code/terminal-raster-runtime.ts'
function fixture(){
 const original=vi.fn((_words:Uint32Array)=> 'native paint result'),mount={plugin:'plugin',requestId:'notice',key:'grid',columns:1,rows:1,paint:original},registry=new Map([['notice/grid/plugin',{rasters:new Set([mount])}]]),invalidate=vi.fn();let live=true,eligible=true
 const scope={client_id:'client',component:'InfoNotice',instance_id:'notice-hash',instance_revision:1,source_revision:'original',native_request_id:'notice'}
 const tree={type:'Raster',props:{key:'grid',columns:1,rows:1,cells:'original cells'},raster:{plugin:'plugin'}}
 const n={nativeHost:{Le:()=>({mountedRasters:registry})},engine:{htn:(id:string,key:string,plugin:string)=>[id,key,plugin].join('/'),FPe:()=>eligible}}
 const create=vm.runInNewContext(claudeTerminalRasterRuntime+';createNativeRasterMirrors',{Buffer,Uint32Array,setTimeout,clearTimeout})
 const mirror=create({current:()=>live,invalidate})
 return {mirror,n,scope,tree,mount,registry,original,invalidate,retire:()=>{live=false},revoke:()=>{eligible=false}}
}
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers())
it('observes original admitted paint results, coalesces latest cells and never adds a native target',()=>{
 const f=fixture();expect(f.mirror.draw(f.n,f.scope,f.tree)).toBe(f.tree)
 expect(f.registry.size).toBe(1);expect(f.registry.values().next().value!.rasters.size).toBe(1)
 const first=new Uint32Array([65,0xff8800,0x1000000]),last=new Uint32Array([66,0xff8800,0x1000000])
 expect(f.mount.paint(first as any)).toBe('native paint result');f.mount.paint(last as any);last[0]=67
 vi.advanceTimersByTime(16);expect(f.invalidate).toHaveBeenCalledTimes(1)
 const shown=f.mirror.draw(f.n,f.scope,f.tree);expect(Buffer.from(shown.props.cells,'base64').readUInt32LE()).toBe(66)
 expect(f.tree.props.cells).toBe('original cells');expect(f.original).toHaveBeenCalledTimes(2)
})
it('restores original paint and retires a queued invalidation when its placement ends',()=>{
 const f=fixture();f.mirror.draw(f.n,f.scope,f.tree);const retired=f.mount.paint
 retired(new Uint32Array([65,0,0]) as any);f.mirror.release('client','InfoNotice','notice-hash')
 expect(f.mount.paint).toBe(f.original);expect(f.mirror.count()).toBe(0)
 retired(new Uint32Array([66,0,0]) as any);vi.advanceTimersByTime(32);expect(f.invalidate).not.toHaveBeenCalled();expect(f.original).toHaveBeenCalledTimes(2)
})
it('shares observation without restoring another active client observer',()=>{
 const f=fixture();f.mirror.draw(f.n,f.scope,f.tree);const wrapper=f.mount.paint
 f.mirror.draw(f.n,{...f.scope,client_id:'second'},f.tree);expect(f.mount.paint).toBe(wrapper)
 f.mirror.detach('client');expect(f.mount.paint).toBe(wrapper);f.mirror.detach('second');expect(f.mount.paint).toBe(f.original)
})
it('does not observe missing, mismatched or ambiguous original mounts',()=>{
 const f=fixture();f.registry.clear();f.mirror.draw(f.n,f.scope,f.tree);expect(f.mount.paint).toBe(f.original);expect(f.mirror.count()).toBe(0)
 f.registry.set('notice/grid/plugin',{rasters:new Set([f.mount,{...f.mount}])});f.mirror.draw(f.n,f.scope,f.tree);expect(f.mount.paint).toBe(f.original)
})
it('withdraws observation after native unmount or policy revocation and refuses retired ownership',()=>{
 const f=fixture();f.mirror.draw(f.n,f.scope,f.tree);f.revoke();f.mount.paint(new Uint32Array([65,0,0]) as any);vi.advanceTimersByTime(32);expect(f.invalidate).not.toHaveBeenCalled()
 f.mirror.refresh();expect(f.mount.paint).toBe(f.original)
 f.retire();expect(()=>f.mirror.draw(f.n,f.scope,f.tree)).toThrow('expired')
})
