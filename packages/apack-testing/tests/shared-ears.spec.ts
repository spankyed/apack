// The harness fails early, naming both copies, when what a pack resolves as @apackdev/ears isn't the copy its
// @apackdev/sdk loads
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertSharedEars } from '../src/shared-ears.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function writePackage(dir: string, name: string, version: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
}

/** A pack with @apackdev/sdk 0.2.0 installed, and `ears` placing @apackdev/ears copies */
function pack(ears: { top?: string; nested?: string }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-shared-ears-'));
  dirs.push(root);
  writePackage(root, 'my-pack', '1.0.0');
  const modules = path.join(root, 'node_modules', '@apackdev');
  writePackage(path.join(modules, 'sdk'), '@apackdev/sdk', '0.2.0');
  if (ears.top) writePackage(path.join(modules, 'ears'), '@apackdev/ears', ears.top);
  if (ears.nested) writePackage(path.join(modules, 'sdk', 'node_modules', '@apackdev', 'ears'), '@apackdev/ears', ears.nested);
  return root;
}

describe('assertSharedEars', () => {
  it('accepts a pack whose @apackdev/sdk loads the pack\'s @apackdev/ears', () => {
    expect(() => assertSharedEars(pack({ top: '0.2.0' }))).not.toThrow();
  });

  it('names both copies when npm nested another @apackdev/ears under @apackdev/sdk', () => {
    expect(() => assertSharedEars(pack({ top: '0.1.0', nested: '0.2.0' })))
      .toThrow(/are different copies[\s\S]*remove @apackdev\/ears from the pack's dependencies/);
  });

  it('accepts a pack that resolves no @apackdev/ears, its @apackdev/sdk holding the one copy', () => {
    expect(() => assertSharedEars(pack({ nested: '0.2.0' }))).not.toThrow();
  });

  it('accepts the workspace layout the monorepo\'s fixture packs use', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-shared-ears-'));
    dirs.push(root);
    writePackage(root, 'fixture-pack', '1.0.0');
    fs.symlinkSync(path.resolve(__dirname, '..', '..', '..', '..', 'node_modules'), path.join(root, 'node_modules'), 'dir');
    expect(() => assertSharedEars(root)).not.toThrow();
  });
});
