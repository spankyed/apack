/** Project the reviewed native prelaunch panel and its committed Suspense branch. */
export const claudeTerminalUltraplanLaunchRuntime = String.raw`
const answeredUltraplanLaunches=new WeakSet();
const ultraplanTermsUrl='https://code.claude.com/docs/en/claude-code-on-the-web';
function nativeUltraplanLaunchVisible(fiber,root){
 // React keeps suspended primary content in a hidden Offscreen fiber.
 for(let current=fiber;current;current=current.return){
  if((current.tag===22||current.tag===23)&&current.memoizedState!=null)return false;
  if(current===root)return true;
 }
 return false;
}
function nativeUltraplanLaunchElement(fibers,root,element){
 return !!element?.props&&fibers.some(fiber=>fiber.memoizedProps===element.props
  &&(fiber.type===element.type||fiber.elementType===element.type)&&nativeUltraplanLaunchVisible(fiber,root));
}
function nativeUltraplanLaunchText(node){
 if(node===undefined||node===null||node===false)return '';
 if(typeof node!=='string')return;
 const text=stripVTControlCharacters(node);
 if(text.length<=16000)return text;
}
function nativeUltraplanLaunchReview(payload,row){
 const [prompt,details,select]=row[40].props.children??[];
 if(prompt!==row[12]||details!==row[18]||select!==row[36])return;
 const [labelNode,promptText]=prompt?.props?.children??[],promptLabel=nativeUltraplanLaunchText(labelNode?.props?.children);
 const summary=nativeUltraplanLaunchText(promptText);
 if(!promptLabel||!summary)return;
 const content=details?.props?.children;
 if(!Array.isArray(content))return;
 if(payload.showTerms){
  const [disclosure,info,proceed]=content;
  const [upload,moreInfo]=info?.props?.children??[],[linkLabel,link]=moreInfo?.props?.children??[];
  if(link?.props?.url!==ultraplanTermsUrl)return;
  const paragraphs=[disclosure?.props?.children,upload?.props?.children,proceed?.props?.children].map(nativeUltraplanLaunchText);
  const helpLabel=nativeUltraplanLaunchText(linkLabel)?.trim();
  if(paragraphs.some(text=>text===undefined)||!paragraphs[0]||!paragraphs[2]||!helpLabel)return;
  return {phase:'terms',promptLabel,summary,paragraphs:paragraphs.filter(Boolean),helpLabel,helpUrl:ultraplanTermsUrl};
 }
 const [disclosure,pipeline]=content,[body,bridge]=disclosure?.props?.children??[];
 const paragraphs=[body?.props?.children,bridge?.props?.children,pipeline?.props?.children].map(nativeUltraplanLaunchText);
 if(paragraphs.some(text=>text===undefined)||!paragraphs[0])return;
 return {phase:'review',promptLabel,summary,paragraphs:paragraphs.filter(Boolean)};
}
function nativeUltraplanLaunch(n){
 const kind='ultraplan_launch',binding=originalContext??n.runtime.ey();
 const absent=()=>{dialogRevisions.delete(kind);return undefined;};
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')return absent();
 const abort=new AbortController(),store=binding.toolContext(abort).dialogStore,open=store.getState().open;
 const item=open[0],payload=item?.payload;
 if(open.length!==1||item.kind!==kind||answeredUltraplanLaunches.has(item)||typeof payload?.prompt!=='string'
  ||typeof payload.promptIdentifier!=='string'||typeof payload.showTerms!=='boolean'||typeof payload.deliveredByRelay!=='boolean')return absent();
 const facts=nativeViewFacts(n,binding,abort),sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(facts.sessionId!==sessionId||facts.view.kind!=='main')return absent();
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current,tree=nativeModelFibers(root);
 const wrappers=tree.filter(fiber=>fiber.memoizedProps?.payload===payload
  &&typeof fiber.memoizedProps.answer==='function'&&typeof fiber.memoizedProps.wouldTakeAnswer==='function'
  &&nativeModelFunctionHash(fiber.type)==='707334db26f3d0bd9bb606bdfec78c2b2ae808b2c2d2d9e500038a3b2805c150'
  &&nativeUltraplanLaunchVisible(fiber,root));
 if(wrappers.length!==1)return absent();
 const wrapper=wrappers[0],wrapperProps=wrapper.memoizedProps,underWrapper=nativeModelFibers(wrapper);
 const views=underWrapper.filter(fiber=>fiber.memoizedProps?.onDone===wrapperProps.answer
  &&fiber.memoizedProps.wouldTakeAnswer===wrapperProps.wouldTakeAnswer
  &&['promptIdentifier','prompt','showTerms','deliveredByRelay'].every(key=>fiber.memoizedProps[key]===payload[key])
  &&nativeModelFunctionHash(fiber.type)==='5303115411ecfe721d34d59c4253fa2f2ab65c00187a94bfc7ee70b7287ed51f'
  &&nativeUltraplanLaunchVisible(fiber,wrapper));
 if(views.length!==1)return absent();
 const view=views[0],mounted=nativeModelFibers(view);
 const rows=view.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===27&&row[26]?.props);
 if(rows?.length!==1)return absent();
 const panel=rows[0][26],{title,subtitle,onCancel}=panel.props,suspense=panel.props.children?.props;
 if(typeof title!=='string'||typeof subtitle!=='string'||typeof onCancel!=='function'
  ||!nativeUltraplanLaunchElement(mounted,view,panel)||!suspense?.children?.props||!suspense.fallback?.props||suspense.fallback!==rows[0][13])return absent();
 const bodies=mounted.filter(fiber=>fiber.memoizedProps===suspense.children?.props
  &&nativeModelFunctionHash(fiber.type)==='85cfc66614f6b36ec4854e0f20bbaaa6364483b6df5635046b7d62ba90283941'
  &&nativeUltraplanLaunchVisible(fiber,view));
 const fallback=nativeUltraplanLaunchElement(mounted,view,suspense.fallback);
 let detail,control,choices;
 if(fallback&&bodies.length===0){
  const loading=nativeUltraplanLaunchText(suspense.fallback.props.children);
  if(!loading)return absent();
  detail={phase:'loading',paragraphs:[loading]};
  choices=[{value:'ultraplan_launch_cancel',label:'Cancel'}];
 }else if(!fallback&&bodies.length===1){
  const body=bodies[0],content=body.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===41&&row[40]?.props&&row[36]?.props);
  if(content?.length!==1)return absent();
  control=content[0][36].props;
  if(typeof control.refuseInput!=='function'||typeof control.onChange!=='function'||control.selectedValue!=='cancelled'
   ||!Array.isArray(control.options)||control.options.length!==2
   ||control.options[0]?.value!=='run'||control.options[1]?.value!=='cancel'
   ||control.options.some(option=>typeof option.label!=='string'||!option.label||option.label.length>4000
    ||option.description!==undefined&&(typeof option.description!=='string'||option.description.length>4000))
   ||!nativeModelFibers(body).some(fiber=>fiber.memoizedProps===control
    &&nativeModelFunctionHash(fiber.type)==='e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5'
    &&nativeUltraplanLaunchVisible(fiber,body)))return absent();
  detail=nativeUltraplanLaunchReview(payload,content[0]);
  if(!detail)return absent();
  choices=control.options.map(({value,label,description})=>({value:value==='run'?'ultraplan_launch_run':'ultraplan_launch_cancel',label,description}));
 }else return absent();
 const fingerprint=JSON.stringify([title,subtitle,detail,choices]);
 let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision.payload!==payload||revision.sessionId!==sessionId||revision.viewSequence!==facts.sequence
  ||revision.control!==control||revision.panel!==panel||revision.wouldTakeAnswer!==wrapperProps.wouldTakeAnswer||revision.fingerprint!==fingerprint)
  revision={item,payload,sessionId,viewSequence:facts.sequence,control,panel,wouldTakeAnswer:wrapperProps.wouldTakeAnswer,fingerprint,revision:randomUUID()};
 dialogRevisions.set(kind,revision);
 return {...revision,store,notice:{id:item.id,sessionId,revision:revision.revision,kind,title,subtitle,...detail,choices}};
}
function answerNativeUltraplanLaunch(n,request){
 const launch=nativeUltraplanLaunch(n);
 if(!launch||launch.item.id!==request.id||launch.revision!==request.revision||launch.sessionId!==request.session_id)
  throw Error('Native Ultraplan launch changed or expired');
 const decision=request.decision;
 if(decision==='ultraplan_launch_escape'||decision==='ultraplan_launch_cancel'&&launch.notice.phase==='loading'){
  if(launch.wouldTakeAnswer()!==true)throw Error('Claude is not accepting Ultraplan decisions yet');
  launch.panel.props.onCancel();
 }else{
  const choice=launch.notice.choices.find(option=>option.value===decision);
  if(!launch.control||!choice)throw Error('Invalid native Ultraplan launch decision');
  if(launch.control.refuseInput())throw Error('Claude is not accepting Ultraplan decisions yet');
  launch.control.onChange(decision==='ultraplan_launch_run'?'run':'cancel');
 }
 if(launch.store.getState().open.some(item=>item.id===launch.item.id))throw Error('Claude refused the Ultraplan launch decision');
 answeredUltraplanLaunches.add(launch.item);
 dialogRevisions.delete('ultraplan_launch');
}
`
