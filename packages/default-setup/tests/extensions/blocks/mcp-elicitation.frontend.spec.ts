import {afterEach,expect,it,vi} from 'vitest';
import {createApp,nextTick,type App} from 'vue';
import McpElicitationInput from '#extensions/blocks/input/McpElicitationInput.vue';
import {parseMcpElicitationForm} from '#features/code/common/mcp-elicitation-form.ts';
let app:App|undefined;
afterEach(()=>{app?.unmount();document.body.replaceChildren()});
function mount(schema:unknown,extra:Record<string,unknown>={}){const root=document.createElement('div');document.body.append(root);const submit=vi.fn();app=createApp(McpElicitationInput,{form:parseMcpElicitationForm(schema),onSubmit:submit,...extra});app.mount(root);return{root,submit}}
it('renders titled enums, multiselects and false/zero defaults, and submits typed content',async()=>{
 const{root,submit}=mount({type:'object',properties:{flag:{type:'boolean',default:false},count:{type:'integer',default:0},choice:{type:'string',oneOf:[{const:'a',title:'Alpha'}],default:'a'},tags:{type:'array',items:{anyOf:[{const:'b',title:'Beta'}]},default:['b']}},required:['flag','count','choice','tags']});
 expect(root.textContent).toContain('Alpha');expect(root.textContent).toContain('Beta');expect(root.querySelectorAll('input[type=checkbox]:checked')).toHaveLength(1);
 root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await nextTick();expect(submit).toHaveBeenCalledWith({buttonId:'accept',content:{flag:false,count:0,choice:'a',tags:['b']}});
});
it('keeps invalid data local, shows errors, and accepts corrected input',async()=>{
 const{root,submit}=mount({type:'object',properties:{email:{type:'string',format:'email'}},required:['email']});
 const input=root.querySelector('input')!;input.value='not-an-email';input.dispatchEvent(new Event('input',{bubbles:true}));root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await nextTick();expect(submit).not.toHaveBeenCalled();expect(root.querySelector('[role=alert]')?.textContent).toBeTruthy();
 input.value='fixture@example.com';input.dispatchEvent(new Event('input',{bubbles:true}));root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await nextTick();expect(submit).toHaveBeenCalledWith({buttonId:'accept',content:{email:'fixture@example.com'}});
});
it('sends decline/cancel independently of invalid required fields without submitting content',async()=>{
 const{root,submit}=mount({type:'object',properties:{name:{type:'string'}},required:['name']});
 (root.querySelectorAll('button')[1] as HTMLButtonElement).click();(root.querySelectorAll('button')[2] as HTMLButtonElement).click();await nextTick();expect(submit.mock.calls.map(args=>args[0])).toEqual([{buttonId:'decline'},{buttonId:'cancel'}]);
});
it('renders untrusted labels as text and does not read inherited field values/errors',async()=>{
 const{root,submit}=mount({type:'object',properties:{toString:{type:'string',title:'<img src=x onerror=alert(1)>'}}});
 expect(root.querySelector('img')).toBeNull();expect((root.querySelector('input') as HTMLInputElement).value).toBe('');expect(root.querySelector('[role=alert]')).toBeNull();
 root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await nextTick();expect(submit).toHaveBeenCalledWith({buttonId:'accept',content:{}});
});
it('disables native input and emits no acceptance after retirement',async()=>{
 const{root,submit}=mount({type:'object',properties:{}},{disabled:true,response:{cancelled:true}});expect(root.textContent).toContain('Cancelled');expect(root.querySelector('button')).toBeNull();root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await nextTick();expect(submit).not.toHaveBeenCalled();
});

it('retains typed submitted values and enum labels in the retired response display',()=>{
 const{root}=mount({type:'object',properties:{flag:{type:'boolean'},count:{type:'integer'},choice:{type:'string',enum:['a'],enumNames:['Alpha']}}},{disabled:true,response:{buttonId:'accept',content:{flag:false,count:0,choice:'a'}}});expect(root.textContent).toContain('No');expect(root.textContent).toContain('0');expect(root.textContent).toContain('Alpha');expect(root.querySelector('button')).toBeNull();
});
