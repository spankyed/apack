import { createClaudeSelectionReply } from '#features/code/be/services/claude-code/ui-selection-reply.ts'

it('delivers exact selection and native row identity through a one-use loopback response', async () => {
  const reply = await createClaudeSelectionReply(new AbortController().signal, Date.now() + 3000, () => true)
  try {
    const answer = { text: 'Release notes\nSelected 👋', instance_id: 'original-row' }
    expect(new URL(reply.url).hostname).toBe('127.0.0.1')
    expect((await fetch(reply.url + '-foreign', { method: 'POST', body: JSON.stringify(answer) })).status).toBe(404)
    const response = await fetch(reply.url, { method: 'POST', body: JSON.stringify(answer) })
    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await reply.result).toEqual(answer)
    await expect(fetch(reply.url, { method: 'POST', body: JSON.stringify(answer) })).rejects.toThrow()
  } finally { reply.close() }
})

it('does not consume an answer for a preflight or unsupported method', async () => {
  const reply = await createClaudeSelectionReply(new AbortController().signal, Date.now() + 3000, () => true)
  try {
    expect((await fetch(reply.url, { method: 'OPTIONS' })).status).toBe(204)
    expect((await fetch(reply.url)).status).toBe(405)
    expect((await fetch(reply.url, { method: 'POST', body: '{}' })).status).toBe(204)
    expect(await reply.result).toEqual({})
  } finally { reply.close() }
})

it('normalizes an empty selection without retaining its claimed row', async () => {
  const reply = await createClaudeSelectionReply(new AbortController().signal, Date.now() + 3000, () => true)
  try {
    await fetch(reply.url, { method: 'POST', body: JSON.stringify({ text: '', instance_id: 'row' }) })
    expect(await reply.result).toEqual({})
  } finally { reply.close() }
})

it.each(['abort', 'expiry', 'replacement'])('refuses private text after %s', async kind => {
  const abort = new AbortController()
  let current = true
  const reply = await createClaudeSelectionReply(abort.signal, Date.now() + (kind === 'expiry' ? 25 : 3000), () => current)
  try {
    if (kind === 'abort') abort.abort()
    if (kind === 'replacement') current = false
    if (kind === 'expiry') await reply.result
    await fetch(reply.url, { method: 'POST', body: JSON.stringify({ text: 'Retired private text' }) }).catch(() => undefined)
    if (kind === 'replacement') reply.close()
    expect(await reply.result).toBeUndefined()
  } finally { reply.close() }
})

it.each(['{"text":7}', '{"text":"selected","unexpected":"field"}', '{broken'])('rejects malformed response %s', async body => {
  const reply = await createClaudeSelectionReply(new AbortController().signal, Date.now() + 3000, () => true)
  try {
    expect((await fetch(reply.url, { method: 'POST', body })).status).toBe(400)
    expect(await reply.result).toBeUndefined()
  } finally { reply.close() }
})


it('delivers maximum-length escaped selection text without reducing the native character limit', async () => {
  const reply = await createClaudeSelectionReply(new AbortController().signal, Date.now() + 3000, () => true)
  try {
    const answer = { text: '\u0000'.repeat(1000000), instance_id: 'native-row' }
    const response = await fetch(reply.url, { method: 'POST', body: JSON.stringify(answer) })
    expect(response.status).toBe(204)
    expect(await reply.result).toEqual(answer)
  } finally { reply.close() }
})


it('retains the native selection character limit after allowing JSON escape expansion', async () => {
  const reply = await createClaudeSelectionReply(new AbortController().signal, Date.now() + 3000, () => true)
  try {
    const response = await fetch(reply.url, { method: 'POST', body: JSON.stringify({ text: '漢'.repeat(1000001) }) })
    expect(response.status).toBe(400)
    expect(await reply.result).toBeUndefined()
  } finally { reply.close() }
})
