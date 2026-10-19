/** Source-bound composer inputs from the pinned original producers, never inferred from app labels. */
export const claudeTerminalComposerRuntime = String.raw`const composerFrames=new Map(),composerSeen=new Map(),composerClocks=new Map(),composerFunctionHashes=new WeakMap(),composerFactoryIds=new WeakMap();
let composerFactorySequence=0;
const composerSignatures={
 vtr:{component:'Spinner',hash:'303032488d6858b55a00a4718644628955b5beadbdf79e9161609313fe9ee5e2',slot:21},
 OH:{component:'SessionMode',hash:'102949adbd5d8849d10b15d5d7bc64d7e98466e46a23fa0ad704c86ae02b8b8a',slot:4},
 vY:{component:'PromptHint',hash:'0e01508dc7198c1522cbf5658ec5b6b83f4ce8068ddeee35694dc501b6103dd5'}
};
function isComposerComponent(component){return component==='Spinner'||component==='SessionMode'||component==='PromptHint';}
function nativeComposerInputs(n){
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current,pending=root?[root]:[],seen=new Set(),result=new Map();
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native composer traversal exceeded bound');seen.add(fiber);
  const type=fiber.type,spec=typeof type==='function'&&Object.hasOwn(composerSignatures,type.name)?composerSignatures[type.name]:undefined;
  if(spec){
   let hash=composerFunctionHashes.get(type);if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(type)).digest('hex');composerFunctionHashes.set(type,hash);}
   if(hash===spec.hash){
    const hooks=new Set();let hook=fiber.memoizedState;
    while(hook&&typeof hook==='object'&&!hooks.has(hook)){
     if(hooks.size>=128)throw Error('Native composer producer hook bound');hooks.add(hook);
     const value=hook.memoizedState,candidates=[value,...(Array.isArray(value)?value.slice(0,4):[])];
     for(const input of candidates)if(input&&typeof input==='object'&&input.component===spec.component&&input.surface==='terminal'&&typeof input.requestId==='string'&&input.requestId.length>0&&input.requestId.length<=256&&input.props&&typeof input.props==='object'){
      const raw=JSON.stringify(input.props);if(raw.length>65536)throw Error('Native composer props exceed limit');
      const factory=spec.slot===undefined?undefined:fiber.updateQueue?.memoCache?.data?.[0]?.[spec.slot];
      if(spec.slot!==undefined&&typeof factory!=='function')throw Error('Original composer default renderer cache changed');
      let factoryId=0;if(factory){if(!composerFactoryIds.has(factory))composerFactoryIds.set(factory,++composerFactorySequence);factoryId=composerFactoryIds.get(factory);}
      const key=JSON.stringify([spec.component,input.requestId]),fingerprint=createHash('sha256').update(JSON.stringify([raw,factoryId])).digest('hex'),prior=result.get(key);
      if(prior&&prior.fingerprint!==fingerprint)throw Error('Ambiguous original composer input');
      result.set(key,{component:spec.component,id:input.requestId,input,props:JSON.parse(raw),factory,fingerprint});
      if(result.size>32)throw Error('Native composer instance limit');
     }
     hook=hook.next;
    }
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 return result;
}
function nativeComposerFacts(n,client,component,id,inputs=nativeComposerInputs(n)){
 const source=inputs.get(JSON.stringify([component,id]));if(!source)return;
 if(component==='Spinner'){
  const view=nativeViewFacts(n,originalContext??n.runtime.ey(),new AbortController()).view;
  const expected=view.kind==='main'?n.questionOptions.Ze():view.taskId;
  if(id!==expected&&!(view.kind==='main'&&id==='main'))return;
 }
 const props={...source.props};
 if(component==='Spinner'&&props.mode==='tool-input')props.mode='tool-use';
 if(component==='PromptHint'&&edits.has(client))props.isDraft=edits.get(client).box.text.length>0;
 const fingerprint=createHash('sha256').update(JSON.stringify([source.fingerprint,props])).digest('hex');
 return {...source,props,fingerprint};
}
function nativeComposerList(n,client,inputs=nativeComposerInputs(n)){
 const result=[];for(const source of inputs.values()){const facts=nativeComposerFacts(n,client,source.component,source.id,inputs);if(facts)result.push({component:facts.component,id:facts.id,revision:facts.fingerprint});}return result;
}
function currentComposerAction(n,request){
 if(!isComposerComponent(request.component))return;
 const frame=composerFrames.get(JSON.stringify([request.client_id,request.component,request.instance_id]));
 const facts=frame&&nativeComposerFacts(n,request.client_id,request.component,request.instance_id);
 if(!facts||facts.fingerprint!==frame.fingerprint)throw Error('Native composer source changed or expired');
}
function refreshNativeComposer(n){
 if(!clients.size)return;
 let inputs;try{inputs=nativeComposerInputs(n);}catch{inputs=new Map();}
 for(const client of clients){
  if(!clientViewCurrent(n,client))continue;
  const list=nativeComposerList(n,client,inputs),next=new Map(list.map(item=>[JSON.stringify([item.component,item.id]),item.revision])),prior=composerSeen.get(client),changed=[];
  for(const [key,revision] of next)if(!prior||prior.get(key)!==revision){const [component,id]=JSON.parse(key);changed.push({surface:'desktop',component,instance_id:id});n.nativeClients.suspend(client,component,id);}
  for(const key of prior?.keys()??[])if(!next.has(key)){const [component,id]=JSON.parse(key);n.nativeClients.release(client,component,id);composerFrames.delete(JSON.stringify([client,component,id]));changed.push({surface:'desktop',component,instance_id:id});}
  const second=Math.floor(Date.now()/1000);if(composerClocks.get(client)!==second){composerClocks.set(client,second);for(const item of list)if(item.component==='Spinner'&&!changed.some(value=>value.component===item.component&&value.instance_id===item.id))changed.push({surface:'desktop',component:item.component,instance_id:item.id});}
  composerSeen.set(client,next);
  if(changed.length)publish({type:'system',subtype:'ui_invalidate',event:'ui.render',composer_placements:true,client_id:client,instances:changed});
 }
}
async function formatNativeComposer(n,facts,props,options){
 options.signal?.throwIfAborted();
 // Desktop has no terminal tail/pill layout. Paint its hint with the original dim Text and live theme.
 const element=facts.component==='PromptHint'
  ? n.jsx.e(n.terminalComponents.n,{dimColor:true,children:typeof props.hint==='string'?props.hint:''})
  : facts.factory({...facts.input,surface:'desktop',props});
 // The other placements delegate to their source-verified JSX factories. The export store owns no live tasks.
 if(element===null||element===false)return '';const theme=nativeThemeProvider(n);
 const tree=n.jsx.e(n.appProvider.d_,{session:n.questionOptions.j(),keybindings:false,children:n.jsx.e(theme.type,{value:theme.value,children:element})});
 const text=await n.staticRender.v6e(tree,{columns:Math.max(20,Math.min(240,options.columns??process.stdout.columns??80))});
 options.signal?.throwIfAborted();if(typeof text!=='string'||text.length>65536)throw Error('Native composer drawing exceeds limit');return text;
}`
