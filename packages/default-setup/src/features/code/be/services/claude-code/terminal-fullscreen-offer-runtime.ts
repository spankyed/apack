/** The original renderer owns eligibility, dismissal and the optional restart. */
export const claudeTerminalFullscreenOfferRuntime = String.raw`
function nativeFullscreenOffer(n){
 const binding=originalContext??n.runtime.ey(),kind='fullscreen_upsell';
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')return;
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)return;
 const store=binding.toolContext(new AbortController()).dialogStore,items=store.getState().open.filter(item=>item.kind===kind);
 if(items.length!==1){dialogRevisions.delete(kind);return;}
 const item=items[0];
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native fullscreen offer traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name==='Xte'){
   let hash=composerFunctionHashes.get(fiber.type);
   if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,hash);}
   if(hash!=='e15b6847f6ed9a498e02bc89259fa406476e829d90bf890bda7913141b4d567f')throw Error('Native fullscreen offer producer changed');
   const answer=fiber.memoizedProps?.answer;
   if(typeof answer==='function'){
    const rows=fiber.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===15&&row[14]?.props?.children===row[11]);
    if(rows?.length===1){
     const row=rows[0],control=row[11]?.props?.children?.[1]?.props;
     if(control&&row[14].props.onCancel===control.onCancel&&typeof control.onConfirm==='function'&&typeof control.onCancel==='function'
       &&typeof control.confirmLabel==='string'&&typeof control.cancelLabel==='string'&&Array.isArray(row[6]?.props?.children))
      matches.push({row,control,answer});
    }
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)return;
 const {row,control,answer}=matches[0],{onConfirm,onCancel}=control;
 let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision.sessionId!==sessionId||revision.answer!==answer||revision.onConfirm!==onConfirm||revision.onCancel!==onCancel)
  revision={item,sessionId,answer,onConfirm,onCancel,revision:randomUUID()};
 dialogRevisions.set(kind,revision);
 return {...revision,row,control,store};
}
async function projectNativeFullscreenOffer(n,d){
 const title=await nativeGenericPermissionText(n,d.row[14].props.title),paragraphs=[];
 for(const child of d.row[6].props.children){const text=await nativeGenericPermissionText(n,child);if(text)paragraphs.push(text);}
 const current=nativeFullscreenOffer(n);
 if(!current||current.item!==d.item||current.revision!==d.revision)return null;
 if(!title||paragraphs.length!==3)throw Error('Native fullscreen offer presentation changed');
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'fullscreen_upsell',title,paragraphs,
  choices:[{value:'fullscreen_accept',label:d.control.confirmLabel},{value:'fullscreen_dismiss',label:d.control.cancelLabel}]};
}
function answerNativeFullscreenOffer(n,request){
 const d=nativeFullscreenOffer(n);
 if(!d||d.item.id!==request.id||d.revision!==request.revision||d.sessionId!==request.session_id)throw Error('Native fullscreen offer changed or expired');
 (request.decision==='fullscreen_accept'?d.onConfirm:d.onCancel)();
 if(d.store.getState().open.includes(d.item))throw Error('Native fullscreen offer did not accept the decision');
 dialogRevisions.delete('fullscreen_upsell');
}
`
