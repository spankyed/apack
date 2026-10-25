/** Original recommendation controls retain Lo focus, Fm suppression and the native unanswered timer. */
export const claudeTerminalLspRecommendationRuntime = String.raw`
function nativeLspRecommendationControl(n,d){
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 const checked=(fn,hash)=>{
  let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}
  if(actual!==hash)throw Error('Native LSP recommendation producer changed');
 };
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native recommendation traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('GCo')&&fiber.memoizedProps?.payload===d.payload){
   checked(fiber.type,'3b940676db580289927110c44fd7c74c3669ebd556127ddc0fe5b74d759fd754');
   if(typeof fiber.memoizedProps.wouldTakeAnswer!=='function'||fiber.memoizedProps.wouldTakeAnswer()!==true)return;
   const children=[fiber.child],visited=new Set();
   while(children.length){
    const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native recommendation controls exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name===nativeFunctionName('dA')){
     checked(child.type,'d9c6180f635894ac408460cf32f79529e1cb94fbf2badb35fe134315c286e142');
     const panel=child.memoizedProps;
     if(panel?.title!=='LSP plugin recommendation'||panel.pluginName!==d.payload.pluginName||panel.marketplaceName!==d.payload.marketplaceName||panel.unansweredResponse!=='timeout')throw Error('Native recommendation presentation changed');
     const controls=[child.child],controlSeen=new Set();
     while(controls.length){
      const c=controls.pop();if(!c||controlSeen.has(c))continue;if(controlSeen.size>=1024)throw Error('Native recommendation selector exceeded bound');controlSeen.add(c);
      const props=c.memoizedProps;
      if(typeof c.type==='function'&&c.type.name===nativeFunctionName('Xe')&&Array.isArray(props?.options)&&typeof props.onChange==='function'&&typeof props.onCancel==='function'){
       checked(c.type,'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5');
       if(JSON.stringify(props.options.map(option=>option.value))!==JSON.stringify(['yes','no','never','disable']))throw Error('Native recommendation choices changed');
       matches.push({panel,control:props});
      }
      if(c.sibling)controls.push(c.sibling);if(c.child)controls.push(c.child);
     }
    }
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 return matches.length===1&&matches[0].control.isDisabled===false?matches[0]:undefined;
}
function nativeLspRecommendation(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native recommendation is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native recommendation session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,open=store.getState().open;
 const item=open.length===1?open[0]:undefined,payload=item?.payload,kind='lsp_recommendation';
 if(item?.kind!==kind||!['pluginName','marketplaceName','fileExtension'].every(key=>typeof payload?.[key]==='string'&&payload[key].length<=16000)||payload.pluginDescription!==undefined&&(typeof payload.pluginDescription!=='string'||payload.pluginDescription.length>16000)){
  dialogRevisions.delete(kind);return {store,sessionId};
 }
 const fingerprint=JSON.stringify(payload);let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId)revision={item,payload,fingerprint,sessionId,revision:randomUUID()};
 dialogRevisions.set(kind,revision);
 const result={store,...revision},source=nativeLspRecommendationControl(n,result);
 return source?{...result,source}:{store,sessionId};
}
async function projectNativeLspRecommendation(n,d){
 const choices=[];
 for(const option of d.source.control.options)choices.push({value:option.value,label:await nativeGenericPermissionText(n,option.label)});
 const p=d.payload,paragraphs=['LSP provides code intelligence like go-to-definition and error checking','Plugin: '+p.pluginName,'Marketplace: '+p.marketplaceName,'Triggered by: '+p.fileExtension+' files',...(p.pluginDescription?[p.pluginDescription]:[]),'Would you like to install this LSP plugin?'];
 const current=nativeLspRecommendation(n);
 if(current.item!==d.item||current.revision!==d.revision||current.source?.control!==d.source.control)throw Error('Native recommendation changed while formatting');
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'lsp_recommendation',title:d.source.panel.title,paragraphs,choices};
}
function answerNativeLspRecommendation(n,request){
 const d=nativeLspRecommendation(n);
 if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native recommendation changed or expired');
 if(!d.source.control.options.some(option=>option.value===request.decision))throw Error('Invalid native recommendation decision');
 d.source.control.onChange(request.decision);
 if(d.store.getState().open.includes(d.item))throw Error('Native recommendation did not accept the decision');
 dialogRevisions.delete('lsp_recommendation');
}
`
