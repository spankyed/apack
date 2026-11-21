import vm from 'node:vm'
import {isClaudeNativeInterruption} from '#features/code/common/native-interruption.ts'
const marker='[Request interrupted by user for tool use]'
const row={type:'user',message:{content:[{type:'text',text:marker}]}}
it('recognizes both original lone interruption envelopes',()=>{expect(isClaudeNativeInterruption(row)).toBe(true);expect(isClaudeNativeInterruption({...row,message:{content:[{type:'text',text:'[Request interrupted by user]'}]}})).toBe(true)})
it('keeps literal human messages and mixed/rich payloads visible',()=>{for(const value of [{...row,origin:{kind:'human'}},{...row,message:{content:marker}},{...row,message:{content:[{type:'text',text:marker+' keep this literal'}]}},{...row,message:{content:[...row.message.content,{type:'image',source:{}}]}},{...row,type:'assistant'},null])expect(isClaudeNativeInterruption(value)).toBe(false)})
it('keeps the journal predicate self-contained for isolated verification',()=>{const native=vm.runInNewContext('('+isClaudeNativeInterruption.toString()+')');expect(native(row)).toBe(true);expect(native({...row,origin:{kind:'human'}})).toBe(false)})
