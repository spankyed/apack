import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'
const start=claudeTerminalUiRuntime.indexOf('function questionPresentation(')
const end=claudeTerminalUiRuntime.indexOf('const schemaNames=',start)
const present=vm.runInNewContext(claudeTerminalUiRuntime.slice(start,end)+';questionPresentation')
it('reads only the original current-call notice and uses its native formatter through updates/clear', () => {
  const notices=new Map([['current',{plugin:'review',text:'First'}],['foreign',{plugin:'other',text:'Hidden'}]])
  const format=vi.fn((plugin:string,text:string)=>plugin+': native '+text)
  const n={runtime:{RFe:{noticesStore:()=>({getState:()=>notices})},z4e:format},questionOptions:{yjr:()=>null,ZCe:()=>false,Hzo:()=>true}}
  const payload={requestId:'current',questions:[]}
  expect(present(n,payload).notice).toBe('review: native First')
  expect(format).toHaveBeenCalledWith('review','First')
  notices.set('current',{plugin:'review',text:'Updated'})
  expect(present(n,payload).notice).toBe('review: native Updated')
  notices.delete('current')
  expect(present(n,payload).notice).toBeUndefined()
  expect(present(n,{...payload,requestId:'missing'}).notice).toBeUndefined()
})
