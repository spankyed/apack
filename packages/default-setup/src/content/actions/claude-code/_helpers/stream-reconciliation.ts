/** Compare native completed text with its own SSE cycle, never app presentation text. */
export function createClaudeStreamReconciler() {
  type Cycle = { text: Map<number, string>; completed: string[]; seen: Set<string>; stopped: boolean; reported: boolean }
  const cycles = new Map<string, Cycle>()
  let active: string | undefined
  const cycle = (id: string) => {
    let value = cycles.get(id)
    if (!value) {
      value = {text:new Map(),completed:[],seen:new Set(),stopped:false,reported:false}
      cycles.set(id,value)
      while (cycles.size > 8) cycles.delete(cycles.keys().next().value!)
    }
    return value
  }
  function compare(id: string) {
    const value = cycles.get(id)
    if (!value || !value.stopped || value.reported || !value.completed.length || !value.text.size) return
    const streamed = [...value.text].sort(([a],[b])=>a-b).map(([,text])=>text).join('\n')
    const completed = value.completed.join('\n')
    // Whitespace is native content. Do not trim it or compare the app's separators.
    if (streamed === completed) return
    value.reported = true
    return {apiMessageId:id, kind:completed.startsWith(streamed) ? 'missing_suffix' as const : 'conflict' as const}
  }
  return {
    observe(line: {type?:string; parent_tool_use_id?:unknown; uuid?:unknown; event?:any; message?:any}) {
      if (line.parent_tool_use_id) return
      if (line.type === 'stream_event') {
        const event = line.event
        if (event?.type === 'message_start' && typeof event.message?.id === 'string') {
          active = event.message.id; cycle(active!)
        }
        if (!active) return
        const value = cycle(active)
        if (event?.type === 'content_block_start' && Number.isSafeInteger(event.index) && event.content_block?.type === 'text') value.text.set(event.index,event.content_block.text ?? '')
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string' && value.text.has(event.index)) {
          const text = value.text.get(event.index)! + event.delta.text
          if (text.length + [...value.text].filter(([index])=>index!==event.index).reduce((n,[,text])=>n+text.length,0) > 1024*1024) { cycles.delete(active); active=undefined; return }
          value.text.set(event.index,text)
        }
        if (event?.type === 'message_stop') {value.stopped=true; return compare(active)}
      }
      if (line.type === 'assistant' && typeof line.message?.id === 'string' && Array.isArray(line.message.content)) {
        const id = line.message.id, value = cycle(id)
        if (typeof line.uuid === 'string') {
          if (value.seen.has(line.uuid)) return
          if (value.seen.size >= 4096) {cycles.delete(id);return}
          value.seen.add(line.uuid)
        }
        const texts = line.message.content.filter((b:any)=>b?.type==='text' && typeof b.text==='string').map((b:any)=>b.text)
        if (value.completed.length + texts.length > 4096 || [...value.completed,...texts].reduce((n:number,s:string)=>n+s.length,0)>1024*1024) {cycles.delete(id);return}
        value.completed.push(...texts)
        return compare(id)
      }
    },
    clear() {cycles.clear();active=undefined},
  }
}
