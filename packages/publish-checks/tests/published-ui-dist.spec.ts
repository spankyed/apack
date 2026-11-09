import * as fs from 'node:fs';
import * as path from 'node:path';
import { population } from '@apackdev/sdk/testing';
import { describe, expect, it } from 'vitest';
import { packagesBuiltOrRefuse, REPO_ROOT } from '@apackdev/host/build/packages-built';

/** Skips without built packages, and refuses rather than reading a stale `dist` */
const PACKAGES_BUILT = packagesBuiltOrRefuse('npm run packages:build (or npm test -w @app/publish-checks, which builds them)');

/** @apackdev/ui's build: compiled modules only, and each module's state defined once. */
const UI_DIST = path.join(REPO_ROOT, 'packages', 'apack-ui', 'dist');
const walk = (dir: string) => fs.readdirSync(dir, { recursive: true, encoding: 'utf-8' }).map((file) => path.join(dir, file));

describe.skipIf(!PACKAGES_BUILT)('@apackdev/ui dist', () => {
  it('ships compiled modules, not SFC source', () => {
    const files = walk(UI_DIST).map((file) => path.relative(UI_DIST, file));
    expect(files.filter((file) => file.endsWith('.vue'))).toEqual([]);
    expect(files).toContain('components/tiptap/TiptapEditor.js');
  });

  it('ships CSS with no relative @import left to resolve', () => {
    // The CSS is the population. The other two cases here anchor on a file that must be present, so an empty
    // walk fails them; this one filters, and would pass over a build that emitted no stylesheet.
    const unresolved = population('@apackdev/ui\'s published CSS', walk(UI_DIST).filter((file) => file.endsWith('.css')))
      .filter((file) => /@import\s+(url\()?["']\.{1,2}\//.test(fs.readFileSync(file, 'utf-8')))
      .map((file) => path.relative(UI_DIST, file));
    expect(unresolved).toEqual([]);
  });

  it('defines a module several entries import in exactly one file', () => {
    // Follow the public entry to its state owner; shared chunks may have content-derived filenames.
    const definitions = walk(UI_DIST)
      .filter((file) => file.endsWith('.js'))
      .filter((file) => /\binitializedLanguages\s*=\s*(?:\/\* @__PURE__ \*\/\s*)?new Set\(/.test(fs.readFileSync(file, 'utf-8')))
      .map((file) => path.relative(UI_DIST, file));
    const entry = path.join(UI_DIST, 'components/monaco-config.js');
    const target = fs.readFileSync(entry, 'utf8').match(/from ["']([^"']+)["']/)?.[1];
    expect(target).toBeDefined();
    expect(definitions).toEqual([path.relative(UI_DIST, path.resolve(path.dirname(entry), target!))]);
  });
});
