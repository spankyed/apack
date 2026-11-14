# AgentBuddy Actual App References

This manifest records the real-app screenshot evidence used for visual fidelity review. Local files are preferred when available; conversation screenshots are acceptable working evidence until copied into `packages/video/reference/actual-app`.

| Surface | Actual App Evidence | Target Local Captures | Review State |
| --- | --- | --- | --- |
| App chrome | `conversation:notes-tasklist-full-app` | `packages/video/reference/actual-app/app-chrome-notes-tasklist-full-app.png` | Working reference from user-provided app screenshot. Needs durable local capture before final completion. |
| Chat composer | `conversation:chat-composer-full-width`, `conversation:chat-composer-with-attachment` | `packages/video/reference/actual-app/chat-composer-full-width.png`, `packages/video/reference/actual-app/chat-composer-with-attachment.png` | Working reference from user-provided app screenshots. Needs durable local capture before final completion. |
| Notes task list | `conversation:notes-tasklist-panel` | `packages/video/reference/actual-app/notes-tasklist-panel.png` | Working reference from user-provided app screenshot. Needs durable local capture before final completion. |
| Notes editor and rail | `conversation:notes-tasklist-full-app` | `packages/video/reference/actual-app/notes-editor-rail-full-app.png` | Working reference from user-provided app screenshot. Needs durable local capture before final completion. |
| Threads header | `NEEDS_SCREENSHOT` | `packages/video/reference/actual-app/threads-header-board.png` | Missing durable actual-app screenshot for board header. |
| Threads kanban | `NEEDS_SCREENSHOT` | `packages/video/reference/actual-app/threads-kanban-board.png` | Missing durable actual-app screenshot for kanban board/cards. |
| Thread messages and tools | `NEEDS_SCREENSHOT` | `packages/video/reference/actual-app/thread-messages-tools.png`, `packages/video/reference/actual-app/thread-artifact-plan.png` | Missing durable actual-app screenshot for message/tool/artifact variants. |
| Actions plugin | `NEEDS_SCREENSHOT` | `packages/video/reference/actual-app/actions-plugin-list-detail.png` | Missing durable actual-app screenshot for actions list/detail/editor states. |
| Prompts plugin | `NEEDS_SCREENSHOT` | `packages/video/reference/actual-app/prompts-plugin-list-detail.png` | Missing durable actual-app screenshot for prompts list/detail/editor states. |
| Database plugin | `NEEDS_SCREENSHOT` | `packages/video/reference/actual-app/database-plugin-query-results.png`, `packages/video/reference/actual-app/database-plugin-backup-trace.png` | Missing durable actual-app screenshots for query/results, schema, backup, and trace states. |
| Database graph | `NEEDS_SCREENSHOT` | `packages/video/reference/actual-app/database-plugin-graph.png` | Missing durable actual-app screenshot for database graph explorer state. |
| Logs plugin | `NEEDS_SCREENSHOT` | `packages/video/reference/actual-app/logs-plugin-list-filtered.png` | Missing durable actual-app screenshot for logs list/filter/context states. |
| Browser plugin | `NEEDS_SCREENSHOT` | `packages/video/reference/actual-app/browser-plugin-tabs-navbar.png` | Missing durable actual-app screenshot for Browser tab strip, nav bar, autocomplete, and content slot. |
| Library plugin | `NEEDS_SCREENSHOT` | `packages/video/reference/actual-app/library-plugin-browser-editor.png` | Missing durable actual-app screenshot for library browser/editor states. |
| Settings plugin | `NEEDS_SCREENSHOT` | `packages/video/reference/actual-app/settings-plugin-general-plugins-help.png` | Missing durable actual-app screenshot for settings general/plugins/help states. |
| Brain plugin | `NEEDS_SCREENSHOT` | `packages/video/reference/actual-app/brain-plugin-graph-details.png` | Missing durable actual-app screenshot for brain graph/details/event states. |
| Code source control and PR | `conversation:source-control-panel`, `conversation:pr-files-view`, `conversation:pr-create-view`, `conversation:pr-details-view` | `packages/video/reference/actual-app/code-source-control-panel.png`, `packages/video/reference/actual-app/code-pr-files-view.png`, `packages/video/reference/actual-app/code-pr-create-view.png`, `packages/video/reference/actual-app/code-pr-details-view.png` | Working reference from user-provided app screenshots. Needs durable local capture before final completion. |
| Flow canvas | `conversation:flow-blueprint-canvas` | `packages/video/reference/actual-app/flow-blueprint-canvas.png` | Working reference from user-provided app screenshot. Needs durable local capture before final completion. |
| Final lockup | `NO_RENDERER_EQUIVALENT` | `NO_RENDERER_EQUIVALENT` | Film-only lockup; no app screenshot required. |

Rules:

- Every surface in `VISUAL_REVIEW.md` must appear here.
- Replace `conversation:*` entries with local files under `packages/video/reference/actual-app` when durable captures exist.
- Use the `Target Local Captures` filenames when replacing working `conversation:*` or `NEEDS_SCREENSHOT` markers.
- `NEEDS_SCREENSHOT` is allowed as explicit debt, but any remaining row with that value means final visual fidelity is not fully proven.
