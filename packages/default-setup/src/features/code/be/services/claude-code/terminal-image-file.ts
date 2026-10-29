import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

export type ClaudeTerminalImageFileFormat =
  | { format: 'png' }
  | { format: 'rgb' | 'rgba'; width: number; height: number }

/** Read a local terminal image without following the final open to a special file. */
export async function readClaudeTerminalImageFile(path: string, image: ClaudeTerminalImageFileFormat): Promise<Buffer> {
  if (!isAbsolute(path) || Buffer.byteLength(path) > 3072 || path.includes('\0')) throw new Error('Invalid terminal image path')
  const resolved = await realpath(path)
  if (/^\/(?:proc|sys)(?:\/|$)/.test(resolved) || /^\/dev(?:\/|$)/.test(resolved) && !resolved.startsWith('/dev/shm/')) throw new Error('Terminal image path is not a regular local source')
  const maxBytes = 64 * 1024 * 1024
  let expected: number | undefined
  if (image.format !== 'png') {
    if (!Number.isSafeInteger(image.width) || image.width < 1 || image.width > 4096 || !Number.isSafeInteger(image.height) || image.height < 1 || image.height > 4096) throw new Error('Invalid terminal image dimensions')
    expected = image.width * image.height * (image.format === 'rgb' ? 3 : 4)
  }
  const file = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes || expected !== undefined && stat.size !== expected) throw new Error('Invalid terminal image file size or kind')
    const data = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < data.length) {
      const { bytesRead } = await file.read(data, offset, data.length - offset, offset)
      if (!bytesRead) throw new Error('Terminal image file changed while reading')
      offset += bytesRead
    }
    const after = await file.stat()
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('Terminal image file changed while reading')
    if (image.format === 'png') {
      if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Invalid terminal PNG header')
      const width = data.readUInt32BE(16), height = data.readUInt32BE(20)
      if (!width || !height || width > 4096 || height > 4096 || width * height > 16 * 1024 * 1024) throw new Error('Terminal PNG dimensions exceed this terminal')
    }
    return data
  } finally { await file.close() }
}
