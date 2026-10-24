import ToolActivityBlock from '#extensions/blocks/display/ToolActivityBlock.vue'
import NativeComposerPlacements from '#features/threads/fe/chat/NativeComposerPlacements.vue'
import NativeToolGroups from '#features/threads/fe/chat/NativeToolGroups.vue'
import NativeToolDrawing from '#features/threads/fe/chat/NativeToolDrawing.vue'
import { claudeToolDrawings } from '#extensions/blocks/display/native-tool-drawings.ts'
import { createApp, h, nextTick, computed, provide, ref, type App } from 'vue'
import ThinkingBlock from '#extensions/blocks/display/ThinkingBlock.vue'
import { claudeNativeMessageParts, claudeThinkingMessageParts } from '#features/threads/fe/chat/native-message-parts.ts'
import NativeTranscriptMessage from '#features/threads/fe/chat/NativeTranscriptMessage.vue'
import type { ClaudeUiTranscriptFrame } from '#features/code/be/services/claude-code/ui-presentation.ts'
vi.mock('@apackdev/ui/components/tiptap/TiptapEditor', async () => {
  const { h } = await import('vue')
  return { default: { props: ['modelValue'], setup: (props: { modelValue?: string }) => () => h('div', { 'data-engine-text': true }, props.modelValue) } }
})
const frame = (uuid: string, start: number, text: string): ClaudeUiTranscriptFrame => ({ instanceRevision: 1, component: 'AssistantMessage', messageId: 'app', sessionId: 'session', uuid, text, start, end: start + text.length, isFirstOfReply: start === 0, displayText: 'Display only <script>literal</script>', body: { status: 'live', tree: { kind: 'box', children: [
  { kind: 'box', children: [{ kind: 'unsupported', component: 'engine' }] },
  { kind: 'button', label: 'Inspect row', actionId: uuid + '-action', hotkey: 'i' },
] } } })
let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren() })
it('forwards the engine slot through nested native boxes and keeps native text literal', async () => {
  const press = vi.fn(), root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(NativeTranscriptMessage, { frame: frame('a', 0, 'Stored original'), onPress: press }) }); app.mount(root)
  expect(root.querySelector('[data-engine-text]')?.textContent).toBe('Display only <script>literal</script>')
  expect(root.querySelector('script')).toBeNull()
  expect(root.textContent).not.toContain('Stored original')
  root.querySelector('button')!.click()
  expect(press).toHaveBeenCalledWith('a-action', undefined)
  root.querySelector('[data-native-assistant]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }))
  expect(press).toHaveBeenCalledTimes(2)
  await nextTick()
})
it('preserves unmatched text and a live stream tail and rejects stale/overlapping frames', () => {
  const first = frame('a', 0, 'First'), second = frame('b', 6, 'Second')
  const parts = claudeNativeMessageParts('app', 'First\nSecond\nStill streaming', [second, first])
  expect(parts.map(part => part.kind === 'host' ? part.text : part.frame.uuid)).toEqual(['a', '\n', 'b', '\nStill streaming'])
  expect(claudeNativeMessageParts('other-app', 'First', [first])).toEqual([{ kind: 'host', text: 'First', start: 0 }])
  expect(claudeNativeMessageParts('app', 'Changed', [first])).toEqual([{ kind: 'host', text: 'Changed', start: 0 }])
  expect(claudeNativeMessageParts('app', 'First', [first, first])).toHaveLength(1)
})
it('draws the original normalized text while a row render is pending or unavailable', () => {
  const value = frame('a', 0, 'Stored original'); value.displayText = 'Native normalized original'; value.body = { status: 'error' }
  const root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(NativeTranscriptMessage, { frame: value }) }); app.mount(root)
  expect(root.querySelector('[data-engine-text]')?.textContent).toBe('Native normalized original')
  expect(root.querySelector('[role="status"]')?.textContent).toBe('Claude message controls unavailable')
})


