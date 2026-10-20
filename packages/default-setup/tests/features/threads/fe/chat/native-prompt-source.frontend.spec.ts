import { Editor, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { ClaudePromptSource, claudePromptSourceReferences } from '#features/threads/fe/chat/native-prompt-source.ts'
import { bindClaudePromptEditor } from '#features/threads/fe/chat/native-prompt-editor.ts'

let editor: Editor
const reference=Node.create({name:'reference',inline:true,group:'inline',atom:true,
  addAttributes:()=>({refType:{default:'thread'},refId:{default:'thread-id'},shortCode:{default:'T-1'},label:{default:'Context'}}),
  parseHTML:()=>[{tag:'a[href="apack-ref://thread/thread-id"]'}],renderHTML:()=>['a',{href:'apack-ref://thread/thread-id'},'Context'],
  addStorage:()=>({markdown:{serialize(state:{write(text:string):void}){state.write('[Context](apack-ref://thread/thread-id)')}}}),
})
beforeEach(()=>{editor=new Editor({extensions:[StarterKit,Markdown,ClaudePromptSource,reference],content:'seed'})})
afterEach(()=>editor.destroy())
const text=()=> (editor.storage as any).markdown.getMarkdown() as string

it.each([
  {source:'**safe**',cursor:1},
  {source:'~~~typescript\nconst ready = true\n~~~',cursor:5},
  {source:'# Heading\n\nBody',cursor:1},
])('keeps exact native source and a caret inside hidden syntax: $source',async({source,cursor})=>{
  const send=vi.fn(),problem=vi.fn(),bridge=bindClaudePromptEditor(editor,send,problem)
  bridge.receive({revision:bridge.revision,status:'applied',frame:{text:source,cursor}})
  expect(text()).toBe(source);expect(editor.state.doc.firstChild?.type.name).toBe('claudePromptSource')
  expect(bridge.readDraft()).toEqual({text:source,cursor});expect(await bridge.settle()).toBe(true)
  editor.view.dom.dispatchEvent(new Event('beforeinput',{bubbles:true}));editor.commands.insertContent('X')
  expect(send.mock.lastCall![0]).toMatchObject({by:'person',text:source.slice(0,cursor)+'X'+source.slice(cursor),cursor:cursor+1})
  expect(problem).toHaveBeenLastCalledWith(undefined);bridge.dispose()
})

it('retains raw outer whitespace and fill text ending at a hidden closing fence',()=>{
  const bridge=bindClaudePromptEditor(editor,vi.fn(),vi.fn())
  const source='  ~~~ts\nconst ready = true\n~~~  '
  bridge.receive({revision:bridge.revision,status:'applied',frame:{text:source,cursor:source.length}})
  expect(text()).toBe(source);expect(bridge.readDraft()).toEqual({text:source,cursor:source.length})
  expect(bridge.fillDraft({mode:'append',text:'\nnext'},bridge.revision)).toBe(true)
  expect(text()).toBe(source+'\nnext');bridge.dispose()
})

it('retains a linked target through raw URI caret placement but drops former context after a person edits the URI',()=>{
  editor.commands.setContent({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Use '},{type:'reference'},{type:'text',text:' today'}]}]})
  const source='# Heading\n\n'+text(),cursor=source.indexOf('thread-id')+2
  const bridge=bindClaudePromptEditor(editor,vi.fn(),vi.fn())
  bridge.receive({revision:bridge.revision,status:'applied',frame:{text:source,cursor}})
  expect(text()).toBe(source);expect(bridge.readDraft()?.cursor).toBe(cursor)
  expect(claudePromptSourceReferences(editor.state.doc.firstChild!)).toEqual([{refType:'thread',refId:'thread-id',shortCode:'T-1',label:'Context'}])
  editor.view.dom.dispatchEvent(new Event('beforeinput',{bubbles:true}));editor.commands.insertContent('X')
  expect(claudePromptSourceReferences(editor.state.doc.firstChild!)).toEqual([])
  bridge.dispose()
})

it('refuses native atom removal rather than silently dropping context metadata',async()=>{
  editor.commands.setContent({type:'doc',content:[{type:'paragraph',content:[{type:'reference'}]}]})
  const before=editor.state.doc,bridge=bindClaudePromptEditor(editor,vi.fn(),vi.fn())
  bridge.receive({revision:bridge.revision,status:'applied',frame:{text:'**gone**',cursor:1}})
  expect(editor.state.doc).toBe(before);expect(await bridge.settle()).toBe(false);bridge.dispose()
})

it('does not let raw fallback bypass composition, stale revisions or invalid cursor guards',async()=>{
  const send=vi.fn(),bridge=bindClaudePromptEditor(editor,send,vi.fn()),old=bridge.revision
  editor.commands.insertContent('new');const before=editor.state.doc
  bridge.receive({revision:old,status:'applied',frame:{text:'**old**',cursor:1}});expect(editor.state.doc).toBe(before)
  Object.defineProperty(editor.view,'composing',{configurable:true,value:true})
  bridge.receive({revision:bridge.revision,status:'applied',frame:{text:'**new**',cursor:1}})
  expect(editor.state.doc).toBe(before);expect(await bridge.settle()).toBe(false);bridge.dispose()
  Object.defineProperty(editor.view,'composing',{configurable:true,value:false})
  const next=bindClaudePromptEditor(editor,vi.fn(),vi.fn())
  next.receive({revision:next.revision,status:'applied',frame:{text:'x',cursor:2}})
  expect(editor.state.doc).toBe(before);expect(await next.settle()).toBe(false);next.dispose()
})
