/** Auto-mode policy changes and rule-selection state remain in the original mounted callbacks. */
export const claudeTerminalAutoModeSafetyRuntime = String.raw`
const autoModeSafetySpecs={"auto_default_nudge":{"role":"nudge","wrapper":"jCo","wrapperHash":"c7a484d56957c0adf117332232a02b567657b59242042d864a691b97973af5fd","renderer":"WSe","rendererHash":"2a6dc28b03f51681cb4abed041acf275283c52da83129398812f4e96364dd7c5","title":"Make auto mode your default permission mode?"},"auto_mode_setup_review":{"role":"review","wrapper":"Vve","wrapperHash":"890edd596eaf12f38060c35cf72f77496ed437496a8e0b16191ea0fcfdfa025e","renderer":"YWt","rendererHash":"a51adcf0434842a2eabe95dd3f62a191f631770fd7d5ba361b8cf5179ea966b0","title":"Review proposed auto-mode setup"},"auto_mode_flagged_allow":{"role":"flagged","wrapper":"Kve","wrapperHash":"754c1e01c11e637dd27d08a655f7265c50fcc78e4047e25edfff1115ffefc0d2","renderer":"Iyn","rendererHash":"678153e182e122b019c14ab6666de60caebad605ecd4613b3e9d8da5fa78c76e","title":"Review rules that skip checks"}};
const autoModeSafetyPaintBudgetMs=1000;
function nativeAutoModeSafety(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native auto-mode review is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native auto-mode review session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,open=store.getState().open,item=open.length===1?open[0]:undefined,spec=Object.hasOwn(autoModeSafetySpecs,item?.kind)?autoModeSafetySpecs[item.kind]:undefined;
 if(!spec){for(const kind of Object.keys(autoModeSafetySpecs))dialogRevisions.delete(kind);return {store,sessionId};}
 const {kind,payload}=item;
 if(!payload||typeof payload!=='object'||spec.role==='nudge'&&typeof payload.currentMode!=='string'||spec.role==='review'&&(!['append','replace'].includes(payload.mode)||!['environment','allow','soft_deny','hard_deny','remove_from_permissions_allow','notes'].every(key=>Array.isArray(payload[key])&&payload[key].every(value=>typeof value==='string')))||spec.role==='flagged'&&(!Array.isArray(payload.flagged)||!payload.flagged.every(value=>typeof value==='string')||typeof payload.runId!=='string'))throw Error('Native auto-mode review payload changed');
 const fingerprint=JSON.stringify(payload);if(fingerprint.length>1048576)throw Error('Native auto-mode review payload exceeds bound');
 const checked=(fn,hash)=>{let actual=composerFunctionHashes.get(fn);if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}if(actual!==hash)throw Error('Native auto-mode review producer changed');};
 const find=(root,predicate)=>{const pending=[root],seen=new Set(),result=[];while(pending.length){const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native auto-mode review traversal exceeded bound');seen.add(fiber);if(predicate(fiber))result.push(fiber);if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);}return result;};
 const wrappers=find(n.themeRoots.ai().get(process.stdout)?.container?.current,fiber=>typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName(spec.wrapper)&&fiber.memoizedProps?.payload===payload);
 if(wrappers.length!==1){dialogRevisions.delete(kind);return {store,sessionId};}
 const wrapper=wrappers[0];checked(wrapper.type,spec.wrapperHash);
 if(typeof wrapper.memoizedProps.answer!=='function'||typeof wrapper.memoizedProps.wouldTakeAnswer==='function'&&wrapper.memoizedProps.wouldTakeAnswer()!==true)return {store,sessionId};
 const renderers=find(wrapper.child,fiber=>typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName(spec.renderer)&&(spec.role==='nudge'?fiber.memoizedProps?.currentMode===payload.currentMode:spec.role==='review'?fiber.memoizedProps?.proposal===payload:fiber.memoizedProps?.flagged===payload.flagged));
 if(renderers.length!==1)throw Error('Native auto-mode review renderer changed');
 const renderer=renderers[0];checked(renderer.type,spec.rendererHash);
 const panel=renderer.child?.memoizedProps;
 if(!panel?.children||!([spec.title,...spec.role==='flagged'?['Pick which to remove']:[]].includes(panel.title)))throw Error('Native auto-mode review frame changed');
 const selectors=find(renderer.child,fiber=>typeof fiber.type==='function'&&[nativeFunctionName('Xe'),nativeFunctionName('m2')].includes(fiber.type.name));
 if(selectors.length!==1)throw Error('Native auto-mode review selector changed');
 const selector=selectors[0],control=selector.memoizedProps,picking=selector.type.name===nativeFunctionName('m2');
 checked(selector.type,picking?'09f5854932e537fa4669f05c81095ce505b5c4144dfd5bd05e78eae4d2275d97':'e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5');
 if(typeof control?.onChange!=='function'||typeof control.onCancel!=='function'||typeof control.refuseInput!=='function'||!Array.isArray(control.options)||control.isDisabled===true||control.disableSelection===true)return {store,sessionId};
 if(picking&&(spec.role!=='flagged'||typeof control.onSubmit!=='function'||control.submitButtonText!=='Remove selected'||!Array.isArray(control.defaultValue)||!control.defaultValue.every(value=>typeof value==='string')))throw Error('Native auto-mode picker changed');
 const expected=picking?payload.flagged:spec.role==='flagged'?['all','pick','leave']:['accept','decline'];
 if(JSON.stringify(control.options.map(option=>option.value))!==JSON.stringify(expected)||picking&&control.defaultValue.some(value=>!expected.includes(value)))throw Error('Native auto-mode review choices changed');
 if(spec.role==='flagged'&&(panel.title==='Pick which to remove')!==picking)throw Error('Native auto-mode review phase changed');
 const source={selector,control,panel,picking};let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId||revision?.control!==control)revision={item,payload,fingerprint,sessionId,control,revision:randomUUID()};
 dialogRevisions.set(kind,revision);return {store,...revision,source,spec};
}
function autoModeSafetyDecision(d,value){return d.spec.role==='nudge'?({'accept':'auto_nudge_accept','decline':'auto_nudge_decline'})[value]:d.spec.role==='review'?({'accept':'auto_review_accept','decline':'auto_review_decline'})[value]:({'all':'auto_rules_all','pick':'auto_rules_pick','leave':'auto_rules_leave'})[value];}
async function projectNativeAutoModeSafety(n,d){
 let count=0;const body=node=>{if(++count>4096)throw Error('Native auto-mode review text exceeds bound');if(Array.isArray(node))return node.map(body);if(!node||typeof node!=='object')return node;if(node.type===d.source.selector.type)return null;if(node.props&&Object.hasOwn(node.props,'children'))return {...node,props:{...node.props,children:body(node.props.children)}};return node;};
 const title=await nativeGenericPermissionText(n,d.source.panel.title),paragraphs=[],text=await nativeGenericPermissionText(n,body(d.source.panel.children));if(text)paragraphs.push(text);
 if(d.spec.role==='flagged'){const guide=d.source.panel.inputGuide?.props?.children;if(!Array.isArray(guide)||!guide[0])throw Error('Native auto-mode review guidance changed');const note=await nativeGenericPermissionText(n,guide[0]);if(note)paragraphs.push(note);}
 const choices=[],rules=[];let preferredChoice;
 if(d.source.picking){for(const option of d.source.control.options)rules.push({value:option.value,label:await nativeGenericPermissionText(n,option.label)});choices.push({value:'auto_rules_submit',label:d.source.control.submitButtonText});}
 else{for(const option of d.source.control.options)choices.push({value:autoModeSafetyDecision(d,option.value),label:await nativeGenericPermissionText(n,option.label)});if(typeof d.source.control.defaultFocusValue==='string')preferredChoice=autoModeSafetyDecision(d,d.source.control.defaultFocusValue);}
 // A native decision may retire this dialog while its text is being formatted. Never publish the obsolete paint.
 const current=nativeAutoModeSafety(n);if(current.item!==d.item||current.revision!==d.revision||current.source?.control!==d.source.control)return;
 return {id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:d.item.kind,title,paragraphs,choices,...preferredChoice?{preferredChoice}:{},...d.spec.role==='flagged'?{phase:d.source.picking?'pick':'review',rules,selectedValues:d.source.picking?[...d.source.control.defaultValue]:[]}:{}};
}
async function answerNativeAutoModeSafety(n,request,abort){
 if(abort?.aborted)throw Error('Native auto-mode review update was cancelled');
 const d=nativeAutoModeSafety(n);if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native auto-mode review changed or expired');
 if(request.decision!=='auto_safety_cancel'&&d.source.control.refuseInput())throw Error('Native auto-mode review is not ready for input');
 let waitFor;
 if(request.decision==='auto_safety_cancel')d.source.control.onCancel();
 else if(request.decision==='auto_rules_select'){
  const values=request.selected_values;
  if(!d.source.picking||!Array.isArray(values)||new Set(values).size!==values.length||values.length>d.source.control.options.length||!values.every(value=>typeof value==='string'&&d.source.control.options.some(option=>option.value===value)))throw Error('Native auto-mode rule selection is unavailable');
  d.source.control.onChange(values);waitFor=current=>current.source.picking&&JSON.stringify(current.source.control.defaultValue)===JSON.stringify(values);
 }else if(request.decision==='auto_rules_submit'){
  if(!d.source.picking)throw Error('Native auto-mode picker is unavailable');d.source.control.onSubmit();
 }else{
  if(d.source.picking)throw Error('Native auto-mode choice is unavailable');
  const option=d.source.control.options.find(option=>autoModeSafetyDecision(d,option.value)===request.decision);if(!option)throw Error('Native auto-mode choice is unavailable');
  d.source.control.onChange(option.value);if(d.spec.role==='flagged'&&option.value==='pick')waitFor=current=>current.source.picking;
 }
 if(waitFor){
  const until=Date.now()+autoModeSafetyPaintBudgetMs;
  do{if(abort?.aborted)throw Error('Native auto-mode review update was cancelled');const current=nativeAutoModeSafety(n);if(current.sessionId!==d.sessionId||!current.store.getState().open.includes(d.item))throw Error('Native auto-mode review retired during update');if(current.item===d.item&&waitFor(current))return;if(Date.now()>=until)break;await new Promise(resolve=>setTimeout(resolve,10));}while(true);
  throw Error('Native auto-mode review has not confirmed the update');
 }
 if(d.store.getState().open.includes(d.item))throw Error('Native auto-mode review has not accepted the decision');
 dialogRevisions.delete(d.item.kind);
}
`
