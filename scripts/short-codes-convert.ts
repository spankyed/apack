#!/usr/bin/env node
/**
 * Brings a copy of a data dir's short codes to the rule the engine holds them to, in place:
 *
 *   node scripts/with-source.mjs npx tsx scripts/short-codes-convert.ts <data dir>
 *
 * Run it on a copy, with the app closed. A short code is engine-owned: a numbered type's rows hold `<prefix>-<n>` with
 * the prefix its manifest declares, and every other type's rows hold none — `create` refuses anything else, so a backup
 * holding another form fails to import. Data written before that holds codes under prefixes nobody declares now (`T-`,
 * `F-<name>`, `PROMPT-`, and the first three letters of any type, `PRO-` and `NOT-`, which the engine once defaulted
 * to). This converts it once, explicitly, here — never at boot:
 *
 * - **Codes of a numbered type** (the SDK's `SDK_SHORT_CODES`, the checkout's default-setup manifest, and every pack
 *   installed in the data dir beside the database): a code already in the
 *   type's form stays. Any other `<X>-<n>` becomes `<prefix>-<n>`, keeping its number unless a row of the type already
 *   holds it; what is left — a taken number, or a code with none, such as a compiled flow's `F-<name>` — is numbered
 *   after the highest.
 * - **Codes of a type that isn't numbered** are removed.
 * - **Sequences:** every short code sequence goes (`['s', key]`; a label's, `label:…`, stays). The engine starts a prefix's sequence after the highest number
 *   its type holds, so none is handed out twice, whatever the data held before.
 * - **References:** a stored reference node (an object holding `shortCode` beside `refId` or `refType`) and a
 *   `data-short-code="…"` attribute in stored markup are rewritten to the new code — by the entity they name (`refId`,
 *   or the markup's `apack-ref://` href), else by the old code when only one entity held it. A code written into
 *   plain prose is not rewritten — `T-12` in a sentence could be anything — and the script counts those it sees, and
 *   any reference it could not resolve, so they can be checked by hand.
 *
 * It prints what it changed.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEarsEngine, type EARS } from '@apackdev/ears';
import { openLmdbStore } from '@apackdev/ears/lmdb';
import { _packShortCodes, parseReferenceHref } from '@apackdev/sdk/framework';
import { SDK_SHORT_CODES } from '@apackdev/sdk/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each numbered entity type's prefix: the SDK's, the checkout's default-setup (the declaration it is converted to,
 * whatever build the data dir has installed), and every other pack installed in `packsDir`, so a type of theirs keeps
 * its codes rather than being read as one that isn't numbered. Two types sharing a prefix are refused, as the app's
 * registry refuses them.
 */
export function declaredPrefixes(packsDir?: string): Record<string, string> {
  const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/default-setup/apack.json'), 'utf8'));
  const manifests: Array<Parameters<typeof _packShortCodes>[0] & { id: string }> = [shipped];
  if (packsDir && fs.existsSync(packsDir)) {
    for (const entry of fs.readdirSync(packsDir, { withFileTypes: true })) {
      // A dot directory is an install in progress or one being retired, not an installed pack
      const file = path.join(packsDir, entry.name, 'apack.json');
      if (!entry.isDirectory() || entry.name.startsWith('.') || !fs.existsSync(file)) continue;
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (manifest.id !== shipped.id) manifests.push(manifest);
    }
  }
  const prefixes: Record<string, string> = { ...SDK_SHORT_CODES };
  const owners = new Map<string, string>(Object.entries(SDK_SHORT_CODES).map(([type, prefix]) => [prefix, `the SDK's ${type}`]));
  for (const manifest of manifests) {
    for (const [type, prefix] of Object.entries(_packShortCodes(manifest))) {
      const owner = owners.get(prefix);
      if (owner) throw new Error(`The short code prefix ${prefix} numbers both ${owner} and ${type} of "${manifest.id}"`);
      owners.set(prefix, `${type} of "${manifest.id}"`);
      prefixes[type] = prefix;
    }
  }
  return prefixes;
}

/** The installed packs directory of the data dir a database belongs to: beside it, in the app's layout */
const packsBeside = (databaseDir: string) => path.join(path.dirname(databaseDir), 'packs');

/** The data dir's database directory, in the app's layout or directly */
function database(dataDir: string): string {
  for (const base of [path.join(dataDir, 'apack'), dataDir]) {
    const dir = path.join(base, 'ears-db');
    if (fs.existsSync(path.join(dir, 'data.mdb'))) return dir;
  }
  throw new Error(`No ears-db database under ${dataDir}`);
}

const typeOf = (id: string) => id.slice(0, id.indexOf('-'));
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A short code's numbering sequence, keyed `<type>:<prefix>`; a label's is `label:…` and stays */
const isShortCodeSequence = (key: string) => !key.startsWith('label:');

