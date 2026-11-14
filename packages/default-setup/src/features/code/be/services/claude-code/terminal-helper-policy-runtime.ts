/** Shared policy fields for full and policy-only snapshots of the original settings. */
export const claudeTerminalHelperPolicyRuntime = String.raw`
function nativeMainStatusCache(n,context,sessionId,command){
 if(command===null||context.session?.id!==sessionId)return null;
 const text=n.runtime.Mco.peek(context.session)?.lastText;
 return typeof text==='string'&&Buffer.byteLength(text)<=32768?text:null;
}
function nativeHelperPolicySnapshot(effective,policy){
 const helpers=(policy.allowManagedHooksOnly||effective.disableAllHooks&&!policy.disableAllHooks)?policy:effective;
 const command=value=>value?.type==='command'&&typeof value.command==='string'?value.command:null;
 return {hooksDisabled:effective.disableAllHooks===true,
  policy:{allowManagedHooksOnly:policy.allowManagedHooksOnly===true,disableAllHooks:policy.disableAllHooks===true},
  statusCommand:policy.disableAllHooks?null:command(helpers.statusLine),
  subagentCommand:policy.disableAllHooks?null:command(helpers.subagentStatusLine)};
}
`
