/** Shared policy fields for full and policy-only snapshots of the original settings. */
export const claudeTerminalHelperPolicyRuntime = String.raw`
function nativeHelperPolicySnapshot(effective,policy){
 const helpers=(policy.allowManagedHooksOnly||effective.disableAllHooks&&!policy.disableAllHooks)?policy:effective;
 const command=value=>value?.type==='command'&&typeof value.command==='string'?value.command:null;
 return {hooksDisabled:effective.disableAllHooks===true,
  policy:{allowManagedHooksOnly:policy.allowManagedHooksOnly===true,disableAllHooks:policy.disableAllHooks===true},
  statusCommand:policy.disableAllHooks?null:command(helpers.statusLine),
  subagentCommand:policy.disableAllHooks?null:command(helpers.subagentStatusLine)};
}
`