/** What a rewrite answers to remove the attribute it was given */
const REMOVE_ATTRIBUTE: unique symbol = Symbol('REMOVE_ATTRIBUTE');

/** The fields the engine keeps of every row, which no rewrite is given */
const ENGINE_FIELDS = new Set(['id', 'entityType']);

/**
 * Rewrites the attributes of the database at `dir`, in place and in one unit: `rewrite` is given each attribute's kind,
 * entity id and value, and answers its new value, undefined to leave it, or `REMOVE_ATTRIBUTE` to remove it;
 * `removeSequences` names numbering sequences to remove. It answers the sequences it found, whatever it removed.
 */
function rewriteAttributes(
  dir: string,
  rewrite: (kind: string, id: string, value: unknown) => unknown,
  { removeSequences = [] }: { removeSequences?: readonly string[] } = {},
) {
  const store = openLmdbStore({ path: dir });
  try {
    const engine = createEarsEngine({ kv: store.kv, isEntityType: () => true, isRelationKind: () => true, isRole: () => true });
    const result = { rewritten: 0, removed: 0, sequencesRemoved: 0, sequences: [] as string[] };
    engine.transact(() => {
      for (const id of engine.admin.getAllEntities()) {
        for (const [kind, value] of Object.entries(engine.getRow(id) ?? {})) {
          if (ENGINE_FIELDS.has(kind)) continue;
          const next = rewrite(kind, id, value);
          if (next === undefined) continue;
          if (next === REMOVE_ATTRIBUTE) { engine.admin.deleteAttr(id, kind as EARS.AttrKind); result.removed++; continue; }
          engine.admin.putAttr(id, kind as EARS.AttrKind, next);
          result.rewritten++;
        }
      }
      store.kv.write((w) => {
        w.range({ prefix: ['s'], values: false }, (key) => { result.sequences.push(String(key[1])); });
        for (const key of removeSequences) {
          if (w.get(['s', key]) === undefined) continue;
          w.del(['s', key]);
          result.sequencesRemoved++;
        }
      });
    }, { durable: true });
    return result;
  } finally {
    store.close();
  }
}

/** Per type, what the conversion did to its codes */
interface TypeSummary { kept: number; renamed: number; renumbered: number; removed: number }

/** Each entity's new code (or removal), the codes references may be rewritten by, and the sequences to remove */
function plan(dir: string, prefixes: Readonly<Record<string, string>>) {
  const held = new Map<string, Array<{ id: string; code: string }>>();
  const { sequences: found } = rewriteAttributes(dir, (kind, id, value) => {
    if (kind === 'shortCode' && typeof value === 'string') {
      const type = typeOf(id);
      held.set(type, [...(held.get(type) ?? []), { id, code: value }]);
    }
    return undefined;
  });

  const byId = new Map<string, string | typeof REMOVE_ATTRIBUTE>();
  const summary: Record<string, TypeSummary> = {};
  const renumbered: Array<{ id: string; from: string; to: string }> = [];
  const oldCodeHolders = new Map<string, number>();
  for (const [type, rows] of held) {
    const counts: TypeSummary = (summary[type] = { kept: 0, renamed: 0, renumbered: 0, removed: 0 });
    const prefix = prefixes[type];
    if (!prefix) {
      for (const { id } of rows) { byId.set(id, REMOVE_ATTRIBUTE); counts.removed++; }
      continue;
    }
    const own = new RegExp(`^${escape(prefix)}-([1-9][0-9]*)$`);
    const taken = new Set<number>();
    const rest: typeof rows = [];
    for (const row of rows) {
      const match = own.exec(row.code);
      if (match && !taken.has(Number(match[1]))) { taken.add(Number(match[1])); counts.kept++; }
      else rest.push(row);
    }
    // Lowest number first, so a number two old prefixes share goes to one of them and not to neither
    const numberOf = (code: string) => { const match = /^[A-Z]+-([1-9][0-9]*)$/.exec(code); return match ? Number(match[1]) : undefined; };
    rest.sort((a, b) => (numberOf(a.code) ?? Infinity) - (numberOf(b.code) ?? Infinity));
    const leftover: typeof rows = [];
    for (const row of rest) {
      const n = numberOf(row.code);
      if (n === undefined || taken.has(n)) { leftover.push(row); continue; }
      taken.add(n);
      byId.set(row.id, `${prefix}-${n}`);
      counts.renamed++;
    }
    let next = Math.max(0, ...taken) + 1;
    for (const row of leftover) {
      const to = `${prefix}-${next++}`;
      byId.set(row.id, to);
      renumbered.push({ id: row.id, from: row.code, to });
      counts.renumbered++;
    }
    for (const { code } of rows) oldCodeHolders.set(code, (oldCodeHolders.get(code) ?? 0) + 1);
  }

  // A reference by code alone is rewritten only when one entity held that code; a code several held and one of them
  // gave up is ambiguous, and a reference naming it by code alone is left, and counted
  const codes = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [type, rows] of held) {
    if (!prefixes[type]) continue;
    for (const { id, code } of rows) {
      const to = byId.get(id);
      if (typeof to !== 'string') continue;
      if (oldCodeHolders.get(code) === 1) codes.set(code, to);
      else ambiguous.add(code);
    }
  }
  return { byId, codes, ambiguous, sequences: found.filter(isShortCodeSequence), summary, renumbered };
}

