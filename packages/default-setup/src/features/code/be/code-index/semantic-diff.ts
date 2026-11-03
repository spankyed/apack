// What a staged change or a range did to each definition, from the two versions alone: it reads no index row, so it
// answers with the index off. A reformat moves neither hash and so reports nothing.
import { extractFile, languageOf, type Definition, type SymbolKind } from './extract.ts';
import { readChangedPaths, readObjects } from './git-view.ts';
import { createSlicer } from './sync.ts';

export type DefinitionChange = 'added' | 'removed' | 'signature' | 'body';

export interface SemanticChange {
  path: string;
  name: string;
  kind: SymbolKind;
  change: DefinitionChange;
  signature: string;
  /** Its line in the newer version, or the older one for a removal */
  line: number;
}

export interface SemanticDiff {
  changes: SemanticChange[];
  /** Changed files the extractor can't read or couldn't parse: said so a short list isn't read as a whole one */
  unread: string[];
}

export type SemanticRange = { staged: true } | { base: string; head: string };

const keyOf = (definition: Definition) => `${definition.local}\0${definition.ordinal}`;

/** The changes between one file's two versions, in the newer one's order and then the removals */
export function diffDefinitions(path: string, older: readonly Definition[], newer: readonly Definition[]): SemanticChange[] {
  const before = new Map(older.map(definition => [keyOf(definition), definition]));
  const changes: SemanticChange[] = [];
  const report = (definition: Definition, change: DefinitionChange) => changes.push({
    path, name: definition.local, kind: definition.kind, change, signature: definition.signature, line: definition.line,
  });
  for (const definition of newer) {
    const previous = before.get(keyOf(definition));
    before.delete(keyOf(definition));
    if (!previous) report(definition, 'added');
    else if (previous.signatureHash !== definition.signatureHash) report(definition, 'signature');
    else if (previous.bodyHash !== definition.bodyHash) report(definition, 'body');
  }
  for (const definition of before.values()) report(definition, 'removed');
  return changes;
}

export async function semanticDiff(root: string, range: SemanticRange): Promise<SemanticDiff> {
  const changed = await readChangedPaths(root, range);
  const unread: string[] = [];
  const readable = changed.filter(({ path }) => {
    if (languageOf(path)) return true;
    unread.push(path);
    return false;
  });
  const [baseRef, headRef] = 'staged' in range ? ['HEAD', ''] : [range.base, range.head];
  const objects = await readObjects(root, readable.flatMap(({ path }) => [`${baseRef}:${path}`, `${headRef}:${path}`]));
  const changes: SemanticChange[] = [];
  const pause = createSlicer();
  for (const [index, { path }] of readable.entries()) {
    const [older, newer] = [objects[index * 2], objects[index * 2 + 1]].map(text => (text == null ? { ok: true as const, definitions: [] } : extractFile(path, text)));
    if (older?.ok && newer?.ok) changes.push(...diffDefinitions(path, older.definitions, newer.definitions));
    else unread.push(path);
    await pause();
  }
  return { changes, unread };
}
