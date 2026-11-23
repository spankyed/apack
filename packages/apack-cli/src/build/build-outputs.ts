import fs from 'node:fs';
import path from 'node:path';
import { hash as cryptoHash } from 'node:crypto';

export type RecordBuildOutput = (file: string, bytes: string | Uint8Array) => void;
const hash = (bytes: string | Uint8Array) => cryptoHash('sha256', bytes, 'hex');

/** Final writer results live only until the candidate is sealed by its existing receipt. */
export function createBuildOutputs(directory: string) {
  const root = path.resolve(directory);
  const files = new Map<string, string>();
  const record: RecordBuildOutput = (file, bytes) => {
    file = path.resolve(file);
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Build output lies outside its candidate: ${file}`);
    }
    // Ordered writers can replace a public placeholder with an emitted bundle.
    files.set(file, hash(bytes));
  };
  return { record, assertCurrent() {
    for (const [file, expected] of files) {
      const stat = fs.lstatSync(file, { throwIfNoEntry: false });
      if (!stat?.isFile() || hash(fs.readFileSync(file)) !== expected) {
        throw new Error(`Required build output is missing or changed: ${path.relative(root, file)}`);
      }
    }
  } };
}
