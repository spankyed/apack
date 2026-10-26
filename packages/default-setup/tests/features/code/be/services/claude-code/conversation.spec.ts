import { PassThrough } from 'node:stream'
import { createClaudeConversation, type ClaudeConversationTurn } from '#features/code/be/services/claude-code/conversation.ts'
import type { QueryHandle } from '#features/code/be/services/claude-code/query.ts'
import type { StreamLine } from '#features/code/be/services/claude-code/types.ts'

function fixture() {
  const events = new PassThrough({ objectMode: true })
  let sequence = 0
  const native = {
    events: events as AsyncIterable<StreamLine>,
    send: vi.fn(() => `input-${++sequence}`),
    respond: vi.fn(),
    respondElicitation: vi.fn(),
    setModel: vi.fn().mockResolvedValue(undefined),
    cancelUserDialog: vi.fn(),
    close: vi.fn(async () => { events.end() }),
    kill: vi.fn(() => { events.end() }),
    hasPendingBackgroundTasks: vi.fn(() => false),
  } as unknown as QueryHandle
  return { native, push: (event: unknown) => events.write(event), end: () => events.end() }
}
const started = (id: string) => ({ type: 'command_lifecycle', state: 'started', command_uuid: id })
const result = (cost: number, id?: string) => ({ type: 'result', subtype: 'success', total_cost_usd: cost, session_id: 'native-session', ...(id ? { user_message_uuid: id } : {}) })

