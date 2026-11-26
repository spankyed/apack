/** The owned terminal supports direct Kitty bytes, but never remote file/shared-memory reads.
 * Handle only live capability queries: cached terminal replay is intentionally silent.
 */
export function createClaudeTerminalGraphicsQueryResponder(reply: (text: string) => void) {
  let state: 'text' | 'escape' | 'apc' | 'apc-escape' = 'text', frame = '', oversized = false
  function answer() {
    if (oversized || !frame.startsWith('G')) return
    const header = frame.slice(1).split(';', 1)[0]!
    if (header.length > 512 || !/^[A-Za-z]=[A-Za-z0-9]+(?:,[A-Za-z]=[A-Za-z0-9]+)*$/.test(header)) return
    const fields = new Map(header.split(',').map(part => [part[0]!, part.slice(2)]))
    const id = fields.get('i'), quiet = fields.get('q')
    if (fields.get('a') !== 'q' || !id || !/^[1-9][0-9]{0,9}$/.test(id) || Number(id) > 0xffffffff || quiet === '2') return
    if (quiet !== undefined && quiet !== '0' && quiet !== '1') return
    const medium = fields.get('t') ?? 'd', format = fields.get('f') ?? '32'
    const supported = medium === 'd' && ['24', '32', '100'].includes(format)
    if (supported && quiet === '1') return
    reply(`\x1b_Gi=${id};${supported ? 'OK' : 'ENOTSUPPORTED:direct byte images only'}\x1b\\`)
  }
  return (text: string) => {
    for (const char of text) {
      if (state === 'text') { if (char === '\x1b') state = 'escape'; continue }
      if (state === 'escape') {
        if (char === '_') { state = 'apc'; frame = ''; oversized = false }
        else state = char === '\x1b' ? 'escape' : 'text'
        continue
      }
      if (state === 'apc-escape') {
        if (char === '\\') { answer(); state = 'text'; frame = ''; continue }
        // An embedded escape invalidates this frame; keep draining to its terminator.
        oversized = true
      }
      if (char === '\x1b') state = 'apc-escape'
      else { state = 'apc'; if (!oversized) { if (frame.length >= 4096) { oversized = true; frame = '' } else frame += char } }
    }
  }
}
