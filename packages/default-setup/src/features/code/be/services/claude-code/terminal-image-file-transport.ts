import type { ClaudeTerminalImagePixels } from './terminal-image-cache.ts'
import { readClaudeTerminalImageFile, type ClaudeTerminalImageFileFormat } from './terminal-image-file.ts'

/** Ordered terminal-side conversion; the browser receives pixels, never filesystem names. */
export function createClaudeTerminalImageFileTransport(options: {
  emit: (text: string) => void
  reply: (text: string) => void
  read?: typeof readClaudeTerminalImageFile
  image?: (value: ClaudeTerminalImagePixels) => void
  remove?: (id: number) => void
}) {
  const read = options.read ?? readClaudeTerminalImageFile
  let pending = Promise.resolve(), queuedBytes = 0, closed = false
  let held = '', state: 'text' | 'escape' | 'apc' | 'apcEscape' | 'passthrough' | 'passthroughEscape' = 'text'
  let ready = ''
  const flush = () => { if (!closed && ready) { const text = ready; ready = ''; options.emit(text) } }
  const emit = (text: string) => { if (!closed && text) { ready += text; if (ready.length >= 16384) flush() } }
  async function frame(text: string) {
    if (!text.startsWith('\x1b_G')) { emit(text); return }
    const body = text.slice(3, -2), split = body.indexOf(';'), header = split < 0 ? body : body.slice(0, split)
    if (!/(?:^|,)t=[fs](?:,|$)/.test(header)) {
      const deletion = /(?:^|,)a=d(?:,|$)/.test(header) && /(?:^|,)d=I(?:,|$)/.test(header) ? /(?:^|,)i=([1-9][0-9]*)(?:,|$)/.exec(header) : null
      if (deletion) options.remove?.(Number(deletion[1]))
      emit(text); return
    }
    const fields = new Map<string, string>()
    let valid = header.length <= 512
    for (const part of header.split(',')) {
      const match = /^([A-Za-z])=([A-Za-z0-9]+)$/.exec(part)
      if (!match || fields.has(match[1]!)) { valid = false; continue }
      fields.set(match[1]!, match[2]!)
    }
    const id = fields.get('i'), quiet = fields.get('q')
    const answer = (message: string) => {
      if (!closed && id && /^[1-9][0-9]{0,9}$/.test(id) && Number(id) <= 0xffffffff && quiet !== '2' && (message !== 'OK' || quiet !== '1')) options.reply(`\x1b_Gi=${id};${message}\x1b\\`)
    }
    if (!valid || !id || !/^[1-9][0-9]{0,9}$/.test(id) || Number(id) > 0xffffffff || quiet !== undefined && !['0', '1', '2'].includes(quiet) || !['q', 'T'].includes(fields.get('a') ?? '') || [...fields.keys()].some(key => !['a', 't', 'q', 'f', 'i', 's', 'v', 'U', 'c', 'r'].includes(key))) { answer('EINVAL:invalid named image frame'); return }
    if (fields.get('t') !== 'f') { answer('ENOTSUPPORTED:shared memory transport is unavailable'); return }
    const format = fields.get('f')
    if (!['24', '32', '100'].includes(format ?? '')) { answer('EINVAL:invalid image format'); return }
    const payload = split < 0 ? '' : body.slice(split + 1)
    if (!payload || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) { answer('EINVAL:invalid image filename'); return }
    try {
      const path = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(payload, 'base64'))
      const image: ClaudeTerminalImageFileFormat = format === '100' ? { format: 'png' } : { format: format === '24' ? 'rgb' : 'rgba', width: Number(fields.get('s')), height: Number(fields.get('v')) }
      const pixels = await read(path, image)
      if (closed) return
      if (fields.get('a') === 'q') { answer('OK'); return }
      options.image?.({ id: Number(id), image, pixels })
      fields.set('t', 'd'); fields.set('q', '2')
      const encoded = pixels.toString('base64'), first = [...fields].map(([key, value]) => `${key}=${value}`).join(',')
      for (let offset = 0; offset < encoded.length; offset += 4096) {
        const more = offset + 4096 < encoded.length
        emit(`\x1b_G${offset === 0 ? first + ',' : 'q=2,'}m=${more ? 1 : 0};${encoded.slice(offset, offset + 4096)}\x1b\\`)
      }
    } catch { answer('EIO:terminal image file could not be read') }
  }
  async function consume(text: string) {
    let plain = ''
    for (const char of text) {
      if (closed) return
      if (state === 'text') { if (char === '\x1b') { emit(plain); plain = ''; held = char; state = 'escape' } else plain += char; continue }
      if (state === 'escape') {
        if (char === '_') { held += char; state = 'apc' }
        else { emit(held); held = ''; if (char === '\x1b') { held = char } else { plain += char; state = 'text' } }
        continue
      }
      if (state === 'passthrough' || state === 'passthroughEscape') {
        plain += char
        if (state === 'passthroughEscape' && char === '\\') state = 'text'
        else state = char === '\x1b' ? 'passthroughEscape' : 'passthrough'
        continue
      }
      held += char
      if (state === 'apcEscape' && char === '\\') { const complete = held; held = ''; state = 'text'; flush(); await frame(complete) }
      else if (held.length > 8192) { emit(held); held = ''; state = char === '\x1b' ? 'passthroughEscape' : 'passthrough' }
      else state = char === '\x1b' ? 'apcEscape' : 'apc'
    }
    emit(plain); flush()
  }
  return {
    write(text: string) {
      if (closed) return Promise.resolve()
      const bytes = Buffer.byteLength(text)
      if (queuedBytes + bytes > 2 * 1024 * 1024) return Promise.reject(new Error('Terminal image output queue exceeded its bound'))
      queuedBytes += bytes
      const result = pending.then(() => consume(text)).finally(() => { queuedBytes -= bytes })
      pending = result.catch(() => {})
      return result
    },
    drain() { return pending },
    close() { closed = true; held = ''; ready = '' },
  }
}