it('keeps user control clicks local while allowing body clicks to reach the host expander', () => {
  const value: ClaudeUiTranscriptFrame = { ...frame('user', 0, 'Typed prompt'), component: 'UserMessage', origin: { kind: 'unclassified' }, isExpanded: false }
  const clicked = vi.fn(), press = vi.fn(), root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h('section', { onClick: clicked }, [h(NativeTranscriptMessage, { frame: value, onPress: press })]) }); app.mount(root)
  expect(root.querySelector('[data-native-user]')?.getAttribute('data-native-user')).toBe('user')
  expect(root.querySelector('[data-native-assistant]')).toBeNull()
  root.querySelector('button')!.click(); expect(press).toHaveBeenCalledOnce(); expect(clicked).not.toHaveBeenCalled()
  root.querySelector<HTMLElement>('[data-engine-text]')!.click(); expect(clicked).toHaveBeenCalledOnce()
})

it('keeps narration out of the body and renders summary engines as literal plaintext', () => {
  const value: ClaudeUiTranscriptFrame = { ...frame('summary', 0, 'Summary'), component: 'AssistantMessage', isFirstOfReply: true, isSummary: true, blockIndex: 1 }
  expect(claudeNativeMessageParts('app', 'Summary', [value])).toEqual([{ kind: 'host', text: 'Summary', start: 0 }])
  expect(claudeNativeMessageParts('app', 'Summary', [value], 0)).toEqual([{ kind: 'host', text: 'Summary', start: 0 }])
  expect(claudeNativeMessageParts('app', 'Summary', [value], 1)[0]).toEqual({ kind: 'native', frame: value })
  const root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(NativeTranscriptMessage, { frame: value }) }); app.mount(root)
  expect(root.querySelector('[data-native-summary]')).not.toBeNull()
  expect(root.querySelector('[data-native-assistant]')).toBeNull()
  expect(root.querySelector('[data-engine-text]')).toBeNull()
  expect(root.querySelector('pre')?.textContent).toBe('Display only <script>literal</script>')
  expect(root.querySelector('script')).toBeNull()
})
it('does not reveal context while a narration hook is pending, and preserves raw thinking', () => {
  const text = ' <context>Hidden</context>\nNarration '
  const block = { content: text + '\n\n<context>Raw</context>', label: 'Thought', state: 'done' as const, nativeMessages: [{ uuid: 'summary', sessionId: 'session', text, start: 0, end: text.length, isSummary: true as const }] }
  expect(claudeThinkingMessageParts('app', 0, block).map(part => part.kind === 'host' && part.text)).toEqual(['Narration', '\n\n<context>Raw</context>'])
  expect(block.content).toContain('Hidden')
})
it('reports actual thinking expansion and removes its native slot on collapse', async () => {
  const view = vi.fn(), root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(ThinkingBlock, { content: 'Original', label: 'Thought', state: 'done', defaultOpen: false, onView: view }, { default: () => h('span', { 'data-summary-slot': true }, 'Native summary') }) }); app.mount(root)
  expect(view).toHaveBeenLastCalledWith(false)
  expect(root.querySelector('[data-summary-slot]')).toBeNull()
  root.querySelector('button')!.click(); await nextTick()
  expect(view).toHaveBeenLastCalledWith(true)
  expect(root.querySelector('[data-summary-slot]')).not.toBeNull()
  root.querySelector('button')!.click(); await nextTick()
  expect(view).toHaveBeenLastCalledWith(false)
  expect(root.querySelector('[data-summary-slot]')).toBeNull()
})

it('renders structured plugin result rewrites as inert text and routes their controls within the owning message', () => {
  const value: ClaudeUiTranscriptFrame = {instanceRevision:1, component: 'ToolResult', messageId: 'app', uuid: 'tool-id', sessionId: 'session', text: 'Original text', start: 0, end: 0, blockIndex: 0, assistantUuid: 'assistant-uuid', resultUuid: 'result', tool: 'Read', isErrored: false, outputRewritten: true, displayText: '{"file":"<script>literal</script>"}', body: { status: 'live', tree: { kind: 'box', children: [{ kind: 'unsupported', component: 'engine' }, { kind: 'button', label: 'Inspect result', actionId: 'action' }] } } }
  const press = vi.fn(), root = document.createElement('div'); document.body.append(root)
  app = createApp({ setup() { provide(claudeToolDrawings, { groups:(ids,fallback)=>fallback(ids), render: (_component, _id, fallback) => fallback(), frames: computed(() => [value]), press, field() {}, expanded() { return undefined }, release() {}, view() {} }); return () => h(NativeToolDrawing, { component: 'ToolResult', toolUseId: 'tool-id' }, () => 'Original fallback') } }); app.mount(root)
  expect(root.querySelector('pre')?.textContent).toBe(value.displayText)
  expect(root.querySelector('script')).toBeNull()
  expect(root.textContent).not.toContain('Original fallback')
  root.querySelector('button')!.click(); expect(press).toHaveBeenCalledWith('action', undefined)
  expect(claudeNativeMessageParts('app', 'Original text', [{ ...value, end: value.text.length }])).toEqual([{ kind: 'host', text: 'Original text', start: 0 }])
})


