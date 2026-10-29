import {writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {mockService,startApp,importFlows} from '@apackdev/testing/harness';
import {importCompiledContent} from '@apackdev/sdk/utils';
import {actionLabel} from '../../../_support/flows.ts';
import {getClaudeState} from '../../../../src/content/actions/claude-code/_helpers/thread-context.ts';
import {services,type Services} from '#generated/services.ts';
import {repository} from '#generated/repository.ts';
import {query} from '#features/code/be/services/claude-code/query.ts';
import * as store from '#features/code/be/services/claude-code/handle-store.ts';
import type {ClaudeConversationTurn} from '#features/code/be/services/claude-code/conversation.ts';
import type {StreamLine,QueryOptions,ResultLine} from '#features/code/be/services/claude-code/types.ts';
import {chatService} from '#features/threads/be/services/chat.ts';
vi.mock('../../../../src/content/actions/claude-code/_helpers/context-usage.ts',()=>({refreshThreadContextUsage:vi.fn(async()=>{})}));
const executable=process.env.CLAUDE_RESEARCH_EXECUTABLE,workspace=process.env.CLAUDE_RESEARCH_WORKSPACE,endpoint=process.env.CLAUDE_RESEARCH_MODEL_URL;
it.skipIf(!executable||!workspace||!endpoint)('persists costs and session identity across native clear through compiled Chat',async()=>{
 expect(process.env.HOME).toBe(workspace);expect(new URL(endpoint!).hostname).toBe('127.0.0.1');
 const cwd=join(workspace!,'project');
 const {id}=repository.threadCommands.create({topic:'Native compiled clear',instructions:'',tags:[]});
 repository.threadCommands.update(id,{context:{claudeCode:{cwd}}});
 mockService<Services,'chat'>('chat',{...chatService,resolveReferences:vi.fn(async()=>({textPrefix:'',imageBlocks:[],addDirs:[]}))});
 mockService<Services,'logger'>('logger',{debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()});
 mockService<Services,'threads'>('threads',{updateChatState:vi.fn()});
 const events:StreamLine[]=[];
 let owner!:Awaited<ReturnType<typeof store.openConversation>>;
 const opened=vi.fn(async(key:string,launchKey:string,options:QueryOptions,consume:(turn:ClaudeConversationTurn)=>Promise<void>)=>{
  const native=await query({...options,cwd,cliPath:executable,env:{...Object.fromEntries(Object.keys(process.env).map(key=>[key,undefined])),PATH:process.env.PATH,HOME:workspace,CLAUDE_CONFIG_DIR:join(workspace!,'.claude'),ANTHROPIC_BASE_URL:endpoint,DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},settingSources:['user'],model:'sonnet',tools:[],strictMcpConfig:true,keepStdinOpen:true,surfaceControlRequests:true,signal:AbortSignal.timeout(20000)});
  owner=await store.openConversation(key,launchKey,async()=>native,consume);owner.subscribe(event=>events.push(event));return owner;
 });
 mockService<Services,'cli'>('cli',{claudeCode:{openConversation:opened,getConversation:store.getConversation,isConversationBusy:store.isConversationBusy,closeIdleConversation:store.closeIdleConversation,getHandle:store.getHandle,isCurrentTurn:store.isCurrentTurn,storeHandle:store.storeHandle,clearHandle:store.clearHandle,sessionExists:vi.fn(async()=>true)} as never});
 const compiledDir=resolve(import.meta.dirname,'../../../../dist/runtime/content');
 importCompiledContent({compiledDir,include:{flows:new Set(),library:new Set(),notes:new Set(),settings:new Set()}});
 const flows=JSON.parse(readFileSync(resolve(compiledDir,'flows.content.json'),'utf8'));importFlows({'Claude Code':{...flows['Claude Code'],root:true}});
 const app=await startApp({systems:['brain']});await app.runFlow('Claude Code');
 const costs:number[]=[];const sessions:Array<string|undefined>=[];
 const invoke=async(text:string,turn:number)=>{
  const run=await app.runFlow('Claude Code',{event:'user.message',data:{threadId:id,text,mode:'Claude Code'}});
  expect(run.steps.map(actionLabel)).toContain('Claude Code Chat');
  await vi.waitFor(()=>expect(getClaudeState(services,id)?.turns).toBe(turn),{timeout:7000});
  costs.push(getClaudeState(services,id)?.totalCostUsd??0);sessions.push(getClaudeState(services,id)?.sessionId);
  expect(owner.sessionId).toBe(sessions.at(-1));expect(owner.busy).toBe(false);
 };
 try{
  await invoke('First fixed synthetic text before clear.',1);
  const messageIds=(repository.chatQueries.threadData(id)?.messages??[]).map(message=>message.id);
  await invoke('/clear',2);
  expect((repository.chatQueries.threadData(id)?.messages??[]).map(message=>message.id)).toEqual(expect.arrayContaining(messageIds));
  await invoke('Second fixed synthetic text after clear.',3);
  expect(opened).toHaveBeenCalledOnce();expect(sessions[1]).not.toBe(sessions[0]);expect(sessions[2]).toBe(sessions[1]);
  const terminal=events.filter((event):event is ResultLine=>event.type==='result');expect(terminal).toHaveLength(3);
  const totals=terminal.map(event=>Number(event.total_cost_usd));expect(totals[0]).toBeGreaterThan(0);expect(totals[1]).toBe(0);expect(totals[2]).toBeGreaterThan(0);
  expect(costs[0]).toBeCloseTo(totals[0],12);expect(costs[1]).toBeCloseTo(totals[0],12);expect(costs[2]).toBeCloseTo(totals[0]+totals[2],12);
  await owner.close();
  const projected=events.map(event=>{
   const line=event as Record<string,unknown>;
   return {type:event.type,...typeof line.subtype==='string'&&{subtype:line.subtype},...typeof line.session_id==='string'&&{sessionId:line.session_id},...typeof line.user_message_uuid==='string'&&{inputId:line.user_message_uuid},...typeof line.new_conversation_id==='string'&&{newConversationId:line.new_conversation_id}};
  });
  const reset=projected.find(event=>event.type==='conversation_reset')!;
  await writeFile(join(workspace!,'compiled-reset-evidence.json'),JSON.stringify({evidence:'apack-native-conversation-reset',owner:true,compiledFlow:true,sameOwner:true,firstSessionId:sessions[0],nextSessionId:sessions[2],resetSessionId:reset.sessionId,newConversationId:reset.newConversationId,clearInputId:terminal[1].user_message_uuid,clearResults:1,events:projected,turns:totals.map((totalCostUsd,index)=>({totalCostUsd,chargedCostUsd:costs[index]-(costs[index-1]??0)})),expectedCost:totals[0]+totals[2],chargedCost:costs[2],costAccountingMatches:Math.abs(costs[2]-totals[0]-totals[2])<1e-12,appMessagesPreserved:true,closed:true,qualification:'Actual compiled Chat and completion actions/flow with real native query and source retained owner. Persisted app cost/session state verified; no renderer or other reset/child variants.'},null,2));
 }finally{store.killAllHandles();}
},20000);
