/** Borrow only the original mounted form's field and keyboard callbacks; native retains validation. */
export const claudeTerminalMcpFormRuntime = String.raw`
function nativeMcpDialog(n,mode='form'){
 const binding=originalContext??n.runtime.ey();if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native MCP form is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native MCP form session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,open=store.getState().open,item=open.length===1?open[0]:undefined,payload=item?.payload;
 const revisionKey=mode==='url'?'mcp_url_input':'mcp_elicitation';
 const matches=mode==='url'?['mcp_elicitation','mcp_url_elicitation','mcp_elicitation_waiting'].includes(item?.kind)&&payload?.params?.mode==='url':item?.kind==='mcp_elicitation'&&payload?.params?.mode!=='url';
 if(!matches){dialogRevisions.delete(revisionKey);return {store,sessionId};}
 if(typeof payload?.serverName!=='string'||typeof payload.params?.message!=='string'||(mode==='url'?typeof payload.params.url!=='string':!payload.params.requestedSchema||typeof payload.params.requestedSchema!=='object'))throw Error('Invalid original MCP form payload');
 const fingerprint=JSON.stringify(payload);if(fingerprint.length>131072)throw Error('Native MCP form payload exceeded bound');
 let revision=dialogRevisions.get(revisionKey);
 if(revision?.item!==item||revision.payload!==payload||revision.fingerprint!==fingerprint||revision.sessionId!==sessionId)revision={item,payload,sessionId,fingerprint,revision:randomUUID()};
 dialogRevisions.set(revisionKey,revision);return {store,...revision};
}
function mcpFunctionHash(fn){let hash=composerFunctionHashes.get(fn);if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,hash);}return hash;}
function nativeMcpFormSource(n,d){
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],seen=new Set(),wrappers=[];
 while(pending.length){const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;if(seen.size>=4096)throw Error('Native MCP form traversal exceeded bound');seen.add(fiber);
  if(typeof fiber.type==='function'&&fiber.memoizedProps?.payload===d.payload&&fiber.type.name===nativeFunctionName('ZCo')){
   if(mcpFunctionHash(fiber.type)!=='275d086d7b1ac78d0b4b1939853b2a4fe61e3bc9062ab8c6e7fb281589c3c2db')throw Error('Original MCP wrapper changed');wrappers.push(fiber);
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 if(wrappers.length!==1)return;
 const wrapper=wrappers[0],children=[wrapper.child],visited=new Set(),forms=[];
 while(children.length){const fiber=children.pop();if(!fiber||visited.has(fiber))continue;if(visited.size>=2048)throw Error('Native MCP form renderer exceeded bound');visited.add(fiber);
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('tet')){if(mcpFunctionHash(fiber.type)!=='ba2a4f9045e565e0ac28db116418d4758517b2a2007cc6ae64a40ec73fc4277d')throw Error('Original MCP form renderer changed');forms.push(fiber);}
  if(fiber.sibling)children.push(fiber.sibling);if(fiber.child)children.push(fiber.child);
 }
 if(forms.length!==1)return;
 const controls=[forms[0].child],controlled=new Set(),fields=[],keys=new Set(),cancels=new Set();
 while(controls.length){const fiber=controls.pop();if(!fiber||controlled.has(fiber))continue;if(controlled.size>=2048)throw Error('Native MCP form controls exceeded bound');controlled.add(fiber);const props=fiber.memoizedProps;
  if(typeof fiber.type==='function'&&fiber.type.name===nativeFunctionName('Fet')){if(mcpFunctionHash(fiber.type)!=='c09e34983d996a1a05efed050f5a2f796a68dc838f95090729f83ee627eabb16')throw Error('Original MCP fields changed');if(Array.isArray(props?.schemaFields)&&typeof props.handleTextInputChange==='function')fields.push(props);}
  if(typeof props?.onKeyDown==='function'&&mcpFunctionHash(props.onKeyDown)==='2804d5c249ad1589908e897ff8786895851b0c7200aa1fc57068444739efadb3')keys.add(props.onKeyDown);
  if(typeof props?.onCancel==='function')cancels.add(props.onCancel);
  if(fiber.sibling)controls.push(fiber.sibling);if(fiber.child)controls.push(fiber.child);
 }
 if(fields.length!==1||keys.size!==1||cancels.size!==1)return;
 if(fields[0].schemaFields.length>128)throw Error('Native MCP field limit exceeded');
 return {wrapper,fields:fields[0],key:[...keys][0],cancel:[...cancels][0],ready:typeof wrapper.memoizedProps.wouldTakeAnswer==='function'&&wrapper.memoizedProps.wouldTakeAnswer()===true};
}
function nativeMcpFormPresentation(n,d){
 if(!d.item)return;
 const source=nativeMcpFormSource(n,d);if(!source)return;
 const f=source.fields;
 const facts={id:d.item.id,revision:d.revision,sessionId:d.sessionId,ready:source.ready,serverName:d.payload.serverName,message:d.payload.params.message,schema:d.payload.params.requestedSchema,propertyOrder:f.schemaFields.map(field=>field.name),values:f.formValues,errors:f.validationErrors,resolvingFields:[...f.resolvingFields],currentFieldIndex:f.currentFieldIndex,focusedButton:f.focusedButton,textInputValue:f.textInputValue,textInputCursorOffset:f.textInputCursorOffset};
 const encoded=JSON.stringify(facts);if(encoded.length>196608)throw Error('Native MCP form presentation exceeded bound');
 return {...facts,token:createHash('sha256').update(encoded).digest('hex')};
}
async function operateNativeMcpForm(n,request,signal){
 signal.throwIfAborted();const d=nativeMcpDialog(n),shown=nativeMcpFormPresentation(n,d),cancelling=request.action?.operation==='cancel';
 // Cancellation addresses the original dialog, independent of asynchronous field validation.
 if(!shown||!shown.ready||request.id!==shown.id||request.revision!==shown.revision||request.session_id!==shown.sessionId||!cancelling&&request.token!==shown.token)throw Error('Native MCP form changed or is not ready');
 const current=()=>{signal.throwIfAborted();const dialog=nativeMcpDialog(n);if(dialog.item!==d.item||dialog.payload!==d.payload||dialog.revision!==d.revision)throw Error('Native MCP form expired');const source=nativeMcpFormSource(n,dialog);if(!source?.ready)throw Error('Native MCP form controls are not ready');return source;};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 const key=async value=>{current().key({key:value,ctrl:false,meta:false,shift:false,preventDefault(){}});await settle();};
 const focus=async index=>{for(let step=0;step<shown.propertyOrder.length+3;step++){const f=current().fields,at=f.currentFieldIndex??(f.focusedButton==='accept'?f.schemaFields.length:f.focusedButton==='decline'?f.schemaFields.length+1:0);if(at===index)return;await key('down');}throw Error('Original MCP field navigation did not settle');};
 const action=request.action;if(!action||!['edit','cursor','accept','decline','cancel'].includes(action.operation))throw Error('Invalid MCP form operation');
 if(action.operation==='cancel')current().cancel();
 else if(action.operation==='cursor'){
  const f=current().fields,index=shown.propertyOrder.indexOf(action.field);
  if(index<0||f.currentFieldIndex!==index||f.focusedButton||typeof f.setTextInputCursorOffset!=='function'||!Number.isSafeInteger(action.cursorOffset)||action.cursorOffset<0||action.cursorOffset>f.textInputValue.length)throw Error('Native MCP cursor field changed');
  f.setTextInputCursorOffset(action.cursorOffset);await settle();
 }
 else if(action.operation==='edit'){
  const index=shown.propertyOrder.indexOf(action.field);if(index<0)throw Error('Unknown native MCP field');
  const definition=current().fields.schemaFields[index].schema,value=action.value;
  const optionField=definition.enum||definition.oneOf||definition.type==='array';
  const options=optionField?(definition.type==='array'?(definition.items?.enum??definition.items?.anyOf?.map(option=>option.const)):(definition.enum??definition.oneOf.map(option=>option.const))):undefined;
  const values=definition.type==='array'?value:[value];
  if(value!==null){
   if(definition.type==='boolean'){if(typeof value!=='boolean')throw Error('Invalid native boolean');}
   else if(optionField){if(!Array.isArray(options)||options.length>512||!Array.isArray(values)||values.some(value=>typeof value!=='string'||!options.includes(value)))throw Error('Invalid original MCP options');}
   else if(typeof value!=='string'&&typeof value!=='number')throw Error('Invalid native text input');
  }
  if(action.cursorOffset!==undefined&&(!Number.isSafeInteger(action.cursorOffset)||action.cursorOffset<0||typeof value!=='string'||action.cursorOffset>value.length||optionField||definition.type==='boolean'))throw Error('Invalid native MCP cursor offset');
  if(action.cursorOffset!==undefined&&typeof current().fields.setTextInputCursorOffset!=='function')throw Error('Original MCP cursor callback is unavailable');
  await focus(index);
  if(value===null){if(!definition.enum&&!definition.oneOf&&!['array','boolean'].includes(definition.type)){current().fields.handleTextInputChange('');await settle();}await key('backspace');}
  else if(definition.type==='boolean'){
   for(let step=0;step<2&&current().fields.formValues[action.field]!==value;step++)await key(' ');
  }else if(definition.enum||definition.oneOf||definition.type==='array'){
   const changed=definition.type==='array'?options.filter(option=>(current().fields.formValues[action.field]??[]).includes(option)!==values.includes(option)):values;
   for(const option of changed){
    if(current().fields.expandedAccordion!==action.field)await key('right');
    const target=options.indexOf(option);
    for(let step=0;step<options.length;step++){const at=current().fields.accordionOptionIndex;if(at===target)break;await key(at>target?'up':'down');}
    if(current().fields.accordionOptionIndex!==target)throw Error('Original MCP option navigation did not settle');
    await key(' ');
   }
   if(current().fields.expandedAccordion!==undefined)await key('left');
  }else{
   current().fields.handleTextInputChange(String(value));await settle();
   if(action.cursorOffset!==undefined){current().fields.setTextInputCursorOffset(action.cursorOffset);await settle();}
  }
 }else{await focus(shown.propertyOrder.length+(action.operation==='decline'?1:0));const grace=n.mcpInputTiming.AM;if(!Number.isSafeInteger(grace)||grace<0||grace>1000)throw Error('Original MCP input timing changed');await new Promise(resolve=>setTimeout(resolve,grace));await key('return');}
 await settle();signal.throwIfAborted();const after=nativeMcpDialog(n);return {settled:after.item!==d.item,form:after.item===d.item?nativeMcpFormPresentation(n,after):undefined};
}
`
