import { claudeTerminalUiRuntime } from './terminal-ui-runtime.ts'
import { mkdir, lstat, readFile, writeFile, rename, readdir, realpath } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { claudeOwnedLauncherRuntime } from './owned-profile-runtime.ts'

const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'"
const preparing = new Map<string, Promise<{configDir: string; launcher: string}>>()

/** Prepare an exclusively app-owned native profile before its first daemon or sign-in starts. */
export function prepareClaudeOwnedProfile(options: {userDataDir: string; nodePath?: string; env?: NodeJS.ProcessEnv}) {
  if (process.platform === 'win32') return Promise.reject(new Error('App profiles are currently available on macOS and Linux'))
  if (!isAbsolute(options.userDataDir)) return Promise.reject(new Error('The app profile path must be absolute'))
  const directory = join(options.userDataDir, 'claude-code-profile'), configDir = join(directory, 'config')
  const storage = {...process.env, ...options.env}.CLAUDE_SECURESTORAGE_CONFIG_DIR
  if (storage !== undefined && storage !== configDir) return Promise.reject(new Error('CLAUDE_SECURESTORAGE_CONFIG_DIR selects another credential store. An isolated Claude profile cannot use it.'))
  const existing = preparing.get(directory)
  if (existing) return existing
  const pending = prepare(directory, configDir, options.nodePath ?? process.execPath).finally(() => {
    if (preparing.get(directory) === pending) preparing.delete(directory)
  })
  preparing.set(directory, pending)
  return pending
}

async function privateDirectory(path: string) {
  await mkdir(path, {mode: 0o700, recursive: true})
  const info = await lstat(path)
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error('Claude profile directory is not private and owned by this user')
}

async function atomicWrite(path: string, value: string, mode: number) {
  const temporary = path + '.' + randomUUID() + '.tmp'
  await writeFile(temporary, value, {mode, flag: 'wx'})
  await rename(temporary, path)
}

async function prepare(directory: string, configDir: string, nodePath: string) {
  if (!isAbsolute(nodePath)) throw new Error('The app Node executable path must be absolute')
  await privateDirectory(directory)
  const marker = join(directory, 'owner.json')
  const owner = await lstat(marker).catch(error => {if (error.code !== 'ENOENT') throw error})
  if (!owner) {
    if ((await readdir(directory)).length) throw new Error('Refusing to adopt an existing Claude profile')
    await writeFile(marker, JSON.stringify({owner: 'apack', configDir}), {mode: 0o600, flag: 'wx'})
  } else {
    if (!owner.isFile() || owner.uid !== process.getuid?.() || (owner.mode & 0o077) !== 0) throw new Error('Claude profile ownership marker is not private')
    let value: {owner?: string; configDir?: string}
    try { value = JSON.parse(await readFile(marker, 'utf8')) } catch { throw new Error('The app profile ownership record is not valid JSON') }
    if (!value || value.owner !== 'apack' || value.configDir !== configDir) throw new Error('Claude profile ownership does not match this app')
  }
  await privateDirectory(configDir)
  const bin = join(directory, 'bin')
  await privateDirectory(bin)
  const helper = join(bin, 'launch.mjs'), launcher = join(bin, 'launch.sh')
  await atomicWrite(helper, claudeOwnedLauncherRuntime, 0o600)
  // A command-scoped Electron flag runs the helper as Node without leaking that flag to Claude.
  await atomicWrite(launcher, '#!/bin/sh\nset -eu\npreload=$(ELECTRON_RUN_AS_NODE=1 ' + quote(nodePath) + ' ' + quote(helper) + ' ' + quote(configDir) + ' "$$" "$@")\nif [ -n "$preload" ]; then\n  BUN_OPTIONS="${BUN_OPTIONS:+$BUN_OPTIONS }--preload=$preload"\n  export BUN_OPTIONS\nfi\nexec "$@"\n', 0o700)
  const settingsPath = join(configDir, 'settings.json')
  const info = await lstat(settingsPath).catch(error => {if (error.code !== 'ENOENT') throw error})
  if (info && (!info.isFile() || info.uid !== process.getuid?.())) throw new Error('Claude profile settings are not private')
  let settings: Record<string, unknown> = {}
  if (info) {
    const raw = await readFile(settingsPath, 'utf8')
    try { settings = JSON.parse(raw) } catch { throw new Error('Claude profile settings.json is not valid JSON; repair it before setup') }
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Claude profile settings must be an object')
  // Original native parser accepts JSON argv; shell quoting is not its settings grammar.
  const prefix = JSON.stringify([launcher])
  if (settings.processWrapper !== undefined && settings.processWrapper !== prefix) throw new Error('The app-owned Claude profile already selects another launcher')
  if (settings.processWrapper === undefined) await atomicWrite(settingsPath, JSON.stringify({...settings, processWrapper: prefix}, null, 2) + '\n', 0o600)
  return {configDir, launcher}
}


/** Install a startup descriptor only for the original worker of this app-owned profile. */
export async function prepareClaudeOwnedChildUi(options: {
  userDataDir: string; configDir?: string; secureStorageConfigDir?: string; executable: string; directory: string; socketPath: string; token: string
}) {
  if (options.configDir !== join(options.userDataDir, 'claude-code-profile', 'config')) return false
  const profile = await prepareClaudeOwnedProfile({userDataDir: options.userDataDir, env: {CLAUDE_SECURESTORAGE_CONFIG_DIR: options.secureStorageConfigDir}})
  await privateDirectory(options.directory)
  await atomicWrite(join(options.directory, 'child-ui-template.mjs'), claudeTerminalUiRuntime, 0o600)
  await atomicWrite(join(options.directory, 'child-ui-launch.json'), JSON.stringify({
    directory: options.directory, configDir: profile.configDir, executable: await realpath(options.executable), socketPath: options.socketPath, token: options.token,
  }), 0o600)
  return true
}


/** Let the original CLI own onboarding, sign-in, project trust and its normal shutdown. */
export async function prepareClaudeOwnedProfileSetup(options: {userDataDir: string; cwd: string; cliPath: string; env?: NodeJS.ProcessEnv}) {
  const environment = {...process.env, ...options.env}
  const profile = await prepareClaudeOwnedProfile({userDataDir: options.userDataDir, env: environment})
  const assignments = ['CLAUDE_CONFIG_DIR=' + profile.configDir]
  if (environment.CLAUDE_SECURESTORAGE_CONFIG_DIR !== undefined) assignments.push('CLAUDE_SECURESTORAGE_CONFIG_DIR=' + environment.CLAUDE_SECURESTORAGE_CONFIG_DIR)
  return {cwd: options.cwd, command: '/usr/bin/env -u CLAUDE_CONFIG_DIR -u CLAUDE_SECURESTORAGE_CONFIG_DIR ' + assignments.map(quote).join(' ') + ' ' + quote(options.cliPath)}
}
