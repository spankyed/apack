/** Read the original external-import disclosure and guarded cancel-first decision control. */
export const claudeTerminalSettingsConsentRuntime = String.raw`
function nativeSettingsConsentControl(match){
 const p=match.props,caches=match.fiber.updateQueue?.memoCache?.data?.filter(cache=>Array.isArray(cache)&&cache.length===37);
 const cache=caches?.length===1?caches[0]:undefined,modal=cache?.[27],view=cache?.[36],props=modal?.props;
 const hash=fn=>typeof fn==='function'?createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex'):undefined;
 if(p.isStandaloneDialog!==undefined||typeof p.onDone!=='function'||!Array.isArray(p.externalIncludes)||p.externalIncludes.length>4096||!cache||cache[11]!==p.onDone||cache[5]!==p.externalIncludes||!['3b9100071fc0198132bcb81b4006df24fa2c5023055370b698bd4fc1ebae8a70','c7f64fe8a40a3b2d4a2c77c1de6de59efb101099f96aa474307a5802b93dd777'].includes(hash(modal?.type))||typeof cache[16]!=='function'||view?.props?.onCancel!==cache[16]||!Array.isArray(view.props.children)||props?.cancelFirst!==true||props.focus!=='cancel'||props.refuseInput!==cache[4]||typeof props.refuseInput!=='function'||props.openedAt!==cache[24]||props.onConfirm!==cache[20]||props.onCancel!==cache[21])throw Error('Native external-import consent changed');
 const pending=[match.fiber.child],seen=new Set(),matches=[];
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native consent traversal exceeded bound');seen.add(fiber);
  if(fiber.type===modal.type&&fiber.memoizedProps===props)matches.push(fiber);
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(matches.length!==1)throw Error('Native consent control is not uniquely mounted');
 const pickerCaches=matches[0].updateQueue?.memoCache?.data?.filter(value=>Array.isArray(value)&&value.length===32),pickerCache=pickerCaches?.length===1?pickerCaches[0]:undefined,picker=pickerCache?.[31],controls=picker?.props;
 if(!['e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5','0b150b8f2b7cf9d0b6626c3c9bb48f124bfa8e660bd23a8d9251e24fdfd699e3'].includes(hash(picker?.type))||pickerCache[22]!==props.onCancel||pickerCache[23]!==props.onConfirm||controls.onChange!==pickerCache[24]||controls.onCancel!==props.onCancel||controls.options!==pickerCache[21]||controls.defaultFocusValue!=='cancel'||controls.options?.length!==2||controls.options[0]?.value!=='cancel'||controls.options[1]?.value!=='confirm'||typeof controls.onChange!=='function'||typeof controls.isDisabled!=='boolean'||typeof props.cancelLabel!=='string')throw Error('Native consent picker changed');
 return {cache,modal,view,picker,pickerFiber:matches[0],pickerCache,controls,cancel:cache[16],cancelLabel:props.cancelLabel,title:view.props.title,disclosure:view.props.children.slice(0,3)};
}
`
