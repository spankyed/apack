import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EarsDatabase } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/sqlite';

const state=vi.hoisted(()=>({database:undefined as EarsDatabase|undefined,stop:vi.fn(),hooks:vi.fn(),
  broadcast:vi.fn(),socketClose:vi.fn(),httpClose:vi.fn()}));
vi.mock('../../src/runtime/index.ts',()=>({get appDatabase(){return state.database;},appRunHistory:undefined,
  appPacks:{runShutdownHooks:state.hooks},backendActor:{stop:state.stop}}));
vi.mock('../../src/transport/index.ts',()=>({appRouter:{}}));
vi.mock('../../src/transport/context.ts',()=>({createRpcContext:vi.fn()}));
vi.mock('node:http',()=>({createServer:()=>({listen:vi.fn(),close:state.httpClose})}));
vi.mock('ws',()=>({WebSocketServer:class{close=state.socketClose;}}));
vi.mock('@trpc/server/adapters/ws',()=>({applyWSSHandler:()=>({broadcastReconnectNotification:state.broadcast})}));
const {createWebSocketServer}=await import('../../src/transport/websocket.ts');
let root:string|undefined;
afterEach(()=>{state.database?.close();state.database=undefined;vi.restoreAllMocks();vi.clearAllMocks();vi.unstubAllEnvs();if(root)rmSync(root,{recursive:true,force:true});root=undefined;});
function fixture(){
  root=mkdtempSync(join(tmpdir(),'api-shutdown-'));vi.stubEnv('APACK_USER_DATA_DIR',root);vi.stubEnv('APACK_ENV','test');
  vi.stubEnv('APACK_API_TOKEN','a'.repeat(64));
  state.database=openDatabase({path:join(root,'store'),syncs:false});
  const callbacks=new Map<string,()=>void>();
  vi.spyOn(process,'on').mockImplementation((event,listener)=>{callbacks.set(String(event),()=>listener());return process;});
  const exit=vi.spyOn(process,'exit').mockImplementation(()=>undefined as never);
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  createWebSocketServer();return {database:state.database,callbacks,exit,log};
}
it('awaits database drain before exiting, handles repeated signals once and runs hooks only once',async()=>{
  const {database,callbacks,exit}=fixture();let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
  database.drainBackground=vi.fn(async()=>{started();await gate;});
  callbacks.get('SIGTERM')!();callbacks.get('SIGTERM')!();await entered;
  try {expect(exit).not.toHaveBeenCalled();expect(database.isOpen).toBe(true);expect(state.stop).toHaveBeenCalledTimes(1);}
  finally {release();}
  await vi.waitFor(()=>expect(exit).toHaveBeenCalledWith(0));expect(exit).toHaveBeenCalledTimes(1);
  expect(database.isOpen).toBe(false);expect(state.hooks).toHaveBeenCalledTimes(1);
  callbacks.get('exit')!();expect(state.hooks).toHaveBeenCalledTimes(1);
});
it('reports a failed drain and exits unsuccessfully instead of reporting clean shutdown',async()=>{
  const {database,callbacks,exit,log}=fixture();database.drainBackground=async()=>{throw Error('worker exit refused');};
  callbacks.get('SIGTERM')!();await vi.waitFor(()=>expect(exit).toHaveBeenCalledWith(1));
  expect(log).toHaveBeenCalled();expect(database.isOpen).toBe(true);
});
