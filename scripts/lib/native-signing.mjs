// A dylib's signature changes its bytes. Publish its final hash before the outer app seals resources.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { signAsync } from '@electron/osx-sign';

/** @param {string} file */
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/**
 * @param {string} root
 * @param {string} file
 */
function contained(root, file) {
  const real = fs.realpathSync(file), relative = path.relative(root, real);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error(`Native signing dependency escapes the app: ${file}`);
  }
  return real;
}

/** electron-builder supplies the resolved identity, keychain, entitlements and ignore policy.
 * @param {import('@electron/osx-sign').SignOptions} options
 */
export async function signMacApplication(options) {
  const app = fs.realpathSync(options.app);
  const resources = contained(app, path.join(app, 'Contents/Resources/app'));
  const load = createRequire(path.join(resources, 'packages/api/package.json'));
  const entry = contained(app, load.resolve('@apackdev/ears/sqlite'));
  const executables = fs.readdirSync(path.join(app, 'Contents/MacOS'));
  if (executables.length !== 1) throw new Error('Expected one packaged app executable');
  const executable = contained(app, path.join(app, 'Contents/MacOS', executables[0]));
  const target = execFileSync('/usr/bin/lipo', ['-archs', executable], { encoding: 'utf8' }).trim();
  const arch = target === 'arm64' ? 'arm64' : target === 'x86_64' ? 'x64' : undefined;
  if (!arch) throw new Error(`Unsupported packaged app architecture: ${target}`);
  const directory = path.join(path.dirname(entry), 'native', `darwin-${arch}`);
  const library = contained(app, path.join(directory, 'vec1.dylib'));
  const manifestFile = contained(app, path.join(directory, 'manifest.json'));
  let expectedManifest = fs.readFileSync(manifestFile, 'utf8');
  const manifest = JSON.parse(expectedManifest), unsignedHash = sha(library);
  if (manifest.format !== 1 || manifest.platform !== 'darwin' || manifest.arch !== arch ||
      !/^[a-f0-9]{64}$/.test(manifest.extensionSha256) || manifest.extensionSha256 !== unsignedHash) {
    throw new Error('Refusing to sign a native vector library with mismatched build provenance');
  }
  // Match electron-builder's default: one attempt plus three retries, spaced 5, 10 and 15 seconds.
  for (let attempt = 0; ; attempt++) {
    let finalized = false, signedLibrary = false;
    try {
      await signAsync({ ...options, optionsForFile(file) {
        const perFile = options.optionsForFile?.(file), real = fs.realpathSync(file);
        if (real === library) signedLibrary = true;
        if (real === app) {
          if (!signedLibrary) throw new Error('Signer skipped the native vector library before sealing the app');
          if (fs.readFileSync(manifestFile, 'utf8') !== expectedManifest) {
            throw new Error('Native provenance changed while signing');
          }
          execFileSync('/usr/bin/codesign', ['--verify', '--strict', library], { stdio: 'pipe' });
          const signedHash = sha(library);
          expectedManifest = JSON.stringify({ ...manifest, extensionSha256: signedHash }, null, 2) + '\n';
          fs.writeFileSync(manifestFile, expectedManifest);
          finalized = true;
          console.log('Signed native vector provenance: ' + JSON.stringify({
            file: path.relative(app, library), unsignedSha256: unsignedHash, signedSha256: signedHash,
          }));
        }
        return perFile ?? {};
      } });
      if (!finalized) throw new Error('Signer did not finalize native provenance before sealing the app');
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await setTimeout(5000 * (attempt + 1));
    }
  }
}
