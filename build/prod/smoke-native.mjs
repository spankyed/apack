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
//   @napi-rs/keyring  loads its binding, without touching the credential store
//
//   apack-terminal    runs the broker binary the package ships, and sees it bind a socket
//
// **The broker is a binary rather than a module, so its probe is a spawn.** A pty belongs to the
// `apack-terminal` broker, which the app starts as a child process; what can be wrong with it is what can
// be wrong with any binary in a release — built for another architecture, or not carried into the package
// at all, which is what a packaged app had before that package existed. Both show up the same way: it does
// not start.
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


  const { Entry } = load('@napi-rs/keyring');
  if (typeof Entry !== 'function') throw new Error('@napi-rs/keyring has no Entry');
  console.log('@napi-rs/keyring: binding loaded');


  // **Run it with no arguments, which is the whole probe.** The broker answers that with its usage and
  // exit 2, so this needs no socket, no timing and no cleanup -- and what it proves is the thing that can
  // be wrong in a release: a binary built for another architecture never reaches its own argument check,
  // and one the package did not carry is not there to run. Asked of the package, not of a path, because
  // the name carries .exe on Windows and the package is what knows that.
  const broker = load('apack-terminal').brokerBinary();
  if (!broker) throw new Error('the apack-terminal package carries no binary for this platform');
  const ran = require('node:child_process').spawnSync(broker, [], { encoding: 'utf8' });
  if (ran.error) throw new Error('apack-terminal did not run: ' + ran.error.message);
  if (ran.status !== 2 || !/usage: apack-terminal/.test(ran.stderr || '')) {
    throw new Error('apack-terminal answered ' + ran.status + ' and ' + JSON.stringify(ran.stderr) + ', not its usage');
  }
  console.log('apack-terminal: the broker binary runs');
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
  // Preserve completed stage witnesses even when a later load hangs or exits. The final error message
  // alone can be empty for a terminated Windows GUI-subsystem executable.
  if (error.stdout) process.stdout.write(error.stdout);
  console.error('Packaged native process outcome: ' + JSON.stringify({
    code: error.code, signal: error.signal, killed: error.killed,
  }));
  console.error(`Packaged native modules failed to load in ${executable}:\n${error.stderr || error.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
