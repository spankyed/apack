// Builds a workspace package's dist/ with tsc: ESM and declarations, no source maps (src doesn't ship).
// @apackdev/ears and @apackdev/sdk are built exactly alike, so they share this script the way the bundled
// packages share bundle-package.ts:
//
//   tsx ../../scripts/build-package.ts .        (from the package directory)
//
// Its package.json is what the published manifest is derived from: its exports resolve source under the
// @apackdev/source condition (the repo's own configs) and dist otherwise, and `stagePublishTree` writes the
// tree npm publishes into publish/, without the branches a tarball cannot satisfy. Relative imports name the .ts
// source and tsc rewrites them to .js (rewriteRelativeImportExtensions), so the emitted JS resolves in
// Node and in bundlers as is.
//
// It lives here rather than in each package because it reads the repo's build rule
// (@apackdev/host/build/packages-built), and a package's own scripts import no package above their layer.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { BareImports, assertExportTargetsBuilt, isDeclaration, rewriteDeclarationExtensions, walk } from './lib/published-imports.ts';
import { runPackageBuild } from '@apackdev/host/build/packages-built';
import { replaceDir } from '@apackdev/host/replace-dir';
import { stagePublishTree } from '@apackdev/host/build/published-manifest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const pkgDir = path.resolve(process.argv[2] ?? '');
const srcDir = path.join(pkgDir, 'src');
const outDir = path.join(pkgDir, 'dist');
/**
 * Built here and renamed over `dist` at the end, so a reader never finds the package unbuilt: every consumer
 * of a derived tree in this repo treats a missing output as *not built*, and clearing `dist` first published
 * ~14s in which that was the answer. Inside the package, so the rename cannot cross a filesystem, and under
 * `.temp/` because that is already gitignored for every package — a staging directory `git` reports is what
 * the root `.gitignore`'s `*.bundled_*` entry exists for.
 */
const stagedDir = path.join(pkgDir, '.temp', 'build');

async function main(): Promise<void> {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
  fs.rmSync(stagedDir, { recursive: true, force: true });
  fs.mkdirSync(stagedDir, { recursive: true });

  // `--outDir` overrides the tsconfig's, and `rootDir` is `src` either way, so the emitted layout is the same
  execFileSync(
    process.execPath,
    [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', path.join(pkgDir, 'tsconfig.package.json'), '--outDir', stagedDir],
    { stdio: 'inherit' },
  );

  if (pkg.name === '@apackdev/ears') {
    // Native code is built only by package production, never by opening a database. Keep compiler
    // intermediates/absolute command provenance outside the published tree.
    const graphBuild = path.join(pkgDir, '.temp', 'native-graphs');
    fs.rmSync(graphBuild, { recursive: true, force: true });
    execFileSync(process.execPath, [path.join(repoRoot, 'native', 'graphs', 'build.mjs'), graphBuild], { stdio: 'inherit' });
    const graphDestination = path.join(stagedDir, 'sqlite', 'graph');
    fs.mkdirSync(graphDestination, { recursive: true });
    for (const file of ['ears_graph.js', 'ears_graph_bg.wasm', 'manifest.json', 'LICENSES.txt', 'package.json'])
      fs.copyFileSync(path.join(graphBuild, file), path.join(graphDestination, file));
    const nativeBuild = path.join(pkgDir, '.temp', 'native-vectors');
    fs.rmSync(nativeBuild, { recursive: true, force: true });
    execFileSync(process.execPath, [path.join(repoRoot, 'native', 'vectors', 'build.mjs'), nativeBuild], { stdio: 'inherit' });
    const provenance = JSON.parse(fs.readFileSync(path.join(nativeBuild, 'provenance.json'), 'utf8'));
    const destination = path.join(stagedDir, 'sqlite', 'native', `${process.platform}-${process.arch}`);
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(provenance.extension, path.join(destination, path.basename(provenance.extension)));
    fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({
      format: 1, platform: provenance.platform, arch: provenance.arch,
      upstream: provenance.upstream.commit, sourceSha256: provenance.sourceSha256,
      patchSha256: provenance.patchSha256, headersPackage: provenance.headersPackage,
      extensionSha256: provenance.extensionSha256,
    }, null, 2) + '\n');
    const upstream = fs.readFileSync(path.join(repoRoot, 'native', 'vectors', 'upstream.c'), 'utf8');
    fs.writeFileSync(path.join(destination, 'LICENSE'), upstream.slice(0, upstream.indexOf('*/') + 2) + '\n');
  }

  // Hand-written declarations ship as source
  for (const file of walk(srcDir).filter((f) => f.endsWith('.d.ts'))) {
    const dest = path.join(stagedDir, path.relative(srcDir, file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
  }

  // rewriteRelativeImportExtensions rewrites the emitted JS but not the declarations beside it
  rewriteDeclarationExtensions(stagedDir);

  // Every shipped module's imports must be installable by a pack that uses it — declarations included,
  // because a type-only import is erased from the JS, so an undeclared dependency would ship unseen
  const bareImports = new BareImports(stagedDir);
  for (const file of walk(stagedDir).filter((f) => f.endsWith('.js') || isDeclaration(f))) {
    const contents = fs.readFileSync(file, 'utf-8');
    if (isDeclaration(file)) bareImports.fromDeclaration(contents, file);
    else await bareImports.fromModule(contents, 'js', path.dirname(file), file);
  }
  bareImports.assertDeclared(pkg, path.join(path.relative(repoRoot, pkgDir), 'package.json'));
  assertExportTargetsBuilt(pkgDir, pkg.exports, stagedDir);
  // Every check above has passed against the staged tree, so this is the moment it becomes the built one
  replaceDir(stagedDir, outDir);
  // What npm publishes: the derived manifest and a copy of what `files` names, checked against itself
  const treeDir = stagePublishTree(pkgDir, pkg);
  console.log(`Built ${pkg.name}@${pkg.version} into ${path.relative(process.cwd(), outDir)}`
    + `, staged for publishing in ${path.relative(process.cwd(), treeDir)}`);
}

// The build's own success stamp: written only if main() returns, and cleared before it touches dist
await runPackageBuild(JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')).name, main);
