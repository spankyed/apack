# AgentBuddy UI Component Demo Outputs

Each reusable surface demo must have a current render artifact. These renders are review evidence, not publishable launch-film deliverables.

| Composition | Output |
| --- | --- |
| `ToolbarDemo` | `packages/video/out/component-demos/toolbar-demo.mp4` |
| `ChatComposerDemo` | `packages/video/out/component-demos/chat-composer-demo.mp4` |
| `ChatComposerWithAttachmentDemo` | `packages/video/out/component-demos/chat-composer-with-attachment-demo.mp4` |
| `ChatComposerModeMenuDemo` | `packages/video/out/component-demos/chat-composer-mode-menu-demo.mp4` |
| `ChatComposerPhaseMenuDemo` | `packages/video/out/component-demos/chat-composer-phase-menu-demo.mp4` |
| `TaskListPanelDemo` | `packages/video/out/component-demos/task-list-panel-demo.mp4` |
| `TaskListPanelMenuDemo` | `packages/video/out/component-demos/task-list-panel-menu-demo.mp4` |
| `TaskListPanelRowMenuDemo` | `packages/video/out/component-demos/task-list-panel-row-menu-demo.mp4` |
| `NotesRightRailDemo` | `packages/video/out/component-demos/notes-right-rail-demo.mp4` |
| `NotesRightRailSearchDemo` | `packages/video/out/component-demos/notes-right-rail-search-demo.mp4` |
| `NotesRightRailMenuDemo` | `packages/video/out/component-demos/notes-right-rail-menu-demo.mp4` |
| `NotesRightRailTrashDemo` | `packages/video/out/component-demos/notes-right-rail-trash-demo.mp4` |
| `NotesRightRailTrashActionsDemo` | `packages/video/out/component-demos/notes-right-rail-trash-actions-demo.mp4` |
| `ThreadsHeaderDemo` | `packages/video/out/component-demos/threads-header-demo.mp4` |
| `ThreadsHeaderSearchDemo` | `packages/video/out/component-demos/threads-header-search-demo.mp4` |
| `ThreadsHeaderFilterDemo` | `packages/video/out/component-demos/threads-header-filter-demo.mp4` |
| `ThreadsHeaderArchiveDemo` | `packages/video/out/component-demos/threads-header-archive-demo.mp4` |
| `KanbanComponentsDemo` | `packages/video/out/component-demos/kanban-components-demo.mp4` |
| `CodeReviewDemo` | `packages/video/out/component-demos/code-review-demo.mp4` |
| `SourceControlPanelDemo` | `packages/video/out/component-demos/source-control-panel-demo.mp4` |
| `ToolActivityDemo` | `packages/video/out/component-demos/tool-activity-demo.mp4` |
| `InteractionBlocksDemo` | `packages/video/out/component-demos/interaction-blocks-demo.mp4` |
| `ToolInputBlocksDemo` | `packages/video/out/component-demos/tool-input-blocks-demo.mp4` |
| `InteractionControlsDemo` | `packages/video/out/component-demos/interaction-controls-demo.mp4` |
| `ContentBlocksDemo` | `packages/video/out/component-demos/content-blocks-demo.mp4` |
| `MessageBubbleDemo` | `packages/video/out/component-demos/message-bubble-demo.mp4` |
| `PlanArtifactDemo` | `packages/video/out/component-demos/plan-artifact-demo.mp4` |
| `PullRequestPanelDemo` | `packages/video/out/component-demos/pull-request-panel-demo.mp4` |
| `PullRequestFilesDemo` | `packages/video/out/component-demos/pull-request-files-demo.mp4` |
| `PullRequestCreateDemo` | `packages/video/out/component-demos/pull-request-create-demo.mp4` |
| `PullRequestDetailsDemo` | `packages/video/out/component-demos/pull-request-details-demo.mp4` |
| `TerminalPanelDemo` | `packages/video/out/component-demos/terminal-panel-demo.mp4` |
| `FlowPaletteDemo` | `packages/video/out/component-demos/flow-palette-demo.mp4` |
| `FlowNodeVariantsDemo` | `packages/video/out/component-demos/flow-node-variants-demo.mp4` |
| `FlowCanvasDemo` | `packages/video/out/component-demos/flow-canvas-demo.mp4` |
| `FlowNodeFormDemo` | `packages/video/out/component-demos/flow-node-form-demo.mp4` |
| `BoardSurfaceDemo` | `packages/video/out/component-demos/board-surface-demo.mp4` |
| `CodeSurfaceDemo` | `packages/video/out/component-demos/code-surface-demo.mp4` |
| `NotesSurfaceDemo` | `packages/video/out/component-demos/notes-surface-demo.mp4` |
| `ChatSurfaceDemo` | `packages/video/out/component-demos/chat-surface-demo.mp4` |
| `WorkflowSurfaceDemo` | `packages/video/out/component-demos/workflow-surface-demo.mp4` |

Rules:

- Add every reusable-surface demo composition here.
- Keep every composition registered in `packages/video/src/Root.tsx`.
- Keep output paths under `packages/video/out/component-demos`.
- Regenerate all rows with `npm run render:demos --workspace @app/video`.
