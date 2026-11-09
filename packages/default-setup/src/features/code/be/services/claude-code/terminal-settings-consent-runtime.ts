/** Read the original external-import disclosure and guarded cancel-first decision control. */
export const claudeTerminalSettingsConsentRuntime = String.raw`
function nativeSettingsConsentControl(match){
 const p=match.props,caches=match.fiber.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===37);
 const cache=caches?.length===1?caches[0]:undefined,modal=cache?.[27],view=cache?.[36],props=modal?.props;
 const hash=fn=>typeof fn==='function'?createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex'):undefined;
 if(p.isStandaloneDialog!==undefined||typeof p.onDone!=='function'||!Array.isArray(p.externalIncludes)||p.externalIncludes.length>4096||!cache||cache[11]!==p.onDone||cache[5]!==p.externalIncludes||!['3b9100071fc0198132bcb81b4006df24fa2c5023055370b698bd4fc1ebae8a70','c7f64fe8a40a3b2d4a2c77c1de6de59efb101099f96aa474307a5802b93dd777'].includes(hash(modal?.type))||typeof cache[16]!=='function'||view?.props?.onCancel!==cache[16]||!Array.isArray(view.props.children)||props?.cancelFirst!==true||props.focus!=='cancel'||props.refuseInput!==cache[4]||typeof props.refuseInput!=='function'||props.openedAt!==cache[24]||props.onConfirm!==cache[20]||props.onCancel!==cache[21])throw Error('Native external-import consent changed');
 const security=cache[18],securityChildren=security?.props?.children;
 if(view.props.children[2]!==security||!Array.isArray(securityChildren)||securityChildren.length>16)throw Error('Native consent security disclosure changed');
 const links=securityChildren.filter(child=>typeof child?.props?.url==='string').map(child=>child.props.url);
 if(links.length!==1||links[0]!=='https://code.claude.com/docs/en/security')throw Error('Native consent security link changed');
 const pending=[match.fiber.child],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native consent traversal exceeded bound');seen.add(fiber);
  if(fiber.type===modal.type&&fiber.memoizedProps===props)matches.push(fiber);
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)throw Error('Native consent control is not uniquely mounted');
 const pickerCaches=matches[0].updateQueue?.memoCache?.data?.filter(value=>Array.isArray(value)&&value.length===32),pickerCache=pickerCaches?.length===1?pickerCaches[0]:undefined,picker=pickerCache?.[31],controls=picker?.props;
 const typedElement=pickerCache?.[7];
 if(['bb15cb5716678ee56d91a55e001ec3c3c2b1e692a8ae1d4d481f57555f729375','1ab09c3b658193cdd1ed26d457a97d40a7d6480fef6f296b4c813036ef70bc9a'].includes(hash(typedElement?.type))){
  const tp=typedElement.props,stack=[matches[0].child],visited=new Set(),typedFibers=[];
  while(stack.length){const fiber=stack.pop();if(!fiber||visited.has(fiber))continue;if(visited.size>=4096)throw Error('Native typed consent traversal exceeded bound');visited.add(fiber);if(fiber.type===typedElement.type&&fiber.memoizedProps===tp)typedFibers.push(fiber);if(fiber.sibling)stack.push(fiber.sibling);if(fiber.child)stack.push(fiber.child);}
  if(typedFibers.length>1)throw Error('Native typed consent is not uniquely mounted');
  if(typedFibers.length===1){
  const typedFiber=typedFibers[0],tc=typedFiber.updateQueue?.memoCache?.data?.filter(value=>Array.isArray(value)&&value.length===43),c=tc?.length===1?tc[0]:undefined,root=c?.[42],prompt=c?.[32],prefix='Enter y/n: ';
  if(!c||tp.onConfirm!==props.onConfirm||tp.onCancel!==props.onCancel||tp.refuseInput!==props.refuseInput||tp.openedAt!==props.openedAt||tp.windowMs!==pickerCache[6]||tp.confirmLabel!==props.confirmLabel||tp.cancelLabel!==props.cancelLabel||c[0]!==tp.refuseInput||c[3]!==tp.refuseInput||c[6]!==tp.onCancel||c[7]!==tp.onConfirm||c[8]!==c[2]||typeof c[2]!=='function'||typeof c[10]!=='function'||c[16]!==c[10]||typeof c[17]!=='function'||root?.props?.onKeyDown!==c[17]||c[37]!==c[17]||typeof prompt!=='string'||!prompt.startsWith(prefix)||prompt.length>16395||c[18]!==prompt||c[33]?.props?.children!==prompt||c[12]!==tp.onCancel||c[11]?.current!==prompt.slice(prefix.length))throw Error('Native typed consent callbacks changed');
  return {cache,modal,view,links,picker:typedElement,pickerFiber:matches[0],pickerCache,typed:{fiber:typedFiber,props:tp,cache:c,root,submit:c[10],keyDown:c[17],value:prompt.slice(prefix.length),label:prefix.trimEnd(),error:c[31]},cancelLabel:props.cancelLabel,title:view.props.title,disclosure:[...view.props.children.slice(0,3),c[25],c[29]]};
  }
 }
 if(!['e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5','0b150b8f2b7cf9d0b6626c3c9bb48f124bfa8e660bd23a8d9251e24fdfd699e3'].includes(hash(picker?.type))||pickerCache[22]!==props.onCancel||pickerCache[23]!==props.onConfirm||controls.onChange!==pickerCache[24]||controls.onCancel!==props.onCancel||controls.options!==pickerCache[21]||controls.defaultFocusValue!=='cancel'||controls.options?.length!==2||controls.options[0]?.value!=='cancel'||controls.options[1]?.value!=='confirm'||typeof controls.onChange!=='function'||typeof controls.isDisabled!=='boolean'||typeof props.cancelLabel!=='string')throw Error('Native consent picker changed');
 return {cache,modal,view,links,picker,pickerFiber:matches[0],pickerCache,controls,cancel:cache[16],cancelLabel:props.cancelLabel,title:view.props.title,disclosure:view.props.children.slice(0,3)};
}

async function readNativeSettingsTypedConsent(n,entry,signal,owner,match,control){
 const typed=control.typed,text=async value=>{const result=await awaitNativeSettingsReading(nativeGenericPermissionText(n,value),signal);if(typeof result!=='string'||result.length>65536)throw Error('Native typed consent text exceeded bound');return result;};
 const description=await text(control.disclosure),problem=typed.error?await text(typed.error):undefined;
 const snapshot={kind:'form',title:control.title,description,submitLabel:'Submit',fields:[{key:'answer',label:typed.label,value:typed.value}],consent:{cancelLabel:control.cancelLabel,focusField:'answer',links:control.links,...problem?{problem}:{}}};
 signal?.throwIfAborted();entry.current();const current=nativeSettingsConfig(n,entry),live=currentNativeSettingsFiber(current.owner,typed.fiber);
 if(entry.closed||entry.answered||!sameNativeSettingsFiber(current.owner,owner)||currentNativeSettingsFiber(current.owner,match.fiber).memoizedProps!==match.props||live.memoizedProps!==typed.props||!live.updateQueue?.memoCache?.data?.includes(typed.cache)||typed.cache[42]!==typed.root||typed.cache[10]!==typed.submit||typed.cache[17]!==typed.keyDown||control.cache[27]!==control.modal||control.cache[36]!==control.view||control.pickerCache[7]!==control.picker)throw Error('Native typed consent changed while reading');
 return {snapshot,revision:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),owner:current.owner,fiber:currentNativeSettingsFiber(current.owner,match.fiber),props:match.props,consentControl:control,typedConsent:typed,actions:{onSubmit:typed.submit,onCancel:()=>typed.keyDown({key:'escape',name:'escape',preventDefault(){}})}};
}
`
