import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import pkg from '../package.json' with { type: 'json' };

export const APP_WORKSPACES = ['main', 'server', 'renderer', 'preload'] as const;
type AppWorkspace = (typeof APP_WORKSPACES)[number];

/** Identity recorded once for each packaged build. */
export interface BuildMetadata {
  version: string;
  channel: string;
  appId: string;
  productName: string;
  urlScheme: string;
}

export function resolveBuildMetadata(env: NodeJS.ProcessEnv = process.env): BuildMetadata {
  const channel = env.APACK_ENV || '';
  if (!['', 'production', 'beta', 'preview', 'development', 'test'].includes(channel)) {
    throw new Error(`Unknown build channel: ${channel}`);
  }
  if (env.APACK_BUILD_VERSION && channel !== 'preview') {
    throw new Error('APACK_BUILD_VERSION is only supported for preview builds; releases use package.json.');
  }
  const version = env.APACK_BUILD_VERSION || pkg.version;
  if (channel === 'preview' && !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-preview\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Preview builds require APACK_BUILD_VERSION=<version>-preview.<iteration>. Use npm run build:preview -- --version <version>.');
  }
  return { version, ...resolveBuildIdentity(channel) };
}

/** Channel identity is shared by packaging and the local packaged-app tools. */
export function resolveBuildIdentity(channel: string): Omit<BuildMetadata, 'version'> {
  const suffix = channel === 'beta' ? 'beta' : channel === 'preview' ? 'preview' : null;
  return {
    channel,
    appId: suffix ? `dev.apack.${suffix}` : 'dev.apack.app',
    productName: suffix ? `apack ${suffix === 'beta' ? 'Beta' : 'Preview'}` : 'apack',
    urlScheme: suffix ? `apack-${suffix}` : 'apack',
  };
}

/** A new directory for each packaging run; workspace dist remains for development/checks. */
export function createBuildSession(env: NodeJS.ProcessEnv = process.env): string {
  const metadata = resolveBuildMetadata(env);
  if (!['production', 'beta', 'preview'].includes(metadata.channel)) throw new Error('Packaging requires a production, beta, or preview channel.');
  const parent = path.resolve('.temp/app-builds');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, `${metadata.channel}-`));
  fs.writeFileSync(path.join(root, 'build-manifest.json'), JSON.stringify(metadata, null, 2) + '\n');
  return root;
}

export function readBuildManifest(root: string): BuildMetadata {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'build-manifest.json'), 'utf8')) as BuildMetadata;
  if (!['production', 'beta', 'preview'].includes(metadata.channel) || !metadata.version) throw new Error('Invalid packaged build manifest');
  return metadata;
}

export function appBuildOutput(workspace: AppWorkspace): string {
  const root = process.env.APACK_BUILD_ROOT;
  if (!root) return 'dist';
  readBuildManifest(root);
  return path.join(root, 'packages', workspace, 'dist');
}

function buildOutputHashes(root: string): Record<string, string> {
  const files = APP_WORKSPACES.flatMap(workspace => {
    const dir = path.join(root, 'packages', workspace, 'dist');
    const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true });
    const unexpected = entries.find(entry => !entry.isFile() && !entry.isDirectory());
    if (unexpected) throw new Error(`Unexpected build output: ${path.join(unexpected.parentPath, unexpected.name)}`);
    const output = entries.filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name));
    if (!output.length) throw new Error(`Missing build output: ${workspace}`);
    return output;
  });
  files.push(path.join(root, 'build-manifest.json'));
  return Object.fromEntries(files.sort().map(file => [
    path.relative(root, file).split(path.sep).join('/'),
    createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  ]));
}

/** Where a workspace's record of the third-party packages its bundle inlined is kept, outside its sealed `dist` */
export function bundledPackagesFile(root: string, workspace: AppWorkspace): string {
  return path.join(root, 'bundled-packages', `${workspace}.json`);
}

/**
 * Adds to a workspace's record of the packages its bundle inlined, for `scripts/lib/third-party-notices.ts` to
 * credit. One build can hand over several lists — a Vite build and each of its worker bundles, a tsup build's ESM
 * and CJS runs — so each is merged into what is there. Without a staging build there is nothing to record into.
 */
export function recordBundledPackages(workspace: AppWorkspace, packages: { name: string; version: string; dir: string }[]): void {
  const root = process.env.APACK_BUILD_ROOT;
  if (!root) return;
  const file = bundledPackagesFile(root, workspace);
  const held = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as { packages: typeof packages }).packages : [];
  const byDir = new Map([...held, ...packages].map(entry => [entry.dir, entry]));
  const key = (entry: { name: string; version: string }) => `${entry.name}@${entry.version}`;
  const merged = [...byDir.values()].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ packages: merged }, null, 2) + '\n');
}

/**
 * Written only after all four bundlers succeed; an interrupted run cannot be packaged. Each bundler has to have
 * recorded what it inlined, an empty list included: the build root is new for each run, so a record there is this
 * run's, and one missing is a bundler that no longer records, whose packages the notices would leave out.
 */
export function sealBuildSession(root: string): void {
  readBuildManifest(root);
  const unrecorded = APP_WORKSPACES.filter(workspace => !fs.existsSync(bundledPackagesFile(root, workspace)));
  if (unrecorded.length) {
    throw new Error(`No record of the packages ${unrecorded.join(', ')} inlined: each bundler's config records them (recordBundledPackages)`);
  }
  fs.writeFileSync(path.join(root, 'build-integrity.json'), JSON.stringify(buildOutputHashes(root), null, 2) + '\n');
}

export function verifyBuildOutputs(root: string, appDir = root): void {
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'build-integrity.json'), 'utf8'));
  const actual = buildOutputHashes(appDir);
  if (!isDeepStrictEqual(actual, expected)) throw new Error('Build outputs differ from the completed staging build');
}

/** Packaging consumes only a completed stage, then verifies the actual packaged files. */
export function verifyPackagedBuild(appDir: string, root: string): void {
  const manifest = readBuildManifest(root);
  const packaged = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  if (packaged.version !== manifest.version) throw new Error(`Packaged version ${packaged.version} differs from ${manifest.version}`);
  verifyBuildOutputs(root, appDir);
}
