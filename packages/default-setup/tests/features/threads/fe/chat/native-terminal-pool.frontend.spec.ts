const f=vi.hoisted(()=>({terms:[] as any[],graphics:[] as any[]}))
vi.mock('@app/claude-terminal-xterm',()=>({Terminal:class{
 cols=80;rows=24;callbacks:(()=>void)[]=[];data?: (text:string)=>void
 reset=vi.fn();dispose=vi.fn();focus=vi.fn();open=vi.fn();loadAddon=vi.fn()
 constructor(public options:unknown){f.terms.push(this)}
 onData(callback:(text:string)=>void){this.data=callback}
 write(_text:string,callback:()=>void){this.callbacks.push(callback)}
}}))
vi.mock('#features/threads/fe/chat/vendor/webterm-kitty/fit.ts',()=>({FitAddon:class{fit=vi.fn()}}))
vi.mock('#features/threads/fe/chat/vendor/webterm-kitty/index.ts',()=>({KittyGraphics:class{
 dispose=vi.fn();constructor(...args:unknown[]){f.graphics.push({instance:this,args})}
}}))
import {mountNativeTerminal} from '#features/threads/fe/chat/native-terminal-pool.ts'
afterEach(()=>document.body.replaceChildren())
it('retains the emulator, silences history, and gives graphics no replay input callback',()=>{
 const root=document.createElement('div');document.body.append(root);const input=vi.fn(),first=mountNativeTerminal('replay-owner',root,input),term=f.terms.at(-1)!
 first.write([{sequence:1,text:'cached query'}]);term.data?.('synthetic reply');expect(input).not.toHaveBeenCalled()
 expect(f.graphics.at(-1)!.args[2]).not.toHaveProperty('respond')
 term.callbacks.shift()!();term.data?.('live key');expect(input).toHaveBeenLastCalledWith('live key')
 first.detach();term.data?.('detached key');expect(input).toHaveBeenCalledTimes(1)
 const replacement=vi.fn(),again=mountNativeTerminal('replay-owner',root,replacement)
 expect(f.terms.at(-1)).toBe(term);expect(again.fit()).toEqual({columns:80,rows:24});term.data?.('new key');expect(replacement).toHaveBeenCalledWith('new key')
 first.detach();expect(root.children).toHaveLength(1);again.detach()
})
it('disposes pending graphics before replaying a history gap',()=>{
 const root=document.createElement('div');document.body.append(root);const input=vi.fn(),mounted=mountNativeTerminal('gap-owner',root,input),term=f.terms.at(-1)!
 mounted.write([{sequence:1,text:'old'}]);term.callbacks.shift()!();const old=f.graphics.at(-1)!.instance
 mounted.write([{sequence:4,text:'replacement history'}]);expect(old.dispose).toHaveBeenCalledOnce();expect(f.graphics.at(-1)!.instance).not.toBe(old)
 term.data?.('replayed action');expect(input).not.toHaveBeenCalled();term.callbacks.shift()!();term.data?.('fresh action');expect(input).toHaveBeenCalledWith('fresh action');mounted.detach()
})
