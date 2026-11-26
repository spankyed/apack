/** Show the entire offered plan and call the retry-aware choice mounted by Claude 2.1.302. */
export const claudeTerminalUltraplanChoiceRuntime = String.raw`
const answeredUltraplanChoices=new WeakSet();
const ultraplanChoiceValues={here:'ultraplan_here',fresh:'ultraplan_fresh',cancel:'ultraplan_cancel'};
function nativeUltraplanChoice(n){
 const kind='ultraplan_choice',binding=originalContext??n.runtime.ey();
 const absent=()=>{dialogRevisions.delete(kind);return undefined;};
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')return absent();
 const abort=new AbortController(),store=binding.toolContext(abort).dialogStore,open=store.getState().open;
 const item=open[0],payload=item?.payload;
 if(open.length!==1||item.kind!==kind||answeredUltraplanChoices.has(item)||typeof payload?.plan!=='string'||!payload.plan.trim()||payload.plan.length>200000)return absent();
 const facts=nativeViewFacts(n,binding,abort),sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(facts.sessionId!==sessionId||facts.view.kind!=='main')return absent();
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current;
 const wrappers=nativeModelFibers(root).filter(fiber=>fiber.memoizedProps?.payload===payload
  &&typeof fiber.memoizedProps.answer==='function'
  &&nativeModelFunctionHash(fiber.type)==='be11caa5c9ae3c88fbf925f7c7b8276c09202dce03b8afc07c1974958f581bb5');
 if(wrappers.length!==1)return absent();
 const wrapper=wrappers[0],underWrapper=nativeModelFibers(wrapper);
 const views=underWrapper.filter(fiber=>fiber.memoizedProps?.plan===payload.plan
  &&fiber.memoizedProps.onDone===wrapper.memoizedProps.answer
  &&nativeModelFunctionHash(fiber.type)==='317101b04ec4ea38de8707e4b36efdd3142fe7092dd19691ce016ea2dafca8e6');
 if(views.length!==1)return absent();
 const view=views[0],rows=view.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===40&&row[39]?.props&&row[34]?.props);
 if(rows?.length!==1)return absent();
 const row=rows[0],panel=row[39],select=row[34],control=select.props;
 if(panel.props.children?.props?.children?.[1]!==select
  ||typeof panel.props.title!=='string'||typeof panel.props.subtitle!=='string'
  ||typeof control.onChange!=='function'||!Array.isArray(control.options)||control.options.length!==3
  ||control.options.some((option,index)=>option?.value!==['here','fresh','cancel'][index]
   ||typeof option.label!=='string'||!option.label||typeof option.description!=='string'))return absent();
 const mounted=nativeModelFibers(view);
 if(!mounted.some(fiber=>fiber.memoizedProps===panel.props&&(fiber.type===panel.type||fiber.elementType===panel.type))
  ||!mounted.some(fiber=>fiber.memoizedProps===control
   &&nativeModelFunctionHash(fiber.type)==='e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5'))return absent();
 const plan=stripVTControlCharacters(payload.plan);
 if(!plan.trim())return absent();
 const choices=control.options.map(({value,label,description})=>({value:ultraplanChoiceValues[value],label,description}));
 const fingerprint=JSON.stringify([plan,panel.props.title,panel.props.subtitle,choices]);
 let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision.payload!==payload||revision.sessionId!==sessionId||revision.viewSequence!==facts.sequence||revision.control!==control||revision.fingerprint!==fingerprint)
  revision={item,payload,sessionId,viewSequence:facts.sequence,control,fingerprint,revision:randomUUID()};
 dialogRevisions.set(kind,revision);
 return {...revision,notice:{id:item.id,sessionId,revision:revision.revision,kind,title:panel.props.title,
  paragraphs:[panel.props.subtitle],plan,choices}};
}
function answerNativeUltraplanChoice(n,request){
 const choice=nativeUltraplanChoice(n);
 if(!choice||choice.item.id!==request.id||choice.revision!==request.revision||choice.sessionId!==request.session_id)
  throw Error('Native Ultraplan choice changed or expired');
 const value=Object.keys(ultraplanChoiceValues).find(value=>ultraplanChoiceValues[value]===request.decision);
 if(!value)throw Error('Invalid native Ultraplan choice');
 if(choice.control.onChange(value)!==true)throw Error('Claude refused the Ultraplan choice. Try again when Claude is ready.');
 answeredUltraplanChoices.add(choice.item);
 dialogRevisions.delete('ultraplan_choice');
}
`
