// Observer only: do not install source-resolution hooks or alter CLI/module execution.
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const output = process.env.EARS_RUNTIME_RECEIPT;
if (!output || !process.env.EARS_INSTALLED_ROOT) throw Error('Installed CLI receipt needs explicit owned paths');
process.once('exit', () => {
  const { sharedObjects } = process.report.getReport();
  const bindings = sharedObjects.filter(path => path.endsWith('.node') || (path.includes('sqlite-vec') && /\.(so|dylib|dll)$/.test(path)))
    .map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
  appendFileSync(output, JSON.stringify({ argv: process.argv, node: process.version, nodeOptions: process.env.NODE_OPTIONS ?? '', bindings }) + '\n');
});
