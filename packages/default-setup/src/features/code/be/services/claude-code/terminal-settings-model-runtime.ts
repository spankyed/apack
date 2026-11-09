/** Project original Config Model controls; source callbacks retain admission and effort normalization. */
export const claudeTerminalSettingsModelRuntime = String.raw`
function nativeSettingsModelControl(match,standalone=false){
 const p=match.props,frame=match.fiber.child?.memoizedProps;
 const root=standalone&&frame?.color==='permission'?frame.children?.props:standalone?undefined:frame;
 const hash=fn=>typeof fn==='function'?createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex'):undefined;
 if((standalone?(p.isStandaloneCommand!==true||typeof p.onSetDefault!=='function'):(p.isStandaloneCommand===true||p.onSetDefault!==undefined))||typeof p.onSelect!=='function'||typeof p.onCancel!=='function'||!root||!['b615d1c7963a03e0010d1ae45108ff0bf87bffadb4a8ec8639b809754e687b49','09e2e0734b5e0da805593b8a45464256b7760e84204a62141ca8ca70f62cb566'].includes(hash(root.onKeyDown)))throw Error('Native Model root changed');
 const groups=root.children?.[0]?.props?.children,picker=groups?.[1]?.props?.children?.[1]?.props?.children?.[0];
 if(!picker||!['e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5','0b150b8f2b7cf9d0b6626c3c9bb48f124bfa8e660bd23a8d9251e24fdfd699e3'].includes(hash(picker.type)))throw Error('Native Model picker changed');
 const controls=picker.props;
 if(!Array.isArray(controls?.options)||controls.options.length>256||typeof controls.onFocus!=='function'||typeof controls.onChange!=='function'||typeof controls.onCancel!=='function'||controls.isDisabled!==false)throw Error('Native Model search or controls changed');
 const hooks=new Set(),states=[],effort=[];let hook=match.fiber.memoizedState;
 while(hook){
  if(hooks.has(hook)||hooks.size>=512)throw Error('Native Model hooks exceeded bound');hooks.add(hook);
  const state=hook.memoizedState;if(Array.isArray(state))states.push(state);const callback=Array.isArray(state)?state[0]:undefined,deps=Array.isArray(state)?state[1]:undefined;
  if(['4b7c3cb9a810ed389a53e1ec6b12034927df01c937b11d429b2bc7cec5aa7212','2bae149d18b9a99477ae1c8cb7fd72b19cbcc28c9f8258104aae644e911261cb'].includes(hash(callback))){
   if(!Array.isArray(deps)||deps.length!==4||deps[0]!==controls.options||hash(deps[1])!=='56513689669af7d6bbc5e14de1319ed6c48d14a2f545d7ca66caa4b082bd9d41')throw Error('Native Model effort callbacks changed');
   effort.push({callback,current:deps[1],setEffort:deps[3]});
  }
  hook=hook.next;
 }
 if(effort.length!==1)throw Error('Native Model effort is not uniquely supported');
 const setters=states.filter(state=>state[0]===effort[0].setEffort);
 if(setters.length!==1||hash(setters[0][0])!=='614e5f6e400f38931145513694025965d78b7003e49433d66ae369c535e3ee47'||setters[0][1]?.length!==1)throw Error('Native Model effort state changed');
 const getters=states.filter(state=>hash(state[0])==='56513689669af7d6bbc5e14de1319ed6c48d14a2f545d7ca66caa4b082bd9d41'&&state[1]?.length===1&&state[1][0]===setters[0][1][0]);
 if(getters.length!==1)throw Error('Native Model effort getter changed');const draftEffort=getters[0][0]();
 if(draftEffort!==undefined&&(typeof draftEffort!=='string'||draftEffort.length>128))throw Error('Native Model effort value changed');
 const focused=effort[0].current(),focusValue=controls.options.some(option=>option.value===focused)?focused:controls.defaultFocusValue;
 if(focusValue!==undefined&&typeof focusValue!=='string')throw Error('Native Model focus changed');
 const detail=groups?.[2]?.props?.children;
 return {root,controls,focusValue,draftEffort,description:groups?.[0],detail,fastNotice:groups?.[3],canAdjust:!!detail&&detail.props?.children?.type===Symbol.for('react.fragment'),adjust:effort[0].callback};
}
`