it('mounts a canonical group once across block fragments while keeping both native child drawings',()=>{
 const tools=[{id:'one',tool:'Read',summary:'first.txt',status:'ok' as const},{id:'two',tool:'Read',summary:'second.txt',status:'ok' as const}]
 const group:ClaudeUiTranscriptFrame={instanceRevision:1,displayText:'',component:'ToolGroup',uuid:'native-group',messageId:'first-message',blockIndex:0,sessionId:'session',text:'',start:0,end:0,revision:'a'.repeat(64),isExpanded:true,isActive:false,usesEngine:true,tools,artifacts:[],body:{status:'live',tree:{kind:'unsupported',component:'engine'}}}
 const children:ClaudeUiTranscriptFrame[]=tools.map((tool,index)=>({instanceRevision:1,component:'ToolUse',uuid:tool.id,messageId:index?'second-message':'first-message',sessionId:'session',text:'',start:0,end:0,blockIndex:0,assistantUuid:'assistant',activityStatus:'ok',engineOutput:'Native '+tool.id,displayText:'',body:{status:'live',tree:{kind:'unsupported',component:'engine'}}}))
 const root=document.createElement('div');document.body.append(root)
 app=createApp({setup(){provide(claudeToolDrawings,{groups:(ids,fallback)=>fallback(ids),render:(component,id,fallback)=>h(NativeToolDrawing,{component,toolUseId:id},fallback),frames:computed(()=>[group,...children]),press(){},field(){},expanded(){return undefined},release(){},view(){}});return()=>h('div',tools.map(tool=>h(NativeToolGroups,{toolUseIds:[tool.id]},()=>h('span','Raw duplicate '+tool.id))))}});app.mount(root)
 expect(root.querySelectorAll('[data-native-tool-group]')).toHaveLength(1)
 expect(root.querySelectorAll('[data-native-tool-use]')).toHaveLength(2)
 expect(root.textContent?.match(/Native one/g)).toHaveLength(1);expect(root.textContent?.match(/Native two/g)).toHaveLength(1)
 expect(root.textContent).not.toContain('Raw duplicate')
})
it('restores ordinary block fragments when native group rendering is unavailable',()=>{
 const group:ClaudeUiTranscriptFrame={instanceRevision:1,displayText:'',component:'ToolGroup',uuid:'native-group',messageId:'app',blockIndex:0,sessionId:'session',text:'',start:0,end:0,revision:'a'.repeat(64),isExpanded:false,isActive:false,usesEngine:true,tools:[{id:'one',tool:'Read',summary:'file',status:'ok'}],artifacts:[],body:{status:'error'}}
 const root=document.createElement('div');document.body.append(root)
 app=createApp({setup(){provide(claudeToolDrawings,{groups:(ids,fallback)=>fallback(ids),render:(_component,_id,fallback)=>fallback(),frames:computed(()=>[group]),press(){},field(){},expanded(){return undefined},release(){},view(){}});return()=>h(NativeToolGroups,{toolUseIds:['one','ungrouped']},{default:({ids}:{ids:string[]})=>h('span',ids.join(','))})}});app.mount(root)
 expect(root.querySelector('[data-native-tool-group]')).toBeNull();expect(root.textContent).toBe('one,ungrouped')
})