describe('persistent Claude conversation owner', () => {
  it('keeps one process across host turns and autonomous output, with independent cost baselines', async () => {
    const f = fixture()
    const turns: ClaudeConversationTurn[] = []
    const seen: StreamLine[][] = []
    const consume = async (turn: ClaudeConversationTurn) => {
      turns.push(turn)
      const lines: StreamLine[] = []
      for await (const event of turn.handle.events) lines.push(event)
      seen.push(lines)
      owner.release(turn.handle)
    }
    const owner = createClaudeConversation(f.native, consume)
    const observing = vi.fn()
    const unsubscribe = owner.subscribe(observing)
    const first = owner.start('first', consume)
    expect(owner.busy).toBe(true)
    expect(turns).toEqual([])
    f.push(started(first)); f.push(result(1, first))
    await vi.waitFor(() => expect(owner.busy).toBe(false))
    expect(f.native.close).not.toHaveBeenCalled()
    const second = owner.start('second', consume)
    f.push(started(second)); f.push(result(2, second))
    await vi.waitFor(() => expect(owner.busy).toBe(false))
    f.push({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render' })
    await vi.waitFor(() => expect(observing).toHaveBeenCalledWith(expect.objectContaining({ subtype: 'ui_invalidate' })))
    expect(turns).toHaveLength(2)
    f.push({ type: 'assistant', message: { content: [{ type: 'text', text: 'autonomous' }] } }); f.push(result(3))
    await vi.waitFor(() => expect(turns).toHaveLength(3))
    await vi.waitFor(() => expect(owner.busy).toBe(false))
    expect(turns.map(turn => turn.costBaseline)).toEqual([0, 1, 2])
    expect(turns.map(turn => turn.inputId)).toEqual([first, second, undefined])
    expect(seen.map(lines => lines.filter(line => line.type === 'result').length)).toEqual([1, 1, 1])
    unsubscribe()
    await owner.close()
    expect(f.native.close).toHaveBeenCalledOnce()
  })

  it('does not assign autonomous work to a host input awaiting native acceptance', async () => {
    const f = fixture()
    const ordered: Array<{ id?: string; baseline: number }> = []
    const consume = async (turn: ClaudeConversationTurn) => {
      ordered.push({ id: turn.inputId, baseline: turn.costBaseline })
      for await (const _event of turn.handle.events) { /* drain */ }
      owner.release(turn.handle)
    }
    const owner = createClaudeConversation(f.native, consume)
    const id = owner.start('queued host input', consume)
    f.push({ type: 'assistant', message: { content: [] } }); f.push(result(1))
    await vi.waitFor(() => expect(ordered).toHaveLength(1))
    expect(owner.busy).toBe(true)
    expect(ordered[0]?.id).toBeUndefined()
    f.push(started(id)); f.push(result(2, id))
    await vi.waitFor(() => expect(owner.busy).toBe(false))
    expect(ordered).toEqual([{ id: undefined, baseline: 0 }, { id, baseline: 1 }])
    await owner.close()
  })

  it('refuses a second submission while busy and rejects a foreign result before it reaches the consumer', async () => {
    const f = fixture()
    const received: StreamLine[] = []
    const failure = vi.fn()
    const owner = createClaudeConversation(f.native, async () => {})
    const id = owner.start('host input', async turn => {
      try { for await (const event of turn.handle.events) received.push(event) } catch (error) { failure(error) }
    })
    expect(() => owner.start('overlap', async () => {})).toThrow('active input')
    f.push(started(id)); f.push(result(1, 'foreign-input'))
    await expect(owner.done).rejects.toThrow('different input')
    expect(received.some(event => event.type === 'result')).toBe(false)
    expect(failure).toHaveBeenCalledOnce()
    expect(f.native.kill).toHaveBeenCalled()
  })

  it('settles a submitted input when the process exits before native started acknowledgement', async () => {
    const f = fixture()
    const failed = vi.fn()
    const owner = createClaudeConversation(f.native, async () => {})
    owner.start('pending', async turn => {
      await expect(turn.handle.result).rejects.toThrow('exited before')
      try { for await (const _event of turn.handle.events) { /* drain */ } } catch (error) { failed(error) }
    })
    f.end()
    await owner.done
    expect(failed).toHaveBeenCalledOnce()
    expect(() => owner.start('after exit', async () => {})).toThrow('closed')
  })
  it('marks a submitted turn stopped when explicit teardown wins before the consumer starts', async () => {
    const f = fixture()
    const consumed = vi.fn(async (turn: ClaudeConversationTurn) => { expect(turn.stopped).toBe(true) })
    const owner = createClaudeConversation(f.native, async () => {})
    owner.start('pending input', consumed)
    owner.kill()
    await owner.done
    expect(consumed).toHaveBeenCalledOnce()
  })

  it('rejects both scoped events and result when a live turn is released before completion', async () => {
    const f = fixture()
    let turn!: ClaudeConversationTurn
    const failed = vi.fn()
    const owner = createClaudeConversation(f.native, async () => {})
    const id = owner.start('active input', async current => {
      turn = current
      try { for await (const _event of current.handle.events) { /* drain */ } } catch (error) { failed(error) }
    })
    f.push(started(id))
    await vi.waitFor(() => expect(turn).toBeDefined())
    const rejected = expect(turn.handle.result).rejects.toThrow('stopped before completion')
    expect(owner.release(turn.handle)).toBe(true)
    await rejected
    await owner.done
    expect(failed).toHaveBeenCalledOnce()
    expect(turn.stopped).toBe(true)
  })

  it('releases pending-background results, accepts another input, and retains child output without phantom turns', async () => {
    const f = fixture()
    vi.mocked(f.native.hasPendingBackgroundTasks).mockReturnValue(true)
    const turns: ClaudeConversationTurn[] = []
    const childOutput = vi.fn()
    const consume = async (turn: ClaudeConversationTurn) => {
      turns.push(turn)
      for await (const event of turn.handle.events) {
        if (event.type === 'assistant') turn.activity.register('agent-root', childOutput)
      }
      owner.release(turn.handle)
    }
    const owner = createClaudeConversation(f.native, consume)
    const first = owner.start('launch', consume)
    f.push(started(first))
    f.push({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'agent-root', name: 'Agent', input: {} }] } })
    f.push(result(1, first))
    await vi.waitFor(() => expect(owner.busy).toBe(false))
    const second = owner.start('steer while backgrounded', consume)
    f.push(started(second)); f.push(result(2, second))
    await vi.waitFor(() => expect(owner.busy).toBe(false))
    f.push({ type: 'assistant', parent_tool_use_id: 'agent-root', uuid: 'child-uuid', message: { content: [{ type: 'text', text: 'child complete' }] } })
    await vi.waitFor(() => expect(childOutput).toHaveBeenCalledOnce())
    expect(owner.busy).toBe(false)
    expect(turns).toHaveLength(2)
    f.push({ type: 'assistant', message: { content: [{ type: 'text', text: 'parent follow-up' }] } })
    f.push(result(3))
    await vi.waitFor(() => expect(turns).toHaveLength(3))
    await vi.waitFor(() => expect(owner.busy).toBe(false))
    expect(turns.map(turn => turn.costBaseline)).toEqual([0, 1, 2])
    expect(turns.map(turn => turn.inputId)).toEqual([first, second, undefined])
    await owner.close()
  })

  it('retains concurrent permissions across results and surfaces the next only after a successful response', async () => {
    const f = fixture(), received: string[] = [], observed = vi.fn()
    let completed = 0
    const consume = async (turn: ClaudeConversationTurn) => {
      for await (const event of turn.handle.events) if (event.type === 'control_request') received.push(String(event.request_id))
      owner.release(turn.handle)
      completed++
    }
    const owner = createClaudeConversation(f.native, consume)
    owner.subscribe(observed)
    const ask = (id: string) => ({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: id } })
    f.push(ask('first')); f.push(ask('second'))
    await vi.waitFor(() => expect(observed).toHaveBeenCalledTimes(2))
    expect(received).toEqual(['first'])
    vi.mocked(f.native.respond).mockImplementationOnce(() => { throw Error('stdin refused') })
    expect(() => owner.handle.respond('first', { behavior: 'deny', message: 'No' })).toThrow('stdin refused')
    expect(received).toEqual(['first'])
    f.push(result(1))
    await vi.waitFor(() => expect(completed).toBe(1))
    expect(owner.busy).toBe(true)
    expect(() => owner.start('while pending', consume)).toThrow('permission request')
    owner.handle.respond('first', { behavior: 'deny', message: 'No' })
    await vi.waitFor(() => expect(received).toEqual(['first', 'second']))
    expect(() => owner.handle.respond('first', { behavior: 'allow', updatedInput: {} })).toThrow('already settled')
    owner.handle.respond('second', { behavior: 'allow', updatedInput: {} })
    f.push(result(2))
    await vi.waitFor(() => expect(owner.busy).toBe(false))
    expect(f.native.kill).not.toHaveBeenCalled()
    await owner.close()
  })

  it('withdraws queued permission requests without presenting them and advances a cancelled prompt in order', async () => {
    const f = fixture(), received: string[] = []
    const consume = async (turn: ClaudeConversationTurn) => {
      for await (const event of turn.handle.events) if (event.type === 'control_request' || event.type === 'control_cancel_request') received.push(event.type + ':' + event.request_id)
      owner.release(turn.handle)
    }
    const owner = createClaudeConversation(f.native, consume)
    for (const id of ['first', 'withdrawn', 'third']) f.push({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool' } })
    f.push({ type: 'control_cancel_request', request_id: 'withdrawn' })
    f.push({ type: 'control_cancel_request', request_id: 'first' })
    await vi.waitFor(() => expect(received).toEqual(['control_request:first', 'control_cancel_request:first', 'control_request:third']))
    owner.kill(); await owner.done
    expect(received).not.toContain('control_request:withdrawn')
  })

  it('waits for a terminal consumer to release before presenting the next approval', async () => {
    const f = fixture(), received: string[] = []
    let finishing = false
    let resume!: () => void
    const gate = new Promise<void>(resolve => { resume = resolve })
    const consume = async (turn: ClaudeConversationTurn) => {
      for await (const event of turn.handle.events) if (event.type === 'control_request') received.push(String(event.request_id))
      if (!finishing) { finishing = true; await gate }
      owner.release(turn.handle)
    }
    const owner = createClaudeConversation(f.native, consume)
    for (const id of ['first', 'second']) f.push({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool' } })
    f.push(result(1))
    await vi.waitFor(() => expect(finishing).toBe(true))
    owner.handle.respond('first', { behavior: 'allow', updatedInput: {} })
    expect(received).toEqual(['first'])
    resume()
    await vi.waitFor(() => expect(received).toEqual(['first', 'second']))
    owner.handle.respond('second', { behavior: 'deny', message: 'No' }); f.push(result(2))
    await vi.waitFor(() => expect(owner.busy).toBe(false))
    await owner.close()
  })

})


it('serializes generic dialogs with permissions and rejects wrong, withdrawn and duplicate responses', async () => {
  const f = fixture(); const received: StreamLine[] = [];
  const owner = createClaudeConversation(f.native, async () => {});
  const id = owner.start('input', async turn => { for await (const line of turn.handle.events) received.push(line); owner.release(turn.handle); });
  f.push(started(id));
  f.push({ type: 'control_request', request_id: 'dialog', request: { subtype: 'request_user_dialog', dialog_kind: 'fixture', payload: {} } });
  f.push({ type: 'control_request', request_id: 'tool', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} } });
  await vi.waitFor(() => expect(received.filter(line => line.type === 'control_request')).toHaveLength(1));
  expect(() => owner.handle.respond('dialog', { behavior: 'deny' })).toThrow('own response type');
  expect(() => owner.handle.cancelUserDialog('tool')).toThrow('no longer pending');
  vi.mocked(f.native.cancelUserDialog).mockImplementationOnce(() => { throw new Error('write failed'); });
  expect(() => owner.handle.cancelUserDialog('dialog')).toThrow('write failed');
  expect(received.filter(line => line.type === 'control_request')).toHaveLength(1);
  owner.handle.cancelUserDialog('dialog');
  await vi.waitFor(() => expect(received.filter(line => line.type === 'control_request')).toHaveLength(2));
  expect(() => owner.handle.cancelUserDialog('dialog')).toThrow('no longer pending');
  owner.handle.respond('tool', { behavior: 'deny', message: 'Fixture' });
  f.push({ type: 'control_request', request_id: 'withdrawn', request: { subtype: 'request_user_dialog', dialog_kind: 'fixture', payload: {} } });
  f.push({ type: 'control_cancel_request', request_id: 'withdrawn' });
  await vi.waitFor(() => expect(received.some(line => line.type === 'control_cancel_request')).toBe(true));
  expect(() => owner.handle.cancelUserDialog('withdrawn')).toThrow('no longer pending');
  expect(f.native.cancelUserDialog).toHaveBeenCalledTimes(2);
  expect(f.native.respond).toHaveBeenCalledTimes(1);
  f.push(result(1, id)); await vi.waitFor(() => expect(owner.busy).toBe(false)); await owner.close();
});


