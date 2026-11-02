// Observe package-owned native loads; preserve their arguments/results and install no source-resolution hooks.
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const output = process.env.EARS_RUNTIME_RECEIPT;
if (!output || !process.env.EARS_INSTALLED_ROOT) throw Error('Installed CLI receipt needs explicit owned paths');
const require = createRequire(import.meta.url), earsRequire = createRequire(require.resolve('@apackdev/ears/sqlite'));
const Database = earsRequire('better-sqlite3'), load = Database.prototype.loadExtension, extensionLoads = [];
const fingerprint = path => ({ path: realpathSync(path), sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
Database.prototype.loadExtension = function(...args) {
  const result = Reflect.apply(load, this, args);
  extensionLoads.push(fingerprint(args[0]));
  return result;
};
process.once('exit', () => {
  const { sharedObjects } = process.report.getReport();
  // SQLite unloads extensions when a connection closes. The successful-call observer above retains their provenance.
  const bindings = sharedObjects.filter(path => path.endsWith('.node')).map(fingerprint);
  appendFileSync(output, JSON.stringify({ argv: process.argv, node: process.version, nodeOptions: process.env.NODE_OPTIONS ?? '', bindings, extensionLoads }) + '\n');
});
