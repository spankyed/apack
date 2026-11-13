import { readClaudeTerminalSharedImage } from './terminal-image-shared-memory.ts'
import type { ClaudeTerminalImagePixels } from './terminal-image-cache.ts'
import { readClaudeTerminalImageFile, type ClaudeTerminalImageFileFormat } from './terminal-image-file.ts'

/** Ordered terminal-side conversion; the browser receives pixels, never filesystem names. */
export function createClaudeTerminalImageFileTransport(options: {
  emit: (text: string) => void
  reply: (text: string) => void
  /** False when the broker alone negotiates terminal capabilities. */
  answerFileQueries?: boolean
  read?: typeof readClaudeTerminalImageFile
  readShared?: typeof readClaudeTerminalSharedImage
  image?: (value: ClaudeTerminalImagePixels) => void
  remove?: (id: number) => void
}) {
  const read = options.read ?? readClaudeTerminalImageFile, readShared = options.readShared ?? readClaudeTerminalSharedImage
  let pending = Promise.resolve(), queuedBytes = 0, closed = false
  let inline: {id:number;image:ClaudeTerminalImageFileFormat;parts:string[];length:number}|undefined
  let reading = false, cancelRead: (() => void) | undefined
  async function readImage(path: string, image: ClaudeTerminalImageFileFormat, shared: boolean) {
    if (reading) throw new Error('Previous terminal image read is still pending')
    reading = true
    const controller = new AbortController()
    const source = Promise.resolve().then(() => shared ? readShared(path, image, controller.signal) : read(path, image))
    void source.then(() => { reading = false }, () => { reading = false })
    let timer: ReturnType<typeof setTimeout> | undefined
    const stopped = new Promise<never>((_resolve, reject) => {
      cancelRead = () => { controller.abort(); reject(new Error('Terminal image owner closed')) }
      timer = setTimeout(() => { controller.abort(); reject(new Error('Terminal image read timed out')) }, 4000)
      timer.unref?.()
    })
    try { return await Promise.race([source, stopped]) } finally { clearTimeout(timer); cancelRead = undefined }
  }
  let held = '', state: 'text' | 'escape' | 'apc' | 'apcEscape' | 'passthrough' | 'passthroughEscape' = 'text'
  let ready = ''
  const flush = () => { if (!closed && ready) { const text = ready; ready = ''; options.emit(text) } }
  const emit = (text: string) => { if (!closed && text) { ready += text; if (ready.length >= 16384) flush() } }
  async function frame(text: string) {
    if (!text.startsWith('\x1b_G')) { emit(text); return }
    const body = text.slice(3, -2), split = body.indexOf(';'), header = split < 0 ? body : body.slice(0, split)
    if (!/(?:^|,)t=[fs](?:,|$)/.test(header)) {
      // Original pinned inline transmissions feed the separate Client snapshot cache.
      // They are observed, never decoded as terminal rows or answered here.
      const parts=header.split(',')
      if(header.length>512||parts.some(part=>!/^([A-Za-z])=([A-Za-z0-9]+)$/.test(part))||new Set(parts.map(part=>part[0])).size!==parts.length){inline=undefined;emit(text);return}
      const fields=new Map(parts.map(part=>[part.slice(0,1),part.slice(2)])),payload=split<0?'':body.slice(split+1)
      if(!fields.has('a')&&[...fields.keys()].some(key=>!['m','q'].includes(key)))inline=undefined
      if(fields.get('a')==='T'){
        inline=undefined
        const id=Number(fields.get('i')),format=fields.get('f'),width=Number(fields.get('s')),height=Number(fields.get('v'))
        if([...fields.keys()].every(key=>['a','U','q','f','s','v','i','c','r','m','t'].includes(key))&&fields.get('U')==='1'&&Number.isInteger(id)&&id>0&&id<=0xffffffff&&['24','32','100'].includes(format??'')&&(!fields.has('t')||fields.get('t')==='d')&&!fields.has('o')&&
          (format==='100'||Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&width*height*(format==='24'?3:4)<=32*1024*1024))
          inline={id,image:format==='100'?{format:'png'}:{format:format==='24'?'rgb':'rgba',width,height},parts:[],length:0}
      }else if(fields.has('a'))inline=undefined
      if(inline){
        if(fields.get('m')==='1'&&payload.includes('=')||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)||inline.length+payload.length>Math.ceil(32*1024*1024/3)*4)inline=undefined
        else{
          if(payload)inline.parts.push(payload);inline.length+=payload.length
          if(fields.get('m')!=='1'){
            const current=inline;inline=undefined;const pixels=Buffer.from(current.parts.join(''),'base64'),image=current.image
            if(pixels.length<=32*1024*1024&&(image.format==='png'?pixels.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):pixels.length===image.width*image.height*(image.format==='rgb'?3:4)))options.image?.({id:current.id,image,pixels})
          }
        }
      }

      const deletion=Number(fields.get('i'))
      if(fields.get('a')==='d'&&fields.get('d')==='I'&&[...fields.keys()].every(key=>['a','d','i','q'].includes(key))&&Number.isInteger(deletion)&&deletion>0&&deletion<=0xffffffff)options.remove?.(deletion)
      emit(text); return
    }
    inline=undefined
    if(options.answerFileQueries===false&&/(?:^|,)a=q(?:,|$)/.test(header))return
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
    const format = fields.get('f')
    if (!['24', '32', '100'].includes(format ?? '') || fields.get('t') === 's' && format === '100') { answer('EINVAL:invalid image format'); return }
    const payload = split < 0 ? '' : body.slice(split + 1)
    if (!payload || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) { answer('EINVAL:invalid image filename'); return }
    try {
      const path = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(payload, 'base64'))
      const image: ClaudeTerminalImageFileFormat = format === '100' ? { format: 'png' } : { format: format === '24' ? 'rgb' : 'rgba', width: Number(fields.get('s')), height: Number(fields.get('v')) }
      const pixels = await readImage(path, image, fields.get('t') === 's')
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
      else if (held.length > 8192) { inline=undefined;emit(held); held = ''; state = char === '\x1b' ? 'passthroughEscape' : 'passthrough' }
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
    close() { closed = true; inline=undefined; held = ''; ready = ''; cancelRead?.() },
  }
}