it('rejects an owned success subtype marked is_error without losing native result accounting', async () => {
  const f = fixture(), events: StreamLine[] = []; let rejection: Promise<unknown>;
  const owner = createClaudeConversation(f.native, async () => {});
  const id = owner.start('fixture', async turn => {
    rejection = expect(turn.handle.result).rejects.toThrow('fixed native refusal');
    for await (const line of turn.handle.events) events.push(line);
    await rejection; owner.release(turn.handle);
  });
  f.push(started(id)); f.push({ ...result(0.25, id), is_error: true, terminal_reason: 'api_error', result: 'fixed native refusal' });
  await vi.waitFor(() => expect(owner.busy).toBe(false));
  expect(events.find(line => line.type === 'result')).toMatchObject({ total_cost_usd: 0.25, is_error: true });
  await owner.close();
});


it('can close the process from a consumer after explicitly releasing its terminal turn',async()=>{
 const f=fixture();let completed=false;
 const consume=async(turn:ClaudeConversationTurn)=>{for await(const _event of turn.handle.events){}expect(owner.release(turn.handle)).toBe(true);await owner.close();completed=true;};
 const owner=createClaudeConversation(f.native,consume),input=owner.start('fixture',consume);
 f.push(started(input));f.push(result(1,input));
 await vi.waitFor(()=>expect(completed).toBe(true),{timeout:700});await owner.done;expect(f.native.close).toHaveBeenCalledOnce();
});


