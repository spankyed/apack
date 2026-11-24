/** Project the first-use prompt from Claude's mounted panel and keep its original guarded actions. */
export const claudeTerminalRemoteCalloutRuntime = String.raw`
function nativeRemoteCallout(n) {
 const kind='remote_callout',binding=originalContext??n.runtime.ey();
 const absent=()=>{dialogRevisions.delete(kind);return undefined;};
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')return absent();
 const abort=new AbortController(),store=binding.toolContext(abort).dialogStore,open=store.getState().open;
 if(open.length!==1||open[0].kind!==kind)return absent();
 const item=open[0],payload=item.payload;
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==0)return absent();
 const facts=nativeViewFacts(n,binding,abort),sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(facts.sessionId!==sessionId||facts.view.kind!=='main')return absent();
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current;
 const wrappers=nativeModelFibers(root).filter(fiber=>fiber.memoizedProps?.payload===payload
  &&typeof fiber.memoizedProps.answer==='function'
  &&nativeModelFunctionHash(fiber.type)==='e4c66f2a69905f7004ce8ccb86fbda43f2720d7e134bcec30030f8e41ab6deed');
 if(wrappers.length!==1)return absent();
 const wrapper=wrappers[0],rows=wrapper.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===4&&row[3]?.props);
 if(rows?.length!==1)return absent();
 const viewElement=rows[0][3];
 const views=nativeModelFibers(wrapper).filter(fiber=>fiber.memoizedProps===viewElement.props
  &&nativeModelFunctionHash(fiber.type)==='b6cac59c176992c5dd86a4383b5e822f3433748169b0e5f42df5b672c371a22c');
 if(views.length!==1)return absent();
 const view=views[0],rendered=view.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===12&&row[11]?.props&&row[4]?.props);
 if(rendered?.length!==1)return absent();
 const row=rendered[0],panel=row[11],body=row[4],children=panel.props.children?.props?.children;
 if(!Array.isArray(children)||children[0]!==body)return absent();
 const select=children[1]?.props?.children,control=select?.props;
 if(!control||typeof control.isDisabled!=='boolean'||typeof control.onChange!=='function'||typeof control.onCancel!=='function'
  ||!Array.isArray(control.options)||control.options.length!==2
  ||control.options[0]?.value!=='enable'||control.options[1]?.value!=='dismiss'
  ||control.options.some(option=>typeof option.label!=='string'||!option.label||typeof option.description!=='string')
  ||typeof panel.props.title!=='string'||!panel.props.title||!Array.isArray(body.props.children))return absent();
 const mounted=nativeModelFibers(view);
 if(!mounted.some(fiber=>fiber.memoizedProps===panel.props&&(fiber.type===panel.type||fiber.elementType===panel.type))
  ||!mounted.some(fiber=>fiber.memoizedProps===control
   &&nativeModelFunctionHash(fiber.type)==='e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5'))return absent();
 const paragraphs=body.props.children.map(child=>child?.props?.children);
 if(paragraphs.some(text=>typeof text!=='string'))return absent();
 let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision.sessionId!==sessionId||revision.viewSequence!==facts.sequence||revision.control!==control||revision.panel!==panel)
  revision={item,sessionId,viewSequence:facts.sequence,control,panel,revision:randomUUID()};
 dialogRevisions.set(kind,revision);
 return {store,...revision,notice:{id:item.id,sessionId,revision:revision.revision,kind,title:panel.props.title,
  paragraphs:paragraphs.filter(text=>text.trim()), disabled:control.isDisabled,
  choices:control.options.map(({value,label,description})=>({value:value==='enable'?'remote_enable':'remote_dismiss',label,description}))}};
}
function answerNativeRemoteCallout(n,request) {
 const callout=nativeRemoteCallout(n);
 if(!callout||callout.item.id!==request.id||callout.revision!==request.revision||callout.sessionId!==request.session_id)
  throw Error('Native Remote Control prompt changed or expired');
 if(!['remote_enable','remote_dismiss'].includes(request.decision))throw Error('Invalid native Remote Control decision');
 if(callout.control.isDisabled)throw Error('Claude is not accepting Remote Control decisions yet');
 if(request.decision==='remote_dismiss')callout.control.onCancel();
 else callout.control.onChange('enable');
 if(callout.store.getState().open.includes(callout.item))throw Error('Claude refused the Remote Control decision');
 dialogRevisions.delete('remote_callout');
}
`
