import {createApp,h,reactive,ref,nextTick} from 'vue'
import NativeQuestionDrawing from '#features/threads/fe/chat/NativeQuestionDrawing.vue'
import type {ClaudeUiQuestionFrame} from '#features/code/be/services/claude-code/ui-presentation.ts'

it('reveals the focused answer label between the sticky heading and actions', () => {
  const frame: ClaudeUiQuestionFrame = {
    messageId: 'question', id: 'dialog', revision: 'revision', draftActionId: 'draft', token: 'drawing',
    shownInput: { questions: [{
      question: 'Who should see the release notes?', header: 'Audience', multiSelect: false,
      options: [{ label: 'Developers' }, { label: 'Operators' }],
    }] },
    body: { status: 'live', tree: { kind: 'box', children: [
      { kind: 'text', text: 'Choose the audience for the migration notes.' },
      { kind: 'unsupported', component: 'engine' },
    ] } },
  }
  const root = document.body.appendChild(document.createElement('div'))
  const app = createApp({ render: () => h(NativeQuestionDrawing, { frame }) })
  app.mount(root)
  try {
    const drawing = root.querySelector<HTMLElement>('.question-drawing')!
    const rows = [...drawing.querySelectorAll('.option')]
    const rect = (element: Element, top: number, height: number) =>
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, top, 400, height))
    rect(drawing, 250, 300)
    rect(drawing.querySelector('header')!, 250, 90)
    rect(drawing.querySelector('footer')!, 500, 50)
    rect(rows[0]!, 325, 70)
    const second = rect(rows[1]!, 455, 70)
    drawing.scrollTop = 100
    rows[0]!.querySelector('input')!.focus()
    expect(drawing.scrollTop).toBe(85)
    rows[1]!.querySelector('input')!.focus()
    expect(drawing.scrollTop).toBe(110)
    second.mockReturnValue(new DOMRect(0, 410, 400, 70))
    drawing.querySelector('footer button')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    rows[1]!.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(drawing.scrollTop).toBe(110)
  } finally {
    app.unmount()
    root.remove()
  }
})

it('blocks decisions while its native frame is pending and exposes retry errors without caller duplication',async()=>{
 const frame=reactive<ClaudeUiQuestionFrame>({messageId:'question',id:'dialog',revision:'revision',draftActionId:'draft',token:'drawing',shownInput:{questions:[{question:'Who should the release address?',header:'Audience',options:[{label:'Developers',description:'People integrating the change'},{label:'Operators',description:'People deploying it'}],multiSelect:false}]},body:{status:'live',tree:{kind:'unsupported',component:'engine'}}})
 const root=document.createElement('div');document.body.append(root);const reject=vi.fn(),pause=vi.fn(),pending=ref(true),app=createApp({render:()=>h(NativeQuestionDrawing,{frame,pending:pending.value,canReject:true,onReject:reject,onPause:pause})});app.mount(root)
 try{
  const button=()=>[...root.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='Reject question')!
  expect(button().getAttribute('aria-disabled')).toBe('true');button().click();expect(reject).not.toHaveBeenCalled()
  expect(root.querySelector('[role="status"]')?.textContent).toBe('Waiting for Claude…');expect(root.querySelector('[aria-label="Question details"]')?.getAttribute('aria-busy')).toBe('true')
  const cancel=[...root.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='Cancel')!
  expect(cancel.disabled).toBe(false);cancel.click()
  expect(pause).toHaveBeenCalledExactlyOnceWith({messageId:'question',token:'drawing'})
  frame.pending=true;await nextTick();expect(cancel.disabled).toBe(true)
  pending.value=false;frame.pending=false;frame.problem='Original rejection was not acknowledged';await nextTick()
  expect(root.querySelector('[role="alert"]')?.textContent).toContain(frame.problem);expect(button().disabled).toBe(false)
  expect(root.querySelector('[role="status"]')).toBeNull();expect(root.querySelector('[aria-label="Question details"]')?.hasAttribute('aria-busy')).toBe(false)
  frame.problem='Native UI request timed out';await nextTick();expect(root.querySelector('[role="alert"]')?.textContent).toBe('Claude has not confirmed your decision. Try again when it responds.')
  button().click();expect(reject).toHaveBeenCalledExactlyOnceWith({messageId:'question',token:'drawing'})
 }finally{app.unmount();root.remove()}
})


