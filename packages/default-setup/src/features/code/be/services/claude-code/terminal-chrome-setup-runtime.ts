/** Original Chrome setup owns installation, phase transitions, policy and native input grace. */
export const claudeTerminalChromeSetupRuntime = String.raw`
function nativeChromeSetup(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native Chrome setup is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native Chrome setup session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,open=store.getState().open,item=open.length===1?open[0]:undefined;
 if(!['chrome_install_upsell','chrome_install_setup'].includes(item?.kind)){for(const kind of ['chrome_install_upsell','chrome_install_setup'])dialogRevisions.delete(kind);return {store,sessionId};}
 const {kind,payload}=item,setup=kind==='chrome_install_setup';
 if(!payload||typeof payload!=='object'||setup&&(!['waiting_install','connecting','stalled','connected','failed'].includes(payload.phase)||typeof payload.installPageOpened!=='boolean'))throw Error('Native Chrome setup payload changed');
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native Chrome setup producer changed');};
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native Chrome setup traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName(setup?'Lst':'sCe')&&fiber.memoizedProps?.payload===payload){
   checked(fiber.type,setup?'73991c6e58be63f833bd28c99cb9d1475bf4d61c9506e61c601135dad12e4850':'1881b29f0df68643fbbddd89ecc94dda427c4ac21e596c4d73aadf6494b7e411');
   if(typeof fiber.memoizedProps.answer!=='function'||typeof fiber.memoizedProps.wouldTakeAnswer==='function'&&fiber.memoizedProps.wouldTakeAnswer()!==true)return {store,sessionId};
   const panel=fiber.child?.memoizedProps;
   if(panel?.title!==(setup?'Setting up Claude in Chrome':'Claude wants to use your browser')||!panel.children)throw Error('Native Chrome setup frame changed');
   const children=[fiber.child],visited=new Set(),controls=[];
   while(children.length){
    const child=children.pop();if(!child||visited.has(child))continue;if(visited.size>=2048)throw Error('Native Chrome setup controls exceeded bound');visited.add(child);
    if(typeof child.type==='function'&&child.type.name===nativeFunctionName('Xe')){checked(child.type,'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5');controls.push({type:child.type,props:child.memoizedProps});}
    if(child.sibling)children.push(child.sibling);if(child.child)children.push(child.child);
   }
   if(controls.length!==1)throw Error('Native Chrome setup presentation changed');
   const selector=controls[0],control=selector.props;
   if(typeof control.onChange!=='function'||typeof control.onCancel!=='function'||typeof control.refuseInput!=='function'||!Array.isArray(control.options))throw Error('Native Chrome setup control changed');
   if(control.isDisabled===true||control.disableSelection===true)return {store,sessionId};
   const expected=!setup?['install','not_now','dont_ask_again']:payload.phase==='connected'?['continue','skip']:payload.phase==='stalled'?['keep_waiting','skip']:['skip'];
   if(JSON.stringify(control.options.map(option=>option.value))!==JSON.stringify(expected))throw Error('Native Chrome setup choices changed');
   matches.push({selector,control,panel});
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)return {store,sessionId};
 const source=matches[0],fingerprint=JSON.stringify(payload);if(fingerprint.length>65536)throw Error('Native Chrome setup payload exceeds bound');let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId||revision?.control!==source.control)revision={item,payload,fingerprint,sessionId,control:source.control,revision:randomUUID()};
 dialogRevisions.set(kind,revision);return {store,...revision,source};
}
async function projectNativeChromeSetup(n,d){
 // Remove the original interactive selector before static text rendering; its callbacks remain mounted.
 let count=0;const body=node=>{if(++count>1024)throw Error('Native Chrome setup text exceeds bound');if(Array.isArray(node))return node.map(body);if(!node||typeof node!=='object')return node;if(node.type===d.source.selector.type)return null;if(node.props&&Object.hasOwn(node.props,'children'))return {...node,props:{...node.props,children:body(node.props.children)}};return node;};
 const title=await nativeGenericPermissionText(n,d.source.panel.title),text=await nativeGenericPermissionText(n,body(d.source.panel.children)),choices=[];
 const decisions={'install':'chrome_install','not_now':'chrome_not_now','dont_ask_again':'chrome_never','continue':'chrome_continue','keep_waiting':'chrome_wait','skip':'chrome_skip'};
 for(const option of d.source.control.options){const choice={value:decisions[option.value],label:await nativeGenericPermissionText(n,option.label)};if(option.description!==undefined)choice.description=await nativeGenericPermissionText(n,option.description);choices.push(choice);}
 const current=nativeChromeSetup(n);if(current.item!==d.item||current.revision!==d.revision||current.source?.control!==d.source.control)throw Error('Native Chrome setup changed while formatting');
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:d.item.kind,title,paragraphs:text?[text]:[],choices,...d.item.kind==='chrome_install_setup'?{phase:d.payload.phase,installPageOpened:d.payload.installPageOpened}:{preferredChoice:'chrome_not_now'}};
}
function answerNativeChromeSetup(n,request){
 const d=nativeChromeSetup(n);if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native Chrome setup changed or expired');
 if(request.decision==='chrome_cancel')d.source.control.onCancel();
 else{const value=({'chrome_install':'install','chrome_not_now':'not_now','chrome_never':'dont_ask_again','chrome_continue':'continue','chrome_wait':'keep_waiting','chrome_skip':'skip'})[request.decision];if(!value||!d.source.control.options.some(option=>option.value===value))throw Error('Native Chrome setup choice is unavailable');d.source.control.onChange(value);}
 // Native callbacks enforce their original input grace and retain a refused request.
 if(d.store.getState().open.includes(d.item))throw Error('Native Chrome setup has not accepted the decision');
 dialogRevisions.delete(d.item.kind);
}
`
