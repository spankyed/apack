import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewPackContent } from '../../src/content/preview.ts';
import type { ContentApplier } from '../../src/utils/apply.ts';
import { startTestRuntime, testPacks } from '../../src/testing/index.ts';

// The registered packs' appliers: the stand-in's, which the specs fill
startTestRuntime();

const noopApplier = (key: string): ContentApplier => ({ key, apply: () => ({ created: 0, updated: 0, skipped: 0 }) });

let root: string | undefined;
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
  testPacks.appliers.delete('demo');
  vi.restoreAllMocks();
});

function writeDemoIndex(): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-preview-'));
  const out = path.join(root, 'dist');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'content.json'), JSON.stringify({
    version: 1,
    packId: 'demo',
    entries: [
      { key: 'glossary', written: true, identity: ['term'], count: 3, items: [{ key: 'Pack', description: 'A bundle' }, { key: 'Content', childCount: 1 }] },
      { key: 'notes', written: true, identity: ['term'], count: 1, items: [{ key: 'Note' }] },
      { key: 'faqs', written: false, count: 1, items: [{ key: '' }] },
    ],
  }));
  return out;
}

describe('previewPackContent', () => {
  it("lists the written keys the compiling pack's appliers import, and their items, whatever the keys are", () => {
    const out = writeDemoIndex();
    testPacks.appliers.set('demo', [noopApplier('glossary')]);

    expect(previewPackContent(out)).toEqual({
      directory: out,
      packId: 'demo',
      content: { glossary: [{ key: 'Pack', description: 'A bundle' }, { key: 'Content', childCount: 1 }] },
      unavailable: ['notes'],
    });
  });

  it("fails when the compiling pack registered no appliers (it isn't installed)", () => {
    const out = writeDemoIndex();
    testPacks.appliers.set('other', [noopApplier('glossary')]);
    try {
      expect(() => previewPackContent(out)).toThrow(/Pack "demo" isn't installed/);
    } finally {
      testPacks.appliers.delete('other');
    }
  });

  it('fails for a directory without content.json', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-preview-'));
    expect(() => previewPackContent(root!)).toThrow(/has no content\.json/);
  });

  it('rejects malformed content.json entries/items and strips unknown fields', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-preview-'));
    testPacks.appliers.set('demo', [noopApplier('glossary')]);
    const write = (data: unknown) => fs.writeFileSync(path.join(root!, 'content.json'), JSON.stringify(data));

    write({ version: 1, packId: 'demo', entries: [
      { key: 'glossary', written: true, count: 1, items: [{ key: 'A' }] },
      { key: 'glossary', written: true, count: 1, items: [{ key: 'B' }] },
    ] });
    expect(() => previewPackContent(root!)).toThrow(/duplicate entry key/);

    write({ version: 1, packId: 'demo', entries: [{ key: 'glossary', written: true, count: -1, items: [] }] });
    expect(() => previewPackContent(root!)).toThrow(/malformed entry/);

    write({ version: 1, packId: 'demo', entries: [{ key: 'glossary', written: true, count: 1, items: [{ key: 123 }] }] });
    expect(() => previewPackContent(root!)).toThrow(/malformed item/);

    write({ version: 1, packId: 'demo', entries: [{ key: 'glossary', written: true, count: 1, items: [{ key: 'A', childCount: -2 }] }] });
    expect(() => previewPackContent(root!)).toThrow(/invalid childCount/);

    write({ version: 1, packId: 'demo', entries: [{ key: 'glossary', written: true, count: 1, items: [{ key: 'A', extra: 'secret' }] }] });
    expect(previewPackContent(root!).content.glossary).toEqual([{ key: 'A' }]);
  });
});
