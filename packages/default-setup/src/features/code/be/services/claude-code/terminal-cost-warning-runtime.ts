/** Present only the mounted cost warning; the original callback owns acknowledgement and persistence. */
export const claudeTerminalCostWarningRuntime = String.raw`
function nativeCostWarning(n) {
 const kind='cost_threshold', binding=originalContext??n.runtime.ey();
 const forget=()=>{dialogRevisions.delete(kind);return undefined;};
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')return forget();
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)return forget();
 const store=binding.toolContext(new AbortController()).dialogStore, open=store.getState().open;
 if(open.length!==1||open[0].kind!==kind)return forget();
 const item=open[0], payload=item.payload;
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==0)return forget();
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current;
 const wrappers=nativeModelFibers(root).filter(fiber=>fiber.memoizedProps?.payload===payload
  && typeof fiber.memoizedProps.answer==='function'
  && nativeModelFunctionHash(fiber.type)==='03e82ecbd848c2e58a725afc1f530a979f12b404b92fdf5222c9a28009a2e513');
 if(wrappers.length!==1)return forget();
 const views=nativeModelFibers(wrappers[0]).filter(fiber=>typeof fiber.memoizedProps?.onDone==='function'
  && nativeModelFunctionHash(fiber.type)==='c74ab3745fbced047db05aa4b19ce1f4bb6126c65ef86e99fa83d03ec2a93e77');
 if(views.length!==1)return forget();
 const view=views[0], onDone=view.memoizedProps.onDone;
 const rows=view.updateQueue?.memoCache?.data?.filter(row=>Array.isArray(row)&&row.length===7&&row[0]?.props&&row[3]?.props&&row[6]?.props);
 if(rows?.length!==1)return forget();
 const [row]=rows, control=row[3].props, panel=row[6].props;
 const option=control.options?.length===1?control.options[0]:undefined;
 const body=row[0].props.children;
 if(panel.onCancel!==onDone||control.onChange!==onDone||panel.children?.[0]!==row[0]||panel.children?.[1]!==row[3]
  || option?.value!=='ok'||typeof option.label!=='string'||!option.label||typeof panel.title!=='string'||!panel.title
  || !Array.isArray(body)||body.length!==2||typeof body[0]?.props?.children!=='string'
  || body[1]?.props?.url!=='https://code.claude.com/docs/en/costs')return forget();
 const mounted=nativeModelFibers(view);
 if(!mounted.some(fiber=>fiber.memoizedProps===panel&&(fiber.elementType===row[6].type||fiber.type===row[6].type))
  ||!mounted.some(fiber=>fiber.memoizedProps===control
   && nativeModelFunctionHash(fiber.type)==='e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5'))return forget();
 let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision.sessionId!==sessionId||revision.panel!==panel||revision.control!==control)
  revision={item,sessionId,panel,control,revision:randomUUID()};
 dialogRevisions.set(kind,revision);
 return {store,...revision,notice:{id:item.id,sessionId,revision:revision.revision,kind,title:panel.title,
  paragraphs:[body[0].props.children],helpUrl:body[1].props.url,choices:[{value:'cost_acknowledge',label:option.label}]}};
}
function answerNativeCostWarning(n,request) {
 const warning=nativeCostWarning(n);
 if(!warning||warning.item.id!==request.id||warning.revision!==request.revision||warning.sessionId!==request.session_id)
  throw Error('Native cost warning changed or expired');
 if(request.decision!=='cost_acknowledge')throw Error('Invalid native cost warning decision');
 warning.control.onChange('ok');
 if(warning.store.getState().open.includes(warning.item))throw Error('Native cost warning did not accept the decision');
 dialogRevisions.delete('cost_threshold');
}
`
