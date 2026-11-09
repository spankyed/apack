/**
 * Throttled writer for the `tool-activity` block on a streaming chat message.
 *
 * Claude Code can emit 20+ tool_use / tool_progress events in a few seconds, and a write replaces the whole
 * `blocks` field, so every one of them would re-send every entry gathered so far. A tool appearing is written
 * straight away, because that is what the user is waiting to see; a patch to an entry already on screen waits
 * for the row interval (see `row-interval.ts`).
 *
 * The writer owns the canonical copy of the block's `entries` array and
 * `state`. Call `append`, `update`, and `finalise`; the writer recomputes
 * the collapsed label on each change and pushes the whole block object
 * via `services.chat.updateMessageState(messageId, { blocks: [ourBlock] })`.
 *
 * Ownership model: the streaming assistant message only ever has ONE
 * entry in its `blocks` array — this writer's tool-activity block. The
 * `onPermissionRequest` flow in chat.ts creates approval blocks as
 * separate sibling messages (`sendApprovalBlock` → `sendBlockMessage`),
 * not into the streaming message's block array, so the writer can safely
 * emit `{ blocks: [ourBlock] }` wholesale without clobbering anything.
 *
 * Coexistence with `StreamWriter`: they touch different fields of the
 * same message (`text` vs `blocks`). Both call `updateMessageState` with
 * only the field they own; the backend's update merges by key so they
 * don't clobber each other.
 *
 * One compromise flagged in the design doc: `MessageEntity` stores `text`
 * and `blocks` as separate fields and `message.vue` renders the Tiptap text
 * first, then `<InteractionContainer>` below. So the activity block visually
 * lands below the prose of the turn, not interleaved between "prose-before"
 * and "prose-after" the tool calls. True inline interleaving would require a
 * new message schema; the "work log below prose" layout is acceptable for
 * Phase A.
 */

import type { Services, EntityId } from '#generated/services.ts';
import { computeLabel } from './tool-activity-label.ts';
import type { ToolActivityEntry, ToolActivityBlockProps } from './tool-activity-types.ts';
import { ROW_INTERVAL_MS } from './row-interval.ts';

export interface ToolActivityWriterOptions {
  /** Minimum ms between row writes for a patch to an entry already shown. Default {@link ROW_INTERVAL_MS}. */
  rowIntervalMs?: number;
  /** Current phase — drives the streaming label ("Planning…" vs "Working…"). */
  phase?: string;
  /** Optional getter for the thinking block — included in every `blocks` write so both blocks coexist. */
  getThinkingBlock?: () => { type: string; props: any } | null;
}

export interface ToolActivityWriter {
  /** Add a new tool entry. Triggers a throttled write. */
  append(entry: ToolActivityEntry): void;
  /** Patch an existing entry (by id). Triggers a throttled write. */
  update(id: string, patch: Partial<ToolActivityEntry>): void;
  /** Flush any pending write immediately (e.g. before a permission prompt). */
  flush(): void;
  /** Freeze the block to its final state. Writes immediately. */
  finalise(state: 'done' | 'error'): void;
  /**
   * Attach an artifact reference to the block (Phase C: diff artifact).
   * Writes immediately so the renderer shows the "View changes" link.
   * Safe to call after `finalise` — it overwrites the previous block with
   * the same entries+state plus the new `artifactRef` field.
   */
  setArtifactRef(ref: { artifactId: string; label: string }): void;
  /** Current entries (read-only snapshot). */
  readonly entries: ReadonlyArray<ToolActivityEntry>;
  /** Whether the writer has produced any entries yet. */
  readonly hasEntries: boolean;
  /** Epoch ms when the writer was created, for duration aggregates. */
  readonly startedAt: number;
}

