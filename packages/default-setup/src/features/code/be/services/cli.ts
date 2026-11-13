import { resolveAppEnvironment } from '@apackdev/sdk/env'
import { prepareClaudeOwnedProfile, prepareClaudeOwnedProfileSetup } from './claude-code/owned-profile.ts'
import { resolveForService } from '../utils/resolve-cli.ts'
import { snapshotClaudeProfile, claudeProfileOptions, type ClaudeNativeProfile } from '../../common/native-profile.ts'
import { replyBackgroundSession } from './claude-code/background-reply.ts'
import { openBackgroundAttachment } from './claude-code/background-attachment.ts'
import { backgroundSession } from './claude-code/background-sessions.ts'
import { parseMcpElicitationForm, validateMcpElicitationForm } from '../../common/mcp-elicitation-form.ts'
import type { ClaudeNativeLaunch } from '../../common/native-launch.ts'
import { prepareClaudeNativeTerminal } from './claude-code/terminal-owner.ts'
import type { ClaudeNativeTerminalOwner } from './claude-code/terminal-owner.ts'
import type { ClaudeNativeTerminalHandoffOptions } from './claude-code/handle-store.ts'
import { getModels } from './claude-code/models.ts'
import type { ClaudeModelCatalog } from './claude-code/host-controls.ts'
import type { ClaudeConversation, ClaudeTurnConsumer } from './claude-code/conversation.ts'
import { getSessionPlan, type ClaudeSessionPlanOptions } from './claude-code/plan.ts'
import type { ClaudePlan } from './claude-code/host-controls.ts'
import './thread-history.ts'
import { renameSession, validateSessionResumeTarget, getSessionFileRewindPreview, rewindSessionFiles, type ClaudeSessionFileRewindOptions, type ClaudeSessionResumeTargetOptions } from './claude-code/session-controls.ts'
import { featureSettings } from '#generated/settings.ts';

import { openGitRepository, type AppGitRepository } from '#features/code/be/services/app-git-repository.ts'
import * as ghCli from '#features/code/be/services/gh-cli.ts'
import type { GitStatusFile, GhPullRequest, GhPRComment, GhReviewThread } from '#features/code/be/types.ts'
import { getSessionContextUsage, type ClaudeSessionContextOptions } from './claude-code/context.ts'
import type { ClaudeFileRewind, ClaudeContextUsage } from './claude-code/host-controls.ts'
import { claudeCode } from './claude-code/index.ts'
import type { QueryOptions, QueryHandle, AuthStatus, SessionInfo, SessionListOptions, SessionTranscriptEntry, SessionViewOptions } from './claude-code/index.ts'
import type { ExecOnceOptions, ExecOnceResult } from './claude-code/runner.ts'
import { storeHandle, getHandle, clearHandle, getNativeLaunch, openNativeTerminal, getNativeTerminal, openConversation, getConversation, isConversationBusy, closeIdleConversation, isCurrentTurn } from './claude-code/handle-store.ts'
import { codexExec } from './codex/runner.ts'
import type { CodexExecOptions, CodexExecResult } from './codex/runner.ts'
import { testCli, isCliName } from '../utils/resolve-cli.ts'
import { configDir } from './claude-code/sessions.ts'
import fs from 'fs'
import path from 'path'
import os from 'os'

