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

import { GitRepository } from '#features/code/be/services/git.ts'
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
    getStatus(): Promise<GitStatusFile[]>
    getCurrentBranch(): Promise<string>
    getWorkingDir(): string
    /**
     * Return the unified diff for the working copy vs HEAD. Pass a list of
     * paths to restrict to specific files; omit to get all changes. Used by
     * the Claude Code chat action to assemble a `diff` artifact after file-
     * mutating tool calls (Write/Edit/NotebookEdit).
     */
    getDiff(paths?: string[]): Promise<string>
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
    backgroundSession: typeof backgroundSession
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
    version(): Promise<string>
    authStatus(): Promise<AuthStatus>
    listSessions(opts?: SessionListOptions): Promise<SessionInfo[]>
    /** List sessions across ALL project directories (not just the configured cwd). */
    listAllSessions(opts?: { limit?: number }): Promise<SessionInfo[]>
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
    readSettings(): Promise<Record<string, any>>
    /** Write the CLI's user-scope settings.json (~/.claude/settings.json). */
    writeSettings(settings: Record<string, any>): Promise<void>
    /** Native model discovery can run session hooks when a temporary process is explicitly requested. */
    getModels(opts?: { cwd?: string; includeUnsupportedModels?: boolean }): Promise<ClaudeModelCatalog>
    /** List skill files from user (~/.claude/skills/) and project (.claude/skills/) dirs. */
    listSkills(): Promise<Array<{ name: string; scope: string; path: string }>>
    /** List memory/CLAUDE.md files from known locations. */
    listMemoryFiles(): Promise<Array<{ name: string; scope: string; path: string }>>
    /** Rename a Claude Code session through the native process. */
    renameSession(id: string, title: string, opts?: { cwd?: string }): Promise<void>
    /** Check whether a session JSONL file exists under the given (or default) project directory. */
    sessionExists(id: string, opts?: { cwd?: string }): Promise<boolean>
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
  let gitRepo: GitRepository | null = null
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

  function getGitRepo(): GitRepository {
    const cwd = resolveCwd()
    if (!gitRepo || lastCwd !== cwd) {
      gitRepo = new GitRepository(cwd)
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
      async getStatus(): Promise<GitStatusFile[]> {
        return getGitRepo().getStatus()
      },
      async getCurrentBranch(): Promise<string> {
        return getGitRepo().getCurrentBranch()
      },
      getWorkingDir(): string {
        return resolveCwd()
      },
      async getDiff(paths?: string[]): Promise<string> {
        const repo = getGitRepo()
        if (!paths || paths.length === 0) {
          return repo.getDiff()
        }
        return repo.getDiffMulti(paths)
      },
    },
    gh: {
      async findPRForBranch(branch?: string): Promise<GhPullRequest | null> {
        const cwd = resolveCwd()
        const branchName = branch || await getGitRepo().getCurrentBranch()
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
      backgroundSession,
      parseMcpElicitationForm,
      validateMcpElicitationForm,
      query(opts) {
        const cwd = opts.cwd ?? resolveCwd()
        // Default replayUserMessages=true so the CLI emits post-persistence
        // user replay events (SDKUserMessageReplay) carrying the canonical
        // `uuid`. Without this flag, only the input-echo user event is
        // emitted — which has no uuid — and stream-consumer's live
        // `context.cliUuid` write for user messages never fires. Gated
        // in Claude at src/main.tsx:1944-1950 (cliArgs.replayUserMessages
        // || UDS_INBOX feature). Callers can still override by passing
        // `replayUserMessages: false` explicitly (spread order honors it).
        return claudeCode.query({ replayUserMessages: true, ...opts, cwd })
      },
      openConversation(key, launchKey, opts, consumeAutonomous) {
        const { accountedCostUsd = 0, ...queryOptions } = opts
        return openConversation(key, launchKey, () => claudeCode.query({ ...queryOptions, cwd: opts.cwd ?? resolveCwd(),
          prompt: undefined, keepStdinOpen: true, surfaceControlRequests: true, replayUserMessages: true }), consumeAutonomous, accountedCostUsd)
      },
      getConversation,
      openNativeTerminal(key, options = {}) { return openNativeTerminal(key, options, prepareClaudeNativeTerminal, async launch => {
        const { sessionId, columns: _columns, rows: _rows, ...queryOptions } = launch
        const handle = await claudeCode.query({ ...queryOptions, resume: sessionId, keepStdinOpen: true, noSessionPersistence: true })
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
      getPlan(opts) {
        return getSessionPlan({ ...opts, cwd: opts.cwd ?? resolveCwd() })
      },
      getContextUsage(opts) {
        return getSessionContextUsage({ ...opts, cwd: opts.cwd ?? resolveCwd() })
      },
      validateResumeTarget(opts) {
        return validateSessionResumeTarget({ ...opts, cwd: opts.cwd ?? resolveCwd() })
      },
      getFileRewindPreview(opts) { return getSessionFileRewindPreview({...opts, cwd: opts.cwd ?? resolveCwd()}) },
      rewindFiles(opts) { return rewindSessionFiles({...opts, cwd: opts.cwd ?? resolveCwd()}) },
      version() {
        return claudeCode.system.version()
      },
      authStatus() {
        return claudeCode.auth.status()
      },
      listSessions(opts) {
        const cwd = opts?.cwd ?? resolveCwd()
        return claudeCode.sessions.list({ ...opts, cwd })
      },
      listAllSessions(opts) {
        return claudeCode.sessions.listAll(opts)
      },
      viewSession(id, opts) {
        const cwd = opts?.cwd ?? resolveCwd()
        return claudeCode.sessions.view(id, { ...opts, cwd })
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
      exec(args, opts) {
        const cwd = opts?.cwd ?? resolveCwd()
        return claudeCode.exec(args, { ...opts, cwd })
      },
      async readSettings() {
        const settingsPath = path.join(configDir(), 'settings.json')
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
      async writeSettings(settings) {
        const settingsPath = path.join(configDir(), 'settings.json')
        try {
          await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2))
        } catch (err: any) {
          if (err?.code === 'ENOENT') {
            throw new Error('Claude Code config directory not found (~/.claude/). Is Claude Code installed?')
          }
          throw err
        }
      },
      getModels(opts) {
        return getModels({ cwd: opts?.cwd ?? resolveCwd(), ...(opts?.includeUnsupportedModels !== undefined ? { includeUnsupportedModels: opts.includeUnsupportedModels } : {}) })
      },
      async listSkills() {
        const results: Array<{ name: string; scope: string; path: string }> = []
        const dirs = [
          { dir: path.join(configDir(), 'skills'), scope: 'user' },
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
      async listMemoryFiles() {
        const cwd = resolveCwd()
        const results: Array<{ name: string; scope: string; path: string }> = []
        const candidates = [
          { filePath: path.join(os.homedir(), '.claude', 'CLAUDE.md'), name: 'CLAUDE.md', scope: 'user' },
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
          { dir: path.join(os.homedir(), '.claude', 'rules'), scope: 'user' },
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
        await renameSession({ sessionId: id, title, cwd })
      },
      async sessionExists(id, opts) {
        const cwd = opts?.cwd ?? resolveCwd()
        const info = await claudeCode.sessions.find(id, { cwd })
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
