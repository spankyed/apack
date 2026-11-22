/** The original welcome writes its seen state and owns dismissal. */
export const claudeTerminalIdeOnboardingRuntime = String.raw`
function nativeIdeOnboarding(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')return;
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)return;
 const store=binding.toolContext(new AbortController()).dialogStore,kind='ide_onboarding';
 const items=store.getState().open.filter(item=>item.kind===kind);
 if(items.length!==1){dialogRevisions.delete(kind);return;}
 const item=items[0],payload=item.payload,installation=payload?.installationStatus;
 if(installation!==null&&(!installation||typeof installation!=='object'||Array.isArray(installation)))return;
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native IDE welcome traversal exceeded bound');seen.add(fiber);
  const props=fiber.memoizedProps;
  if(typeof fiber.type==='function'&&fiber.type.name==='wwe'&&props?.installationStatus===installation&&typeof props.onDone==='function'){
   let hash=composerFunctionHashes.get(fiber.type);
   if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,hash);}
   if(hash!=='f17b62efc515f454854225aeb9d11751f914dee6e6427dc89c2995f16dfafbc7')throw Error('Native IDE welcome producer changed');
   const rows=fiber.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===22&&row[0]===props.onDone);
   if(rows?.length===1&&rows[0][18]?.props?.onCancel===props.onDone&&Array.isArray(rows[0][14]?.props?.children))
    matches.push({row:rows[0],dismiss:props.onDone});
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)return;
 const {row,dismiss}=matches[0];
 let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision.payload!==payload||revision.sessionId!==sessionId||revision.dismiss!==dismiss)
  revision={item,payload,sessionId,dismiss,revision:randomUUID()};
 dialogRevisions.set(kind,revision);
 return {...revision,row,store};
}
async function projectNativeIdeOnboarding(n,d){
 const title=await nativeGenericPermissionText(n,d.row[9]),paragraphs=[];
 const subtitle=d.row[18].props.subtitle;if(typeof subtitle==='string'&&subtitle)paragraphs.push(subtitle);
 for(const node of d.row[14].props.children){
  const text=await nativeGenericPermissionText(n,node);if(text)paragraphs.push(text);
 }
 if(!title||paragraphs.length===0)throw Error('Native IDE welcome presentation changed');
 const current=nativeIdeOnboarding(n);
 if(!current||current.item!==d.item||current.revision!==d.revision)return null;
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'ide_onboarding',title,paragraphs,choices:[{value:'ide_welcome_dismiss',label:'Continue'}]};
}
function answerNativeIdeOnboarding(n,request){
 const d=nativeIdeOnboarding(n);
 if(!d||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native IDE welcome changed or expired');
 d.dismiss();
 if(d.store.getState().open.includes(d.item))throw Error('Native IDE welcome did not retire');
 dialogRevisions.delete('ide_onboarding');
}
`
