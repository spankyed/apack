// What a pack resolves as @apackdev/ears must be its @apackdev/sdk's copy. A pack names only the SDK, which brings
// EARS, but a pack that installs EARS itself at another version gets a copy of its own, with npm nesting the SDK's:
// the pack's code then runs on one EARS and the SDK's on another, whose errors and engines aren't the same classes.
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

interface ResolvedPackage {
  file: string;
  version: string;
}

function resolvePackage(fromFile: string, name: string): ResolvedPackage | undefined {
  try {
    const file = fs.realpathSync(createRequire(fromFile).resolve(`${name}/package.json`));
    return { file, version: (JSON.parse(fs.readFileSync(file, 'utf-8')) as { version?: string }).version ?? 'unknown' };
  } catch {
    return undefined;
  }
}

/**
 * Throws when the pack in `packDir` resolves a copy of @apackdev/ears other than its @apackdev/sdk's. A pack that
 * resolves none has nothing to differ: everything it loads reaches EARS through the SDK.
 */
export function assertSharedEars(packDir: string): void {
  const fromPack = path.join(packDir, 'package.json');
  const sdk = resolvePackage(fromPack, '@apackdev/sdk');
  if (!sdk) return;
  const packEars = resolvePackage(fromPack, '@apackdev/ears');
  if (!packEars) return;
  const sdkEars = resolvePackage(sdk.file, '@apackdev/ears');
  if (sdkEars && sdkEars.file !== packEars.file) {
    throw new Error(
      `The pack's @apackdev/ears ${packEars.version} and @apackdev/sdk's @apackdev/ears ${sdkEars.version} are different copies `
      + `(${path.dirname(packEars.file)}, ${path.dirname(sdkEars.file)}): a pack depends on @apackdev/sdk alone, which brings its @apackdev/ears, so remove @apackdev/ears from the pack's dependencies`,
    );
  }
}
