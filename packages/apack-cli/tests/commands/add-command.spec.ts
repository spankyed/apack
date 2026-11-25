// `apack pack add command` and `add document` both write a markdown document into a content source — the
// friction they remove is the directory, the source declaration and the frontmatter convention, none of which
// is the thing being added. They share `content-document.ts`; what differs is the SDK content key and the body.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { ManifestSchema } from '@apackdev/pack-format';
import { addCommand } from '../../src/commands/add/command.ts';
import { addDocument } from '../../src/commands/add/document.ts';

function pack(manifest: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'add-command-'));
  fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify({ id: 'memo-pack', name: 'Memos', version: '1.0.0', ...manifest }));
  return root;
}
const manifestOf = (root: string) => JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf-8'));
const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf-8');

// The key is the SDK's, so a pack with no dependencies at all can ship a command
it("declares the SDK's commands source, and writes the document", async () => {
  const root = pack({});

  await addCommand(['standup', '--placeholder', 'Topic'], root);

  const manifest = manifestOf(root);
  expect(manifest.content.sources.commands).toBe('src/content/commands');
  expect(ManifestSchema.safeParse(manifest).success).toBe(true);
  expect(read(root, 'src/content/commands/commands.md')).toBe(
    '---\nname: Commands\n---\n<!-- section:field -->\n**standup**: Topic\n');
});

// The source is the declaration, so a second command joins the entry that already compiles command
// documents, wherever it keeps them, rather than declaring another one
it('writes a second document into the source already declared', async () => {
  const root = pack({ content: { sources: { commands: { path: 'src/content/slash', onUserEdit: 'offer' } } } });

  await addCommand(['retro', '--document', 'team'], root);

  expect(manifestOf(root).content.sources).toEqual({ commands: { path: 'src/content/slash', onUserEdit: 'offer' } });
  expect(read(root, 'src/content/slash/team.md')).toContain('**retro**: Arguments');
});

// A command is one line of a document, so a second one joins the field section rather than becoming a
// document of its own — which is what lets a caller add several without editing markdown in between
it('appends a command to a document that is already there', async () => {
  const root = pack({});
  await addCommand(['standup', '--placeholder', 'Topic'], root);

  await addCommand(['retro', '--placeholder', 'Sprint'], root);

  expect(read(root, 'src/content/commands/commands.md')).toBe(
    '---\nname: Commands\n---\n<!-- section:field -->\n**standup**: Topic\n**retro**: Sprint\n');
});

// The field section's span ends where the next marker starts, so the line lands inside it
it('appends inside the field section of a document that has others', async () => {
  const root = pack({});
  const file = path.join(root, 'src/content/commands/commands.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '---\nname: Commands\n---\n<!-- section:field -->\n**standup**: Topic\n\n<!-- section:text -->\nNotes.\n');

  await addCommand(['retro'], root);

  expect(read(root, 'src/content/commands/commands.md')).toBe(
    '---\nname: Commands\n---\n<!-- section:field -->\n**standup**: Topic\n**retro**: Arguments\n<!-- section:text -->\nNotes.\n');
});

it('refuses a command the document already defines', async () => {
  const root = pack({});
  await addCommand(['standup'], root);

  await expect(addCommand(['standup'], root)).rejects.toThrow('already defines "/standup"');
});

// A document with no field section holds no commands, so the caller means a different document
it('refuses a document with no field section', async () => {
  const root = pack({});
  const file = path.join(root, 'src/content/commands/commands.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '---\nname: Commands\n---\n<!-- section:text -->\nProse only.\n');

  await expect(addCommand(['retro'], root)).rejects.toThrow(/no .*section:field.* section/);
});

// Default-setup's own command documents live a folder down, so the scaffold has to be able to put one there
it('nests a document in the folder it is given, which the compiler reads as a collection', async () => {
  const root = pack({});

  await addCommand(['standup', '--folder', 'internal'], root);

  expect(read(root, 'src/content/commands/internal/commands.md')).toContain('**standup**: Arguments');
});

it('refuses a folder that is not a name', async () => {
  const root = pack({});

  await expect(addCommand(['standup', '--folder', '../escaped'], root)).rejects.toThrow(/Folder name must be lowercase/);
});

it("writes a document through the same source resolution, and declares the SDK's documents source", async () => {
  const root = pack({});

  await addDocument(['getting-started', '--folder', 'guides'], root);

  expect(manifestOf(root).content.sources.documents).toBe('src/content/documents');
  const body = read(root, 'src/content/documents/guides/getting-started.md');
  expect(body).toContain('name: Getting Started');
  expect(body).toContain('<!-- section:text -->');
});

// The two keys are separate entries, so adding one kind never declares the other's source
it('declares only the source for the kind being added', async () => {
  const root = pack({});

  await addDocument(['notes'], root);

  expect(Object.keys(manifestOf(root).content.sources)).toEqual(['documents']);
});

// These are mostly run by an agent, which has the content in hand: scaffolding boilerplate for it to edit
// afterwards would be two steps where one does
it('writes the body it is given, in the section it is given', async () => {
  const root = pack({});

  await addDocument(['runbook', '--content', 'Restart the API, then reload the pack.', '--section', 'code'], root);

  expect(read(root, 'src/content/documents/runbook.md')).toBe(
    '---\nname: Runbook\ntags: [default]\n---\n<!-- section:code -->\nRestart the API, then reload the pack.\n');
});

// Without content it explains the convention instead, which is what a person opening the file needs
it('explains the section convention when given no body', async () => {
  const root = pack({});

  await addDocument(['notes'], root);

  expect(read(root, 'src/content/documents/notes.md')).toContain('A `<!-- section:<type> -->` marker starts a section');
});