export interface CliServiceType {
  git: {
    commit(message: string): Promise<void>
    readStatus(): Promise<GitStatusFile[]>
    readCurrentBranch(): Promise<string>
    getWorkingDir(): string
    /**
     * Return the unified diff for the working copy vs HEAD. Pass a list of
     * paths to restrict to specific files; omit to get all changes. Used by
     * the Claude Code chat action to assemble a `diff` artifact after file-
     * mutating tool calls (Write/Edit/NotebookEdit).
     */
    readDiff(paths?: string[]): Promise<string>
    /** A copy of the working tree, kept outside the repository: its id, for `changedSince` and `restoreCheckpoint` */
    checkpoint(): Promise<string>
    /** What differs now from a copy, each file with whether it was added, modified or deleted since */
    changedSince(id: string): Promise<{ path: string; change: 'added' | 'modified' | 'deleted' }[]>
    /** Puts the working tree back as a copy has it, removing what was made since */
    restoreCheckpoint(id: string): Promise<void>
  }
  gh: {
    findPRForBranch(branch?: string): Promise<GhPullRequest | null>
    getPRDetails(number: number, repo?: { owner: string; name: string }): Promise<GhPullRequest & { comments: GhPRComment[] }>
    getReviewThreads(number: number, repo?: { owner: string; name: string }): Promise<GhReviewThread[]>
  }
  /**
   * Claude Code wrapper. Highlights only — the full surface (sessions, mcp,
   * plugins, skills, …) is available from '#features/code/be/services/claude-code/index.ts'.
   */
  /** Clear-cache resolve + exec test — same path as the Settings test button. */
  testCli(provider: string): Promise<{ success: true; resolvedPath: string } | { success: false; error: string }>
  claudeCode: {
    openBackgroundAttachment: typeof openBackgroundAttachment
    backgroundSession: typeof backgroundSession
    replyBackgroundSession: typeof replyBackgroundSession
    parseMcpElicitationForm: typeof parseMcpElicitationForm
    validateMcpElicitationForm: typeof validateMcpElicitationForm
    query(opts: Omit<QueryOptions, 'cwd'> & { cwd?: string }): Promise<QueryHandle>
    openConversation(key: string, launchKey: string, opts: Omit<QueryOptions, 'cwd' | 'prompt'> & { cwd?: string; accountedCostUsd?: number }, consumeAutonomous: ClaudeTurnConsumer): Promise<ClaudeConversation>
    getConversation(key: string): { owner: ClaudeConversation; launchKey: string } | undefined
    isConversationBusy(key: string): boolean
    isCurrentTurn(key: string, handle: QueryHandle): boolean
    closeIdleConversation(key: string): Promise<boolean>
    /** Read a saved session's native plan without a prompt or transcript writes. */
    getPlan(opts: Omit<ClaudeSessionPlanOptions, 'cwd'> & { cwd?: string }): Promise<ClaudePlan>
    /** Read a saved session's native context summary without a prompt or transcript writes. */
    getContextUsage(opts: Omit<ClaudeSessionContextOptions, 'cwd'> & { cwd?: string }): Promise<ClaudeContextUsage>
    /** Validate native fork/resume membership without a prompt or persisted fork. */
    validateResumeTarget(opts: Omit<ClaudeSessionResumeTargetOptions, 'cwd'> & { cwd?: string }): Promise<void>
    getFileRewindPreview(opts: Omit<ClaudeSessionFileRewindOptions, 'cwd'> & {cwd?: string}): Promise<ClaudeFileRewind>
    rewindFiles(opts: Omit<ClaudeSessionFileRewindOptions, 'cwd'> & {cwd?: string}): Promise<ClaudeFileRewind>
    /** Config root to pin before creating a conversation. No credentials are returned. */
    profile(): ClaudeNativeProfile
    prepareOwnedProfileSetup(): Promise<{command: string; cwd: string}>
    version(): Promise<string>
    authStatus(opts?: {env?: NodeJS.ProcessEnv}): Promise<AuthStatus>
    listSessions(opts?: SessionListOptions): Promise<SessionInfo[]>
    /** List sessions across ALL project directories (not just the configured cwd). */
    listAllSessions(opts?: { limit?: number; env?: NodeJS.ProcessEnv }): Promise<SessionInfo[]>
    /**
     * Parse a session's JSONL transcript into an in-memory array of entries.
     * Used by `CC: Handle Rewind` to retroactively backfill `context.cliUuid`
     * on pre-existing user messages from Claude's own session file.
     * `cwd` defaults to the configured project directory.
     */
    viewSession(id: string, opts?: Omit<SessionViewOptions, 'cwd'> & { cwd?: string }): Promise<SessionTranscriptEntry[]>
    /** Parse a JSONL file directly by path (bypasses cwd→bucket lookup). */
    viewSessionByFile(filePath: string, opts?: { limit?: number; offset?: number }): Promise<SessionTranscriptEntry[]>
    getWorkingDir(): string
    /** Store a live query handle so other actions can write control_responses. */
    storeHandle(key: string, handle: QueryHandle): void
    /** Retrieve a stored query handle by key (typically threadId). */
    getHandle(key: string): QueryHandle | undefined
    /** Release an owned turn; idle process controls remain available until close/teardown. */
    clearHandle(key: string): void
    /** Explicitly move an idle live conversation into its native terminal interface. */
    openNativeTerminal(key: string, options?: ClaudeNativeTerminalHandoffOptions): Promise<ClaudeNativeTerminalOwner>
    getNativeLaunch(key: string): Promise<ClaudeNativeLaunch | undefined>
    getNativeTerminal(key: string): ClaudeNativeTerminalOwner | undefined
    /**
     * Low-level one-shot CLI invocation. Used by `CC: Handle Revert` to run
     * `claude --resume <sid> --rewind-files <uuid>` for file-rewind on revert.
     * `cwd` defaults to the configured project directory.
     */
    exec(args: readonly string[], opts?: Omit<ExecOnceOptions, 'cwd'> & { cwd?: string }): Promise<ExecOnceResult>
    /** Read the CLI's user-scope settings.json (~/.claude/settings.json). */
    readSettings(opts?: {env?: NodeJS.ProcessEnv}): Promise<Record<string, any>>
    /** Write the CLI's user-scope settings.json (~/.claude/settings.json). */
    writeSettings(settings: Record<string, any>, opts?: {env?: NodeJS.ProcessEnv}): Promise<void>
    /** Native model discovery can run session hooks when a temporary process is explicitly requested. */
    getModels(opts?: { cwd?: string; env?: NodeJS.ProcessEnv; includeUnsupportedModels?: boolean }): Promise<ClaudeModelCatalog>
    /** List skill files from user (~/.claude/skills/) and project (.claude/skills/) dirs. */
    listSkills(opts?: {env?: NodeJS.ProcessEnv}): Promise<Array<{ name: string; scope: string; path: string }>>
    /** List memory/CLAUDE.md files from known locations. */
    listMemoryFiles(opts?: {env?: NodeJS.ProcessEnv}): Promise<Array<{ name: string; scope: string; path: string }>>
    /** Rename a Claude Code session through the native process. */
    renameSession(id: string, title: string, opts?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<void>
    /** Check whether a session JSONL file exists under the given (or default) project directory. */
    sessionExists(id: string, opts?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<boolean>
  }
  /** Codex CLI wrapper for one-shot tasks. */
  codex: {
    /**
     * Low-level one-shot CLI invocation via `codex exec`.
     * `cwd` defaults to the configured project directory.
     */
    exec(args: readonly string[], opts?: Omit<CodexExecOptions, 'cwd'> & { cwd?: string }): Promise<CodexExecResult>
  }
}

function createCliService(): CliServiceType {
  let gitRepo: AppGitRepository | null = null
  let lastCwd: string | null = null

  function resolveCwd(): string {
    const codeSettings = featureSettings.forFeature('code').get()
    let cwd = codeSettings?.defaultBaseDirectory || codeSettings?.baseDirectory || null
    if (!cwd) {
      throw new Error('No project directory configured. Open a directory in the Code panel first.')
    }
    if (cwd.startsWith('~/')) {
      cwd = path.join(os.homedir(), cwd.slice(2))
    } else if (cwd === '~') {
      cwd = os.homedir()
    }
    return cwd
  }

  function selectedClaudeProfile(): ClaudeNativeProfile {
    const profile = snapshotClaudeProfile(process.env)
    if (featureSettings.forFeature('code').get().claudeProfile === 'app') profile.configDir = path.join(resolveAppEnvironment().userDataDir, 'claude-code-profile', 'config')
    return profile
  }
  function claudeEnvironment(override?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return {...claudeProfileOptions({profile: selectedClaudeProfile()}).env, ...override}
  }
  async function prepareClaudeEnvironment(override?: NodeJS.ProcessEnv) {
    const env = claudeEnvironment(override), userDataDir = resolveAppEnvironment().userDataDir
    if (env.CLAUDE_CONFIG_DIR === path.join(userDataDir, 'claude-code-profile', 'config')) await prepareClaudeOwnedProfile({userDataDir, env})
    return env
  }

  function getGitRepo(): AppGitRepository {
    const cwd = resolveCwd()
    if (!gitRepo || lastCwd !== cwd) {
      gitRepo = openGitRepository(cwd)
      lastCwd = cwd
    }
    return gitRepo
  }

  return {
    testCli(provider: string) {
      if (!isCliName(provider)) {
        return Promise.resolve({ success: false as const, error: `Unknown CLI provider: ${provider}` });
      }
      const storedPath = featureSettings.forFeature('code').get().cliPaths[provider];
      return testCli(provider, storedPath);
    },
    git: {
      async commit(message: string): Promise<void> {
        await getGitRepo().commit(message)
      },
      async readStatus(): Promise<GitStatusFile[]> {
        return getGitRepo().readStatus()
      },
      async readCurrentBranch(): Promise<string> {
        return getGitRepo().readCurrentBranch()
      },
      getWorkingDir(): string {
        return resolveCwd()
      },
      async readDiff(paths?: string[]): Promise<string> {
        const repo = getGitRepo()
        if (!paths || paths.length === 0) {
          return repo.readDiff()
        }
        return repo.readDiffs(paths)
      },
      async checkpoint(): Promise<string> {
        return (await getGitRepo().checkpoint()).id
      },
      async changedSince(id: string) {
        return getGitRepo().changedSince(id)
      },
      async restoreCheckpoint(id: string): Promise<void> {
        await getGitRepo().restoreCheckpoint(id)
      },
    },
    gh: {
      async findPRForBranch(branch?: string): Promise<GhPullRequest | null> {
        const cwd = resolveCwd()
        const branchName = branch || await getGitRepo().readCurrentBranch()
        return ghCli.findPRForBranch(cwd, branchName)
      },
      async getPRDetails(number: number, repo?: { owner: string; name: string }): Promise<GhPullRequest & { comments: GhPRComment[] }> {
        const cwd = resolveCwd()
        return ghCli.getPRDetails(cwd, number, repo)
      },
      async getReviewThreads(number: number, repo?: { owner: string; name: string }): Promise<GhReviewThread[]> {
        const cwd = resolveCwd()
        return ghCli.getReviewThreads(cwd, number, repo)
      },
    },
    claudeCode: {
      openBackgroundAttachment,
      backgroundSession,
      replyBackgroundSession,
      parseMcpElicitationForm,
      validateMcpElicitationForm,
      async query(opts) {
        const env = await prepareClaudeEnvironment(opts.env)
        const cwd = opts.cwd ?? resolveCwd()
        // Default replayUserMessages=true so the CLI emits post-persistence
        // user replay events (SDKUserMessageReplay) carrying the canonical
        // `uuid`. Without this flag, only the input-echo user event is
        // emitted — which has no uuid — and stream-consumer's live
        // `context.cliUuid` write for user messages never fires. Gated
        // in Claude at src/main.tsx:1944-1950 (cliArgs.replayUserMessages
        // || UDS_INBOX feature). Callers can still override by passing
        // `replayUserMessages: false` explicitly (spread order honors it).
        return claudeCode.query({ replayUserMessages: true, ...opts, env, cwd })
      },
      openConversation(key, launchKey, opts, consumeAutonomous) {
        const { accountedCostUsd = 0, ...queryOptions } = opts
        return openConversation(key, launchKey, async () => claudeCode.query({ ...queryOptions, env: await prepareClaudeEnvironment(queryOptions.env), cwd: opts.cwd ?? resolveCwd(),
          prompt: undefined, keepStdinOpen: true, surfaceControlRequests: true, replayUserMessages: true }), consumeAutonomous, accountedCostUsd)
      },
      getConversation,
      openNativeTerminal(key, options = {}) { return openNativeTerminal(key, options, prepareClaudeNativeTerminal, async launch => {
        const { sessionId, columns: _columns, rows: _rows, ...queryOptions } = launch
        const handle = await claudeCode.query({ ...queryOptions, env: await prepareClaudeEnvironment(queryOptions.env), resume: sessionId, keepStdinOpen: true, noSessionPersistence: true })
        try {
          const settings = await handle.getSettings(), permissionMode = await handle.getPermissionMode()
          if (!permissionMode) throw new Error('Native permission mode has not been acknowledged')
          return { settings, permissionMode }
        } finally { await handle.close() }
      }) },
      getNativeLaunch,
      getNativeTerminal,
      isConversationBusy,
      isCurrentTurn,
      closeIdleConversation,
      async getPlan(opts) {
        return getSessionPlan({ ...opts, env: await prepareClaudeEnvironment(opts.env), cwd: opts.cwd ?? resolveCwd() })
      },
      async getContextUsage(opts) {
        return getSessionContextUsage({ ...opts, env: await prepareClaudeEnvironment(opts.env), cwd: opts.cwd ?? resolveCwd() })
      },
      async validateResumeTarget(opts) {
        return validateSessionResumeTarget({ ...opts, env: await prepareClaudeEnvironment(opts.env), cwd: opts.cwd ?? resolveCwd() })
      },
      async getFileRewindPreview(opts) { return getSessionFileRewindPreview({...opts, env: await prepareClaudeEnvironment(opts.env), cwd: opts.cwd ?? resolveCwd()}) },
      async rewindFiles(opts) { return rewindSessionFiles({...opts, env: await prepareClaudeEnvironment(opts.env), cwd: opts.cwd ?? resolveCwd()}) },
      version() {
        return claudeCode.system.version()
      },
      async authStatus(opts) {
        return claudeCode.auth.status({env: await prepareClaudeEnvironment(opts?.env)})
      },
      profile: selectedClaudeProfile,
      async prepareOwnedProfileSetup() {
        const cwd = resolveCwd()
        return prepareClaudeOwnedProfileSetup({cwd, userDataDir: resolveAppEnvironment().userDataDir, cliPath: await resolveForService('claude-code')})
      },
      listSessions(opts) {
        const cwd = opts?.cwd ?? resolveCwd()
        return claudeCode.sessions.list({ ...opts, env: claudeEnvironment(opts?.env), cwd })
      },
      listAllSessions(opts) {
        return claudeCode.sessions.listAll({...opts, env: claudeEnvironment(opts?.env)})
      },
      viewSession(id, opts) {
        const cwd = opts?.cwd ?? resolveCwd()
        return claudeCode.sessions.view(id, { ...opts, env: claudeEnvironment(opts?.env), cwd })
      },
      viewSessionByFile(filePath, opts) {
        return claudeCode.sessions.viewByFile(filePath, opts)
      },
      getWorkingDir() {
        return resolveCwd()
      },
      storeHandle,
      getHandle,
      clearHandle,
      async exec(args, opts) {
        const cwd = opts?.cwd ?? resolveCwd()
        return claudeCode.exec(args, { ...opts, env: await prepareClaudeEnvironment(opts?.env), cwd })
      },
      async readSettings(opts) {
        const settingsPath = path.join(configDir(await prepareClaudeEnvironment(opts?.env)), 'settings.json')
        let raw: string
        try {
          raw = await fs.promises.readFile(settingsPath, 'utf-8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
          throw error
        }
        let settings: unknown
        try { settings = JSON.parse(raw) }
        catch { throw new Error('Claude Code settings.json is not valid JSON; repair it before editing.') }
        if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
          throw new Error('Claude Code settings.json must contain an object; repair it before editing.')
        }
        return settings as Record<string, any>
      },
      async writeSettings(settings, opts) {
        const settingsPath = path.join(configDir(await prepareClaudeEnvironment(opts?.env)), 'settings.json')
        try {
          await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2))
        } catch (err: any) {
          if (err?.code === 'ENOENT') {
            throw new Error('Claude Code config directory not found (~/.claude/). Is Claude Code installed?')
          }
          throw err
        }
      },
      async getModels(opts) {
        return getModels({ env: await prepareClaudeEnvironment(opts?.env), cwd: opts?.cwd ?? resolveCwd(), ...(opts?.includeUnsupportedModels !== undefined ? { includeUnsupportedModels: opts.includeUnsupportedModels } : {}) })
      },
      async listSkills(opts) {
        const results: Array<{ name: string; scope: string; path: string }> = []
        const dirs = [
          { dir: path.join(configDir(claudeEnvironment(opts?.env)), 'skills'), scope: 'user' },
          { dir: path.join(resolveCwd(), '.claude', 'skills'), scope: 'project' },
        ]
        for (const { dir, scope } of dirs) {
          try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true })
            for (const entry of entries) {
              if (entry.isFile() && entry.name.endsWith('.md')) {
                results.push({
                  name: entry.name.replace(/\.md$/, ''),
                  scope,
                  path: path.join(dir, entry.name),
                })
              }
            }
          } catch { /* dir doesn't exist */ }
        }
        return results
      },
      async listMemoryFiles(opts) {
        const cwd = resolveCwd()
        const results: Array<{ name: string; scope: string; path: string }> = []
        const candidates = [
          { filePath: path.join(configDir(claudeEnvironment(opts?.env)), 'CLAUDE.md'), name: 'CLAUDE.md', scope: 'user' },
          { filePath: path.join(cwd, 'CLAUDE.md'), name: 'CLAUDE.md', scope: 'project' },
          { filePath: path.join(cwd, 'CLAUDE.local.md'), name: 'CLAUDE.local.md', scope: 'local' },
        ]
        for (const { filePath, name, scope } of candidates) {
          try {
            await fs.promises.access(filePath)
            results.push({ name, scope, path: filePath })
          } catch { /* doesn't exist */ }
        }
        // Scan rules directories
        const rulesDirs = [
          { dir: path.join(configDir(claudeEnvironment(opts?.env)), 'rules'), scope: 'user' },
          { dir: path.join(cwd, '.claude', 'rules'), scope: 'project' },
        ]
        for (const { dir, scope } of rulesDirs) {
          try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true })
            for (const entry of entries) {
              if (entry.isFile() && entry.name.endsWith('.md')) {
                results.push({
                  name: `rules/${entry.name}`,
                  scope,
                  path: path.join(dir, entry.name),
                })
              }
            }
          } catch { /* dir doesn't exist */ }
        }
        return results
      },
      async renameSession(id, title, opts) {
        const cwd = opts?.cwd ?? resolveCwd()
        await renameSession({ sessionId: id, title, cwd, env: await prepareClaudeEnvironment(opts?.env) })
      },
      async sessionExists(id, opts) {
        const cwd = opts?.cwd ?? resolveCwd()
        const info = await claudeCode.sessions.find(id, { cwd, env: claudeEnvironment(opts?.env) })
        return info !== null
      },
    },
    codex: {
      exec(args, opts) {
        const cwd = opts?.cwd ?? resolveCwd()
        return codexExec(args, { ...opts, cwd })
      },
    },
  }
}

export const cliService = createCliService()
