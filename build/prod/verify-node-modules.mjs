#!/usr/bin/env node
// Fails when a packaged app ships a module without one of its declared dependencies.
// electron-builder's dependency collector once dropped 112 of them (e.g. nanoid under
// @ai-sdk/provider-utils) and the packaged API couldn't start; nothing failed at build time.
//
//   node build/prod/verify-node-modules.mjs "dist/mac-arm64/apack.app/Contents/Resources/app" [workspace]
//
// Also checked: the published packages bundled in the app (packages/*/dist/package, e.g. the
// CLI behind Resources/cli/apack), optional dependencies the build workspace installed
// for this platform (e.g. esbuild's native binary) but the app doesn't ship, and that the app
// holds one copy of each package it must load once (`single-copy.mjs`).
import fs from 'node:fs';
import path from 'node:path';
import { extraCopies } from './single-copy.mjs';

const appDir = path.resolve(process.argv[2] ?? '');
const workspaceDir = path.resolve(process.argv[3] ?? process.cwd());
if (!fs.existsSync(path.join(appDir, 'package.json'))) {
  console.error(`Not a packaged app dir: ${appDir}`);
  process.exit(2);
}

/** Every package.json under a node_modules tree, including nested node_modules. */
function* packages(nodeModules) {
  if (!fs.existsSync(nodeModules)) return;
  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const dirs = entry.name.startsWith('@')
      ? fs.readdirSync(path.join(nodeModules, entry.name)).map(n => path.join(nodeModules, entry.name, n))
      : [path.join(nodeModules, entry.name)];
    for (const dir of dirs) {
      if (fs.existsSync(path.join(dir, 'package.json'))) yield dir;
      yield* packages(path.join(dir, 'node_modules'));
    }
  }
}

/** Node's lookup: node_modules/<name> in the package dir, then each parent up to the app. */
function resolvable(fromDir, name) {
  for (let dir = fromDir; dir.startsWith(appDir); dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'node_modules', name, 'package.json'))) return true;
    if (dir === appDir) break;
  }
  return false;
}

const missing = [];
// Type-only; electron-builder.mjs excludes node_modules/@types on purpose. It is which *package* is not
// shipped, not which field declared it, so it has to hold for optional dependencies too: `dompurify`
// declares `@types/trusted-types` as one, and nothing at run time requires either.
const typesOnly = (name) => name.startsWith('@types/');
function check(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (typesOnly(name)) continue;
    if (!resolvable(dir, name)) missing.push(`${path.relative(appDir, dir)} → ${name}`);
  }
  for (const name of Object.keys(pkg.optionalDependencies ?? {})) {
    if (typesOnly(name)) continue;
    // Installed for this platform when the app was built, so the app needs it too
    const installed = fs.existsSync(path.join(workspaceDir, 'node_modules', name, 'package.json'));
    if (installed && !resolvable(dir, name)) missing.push(`${path.relative(appDir, dir)} → ${name} (optional, installed for this platform)`);
  }
}

const packagesDir = path.join(appDir, 'packages');
const workspacePackages = fs.existsSync(packagesDir) ? fs.readdirSync(packagesDir).map(p => path.join(packagesDir, p)) : [];
const installed = [];
for (const root of [path.join(appDir, 'node_modules'), ...workspacePackages.map(p => path.join(p, 'node_modules'))]) {
  for (const dir of packages(root)) {
    check(dir);
    const { name } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    installed.push({ name, copy: fs.realpathSync(dir), where: path.relative(appDir, dir) });
  }
}
for (const bundled of workspacePackages.map(p => path.join(p, 'dist', 'package'))) {
  if (fs.existsSync(path.join(bundled, 'package.json'))) check(bundled);
}

const duplicated = extraCopies(installed);
if (missing.length > 0) {
  console.error(`Packaged app is missing ${missing.length} declared dependencies:\n${missing.map(m => `  ${m}`).join('\n')}`);
}
if (duplicated.length > 0) console.error(`Packaged app holds more than one copy of a package it loads once:\n${duplicated.map(m => `  ${m}`).join('\n')}`);
if (missing.length > 0 || duplicated.length > 0) process.exit(1);
console.log('Packaged node_modules: every declared dependency is present, and one copy of each package loaded once');