it('resets active and future cost baselines when native clears its ledger', async () => {
  const f = fixture()
  const charges: number[] = []
  const consume = async (turn: ClaudeConversationTurn) => {
    for await (const event of turn.handle.events) {
      if (event.type === 'result') charges.push(Math.max(0, Number(event.total_cost_usd) - turn.costBaseline))
    }
    owner.release(turn.handle)
  }
  const owner = createClaudeConversation(f.native, consume)
  const first = owner.start('first', consume)
  f.push(started(first)); f.push(result(2, first))
  await vi.waitFor(() => expect(owner.busy).toBe(false))
  const clear = owner.start('/clear', consume)
  f.push(started(clear)); f.push({ type: 'conversation_reset', new_conversation_id: 'conversation-only-id' })
  f.push({ type: 'system', subtype: 'init', session_id: 'new-session' })
  f.push({ ...result(0.5, clear), session_id: 'new-session' })
  await vi.waitFor(() => expect(owner.busy).toBe(false))
  expect(owner.sessionId).toBe('new-session')
  const next = owner.start('after clear', consume)
  f.push(started(next)); f.push({ ...result(1.5, next), session_id: 'new-session' })
  await vi.waitFor(() => expect(owner.busy).toBe(false))
  expect(charges).toEqual([2, 0.5, 1])
  await owner.close()
})

