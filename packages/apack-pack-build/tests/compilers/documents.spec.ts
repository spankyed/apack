// What a compiled document says it is, which is how the chat's slash commands are found: the app serves
// every document of `documentType: 'commands'`.
//
// **A command is only a document with a type**, so the type belongs to the document and its frontmatter
// is what declares it. The `commands` key supplies a default because a whole source there is one kind, which
// is what stops a file in it from failing to be a command list by saying nothing — but it is a default, so a
// document in the `documents` key may declare the type and be served, and one that declares nothing is just
// a document.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { commandsCompiler, documentsCompiler } from '../../src/compilers/documents.ts';

const dirs: string[] = [];
afterAll(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });

/** A source directory holding one markdown file per `[name, frontmatter]` */
function source(files: Array<[string, string]>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'document-type-'));
  dirs.push(dir);
  for (const [name, frontmatter] of files) {
    fs.writeFileSync(path.join(dir, `${name}.md`), `---\nname: ${name}\n${frontmatter}---\n<!-- section:field -->\n**thing**: Arguments\n`);
  }
  return dir;
}

const compile = { packDir: os.tmpdir(), importModule: async () => ({}) };

const typesOf = (records: Array<Record<string, unknown>>) =>
  Object.fromEntries(records.map(record => [record.name, record.documentType]));

it('defaults a document in the commands source to a command list, and takes what one declares', async () => {
  const { records } = await commandsCompiler.compile(source([['quiet', ''], ['declared', 'type: notes\n']]), compile);

  expect(typesOf(records)).toEqual({ quiet: 'commands', declared: 'notes' });
});

it('leaves a document untyped unless it says what it is', async () => {
  const { records } = await documentsCompiler.compile(source([['plain', ''], ['claimed', 'type: commands\n']]), compile);

  // The one the goal exists for: a command is a document with a type, so a document that declares it is
  // served beside the pack's own without living in the commands source
  expect(typesOf(records)).toEqual({ plain: undefined, claimed: 'commands' });
});

it('compiles folders into collections holding their documents, with sections parsed out of the markdown', async () => {
  const dir = source([]);
  fs.mkdirSync(path.join(dir, 'guides'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'media'));
  fs.writeFileSync(path.join(dir, 'guides/_meta.md'), '---\nname: Guides\ndescription: How to\n---\n');
  fs.writeFileSync(path.join(dir, 'guides/start.md'), '---\nname: Start\ntags: [intro]\n---\n<!-- section:list -->\n- one\n- two\n');
  // The source's media directory is copied beside the records, not compiled into a collection
  fs.writeFileSync(path.join(dir, 'media/pic.png'), 'PNG');

  const { records } = await documentsCompiler.compile(dir, compile);

  expect(records).toEqual([{
    entity: 'Collection', name: 'Guides', description: 'How to', contentHash: expect.any(String),
    children: [{
      entity: 'Document', name: 'Start', tags: ['intro'], content: [{ type: 'list', items: ['one', 'two'] }],
      contentHash: expect.any(String),
    }],
  }]);
});
