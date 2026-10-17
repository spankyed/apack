/** Native 2.1.302 narration classification reads protobuf envelope 2 -> 1 -> UTF-8 field 8.
 * This reads a presentation tag; it does not authenticate signatures or expose opaque provider payloads.
 */
export function isClaudeNarrationSignature(signature: unknown): boolean {
  if (typeof signature !== 'string') return false
  const encoded = signature.replace(/[\t\n\f\r ]/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1 || (encoded.includes('=') && encoded.length % 4 !== 0)) return false
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const decoded: number[] = []
  let bits = 0, value = 0
  for (const char of encoded.replace(/=+$/, '')) {
    value = (value << 6) | alphabet.indexOf(char); bits += 6
    if (bits >= 8) { bits -= 8; decoded.push((value >> bits) & 255); value &= (1 << bits) - 1 }
  }
  const envelope = bytesField(new Uint8Array(decoded), 2)
  const payload = envelope && bytesField(envelope, 1)
  const tag = payload && bytesField(payload, 8)
  const expected = [110, 97, 114, 114, 97, 116, 105, 111, 110]
  return !!tag && tag.length === expected.length && expected.every((byte, index) => tag[index] === byte)
}
function varint(bytes: Uint8Array, offset: number): { value: number; next: number } | undefined {
  let value = 0, scale = 1
  for (let i = 0; i < 10 && offset + i < bytes.length; i++) {
    const byte = bytes[offset + i]; value += (byte & 127) * scale
    if (!(byte & 128)) return { value, next: offset + i + 1 }
    scale *= 128
  }
}
function bytesField(bytes: Uint8Array, field: number): Uint8Array | undefined {
  let offset = 0, found: Uint8Array | undefined
  while (offset < bytes.length) {
    const key = varint(bytes, offset); if (!key) return
    offset = key.next
    switch (key.value & 7) {
      case 0: { const integer = varint(bytes, offset); if (!integer) return; offset = integer.next; break }
      case 1: if (offset + 8 > bytes.length) return; offset += 8; break
      case 2: {
        const length = varint(bytes, offset); if (!length || length.value > bytes.length - length.next) return
        offset = length.next + length.value
        if (Math.floor(key.value / 8) === field) found = bytes.subarray(length.next, offset)
        break
      }
      case 5: if (offset + 4 > bytes.length) return; offset += 4; break
      default: return
    }
  }
  return found
}
