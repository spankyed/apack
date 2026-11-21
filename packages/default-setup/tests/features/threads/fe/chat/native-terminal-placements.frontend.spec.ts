import { createApp, h, type App } from 'vue'
import NativeTerminalPlacements from '#features/threads/fe/chat/NativeTerminalPlacements.vue'
import type { ClaudeUiTranscriptFrame } from '#features/code/be/services/claude-code/ui-presentation.ts'
vi.mock('@apackdev/ui/components/tiptap/TiptapEditor',()=>({default:{render:()=>null}}))
let app:App|undefined
afterEach(()=>{app?.unmount();document.body.replaceChildren()})
const frame=(uuid:string,messageId:string,component:'TurnDuration'|'InfoNotice'):ClaudeUiTranscriptFrame=>({instanceRevision:1,component,uuid,messageId,sessionId:'session',sourceRevision:'a'.repeat(64),text:'',start:0,end:0,displayText:'',engineOutput:'\x1b[31mNative line <script>literal</script>\x1b[0m',body:{status:'live',tree:{kind:'box',children:[{kind:'unsupported',component:'engine'},{kind:'button',label:'Inspect native line',actionId:uuid}]}}})
it('keeps native duration rows at their exact owning message and forwards only their own controls',()=>{
 const root=document.createElement('div');document.body.append(root);const press=vi.fn()
 app=createApp({render:()=>h(NativeTerminalPlacements,{frames:[frame('one','first','TurnDuration'),frame('two','second','TurnDuration'),frame('notice','composer','InfoNotice')],component:'TurnDuration',messageId:'second',onPress:press})});app.mount(root)
 expect(root.querySelectorAll('[data-native-placement]')).toHaveLength(1);root.querySelector('button')!.click();expect(press).toHaveBeenCalledWith('two',undefined)
 expect(root.querySelector('script')).toBeNull();expect(root.textContent).toContain('<script>literal</script>')
})
it('renders native session notices separately from duration history',()=>{
 const root=document.createElement('div');document.body.append(root)
 app=createApp({render:()=>h(NativeTerminalPlacements,{frames:[frame('duration','message','TurnDuration'),frame('notice','composer','InfoNotice')],component:'InfoNotice'})});app.mount(root)
 expect(root.querySelectorAll('[data-native-placement="InfoNotice"]')).toHaveLength(1);expect(root.querySelector('[data-native-placement="TurnDuration"]')).toBeNull()
})

it('removes the band when the native default is intentionally hidden',()=>{
 const root=document.createElement('div');document.body.append(root);const value=frame('duration','message','TurnDuration');value.engineOutput='';value.body={status:'live',tree:{kind:'unsupported',component:'engine'}}
 app=createApp({render:()=>h(NativeTerminalPlacements,{frames:[value],component:'TurnDuration',messageId:'message'})});app.mount(root)
 expect(root.querySelector('[data-native-placement-band]')).toBeNull()
})
