/** Retire connections the pinned Claude runtime now refuses, using its original state and transport. */
export const claudeTerminalMcpPolicyRuntime = String.raw`
async function retireNativePolicyBlockedMcpConnections(n,context,isCurrent){
 const blocked=()=>context.getAppState().mcp.clients.filter(connection=>
  connection.type==='connected'&&n.runtime.Mc(connection.name,connection.config)==='managed-policy');
 if(!blocked().length)return;
 const {knt}=await import('/$bunfs/root/chunk-z0mpv66t.js');
 const {mcpClientModule}=await import('/$bunfs/root/chunk-y0a0212f.js');
 if(!isCurrent())return;
 const store=knt.over({getState:context.getAppState,setState:context.setAppState});
 const transport=mcpClientModule();
 const closing=[];
 // The original owner can settle connections while we load the store and transport modules.
 for(const connection of blocked()){
  store.markReconnectDiscarded(connection.name,connection.config);
  if(store.get().clients.includes(connection))continue;
  closing.push(transport.detachAndCloseConnection(connection));
 }
 await Promise.all(closing);
}
`
