/** Lossless transport of repeated native SGR/OSC-8 sequences; never render encoded text directly. */
export function encodeClaudeDocument(text: string): { body: string; codes: string[] } {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'
  const codes: string[] = [], indices = new Map<string, number>()
  const pattern = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g
  let body = '', cursor = 0
  for (const match of text.matchAll(pattern)) {
    body += text.slice(cursor, match.index).replaceAll('~', '~~')
    let index = indices.get(match[0])
    if (index === undefined) {
      if (codes.length >= 256 || match[0].length > 4096) throw Error('Native document style dictionary exceeds limit')
      index = codes.length; codes.push(match[0]); indices.set(match[0], index)
    }
    body += index < 64 ? '~' + alphabet[index] : '~!' + index.toString(36) + ';'; cursor = match.index! + match[0].length
  }
  return { body: body + text.slice(cursor).replaceAll('~', '~~'), codes }
}

export function decodeClaudeDocument(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid native document encoding')
  const { body, codes } = value as { body?: unknown; codes?: unknown }
  if (typeof body !== 'string' || body.length > 262144 || !Array.isArray(codes) || codes.length > 256
    || !codes.every(code => typeof code === 'string' && code.length <= 4096 && /^(?:\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\))$/.test(code))) throw Error('Invalid native document style dictionary')
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'
  let result = '', cursor = 0
  while (cursor < body.length) {
    const at = body.indexOf('~', cursor), end = at < 0 ? body.length : at
    result += body.slice(cursor, end); cursor = end
    if (at >= 0) {
      if (body[at + 1] === '~') { result += '~'; cursor += 2 }
      else {
        const token = body[at + 1] === '!' ? /^~!([0-9a-z]{1,2});/.exec(body.slice(at, at + 6)) : undefined
        const index = token ? Number.parseInt(token[1]!, 36) : body[at + 1] === undefined ? -1 : alphabet.indexOf(body[at + 1]!)
        if (body[at + 1] === '!' && !token || index < 0 || index >= codes.length) throw Error('Invalid native document style reference')
        result += codes[index]; cursor += token ? token[0].length : 2
      }
    }
    if (result.length > 1048576) throw Error('Decoded native document exceeds limit')
  }
  return result
}
