// The `documents` and `commands` content keys: a directory of markdown compiled into the SDK's document model.
// Directories become Collections (named by their _meta.md frontmatter) and markdown files Documents, with their
// content parsed into sections. `commands` is the same compiler with a default document type.
import { contentHash } from '../compile-utils.ts';
import { compileMarkdownTree, type MarkdownItem } from '../content/markdown-tree.ts';
import { countRecords, itemLabel, type ContentItem } from '../content/items.ts';
import { parseDocumentSections } from '@apackdev/sdk/content';
import { COMMANDS_DOCUMENT_TYPE } from '@apackdev/sdk/commands';
import { SDK_ENTITIES } from '@apackdev/sdk/types';
import type { SpecialtyCompiler } from '../content-compiler.ts';

/** The directory a documents source keeps its media in, skipped by the walk and copied beside the records */
const MEDIA_DIR = 'media';

const text = (value: unknown): string | undefined => (value === undefined || value === null || value === '' ? undefined : String(value));

function toRecords(items: MarkdownItem[], defaultDocumentType?: string): ContentItem[] {
  return items.map((item) => {
    if (item.kind === 'branch') {
      const name = text(item.frontmatter.name) ?? item.displayName;
      const description = text(item.frontmatter.description);
      const children = toRecords(item.children, defaultDocumentType);
      return {
        entity: SDK_ENTITIES.Collection,
        name,
        ...(description && { description }),
        children,
        contentHash: contentHash({ name, description, children: children.map((child) => child.contentHash) }),
      };
    }
    const name = text(item.frontmatter.name) ?? item.displayName;
    const content = parseDocumentSections(item.body || item.text);
    const tags = Array.isArray(item.frontmatter.tags) ? item.frontmatter.tags.map(String) : [];
    const resolvedTags = tags.length ? tags : ['default'];
    // What the document is, which is the document's own property: its frontmatter says so, and the key
    // supplies a default for a source whose documents are all one kind — so a file in the commands source
    // cannot fail to be a command list, and a document anywhere else can still declare it is one.
    // In the hash with everything else, so changing it is a content change the apply offers.
    const documentType = text(item.frontmatter.type) ?? defaultDocumentType;
    return { entity: SDK_ENTITIES.Document, name, content, tags: resolvedTags, ...(documentType && { documentType }),
      contentHash: contentHash({ name, content, tags: resolvedTags, documentType }) };
  });
}

/** The records a documents tree compiles to, with `defaultDocumentType` for documents that declare none */
export function compileDocumentTree(dir: string, defaultDocumentType?: string): ContentItem[] {
  return toRecords(compileMarkdownTree(dir, { branch: '_meta.md', media: MEDIA_DIR }), defaultDocumentType);
}

interface DocumentsCompiled {
  records: ContentItem[];
}

const IDENTITY = ['name'];

function documentTreeCompiler(defaultDocumentType?: string): SpecialtyCompiler<DocumentsCompiled> {
  return {
    identity: IDENTITY,
    media: MEDIA_DIR,
    async compile(dir) {
      return { records: compileDocumentTree(dir, defaultDocumentType) };
    },
    output: (data) => ({ records: data.records }),
    count: (data) => countRecords(data.records),
    items: (data) => data.records.map((record) => ({
      key: itemLabel(record, IDENTITY),
      ...(typeof record.description === 'string' && { description: record.description }),
      ...(record.children && { childCount: record.children.length }),
    })),
  };
}

export const documentsCompiler = documentTreeCompiler();
export const commandsCompiler = documentTreeCompiler(COMMANDS_DOCUMENT_TYPE);
