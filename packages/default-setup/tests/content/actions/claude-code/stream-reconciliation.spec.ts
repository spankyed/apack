import { createClaudeStreamReconciler } from '../../../../src/content/actions/claude-code/_helpers/stream-reconciliation.ts'
const event=(event:unknown)=>({type:'stream_event',event})
const start=(id:string)=>event({type:'message_start',message:{id}})
const block=(index:number)=>event({type:'content_block_start',index,content_block:{type:'text',text:''}})
const delta=(text:string,index=0)=>event({type:'content_block_delta',index,delta:{type:'text_delta',text}})
const stop=()=>event({type:'message_stop'})
const completed=(id:string,text:string,uuid=id)=>({type:'assistant',uuid,message:{id,content:[{type:'text',text}]}})
it('isolates cycles, ignores duplicate completed records and waits for native completion',()=>{
 const r=createClaudeStreamReconciler();r.observe(start('a'));r.observe(block(0));r.observe(delta('Same'))
 expect(r.observe(completed('a','Same'))).toBeUndefined();expect(r.observe(completed('a','Same'))).toBeUndefined();expect(r.observe(stop())).toBeUndefined()
 r.observe(start('b'));r.observe(block(0));r.observe(delta('Same'));r.observe(completed('b','Same'));expect(r.observe(stop())).toBeUndefined()
})
it('compares late records, distinguishes missing suffix from conflict and reports once',()=>{
 const r=createClaudeStreamReconciler();r.observe(start('a'));r.observe(block(0));r.observe(delta('Part'));r.observe(stop())
 expect(r.observe(completed('a','Partial'))).toEqual({apiMessageId:'a',kind:'missing_suffix'})
 expect(r.observe(completed('a','Partial'))).toBeUndefined()
 r.observe(start('b'));r.observe(block(0));r.observe(delta('Wrong'));r.observe(completed('b','Right'));expect(r.observe(stop())).toEqual({apiMessageId:'b',kind:'conflict'})
})
it('preserves native block boundaries, whitespace and parent/Agent isolation',()=>{
 const r=createClaudeStreamReconciler();r.observe(start('a'));r.observe(block(0));r.observe(delta('First '));r.observe(block(2));r.observe(delta('Second',2))
 r.observe({...completed('a','Child'),parent_tool_use_id:'worker'})
 r.observe(completed('a','First ','one'));r.observe(completed('a','Second','two'));expect(r.observe(stop())).toBeUndefined()
 r.clear();expect(r.observe(completed('a','Old'))).toBeUndefined()
})
it('does not call a missing stream a conflict and bounds oversized tracking',()=>{
 const r=createClaudeStreamReconciler();expect(r.observe(completed('a','Completed only'))).toBeUndefined()
 r.observe(start('b'));r.observe(block(0));r.observe(delta('x'.repeat(1024*1024+1)));r.observe(completed('b','Different'));expect(r.observe(stop())).toBeUndefined()
})
