import {mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createClaudeBackgroundMainObservation} from '#features/code/be/services/claude-code/background-main-observation.ts'
const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
const event={kind:'main',sessionId:'child',parentPid:119,generation:'startup-generation',policyKey:'[false,false,false]',command:'original-helper',startedAt:'10',totalCostUsd:0.00042,code:0,signal:null,truncated:false,stdout:'Release review\nSession cost $0.000420\n'}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'cc-main-observation-'));roots.push(root)
 const configPath=join(root,'observer.json');writeFileSync(configPath,JSON.stringify({mainObservationClaimed:false,generations:{main:event.generation,subagent:'independent'}}),{mode:0o600})
 const make=()=>createClaudeBackgroundMainObservation({configPath,sessionId:'child',pid:119})
 return{root,configPath,make,main:make()}
}
it('claims the original startup result once and pairs only its exact input cost',()=>{
 const f=fixture();writeFileSync(join(f.root,'startup-main.json'),JSON.stringify(event),{mode:0o600})
 const startup=f.main.configure(event.command,event.policyKey) as Record<string,unknown>;expect(startup).toEqual(event);expect(f.main.configure(event.command,event.policyKey)).toEqual(event);expect(f.main.value(0.00042)).toBeUndefined();expect(f.main.accept(startup)).toBe(true);expect(f.main.configure(event.command,event.policyKey)).toBeUndefined()
 expect(f.main.value(0.00042)).toBe(event.stdout.trim());expect(f.main.value(0.00056)).toBeUndefined();expect(f.main.value(undefined)).toBeUndefined()
 expect(JSON.parse(readFileSync(f.configPath,'utf8'))).toMatchObject({mainObservationClaimed:true,generations:{main:event.generation,subagent:'independent'}})
 writeFileSync(join(f.root,'startup-main.json'),JSON.stringify(event),{mode:0o600})
 const replacement=f.make();expect(replacement.configure(event.command,event.policyKey)).toBeUndefined();expect(replacement.accept(event)).toBe(false);expect(replacement.value(0.00042)).toBeUndefined()
})
it('accepts a pending original result after configuration and fences command/policy return epochs',()=>{
 const f=fixture();expect(f.main.configure(event.command,event.policyKey)).toBeUndefined();expect(f.main.accept(event)).toBe(true)
 expect(f.main.configure(event.command,event.policyKey)).toBeUndefined();expect(f.main.value(0.00042)).toBe(event.stdout.trim())
 f.main.configure(event.command,'[true,false,false]');expect(f.main.value(0.00042)).toBeUndefined();expect(f.main.accept(event)).toBe(false)
 f.main.configure(event.command,event.policyKey);const generation=JSON.parse(readFileSync(f.configPath,'utf8')).generations.main
 expect(generation).not.toBe(event.generation);expect(f.main.accept(event)).toBe(false)
 expect(f.main.accept({...event,generation,startedAt:'12'})).toBe(true);expect(f.main.accept({...event,generation,startedAt:'11',stdout:'stale'})).toBe(false);expect(f.main.value(0.00042)).toBe(event.stdout.trim())
 f.main.configure(null,event.policyKey);expect(f.main.value(0.00042)).toBeUndefined();expect(f.main.accept({...event,generation,startedAt:'13'})).toBe(false)
})
it.each([{parentPid:120},{sessionId:'foreign'},{generation:'expired'},{policyKey:'[true,false,false]'},{command:'foreign'},{totalCostUsd:NaN},{stdout:'x'.repeat(32769)},{startedAt:'invalid'}])('refuses inconsistent original observation %j',change=>{
 const f=fixture();f.main.configure(event.command,event.policyKey);expect(f.main.accept({...event,...change})).toBe(false);expect(f.main.value(0.00042)).toBeUndefined()
})
it.each([{code:1},{signal:'aborted',code:null},{truncated:true}])('withdraws prior text after an admitted failed/cancelled/truncated execution %j',change=>{
 const f=fixture();f.main.configure(event.command,event.policyKey);expect(f.main.accept(event)).toBe(true);expect(f.main.accept({...event,startedAt:'11',...change})).toBe(true);expect(f.main.value(0.00042)).toBeUndefined()
})
it('refuses an unowned startup receipt instead of following its link',()=>{
 const f=fixture(),foreign=join(f.root,'foreign.json');writeFileSync(foreign,JSON.stringify(event),{mode:0o600});symlinkSync(foreign,join(f.root,'startup-main.json'))
 expect(()=>f.main.configure(event.command,event.policyKey)).toThrow('Unowned');expect(f.main.value(0.00042)).toBeUndefined();expect(readFileSync(foreign,'utf8')).toBe(JSON.stringify(event))
})
it('restores an accepted caption only when the live native cache, policy and input cost agree',()=>{
 const f=fixture();f.main.configure(event.command,event.policyKey);expect(f.main.accept(event)).toBe(true)
 f.main.configure(null,'[false,false,true]');expect(f.main.value(event.totalCostUsd)).toBeUndefined();expect(f.main.canRestore(event.totalCostUsd)).toBe(false)
 f.main.configure(event.command,event.policyKey);expect(f.main.canRestore(event.totalCostUsd)).toBe(true)
 expect(f.main.accept({...event,startedAt:'20'})).toBe(false)
 expect(f.main.restoreCached(event.stdout,0.00056)).toBe(false)
 expect(f.main.restoreCached('different native cached text',event.totalCostUsd)).toBe(false)
 expect(f.main.restoreCached(event.stdout,event.totalCostUsd)).toBe(true)
 expect(f.main.value(event.totalCostUsd)).toBe(event.stdout.trim());expect(f.main.startedAt).toBe(10n)
})
it('does not revive captions through another command/policy, owner retirement or a failed execution',()=>{
 const f=fixture();f.main.configure(event.command,event.policyKey);f.main.accept(event)
 f.main.configure('another-helper',event.policyKey);expect(f.main.restoreCached(event.stdout,event.totalCostUsd)).toBe(false)
 f.main.configure(event.command,'[true,false,false]');expect(f.main.restoreCached(event.stdout,event.totalCostUsd)).toBe(false)
 f.main.configure(event.command,event.policyKey)
 const generation=JSON.parse(readFileSync(f.configPath,'utf8')).generations.main
 expect(f.main.accept({...event,generation,startedAt:'20',code:1})).toBe(true)
 f.main.configure(null,'[false,false,true]');f.main.configure(event.command,event.policyKey)
 expect(f.main.canRestore(event.totalCostUsd)).toBe(false);expect(f.main.restoreCached(event.stdout,event.totalCostUsd)).toBe(false)
 f.main.accept({...event,generation:JSON.parse(readFileSync(f.configPath,'utf8')).generations.main,startedAt:'30'})
 f.main.clear();f.main.configure(event.command,event.policyKey);expect(f.main.restoreCached(event.stdout,event.totalCostUsd)).toBe(false)
 const replacement=f.make();replacement.configure(event.command,event.policyKey);expect(replacement.restoreCached(event.stdout,event.totalCostUsd)).toBe(false)
})
it('does not overwrite a newer accepted native result with a delayed cache read',()=>{
 const f=fixture();f.main.configure(event.command,event.policyKey);f.main.accept(event)
 f.main.configure(null,'[false,false,true]');f.main.configure(event.command,event.policyKey)
 const generation=JSON.parse(readFileSync(f.configPath,'utf8')).generations.main
 expect(f.main.accept({...event,generation,startedAt:'20',stdout:'New native result'})).toBe(true)
 expect(f.main.restoreCached(event.stdout,event.totalCostUsd)).toBe(false)
 expect(f.main.value(event.totalCostUsd)).toBe('New native result');expect(f.main.startedAt).toBe(20n)
})
