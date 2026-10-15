/** Native agent/session listing. Configured agent definitions come from query initialization. */
import { z } from 'zod'
import { runJson, type SubcommandOptions } from './subcommand.ts'

/** List active interactive/background sessions, optionally including completed sessions. */
export async function list(
  opts: { settingSources?: string; all?: boolean; sessionCwd?: string } & SubcommandOptions = {},
): Promise<Array<Record<string, unknown>>> {
  const args = ['agents', '--json']
  if (opts.all) args.push('--all')
  if (opts.sessionCwd !== undefined) args.push('--cwd', opts.sessionCwd)
  if (opts.settingSources !== undefined) args.push('--setting-sources', opts.settingSources)
  // Populated fields remain opaque until verified against a real background session.
  return z.array(z.record(z.unknown())).parse(await runJson<unknown>(args, opts))
}
