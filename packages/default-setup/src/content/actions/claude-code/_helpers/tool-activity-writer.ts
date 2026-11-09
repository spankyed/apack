/**
 * Throttled writer for the `tool-activity` block on a streaming chat message.
 *
 * Claude Code can emit 20+ tool_use / tool_progress events in a few seconds;
 * we don't want to hit `updateMessageState` 20+ times per second because the
 * frontend rebuilds the blocks array wholesale on every update. This helper
 * coalesces writes into ~250ms batches (mirroring `createStreamWriter`'s
 * pattern for text deltas).
 *
 * The writer owns the canonical copy of the block's `entries` array and
 * `state`. Call `append`, `update`, and `finalise`; the writer recomputes
 * the collapsed label on each change and writes its own block's row via
 * `services.chat.updateMessageBlock`.
 *
 * **Ownership is the row.** This writer owns the message's `tool-activity` block and nothing else: it holds
 * that row's id from its first write, so a flush costs its own entries and never another block's bytes. The
 * `onPermissionRequest` flow in chat.ts puts approval blocks on separate sibling messages
 * (`sendApprovalBlock` → `sendBlockMessage`) rather than on the streaming one, so this writer's block is the
 * only one here besides the thinking writer's — which owns its own row and is never written from here.
 *
 * Coexistence with `StreamWriter`: they write different things about the same message, its `text` and this
 * block's row, so neither can clobber the other.
 *
 * One compromise flagged in the design doc: a message's `text` and its blocks are separate, and
 * `message.vue` renders the Tiptap text
 * first, then `<InteractionContainer>` below. So the activity block visually
 * lands below the prose of the turn, not interleaved between "prose-before"
 * and "prose-after" the tool calls. True inline interleaving would require a
 * new message schema; the "work log below prose" layout is acceptable for
 * Phase A.
 */

import type { Services, EntityId } from '#generated/services.ts';
import type { ToolActivityEntry, ToolActivityBlockProps } from './tool-activity-types.ts';

export interface ToolActivityWriterOptions {
  /** Minimum ms between `updateMessageState` calls. Default 250ms. */
  intervalMs?: number;
  /** Current phase — drives the streaming label ("Planning…" vs "Working…"). */
  phase?: string;
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
  const intervalMs = opts.intervalMs ?? 250;
  const entries: ToolActivityEntry[] = [];
  const startedAt = Date.now();

  let state: 'streaming' | 'done' | 'error' = 'streaming';
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = 0;
  /** Once true, we've pushed at least one block — finalise(0-entries) should clear. */
  let hasWrittenOnce = false;
  /** This block's own row, from the first write; every write after it is that row by id */
  let blockId: EntityId | undefined;
  /** Each entry's row, by the CLI's id, so a patch is one row by id rather than a walk for it */
  const rows = new Map<string, EntityId>();
  /** What the block's row was last written with, so it is written again only when that differs */
  let written: string | undefined;
  /** Optional artifact ref attached via setArtifactRef (Phase C). */
  let artifactRef: { artifactId: string; label: string } | undefined;

  /**
   * What the block itself holds.
   *
   * **`entries` and `label` are both deliberately absent.** Each entry is a row of its own and a read
   * assembles them, so carrying them here too would store the list twice and bring back the whole-array
   * write this removed. The label is `computeLabel(entries, state, phase)` — derived, so the block that
   * shows it derives it (`ToolActivityBlock.vue` already did, behind a `props.label ||` fallback) and
   * nothing stores it.
   *
   * **Between them they are why this row is no longer written per tool event.** What is left changes when
   * the turn does — the block appearing, its state at the end, an artifact attached — and not when a tool
   * starts or finishes. Storing a derived label is what made every event a write of this row.
   */
  const buildBlockProps = (): Omit<ToolActivityBlockProps, 'entries' | 'label'> => ({
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
    lastFlushAt = Date.now();
    const props = buildBlockProps();
    const next = JSON.stringify(props);
    // **The row is written when what it holds differs, which after the label stopped being stored is
    // twice a turn**: the block appearing and its state at the end. A tool starting or finishing changes
    // nothing here, so neither a flush nor an event writes it again
    if (blockId && next === written) return;
    written = next;

    const block = { type: 'tool-activity', props: props as unknown as Record<string, any> };
    const firstWrite = blockId === undefined;
    blockId = services.chat.updateMessageBlock(messageId, block, blockId);
    // The block's row has to exist before an entry can hang off it, so a first write writes them all
    if (firstWrite) for (const entry of entries) writeEntry(entry);
    hasWrittenOnce = true;
  };

  /** Writes one entry's row, remembering it so the next patch of that entry is a write by id */
  const writeEntry = (entry: ToolActivityEntry): void => {
    if (!blockId) return;
    const row = services.chat.updateMessageToolEntry(blockId, { ...entry }, rows.get(entry.id));
    if (row) rows.set(entry.id, row);
  };

  const schedule = (): void => {
    if (pendingTimer) return;
    const since = Date.now() - lastFlushAt;
    const delay = Math.max(0, intervalMs - since);
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
      writeEntry(entry);
      // Only to bring the row into being: an entry cannot hang off a block that is not there yet. Once it
      // is, nothing about it changes until the turn ends, so no later event writes it
      if (!blockId) schedule();
    },

    update(id: string, patch: Partial<ToolActivityEntry>): void {
      const idx = entries.findIndex(e => e.id === id);
      if (idx === -1) return;
      entries[idx] = { ...entries[idx], ...patch, details: { ...entries[idx].details, ...patch.details } };
      writeEntry(entries[idx]);
      if (!blockId) schedule();
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
        if (hasWrittenOnce) {
          // Removed rather than written: the thinking block is its own row and is not this writer's to rewrite
          services.chat.removeMessageBlock(messageId, 'tool-activity');
          blockId = undefined;
          written = undefined;
          rows.clear();
        }
        return;
      }
      // Any entry still marked 'running' at finalise time is stranded —
      // mark it 'ok' so the group doesn't visually lie. `'error'` (set by
      // chat.ts's `user`/tool_result handler) and `'denied'` (set by the
      // permission flow) are preserved intentionally — they're meaningful
      // terminal states and must NOT be overwritten by this finaliser.
      for (const e of entries) {
        if (e.status === 'running') { e.status = 'ok'; writeEntry(e); }
      }
      writeNow();
      // The block has stopped growing, so its entries fold back into it: they made this turn's writes cheap
      // and from here they would only cost every read of the message, and the store, for the thread's life
      if (blockId) services.chat.compactMessageBlock(blockId);
    },
  };
}
