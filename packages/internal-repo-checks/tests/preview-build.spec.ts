import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewEnvironment, previewVersion } from '../../../scripts/lib/preview-build.ts';
import {
  APP_WORKSPACES, bundledPackagesFile, resolveBuildMetadata, createBuildSession, readBuildManifest, recordBundledPackages, sealBuildSession,
  verifyBuildOutputs, verifyPackagedBuild,
} from '../../../build/build-metadata.ts';

import { completeBuildFixture } from './_support/app-build.ts';

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('local preview builds', () => {
  it('versions previews without changing release metadata', () => {
    expect(previewVersion(['--version', '0.4.0'])).toBe('0.4.0-preview.1');
    expect(previewVersion(['--version=0.4.0-preview.2'])).toBe('0.4.0-preview.2');
    for (const args of [[], ['--version', 'latest'], ['--version', '0.4.0-beta.1'], ['--publish']]) {
      expect(() => previewVersion(args)).toThrow();
    }
  });

  it('gives the builders one version and identity and disables inherited publishing/signing', () => {
    const env = previewEnvironment('0.4.0-preview.2', { APACK_ENV: 'production', PUBLISH_TO_GITHUB: 'true', NODE_ENV: 'production' });
    expect(env.PUBLISH_TO_GITHUB).toBe('false');
    expect(env.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false');
    expect(env.NODE_ENV).toBeUndefined();
    expect(resolveBuildMetadata(env)).toEqual({ version: '0.4.0-preview.2', channel: 'preview',
      productName: 'apack Preview', appId: 'dev.apack.preview', urlScheme: 'apack-preview' });
    expect(() => resolveBuildMetadata({ APACK_ENV: 'production', APACK_BUILD_VERSION: '0.4.0-preview.2' })).toThrow(/only supported for preview/);
    expect(() => resolveBuildMetadata({ APACK_ENV: 'preview' })).toThrow(/Preview builds require/);
  });

  it('isolates channels and rejects incomplete or changed outputs before packaging', () => {
    const preview = createBuildSession(previewEnvironment('0.4.0-preview.1', {}));
    const production = createBuildSession({ APACK_ENV: 'production' });
    dirs.push(preview, production);
    expect(preview).not.toBe(production);
    expect(readBuildManifest(preview).version).toBe('0.4.0-preview.1');
    expect(readBuildManifest(production).channel).toBe('production');
    expect(() => verifyBuildOutputs(preview)).toThrow();
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-package-'));
    dirs.push(app);
    completeBuildFixture(preview);
    const receipt = path.join(preview, 'build-integrity.json');
    const hashes = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    fs.writeFileSync(receipt, JSON.stringify(Object.fromEntries(Object.entries(hashes).reverse())));
    expect(() => verifyBuildOutputs(preview)).not.toThrow();
    fs.cpSync(preview, app, { recursive: true });
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ version: '0.4.0-preview.1' }));
    expect(() => verifyPackagedBuild(app, preview)).not.toThrow();
    for (const workspace of APP_WORKSPACES) {
      const file = path.join(app, 'packages', workspace, 'dist/index.js');
      fs.writeFileSync(file, 'stale');
      expect(() => verifyPackagedBuild(app, preview)).toThrow(/outputs differ/);
      fs.writeFileSync(file, workspace);
    }
    fs.writeFileSync(path.join(app, 'build-manifest.json'), '{}');
    expect(() => verifyPackagedBuild(app, preview)).toThrow(/outputs differ/);
    fs.copyFileSync(path.join(preview, 'build-manifest.json'), path.join(app, 'build-manifest.json'));
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ version: '0.3.14' }));
    expect(() => verifyPackagedBuild(app, preview)).toThrow(/Packaged version/);
    fs.writeFileSync(path.join(preview, 'packages/server/dist/index.js'), 'changed after build');
    expect(() => verifyBuildOutputs(preview)).toThrow(/outputs differ/);
  });

  it('compares the packaged release layout, including its receipt, to the sealed stage', () => {
    const stage = createBuildSession(previewEnvironment('0.4.0-preview.1', {}));
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-package-'));
    dirs.push(stage, app);
    fs.writeFileSync(path.join(stage, 'build-manifest.json'), JSON.stringify({
      ...readBuildManifest(stage), shippedPackLayouts: true,
    }));
    const pack = 'shipped-packs/example';
    fs.mkdirSync(path.join(stage, pack), { recursive: true });
    fs.writeFileSync(path.join(stage, pack, 'integrity.json'), '{}');
    completeBuildFixture(stage);
    fs.cpSync(stage, app, { recursive: true });
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ version: '0.4.0-preview.1' }));
    expect(() => verifyPackagedBuild(app, stage)).not.toThrow();
    fs.unlinkSync(path.join(app, pack, 'integrity.json'));
    expect(() => verifyPackagedBuild(app, stage)).toThrow(/outputs differ/);
  });

  it('refuses to seal a build whose bundler recorded nothing of what it inlined, an empty list being a record', () => {
    for (const unrecorded of APP_WORKSPACES) {
      const stage = createBuildSession({ APACK_ENV: 'production' });
      dirs.push(stage);
      completeBuildFixture(stage);
      fs.rmSync(path.join(stage, 'build-integrity.json'));
      fs.rmSync(bundledPackagesFile(stage, unrecorded));
      expect(() => sealBuildSession(stage)).toThrow(`No record of the packages ${unrecorded} inlined: each bundler's config records them (recordBundledPackages)`);
      expect(fs.existsSync(path.join(stage, 'build-integrity.json'))).toBe(false);
      fs.writeFileSync(bundledPackagesFile(stage, unrecorded), JSON.stringify({ packages: [] }));
      expect(() => sealBuildSession(stage)).not.toThrow();
    }
  });

  it("merges each list a bundler hands over into its workspace's record, one entry a directory, sorted", () => {
    const stage = createBuildSession({ APACK_ENV: 'production' });
    dirs.push(stage);
    const vue = { name: 'vue', version: '3.5.0', dir: '/repo/node_modules/vue' };
    const nested = { name: 'vue', version: '3.4.0', dir: '/repo/node_modules/a/node_modules/vue' };
    const ws = { name: 'ws', version: '8.0.0', dir: '/repo/node_modules/ws' };
    const recorded = (workspace: (typeof APP_WORKSPACES)[number]) =>
      (JSON.parse(fs.readFileSync(bundledPackagesFile(stage, workspace), 'utf8')) as { packages: object[] }).packages;
    // Outside a staging build there is nowhere to record into
    vi.stubEnv('APACK_BUILD_ROOT', '');
    recordBundledPackages('renderer', [ws]);
    expect(fs.existsSync(bundledPackagesFile(stage, 'renderer'))).toBe(false);
    vi.stubEnv('APACK_BUILD_ROOT', stage);
    recordBundledPackages('renderer', [ws, vue]);
    recordBundledPackages('renderer', [nested, vue]);
    expect(recorded('renderer')).toEqual([nested, vue, ws]);
    // A bundler that inlined nothing still leaves a record, and each workspace has its own
    recordBundledPackages('preload', []);
    expect(recorded('preload')).toEqual([]);
    expect(fs.existsSync(bundledPackagesFile(stage, 'main'))).toBe(false);
  });

  it('names beta release files with characters GitHub preserves, using the staged manifest', async () => {
    const stage = createBuildSession({ APACK_ENV: 'beta' });
    dirs.push(stage);
    completeBuildFixture(stage);
    vi.stubEnv('APACK_BUILD_ROOT', stage);
    vi.resetModules();
    const configUrl = pathToFileURL(path.resolve(__dirname, '../../../electron-builder.mjs')).href;
    const config = (await import(configUrl)).default as { artifactName: string; extraMetadata: { version: string } };
    expect(config.extraMetadata.version).toBe(readBuildManifest(stage).version);
    const name = config.artifactName
      .replace('${version}', '0.4.0-beta.1').replace('${os}', 'mac').replace('${arch}', 'arm64').replace('${ext}', 'zip');
    expect(name).toBe('apack-Beta-0.4.0-beta.1-mac-arm64.zip');
  });

  it("is a configuration electron-builder takes, whose deb keeps electron-builder's dependencies and states the glibc floor", async () => {
    const stage = createBuildSession({ APACK_ENV: 'production' });
    dirs.push(stage);
    completeBuildFixture(stage);
    vi.stubEnv('APACK_BUILD_ROOT', stage);
    vi.resetModules();
    const configUrl = pathToFileURL(path.resolve(__dirname, '../../../electron-builder.mjs')).href;
    const config = (await import(configUrl)).default as { deb: { depends: string[] } };
    // electron-builder checks its configuration against its schema only when it packages, after the whole build
    const require = createRequire(path.resolve(__dirname, '../../../package.json'));
    const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js');
    const { DebugLogger } = require('builder-util/out/DebugLogger.js');
    await expect(validateConfiguration(config, new DebugLogger(false))).resolves.toBeUndefined();
    const { default: FpmTarget } = require('app-builder-lib/out/targets/FpmTarget.js');
    const defaults: string[] = FpmTarget.prototype.getDefaultDepends('deb');
    expect(defaults.length).toBeGreaterThan(0);
    expect(config.deb.depends).toEqual([...defaults, expect.stringMatching(/^libc6 \(>= \d+\.\d+\)$/)]);
  });

  it("names a Linux install for its channel, so Beta installs beside production and none takes the CLI's name", async () => {
    const linux = async (env: string) => {
      const stage = createBuildSession(env === 'preview' ? previewEnvironment('0.4.0-preview.1', {}) : { APACK_ENV: env });
      dirs.push(stage);
      completeBuildFixture(stage);
      vi.stubEnv('APACK_BUILD_ROOT', stage);
      vi.resetModules();
      const configUrl = pathToFileURL(path.resolve(__dirname, '../../../electron-builder.mjs')).href;
      const config = (await import(configUrl)).default as {
        deb: { packageName: string }; linux: { executableName: string; syncDesktopName: boolean; mimeTypes: string[] };
        extraMetadata: { desktopName: string };
      };
      return { pkg: config.deb.packageName, exe: config.linux.executableName, desktop: config.extraMetadata.desktopName,
        synced: config.linux.syncDesktopName, mime: config.linux.mimeTypes };
    };
    const production = await linux('production');
    const beta = await linux('beta');
    const preview = await linux('preview');
    expect(production).toEqual({ pkg: 'apack', exe: 'apack-desktop', desktop: 'apack-desktop.desktop', synced: true, mime: ['x-scheme-handler/apack'] });
    expect(beta).toEqual({ pkg: 'apack-beta', exe: 'apack-beta-desktop', desktop: 'apack-beta-desktop.desktop', synced: true, mime: ['x-scheme-handler/apack-beta'] });
    expect(preview).toEqual({ pkg: 'apack-preview', exe: 'apack-preview-desktop', desktop: 'apack-preview-desktop.desktop', synced: true, mime: ['x-scheme-handler/apack-preview'] });
    // The `apack` command line tool is installed under its own name, which no app executable may take
    const cli = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../apack-cli/package.json'), 'utf8')) as { bin: Record<string, string> };
    expect(Object.keys(cli.bin)).toContain('apack');
    expect([production.exe, beta.exe, preview.exe]).not.toContain('apack');
  });

  it("loads electron-builder's internals at the versions electron-builder itself requires", () => {
    // electron-builder.mjs and these specs load app-builder-lib and builder-util by their internal paths; a copy at
    // another version than electron-builder's would be read in its place without a word
    const root = path.resolve(__dirname, '../../..');
    const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const builder = read(path.join(root, 'node_modules/electron-builder/package.json')).dependencies!;
    const pins = { ...read(path.join(root, 'package.json')).devDependencies };
    const repoChecks = { ...read(path.join(root, 'packages/internal-repo-checks/package.json')).dependencies, ...read(path.join(root, 'packages/internal-repo-checks/package.json')).devDependencies };
    for (const name of ['app-builder-lib', 'builder-util']) {
      expect(pins[name], `package.json's ${name}`).toBe(builder[name]);
      if (repoChecks[name]) expect(repoChecks[name], `packages/internal-repo-checks' ${name}`).toBe(builder[name]);
      expect(fs.existsSync(path.join(root, 'node_modules/electron-builder/node_modules', name)), `a second ${name} under electron-builder`).toBe(false);
    }
  });

});
