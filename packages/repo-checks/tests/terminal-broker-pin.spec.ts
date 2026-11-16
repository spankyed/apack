// The terminal broker the app runs, as a pinned release build: what the install fetches and refuses
// (`scripts/fetch-terminal-broker.mjs`), how a release's sums become the pin (`scripts/pin-apack-terminal.mjs`),
// and what `@app/terminal-broker` answers for what is installed.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { assetUrl, fetchTerminalBroker } from '../../../scripts/fetch-terminal-broker.mjs';
import { pinFromSums } from '../../../scripts/pin-apack-terminal.mjs';

const COMMIT = 'a'.repeat(40);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

let dir: string | undefined;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A copy of the package, with a pin naming `files` for each platform */
function aPackage(files: Record<string, Record<string, string>>): string {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'terminal-broker-')));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.copyFileSync(path.join(REPO_ROOT, 'packages', 'terminal-broker', 'src', 'index.js'), path.join(dir, 'src', 'index.js'));
  fs.writeFileSync(path.join(dir, 'src', 'pin.json'), JSON.stringify({ commit: COMMIT, files }));
  return dir;
}

/** The release, as the network: each URL's bytes, and what was asked for */
function aRelease(bytes: Record<string, string>) {
  const asked: string[] = [];
  return {
    asked,
    fetchBytes: async (url: string) => {
      asked.push(url);
      if (!(url in bytes)) throw new Error(`${url} answered 404`);
      return Buffer.from(bytes[url]!);
    },
  };
}

const quiet = () => {};

describe('installing the pinned broker', () => {
  it('fetches each file the pin names for this platform from its release, and installs it under the commit', async () => {
    const pkg = aPackage({ 'win32-x64': { 'apack-terminal.exe': sha('binary'), 'conpty.dll': sha('conpty') } });
    const release = aRelease({
      [assetUrl(COMMIT, 'win32-x64', 'apack-terminal.exe')]: 'binary',
      [assetUrl(COMMIT, 'win32-x64', 'conpty.dll')]: 'conpty',
    });
    const into = await fetchTerminalBroker({ packageDir: pkg, platform: 'win32-x64', fetchBytes: release.fetchBytes, log: quiet });
    expect(into).toBe(path.join(pkg, 'bin', COMMIT, 'win32-x64'));
    expect(fs.readFileSync(path.join(into!, 'conpty.dll'), 'utf8')).toBe('conpty');
    expect(release.asked).toHaveLength(2);
  });

  /** The whole point of the pin: bytes that are not the pinned ones are refused, and nothing is installed */
  it('refuses a file whose bytes are not the ones the pin names', async () => {
    const pkg = aPackage({ 'linux-x64': { 'apack-terminal': sha('the pinned build') } });
    const release = aRelease({ [assetUrl(COMMIT, 'linux-x64', 'apack-terminal')]: 'something else' });
    await expect(fetchTerminalBroker({ packageDir: pkg, platform: 'linux-x64', fetchBytes: release.fetchBytes, log: quiet }))
      .rejects.toThrow(/is not the file packages\/terminal-broker\/src\/pin.json pins/);
    expect(fs.existsSync(path.join(pkg, 'bin', COMMIT, 'linux-x64', 'apack-terminal'))).toBe(false);
  });

  it('asks nothing of the network for a file already installed with the pinned bytes', async () => {
    const pkg = aPackage({ 'linux-x64': { 'apack-terminal': sha('built') } });
    const first = aRelease({ [assetUrl(COMMIT, 'linux-x64', 'apack-terminal')]: 'built' });
    await fetchTerminalBroker({ packageDir: pkg, platform: 'linux-x64', fetchBytes: first.fetchBytes, log: quiet });
    const second = aRelease({});
    await fetchTerminalBroker({ packageDir: pkg, platform: 'linux-x64', fetchBytes: second.fetchBytes, log: quiet });
    expect(second.asked).toEqual([]);
  });

  /** What a packaged app collects from `bin/` is this pin's alone */
  it("removes another commit's files", async () => {
    const pkg = aPackage({});
    fs.mkdirSync(path.join(pkg, 'bin', 'b'.repeat(40)), { recursive: true });
    await fetchTerminalBroker({ packageDir: pkg, platform: 'linux-x64', fetchBytes: aRelease({}).fetchBytes, log: quiet });
    expect(fs.readdirSync(path.join(pkg, 'bin'))).toEqual([]);
  });

  it('installs nothing, and says so, for a platform the pin has no build for', async () => {
    const pkg = aPackage({ 'linux-x64': { 'apack-terminal': sha('x') } });
    const said: string[] = [];
    expect(await fetchTerminalBroker({ packageDir: pkg, platform: 'freebsd-x64', fetchBytes: aRelease({}).fetchBytes, log: (line) => said.push(line) }))
      .toBeUndefined();
    expect(said.join('\n')).toMatch(/no build for freebsd-x64/);
  });
});

