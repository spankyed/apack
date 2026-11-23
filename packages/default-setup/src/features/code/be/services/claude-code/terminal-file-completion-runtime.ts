/** Adapt the pinned native file index and the terminal's @ path replacement rules. */
export const claudeTerminalFileCompletionRuntime = String.raw`
const nativeAtPathChars=/^[\p{L}\p{N}\p{M}_\-./\\()[\]~:]*/u;
function nativeFileCompletionToken(box){
 const before=box.text.slice(0,box.cursor),after=box.text.slice(box.cursor);
 const quoted=/(?:^|[\s。、？！])@"([^"]*)"?$/u.exec(before);
 if(quoted){
  const start=quoted.index+quoted[0].indexOf('@');
  const closed=before.length>start+2&&before.endsWith('"');
  const suffix=closed?'':after.match(/^[^"\r\n]*"?/)?.[0]??'';
  const query=(quoted[1]+suffix).replace(/"$/,'');
  return {start,end:box.cursor+suffix.length,query,quoted:true};
 }
 const start=before.lastIndexOf('@');
 if(start<0||start>0&&!/[\s。、？！]/u.test(before[start-1]))return undefined;
 const prefix=before.slice(start+1);
 if(nativeAtPathChars.exec(prefix)?.[0]!==prefix)return undefined;
 const suffix=nativeAtPathChars.exec(after)?.[0]??'';
 return {start,end:box.cursor+suffix.length,query:prefix+suffix,quoted:false};
}
async function nativeFileCompletions(n,clientId,token,abort){
 if(!token||token.query.length>4096||!n.fileSuggestions||abort.signal.aborted||!clientViewCurrent(n,clientId))return [];
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')return [];
 const {storageV5}=binding.toolContext(abort);
 const index=n.fileSuggestions.RSe;
 let rows=await n.fileSuggestions.s5t(index,token.query,true,storageV5);
 const tracked=index.fileListRefreshPromise,untracked=index.untrackedFetchPromise;
 if(tracked||untracked){
  await tracked;
  await (index.untrackedFetchPromise??untracked);
  if(abort.signal.aborted||!clientViewCurrent(n,clientId))return [];
  rows=await n.fileSuggestions.s5t(index,token.query,true,storageV5);
 }
 if(abort.signal.aborted||!clientViewCurrent(n,clientId))return [];
 return rows.flatMap(row=>{
  const path=row?.displayText;
  if(typeof path!=='string'||!path||path.length>4096||/["\u0000-\u001f\u007f]/u.test(path))return [];
  const quoted=token.quoted||path.includes(' ');
  return [{label:path,text:quoted?'@"'+path+'" ':'@'+path+' ',replacement:{start:token.start,end:token.end}}];
 });
}
`
