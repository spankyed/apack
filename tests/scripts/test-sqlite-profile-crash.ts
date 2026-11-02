// Real parent-issued kills at conversion boundaries. Only synthetic source data and new private output.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createEarsEngine } from '@apackdev/ears';
import { openDatabase as openNative } from '@apackdev/ears/lmdb';
import { openDatabase as openSqlite } from '@apackdev/ears/sqlite';
import { _RUN_HISTORY_SCHEMA } from '@apackdev/sdk/services';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { findDatabaseWriter } from '@apackdev/host/database';
import { convertSqliteProfile } from '../../scripts/convert-sqlite-profile.ts';

const [producer, receipt, ...extra] = process.argv.slice(2);
if (!producer || !receipt || extra.length) throw new Error('Usage: test-sqlite-profile-crash.ts <matching-elmdb-cli> <new-receipt.json>');
assert(!fs.existsSync(receipt));
const root = fs.mkdtempSync(path.join(tmpdir(), 'ears-profile-crash-'));
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const records: unknown[] = [];
const save = () => fs.writeFileSync(receipt, JSON.stringify({ source: process.env.EARS_TEST_SOURCE,
  producerSha256: hash(producer), enginePin: fs.readFileSync('vendor/elmdb.rev', 'utf8').trim(),
  scope: 'Parent-issued process termination; no physical power-loss or large-resource guarantee', records }, null, 2) + '\n');
