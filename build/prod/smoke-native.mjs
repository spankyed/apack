#!/usr/bin/env node
// Fails when a packaged app can't load one of its native modules in its own runtime. A module can be present —
// verify-node-modules.mjs checks that — and still not load: a binary built for another ABI, platform or
// architecture throws only when something requires it, which in a packaged app is the API at boot, after release.
//
//   node build/prod/smoke-native.mjs "dist/mac-arm64/apack.app/Contents/Resources/app"
//
// It runs a probe in the app's own executable as Node (ELECTRON_RUN_AS_NODE=1, as the app starts its API),
// resolving each module from packages/api as the API does:
//   elmdb             opens a database in a temp dir, writes its schema, closes, opens it again and reads it back
//   EARS SQLite       writes/reopens and queries FTS, Rust regex/WASM and native vector assets
//   node-pty          spawns a shell and waits for it to exit
//   @napi-rs/keyring  loads its binding, without touching the credential store
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const appDir = path.resolve(process.argv[2] ?? '');
if (!fs.existsSync(path.join(appDir, 'package.json'))) {
  console.error(`Not a packaged app dir: ${appDir}`);
  process.exit(2);
}

/** Files beside a Windows or Linux app's executable that are Electron's own, not the app */
const ELECTRON_OWN = /^(chrome-sandbox|chrome_crashpad_handler|Uninstall .*\.exe|elevate\.exe|.*\.(dll|so(\.\d+)*|pak|bin|dat|json|dylib|txt|html))$|^LICENSE/;

/** The app's executable, from where electron-builder puts the app dir on each platform */
function findExecutable() {
  if (process.platform === 'darwin') {
    // <name>.app/Contents/Resources/app → <name>.app/Contents/MacOS/<productName>
    const { productName } = JSON.parse(fs.readFileSync(path.join(appDir, 'build-manifest.json'), 'utf-8'));
    return path.join(appDir, '..', '..', 'MacOS', productName);
  }
  // <platform>-unpacked/resources/app → <platform>-unpacked/<executable>
  const unpacked = path.join(appDir, '..', '..');
  if (process.platform === 'win32') {
    const { productName } = JSON.parse(fs.readFileSync(path.join(appDir, 'build-manifest.json'), 'utf-8'));
    return path.join(unpacked, `${productName}.exe`);
  }
  // Linux names the executable after the package by default, so take the one file there that is the app
  const candidates = fs.readdirSync(unpacked, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !ELECTRON_OWN.test(entry.name))
    .filter((entry) => (fs.statSync(path.join(unpacked, entry.name)).mode & 0o111) !== 0)
    .map((entry) => entry.name);
  if (candidates.length !== 1) throw new Error(`Expected one app executable in ${unpacked}, found: ${candidates.join(', ') || 'none'}`);
  return path.join(unpacked, candidates[0]);
}

const PROBE = String.raw`
const { createRequire } = require('node:module');
const path = require('node:path');
const [appDir, dataDir] = process.argv.slice(2);
const load = createRequire(path.join(appDir, 'packages', 'api', 'package.json'));
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

async function main() {
  const { Database } = load('elmdb');
  const at = path.join(dataDir, 'elmdb');
  let db = Database.open(at);
  db.setSchema({ $schema: 'https://elmdb.dev/schema/1.json', roles: {}, relations: {}, types: { Smoke: { fields: {}, additionalFields: 'allow', indexes: {} } } });
  db.close();
  db = Database.open(at, { readOnly: true });
  const read = db.schema;
  db.close();
  if (!read?.types?.Smoke) throw new Error('elmdb read back the schema ' + JSON.stringify(read) + ' after reopening');
  console.log('elmdb: wrote, closed, reopened and read back');

  const { openDatabase } = await import(pathToFileURL(load.resolve('@apackdev/ears/sqlite')).href);
  const { createEarsEngine } = await import(pathToFileURL(load.resolve('@apackdev/ears')).href);
  const sqlitePath = path.join(dataDir, 'sqlite');
  const schema = { types: { Smoke: { required: [], substrings: ['title'], search: { fields: { title: 1 } },
    embed: { from: ['title'], model: 'smoke', dims: 3 } } }, relations: {}, roles: [] };
  let sqlite = openDatabase({ path: sqlitePath, schema, syncs: false });
  const verifySqlite = () => {
    const engine = createEarsEngine({ database: sqlite });
    assert.deepEqual(engine.query('Smoke').matching('^alpha').ids(), ['Smoke-alpha']);
    assert.deepEqual(engine.query('Smoke').containing('beta').ids(), ['Smoke-beta']);
    assert.deepEqual(engine.query('Smoke').search('alpha', { fuzzy: false }).ids(), ['Smoke-alpha']);
    assert.deepEqual(engine.query('Smoke').near([1, 0, 0], { k: 1 }).ids(), ['Smoke-alpha']);
  };
  try {
    const engine = createEarsEngine({ database: sqlite });
    engine.create('Smoke', { id: 'Smoke-alpha', title: 'alpha marker' });
    engine.create('Smoke', { id: 'Smoke-beta', title: 'beta marker' });
    const { model, chunks } = engine.pendingEmbeddings('Smoke');
    engine.embed(chunks.map(chunk => ({ ...chunk, model, vector: chunk.id === 'Smoke-alpha' ? [1, 0, 0] : [0, 1, 0] })));
    verifySqlite();
  } finally { sqlite.close(); }
  sqlite = openDatabase({ path: sqlitePath, readOnly: true });
  try { verifySqlite(); } finally { sqlite.close(); }
  console.log('EARS SQLite: wrote, reopened read-only, verified FTS, regex/WASM and native vectors');

  const pty = load('node-pty');
  const [shell, args] = process.platform === 'win32' ? ['cmd.exe', ['/c', 'exit 0']] : ['/bin/sh', ['-c', 'exit 0']];
  const exit = await new Promise((resolve) => pty.spawn(shell, args, { cols: 80, rows: 24 }).onExit(resolve));
  if (exit.exitCode !== 0) throw new Error('node-pty: the shell exited ' + JSON.stringify(exit));
  console.log('node-pty: spawned a shell, which exited 0');

  const { Entry } = load('@napi-rs/keyring');
  if (typeof Entry !== 'function') throw new Error('@napi-rs/keyring has no Entry');
  console.log('@napi-rs/keyring: binding loaded');
}
main().catch((error) => { console.error(error?.stack ?? String(error)); process.exit(1); });
`;

const executable = findExecutable();
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-smoke-native-'));
try {
  const probe = path.join(work, 'probe.cjs');
  fs.writeFileSync(probe, PROBE);
  const dataDir = path.join(work, 'data');
  fs.mkdirSync(dataDir);
  const { stdout } = await promisify(execFile)(executable, [probe, appDir, dataDir], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 60_000,
  });
  process.stdout.write(stdout);
  console.log(`Packaged native modules: each one loads in ${path.basename(executable)}`);
} catch (error) {
  console.error(`Packaged native modules failed to load in ${executable}:\n${error.stderr || error.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
