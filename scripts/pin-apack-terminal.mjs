// Pins the app to an apack-terminal commit: its source, and the release build of it the app runs.
//
//   node scripts/pin-apack-terminal.mjs <commit>     (npm run pin:apack-terminal -- <commit>)
//
// **One pin, written in its two places at once.** `vendor/apack-terminal.rev` is the commit the checkout the app
// compiles against is held to (the protocol's types, the view); `packages/terminal-broker/src/pin.json` is the same
// commit with the SHA-256 of each file its release `bin-<commit>` publishes, per platform, which is what the
// install verifies the broker it downloads against (`fetch-terminal-broker.mjs`). The sums are copied from the
// release's `SHA256SUMS`, so a commit apack-terminal's `binaries.yml` has not published is refused here, naming
// the dispatch that publishes one.
//
// It then fetches this platform's files, so a pin that cannot be installed is found now rather than by the next
// person to install.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PACKAGE_DIR, RELEASES, fetchTerminalBroker } from './fetch-terminal-broker.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The pin a release's `SHA256SUMS` describes: each line `<sha256>  <platform>__<file>`, grouped by platform.
 * Refuses a list it cannot read in full, since a pin missing a file is one whose install lacks it.
 * @param {string} commit @param {string} sums
 * @returns {{ commit: string, files: Record<string, Record<string, string>> }}
 */
export function pinFromSums(commit, sums) {
  /** @type {Record<string, Record<string, string>>} */
  const files = {};
  for (const line of sums.split('\n').map((text) => text.trim()).filter((text) => text !== '')) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+?)__(\S+)$/.exec(line);
    if (!match) throw new Error(`SHA256SUMS of ${commit} has a line that is not <sha256>  <platform>__<file>: ${line}`);
    const [, sha, platform, file] = match;
    (files[platform] ??= {})[file] = sha;
  }
  if (Object.keys(files).length === 0) throw new Error(`SHA256SUMS of ${commit} lists no files`);
  return { commit, files };
}

/** @param {string} ref */
async function pin(ref) {
  if (!/^[0-9a-f]{40}$/.test(ref)) {
    throw new Error(`pin a commit by its full 40-character hash, not ${JSON.stringify(ref)}: a release is named for one`);
  }
  const url = `${RELEASES}/bin-${ref}/SHA256SUMS`;
  const answer = await fetch(url, { redirect: 'follow' });
  if (!answer.ok) {
    throw new Error(`${url} answered ${answer.status}: apack-terminal has published no build of ${ref}. Publish one with `
      + `\`gh workflow run binaries.yml --repo spankyed/apack-terminal -f commit=${ref}\`, then pin again`);
  }
  const pinned = pinFromSums(ref, await answer.text());
  fs.writeFileSync(path.join(PACKAGE_DIR, 'src', 'pin.json'), `${JSON.stringify(pinned, null, 2)}\n`);
  fs.writeFileSync(path.join(ROOT, 'vendor', 'apack-terminal.rev'), `${ref}\n`);
  console.log(`pinned apack-terminal ${ref.slice(0, 7)}: ${Object.keys(pinned.files).join(', ')}`);
  await fetchTerminalBroker();
  console.log('the checkout the app compiles against has to hold the pin: check it out there, then `npm run link:apack-terminal`');
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [ref] = process.argv.slice(2);
  pin(ref ?? '').catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
