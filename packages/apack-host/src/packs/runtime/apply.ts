import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createLogger } from '@apackdev/sdk/logger';
import { PACK_LAYOUT, packContentFiles } from '../layout.ts';
import { recordApplyOutcomes } from '../installed.ts';
import type { PackManifest } from '@apackdev/pack-format';
import { appliedContent, appState } from '../../app-state/index.ts';
import { applyRecord, importCompiledContent } from '@apackdev/sdk/utils';
import { describeContentKey } from '@apackdev/sdk/content';
import type { ContentOffer } from '@apackdev/sdk/utils';
import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('pack-content');

/**
 * What a pack's compiled content is: their bytes, and the names of the files holding them. **Content only.**
 *
 * The names as well as the bytes, so a content file moved between files, added or dropped counts — the same reason
 * `fingerprintUnit` hashes a unit's declared paths beside its contents.
 *
 * **File times are deliberately not in here, and used to be.** `placePack` copies into a fresh directory and
 * renames it over the old one, so every install leaves new files whatever they contain; hashing their mtimes
 * made a reinstall of the identical pack look like changed data, which was the point — reinstalling was how
 * you got a pack's data put back. It also made a `touch` re-apply, and made every `apack pack dev` backend rebuild
 * re-import every item, since that loop reinstalls. Content is what "changed" means here, as it does
 * everywhere else in this repo that compares a tree against a record.
 *
 * Putting a pack's data back on purpose is `IMPORT_PACK_CONTENT` (`features/packs/be/types.ts`), which Settings
 * drives with a preview, a per-key selection and a collision mode — more than a reinstall ever gave, and it
 * leaves this record alone, so asking for the data again does not change what counts as changed.
 */
export function contentRevision(contentDir: string): string {
  const files = packContentFiles(contentDir);
  if (files.length === 0) return '';
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(contentDir, file)));
  }
  return hash.digest('hex').slice(0, 16);
}

export interface PackApplyFailure {
  packId: string;
  errors: string[];
}

function applyErrors(result: Record<string, { errors?: string[] }> | undefined): string[] {
  return Object.entries(result ?? {}).flatMap(([key, counts]) => (counts?.errors ?? []).map(e => `${key}: ${e}`));
}


/**
 * What applying a pack's content needs: which pack, where its compiled content is, and what it depends on.
 *
 * The manifest fields are `Pick`ed from `PackManifest` rather than restated, so this can't drift from what
 * a manifest actually holds — `dependencies` is optional here because a pack with none declares none, not
 * because a caller may leave it out. It is what the retry rule reads: an apply that failed is run again once
 * one of these has applied.
 */
export interface PackContentTarget {
  manifest: Pick<PackManifest, 'id' | 'dependencies'>;
  /** The pack's own directory; its compiled content is at `runtime/content` under it */
  dir: string;
}

/**
 * The applied state of the packs `dependencies` names, as one string.
 *
 * A pack's own revision says whether its data changed. This says whether anything it depends on has applied
 * since — the other thing that can turn a failed apply into one that would now succeed. A dependency that
 * has never applied reads the same as one with nothing to apply, which is what the deferred note in
 * `docs/archive/goals/goal-pack-apply-order-and-retry.md` is about.
 */
function dependencyState(dependencies: Record<string, string> | undefined): string {
  return Object.keys(dependencies ?? {}).sort().map((id) => `${id}:${appliedContent.get(id).revision}`).join('|');
}

/** What each kind of offer says, in the one log line that reports them */
const OFFER_SENTENCE: Record<ContentOffer['kind'], string> = {
  update: 'have your edits and a newer version waiting',
  removed: 'you edited and the pack no longer ships',
};

/**
 * One line per kind of decision the user now has, so an apply says what it left outstanding even when
 * nobody opens the Packs view.
 *
 * Named rather than keyed, because a content key is `%5B%22Action%22...` and nobody reads that: the key
 * holds the entity type and the item's identity, and `describeContentKey` is what renders them. The keys
 * are in the event's meta for whoever is tracing one.
 *
 * **The boot apply runs before the bus starts**, so this reaches stdout and the app's log file and not the
 * Logs surface, which shows what `onLog` delivers from the moment the bus starts it. An apply on a reload
 * or an activation reaches both.
 */
function reportOffers(packId: string, offers: ReadonlyMap<string, ContentOffer>): void {
  for (const kind of Object.keys(OFFER_SENTENCE) as ContentOffer['kind'][]) {
    const of = [...offers].filter(([, offer]) => offer.kind === kind);
    if (of.length === 0) continue;
    const named = of.map(([key, offer]) => `${describeContentKey(key)} (${offer.parts.join(', ')})`);
    logger.warn(`${of.length} of ${packId}'s items ${OFFER_SENTENCE[kind]}:\n  ${named.join('\n  ')}`, {
      packId,
      items: Object.fromEntries(of),
    });
  }
}

