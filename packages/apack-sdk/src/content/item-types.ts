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

/** A record's label: what include sets and previews name it by */
export function itemLabel(record: ContentItem, identity: readonly string[] = []): string {
  const field = identity.find((name) => name !== 'parent');
  return String((field ? record[field] : undefined) ?? record.name ?? record.title ?? record.label ?? '');
}
