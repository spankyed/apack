import { stripVTControlCharacters } from 'node:util'

export type ClaudeCommandHistoryPresentation =
  | { kind: 'invocation'; text: string; name: string; args: string; label: string }
  | { kind: 'output'; text: string; stream: 'stdout' | 'stderr' }

// Native command envelopes escape these three entities once; arbitrary HTML remains text.
const decode = (text: string) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
/** Recognize whole persisted command envelopes, never strip tags from ordinary message bodies. */
export function presentClaudeCommandHistory(row: Record<string, unknown>, text: string): ClaudeCommandHistoryPresentation | undefined {
  if (row.type !== 'user' || row.entrypoint !== 'cli' || row.origin !== undefined) return
  const invocation = /^<command-name>([^<>]+)<\/command-name>\s*<command-message>([^<>]*)<\/command-message>\s*<command-args>([^<>]*)<\/command-args>$/.exec(text)
  if (invocation && /^\/[^\s<>]+$/.test(invocation[1]!)) {
    const name = decode(invocation[1]!), args = stripVTControlCharacters(decode(invocation[3]!))
    return { kind: 'invocation', name, args, label: decode(invocation[2]!), text: name + (args ? ' ' + args : '') }
  }
  const output = /^<local-command-(stdout|stderr)>([\s\S]*)<\/local-command-\1>$/.exec(text)
  if (output) return { kind: 'output', stream: output[1] as 'stdout' | 'stderr', text: stripVTControlCharacters(decode(output[2]!)).trim() }
}
