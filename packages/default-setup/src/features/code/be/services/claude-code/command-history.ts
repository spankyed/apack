import { parseClaudeCommandEnvelope } from '../../../common/claude-command-envelope.ts'
import { stripVTControlCharacters } from 'node:util'

export type ClaudeCommandHistoryPresentation =
  | { kind: 'invocation'; text: string; name: string; args: string; label: string }
  | { kind: 'output'; text: string; stream: 'stdout' | 'stderr' }

// Native command envelopes escape these three entities once; arbitrary HTML remains text.
const decode = (text: string) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
/** Recognize whole persisted command envelopes, never strip tags from ordinary message bodies. */
export function presentClaudeCommandHistory(row: Record<string, unknown>, text: string): ClaudeCommandHistoryPresentation | undefined {
  const envelope = parseClaudeCommandEnvelope(row, text)
  if (envelope?.kind === 'invocation') {
    const name = decode(envelope.name), args = stripVTControlCharacters(decode(envelope.args))
    return { kind: 'invocation', name, args, label: decode(envelope.label), text: name + (args ? ' ' + args : '') }
  }
  if (envelope?.kind === 'output') {
    const stream = envelope.stream
    const value = stripVTControlCharacters(decode(envelope.text)).trim()
    // Native local-command stdout uses this sentinel for an empty result and hides it.
    return { kind: 'output', stream, text: stream === 'stdout' && value === '(no content)' ? '' : value }
  }
}