function files(directory: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (dir: string) => { for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name), stat = fs.lstatSync(file);
    if (stat.isDirectory()) walk(file); else { assert(stat.isFile()); result[path.relative(directory, file)] = hash(file); }
  } };
  walk(directory); return result;
}
function verify(profile: string) {
  const paths = _appDataPaths(profile), db = openSqlite({ path: paths.lmdb, readOnly: true });
  try {
    const e = createEarsEngine({ database: db });
    assert.equal(e.getAttr('Row-one', 'text'), 'x'.repeat(256000));
    assert.deepEqual(e.getAttr('Row-one', 'bytes'), new Uint8Array([0, 255]));
    assert.deepEqual(e.getAttr('Settings-app', 'data'), { app: { personal: { name: 'Crash retained' } } });
    assert.equal(e.query('Row').count(), 1001);
  } finally { db.close(); }
  const runs = openSqlite({ path: paths.runHistory, readOnly: true });
  try { assert.equal(createEarsEngine({ database: runs }).getAttr('RunNode-one', 'label'), 'retained'); } finally { runs.close(); }
  assert.equal(fs.readFileSync(path.join(paths.media, 'asset'), 'utf8'), 'retained media');
  assert(!fs.existsSync(path.join(paths.lmdb, 'data.mdb')) && !fs.existsSync(path.join(paths.runHistory, 'data.mdb')));
}
try {
  const source = path.join(root, 'source'), paths = _appDataPaths(source);
  const native = openNative({ path: paths.lmdb, schema: { types: { Row: { required: [] }, Settings: { required: ['data'] } }, relations: {}, roles: [] } });
  try {
    const e = createEarsEngine({ database: native });
    e.create('Row', { id: 'Row-one', text: 'x'.repeat(256000), bytes: new Uint8Array([0, 255]) });
    e.create('Settings', { id: 'Settings-app', data: { app: { personal: { name: 'Crash retained' } } } });
    e.transact(() => { for (let i = 0; i < 1000; i++) e.create('Row', { id: `Row-extra${i}`, text: `retained ${i}` }); }, { durable: true });
  } finally { native.close(); }
  const runs = openNative({ path: paths.runHistory, schema: _RUN_HISTORY_SCHEMA });
  try { createEarsEngine({ database: runs }).create('RunNode', { id: 'RunNode-one', kind: 'flow', status: 'completed', label: 'retained', startedAt: 1 }); } finally { runs.close(); }
  fs.mkdirSync(paths.media); fs.writeFileSync(path.join(paths.media, 'asset'), 'retained media');
  const before = { primary: hash(path.join(paths.lmdb, 'data.mdb')), runs: hash(path.join(paths.runHistory, 'data.mdb')) };
  for (const point of ['during-primary', 'before-primary', 'after-primary', 'before-profile', 'after-profile']) {
    const output = path.join(root, point), final = path.join(output, 'profile');
    const code = `
      import fs from 'node:fs'; import path from 'node:path'; import {syncBuiltinESMExports,createRequire} from 'node:module';
      const [source,output,producer,point,module]=process.argv.slice(1);
      const canonical=path.join(fs.realpathSync(path.dirname(output)),path.basename(output));
      const final=path.join(canonical,'profile'),building=path.join(canonical,'.profile-incomplete');
      const primary=path.join(building,'apack','ears-db'),rename=fs.renameSync;
      const stop=(loadedEntities)=>{
        const base=fs.existsSync(final)?final:building;
        fs.writeSync(1,JSON.stringify({point,finalExists:fs.existsSync(final),primaryExists:fs.existsSync(path.join(base,'apack','ears-db','data.sqlite3')),
          historyExists:fs.existsSync(path.join(base,'apack','run-history','data.sqlite3')),...(Number.isInteger(loadedEntities)?{loadedEntities}:{})})+'\\n');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000);process.exit(2);
      };
      const Native=createRequire(import.meta.resolve('@apackdev/ears/sqlite'))('better-sqlite3'),exec=Native.prototype.exec;
      Native.prototype.exec=function(sql){
        const result=exec.call(this,sql);
        if(point==='during-primary'&&String(sql).trim()==='COMMIT'&&path.resolve(this.name)===path.join(canonical,'primary-conversion','store','data.sqlite3')){
          const count=this.prepare('SELECT count(*) n FROM entities').get().n;
          if(count>0&&count<1002)stop(count);
        }
        return result;
      };
      fs.renameSync=(from,to)=>{
        const selected=path.resolve(String(to)),match=selected===primary?'primary':selected===final?'profile':null;
        if(match&&point==='before-'+match)stop();const result=rename(from,to);
        if(match&&point==='after-'+match)stop();return result;
      };
      syncBuiltinESMExports();const {convertSqliteProfile}=await import(module);
      await convertSqliteProfile({source,output,producer});throw new Error('Missing conversion boundary witness');
    `;
    const module = pathToFileURL(path.resolve('scripts/convert-sqlite-profile.ts')).href;
    const child = spawn(process.execPath, ['--conditions=@apackdev/source', '--import', 'tsx', '--input-type=module', '-e', code,
      source, output, path.resolve(producer), point, module], { timeout: 15000, killSignal: 'SIGKILL' });
    const exited = once(child, 'exit'), closed = once(child, 'close');
    const lines = createInterface({ input: child.stdout }); let stderr = '';
    child.stderr.setEncoding('utf8').on('data', value => { stderr = (stderr + value).slice(-64000); });
    try {
      const [line] = await Promise.race([once(lines, 'line'), exited.then(([code, signal]) => { throw new Error(`Child exited before witness ${point}: ${code}/${signal}: ${stderr}`); })]);
      const witness = JSON.parse(String(line));
      assert.deepEqual(witness, { point, finalExists: point === 'after-profile', primaryExists: !['during-primary', 'before-primary'].includes(point), historyExists: point.endsWith('profile'),
        ...(point === 'during-primary' ? { loadedEntities: 1000 } : {}) });
      assert(child.kill('SIGKILL')); const [, signal] = await exited; await closed; assert.equal(signal, 'SIGKILL', stderr);
      assert.equal(hash(path.join(paths.lmdb, 'data.mdb')), before.primary); assert.equal(hash(path.join(paths.runHistory, 'data.mdb')), before.runs);
      assert.equal(findDatabaseWriter(source), null);
      assert.equal(fs.existsSync(final), point === 'after-profile');
      if (point === 'after-profile') verify(final);
      const retained = files(output);
      await assert.rejects(convertSqliteProfile({ source, output, producer }), /output must not exist/);
      assert.deepEqual(files(output), retained);
      const retry = await convertSqliteProfile({ source, output: path.join(root, point + '-retry'), producer }); verify(retry.path);
      assert.deepEqual(files(output), retained);
      assert.equal(hash(path.join(paths.lmdb, 'data.mdb')), before.primary); assert.equal(hash(path.join(paths.runHistory, 'data.mdb')), before.runs);
      records.push({ point, witness, signal, nativeSourceUnchanged: true, oldOutputBytesUnchanged: true, newContainerRetryVerified: true,
        ...(point === 'after-profile' ? { completedProfileReopened: true } : {}) }); save();
    } finally {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; await closed; }
    }
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
