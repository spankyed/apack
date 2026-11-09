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
  /**
   * Current phase — drives the streaming label ("Planning…" vs "Working…").
   *
   * **There is no interval here any more.** This writer had one, and what it coalesced was a write of the
   * block's row per tool event — which existed because the row carried the entries and a derived label.
   * The entries are rows of their own now, written as they arrive, and the block holds only what changes
   * when the turn does, so the row is written twice: when the block appears and when it finishes. Both are
   * discrete changes the user is waiting for, and delaying a quarter second to coalesce a write that no
   * longer repeats bought nothing.
   */
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
   *
   * **Safe after `finalise`, and that is what makes the fold's bookkeeping load-bearing.** The write
   * replaces the block's props, so once the entries have been folded into them it has to carry them too;
   * attaching a ref to a finished block must not drop the list the fold put there.
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
  const entries: ToolActivityEntry[] = [];
  const startedAt = Date.now();

  let state: 'streaming' | 'done' | 'error' = 'streaming';
  /** Once true, we've pushed at least one block — finalise(0-entries) should clear. */
  let hasWrittenOnce = false;
  /** This block's own row, from the first write; every write after it is that row by id */
  let blockId: EntityId | undefined;
  /** Each entry's row, by the CLI's id, so a patch is one row by id rather than a walk for it */
  const rows = new Map<string, EntityId>();
  /** What the block's row was last written with, so it is written again only when that differs */
  let written: string | undefined;
  /**
   * Whether the entries now live in the block's props rather than in rows of their own.
   *
   * **A props write replaces the attribute**, so once `compactMessageBlock` has folded the entries into it,
   * every later write of this row has to carry them or it drops the whole list — and a read assembles the
   * live entry rows *instead of* the folded ones, so a later entry has to go into the props too.
   */
  let foldedIn = false;
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
  type BlockProps = Omit<ToolActivityBlockProps, 'entries' | 'label'>
    & Partial<Pick<ToolActivityBlockProps, 'entries'>>
    & { blockId?: EntityId };

  const buildBlockProps = (): BlockProps => ({
    state,
    defaultOpen: false,
    ...(opts.phase && { phase: opts.phase }),
    ...(artifactRef && { artifactRef }),
    // Only once they have been folded in, and without `details`, which the block keeps under its own
    // attribute and a read of the message must not carry
    ...(foldedIn && blockId
      ? { entries: entries.map(({ details: _details, ...rest }) => rest), blockId }
      : {}),
  });

  const writeNow = (): void => {
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

  /**
   * Puts the folded entries back as rows, because the block turned out not to be finished.
   *
   * **A fold is not only the end of a turn.** The permission flow finalises this writer mid-turn to stop the
   * block saying "Working…", and then the tool the user approved runs and its result arrives on this same
   * writer. Writing that entry into the props instead would lose its `details` — the entry rows are gone,
   * nothing updates the block's `entryDetails`, and the props carry no details by design — so every tool the
   * user explicitly approved had an empty hover.
   *
   * Every entry is in memory here, details and all, so unfolding is exact: the props stop carrying the list,
   * each entry becomes its own row again, and a read assembles them as it does for any growing block. The
   * stale `entryDetails` the fold left is harmless, a live row overriding it. The real end folds again.
   */
  const unfold = (): void => {
    if (!blockId) return;
    foldedIn = false;
    rows.clear();
    // The props first, so no moment has the list in both places
    writeNow();
    for (const held of entries) {
      const row = services.chat.updateMessageToolEntry(blockId, { ...held }, undefined);
      if (row) rows.set(held.id, row);
    }
  };

  /** Writes one entry's row, remembering it so the next patch of that entry is a write by id */
  const writeEntry = (entry: ToolActivityEntry): void => {
    if (!blockId) return;
    // The block is growing again, so it goes back to being written the way a growing block is — and that
    // writes every entry, this one among them
    if (foldedIn) { unfold(); return; }
    const row = services.chat.updateMessageToolEntry(blockId, { ...entry }, rows.get(entry.id));
    if (row) rows.set(entry.id, row);
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
      if (!blockId) writeNow();
    },

    update(id: string, patch: Partial<ToolActivityEntry>): void {
      const idx = entries.findIndex(e => e.id === id);
      if (idx === -1) return;
      entries[idx] = { ...entries[idx], ...patch, details: { ...entries[idx].details, ...patch.details } };
      writeEntry(entries[idx]);
      if (!blockId) writeNow();
    },

    flush(): void {
      if (entries.length === 0) return;
      writeNow();
    },

    setArtifactRef(ref: { artifactId: string; label: string }): void {
      artifactRef = ref;
      if (entries.length === 0) return;
      // Safe even after finalise: the props carry the state, the ref and — once the entries have been
      // folded in — the entries, so this adds the ref without dropping the list
      writeNow();
    },

    finalise(finalState: 'done' | 'error'): void {
      // **`'error'` is terminal, and the entries do not always record why.** A caller finalises with what it
      // knows — the CLI returned an error result, the stream threw — while the backstop that releases a
      // turn's writers finalises with what the entries say, which is `'done'` when no single tool failed. A
      // plain assignment let that backstop clear the state of exactly the turns that failed.
      state = finalState === 'error' || state === 'error' ? 'error' : finalState;
      if (entries.length === 0) {
        // No tools actually ran. Preserve the thinking block if present;
        // otherwise clear the blocks array if we had written before.
        if (hasWrittenOnce) {
          // Removed rather than written: the thinking block is its own row and is not this writer's to rewrite
          services.chat.removeMessageBlock(messageId, 'tool-activity');
          blockId = undefined;
          written = undefined;
          foldedIn = false;
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
      if (blockId && !foldedIn) {
        services.chat.compactMessageBlock(blockId);
        // The props now carry the entries, so every write of this row from here has to carry them too —
        // and what the fold left there is exactly what `buildBlockProps` now answers, so the dedupe holds
        // and a second finalise writes nothing
        foldedIn = true;
        rows.clear();
        written = JSON.stringify(buildBlockProps());
      }
    },
  };
}
