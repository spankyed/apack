import {createApp,nextTick} from 'vue'
import {openLink} from '@apackdev/sdk/fe'
import NativeConsentDisclosure from '#features/threads/fe/chat/NativeConsentDisclosure.vue'
vi.mock('@apackdev/sdk/fe',()=>({openLink:vi.fn()}))
it('preserves native disclosure text and opens only its original link on primary or middle click',async()=>{
 const url='https://code.claude.com/docs/en/security',text='Original warning <img src=x> '+url+' end',root=document.createElement('div');document.body.append(root)
 const app=createApp(NativeConsentDisclosure,{text,links:[url]});app.mount(root)
 try{
  await nextTick();expect(root.textContent).toBe(text);expect(root.querySelector('img')).toBeNull();const link=root.querySelector('a')!;expect(link.getAttribute('href')).toBe(url)
  link.dispatchEvent(new MouseEvent('click',{button:0,bubbles:true,cancelable:true}));expect(openLink).toHaveBeenLastCalledWith(url)
  link.dispatchEvent(new MouseEvent('auxclick',{button:1,bubbles:true,cancelable:true}));expect(openLink).toHaveBeenCalledTimes(2)
  link.dispatchEvent(new MouseEvent('auxclick',{button:2,bubbles:true,cancelable:true}));expect(openLink).toHaveBeenCalledTimes(2)
 }finally{app.unmount();root.remove()}
})
