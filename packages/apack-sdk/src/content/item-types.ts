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
