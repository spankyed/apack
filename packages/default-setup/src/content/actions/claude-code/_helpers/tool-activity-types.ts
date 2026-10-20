/**
 * Local mirror of the `tool-activity` block types so helper files in this
 * directory can typecheck independently.
 *
 * Kept in sync with the threads feature types. If the
 * canonical shape changes, mirror it here too.
 */

export interface ToolActivityEntry {
  /** Stable id. Usually the CLI's `tool_use_id`. */
  id: string;
  /** Tool name as reported by the CLI: Read, Write, Edit, Glob, Grep, Bash, … */
  tool: string;
  /** One-line human summary of the input. */
  summary: string;
  /** Row status drives the per-row icon and label. */
  status: 'running' | 'ok' | 'denied' | 'error';
  /** Wall-clock duration once the tool has reported progress/completion. */
  durationMs?: number;
  /** One-line output summary if the tool reported one. */
  outputSummary?: string;
  /** Optional full details revealed when the row is expanded. */
  handback?: import('#features/code/common/native-handback.ts').ClaudeAgentHandback;
  details?: { input?: unknown; output?: string; error?: string };
}

export interface ToolActivityBlockProps {
  entries: ToolActivityEntry[];
  label: string;
  state: 'streaming' | 'done' | 'error';
  defaultOpen?: boolean;
  /**
   * Optional pointer to a thread artifact promoted from this turn's tool
   * activity (Phase C: diff artifact). The renderer shows a small
   * "→ View changes" link beneath the collapsed header when set.
   */
  artifactRef?: { artifactId: string; label: string };
  /** Current phase — drives the streaming label ("Planning…" vs "Working…"). */
  phase?: string;
}
