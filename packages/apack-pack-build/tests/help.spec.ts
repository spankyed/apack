import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileHelp } from '../src/help.ts';
import { generatePackFiles } from '../src/generate-entries.ts';
import type { PackManifest } from '@apackdev/pack-format';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-help-')); dirs.push(root);
  fs.mkdirSync(path.join(root, 'src/extensions/help'), { recursive: true });
  for (const [name, text] of Object.entries(files)) { const file = path.join(root, 'src/extensions/help', name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
  const manifest: PackManifest = { id: 'test-pack', name: 'Test', version: '1.0.0', features: { code: { description: 'Work with code.' } }, extensions: { help: { path: 'src/extensions/help' } } };
  return { root, manifest };
}
describe('Markdown help compilation', () => {
  it('bundles nested articles, metadata and resolved inline/reference links without a runtime loader', async () => {
    const { root, manifest } = fixture({
      'start.md': '---\nid: welcome\nfeatures: [code]\norder: 1\n---\n# Welcome\n\n[Next](nested/next.md)\n\n[More][next]\n[next]: nested/next.md',
      'nested/next.md': '# Next\nDetails',
    });
    const articles = compileHelp(root, manifest);
    expect(articles.find(a => a.id === 'welcome')).toMatchObject({ title: 'Welcome', features: ['code'], order: 1 });
    expect(articles.find(a => a.id === 'welcome')!.body).toContain('https://help.apack.invalid/test-pack/nested%2Fnext');
    const files = await generatePackFiles(manifest, { packRoot: root });
    expect(files['src/__generated__/pack-entry.ts']).not.toContain('Welcome');
    fs.rmSync(path.join(root, 'src/extensions/help'), { recursive: true });
    expect(articles.find(article => article.id === 'nested/next')!.body).toContain('Details');
  });
  it.each([
    ['empty H1', { 'a.md': '#  \nBody text' }, /H1/],
    ['missing H1', { 'a.md': 'No title' }, /H1/],
    ['duplicate ID', { 'a.md': '---\nid: same\n---\n# A', 'b.md': '---\nid: same\n---\n# B' }, /duplicate/],
    ['inherited feature name', { 'a.md': '---\nfeatures: [toString]\n---\n# A' }, /features/],
    ['unknown feature', { 'a.md': '---\nfeatures: [missing]\n---\n# A' }, /features/],
    ['bad order', { 'a.md': '---\norder: later\n---\n# A' }, /order/],
    ['broken link', { 'a.md': '# A\n[Missing](missing.md)' }, /help link/],
  ])('rejects %s with an actionable source error', (_label, files, error) => {
    const { root, manifest } = fixture(files as Record<string, string>);
    expect(() => compileHelp(root, manifest)).toThrow(error as RegExp);
  });
  it('rejects absent directories and symlinks', () => {
    const { root, manifest } = fixture({});
    fs.symlinkSync(os.tmpdir(), path.join(root, 'src/extensions/help/escape'));
    expect(() => compileHelp(root, manifest)).toThrow(/symbolic/);
    fs.rmSync(path.join(root, 'src/extensions/help'), { recursive: true });
    expect(() => compileHelp(root, manifest)).toThrow(/must exist/);
  });
  it('preserves fenced examples instead of resolving their example links', () => {
    const { root, manifest } = fixture({ 'a.md': '# A\n```md\n[Example](missing.md)\n```' });
    expect(compileHelp(root, manifest)[0].body).toContain('[Example](missing.md)');
  });
  it('keeps inline and indented code examples literal, including links to nonexistent example files', () => {
    const { root, manifest } = fixture({ 'a.md': '# A\n\n`[Example](missing.md)`\n\n    [Example](missing.md)' });
    expect(compileHelp(root, manifest)[0].body).toContain('[Example](missing.md)');
  });
  it('resolves real Markdown links with angle brackets and titles', () => {
    const { root, manifest } = fixture({
      'a.md': '# A\n\n[**Next**](<next.md> "Read next")\n\n[Reference][next]\n\n[next]: <next.md> "Read next"',
      'next.md': '# Next\nDetails',
    });
    const body = compileHelp(root, manifest).find(a => a.id === 'a')!.body;
    expect(body.match(/https:\/\/help\.apack\.invalid\/test-pack\/next/g)).toHaveLength(2);
    expect(body).toContain('**Next**');
    expect(body).toContain('Read next');
  });
  it('uses the plain heading text as the title, removing Markdown formatting and closing heading markers', () => {
    const { root, manifest } = fixture({ 'a.md': '# A **formatted** `title` #\nDetails' });
    expect(compileHelp(root, manifest)[0]).toMatchObject({ title: 'A formatted title', body: 'Details' });
  });

});
