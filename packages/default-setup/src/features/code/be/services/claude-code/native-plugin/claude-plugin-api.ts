/**
 * The Claude Code plugin API this program is written against, as of CLI **2.1.302**.
 *
 * **A declaration is what makes a CLI upgrade a typecheck failure rather than a silent adoption.** The
 * plugin runs inside the CLI's own runtime, so nothing in this repo can check the calls it makes — the
 * accessors and hook payloads below are the only thing that does, and they describe one release. A later
 * release is a reviewed delta: widen or correct these types in the same change that adopts it, and the
 * program's own typecheck says which call sites the change reaches.
 *
 * Only what the program uses is declared. An accessor the CLI has and this program does not call is
 * deliberately absent: a type nobody calls cannot be wrong, and adding it would claim a guarantee no test
 * here holds.
 */

/** The CLI release these declarations were read from. */
export const CLAUDE_PLUGIN_API_VERSION = '2.1.302';

/** `$.session` — what the CLI knows about the session the hook is running in. */
export interface ClaudePluginSession {
  id(): Promise<string>;
  cwd(): Promise<string>;
  model(): Promise<string>;
  turns(): Promise<number>;
  usage(): Promise<ClaudePluginUsage>;
}

/** What `$.session.usage()` answers. `cost` is absent until the session has spent something. */
export interface ClaudePluginUsage {
  startedAt?: number;
  cost?: { usd?: number };
}

/** One entry of `$.agent.list()`: a subagent the session has running. */
export interface ClaudePluginAgent {
  id: string;
  type?: string;
  status?: string;
}

/** A status-line helper as settings declare it. `command` is only meaningful when `type` is `command`. */
export interface ClaudePluginStatusLine {
  type?: string;
  command?: unknown;
}

/** What `$.settings.read()` answers, in the fields this program reads. */
export interface ClaudePluginSettings {
  allowManagedHooksOnly?: boolean;
  disableAllHooks?: boolean;
  statusLine?: ClaudePluginStatusLine | null;
  subagentStatusLine?: ClaudePluginStatusLine | null;
}

/** `$.http.fetch`'s answer. `text` is the body already read, not a reader. */
export interface ClaudePluginResponse {
  ok: boolean;
  status: number;
  text: string;
}

/** What `$.http.fetch` takes. `socketPath` is what makes this a request to the app and not the network. */
export interface ClaudePluginRequest {
  method: string;
  socketPath: string;
  headers: Record<string, string>;
  body: string;
}

/** `$.clock.every`'s handle. The CLI may answer nothing, so every use of it is optional. */
export interface ClaudePluginTimer {
  cancel(): void;
}

/** What `$.process.run` answers. */
export interface ClaudePluginProcessResult {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

/** The accessors `$` carries, the `$` every hook handler is given. */
export interface ClaudePluginApi {
  session: ClaudePluginSession;
  agent: { list(): Promise<readonly ClaudePluginAgent[]> };
  settings: { read(options?: { source: 'policy' }): Promise<ClaudePluginSettings> };
  env: {
    get(name: string): Promise<string | undefined>;
    set(name: string, value?: string): Promise<{ deny?: boolean } | undefined>;
  };
  clock: { every(ms: number, run: () => void): ClaudePluginTimer | undefined };
  process: { run(argv: readonly string[], options?: { timeoutMs?: number }): Promise<ClaudePluginProcessResult> };
  http: { fetch(url: string, request: ClaudePluginRequest): Promise<ClaudePluginResponse> };
  prompt: {
    read(): Promise<{ text?: string }>;
    fill(draft: { text: string; mode: 'replace' }): Promise<{ isFilled?: boolean } | undefined>;
  };
}

/**
 * A classic hook event: the shape the CLI's own `*.json` hooks receive, which carries the transcript path.
 *
 * `classic.*` is the one event this program reads a field of rather than passing through.
 */
export interface ClaudeClassicEvent {
  session_id?: string;
  transcript_path?: string;
}

/** `session.append`: a row the CLI is about to add to the transcript. */
export interface ClaudeAppendEvent {
  agentId?: string;
  door?: string;
  origin?: string;
}

/** What `session.append` answers once the CLI has written the row. */
export interface ClaudeAppendResult {
  uuid?: string;
  message?: unknown;
}

/** What `prompt.submit` answers: `drop` is the CLI's reason for refusing the draft. */
export interface ClaudePromptSubmitResult {
  drop?: string;
}

/** `turn.start` and `turn.complete`. `agentId` is set for a subagent's turn, absent for the session's. */
export interface ClaudeTurnEvent {
  agentId?: string;
  turnId?: string;
  reason?: string;
}

/** A hook handler: the CLI's middleware shape, which decides whether and when the rest runs. */
export type ClaudeHookHandler<TEvent, TResult> = (
  $: ClaudePluginApi,
  event: TEvent,
  next: (event: TEvent) => Promise<TResult>,
) => Promise<TResult>;

/**
 * The registrar a plugin's `register` is handed.
 *
 * The CLI accepts an event name, an optional filter, and the handler last — which is why this is an
 * overloaded call rather than one signature with an optional middle argument.
 */
export interface ClaudeHookRegistrar {
  (event: 'classic.*', handler: ClaudeHookHandler<ClaudeClassicEvent, unknown>): void;
  (event: 'session.append', handler: ClaudeHookHandler<ClaudeAppendEvent, ClaudeAppendResult>): void;
  (event: 'prompt.submit', handler: ClaudeHookHandler<unknown, ClaudePromptSubmitResult>): void;
  (event: 'session.start', handler: ClaudeHookHandler<unknown, unknown>): void;
  (event: 'ui.render', filter: { component: string }, handler: ClaudeHookHandler<unknown, unknown>): void;
  (event: 'turn.start' | 'turn.complete', handler: ClaudeHookHandler<ClaudeTurnEvent, unknown>): void;
}