it.each(['id','revision','draftActionId'] as const)('retires the old draft/card when native question %s changes on the same message',async key=>{
 const frame=ref<ClaudeUiQuestionFrame>({messageId:'question',id:'dialog',revision:'revision',draftActionId:'draft',token:'old-token',shownInput:{questions:[{question:'Who should the release address?',header:'Audience',kind:'text'}]},body:{status:'live',tree:{kind:'unsupported',component:'engine'}}});
 const root=document.createElement('div');document.body.append(root);const pause=vi.fn(),app=createApp({render:()=>h(NativeQuestionDrawing,{frame:frame.value,disabled:false,onPause:pause})});app.mount(root);
 try{
  const textarea=root.querySelector('textarea')!;textarea.value='Old question draft';textarea.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();
  const cancel=()=>[...root.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='Cancel')!;
  cancel().click();expect(pause).toHaveBeenLastCalledWith({messageId:'question',token:'old-token'});
  frame.value={...frame.value,[key]:'replacement',token:'new-token'};await nextTick();
  expect(root.querySelector('textarea')?.value).toBe('');cancel().click();
  expect(pause).toHaveBeenLastCalledWith({messageId:'question',token:'new-token'});
 }finally{app.unmount();root.remove()}
});


it('keeps the originally held draft token and text through an ordinary same-question redraw',async()=>{
 const frame=ref<ClaudeUiQuestionFrame>({messageId:'question',id:'dialog',revision:'revision',draftActionId:'draft',token:'held-token',shownInput:{questions:[{question:'Who?',header:'Audience',kind:'text'}]},body:{status:'live',tree:{kind:'unsupported',component:'engine'}}});
 const root=document.createElement('div');document.body.append(root);const pause=vi.fn(),app=createApp({render:()=>h(NativeQuestionDrawing,{frame:frame.value,disabled:false,onPause:pause})});app.mount(root);
 try{
  const textarea=root.querySelector('textarea')!;textarea.value='Keep this draft';textarea.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();
  frame.value={...frame.value,token:'later-drawing-token'};await nextTick();
  expect(root.querySelector('textarea')).toBe(textarea);expect(textarea.value).toBe('Keep this draft');
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='Cancel')!.click();
  expect(pause).toHaveBeenCalledExactlyOnceWith({messageId:'question',token:'held-token'});
 }finally{app.unmount();root.remove()}
});


it.each(['answering', 'outside', 'inactive window'] as const)('returns composer focus only for the active question control (%s)', async position => {
  const frame: ClaudeUiQuestionFrame = {
    messageId: 'question', id: 'dialog', revision: 'revision', draftActionId: 'draft', token: 'drawing',
    shownInput: { questions: [{ question: 'What should the release note mention?', header: 'Release', kind: 'text' }] },
    body: { status: 'live', tree: { kind: 'unsupported', component: 'engine' } },
  }
  const root = document.body.appendChild(document.createElement('div'))
  const showing = ref(true)
  const pending = ref(false)
  const respond = vi.fn(() => { pending.value = true })
  const returnFocus = vi.fn()
  const app = createApp({
    render: () => h('div', [
      showing.value ? h(NativeQuestionDrawing, { frame, pending: pending.value, onRespond: respond, onReturnFocus: returnFocus }) : null,
      h('button', { type: 'button' }, 'Outside'),
    ]),
  })
  app.mount(root)
  const windowFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(position !== 'inactive window')
  try {
    const buttons = [...root.querySelectorAll('button')]
    const submit = buttons.find(node => node.textContent === 'Submit answers')!
    submit.focus()
    submit.click()
    await nextTick()
    expect(document.activeElement).toBe(submit)
    expect(submit.getAttribute('aria-disabled')).toBe('true')
    submit.click()
    expect(respond).toHaveBeenCalledOnce()
    if (position === 'outside') buttons.find(node => node.textContent === 'Outside')!.focus()
    showing.value = false
    await nextTick()
    if (position === 'answering') expect(returnFocus).toHaveBeenCalledOnce()
    else expect(returnFocus).not.toHaveBeenCalled()
  } finally { windowFocus.mockRestore(); app.unmount(); root.remove() }
})
