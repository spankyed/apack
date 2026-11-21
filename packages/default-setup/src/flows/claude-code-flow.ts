import type { FlowDSL } from '../types';
import { entry, on, keepAlive, action, branch } from './_patterns';

/**
 * Claude Code mode flow.
 *
 * Listens for `user.message` events and routes to the Claude Code Chat
 * action only when the user is in `Claude Code` mode. Any other mode (`chat`,
 * `note`, `Birth`, …) flows past this track untouched — the switch node
 * emits a `noMatch` completion and the chain ends without firing any
 * action. See `packages/api/src/systems/brain/node-handlers/switch-node.ts`
 * for the runtime semantics of "no condition matched, no else".
 *
 * The `phase` sub-value (`Plan` / `Edit` / `review`) is passed through so
 * the chat action can prefix a phase-aware system prompt hint.
 */
export default {
  "Claude Code": [
    entry(
      [action("CC: Reconcile State", { label: "reconcile" })],
      [keepAlive()],
    ),
    on(
      "user.message",
      [[
        branch([
          {
            if: "$.event.data.payload.mode == 'Claude Code'",
            steps: [
              action("Claude Code Chat", {
                label: "claude-code",
                map: {
                  threadId: "$.event.data.payload.threadId",
                  text: "$.event.data.payload.text",
                  mode: "$.event.data.payload.mode",
                  phase: "$.event.data.payload.phase",
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
      "Claude Code mode → Claude Code",
    ),
    // Route interactive block responses (approval, choice, question) back
    // to the CLI. The router classifies the response, then the switch
    // branches to the appropriate handler.
    on(
      "interactive.message.response",
      [[
        action("CC: Route Response", {
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
              action("CC: Handle Directory Select", {
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
            if: "$.lastStep.result.clearContext == true",
            steps: [
              action("CC: Approve Plan Clear Context", {
                label: "clear-context",
                map: {
                  threadId: "$.steps[label=route-response].result.threadId",
                  response: "$.steps[label=route-response].result.response",
                },
              }),
            ],
          },
          {
            if: "$.lastStep.result.denied == true",
            steps: [
              action("CC: Deny Tool", {
                label: "deny-tool",
                map: {
                  threadId: "$.steps[label=route-response].result.threadId",
                },
              }),
            ],
          },
          {
            if: "$.lastStep.result.toolName == 'AskUserQuestion'",
            steps: [
              action("CC: Answer Question", {
                label: "answer-question",
                map: {
                  threadId: "$.steps[label=route-response].result.threadId",
                  requestId: "$.steps[label=route-response].result.requestId",
                  originalInput: "$.steps[label=route-response].result.originalInput",
                  response: "$.steps[label=route-response].result.response",
                },
              }),
            ],
          },
        ], [
          // else: tool approval (Write, Edit, Bash, ExitPlanMode, etc.)
          action("CC: Approve Tool", {
            label: "approve-tool",
            map: {
              threadId: "$.steps[label=route-response].result.threadId",
              requestId: "$.steps[label=route-response].result.requestId",
              toolName: "$.steps[label=route-response].result.toolName",
              originalInput: "$.steps[label=route-response].result.originalInput",
              response: "$.steps[label=route-response].result.response",
            },
          }),
        ]),
      ]],
      "Permission response",
    ),
    // ─── Stream lifecycle ────────────────────────────────────────────
    // The stream consumer emits cc.stream.* brain events at lifecycle
    // boundaries. These listeners do real work: session artifact updates,
    // diff artifact creation, and queued message drain.
    on(
      "cc.stream.started",
      [[
        action("CC: Stream Started", {
          label: "streaming",
          map: {
            threadId: "$.event.data.payload.threadId",
            sessionId: "$.event.data.payload.sessionId",
            model: "$.event.data.payload.model",
            cwd: "$.event.data.payload.cwd",
          },
        }),
      ]],
      "Stream started",
    ),
    on(
      "cc.stream.paused",
      [[
        action("CC: Stream Paused", {
          label: "awaiting-input",
          map: {
            threadId: "$.event.data.payload.threadId",
            toolName: "$.event.data.payload.toolName",
          },
        }),
      ]],
      "Awaiting user input",
    ),
    on(
      "cc.stream.completed",
      [[
        action("CC: Turn Completed", {
          label: "turn-done",
          map: {
            threadId: "$.event.data.payload.threadId",
            sessionId: "$.event.data.payload.sessionId",
            costUsd: "$.event.data.payload.costUsd",
            durationMs: "$.event.data.payload.durationMs",
            toolCallCount: "$.event.data.payload.toolCallCount",
            mutatedFileCount: "$.event.data.payload.mutatedFileCount",
            mutatedPaths: "$.event.data.payload.mutatedPaths",
            hadErrors: "$.event.data.payload.hadErrors",
            error: "$.event.data.payload.error",
            userText: "$.event.data.payload.userText",
            contextUsage: "$.event.data.payload.contextUsage",
          },
        }),
      ]],
      "Turn completed",
    ),
    // ─── User-initiated pause ─────────────────────────────────────────
    on(
      "user.thread.pause",
      [[
        action("CC: Pause Turn", {
          label: "pause-turn",
          map: {
            threadId: "$.event.data.payload.threadId",
          },
        }),
      ]],
      "Turn paused by user",
    ),
    // ─── User-initiated unqueue ──────────────────────────────────────
    on(
      "user.thread.unqueue",
      [[
        action("CC: Unqueue Message", {
          label: "unqueue-message",
          map: {
            threadId: "$.event.data.payload.threadId",
            messageId: "$.event.data.payload.messageId",
          },
        }),
      ]],
      "Queued message cancelled by user",
    ),
    // ─── User setting toggles ───────────────────────────────────────
    on(
      "user.update.permissionMode",
      [[
        action("CC: Update Permission Mode", {
          label: "update-permission-mode",
          map: {
            threadId: "$.event.data.payload.threadId",
            mode: "$.event.data.payload.mode",
          },
        }),
      ]],
      "Permission mode updated",
    ),
    on(
      "user.update.worktree",
      [[
        action("CC: Update Worktree", {
          label: "update-worktree",
          map: {
            threadId: "$.event.data.payload.threadId",
            useWorktree: "$.event.data.payload.useWorktree",
          },
        }),
      ]],
      "Worktree toggle updated",
    ),
    on(
      "user.goal.clear",
      [[
        action("CC: Goal", {
          label: "goal-clear",
          map: {
            command: "cc-goal",
            text: "clear",
            threadId: "$.event.data.payload.threadId",
          },
        }),
      ]],
      "Goal cleared",
    ),
    // ─── Thread lifecycle ────────────────────────────────────────────
    // Clean up Claude Code state when threads are reverted or forked.
    // Unified revert-family route — the `kind` discriminator routes to
    // the plain revert, the --rewind-files variant, or the /compact
    // summarize variant.
    on(
      "thread.revert",
      [[
        // Only handle reverts that affected Claude Code messages.
        branch([
          {
            if: "$.event.data.payload.agents.claudeCode == true",
            steps: [
              // Stop the active turn first so the stream consumer exits cleanly
              // before any revert/rewind/summarize handler mutates session state.
              // Sequential within this track — pause completes before the branch.
              action("CC: Pause Turn", {
                label: "pause-before-revert",
                map: {
                  threadId: "$.event.data.payload.threadId",
                },
              }),
              branch([
                {
                  if: "$.event.data.payload.kind == 'revert'",
                  steps: [
                    action("CC: Handle Revert", {
                      label: "revert",
                      map: {
                        threadId: "$.event.data.payload.threadId",
                        messageId: "$.event.data.payload.messageId",
                      },
                    }),
                  ],
                },
                {
                  if: "$.event.data.payload.kind == 'rewind'",
                  steps: [
                    action("CC: Handle Rewind", {
                      label: "rewind",
                      map: {
                        threadId: "$.event.data.payload.threadId",
                        messageId: "$.event.data.payload.messageId",
                        userCliUuid: "$.event.data.payload.userCliUuid",
                      },
                    }),
                  ],
                },
                {
                  if: "$.event.data.payload.kind == 'summarize'",
                  steps: [
                    action("CC: Handle Summarize", {
                      label: "summarize",
                      map: {
                        threadId: "$.event.data.payload.threadId",
                        messageId: "$.event.data.payload.messageId",
                      },
                    }),
                  ],
                },
              ], undefined, "Route Revert Kind"),
            ],
          },
        ], undefined, "Gate CC Revert"),
      ]],
      "Thread reverted",
    ),
    // ─── CC commands ─────────────────────────────────────────────────
    // Route cc-* commands to the appropriate action by command name.
    // Session-heavy and thread-mutating commands have dedicated actions;
    // everything else falls through to the generic dispatcher.
    on(
      "user.command",
      [[
        // Gate: only process cc-* prefixed commands in this flow
        branch([
          {
            if: "$.event.data.payload.command starts_with 'cc-'",
            steps: [
              branch([
                // Session operations (resume, import) — share transcript import helpers
                { if: "$.event.data.payload.command == 'cc-resume'", steps: [action("CC: Session Ops", { label: "cc-resume", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references", cwdOverride: "$.event.data.payload.cwdOverride" } })] },
                { if: "$.event.data.payload.command == 'cc-import'", steps: [action("CC: Session Ops", { label: "cc-import", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references" } })] },
                // Standalone commands
                { if: "$.event.data.payload.command == 'cc-compact'", steps: [action("CC: Compact", { label: "cc-compact", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references" } })] },
                { if: "$.event.data.payload.command == 'cc-fork'", steps: [action("CC: Fork", { label: "cc-fork", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references" } })] },
                { if: "$.event.data.payload.command == 'cc-context'", steps: [action("CC: Context", { label: "cc-context", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references" } })] },
                { if: "$.event.data.payload.command == 'cc-recap'", steps: [action("CC: Recap", { label: "cc-recap", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId" } })] },
                { if: "$.event.data.payload.command == 'cc-goal'", steps: [action("CC: Goal", { label: "cc-goal", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references" } })] },
                // Directory operations (add-dir, set-dir) — share path helpers
                { if: "$.event.data.payload.command == 'cc-add-dir'", steps: [action("CC: Dir Ops", { label: "cc-add-dir", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references" } })] },
                { if: "$.event.data.payload.command == 'cc-set-dir'", steps: [action("CC: Dir Ops", { label: "cc-set-dir", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references" } })] },
              ], [
                // Else: info/config commands + passthrough (sessions, config, model, etc.)
                action("CC: Run Command", { label: "cc-command", map: { command: "$.event.data.payload.command", text: "$.event.data.payload.text", threadId: "$.event.data.payload.threadId", references: "$.event.data.payload.references" } }),
              ], "CC Command Router"),
            ],
          },
        ], undefined, "CC Command Gate"),
      ]],
      "CC command",
    ),
    // ─── DB query generation ──────────────────────────────────────────
    // The database system forwards GENERATE_AI_QUERY as a db.query brain
    // event. Gated on provider, then routes by mode.
    on(
      "db.query",
      [[
        branch([
          {
            if: "$.event.data.payload.provider == 'Claude Code'",
            steps: [
              branch([
                {
                  if: "$.event.data.payload.mode == 'transaction'",
                  steps: [
                    action("CC: DB Transaction", {
                      label: "db-transaction",
                      map: { prompt: "$.event.data.payload.prompt" },
                    }),
                  ],
                },
              ], [
                action("CC: DB Query", {
                  label: "db-query",
                  map: { prompt: "$.event.data.payload.prompt" },
                }),
              ], "DB Mode Router"),
            ],
          },
        ], undefined, "CC Provider Gate"),
      ]],
      "DB query generation",
    ),
    // ─── Commit message generation ────────────────────────────────────
    on(
      "commit.generate",
      [[
        branch([
          {
            if: "$.event.data.payload.provider == 'Claude Code'",
            steps: [
              action("CC: Commit Message", {
                label: "commit-message",
                map: {
                  diff: "$.event.data.payload.diff",
                  branch: "$.event.data.payload.branch",
                  repoName: "$.event.data.payload.repoName",
                },
              }),
            ],
          },
        ], undefined, "CC Commit Gate"),
      ]],
      "Commit message generation",
    ),
    on(
      "thread.fork",
      [[
        action("CC: Handle Fork", {
          label: "fork",
          map: {
            sourceThreadId: "$.event.data.payload.sourceThreadId",
            sourceMessageId: "$.event.data.payload.sourceMessageId",
            newThreadId: "$.event.data.payload.newThreadId",
          },
        }),
      ]],
      "Thread forked",
    ),
    // ─── Kanban → start work ────────────────────────────────────────────
    // When a user drags a thread to "In Progress", kick off a Claude Code
    // turn using the thread's instructions. The `userInduced` guard prevents
    // system-initiated status syncs from re-triggering.
    on(
      "thread.status.changed",
      [[
        branch([
          {
            if: "$.event.data.payload.userInduced == true",
            steps: [
              branch([
                {
                  if: "$.event.data.payload.status == 'In Progress'",
                  steps: [
                    action("CC: Start From Status", {
                      label: "start-from-status",
                      map: {
                        threadId: "$.event.data.payload.threadId",
                      },
                    }),
                  ],
                },
              ], undefined, "Status Gate"),
            ],
          },
        ], undefined, "User Induced Gate"),
      ]],
      "Kanban → start work",
    ),
  ],
} satisfies FlowDSL;
