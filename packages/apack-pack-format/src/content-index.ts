import { z } from 'zod';
import { PACK_ID_PATTERN } from '@apackdev/sdk/ids';
import type { ContentIndex } from '@apackdev/sdk/content';

export type { ContentIndex, ContentIndexEntry, ContentItemIdentity, ContentReference } from '@apackdev/sdk/content';

const target = z.object({ key: z.string().min(1), item: z.string() }).strict();
const reference = z.discriminatedUnion('kind', [
  z.object({ item: z.string(), path: z.string().min(1), kind: z.literal('static'), target }).strict(),
  z.object({ item: z.string(), path: z.string().min(1), kind: z.literal('dynamic'), target: target.omit({ item: true }) }).strict(),
]);

const ContentIndexSchema: z.ZodType<ContentIndex> = z.object({
  version: z.literal(1).describe('The compiled content index format.'),
  packId: z.string().regex(PACK_ID_PATTERN).describe('The pack that compiled this content.'),
  entries: z.array(z.object({
    key: z.string().min(1).describe('The declared content source or dataset key.'),
    written: z.boolean().describe('Whether this entry is applied to the database.'),
    identity: z.array(z.string()).optional(),
    count: z.number().int().nonnegative().describe('The compiler-reported item count.'),
    references: z.array(reference).describe('Static-only reference analysis; omission means unavailable, an empty array means no known references.').optional(),
    items: z.array(z.object({
      key: z.string(), description: z.string().optional(), childCount: z.number().int().nonnegative().optional(),
    }).strict()).describe('Compiled item identities and descriptions, independent of registered providers.'),
  }).strict()),
}).strict().superRefine((index, context) => {
  const names = new Set<string>();
  for (const [position, entry] of index.entries.entries()) {
    if (names.has(entry.key)) context.addIssue({ code: 'custom', path: ['entries', position, 'key'], message: `Content key "${entry.key}" is declared twice in the index` });
    names.add(entry.key);
    const items = new Set(entry.items.map(item => item.key));
    for (const [refIndex, ref] of (entry.references ?? []).entries()) {
      if (!items.has(ref.item)) context.addIssue({ code: 'custom', path: ['entries', position, 'references', refIndex, 'item'],
        message: `Reference source "${ref.item}" is not an indexed item of "${entry.key}"` });
    }
  }
});

/** Validate the current compiled index without loading compilers, content modules or providers. */
export function parseContentIndex(raw: unknown): ContentIndex {
  return ContentIndexSchema.parse(raw);
}
