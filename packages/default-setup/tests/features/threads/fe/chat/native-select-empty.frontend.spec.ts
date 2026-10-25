import {createApp, h, nextTick, reactive, type App} from 'vue'
import NativeUiField from '#features/threads/fe/chat/NativeUiField.vue'

let app: App | undefined
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }))
afterEach(() => { app?.unmount(); document.body.replaceChildren(); vi.unstubAllGlobals() })
async function field(value?: string) {
  const node = reactive({kind:'select' as const, actionId:'choice', revision:0, autoFocus:false, value,
    options:[{value:'',label:'Empty choice'},{value:'a',label:'A'},{value:'__native_unselected__',label:'Actual sentinel-like choice'}]})
  const picked=vi.fn(), root=document.createElement('div'); document.body.append(root)
  app=createApp({render:()=>h(NativeUiField,{node,onField:picked})});app.mount(root);await nextTick()
  return {node,picked,select:root.querySelector('select')!}
}
it('shows native none until a real option is picked, including an empty-string choice', async () => {
  const {select,picked}=await field()
  expect(select.selectedOptions[0]?.textContent).toBe('none')
  expect(picked).not.toHaveBeenCalled()
  select.dispatchEvent(new Event('change',{bubbles:true}));await nextTick()
  expect(picked).not.toHaveBeenCalled()
  select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));await nextTick()
  expect(picked).toHaveBeenCalledOnce()
  expect(picked.mock.calls[0][0]).toMatchObject({kind:'select',value:''})
  expect(select.selectedOptions[0]?.textContent).toBe('Empty choice')
})
it('keeps explicit empty selections distinct and applies a later unset native value', async () => {
  const {node,select,picked}=await field('')
  expect(select.selectedOptions[0]?.textContent).toBe('Empty choice')
  node.value='a';await nextTick();expect(select.selectedOptions[0]?.textContent).toBe('A')
  node.value=undefined;await nextTick();expect(select.selectedOptions[0]?.textContent).toBe('none')
  expect(picked).not.toHaveBeenCalled()
})
