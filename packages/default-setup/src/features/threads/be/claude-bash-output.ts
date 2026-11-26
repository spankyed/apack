const sessionUuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

/** Only a native Bash result with a matching persisted-output envelope can offer its saved file. */
export function nativeBashOutputFile(sessionId: string, result: unknown, text: string): string | undefined {
  if (!sessionUuid.test(sessionId) || result === null || typeof result !== 'object'
    || !('persistedOutputPath' in result) || !('persistedOutputSize' in result)) return
  const path = result.persistedOutputPath
  const size = result.persistedOutputSize
  // eslint-disable-next-line no-control-regex
  if (typeof path !== 'string' || path.length > 4096 || !path.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(path)
    || typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) return
  const parts = path.slice(1).split('/')
  if (parts.some(part => !part || part === '.' || part === '..')
    || parts.at(-5) !== 'projects' || parts.at(-3) !== sessionId || parts.at(-2) !== 'tool-results'
    || !/^[a-z0-9_-]+\.txt$/i.test(parts.at(-1) ?? '')) return
  if (!text.startsWith('<persisted-output>\n') || !text.endsWith('\n</persisted-output>')) return
  const description = text.split('\n', 2)[1]!
  if (description.startsWith('Output too large (') && description.endsWith('). Full output saved to: ' + path)) return path
}
