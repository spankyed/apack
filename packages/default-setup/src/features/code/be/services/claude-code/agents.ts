/** Native agent/session listing. Configured agent definitions come from query initialization. */
import { z } from 'zod'
import { run, runJson, type SubcommandOptions } from './subcommand.ts'

const sessionFields = {
  cwd: z.string(),
  startedAt: z.number(),
  sessionId: z.string().optional(),
  name: z.string().optional(),
  status: z.enum(['idle', 'waiting', 'busy']).optional(),
  waitingFor: z.string().optional(),
}
const jobId = z.string().regex(/^[a-f0-9]{8}$/u)
const jobState = z.enum(['working', 'blocked', 'done', 'failed', 'stopped'])
const nativeSession = z.union([
  z.object({ ...sessionFields, kind: z.literal('interactive'), pid: z.number().int().positive() }),
  z.object({ ...sessionFields, kind: z.literal('background'), id: jobId,
    state: jobState, pid: z.number().int().positive().optional() }),
  // Native process registration can precede a persistent background job record.
  z.object({ ...sessionFields, kind: z.literal('background'), pid: z.number().int().positive(),
    id: z.never().optional(), state: z.never().optional() }),
])

export type ClaudeNativeSession = z.infer<typeof nativeSession>

/** List original sessions; a stopped job has no live PID or activity status. */
export async function list(
  opts: { settingSources?: string; all?: boolean; sessionCwd?: string } & SubcommandOptions = {},
): Promise<ClaudeNativeSession[]> {
  const args = ['agents', '--json']
  if (opts.all) args.push('--all')
  if (opts.sessionCwd !== undefined) args.push('--cwd', opts.sessionCwd)
  if (opts.settingSources !== undefined) args.push('--setting-sources', opts.settingSources)
  return z.array(nativeSession).parse(await runJson<unknown>(args, opts))
}

/** Stop a native background job, preserving its conversation and job record. */
export async function stop(id: string, opts: SubcommandOptions = {}): Promise<string> {
  return run(['stop', jobId.parse(id)], opts)
}
