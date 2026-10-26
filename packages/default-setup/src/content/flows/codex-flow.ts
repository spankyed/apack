import type { FlowDSL } from '@apackdev/sdk/build';
import { entry, on, keepAlive, action, branch } from '#generated/flow-helpers.ts';

/**
 * Codex mode flow.
 *
 * Spawns the app-server on flow entry, then listens for user messages
 * in codex mode, interactive responses (directory select + approvals),
 * stream lifecycle events, and user controls (pause/unqueue).
 */
export default {
  "Codex": [
    entry(
      [action("CDX: Reconcile State", { label: "reconcile" }), action("CDX: Start Server", { label: "start-server" })],
      [keepAlive()],
    ),
    on(
      "user.message",
      [[
        branch([
          {
            if: "$.event.data.payload.mode == 'Codex'",
            steps: [
              action("Codex Chat", {
                label: "codex-chat",
                map: {
                  threadId: "$.event.data.payload.threadId",
                  text: "$.event.data.payload.text",
                  mode: "$.event.data.payload.mode",
                  phase: "$.event.data.payload.phase",
                  model: "$.event.data.payload.model",
                  messageId: "$.event.data.payload.messageId",
                  references: "$.event.data.payload.references",
                  cwdOverride: "$.event.data.payload.cwdOverride",
                  forceDirectoryPicker: "$.event.data.payload.forceDirectoryPicker",
                },
              }),
            ],
          },
        ]),
      ]],
      "Codex mode → Codex Chat",
    ),
    // ─── Interactive responses (directory select + approvals) ──────────
    on(
      "interactive.message.response",
      [[
        action("CDX: Route Response", {
          label: "route-response",
          map: {
            messageId: "$.event.data.payload.messageId",
            threadId: "$.event.data.payload.threadId",
            response: "$.event.data.payload.response",
          },
        }),
        branch([
          {
            if: "$.lastStep.result.directorySelect == true",
            steps: [
              action("CDX: Handle Directory Select", {
                label: "directory-select",
                map: {
                  threadId: "$.steps[label=route-response].result.threadId",
                  response: "$.steps[label=route-response].result.response",
                  pendingDirectorySelect: "$.steps[label=route-response].result.pendingDirectorySelect",
                },
              }),
            ],
          },
          {
            if: "$.lastStep.result.planFeedback == true",
            steps: [
              action("CDX: Refine Plan", {
                label: "refine-plan",
                map: {
                  threadId: "$.steps[label=route-response].result.threadId",
                  feedbackText: "$.steps[label=route-response].result.feedbackText",
                },
              }),
            ],
          },
          {
            if: "$.lastStep.result.denied == true",
            steps: [
              action("CDX: Deny Tool", {
                label: "deny-tool",
                map: {
                  threadId: "$.steps[label=route-response].result.threadId",
                },
              }),
            ],
          },
          {
            if: "$.lastStep.result.approval == true",
            steps: [
              action("CDX: Approve Tool", {
                label: "approve-tool",
                map: {
                  threadId: "$.steps[label=route-response].result.threadId",
                  requestId: "$.steps[label=route-response].result.requestId",
                  decision: "$.steps[label=route-response].result.decision",
                  response: "$.steps[label=route-response].result.response",
                },
              }),
            ],
          },
        ], undefined, "Response router"),
      ]],
      "Interactive response",
    ),
    // ─── Stream lifecycle ────────────────────────────────────────────
    on(
      "cdx.stream.paused",
      [[
        action("CDX: Stream Paused", {
          label: "stream-paused",
          map: {
            threadId: "$.event.data.payload.threadId",
          },
        }),
      ]],
      "Approval requested",
    ),
    on(
      "cdx.stream.completed",
      [[
        action("CDX: Turn Completed", {
          label: "turn-done",
          map: {
            threadId: "$.event.data.payload.threadId",
            usage: "$.event.data.payload.usage",
            toolCallCount: "$.event.data.payload.toolCallCount",
            recentTools: "$.event.data.payload.recentTools",
            mutatedPaths: "$.event.data.payload.mutatedPaths",
            hadErrors: "$.event.data.payload.hadErrors",
          },
        }),
        branch([
          {
            if: "$.lastStep.result.shouldContinueGoal == true",
            steps: [
              action("CDX: Goal Continue", {
                label: "goal-continue",
                map: {
                  threadId: "$.event.data.payload.threadId",
                },
              }),
            ],
          },
        ], undefined, "Goal Gate"),
      ]],
      "Turn completed",
    ),
    // ─── User controls ──────────────────────────────────────────────
    on(
      "user.thread.pause",
      [[
        action("CDX: Pause Turn", {
          label: "pause",
          map: {
            threadId: "$.event.data.payload.threadId",
          },
        }),
      ]],
      "Pause turn",
    ),
    on(
      "user.thread.unqueue",
      [[
        action("CDX: Unqueue Message", {
          label: "unqueue",
          map: {
            threadId: "$.event.data.payload.threadId",
            messageId: "$.event.data.payload.messageId",
          },
        }),
      ]],
      "Unqueue message",
    ),
    // ─── User setting toggles ───────────────────────────────────────
    on(
      "user.update.codexSessionSettings",
      [[
        action("CDX: Update Session Settings", {
          label: "update-session-settings",
          map: {
            threadId: "$.event.data.payload.threadId",
            approvalMode: "$.event.data.payload.approvalMode",
            sandbox: "$.event.data.payload.sandbox",
            networkAccess: "$.event.data.payload.networkAccess",
            webSearch: "$.event.data.payload.webSearch",
          },
        }),
      ]],
      "Codex session settings updated",
    ),
    on(
      "thread.revert",
      [[
        // Only handle reverts that affected Codex messages.
        branch([
          {
            if: "$.event.data.payload.agents.codex == true",
            steps: [
              action("CDX: Pause Turn", {
                label: "pause-before-revert",
                map: {
                  threadId: "$.event.data.payload.threadId",
                },
              }),
              branch([
                {
                  if: "$.event.data.payload.kind == 'revert'",
                  steps: [
                    action("CDX: Handle Revert", {
                      label: "revert",
                      map: {
                        threadId: "$.event.data.payload.threadId",
                        messageId: "$.event.data.payload.messageId",
                        deletedUserMessageCount: "$.event.data.payload.codexDeletedUserMessageCount",
                      },
                    }),
                  ],
                },
                {
                  if: "$.event.data.payload.kind == 'summarize'",
                  steps: [
                    action("CDX: Handle Summarize", {
                      label: "summarize",
                      map: {
                        threadId: "$.event.data.payload.threadId",
                        messageId: "$.event.data.payload.messageId",
                        deletedUserMessageCount: "$.event.data.payload.codexDeletedUserMessageCount",
                      },
                    }),
                  ],
                },
                {
                  if: "$.event.data.payload.kind == 'rewind'",
                  steps: [
                    action("CDX: Handle Rewind Unsupported", {
                      label: "rewind-unsupported",
                      map: {
                        threadId: "$.event.data.payload.threadId",
                        messageId: "$.event.data.payload.messageId",
                        deletedUserMessageCount: "$.event.data.payload.codexDeletedUserMessageCount",
                      },
                    }),
                  ],
                },
              ], undefined, "Route Revert Kind"),
            ],
          },
        ], undefined, "Gate CDX Revert"),
      ]],
      "Thread reverted",
    ),
    on(
      "thread.fork",
      [[
        action("CDX: Handle Fork", {
          label: "fork",
          map: {
            sourceThreadId: "$.event.data.payload.sourceThreadId",
            sourceMessageId: "$.event.data.payload.sourceMessageId",
            newThreadId: "$.event.data.payload.newThreadId",
            sourceUserMessagesAfterFork: "$.event.data.payload.sourceUserMessagesAfterFork",
          },
        }),
      ]],
      "Thread forked",
    ),
    // ─── DB query generation ──────────────────────────────────────────
    on(
      "db.query",
      [[
        branch([
          {
            if: "$.event.data.payload.provider == 'Codex'",
            steps: [
              branch([
                {
                  if: "$.event.data.payload.mode == 'transaction'",
                  steps: [
                    action("CDX: DB Transaction", {
                      label: "db-transaction",
                      map: { prompt: "$.event.data.payload.prompt", client: "$.event.data.payload.client" },
                    }),
                  ],
                },
              ], [
                action("CDX: DB Query", {
                  label: "db-query",
                  map: { prompt: "$.event.data.payload.prompt", client: "$.event.data.payload.client" },
                }),
              ], "DB Mode Router"),
            ],
          },
        ], undefined, "CDX Provider Gate"),
      ]],
      "DB query generation",
    ),
    // ─── Commit message generation ────────────────────────────────────
    on(
      "commit.generate",
      [[
        branch([
          {
            if: "$.event.data.payload.provider == 'Codex'",
            steps: [
              action("CDX: Commit Message", {
                label: "commit-message",
                map: {
                  diff: "$.event.data.payload.diff",
                  branch: "$.event.data.payload.branch",
                  repoName: "$.event.data.payload.repoName",
                  client: "$.event.data.payload.client",
                },
              }),
            ],
          },
        ], undefined, "CDX Commit Gate"),
      ]],
      "Commit message generation",
    ),
    // ─── CDX commands ─────────────────────────────────────────────────
    on(
      "user.command",
      [[
        branch([
          {
            if: "$.event.data.payload.command starts_with 'cdx-'",
            steps: [
              branch([
                { if: "$.event.data.payload.command == 'cdx-sessions'", steps: [action("CDX: Session Ops", { label: "cdx-sessions", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references", cwdOverride: "$.event.data.payload.cwdOverride" } })] },
                { if: "$.event.data.payload.command == 'cdx-resume'", steps: [action("CDX: Session Ops", { label: "cdx-resume", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references", cwdOverride: "$.event.data.payload.cwdOverride" } })] },
                { if: "$.event.data.payload.command == 'cdx-compact'", steps: [action("CDX: Compact", { label: "cdx-compact", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references" } })] },
                { if: "$.event.data.payload.command == 'cdx-fork'", steps: [action("CDX: Fork", { label: "cdx-fork", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references" } })] },
              ], [
                action("CDX: Run Command", { label: "cdx-command", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references" } }),
              ], "CDX Command Router"),
            ],
          },
        ], undefined, "CDX Command Gate"),
      ]],
      "CDX command",
    ),
  ],
} satisfies FlowDSL;