export function createToolActivityWriter(
  services: Services,
  messageId: EntityId,
  opts: ToolActivityWriterOptions = {},
): ToolActivityWriter {
  const rowIntervalMs = opts.rowIntervalMs ?? ROW_INTERVAL_MS;
  const entries: ToolActivityEntry[] = [];
  const startedAt = Date.now();

  let state: 'streaming' | 'done' | 'error' = 'streaming';
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = 0;
  /** Once true, we've pushed at least one block — finalise(0-entries) should clear. */
  let hasWrittenOnce = false;
  /** What the last write put in the row, so an identical one can be skipped. */
  let lastWritten: string | undefined;
  /** Optional artifact ref attached via setArtifactRef (Phase C). */
  let artifactRef: { artifactId: string; label: string } | undefined;

  const buildBlockProps = (): ToolActivityBlockProps => ({
    // Fresh array copy so frontend reactivity sees a new reference on every write.
    entries: entries.map(e => ({ ...e })),
    label: computeLabel(entries, state, opts.phase),
    state,
    defaultOpen: false,
    ...(opts.phase && { phase: opts.phase }),
    ...(artifactRef && { artifactRef }),
  });

  const writeNow = (): void => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    // Cast through `any` at the service boundary because the default-setup
    // generated defs haven't been rebuilt yet to include the new
    // 'tool-activity' BlockType variant. Once `npm run build:api` runs, this
    // cast is purely cosmetic — the runtime shape is already correct.
    const block = {
      type: 'tool-activity',
      props: buildBlockProps() as unknown as Record<string, unknown>,
    };
    const thinkingBlock = opts.getThinkingBlock?.() ?? null;
    const blocks = thinkingBlock ? [thinkingBlock, block] : [block];
    // Blocks identical to the row's current ones cost a full write and change nothing. Once the thinking
    // block rides along here, both writers' clocks can land on the same content, and a patch that moved
    // nothing visible does too.
    const written = JSON.stringify(blocks);
    if (written !== lastWritten) {
      lastWritten = written;
      services.chat.updateMessageState(messageId, { blocks: blocks as any });
    }
    hasWrittenOnce = true;
    lastFlushAt = Date.now();
  };

  /** A patch to something already on screen goes on the row interval — see {@link ROW_INTERVAL_MS}. */
  const scheduleRow = (): void => {
    if (pendingTimer) return;
    const since = Date.now() - lastFlushAt;
    const delay = Math.max(0, rowIntervalMs - since);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      writeNow();
    }, delay);
  };

  return {
    get entries() { return entries; },
    get hasEntries() { return entries.length > 0; },
    get startedAt() { return startedAt; },

    append(entry: ToolActivityEntry): void {
      // De-dup by id — Claude CLI occasionally re-emits the same tool_use
      // inside a replayed `assistant` line after a permission pause.
      if (entries.some(e => e.id === entry.id)) return;
      entries.push(entry);
      // A tool appearing is the discrete change the user is waiting on, so it is written straight away;
      // batching it behind the row interval is what would make the block look stuck.
      writeNow();
    },

    update(id: string, patch: Partial<ToolActivityEntry>): void {
      const idx = entries.findIndex(e => e.id === id);
      if (idx === -1) return;
      entries[idx] = { ...entries[idx], ...patch, details: { ...entries[idx].details, ...patch.details } };
      scheduleRow();
    },

    flush(): void {
      if (entries.length === 0) return;
      writeNow();
    },

    setArtifactRef(ref: { artifactId: string; label: string }): void {
      artifactRef = ref;
      if (entries.length === 0) return;
      // Writing immediately is safe even after finalise — same entries+state,
      // just with the new artifactRef field included in the block props.
      writeNow();
    },

    finalise(finalState: 'done' | 'error'): void {
      state = finalState;
      if (entries.length === 0) {
        // No tools actually ran. Preserve the thinking block if present;
        // otherwise clear the blocks array if we had written before.
        const thinkingBlock = opts.getThinkingBlock?.() ?? null;
        if (thinkingBlock) {
          services.chat.updateMessageState(messageId, { blocks: [thinkingBlock] as any });
        } else if (hasWrittenOnce) {
          services.chat.updateMessageState(messageId, { blocks: [] as any });
        }
        return;
      }
      // Any entry still marked 'running' at finalise time is stranded —
      // mark it 'ok' so the group doesn't visually lie. `'error'` (set by
      // chat.ts's `user`/tool_result handler) and `'denied'` (set by the
      // permission flow) are preserved intentionally — they're meaningful
      // terminal states and must NOT be overwritten by this finaliser.
      for (const e of entries) {
        if (e.status === 'running') e.status = 'ok';
      }
      writeNow();
    },
  };
}