describe('what @app/terminal-broker answers', () => {
  const resolverOf = (pkg: string) => createRequire(path.join(pkg, 'src', 'index.js'))('./index.js') as { brokerBinary(): string | undefined; PLATFORM: string };

  /** A Windows binary without the ConPTY beside it runs on the system's, so a partial install is no broker */
  it('is the binary only once every file the pin names for this platform is installed', () => {
    const platform = `${process.platform}-${process.arch}`;
    const name = process.platform === 'win32' ? 'apack-terminal.exe' : 'apack-terminal';
    const pkg = aPackage({ [platform]: { [name]: sha('b'), 'companion': sha('c') } });
    const directory = path.join(pkg, 'bin', COMMIT, platform);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, name), 'b');
    expect(resolverOf(pkg).brokerBinary()).toBeUndefined();
    fs.writeFileSync(path.join(directory, 'companion'), 'c');
    expect(resolverOf(pkg).brokerBinary()).toBe(path.join(directory, name));
  });

  /** A pin that moved without an install answers absence, never the previous commit's build */
  it("is never another commit's build", () => {
    const platform = `${process.platform}-${process.arch}`;
    const name = process.platform === 'win32' ? 'apack-terminal.exe' : 'apack-terminal';
    const pkg = aPackage({ [platform]: { [name]: sha('b') } });
    const elsewhere = path.join(pkg, 'bin', 'c'.repeat(40), platform);
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.writeFileSync(path.join(elsewhere, name), 'b');
    expect(resolverOf(pkg).brokerBinary()).toBeUndefined();
  });
});

describe('the pin', () => {
  it("is a release's SHA256SUMS, grouped by platform", () => {
    const sums = `${sha('m')}  darwin-arm64__apack-terminal\n${sha('w')}  win32-x64__apack-terminal.exe\n${sha('c')}  win32-x64__conpty.dll\n`;
    expect(pinFromSums(COMMIT, sums)).toEqual({
      commit: COMMIT,
      files: {
        'darwin-arm64': { 'apack-terminal': sha('m') },
        'win32-x64': { 'apack-terminal.exe': sha('w'), 'conpty.dll': sha('c') },
      },
    });
  });

  it('refuses sums it cannot read whole, and sums that list nothing', () => {
    expect(() => pinFromSums(COMMIT, `${sha('m')}  apack-terminal\n`)).toThrow(/not <sha256>  <platform>__<file>/);
    expect(() => pinFromSums(COMMIT, '\n')).toThrow(/lists no files/);
  });

  /** One commit in two places: the checkout the app compiles against, and the build it runs */
  it('names the commit vendor/apack-terminal.rev pins', () => {
    const pin = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', 'terminal-broker', 'src', 'pin.json'), 'utf8')) as { commit: string };
    expect(pin.commit).toBe(fs.readFileSync(path.join(REPO_ROOT, 'vendor', 'apack-terminal.rev'), 'utf8').trim());
  });
});
