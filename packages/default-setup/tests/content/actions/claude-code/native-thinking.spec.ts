import { isClaudeNarrationSignature } from '../../../../src/content/actions/claude-code/_helpers/native-thinking.ts'
const field = (key: number, value: number[]) => [key * 8 + 2, value.length, ...value]
const signature = (tag: string) => Buffer.from(field(2, field(1, field(8, [...Buffer.from(tag)])))).toString('base64')
it('distinguishes native narration tags from ordinary thinking, summary tags and unclassified signatures', () => {
  expect(isClaudeNarrationSignature(signature('narration'))).toBe(true)
  for (const value of [signature('summary'), signature('thinking'), signature('narration-other'), 'private-fixture-signature', '', null]) expect(isClaudeNarrationSignature(value)).toBe(false)
})
it('rejects malformed envelopes and trailing data instead of granting a summary identity', () => {
  const valid = Buffer.from(signature('narration'), 'base64')
  for (let length = 1; length < valid.length; length++) expect(isClaudeNarrationSignature(valid.subarray(0, length).toString('base64'))).toBe(false)
  expect(isClaudeNarrationSignature(Buffer.concat([valid, Buffer.from([255])]).toString('base64'))).toBe(false)
  expect(isClaudeNarrationSignature(signature('narration') + '!')).toBe(false)
})

it('skips unknown uint64 fields without mistaking them for malformed envelopes', () => {
  const unknown = Buffer.from([8, ...Array(9).fill(255), 1])
  expect(isClaudeNarrationSignature(Buffer.concat([unknown, Buffer.from(signature('narration'), 'base64')]).toString('base64'))).toBe(true)
})