it('renders native activity engine output and replacement controls in the composer without raw markup',async()=>{
 const press=vi.fn(),root=document.createElement('div');document.body.append(root)
 const value:ClaudeUiTranscriptFrame={instanceRevision:1,component:'Spinner',uuid:'native-agent',sourceRevision:'a'.repeat(64),messageId:'composer',sessionId:'session',text:'',start:0,end:0,displayText:'',engineOutput:'\x1b[31mNative activity <script>literal</script>\x1b[0m',body:{status:'live',tree:{kind:'box',children:[{kind:'unsupported',component:'engine'},{kind:'button',label:'Inspect activity',actionId:'inspect'}]}}}
 app=createApp({render:()=>h(NativeComposerPlacements,{frames:[value],location:'status',onPress:press})});app.mount(root)
 expect(root.querySelector('[role="status"]')?.textContent).toBe('Native activity <script>literal</script>')
 expect(root.querySelector('script')).toBeNull()
 root.querySelector('button')!.click();expect(press).toHaveBeenCalledWith('inspect',undefined)
 await nextTick()
})

it('reports tool columns from its own mounted row and retires queued measurements on unmount', async () => {
  const { claudeTranscriptLayout } = await import('#features/threads/fe/chat/native-transcript-layout.ts')
  let width = 720, resized: (() => void) | undefined, queued: FrameRequestCallback | undefined
  const disconnect = vi.fn(), cancel = vi.fn(), report = vi.fn()
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback } observe() {} disconnect = disconnect })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queued = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', cancel)
  const widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 8 } as DOMRect))
  try {
    const root = document.createElement('div'); document.body.append(root)
    const value: ClaudeUiTranscriptFrame = { instanceRevision: 7, component:'ToolUse',uuid:'tool',messageId:'app',sessionId:'session',text:'',start:0,end:0,blockIndex:0,assistantUuid:'assistant',activityStatus:'ok',displayText:'',body:{status:'rendering'} }
    app = createApp({ setup() { provide(claudeTranscriptLayout, report); return () => h(NativeTranscriptMessage, { frame:value }) } }); app.mount(root); await nextTick()
    queued?.(0)
    expect(report).toHaveBeenLastCalledWith({ component:'ToolUse',uuid:'tool',instanceRevision:7,columns:90 })
    width = 320; resized?.(); queued?.(0)
    expect(report).toHaveBeenLastCalledWith({ component:'ToolUse',uuid:'tool',instanceRevision:7,columns:40 })
    const count = report.mock.calls.length; resized?.(); queued?.(0); expect(report).toHaveBeenCalledTimes(count)
    resized?.(); const retired = queued; app.unmount(); app = undefined
    expect(disconnect).toHaveBeenCalled(); expect(cancel).toHaveBeenCalled()
    width = 600; retired?.(0); expect(report).toHaveBeenCalledTimes(count)
  } finally { widthSpy.mockRestore(); bounds.mockRestore(); vi.unstubAllGlobals() }
})


it('retains a reader-opened native task across display remount while releasing native visibility', async () => {
 const root=document.createElement('div');document.body.append(root)
 const key=ref(0), expansion=new Map<string,boolean>(), visibility=vi.fn()
 const entries=[{id:'task-tool',tool:'Agent',status:'ok' as const,summary:'Worker',nativeAgent:{id:'owned-agent',name:'Worker',status:'completed' as const}}]
 app=createApp({setup(){provide(claudeToolDrawings,{
  groups:(ids,fallback)=>fallback(ids),render:(_component,_id,fallback)=>fallback(),frames:computed(()=>[]),press(){},field(){},
  expanded:id=>expansion.get(id),view:(id,open)=>{expansion.set(id,open);visibility(id,open)},release:id=>visibility(id,false,'release'),
 });return()=>h(ToolActivityBlock,{key:key.value,entries,label:'Native tools',state:'done'})}})
 app.mount(root);await nextTick()
 expect(root.querySelector('[data-native-agent-id="owned-agent"]')).toBeNull()
 ;(root.querySelector('button') as HTMLButtonElement).click();await nextTick()
 expect(root.querySelector('[data-native-agent-id="owned-agent"]')).not.toBeNull()
 expect(expansion.get('task-tool')).toBe(true)
 visibility.mockClear();key.value++;await nextTick()
 expect(visibility.mock.calls).toContainEqual(['task-tool',false,'release'])
 expect(expansion.get('task-tool')).toBe(true)
 expect(root.querySelector('[data-native-agent-id="owned-agent"]')).not.toBeNull()
 ;(root.querySelector('button') as HTMLButtonElement).click();await nextTick();key.value++;await nextTick()
 expect(root.querySelector('[data-native-agent-id="owned-agent"]')).toBeNull()
 expect(expansion.get('task-tool')).toBe(false)
})
