export type ClaudeNativeCommandEnvelope =
  | { kind: 'invocation'; name: string; args: string; label: string }
  | { kind: 'output'; text: string; stream: 'stdout' | 'stderr' }

/** Recognize whole native journal envelopes; captured fields retain their original entity escaping. */
export function parseClaudeCommandEnvelope(row: Record<string, unknown>, text: string): ClaudeNativeCommandEnvelope | undefined {
  if ((row.type !== 'user' && !(row.type === 'system' && row.subtype === 'local_command')) || row.entrypoint !== 'cli' || row.origin !== undefined) return
  const invocation = /^<command-name>([^<>]+)<\/command-name>\s*<command-message>([^<>]*)<\/command-message>\s*<command-args>([^<>]*)<\/command-args>$/.exec(text)
  if (invocation && /^\/[^\s<>]+$/.test(invocation[1]!)) return { kind: 'invocation', name: invocation[1]!, args: invocation[3]!, label: invocation[2]! }
  const output = /^<local-command-(stdout|stderr)>([\s\S]*)<\/local-command-\1>$/.exec(text)
  if (output) return { kind: 'output', stream: output[1] as 'stdout' | 'stderr', text: output[2]! }
}
