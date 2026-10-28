import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalRefusalRuntime } from '#features/code/be/services/claude-code/terminal-refusal-runtime.ts'
import { ClaudeNativeNoticeSchema, isClaudeNativeNoticeDecision } from '#features/code/common/native-notice.ts'
function fixture() {
  const sessionId = randomUUID(), payload = { originalModel: 'Opus 5', fallbackModel: 'Opus 4.8', retractedMessageUuids: [randomUUID()] }
  const item = { id: randomUUID(), kind: 'refusal_fallback_prompt', payload }, open = [item]
  const closed: ((event: {id:string;type:string;result:string})=>void)[] = []
  const settle = (result:string) => { const current=open.shift();if(current)for(const listener of closed)listener({id:current.id,type:'answered',result}) }
  const onChange = vi.fn((decision:string) => settle(decision)), onCancel = vi.fn(() => settle('cancelled'))
  const control = { options: [{ value: 'retry_fallback', label: 'Retry on Opus 4.8' }, { value: 'edit_prompt', label: 'Edit prompt' }], onChange, onCancel, isDisabled: false }
  const UCe = () => {}, Xe = () => {}, hashes = new Map([['5c0cdd900e2aff12b223358a8e67a3e0757edda8dba0e7aed14c02b45480a331', createHash('sha256').update(UCe.toString()).digest('hex')], ['e4dae558e89660907f9bba0c9481fcbc49b0b2efb6c32e5695b4799212e419a5', createHash('sha256').update(Xe.toString()).digest('hex')]])
  const row = Array<unknown>(48); row[9] = control.options; row[17] = 'Session paused'; row[21] = '<b>Original explanation</b>'; row[22] = 'Original provider guidance'
  const root = { type: UCe, memoizedProps: { payload, wouldTakeAnswer: () => true }, updateQueue: { memoCache: { data: [row] } }, child: { type: Xe, memoizedProps: control } }
  const store = { getState: () => ({ open }), subscribe: () => () => {}, onClosed: (listener: typeof closed[number]) => { closed.push(listener); return () => {} } }
  const humanUuid=randomUUID(),users=[{type:'user',uuid:humanUuid,origin:{kind:'human'}}];let turn:{turnId:string}|undefined={turnId:randomUUID()},draft={text:'',cursor:0};const askHost=vi.fn(async()=>({filled:true}));
  const binding = { messages:()=>users,composer:{read:async()=>draft},surface: 'terminal', toolContext: () => ({ dialogStore: store,getAppState:()=>({viewingAgentTaskId:undefined}) }) }
  const n = { runtime:{lpe:()=>turn,ey:()=>binding},roster:{Kw:{list:()=>[{clientId:'desktop',answers:['ui_prompt_fill']}]}},themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) }, questionOptions: { q: () => sessionId } }
  const format = vi.fn(async (_n: unknown, value: unknown) => value || '')
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalRefusalRuntime) + ';({read:nativeRefusal,project:projectNativeRefusal,answer:answerNativeRefusal,restore:restoreNativeRefusalDraft})', { originalContext: binding, clients:new Set(['desktop']),clientViewCurrent:()=>true,askHost,AbortController, process: { stdout: undefined }, composerFunctionHashes: new WeakMap(), createHash, nativeFunctionName: (name: string) => name, nativeFunctionHash: (hash: string) => hashes.get(hash), readFileSync: () => JSON.stringify({ sessionId }), configUrl: 'private', randomUUID, dialogRevisions: new Map(), nativeGenericPermissionText: format })
  const request = () => { const d = runtime.read(n); return { id: d.item.id, revision: d.revision, session_id: d.sessionId } }
  return { runtime, n, root, row, control, open, item, payload,store,humanUuid,users,askHost,finishRewind(){turn=undefined;users.length=0;draft={text:'Original native draft',cursor:21}},replaceTurn(){turn={turnId:randomUUID()}}, onChange, onCancel, request, format, settle, sessionId, closed }
}
it.each(['retry_fallback', 'edit_prompt', 'cancelled'])('settles %s only through the current original callback', async decision => {
  const f = fixture(), shown = await f.runtime.project(f.n, f.runtime.read(f.n)), request = { ...f.request(), decision }
  expect(ClaudeNativeNoticeSchema.parse(shown)).toMatchObject({ title: 'Session paused', paragraphs: ['<b>Original explanation</b>', 'Original provider guidance'], originalModel: 'Opus 5', fallbackModel: 'Opus 4.8' })
  expect(isClaudeNativeNoticeDecision(shown, decision)).toBe(true)
  f.runtime.answer(f.n, request)
  if (decision === 'cancelled') { expect(f.onCancel).toHaveBeenCalledOnce(); expect(f.onChange).not.toHaveBeenCalled() }
  else { expect(f.onChange).toHaveBeenCalledExactlyOnceWith(decision); expect(f.onCancel).not.toHaveBeenCalled() }
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
})
it('refuses foreign, invalid and payload-stale consent', () => {
  const f = fixture(), request = { ...f.request(), decision: 'retry_fallback' }
  expect(() => f.runtime.answer(f.n, { ...request, session_id: randomUUID() })).toThrow('expired')
  expect(() => f.runtime.answer(f.n, { ...request, id: randomUUID() })).toThrow('expired')
  expect(() => f.runtime.answer(f.n, { ...request, decision: 'continue' })).toThrow('Invalid')
  f.payload.fallbackModel = 'Changed target'
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired'); expect(f.onChange).not.toHaveBeenCalled()
})
it('refuses changed native option labels and replaced requests', () => {
  const f = fixture(), request = { ...f.request(), decision: 'retry_fallback' }
  f.control.options[0]!.label = 'Different consent'
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  const fresh = { ...f.request(), decision: 'retry_fallback' }; f.open.splice(0, 1, { ...f.item })
  expect(() => f.runtime.answer(f.n, fresh)).toThrow('expired'); expect(f.onChange).not.toHaveBeenCalled()
})
it('withdraws held, disabled, competing or unmounted controls', () => {
  const f = fixture(), request = { ...f.request(), decision: 'cancelled' }
  f.root.memoizedProps.wouldTakeAnswer = () => false
  expect(f.runtime.read(f.n).item).toBeUndefined(); expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  f.root.memoizedProps.wouldTakeAnswer = () => true; f.control.isDisabled = true
  expect(f.runtime.read(f.n).item).toBeUndefined()
  f.control.isDisabled = false; f.open.push({ ...f.item })
  expect(f.runtime.read(f.n).item).toBeUndefined()
  f.open.pop(); f.root.child.memoizedProps = { ...f.control, options: [] }
  expect(f.runtime.read(f.n).item).toBeUndefined(); expect(f.onCancel).not.toHaveBeenCalled()
})
it('refuses a changed producer or a native callback that does not settle', () => {
  const f = fixture(), request = { ...f.request(), decision: 'edit_prompt' }
  f.onChange.mockImplementation(() => {})
  expect(() => f.runtime.answer(f.n, request)).toThrow('did not accept')
  const UCe = () => 'changed'; f.root.type = UCe
  expect(() => f.runtime.read(f.n)).toThrow('producer changed')
})
it('does not publish a presentation that changed during formatting', async () => {
  const f = fixture(), d = f.runtime.read(f.n)
  f.format.mockImplementation(async () => { f.payload.fallbackModel = 'New target'; return 'Original text' })
  await expect(f.runtime.project(f.n, d)).rejects.toThrow('changed while formatting')
})

