import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire, findPackageJSON } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packInputFiles, packInputsHash } from '@apackdev/host/build/pack-inputs';
import { dependencyClosure, packageIdentity } from '@apackdev/host/build/package-identity';

function packageRoot(entry: string): string {
  const manifest = findPackageJSON(pathToFileURL(entry));
  if (!manifest) throw new Error(`Cannot locate build tool package for ${entry}`);
  return fs.realpathSync.native(path.dirname(manifest));
}

/**
 * Complete implementation scopes, rather than a previous build's observed imports.
 *
 * The CLI's own code is read as a directory: `src` run from a checkout, `dist` once bundled, and in a checkout the
 * host's and SDK's `src` too, which it runs from source. Every other package it scopes is read by its identity
 * (`packageIdentity`: name, version and the files it ships), never by a folder guessed inside it: in a checkout what
 * the SDK has linked from another checkout (`npm run deps:local`), and beside a published CLI the installed SDK,
 * whose declarations the bundled code reads.
 */
export function buildToolHash(moduleUrl = import.meta.url): string {
  const entry = fs.realpathSync.native(fileURLToPath(moduleUrl));
  const root = cliPackageDirectory(moduleUrl);
  const source = path.relative(root, entry).split(path.sep)[0] === 'src';
  const scopes: Array<{ name: string; root: string; directory: string }> = [
    { name: '@apackdev/cli', root, directory: source ? 'src' : 'dist' },
  ];
  const identities: string[] = [];
  const require = createRequire(moduleUrl);
  if (source) {
    for (const [name, specifier] of [
      ['@apackdev/host', '@apackdev/host/build/shared-deps'],
      ['@apackdev/sdk', '@apackdev/sdk/build'],
    ] as const) {
      // Exported metadata identifies the workspace owner, rather than its nested published dist.
      const owner = name === '@apackdev/host' ? packageRoot(require.resolve(specifier))
        : path.dirname(require.resolve(`${name}/package.json`));
      scopes.push({ name, root: owner, directory: 'src' });
    }
    // What the SDK has linked from a checkout (`npm run deps:local`: EARS from elmdb's) changes without its version or
    // the lockfile moving, so it is scoped by what it ships; what it has installed moves with the lockfile. A linked
    // package is the one whose real directory is outside every `node_modules`
    const [sdk, ...brought] = dependencyClosure('@apackdev/sdk', root);
    for (const name of Object.keys(sdk!.manifest.dependencies ?? {})) {
      const pkg = brought.find((member) => member.name === name);
      if (pkg === undefined) throw new Error(`Missing build tool implementation: ${name} isn't among @apackdev/sdk's dependencies`);
      if (pkg.directory.split(path.sep).includes('node_modules')) continue;
      identities.push(identityLine(pkg.directory));
    }
  } else {
    // Bundled code still reads installed SDK declarations, including package-root installations.
    identities.push(identityLine(path.dirname(require.resolve('@apackdev/sdk/package.json'))));
  }
  // Published CLI code inlines host/SDK/EARS; include every shipped chunk, not only a version.
  const hash = createHash('sha256');
  hash.update(source ? 'source' : 'bundle');
  for (const scope of scopes) {
    const directory = path.join(scope.root, scope.directory);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory() || !packInputFiles(directory).length) {
      throw new Error(`Missing build tool implementation: ${scope.name}/${scope.directory}`);
    }
    hash.update(scope.name);
    hash.update(fs.readFileSync(path.join(scope.root, 'package.json')));
    hash.update(packInputsHash(directory));
  }
  for (const identity of identities) hash.update(identity);
  hash.update(packInputsHash(path.join(root, 'bin')));
  return hash.digest('hex');
}

function identityLine(directory: string): string {
  const { name, version, hash } = packageIdentity(directory);
  return `${name}@${version}:${hash}\n`;
}

/** The executing CLI's owner, shared by implementation and npm resolution scopes. */
export function cliPackageDirectory(moduleUrl = import.meta.url): string {
  const root = packageRoot(fileURLToPath(moduleUrl));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== '@apackdev/cli') throw new Error(`Unexpected build tool package: ${manifest.name}`);
  return root;
}