describe('owned native model changes', () => {
  it('serializes a pending acknowledgement against turns and other model mutations', async () => {
    const f = fixture()
    let acknowledge!: () => void
    vi.mocked(f.native.setModel).mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve }))
    const owner = createClaudeConversation(f.native, async () => {})
    const change = owner.handle.setModel('research-custom-model')
    expect(owner.busy).toBe(true)
    expect(owner.modelSelection).toBeUndefined()
    expect(() => owner.start('overlap', async () => {})).toThrow('active input')
    await expect(owner.handle.setModel('haiku')).rejects.toThrow('idle')
    acknowledge()
    await change
    expect(owner.busy).toBe(false)
    expect(owner.modelSelection).toBe('research-custom-model')
    vi.mocked(f.native.setModel).mockRejectedValueOnce(new Error('policy refusal'))
    await expect(owner.handle.setModel('sonnet')).rejects.toThrow('policy refusal')
    expect(owner.modelSelection).toBe('research-custom-model')
    expect(owner.busy).toBe(false)
    await owner.close()
  })

  it('does not record selection when close wins the acknowledgement race', async () => {
    const f = fixture()
    let acknowledge!: () => void
    vi.mocked(f.native.setModel).mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve }))
    const owner = createClaudeConversation(f.native, async () => {})
    const change = owner.handle.setModel('haiku')
    const rejected = expect(change).rejects.toThrow('closed')
    await owner.close()
    acknowledge()
    await rejected
    expect(owner.modelSelection).toBeUndefined()
  })

  it('refuses mutation while a host turn is pending', async () => {
    const f = fixture()
    const owner = createClaudeConversation(f.native, async () => {})
    owner.start('pending', async () => {})
    await expect(owner.handle.setModel('haiku')).rejects.toThrow('idle')
    expect(f.native.setModel).not.toHaveBeenCalled()
    owner.kill()
    await owner.done
  })
})

it('starts a resumed owner at already-accounted native cost and resets with the native ledger', async () => {
  const f = fixture(), charges: number[] = []
  const owner = createClaudeConversation(f.native, async () => {}, 0.7)
  const consume = async (turn: ClaudeConversationTurn) => {
    for await (const event of turn.handle.events) if (event.type === 'result') charges.push(Math.max(0, Number(event.total_cost_usd) - turn.costBaseline))
    owner.release(turn.handle)
  }
  const first = owner.start('Resume', consume); f.push(started(first)); f.push(result(0.84, first))
  await vi.waitFor(() => expect(charges).toHaveLength(1)); expect(charges[0]).toBeCloseTo(0.14)
  const next = owner.start('Next', consume); f.push(started(next)); f.push({ type: 'conversation_reset', new_conversation_id: 'new-native-session' }); f.push(result(0.2, next))
  await vi.waitFor(() => expect(charges).toHaveLength(2)); expect(charges[1]).toBeCloseTo(0.2)
  await owner.close()
})


it('observes an empty idle native drain without creating a turn and still accepts an empty bound user result',async()=>{
 const f=fixture(),turns:ClaudeConversationTurn[]=[],seen:StreamLine[][]=[]
 const consume=async(turn:ClaudeConversationTurn)=>{turns.push(turn);const rows:StreamLine[]=[];for await(const line of turn.handle.events)rows.push(line);seen.push(rows);owner.release(turn.handle)}
 const owner=createClaudeConversation(f.native,consume),observe=vi.fn();owner.subscribe(observe)
 const empty={...result(5),num_turns:0,result:'',is_error:false,origin:{kind:'task-notification',producer:'session-task'}}
 f.push(empty)
 await vi.waitFor(()=>expect(observe).toHaveBeenCalledWith(empty))
 expect(turns).toHaveLength(0);expect(owner.busy).toBe(false)
 const id=owner.start('An actual user input',consume)
 f.push(started(id));f.push({...empty,total_cost_usd:6,user_message_uuid:id})
 await vi.waitFor(()=>expect(seen).toHaveLength(1))
 expect(turns).toHaveLength(1);expect(turns[0]!.inputId).toBe(id);expect(turns[0]!.costBaseline).toBe(5)
 expect(seen[0]).toContainEqual(expect.objectContaining({type:'result',user_message_uuid:id,num_turns:0}))
 await owner.close()
})

