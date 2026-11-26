import { projectClaudeUiLog } from '../../../../src/content/actions/claude-code/_helpers/native-ui-log.ts'
const sessionId = '11111111-1111-1111-1111-111111111111'
const uuid = '22222222-2222-2222-2222-222222222222'
const row = { type: 'system', subtype: 'ui_log', session_id: sessionId, uuid, plugin: 'review', text: '<b>literal</b>  ' }
it('retains original notice text and identity without model provenance', () => {
  expect(projectClaudeUiLog(row, sessionId)).toEqual({uuid,sessionId,plugin:'review',text:'review: <b>literal</b>  '})
  expect(projectClaudeUiLog({...row,text:''}, sessionId)?.text).toBe('review: ')
})
it('refuses malformed, unrelated and foreign-session events', () => {
  for (const changes of [{type:'assistant'},{subtype:'ui_toast'},{session_id:'foreign'},{uuid:''},{plugin:''},{text:null}]) {
    expect(projectClaudeUiLog({...row,...changes},sessionId)).toBeUndefined()
  }
  expect(projectClaudeUiLog(row,undefined)).toBeUndefined()
})
