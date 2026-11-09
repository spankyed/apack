// The SDK's build and apply modules know no pack's entity types: notes and FAQ applying belong to
// default-setup (its content entries, format and content writer). A new name here needs a reason in
// ALLOWED, not a quiet exception.
//
// `Document`, `Collection` and the sections they hold are deliberately absent from the list: they are
// the SDK's own entities, so its compiler, section syntax and writers name them (`compilers/documents.ts`,
// `content/document-sections.ts`, `content/document-writers.ts`). What stays forbidden
// is default-setup's — `Note` and `Symlink`, the FAQ, the export DTOs, the `library`/`notes`/`faqs`
// content keys and the repositories behind them. Adding a document type name back here would mean the
// SDK could no longer write its own rows.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { population } from '@apackdev/sdk/testing';

const SRC = path.resolve(import.meta.dirname, '../../src');
const SCANNED = ['build', 'content'];
const DECLARATION_SCHEMA = 'framework/declaration-schema.ts';

/** default-setup's entity types, their shapes, compiled content formats, repositories and content keys */
const FORBIDDEN = /\b(Note|Symlink|FAQ|NoteEntity|Exported(Item|Document|Collection|Symlink|Library|Note|Notes)|CompiledFAQ|library(Commands|Queries)|note(Commands|Queries)|(compile|import)(Library|Notes|Faq)\w*|create(Library|Notes)ContentApplier|parseMarkdownSections|library|notes|faqs?)\b/gi;

/** `file:line` substrings that name one of them for another reason */
const ALLOWED: Record<string, string> = {
  'framework/declaration-schema.ts:(e.g. "notes", "calendarEvents")': 'an example feature id',
};

/**
 * **Refuses an empty walk.** Every case here filters this for offenders and asserts the result is empty,
 * which passes for nothing when the walk itself found no files — a moved package or a renamed source
 * directory would read as the rule holding.
 */
function sourceFiles(dir: string): string[] {
  return [...population(`sdk build sources under ${dir}`, _sourceFiles(dir))];
}

function _sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? _sourceFiles(file) : entry.name.endsWith('.ts') ? [file] : [];
  });
}

function findPackContentSpecifics(root: string = SRC): string[] {
  const found: string[] = [];
  for (const file of [...SCANNED.flatMap((dir) => sourceFiles(path.join(root, dir))), path.join(root, DECLARATION_SCHEMA)]) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    fs.readFileSync(file, 'utf-8').split('\n').forEach((line, index) => {
      if (!FORBIDDEN.test(line)) return;
      FORBIDDEN.lastIndex = 0;
      if (Object.keys(ALLOWED).some((allowed) => {
        const [allowedFile, text] = [allowed.slice(0, allowed.indexOf(':')), allowed.slice(allowed.indexOf(':') + 1)];
        return allowedFile === relative && line.includes(text);
      })) return;
      found.push(`${relative}:${index + 1}: ${line.trim()}`);
    });
    FORBIDDEN.lastIndex = 0;
  }
  return found;
}

describe('SDK build and apply modules', () => {
  it("name no library, notes or FAQ types, formats, repositories or content keys", () => {
    expect(findPackContentSpecifics()).toEqual([]);
  });

});
