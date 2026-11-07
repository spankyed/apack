import {createApp,nextTick,reactive} from 'vue'
import NativeIdePanel from '#features/threads/fe/chat/NativeIdePanel.vue'
import type {ClaudeSettingsView} from '#features/code/common/native-settings.ts'

function mount() {
  const state=reactive<ClaudeSettingsView>({requestId:'owned',status:'ready',snapshot:{revision:'a'.repeat(64),rows:[],ide:{stage:'selection',title:'Native IDE selection',paragraphs:['Original workspace guidance'],options:[{value:'0',label:'Editor'},{value:'1',label:'None'}],selectedValue:'0'}}})
  const operate=vi.fn(),close=vi.fn(),root=document.createElement('div');document.body.append(root)
  const app=createApp(NativeIdePanel,{state,onOperate:operate,onClose:close});app.mount(root)
  return {state,operate,close,root,dispose(){app.unmount();root.remove()}}
}
it('renders native guidance and rejects controls retained from an earlier revision',async()=>{
  const s=mount()
  try {
    await nextTick();s.operate.mockClear()
    expect(s.root.textContent).toContain('Original workspace guidance')
    const old=s.root.querySelector<HTMLButtonElement>('[data-native-ide-choice="0"]')!
    s.state.snapshot!.revision='b'.repeat(64);await nextTick()
    old.click();expect(s.operate).not.toHaveBeenCalled()
    s.root.querySelector<HTMLButtonElement>('[data-native-ide-choice="1"]')!.click()
    expect(s.operate).toHaveBeenCalledExactlyOnceWith({kind:'ideSelect',revision:'b'.repeat(64),value:'1'})
  } finally {s.dispose()}
})
it('preserves confirmation labels and disables choices while native acknowledgement is pending',async()=>{
  const s=mount()
  try {
    s.state.snapshot!.ide={stage:'disable',title:'Disable automatic connection?',paragraphs:[],options:[{value:'confirm',label:'Yes'},{value:'cancel',label:'No'}]}
    await nextTick();s.operate.mockClear()
    s.root.querySelector<HTMLButtonElement>('[data-native-ide-choice="cancel"]')!.click()
    expect(s.operate).toHaveBeenCalledExactlyOnceWith({kind:'ideSelect',revision:'a'.repeat(64),value:'cancel'})
    s.state.status='pending';await nextTick();s.operate.mockClear()
    s.root.querySelector<HTMLButtonElement>('[data-native-ide-choice="confirm"]')!.click()
    expect(s.operate).not.toHaveBeenCalled()
    expect(s.root.textContent).toContain('Waiting for Claude Code')
  } finally {s.dispose()}
})
it('does not steal focus from another input and routes Escape to the native close operation',async()=>{
  const input=document.createElement('input');document.body.append(input);input.focus()
  const s=mount()
  try {
    await nextTick();expect(document.activeElement).toBe(input)
    s.root.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))
    expect(s.close).toHaveBeenCalledOnce()
  } finally {s.dispose();input.remove()}
})

it('refreshes mounted native choices after source changes even outside the connecting stage',async()=>{
  vi.useFakeTimers();const s=mount()
  try {
    await nextTick();s.operate.mockClear()
    await vi.advanceTimersByTimeAsync(500);expect(s.operate).toHaveBeenCalledExactlyOnceWith({kind:'read'})
    s.state.status='pending';await nextTick();await vi.advanceTimersByTimeAsync(500);expect(s.operate).toHaveBeenCalledOnce()
    s.dispose();await vi.advanceTimersByTimeAsync(1000);expect(s.operate).toHaveBeenCalledOnce()
  } finally {vi.useRealTimers()}
})
