// Packs type `services` (HostServices) from @apackdev/sdk/services. A package its declarations import that a pack
// may not have installed (an optional peer) silently turns those types into `any` under skipLibCheck, so every
// package they reach must be a dependency or a required peer of @apackdev/sdk.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { builtinModules } from 'node:module';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { packagesBuiltOrRefuse, REPO_ROOT } from '@apackdev/host/build/packages-built';
import { packageName } from '@apackdev/host/build/specifiers';

// Skips without built packages, and refuses rather than reading a stale `dist`
const PACKAGES_BUILT = packagesBuiltOrRefuse('npm run packages:build (or npm test -w @app/internal-publish-checks, which builds them)');

const SDK = path.join(REPO_ROOT, 'packages', 'apack-sdk');

/** Packages the declarations reachable from `entry` import, following relative imports */
function importedPackages(entry: string): Set<string> {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    for (const { fileName: specifier } of ts.preProcessFile(fs.readFileSync(file, 'utf-8')).importedFiles) {
      if (specifier.startsWith('.')) visit(path.resolve(path.dirname(file), specifier.replace(/\.(ts|js)$/, '.d.ts')));
      else if (!specifier.startsWith('node:') && !builtinModules.includes(specifier)) packages.add(packageName(specifier));
    }
  };
  visit(entry);
  return packages;
}

describe.skipIf(!PACKAGES_BUILT)('published @apackdev/sdk/services', () => {
  it('imports only packages every pack has installed: dependencies and required peers', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SDK, 'package.json'), 'utf-8'));
    const optional = new Set(Object.keys(manifest.peerDependenciesMeta ?? {}).filter((name) => manifest.peerDependenciesMeta[name].optional));
    const installed = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {}).filter((name) => !optional.has(name))]);

    const imported = importedPackages(path.join(SDK, 'dist', 'services', 'index.d.ts'));

    expect(imported).toContain('ai');
    expect([...imported].filter((name) => !installed.has(name))).toEqual([]);
  });
});
