// default-setup's notes format: frontmatter values the old notes compiler normalized
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { compileBuiltinFormat } from '@apackdev/pack-build';

const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../../apack.json'), 'utf-8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-format-'));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

it('stores an empty or missing icon as null', () => {
  fs.writeFileSync(path.join(dir, 'a.md'), '---\ntitle: A\nicon: ""\n---\n');
  fs.writeFileSync(path.join(dir, 'b.md'), '---\ntitle: B\nicon:\n---\n');
  fs.writeFileSync(path.join(dir, 'c.md'), '---\ntitle: C\n---\n');
  fs.writeFileSync(path.join(dir, 'd.md'), '---\ntitle: D\nicon: "📌"\n---\n');
  const records = compileBuiltinFormat('notes', manifest.content!.formats.notes, dir);
  expect(records.map((record) => [record.title, record.icon])).toEqual([['A', null], ['B', null], ['C', null], ['D', '📌']]);
});
