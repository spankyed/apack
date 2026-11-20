/**
 * Codex service — public entry point.
 *
 * Wraps the CodexAppServer (persistent `codex app-server` subprocess) and
 * exposes thread/turn lifecycle, approval responses, consumer registration,
 * and handle management to compiled actions via `services.codex`.
 */

import { CodexAppServer } from './app-server.ts'
import { storeHandle, getHandle, clearHandle, forgetAllTurns } from './handle-store.ts'
import * as codexSessions from './sessions.ts'
import type {
  ServerStatus,
  ThreadStartParams,
  ThreadReadParams,
  ThreadForkParams,
  ThreadRollbackParams,
  ThreadListParams,
  ConfigReadParams,
  ConfigValueWriteParams,
  TurnStartParams,
  ApprovalDecision,
  ConsumerHandlers,
  CodexTurnHandle,
  ListMcpServersParams,
} from './types.ts'

export type { ServerStatus, ThreadStartParams, ThreadReadParams, ThreadForkParams, ThreadRollbackParams, ThreadListParams, ConfigReadParams, ConfigValueWriteParams, TurnStartParams, ApprovalDecision, ConsumerHandlers, CodexTurnHandle }
export { storeHandle, getHandle, clearHandle }

const server = new CodexAppServer()

/**
 * Stops the app server and with it every turn running in it: for the pack's backend stopping. The server is a
 * process this module started and only this module holds, so code that replaces this module (a reload) would
 * otherwise leave it running with nobody to talk to it, and start another beside it.
 */
export function stopCodex(): void {
  forgetAllTurns()
  // Its exit is not waited for: whoever stops the pack does not wait, and the server ends on its input closing
  void server.stop().catch(() => { /* already gone */ })
}

export const codexService = {
  // Lifecycle
  start: () => server.start(),
  stop: () => server.stop(),
  get status(): ServerStatus { return server.status },

  // Thread management
  startThread: (params: ThreadStartParams) => server.startThread(params),
  resumeThread: (threadId: string, params?: Partial<ThreadStartParams>) => server.resumeThread(threadId, params),
  readThread: (threadId: string, params?: ThreadReadParams) => server.readThread(threadId, params),
  forkThread: (params: ThreadForkParams) => server.forkThread(params),
  rollbackThread: (params: ThreadRollbackParams) => server.rollbackThread(params),
  compactThread: (threadId: string) => server.compactThread(threadId),
  listThreads: (params?: ThreadListParams) => server.listThreads(params),
  setThreadName: (threadId: string, name: string) => server.setThreadName(threadId, name),

  // Metadata/config helpers
  readConfig: (params?: ConfigReadParams) => server.readConfig(params),
  writeConfigValue: (params: ConfigValueWriteParams) => server.writeConfigValue(params),
  listModels: (params?: { cursor?: string | null; limit?: number | null; includeHidden?: boolean }) => server.listModels(params),
  readAccount: (params?: { refreshToken: boolean }) => server.readAccount(params),
  listSkills: (params?: { cwds?: string[]; forceReload?: boolean }) => server.listSkills(params),
  listMcpServers: (params?: ListMcpServersParams) => server.listMcpServers(params),

  // Turn management
  startTurn: (params: TurnStartParams) => server.startTurn(params),
  interruptTurn: (threadId: string, turnId: string) => server.interruptTurn(threadId, turnId),

  // Approval response
  respondToApproval: (requestId: number, decision: ApprovalDecision) => server.respondToApproval(requestId, decision),

  // Consumer registration
  registerConsumer: (codexThreadId: string, handlers: ConsumerHandlers) => server.registerConsumer(codexThreadId, handlers),
  unregisterConsumer: (codexThreadId: string) => server.unregisterConsumer(codexThreadId),

  // Handle store
  storeHandle,
  getHandle,
  clearHandle,

  // Session listing (reads ~/.codex/sessions/ JSONL files)
  listAllSessions: codexSessions.listAll,
  viewSessionByFile: codexSessions.viewByFile,
}
