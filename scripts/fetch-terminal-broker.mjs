// Downloads the terminal broker the app runs and verifies it against its pin:
//
//   node scripts/fetch-terminal-broker.mjs     (npm run fetch:terminal-broker; the install runs it, from postinstall)
//
// **A pinned, hashed artifact, the way this app already gets Electron.** `packages/terminal-broker/pin.json` names
// an apack-terminal commit and the SHA-256 of each of its files per platform, copied from that commit's release
// (`npm run pin:apack-terminal`). This fetches the files for the platform it runs on from the release
// `bin-<commit>`, refuses any whose bytes are not the pinned ones, and installs them in
// `packages/terminal-broker/bin/<commit>/<platform>/`, where the package's resolver looks. So what a developer's
// app, the tests and a packaged app run is the build that repository's CI made of that commit, byte for byte, and
// nothing here needs a Rust toolchain.
//
// Plain Node with no dependencies, since it runs at install. Files already there with the pinned bytes are left
// alone, so an install with nothing new to fetch reaches no network; other commits' directories are removed, so
// what a packaged app collects from `bin/` is this commit's alone.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The repository whose releases hold the broker's builds */
export const RELEASES = 'https://github.com/spankyed/apack-terminal/releases/download';

/** The package the broker is installed into, beside this script's repository root */
export const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'terminal-broker');

/** How many times a file is asked for, and the pause before the second ask, which doubles */
const ASKS = 4;
const FIRST_WAIT_MS = 5_000;

/**
 * The URL of one of a commit's release files: `<platform>__<file>`, a release having no folders
 * @param {string} commit @param {string} platform @param {string} file
 */
export const assetUrl = (commit, platform, file) => `${RELEASES}/bin-${commit}/${platform}__${file}`;

/** @param {Buffer} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * A file's bytes from the network, asked again a few times for a gateway that refuses for a while
 * @param {string} url @returns {Promise<Buffer>}
 */
async function download(url) {
  /** @type {unknown} */
  let last;
  for (let ask = 1; ask <= ASKS; ask += 1) {
    try {
      const answer = await fetch(url, { redirect: 'follow' });
      if (answer.ok) return Buffer.from(await answer.arrayBuffer());
      last = new Error(`${url} answered ${answer.status}`);
      // A file that is not there will not appear by asking again
      if (answer.status === 404) break;
    } catch (error) {
      last = error;
    }
    if (ask < ASKS) await new Promise((resolve) => setTimeout(resolve, FIRST_WAIT_MS * 2 ** (ask - 1)));
  }
  throw last;
}

/**
 * Installs this platform's pinned files, answering where they went, or `undefined` for a platform the pin has
 * none for — which is said, and is not a failure of the install, since nothing on that platform can run them.
 *
 * `fetchBytes` is the network, a parameter so a case can be the release.
 * @param {{ packageDir?: string, platform?: string, fetchBytes?: (url: string) => Promise<Buffer>, log?: (line: string) => void }} [options]
 * @returns {Promise<string | undefined>}
 */
export async function fetchTerminalBroker({ packageDir = PACKAGE_DIR, platform = `${process.platform}-${process.arch}`, fetchBytes = download, log = console.log } = {}) {
  /** @type {{ commit: string, files: Record<string, Record<string, string>> }} */
  const pin = JSON.parse(fs.readFileSync(path.join(packageDir, 'src', 'pin.json'), 'utf8'));
  const files = pin.files[platform];
  const bin = path.join(packageDir, 'bin');
  // Other commits go whether or not this platform has files: what is left is what this pin installs
  if (fs.existsSync(bin)) {
    for (const entry of fs.readdirSync(bin)) {
      if (entry !== pin.commit) fs.rmSync(path.join(bin, entry), { recursive: true, force: true });
    }
  }
  if (files === undefined) {
    log(`[terminal-broker] apack-terminal ${pin.commit.slice(0, 7)} has no build for ${platform}; terminals will not start here`);
    return undefined;
  }
  const directory = path.join(bin, pin.commit, platform);
  fs.mkdirSync(directory, { recursive: true });
  for (const [file, expected] of Object.entries(files)) {
    const into = path.join(directory, file);
    if (fs.existsSync(into) && sha256(fs.readFileSync(into)) === expected) continue;
    const url = assetUrl(pin.commit, platform, file);
    const bytes = await fetchBytes(url);
    const found = sha256(bytes);
    if (found !== expected) {
      throw new Error(`${url} is not the file packages/terminal-broker/src/pin.json pins: its SHA-256 is ${found}, not ${expected}`);
    }
    // Written beside and renamed into place, so an interrupted install leaves no partial file under the name
    const partial = `${into}.partial`;
    fs.writeFileSync(partial, bytes, { mode: 0o755 });
    fs.renameSync(partial, into);
    log(`[terminal-broker] ${file} of apack-terminal ${pin.commit.slice(0, 7)} for ${platform}`);
  }
  return directory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  fetchTerminalBroker().catch((error) => {
    console.error(`[terminal-broker] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
