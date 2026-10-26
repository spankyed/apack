// Authored protocol fixture. No vendor CLI, credentials or model network requests.
const {randomUUID}=require('node:crypto');const {createInterface}=require('node:readline');
const args=process.argv.slice(2),pick=key=>args[args.indexOf(key)+1];
if(args.includes('--version')) {console.log('2.1.302 (Claude Code)');process.exit(0)}
if(args.includes('auth')) {console.log(JSON.stringify({loggedIn:true}));process.exit(0)}
let session=args.includes('--resume')?pick('--resume'):randomUUID(),turn=0,mode=args.includes('--permission-mode')?pick('--permission-mode'):'default';
const fs=require('node:fs'),path=require('node:path');
const config=process.env.CLAUDE_CONFIG_DIR;
if(!config || !/^\/(?:private\/)?tmp\/apack-transport-config-/.test(config)) throw Error('An owned private fixture config is required');
const cwd=path.dirname(process.argv[1]);
const bucket=path.join(config,'projects',cwd.replace(/[^a-zA-Z0-9]/g,'-'));fs.mkdirSync(bucket,{recursive:true});
const journal=path.join(bucket,session+'.jsonl');fs.appendFileSync(journal,'');
const receipt=value=>fs.appendFileSync(path.join(config,'protocol-receipts.jsonl'),JSON.stringify({pid:process.pid,session,mode,...value})+'\n');
receipt({event:'launch'});
const emit=x=>{if(x.type==='user'||x.type==='assistant')fs.appendFileSync(journal,JSON.stringify({...x,sessionId:session})+'\n');process.stdout.write(JSON.stringify(x)+'\n')};
createInterface({input:process.stdin}).on('line',raw=>{
 const line=JSON.parse(raw),r=line.request??{};
 receipt({event:line.type,control:r.subtype});
 if(line.type==='control_request') {
  let response={};
  if(r.subtype==='initialize') {response={commands:[],agents:[],models:[],current_permission_mode:mode,capabilities:['ui_surface_v1']};emit({type:'system',subtype:'init',session_id:session,model:'fixture',cwd})}
  if(r.subtype==='set_permission_mode') {mode=r.mode;response={mode}}
  if(r.subtype==='get_settings') response={effective:{},sources:[]};
  if(r.subtype==='ui_attach') response={surfaces:['desktop']};
  if(r.subtype==='ui_detach') response={surfaces:[],detached:true};
  if(r.subtype==='ui_prompt_edit') response={text:r.text,cursor:r.cursor};
  if(r.subtype==='ui_prompt_autocomplete') response={suggestions:[]};
  if(r.subtype==='ui_focus') response={moved:false,element:null};
  if(r.subtype==='ui_panes') response={panes:[],shown_id:null,focused_id:null,focus_requested_id:null};
  if(r.subtype==='ui_render') response={tree:{type:'Box',children:[]},props:{},rewritten:false,hooked:false};
  if(r.subtype==='get_plan') response={exists:false};
  if(r.subtype==='list_models') response={models:[]};
  if(r.subtype==='get_context_usage') response={model:'fixture',totalTokens:10,maxTokens:200000,percentage:0.005,memoryFiles:[],categories:[]};
  if(r.subtype==='mcp_status') response={mcpServers:[]};
  emit({type:'control_response',response:{subtype:'success',request_id:line.request_id,response}});return;
 }
 if(line.type!=='user')return;
 turn++;const text=JSON.stringify(line.message?.content??''),id=randomUUID(),uuid=randomUUID();
 emit({type:'command_lifecycle',state:'started',command_uuid:line.uuid});
 emit({type:'user',uuid:line.uuid,session_id:session,isReplay:true,message:line.message});
 const stream=event=>emit({type:'stream_event',session_id:session,event});
 const conflict=text.includes('Exercise a conflict.'),partial=text.includes('Recover a missing suffix.');
 const completed=conflict?'Completed native answer differs.':'Release checklist reviewed successfully.';
 const streamed=conflict?'Partial displayed answer.':partial?'Release checklist':completed;
 stream({type:'message_start',message:{id,role:'assistant',content:[]}});
 stream({type:'content_block_start',index:0,content_block:{type:'text',text:''}});
 stream({type:'content_block_delta',index:0,delta:{type:'text_delta',text:streamed}});
 emit({type:'assistant',uuid,session_id:session,message:{id,role:'assistant',content:[{type:'text',text:completed}]}});
 stream({type:'content_block_stop',index:0});stream({type:'message_stop'});
 if(!text.includes('Start a fresh review without a billing observation.')) emit({type:'rate_limit_event',session_id:session,rate_limit_info:{status:text.includes('reject')?'rejected':text.includes('warning')?'allowed_warning':'allowed',isUsingOverage:text.includes('credits'),resetsAt:1800000000}});
 emit({type:'result',subtype:'success',is_error:false,session_id:session,user_message_uuid:line.uuid,result:completed,total_cost_usd:turn*0.01,num_turns:1,duration_ms:10,usage:{input_tokens:10,output_tokens:10}});
}).on('close',()=>process.exit(0));
