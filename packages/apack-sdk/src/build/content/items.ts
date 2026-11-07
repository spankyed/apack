import * as fs from 'node:fs';
import * as path from 'node:path';
import { contentHash } from '../content-hash.ts';
import { compileMarkdownTree, type MarkdownItem } from './markdown-tree.ts';
import type { ContentFormatConfig } from '../manifest.ts';

/**
 * One item a content entry writes: an entity row's fields, tagged with its entity type, plus its
 * children for trees. `contentHash` decides whether a re-apply updates an existing entity.
 */
export interface ContentItem {
  entity?: string;
  contentHash?: string;
  children?: ContentItem[];
  [field: string]: unknown;
}

/** The compiled form of a generic content entry: `<key>.content.json` */
export interface CompiledContentFile {
  records: ContentItem[];
}

/** Record keys that describe the record rather than being written as fields */
export const RECORD_KEYS: ReadonlySet<string> = new Set(['entity', 'children']);

/** Where a field's value comes from in a markdown item */
export type ContentFieldSource = 'body' | 'filename' | 'path' | `frontmatter.${string}`;

export type ContentFieldSpec = NonNullable<ContentFormatConfig['fields']>[string];
export type ContentTreeSpec = NonNullable<ContentFormatConfig['tree']>;

/** What a compiler module's default export receives */
export interface ContentCompileContext {
  key: string;
  /** Absolute path of the entry's `path` */
  path: string;
  /** The pack writing the entry (a dependency's format still compiles the writing pack's sources) */
  packDir: string;
  format: ContentFormatConfig;
}

export type ContentCompilerModule = (context: ContentCompileContext) => ContentItem[] | Promise<ContentItem[]>;

/** A record's label: what include sets and previews name it by */
export function itemLabel(record: ContentItem, identity: readonly string[] = []): string {
  const field = identity.find((name) => name !== 'parent');
  return String((field ? record[field] : undefined) ?? record.name ?? record.title ?? record.label ?? '');
}

/** How many items records hold, children included */
export function countRecords(records: ContentItem[]): number {
  return records.reduce((sum, record) => sum + 1 + countRecords(record.children ?? []), 0);
}

/** The entity types a format's items are written as */
export function formatEntities(format: ContentFormatConfig): string[] {
  const own = format.entity === undefined ? [] : Array.isArray(format.entity) ? format.entity : [format.entity];
  const branch = format.tree?.branchEntity;
  return [...new Set(branch ? [...own, branch] : own)];
}

function fieldValue(item: MarkdownItem, spec: ContentFieldSpec): unknown {
  const from = spec.from as ContentFieldSource;
  let value: unknown;
  if (from === 'body') value = item.body;
  else if (from === 'filename') value = item.displayName;
  else if (from === 'path') value = item.path;
  else value = item.frontmatter[from.slice('frontmatter.'.length)];
  // An empty frontmatter value (`title:` or `title: ""`) takes the default too
  if ((value === undefined || value === null || value === '') && spec.default !== undefined) {
    value = spec.default === 'filename' ? item.displayName : spec.default;
  }
  if (spec.type === 'string' && value !== undefined && value !== null) value = String(value);
  return value;
}

/** The default `contentHash`: a record's fields, plus its children's hashes for a branch */
export function defaultSourceHash(record: ContentItem): string {
  const fields = Object.fromEntries(Object.entries(record).filter(([key]) => !RECORD_KEYS.has(key) && key !== 'contentHash'));
  return record.children
    ? contentHash({ ...fields, children: record.children.map((child) => child.contentHash) })
    : contentHash(fields);
}

/** Fills in `contentHash` (children first) where a record has none */
export function withContentHashes(records: ContentItem[]): ContentItem[] {
  return records.map((record) => {
    const children = record.children ? withContentHashes(record.children) : undefined;
    const withChildren = children ? { ...record, children } : record;
    return withChildren.contentHash ? withChildren : { ...withChildren, contentHash: defaultSourceHash(withChildren) };
  });
}

function markdownRecords(items: MarkdownItem[], format: ContentFormatConfig, entity: string | undefined): ContentItem[] {
  const branchEntity = format.tree?.branchEntity ?? entity;
  return items.map((item) => {
    const fields = Object.fromEntries(
      Object.entries(format.fields ?? {})
        .map(([name, spec]) => [name, fieldValue(item, spec)] as const)
        .filter(([, value]) => value !== undefined),
    );
    const recordEntity = item.kind === 'branch' ? branchEntity : entity;
    return {
      ...(recordEntity && { entity: recordEntity }),
      ...fields,
      ...(item.kind === 'branch' && { children: markdownRecords(item.children, format, entity) }),
    };
  });
}

/** Compiles an entry's source with a built-in format */
export function compileBuiltinFormat(key: string, format: ContentFormatConfig, sourcePath: string): ContentItem[] {
  const entity = typeof format.entity === 'string' ? format.entity : undefined;
  if (format.format === 'markdown-tree') {
    const items = compileMarkdownTree(sourcePath, { branch: format.tree?.branch, recursive: format.tree !== undefined, media: format.media });
    return withContentHashes(markdownRecords(items, format, entity));
  }
  if (format.format === 'json') {
    if (!fs.existsSync(sourcePath)) return [];
    const data = JSON.parse(fs.readFileSync(sourcePath, 'utf-8')) as unknown;
    const records = Array.isArray(data) ? data : (data as { records?: unknown }).records;
    if (!Array.isArray(records)) throw new Error(`Content "${key}": ${path.basename(sourcePath)} must hold an array of items`);
    const tag = (items: ContentItem[]): ContentItem[] => items.map((record) => ({
      ...record,
      ...(record.entity === undefined && entity && { entity }),
      ...(record.children && { children: tag(record.children) }),
    }));
    return withContentHashes(tag(records as ContentItem[]));
  }
  throw new Error(`Content "${key}": unknown built-in format "${String(format.format)}"`);
}

/** Checks each record's entity type against the format's declared entities */
export function checkRecordEntities(key: string, format: ContentFormatConfig, records: ContentItem[]): string[] {
  const allowed = formatEntities(format);
  const errors: string[] = [];
  const visit = (items: ContentItem[], trail: string) => items.forEach((record, index) => {
    const at = `${trail}[${index}]`;
    if (allowed.length === 0) {
      if (record.entity !== undefined) errors.push(`Content "${key}" ${at}: has entity "${record.entity}", but its format declares no entity`);
    } else if (record.entity === undefined || !allowed.includes(record.entity)) {
      errors.push(`Content "${key}" ${at}: entity ${record.entity === undefined ? 'is missing' : `"${record.entity}" isn't one of ${allowed.join(', ')}`}`);
    }
    if (record.children) visit(record.children, `${at}.children`);
  });
  visit(records, 'records');
  return errors;
}