it('owns mixed MCP inputs and tool approvals in FIFO order with distinct response channels', async () => {
  const f = fixture(), received: StreamLine[] = []
  const owner = createClaudeConversation(f.native, async () => {})
  const input = owner.start('review', async turn => { for await (const line of turn.handle.events) received.push(line); owner.release(turn.handle) })
  f.push(started(input))
  const request = (id: string, mode = 'form') => ({ type: 'control_request', request_id: id, request: { subtype: 'elicitation', mode, mcp_server_name: 'research', requested_schema: { type: 'object', properties: { enabled: { type: 'boolean' }, count: { type: 'integer' } }, required: ['enabled', 'count'] } } })
  f.push(request('form'))
  f.push({ type: 'control_request', request_id: 'tool', request: { subtype: 'can_use_tool', tool_name: 'Read', input: {} } })
  f.push(request('url', 'url'))
  await vi.waitFor(() => expect(received.filter(line => line.type === 'control_request')).toHaveLength(1))
  expect(owner.hasPendingElicitation('form')).toBe(true)
  expect(owner.hasPendingElicitation('url')).toBe(false)
  expect(() => owner.handle.respond('form', { behavior: 'allow' })).toThrow('own response type')
  expect(() => owner.handle.respondElicitation('url', { action: 'accept' })).toThrow('no longer pending')
  expect(() => owner.handle.respondElicitation('form', { action: 'accept', content: { enabled: false, count: '0' } })).toThrow('invalid')
  vi.mocked(f.native.respondElicitation).mockImplementationOnce(() => { throw Error('write failed') })
  expect(() => owner.handle.respondElicitation('form', { action: 'accept', content: { enabled: false, count: 0 } })).toThrow('write failed')
  expect(owner.hasPendingElicitation('form')).toBe(true)
  owner.handle.respondElicitation('form', { action: 'accept', content: { enabled: false, count: 0 } })
  await vi.waitFor(() => expect(received.filter(line => line.type === 'control_request')).toHaveLength(2))
  expect(() => owner.handle.respondElicitation('form', { action: 'cancel' })).toThrow('no longer pending')
  expect(() => owner.handle.respondElicitation('tool', { action: 'cancel' })).toThrow('no longer pending')
  owner.handle.respond('tool', { behavior: 'deny', message: 'Keep original' })
  await vi.waitFor(() => expect(owner.hasPendingElicitation('url')).toBe(true))
  expect(() => owner.handle.respondElicitation('url', { action: 'accept', content: { extra: 'not a form' } })).toThrow('cannot contain')
  f.push({ type: 'control_cancel_request', request_id: 'url' })
  await vi.waitFor(() => expect(owner.hasPendingElicitation('url')).toBe(false))
  expect(() => owner.handle.respondElicitation('url', { action: 'cancel' })).toThrow('no longer pending')
  expect(f.native.respondElicitation).toHaveBeenCalledTimes(2)
  f.push(result(1, input)); await vi.waitFor(() => expect(owner.busy).toBe(false)); await owner.close()
})

it('keeps billing observed between turns without creating a phantom turn and clears it on reset', async () => {
 const f = fixture(), consume = vi.fn(async () => {})
 const owner = createClaudeConversation(f.native, consume)
 const observations: unknown[] = []; owner.subscribe(() => observations.push(owner.billing))
 f.push({type:'system',subtype:'init',session_id:'a'})
 f.push({type:'rate_limit_event',session_id:'a',rate_limit_info:{status:'allowed_warning',isUsingOverage:true}})
 await vi.waitFor(() => expect(owner.billing?.info.isUsingOverage).toBe(true))
 expect(consume).not.toHaveBeenCalled(); expect(owner.busy).toBe(false)
 expect(observations.at(-1)).toMatchObject({sessionId:'a'})
 f.push({type:'conversation_reset',new_conversation_id:'b'})
 await vi.waitFor(() => expect(owner.billing).toBeUndefined())
 f.push({type:'rate_limit_event',session_id:'a',rate_limit_info:{status:'rejected'}})
 await new Promise(resolve => setTimeout(resolve, 10)); expect(owner.billing).toBeUndefined()
 await owner.close()
})
