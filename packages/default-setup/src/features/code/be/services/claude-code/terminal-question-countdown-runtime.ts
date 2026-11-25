/** Read only the original clock text committed for the current Claude question. */
export const claudeTerminalQuestionCountdownRuntime = String.raw`
function countdownFibers(root,match,limit){
 const stack=[root],seen=new Set(),matched=[];
 while(stack.length){
  const fiber=stack.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=limit)return [];
  seen.add(fiber);if(match(fiber))matched.push(fiber);
  if(fiber.sibling)stack.push(fiber.sibling);if(fiber.child)stack.push(fiber.child);
 }
 return matched;
}
function questionCountdownProducer(fiber,name,expectedHash){
 if(typeof fiber.type!=='function'||fiber.type.name!==name)return false;
 let hash=composerFunctionHashes.get(fiber.type);
 if(!hash){hash=createHash('sha256').update(Function.prototype.toString.call(fiber.type)).digest('hex');composerFunctionHashes.set(fiber.type,hash);}
 return hash===expectedHash;
}
function readNativeQuestionCountdown(n,d){
 const root=n.themeRoots.ai().get(process.stdout)?.container?.current;
 const renderer=nativeFunctionName('Hve'),renderHash='9d5b60c63cb27ddbdd81de54229222d828a6594abac38aa0e9ca4f2088cfbd32';
 const renderers=countdownFibers(root,f=>f.memoizedProps?.payload===d.payload&&questionCountdownProducer(f,renderer,renderHash),4096);
 if(renderers.length!==1)return;
 const clock=nativeFunctionName('Fve'),clockHash='c5acf89f8fe4e33025ba8218fd1efa085a47b70968bb168524eba0d65f035037';
 const clocks=countdownFibers(renderers[0].child,f=>f.memoizedProps?.enabled===true&&questionCountdownProducer(f,clock,clockHash),2048);
 if(clocks.length!==1)return;
 const text=countdownFibers(clocks[0].child,f=>{
  const c=f.memoizedProps?.children;
  return Array.isArray(c)&&c.length===3&&c[0]==='auto-continue in '&&Number.isSafeInteger(c[1])&&c[1]>=0&&c[1]<=600&&c[2]==='s · any key to stay';
 },64);
 if(text.length===1)return text[0].memoizedProps.children[1];
}
let lastQuestionCountdown,questionCountdownSequence=0,nextQuestionCountdownRead=0;
function refreshNativeQuestionCountdown(n){
 const now=Date.now();
 if((!questionFrames.size&&!lastQuestionCountdown)||now<nextQuestionCountdownRead)return;
 nextQuestionCountdownRead=now+500;
 try{
  const d=nativeDialog(n,'permission_ask_user_question');
  const present=d.item&&[...questionFrames.values()].some(frame=>frame.item===d.item&&frame.revision===d.revision);
  const seconds=present?readNativeQuestionCountdown(n,d):undefined;
  const prior=lastQuestionCountdown;
  if(seconds===undefined){
   if(prior)publish({...prior,seconds:null,sequence:++questionCountdownSequence});
   lastQuestionCountdown=undefined;
  }else if(!prior||prior.revision!==d.revision||prior.seconds!==seconds){
   lastQuestionCountdown={type:'system',subtype:'apack_question_countdown',session_id:d.sessionId,
    dialog_id:d.item.id,revision:d.revision,request_id:d.payload.requestId,seconds};
   publish({...lastQuestionCountdown,sequence:++questionCountdownSequence});
  }
 }catch{ /* The native drawing may retire between samples. */ }
}
`