/**
 * Apply the packs whose apply could have a different outcome than last time: their compiled data changed, or
 * their last apply failed and something they depend on has applied since. `packs` arrives in dependency order
 * (`packContentOrder`), so a pack sees what the packs it depends on applied in this same run.
 *
 * **Every pack, by one rule**, whoever ships it: one hash over the files in its content directory, one record
 * (`appliedContent`) and one retry rule. Which
 * directory that is follows from where the pack lives, so a pack does not tell the host
 * where its compiled data is — the host knows, because it is the host that put the pack there.
 *
 * A pack whose apply reports errors (an invalid flow, say) is a failed apply: the error is recorded as the
 * installed-packs entry's `lastError`, and its revision is recorded like a successful apply's, so the same
 * failing data isn't re-imported on every boot. What is stored alongside it is the state its dependencies were in,
 * so the retry happens when that changes rather than never.
 */
export function applyPacks(packs: Iterable<PackContentTarget>, importContent: typeof importCompiledContent = importCompiledContent): PackApplyFailure[] {
  const failures: PackApplyFailure[] = [];
  const outcomes = new Map<string, string | undefined>();

  for (const pack of packs) {
    const packId = pack.manifest.id;
    const contentDir = path.join(pack.dir, PACK_LAYOUT.contentDir);
    const currentHash = fs.existsSync(contentDir) ? contentRevision(contentDir) : '';
    if (!currentHash) {
      // Nothing to apply: an earlier version's error no longer applies, and neither does what it faced
      outcomes.set(packId, undefined);
      appState.updatePackEntry('failedAgainst', packId, undefined);
      continue;
    }

    // Read per pack, not once: a pack earlier in this run may be one this pack depends on
    const applied = appliedContent.get(packId);
    const deps = dependencyState(pack.manifest.dependencies);
    const failedAgainst = appState.get().failedAgainst[packId];
    if (applied.revision === currentHash && (failedAgainst === undefined || failedAgainst === deps)) {
      logger.info(`Pack apply skipped (unchanged): ${packId}`);
      continue;
    }

    logger.info(`Applying content for pack: ${packId}`);
    let errors: string[];
    /**
     * The record that makes this an apply rather than an import: what the last one wrote per item, the keys
     * this run's content declares, and what this run then did. It is the only reason an entity the user
     * destroyed is known to be theirs, and the only reason the user's edit to one part of an item does not
     * freeze the rest of it.
     *
     * A user-requested import (`IMPORT_PACK_CONTENT`) passes none, which is what makes asking for a pack's
     * data back ask for the entities to come back.
     */
    const record = applyRecord(new Map(Object.entries(applied.items)));
    try {
      // `replace-on-collision` is what the appliers do by default — they branch only on `keep-existing` and
      // `wipe-and-replace` — so naming it changes nothing and says what this is
      errors = applyErrors(importContent({
        compiledDir: contentDir,
        mode: 'replace-on-collision',
        applied: record,
      }));
    } catch (err) {
      errors = [errorMessage(err)];
    }
    /**
     * **Recorded whether or not the run succeeded, because what it wrote is written either way.** A run that
     * imported fifty items and failed on the next has changed fifty entities, and the revision moves with
     * them — so nothing re-imports them until the content changes again, and leaving them out would make a
     * later apply read all fifty as the user's.
     *
     * The revision is also the skip gate, which is why it belongs with the items rather than beside them:
     * a revision recorded without the items it describes, or the other way round, is the state in which
     * every item of a pack reads as the user's.
     */
    appliedContent.record(packId, {
      revision: currentHash,
      wrote: record.written,
      dropped: record.removed,
      offers: record.offers,
      reached: record.defined,
    });
    reportOffers(packId, record.offers);
    if (errors.length > 0) {
      logger.error(`Failed to apply pack ${packId}:\n  ${errors.join('\n  ')}`);
      appState.updatePackEntry('failedAgainst', packId, deps);
      failures.push({ packId, errors });
      outcomes.set(packId, errors.join('\n'));
      continue;
    }
    appState.updatePackEntry('failedAgainst', packId, undefined);
    outcomes.set(packId, undefined);
    logger.info(`Pack applied: ${packId}`);
  }

  recordApplyOutcomes(outcomes);
  return failures;
}