it('keeps the help URL from the original rich text instead of losing it during text rendering', async () => {
  const f = fixture(), helpUrl = 'https://support.claude.com/en/articles/16049681'
  f.row[21] = { props: { children: 'You can learn more: '+helpUrl } }
  f.format.mockImplementation(async () => 'You can learn more')
  const notice = await f.runtime.project(f.n, f.runtime.read(f.n))
  const parsed = ClaudeNativeNoticeSchema.parse(notice)
  if (parsed.kind !== 'refusal_fallback_prompt') throw Error('Expected refusal notice')
  expect(parsed.helpUrl).toBe(helpUrl)
})

it('retires only original identities after original settlement, including native cancellation outside the app', () => {
  const f=fixture(), request=f.request()
  expect(f.runtime.read(f.n).retirements).toEqual([])
  f.root.memoizedProps.wouldTakeAnswer=()=>false
  expect(()=>f.runtime.answer(f.n,{...request,decision:'cancelled'})).toThrow()
  expect(f.runtime.read(f.n).retirements).toEqual([])
  for(const listener of f.closed)listener({id:'foreign',type:'answered',result:'cancelled'})
  expect(f.runtime.read(f.n).retirements).toEqual([])
  f.settle('cancelled')
  expect(f.runtime.read(f.n).retirements).toEqual([{sessionId:f.sessionId,uuids:f.payload.retractedMessageUuids}])
})


it('waits for the original Edit rewind, mirrors its removed human identity and fills only an empty host once',async()=>{
 const f=fixture();f.runtime.answer(f.n,{...f.request(),decision:'edit_prompt'});
 await f.runtime.restore(f.n,f.store);expect(f.askHost).not.toHaveBeenCalled();
 f.finishRewind();await f.runtime.restore(f.n,f.store);
 expect(f.askHost).toHaveBeenCalledExactlyOnceWith('ui_prompt_fill',{clientId:'desktop',text:'Original native draft',mode:'replace',ifEmpty:true});
 expect(f.runtime.read(f.n).retirements).toEqual([{sessionId:f.sessionId,uuids:f.payload.retractedMessageUuids,rewoundUserUuids:[f.humanUuid]}]);
 await f.runtime.restore(f.n,f.store);expect(f.askHost).toHaveBeenCalledOnce();
});
it('never restores a previous Edit across a replacement turn',async()=>{
 const f=fixture();f.runtime.answer(f.n,{...f.request(),decision:'edit_prompt'});f.replaceTurn();await f.runtime.restore(f.n,f.store);f.finishRewind();await f.runtime.restore(f.n,f.store);expect(f.askHost).not.toHaveBeenCalled();
});
