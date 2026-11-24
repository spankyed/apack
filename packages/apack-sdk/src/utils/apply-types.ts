/**
 * What one content key's applier did. Not counts, despite three of its four fields: `errors` is what the run
 * could not write, which is what makes a run a failure.
 *
 * **What it does not carry is the conflicts and removals**, which are on the record the run was given
 * (`ApplyRecord`) — the one place they already are, where a copy here would be a second account of the same
 * fact, and absent from an import by construction rather than by being left empty.
 */
export interface ApplyResult {
  created: number;
  updated: number;
  skipped: number;
  /** Items that could not be written (a flow failing validation, say). Non-empty means the run failed. */
  errors?: string[];
}

/**
 * The same shape, named for the other operation.
 *
 * Two names for one shape on purpose, and the shape is all they are: this is an alias, so the compiler
 * cannot tell them apart and nothing checks which one a signature names. It is a label for the reader —
 * `apply` converges the database toward what a pack declares, `import` puts a pack's content back because
 * the user asked — and what actually separates the two operations is the record (`ApplyRecord`), which an
 * apply carries and an import does not.
 */
export type ImportResult = ApplyResult;

export type ContentSelection = true | ReadonlySet<string>;

export type ImportMode = 'keep-existing' | 'replace-on-collision' | 'wipe-and-replace';

/**
 * What one apply wrote for one item: the entity type it wrote, the hash of the content it wrote it from, and
 * a hash per **part** — one addressable piece of the item, by path. A field's path is its name; a flow's are
 * `fields`, `node:<id>` per node, and `edges` for its wiring.
 *
 * The parts are what makes "which piece did the user touch" answerable, where one digest over the whole item
 * could only say that something in it moved.
 */
export interface AppliedItem {
  entityType?: string;
  contentHash?: string;
  parts: Record<string, string>;
  /**
   * The decision the user has about this item, from the last apply that found one. An entry carries one only
   * while it is unresolved: the next apply clears it when the item is the pack's again, and resolving it
   * either writes the item (and so re-stamps the entry) or drops the offer.
   */
  offer?: ContentOffer;
  /**
   * The `contentHash` the user was offered and kept their own version against (`update` offers only). The
   * offer is keyed to the item rather than to a pack version, so a release that leaves this item alone is
   * silent and the offer comes back by itself once the item itself changes.
   */
  dismissed?: string;
}

/**
 * A decision the user has about one item, of which there are two kinds and no third.
 *
 * `update` is "you changed this and a newer version ships"; `removed` is "you changed this and the pack no
 * longer ships it". Both are reached the same way — the item was ours, a part of it is no longer what we
 * wrote — and they differ in what resolving them means, which is why the kind is a field rather than two
 * containers.
 *
 * Only an entry whose `onUserEdit` is `offer` produces one. Under `theirs` the edit is the user's own
 * writing and is never the subject of a badge.
 */
export interface ContentOffer {
  kind: 'update' | 'removed';
  /** The parts whose stored value is no longer what we wrote: what the UI labels */
  parts: string[];
  /** The hash of the version being offered; absent for a `removed` offer, which offers no version */
  contentHash?: string;
}

/**
 * The record one apply reads and writes: what the last one wrote, what this one wrote, and what it found.
 *
 * It is the whole of what makes an apply a three-way merge — `before` is the side nothing used to store, so
 * "did the user change this" was answerable only as "did anything in it move" and "is it still here" only
 * as "did we ever name it". A caller that keeps the record allocates this and reads it back; an apply given
 * none records nothing and detects no removal, which is what makes the import path structurally unable to
 * reach it (`features/packs/be/system.ts`).
 *
 * `before` and `defined` are the inputs, the other three what the run found:
 *
 * - `written` — the items it wrote. One it skipped keeps whatever `before` holds, which is the caller's to
 *   carry forward, so this is deliberately not every item the content declares.
 * - `removed` — items the content no longer declares whose entity it deleted. Their entries are dropped.
 * - `offers` — the decisions the run left the user: an item whose content moved and whose entity they have
 *   edited (`update`, nothing written), and an item they edited that the content no longer declares
 *   (`removed`, kept rather than deleted). One container rather than two, because the two are reached by the
 *   same rule and differ only in what resolving one means.
 *
 * **An item the user edited under a `theirs` entry reaches none of these.** It is theirs, the apply says so in
 * its log, and there is nothing for anyone to decide.
 */
export interface ApplyRecord {
  /** What the last apply wrote, by content key */
  before: ReadonlyMap<string, AppliedItem>;
  /** Every key this run's content declares, whatever the run then did about it */
  defined: Set<string>;
  written: Map<string, AppliedItem>;
  removed: Set<string>;
  offers: Map<string, ContentOffer>;
}

/** An empty record, for a caller that wants one without writing out five containers */
export function applyRecord(before: ReadonlyMap<string, AppliedItem> = new Map()): ApplyRecord {
  return {
    before,
    defined: new Set(),
    written: new Map(),
    removed: new Set(),
    offers: new Map(),
  };
}

export interface ApplyContext {
  compiledDir: string;
  include?: ContentSelection;
  mode?: ImportMode;
  /** The applied content, for an apply; absent for an import, which reads none and records none */
  applied?: ApplyRecord;
  /**
   * Write the pack's version over whatever is there, the user's edits included.
   *
   * **The one place in the app the user's work is overwritten**, and it is only ever reached from something
   * they clicked: taking a newer version they were offered, or asking for the shipped item back. An apply
   * never passes it, which `importCompiledContent` refuses rather than leaves to be remembered.
   */
  force?: boolean;
  log: (...args: unknown[]) => void;
}

export interface ContentApplier {
  key: string;
  apply(ctx: ApplyContext): ApplyResult;
}
