/** Retire connections the pinned Claude runtime now refuses, using its original state and transport. */
export const claudeTerminalMcpPolicyRuntime = String.raw`
const nativeMcpHttpCallLifetime=new WeakMap();
const nativeMcpClientObservers=new WeakSet();
const nativeMcpChannelClients=new WeakSet();
const nativeMcpChannelHandlers=new WeakSet();
const nativeMcpChannelMethods=['notifications/claude/channel','notifications/claude/channel/permission'];
function guardNativeMcpChannel(connection,blocked){
 if(connection.type!=='connected'||!connection.capabilities?.experimental?.['claude/channel'])return;
 const client=connection.client, handlers=client?._notificationHandlers, register=client?.setNotificationHandler;
 if(!(handlers instanceof Map)||typeof register!=='function'||nativeMcpChannelClients.has(client))return;
 const guard=()=>{
  for(const method of nativeMcpChannelMethods){
   const original=handlers.get(method);
   if(typeof original!=='function'||nativeMcpChannelHandlers.has(original))continue;
   const checked=function(...args){
    if(!blocked())return Reflect.apply(original,this,args);
   };
   nativeMcpChannelHandlers.add(checked);
   handlers.set(method,checked);
  }
 };
 // A legacy client can already hold its channel callbacks when the app attaches.
 guard();
 client.setNotificationHandler=function(...args){
  const result=Reflect.apply(register,this,args);
  guard();
  return result;
 };
 nativeMcpChannelClients.add(client);
}
function observeNativeMcpHttpCalls(connection){
 if(connection.type!=='connected'||!['http','claudeai-proxy'].includes(connection.config.type))return;
 const client=connection.client;
 if(typeof client?.callTool!=='function'||nativeMcpHttpCallLifetime.has(client))return;
 const lifetime=new AbortController(),callTool=client.callTool;
 client.callTool=function(...args){
  // The two native client implementations take (params, options) or (params, schema, options).
  const index=args.length>2?2:1,options=args[index];
  const signal=options?.signal?AbortSignal.any([options.signal,lifetime.signal]):lifetime.signal;
  args[index]={...options,signal};
  return Reflect.apply(callTool,this,args);
 };
 nativeMcpHttpCallLifetime.set(client,lifetime);
}
function observeNativeMcpConnections(wiring,channelBlocked){
 const prior=wiring.chn();
 if(prior&&nativeMcpClientObservers.has(prior))return;
 const observe=function(connection,...args){
  observeNativeMcpHttpCalls(connection);
  guardNativeMcpChannel(connection,channelBlocked);
  if(prior)return Reflect.apply(prior,this,[connection,...args]);
 };
 nativeMcpClientObservers.add(observe);
 wiring.kbt(observe);
}
async function detachNativePolicyBlockedMcpConnection(transport,connection,key){
 const cached=transport.connectToServer.cache.get(key);
 if(cached){
  const previous=await transport.peekSettledConnection(connection.name,connection.config);
  if((previous===connection||(previous?.type==='connected'&&previous.client===connection.client))
    &&transport.connectToServer.cache.get(key)===cached){
   // Detached close alone only evicts the dial under the native cache rollout.
   // Evict this exact dial so a later native policy update can reopen the same server.
   transport.disposeServerConnectionDetached(connection.name,connection.config,cached);
   return;
  }
 }
 await transport.detachAndCloseConnection(connection);
}
async function retireNativePolicyBlockedMcpConnections(n,context,isCurrent){
 const wiring=await import('/$bunfs/root/chunk-hdxpvbx1.js');
 if(!isCurrent())return;
 observeNativeMcpConnections(wiring,n.mcpChannelBlocked);
 const connections=()=>context.getAppState().mcp.clients;
 for(const connection of connections()){
  observeNativeMcpHttpCalls(connection);
  guardNativeMcpChannel(connection,n.mcpChannelBlocked);
 }
 const blocked=()=>connections().filter(connection=>
  connection.type==='connected'&&n.runtime.Mc(connection.name,connection.config)==='managed-policy');
 if(!blocked().length)return;
 const {knt}=await import('/$bunfs/root/chunk-z0mpv66t.js');
 const {mcpClientModule}=await import('/$bunfs/root/chunk-y0a0212f.js');
 const {Jn:connectionKey}=await import('/$bunfs/root/chunk-kkq7q3vx.js');
 if(!isCurrent())return;
 const store=knt.over({getState:context.getAppState,setState:context.setAppState});
 const transport=mcpClientModule();
 const closing=[];
 // The original owner can settle connections while we load the store and transport modules.
 for(const connection of blocked()){
  store.markReconnectDiscarded(connection.name,connection.config);
  if(store.get().clients.includes(connection))continue;
  // Cancel before close so the original HTTP client does not classify revocation as session expiry.
  nativeMcpHttpCallLifetime.get(connection.client)?.abort(Error('MCP access revoked by managed policy'));
  closing.push(detachNativePolicyBlockedMcpConnection(transport,connection,connectionKey(connection.name,connection.config)));
 }
 await Promise.all(closing);
}
`
