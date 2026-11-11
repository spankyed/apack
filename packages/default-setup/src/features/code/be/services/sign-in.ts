// What can be done about a remote that asked for a sign-in git does not have, read from the remote's address.
// Git is run with its prompts off, so a remote that wants credentials is refused at once, and the refusal alone
// tells the user nothing they can act on. Where the remote is GitHub over HTTPS, the GitHub CLI can give git its
// own sign-in (`gh auth setup-git`), which the panel offers; elsewhere the panel says what kind of sign-in is
// missing.

/** The help there is for one remote */
export interface SignInHelp {
  /** The host that asked, as the remote's address names it */
  host: string
  /**
   * `github-cli`: the GitHub CLI can sign git in to this host. `ssh`: the host refused the key it was offered, or
   * was offered none. `https`: the host wants a username and password or token, and git has none stored for it.
   */
  kind: 'github-cli' | 'ssh' | 'https'
}

/** A host name as an address can hold one: never something a command would read as an option */
export const isHostName = (host: string): boolean => /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host)

/** The hosts the GitHub CLI signs in to without being told about them */
const GITHUB_HOSTS = new Set(['github.com'])

/**
 * The help for a remote at this address: `https://host/…`, `ssh://user@host/…`, or git's own `user@host:path`.
 * Nothing for an address with no host in it, which is a path on this machine and asks for no sign-in.
 */
export function signInHelpFor(remoteUrl: string): SignInHelp | undefined {
  const address = remoteUrl.trim()
  const url = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/:]+)/i.exec(address)
  const scheme = url?.[1]?.toLowerCase()
  // One letter before a colon is a Windows drive, which git reads as a path too
  const host = (url ? url[2] : /^(?:[^@/]+@)?([^/:]{2,}):(?!\/\/)/.exec(address)?.[1])?.toLowerCase()
  if (!host || !isHostName(host) || scheme === 'file') return undefined
  if (scheme === 'http' || scheme === 'https') return { host, kind: GITHUB_HOSTS.has(host) ? 'github-cli' : 'https' }
  return { host, kind: 'ssh' }
}
