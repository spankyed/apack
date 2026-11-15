// Where an SSH address goes, as ssh itself would work it out: a remote such as `git@github-work:owner/name` names a
// host alias of the user's SSH config, which only ssh can read as it reads it — `Include`, `Match` and wildcards
// included. `ssh -G` prints the configuration it would connect with and connects to nothing.
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileWhileWorking } from '@apackdev/sdk/progress'
import { repoOfRemote, type GitHubRepo } from './github-api.ts'

/** Where ssh connects for an alias */
export interface SshDestination {
  hostname: string
  port?: number
}

/**
 * How long ssh may spend working out an alias: it reads files and connects to nothing, so this bounds a config whose
 * `Match exec` runs a command that hangs. A bound on CPU, as every process the pack starts is (`execFileWhileWorking`)
 */
const SSH_CPU_MS = 5_000

/** The SSH config a user's ssh reads by default */
const DEFAULT_CONFIG = () => path.join(os.homedir(), '.ssh', 'config')

/**
 * A host or alias as an SSH config can name one — letters, digits, `.`, `_` and `-`, not beginning with a dash —
 * and so never something ssh would read as an option. It is also handed to ssh after `--`
 */
const isSshHost = (host: string): boolean => /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(host)

/** What ssh answered for each alias, under the config file's change time when it was asked: a change asks again */
const resolved = new Map<string, Promise<SshDestination | undefined>>()

const changedAt = (file: string): number => {
  try { return fs.statSync(file).mtimeMs } catch { return 0 }
}

/**
 * Where ssh would connect for `host`, or nothing where ssh cannot be run or says nothing of it. A host that
 * `isSshHost` refuses is never handed to ssh. `configFile`
 * is the SSH config ssh is told to read in place of the user's own
 */
export function resolveSshHost(host: string, { configFile }: { configFile?: string } = {}): Promise<SshDestination | undefined> {
  if (!isSshHost(host)) return Promise.resolve(undefined)
  const key = `${configFile ?? ''}\0${host}\0${changedAt(configFile ?? DEFAULT_CONFIG())}`
  const known = resolved.get(key)
  if (known) return known
  const asked = execFileWhileWorking('ssh', [...(configFile ? ['-F', configFile] : []), '-G', '--', host], { timeout: SSH_CPU_MS })
    .then(({ stdout }) => destinationOf(String(stdout)), () => undefined)
  resolved.set(key, asked)
  return asked
}

/** The `hostname` and `port` lines of what `ssh -G` printed */
function destinationOf(printed: string): SshDestination | undefined {
  const value = (key: string) => new RegExp(`^${key} (\\S+)$`, 'mi').exec(printed)?.[1]
  const hostname = value('hostname')
  if (!hostname) return undefined
  const port = Number(value('port'))
  return { hostname, ...(Number.isInteger(port) && port > 0 && { port }) }
}

/** An SSH address's host and path: `ssh://[user@]host[:port]/path` or git's own `[user@]host:path` */
function sshParts(address: string): { user?: string; host: string; path: string } | undefined {
  const url = /^ssh:\/\/(?:([^@/]+)@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(address)
  if (url) return { ...(url[1] && { user: url[1] }), host: url[2]!, path: url[3]! }
  // One letter before a colon is a Windows drive, which git reads as a path
  const scp = /^(?:([^@/]+)@)?([^/:]{2,}):(?!\/\/)(.+)$/.exec(address)
  return scp ? { ...(scp[1] && { user: scp[1] }), host: scp[2]!, path: scp[3]! } : undefined
}

/**
 * The repository a remote's address names on the GitHub at `web`, as `repoOfRemote` reads it, or through the SSH
 * host alias the address names where ssh connects that alias to GitHub. Nothing for another host or a path
 */
export async function gitHubRepoOf(remoteUrl: string, web: string, options: { configFile?: string } = {}): Promise<GitHubRepo | undefined> {
  const address = remoteUrl.trim()
  const direct = repoOfRemote(address, web)
  if (direct) return direct
  const parts = sshParts(address)
  if (!parts) return undefined
  const destination = await resolveSshHost(parts.host, options)
  if (!destination || destination.hostname.toLowerCase() === parts.host.toLowerCase()) return undefined
  return repoOfRemote(`ssh://${parts.user ? `${parts.user}@` : ''}${destination.hostname}/${parts.path}`, web)
}
