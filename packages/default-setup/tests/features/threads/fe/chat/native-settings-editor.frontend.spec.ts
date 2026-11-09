import { createApp, h, nextTick, reactive } from 'vue'
import NativeSettingsEditor from '#features/threads/fe/chat/NativeSettingsEditor.vue'
import type { ClaudeSettingsEditor } from '#features/code/common/native-settings.ts'

it('retains exact native values, prevents disabled selection and submits edited Unicode fields without mutating native state', async () => {
  const state=reactive<{editor:ClaudeSettingsEditor;pending:boolean}>({editor:{kind:'choice',revision:'a'.repeat(64),value:'a',disabled:false,options:[{value:'a',label:'Original A',disabled:false},{value:'b',label:'Original B',disabled:true}]},pending:false})
  const select=vi.fn(),save=vi.fn(),cancel=vi.fn(),root=document.createElement('div');document.body.append(root)
  const app=createApp({render:()=>h(NativeSettingsEditor,{...state,onSelect:select,onSave:save,onCancel:cancel})});app.mount(root)
  try{
    const choices=[...root.querySelectorAll<HTMLButtonElement>('[aria-pressed]')];choices[1].click();expect(select).not.toHaveBeenCalled();choices[0].click();expect(select).toHaveBeenCalledExactlyOnceWith('a')
    state.editor={kind:'form',revision:'b'.repeat(64),title:'Native editor',submitLabel:'Save original',fields:[{key:'value',label:'Native value',value:'Original text'}]};await nextTick()
    const input=root.querySelector('input')!;input.value='日本語 – exact value';input.dispatchEvent(new Event('input'));await nextTick()
    root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));expect(save).toHaveBeenCalledExactlyOnceWith({value:'日本語 – exact value'});expect(state.editor.fields[0].value).toBe('Original text')
    state.pending=true;await nextTick();expect(input.disabled).toBe(true);[...root.querySelectorAll('button')].find(button=>button.textContent==='Cancel')!.click();expect(cancel).toHaveBeenCalledOnce()
  }finally{app.unmount();root.remove()}
})


it('exposes native custom-theme edit/reset actions and disables them while pending', async () => {
  const state = reactive<{editor:ClaudeSettingsEditor;pending:boolean}>({editor:{kind:'choice',revision:'a'.repeat(64),title:'Theme',disabled:false,options:[{value:'custom:team',label:'Team Review',disabled:false,canEdit:true},{value:'success',label:'success',disabled:false,canReset:true}]},pending:false})
  const edit=vi.fn(),reset=vi.fn(),root=document.createElement('div');document.body.append(root)
  const app=createApp({render:()=>h(NativeSettingsEditor,{...state,onThemeEdit:edit,onThemeReset:reset})});app.mount(root)
  try {
    const editButton=root.querySelector<HTMLButtonElement>('[aria-label="Edit Team Review"]')!,resetButton=root.querySelector<HTMLButtonElement>('[aria-label="Reset success"]')!
    editButton.click();resetButton.click();expect(edit).toHaveBeenCalledExactlyOnceWith('custom:team');expect(reset).toHaveBeenCalledExactlyOnceWith('success')
    const filter=root.querySelector<HTMLInputElement>('[aria-label="Filter color tokens"]')!;filter.value='missing';filter.dispatchEvent(new Event('input'));await nextTick();expect(root.querySelector('[aria-label="Reset success"]')).toBeNull();filter.value='success';filter.dispatchEvent(new Event('input'));await nextTick()
    state.pending=true;await nextTick();expect(editButton.disabled).toBe(true);expect(root.querySelector<HTMLButtonElement>('[aria-label="Reset success"]')!.disabled).toBe(true)
    editButton.click();root.querySelector<HTMLButtonElement>('[aria-label="Reset success"]')!.click();expect(edit).toHaveBeenCalledOnce();expect(reset).toHaveBeenCalledOnce()
  } finally {app.unmount();root.remove()}
})
