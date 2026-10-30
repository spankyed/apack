// Executable locations come from this package's build layout, never stored database metadata.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const upstream = '814fd8ef4d42d6567f1613a66f556c8194764d06';
const sourceSha256 = '5d49d5ea17fbeaa1f22141305a81a5aeac8feb1af652a0d8229ea906bd5c973b';
const patchSha256 = '33cabeb716827e1c2cfaa0db963cd94a2494dd8b000dd4e628559f0ee3047923';
const headersPackage = '13.0.3';
const changed = (): never => { throw Object.assign(new Error('Packaged native vector provenance or binary does not match this build'), { code: 'NATIVE_CHANGED' }); };

/** Resolve a trusted build directory; callers may supply an independently staged package directory. */
export function resolveNativeVectorExtension(directory = fileURLToPath(new URL(
  `../../dist/sqlite/native/${process.platform}-${process.arch}/`, import.meta.url))): string {
  if (!isAbsolute(directory)) throw Object.assign(new Error('Native artifact directory must be absolute'), { code: 'VALUE_INVALID' });
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    if (!manifest || manifest.format !== 1 || manifest.platform !== process.platform || manifest.arch !== process.arch ||
        manifest.upstream !== upstream || manifest.sourceSha256 !== sourceSha256 || manifest.patchSha256 !== patchSha256 ||
        manifest.headersPackage !== headersPackage || typeof manifest.extensionSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(manifest.extensionSha256)) return changed();
    const file = join(directory, process.platform === 'win32' ? 'vec1.dll' : process.platform === 'darwin' ? 'vec1.dylib' : 'vec1.so');
    if (createHash('sha256').update(readFileSync(file)).digest('hex') !== manifest.extensionSha256) return changed();
    return file;
  } catch (cause) {
    const code = (cause as { code?: string })?.code;
    if (code === 'NATIVE_CHANGED') throw cause;
    throw Object.assign(new Error('Packaged native vector artifact is unavailable; build the matching EARS package', { cause }),
      { code: code === 'ENOENT' ? 'NATIVE_MISSING' : cause instanceof SyntaxError ? 'NATIVE_CHANGED' : 'IO' });
  }
}
