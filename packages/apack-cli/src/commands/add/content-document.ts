// Writing a markdown document into a content source, shared by the two scaffolds that do it: a chat slash
// command and a document. Both are the same act — markdown with `name` frontmatter, compiled by the SDK into
// Collection and Document records — and differ only in which content key compiles them and what the body
// holds.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PackManifest } from '@apackdev/pack-format';
import { writeManifest } from '../../manifest-writer.ts';
import { addContentSource } from './manifest';
import { logCreated, validateName } from './write';

/** The SDK content keys that compile a directory of markdown documents */
export type DocumentKey = 'documents' | 'commands';

/** Where the pack's source for `key` keeps its files, when it declares one */
function declaredPath(manifest: PackManifest, key: DocumentKey): string | undefined {
  const entry = manifest.content?.sources?.[key];
  if (entry === undefined) return undefined;
  return typeof entry === 'string' ? entry : entry.path ?? `src/content/${key}`;
}

/**
 * Writes `body` as a document under the `key` source, declaring the source when the pack has none, and
 * reports what it did. `folder` nests it, which the compiler reads as a Collection holding the document.
 *
 * Returns the document's path and whether it was written. A caller whose unit is smaller than a document
 * — a command is one line of one — acts on the file itself when it was already there.
 */
export function writeContentDocument(
  root: string,
  manifest: PackManifest,
  key: DocumentKey,
  options: { name: string; folder?: string; body: string },
): { wrote: boolean; filePath: string } {
  const existing = declaredPath(manifest, key);
  if (options.folder) validateName(options.folder, 'Folder');
  const sourcePath = existing ?? `src/content/${key}`;
  const filePath = path.join(root, sourcePath, ...(options.folder ? [options.folder] : []), `${options.name}.md`);

  // The source first, as every scaffold declares what it writes: a document no entry compiles is content
  // the apply never reaches
  const declared = existing === undefined;
  if (declared) {
    addContentSource(manifest, key, sourcePath);
    writeManifest(root, manifest);
  }

  // Silent about a document that is already there: what to do with one is the caller's — a document is
  // finished and a command is a line that joins its field section
  if (fs.existsSync(filePath)) return { wrote: false, filePath };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, options.body);
  logCreated(root, [filePath]);
  if (declared) console.log(`  ~ apack.json (content.sources.${key})`);
  return { wrote: true, filePath };
}
