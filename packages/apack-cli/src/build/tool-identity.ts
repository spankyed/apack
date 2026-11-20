import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { packInputFiles, packInputsHash } from '@apackdev/host/build/pack-inputs';

function packageRoot(entry: string): string {
  let root = path.dirname(entry);
  while (!fs.existsSync(path.join(root, 'package.json'))) {
    const parent = path.dirname(root);
    if (parent === root) throw new Error(`Cannot locate build tool package for ${entry}`);
    root = parent;
  }
  return fs.realpathSync.native(root);
}

/** Complete implementation scopes, rather than a previous build's observed imports. */
export function buildToolHash(moduleUrl = import.meta.url): string {
  const entry = fs.realpathSync.native(fileURLToPath(moduleUrl));
  const root = cliPackageDirectory(moduleUrl);
  const source = path.relative(root, entry).split(path.sep)[0] === 'src';
  const scopes: Array<{ name: string; root: string; directory: string }> = [
    { name: '@apackdev/cli', root, directory: source ? 'src' : 'dist' },
  ];
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
    // EARS is consumed as its built `dist`, linked from the elmdb checkout, in source mode as in any other
    const ears = path.dirname(require.resolve('@elmdb/ears/package.json'));
    scopes.push({ name: '@elmdb/ears', root: ears, directory: 'dist' });
  } else {
    // Bundled code still reads installed SDK declarations, including package-root installations.
    const owner = path.dirname(require.resolve('@apackdev/sdk/package.json'));
    const compiled = packageRoot(require.resolve('@apackdev/sdk/build'));
    scopes.push({ name: '@apackdev/sdk', root: owner, directory: path.relative(owner, compiled) || '.' });
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
  hash.update(packInputsHash(path.join(root, 'bin')));
  return hash.digest('hex');
}

/** The executing CLI's owner, shared by implementation and npm resolution scopes. */
export function cliPackageDirectory(moduleUrl = import.meta.url): string {
  const root = packageRoot(fileURLToPath(moduleUrl));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== '@apackdev/cli') throw new Error(`Unexpected build tool package: ${manifest.name}`);
  return root;
}