/** A tag in stored markup carrying a short code: a reference pill's `<a>`, which names its entity in its href */
const CODED_TAG = /<[a-z][^>]*\bdata-short-code="([^"]*)"[^>]*>/gi;

/** The new code of the entity a reference names, else the one its old code alone resolves to, else undefined */
function resolvedCode(id: unknown, code: string, byId: ReadonlyMap<string, unknown>, codes: ReadonlyMap<string, string>): string | undefined {
  const byRef = typeof id === 'string' ? byId.get(id) : undefined;
  const to = typeof byRef === 'string' ? byRef : codes.get(code);
  return to === code ? undefined : to;
}

/** `value` with every reference it holds rewritten, or undefined when it holds none */
function rewriteReferences(value: unknown, byId: ReadonlyMap<string, unknown>, codes: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    if (!value.includes('data-short-code="')) return undefined;
    const next = value.replace(CODED_TAG, (tag, code: string) => {
      const href = /\bhref="([^"]*)"/.exec(tag)?.[1];
      const to = resolvedCode(href ? parseReferenceHref(href.replace(/&amp;/g, '&'))?.id : undefined, code, byId, codes);
      return to === undefined ? tag : tag.replace(`data-short-code="${code}"`, `data-short-code="${to}"`);
    });
    return next === value ? undefined : next;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const rewritten = rewriteReferences(item, byId, codes);
      if (rewritten === undefined) return item;
      changed = true;
      return rewritten;
    });
    return changed ? next : undefined;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const record = value as Record<string, unknown>;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(record)) {
      let rewritten: unknown;
      if (key === 'shortCode' && ('refId' in record || 'refType' in record) && typeof field === 'string') {
        // The entity it names, when it names one, says which code it now holds; the code alone, when only one held it
        rewritten = resolvedCode(record.refId, field, byId, codes);
      } else rewritten = rewriteReferences(field, byId, codes);
      if (rewritten === undefined) next[key] = field;
      else { next[key] = rewritten; changed = true; }
    }
    return changed ? next : undefined;
  }
  return undefined;
}

/** How many times `pattern` matches in the strings `value` holds, at any depth */
function mentions(value: unknown, pattern: RegExp): number {
  if (typeof value === 'string') return value.match(pattern)?.length ?? 0;
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + mentions(item, pattern), 0);
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.values(value).reduce((sum: number, field) => sum + mentions(field, pattern), 0);
  return 0;
}

export function convertShortCodes(dir: string, prefixes: Readonly<Record<string, string>> = declaredPrefixes(packsBeside(dir))) {
  const { byId, codes, ambiguous, sequences, summary, renumbered } = plan(dir, prefixes);
  // Old codes still named after the rewrite — in prose, or in a reference nothing resolved — counted rather than
  // guessed at: every code that changed, and every one several entities held
  const left = [...new Set([...[...codes].filter(([from, to]) => from !== to).map(([from]) => from), ...ambiguous])];
  const leftPattern = left.length > 0 ? new RegExp(`\\b(${left.map(escape).join('|')})\\b`, 'g') : undefined;
  let mentionsLeft = 0;
  const written = rewriteAttributes(dir, (kind, id, value) => {
    if (kind === 'shortCode') return byId.get(id);
    const next = rewriteReferences(value, byId, codes);
    if (leftPattern) mentionsLeft += mentions(next ?? value, leftPattern);
    return next;
  }, { removeSequences: sequences });
  return {
    types: summary,
    renumbered,
    sequencesRemoved: written.sequencesRemoved,
    attributesRewritten: written.rewritten,
    attributesRemoved: written.removed,
    mentionsLeft,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('usage: node scripts/with-source.mjs npx tsx scripts/short-codes-convert.ts <data dir>   (a copy, with the app closed: it converts in place)');
    process.exit(2);
  }
  const dir = database(path.resolve(dataDir));
  console.log(dir, JSON.stringify(convertShortCodes(dir), null, 2));
}
