import * as fs from 'fs';
import * as path from 'path';
import { boundHost } from '../runtime/host-runtime.ts';
import { parseContentIndex } from '../build/content-index.ts';
import type { ApplyRecord, ContentSelection, ImportMode, ImportResult } from './apply-types.ts';

export { applyRecord } from './apply-types.ts';
export type {
  AppliedItem, ApplyContext, ApplyRecord, ApplyResult, ContentApplier, ContentOffer, ContentSelection, ImportMode, ImportResult,
} from './apply-types.ts';

/** The content keys a registered pack has appliers for (its registration's `appliers`): the only keys an import of its content can touch */
export function registeredContentKeys(packId: string): string[] {
  return boundHost().packs.appliers(packId).map((applier) => applier.key);
}

/** The index compilePack writes next to a pack's compiled content */
export const CONTENT_INDEX_FILE = 'content.json';

/**
 * The pack that compiled a content directory, from its content.json. Content keys start with it, so two
 * packs' records with the same entry key and identity write an entity each.
 */
export function contentPackId(compiledDir: string): string {
  const indexFile = path.join(compiledDir, CONTENT_INDEX_FILE);
  return parseContentIndex(JSON.parse(fs.readFileSync(indexFile, 'utf8'))).packId;
}

/** Content a pack's compiled content directory with the appliers of the registered pack its content.json names */
export function importCompiledContent(options: {
  compiledDir: string;
  include?: Record<string, ContentSelection | undefined>;
  mode?: ImportMode;
  applied?: ApplyRecord;
  /** Overwrite the user's edits; see `ApplyContext.force` */
  force?: boolean;
  verbose?: boolean;
}): Record<string, ImportResult> {
  const log = options.verbose ? console.log.bind(console) : () => {};
  const result: Record<string, ImportResult> = {};
  const packId = contentPackId(options.compiledDir);
  /**
   * **`force` is structurally out of an apply's reach.** An apply hands over what the last one wrote, so a
   * record with anything in `before` is an apply by construction — and a run that both converges toward the
   * pack and overwrites the user is the one combination nothing here is allowed to be. A restore passes a
   * write-only record, which is also what a pack applying for the first time has, and that case writes
   * nothing of anyone's.
   */
  if (options.force && (options.applied?.before.size ?? 0) > 0) {
    throw new Error('force overwrites the user\'s edits and so belongs to an import; an apply reads what it last wrote and must not pass it');
  }

  for (const applier of boundHost().packs.appliers(packId)) {
    const inc = options.include?.[applier.key];
    if (inc instanceof Set && inc.size === 0) {
      log(`  ${applier.key} section skipped by include filter`);
      result[applier.key] = { created: 0, updated: 0, skipped: 0 };
      continue;
    }
    result[applier.key] = applier.apply({
      compiledDir: options.compiledDir,
      include: inc,
      mode: options.mode,
      applied: options.applied,
      ...(options.force === true && { force: true }),
      log,
    });
  }

  return result;
}

// --- Helpers available to appliers ---

export function loadJSON<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (err) {
    console.warn(`[content] Failed to parse ${path.basename(filePath)}:`, (err as Error).message);
    return null;
  }
}

export function selectsAll(inc: ContentSelection | undefined): boolean {
  return inc === undefined || inc === true;
}

export function filterBySelection<T>(items: T[], getKey: (item: T) => string, inc: ContentSelection | undefined): T[] {
  if (selectsAll(inc)) return items;
  const set = inc as ReadonlySet<string>;
  return items.filter(item => set.has(getKey(item)));
}
