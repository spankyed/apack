// Real Linux read-only bind mount and independent live WAL reader. Run only in disposable CI.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
assert.equal(process.platform, 'linux');
const [mode, path, writablePath, output] = process.argv.slice(2);
assert(['prepare', 'probe', 'reader'].includes(mode) && path);
const { createEarsEngine } = await import('../../dist/index.js');
const { openDatabase } = await import('../../dist/sqlite/index.js');
const schema = { types: { Row: { required: [] } }, relations: {}, roles: [] };
const mount = () => {
  const target = realpathSync(path);
  const decode = value => value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  const entry = readFileSync('/proc/self/mountinfo', 'utf8').split('\n')
    .map(line => line.split(' ')).find(fields => decode(fields[4] ?? '') === target);
  assert(entry, 'The target must be an actual mount point');
  assert(entry[5].split(',').includes('ro'), 'The bind mount must be read-only');
  assert.throws(() => writeFileSync(join(path, 'kernel-write-must-fail'), 'refused', { flag: 'wx' }), { code: 'EROFS' });
  return { options: entry[5], filesystem: entry.slice(entry.indexOf('-') + 1, entry.indexOf('-') + 2)[0], kernelWriteError: 'EROFS' };
};
if (mode === 'prepare') {
  const database = openDatabase({ path, schema });
  try { createEarsEngine({ database }).create('Row', { id: 'Row-before', title: 'incumbent' }); }
  finally { database.close(); }
} else if (mode === 'reader') {
  const filesystem = mount();
  const database = openDatabase({ path, readOnly: true });
  let pinned = false;
  try {
    const e = createEarsEngine({ database });
    assert.equal(e.query('Row').count(), 1);
    assert.throws(() => e.create('Row', { id: 'Row-refused' }), { code: 'READ_ONLY' });
    assert.throws(() => database.run('UPDATE entities SET trashed=1'), { code: 'SQLITE_READONLY' });
    database.sql.exec('BEGIN'); pinned = true;
    assert.equal(database.get('SELECT count(*) n FROM entities').n, 1);
    process.send({ phase: 'pinned', count: 1, filesystem, applicationWriteError: 'READ_ONLY', driverWriteError: 'SQLITE_READONLY' });
    const [command] = await once(process, 'message');
    assert.equal(command.phase, 'release');
    assert.equal(database.get('SELECT count(*) n FROM entities').n, 1, 'The independent read snapshot must remain pinned');
    database.sql.exec('ROLLBACK'); pinned = false;
    const currentCount = e.query('Row').count();
    assert.equal(currentCount, 17);
    process.send({ phase: 'released', retainedCount: 1, currentCount });
  } finally {
    if (pinned) database.sql.exec('ROLLBACK');
    database.close();
    process.disconnect();
  }
} else {
  assert(writablePath && output && !existsSync(output));
  const source = process.env.GITHUB_SHA;
  assert.match(source ?? '', /^[0-9a-f]{40}$/);
  const report = { protocol: 'ears-real-filesystem-readonly/1', source, completed: false, qualification: false,
    scope: 'CI-host Linux read-only bind mount, independent live WAL reader; not arbitrary filesystem or power-loss certification' };
  const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  let database, child, exited;
  try {
    report.filesystem = mount();
    database = openDatabase({ path: writablePath });
    const e = createEarsEngine({ database });
    database.all('PRAGMA wal_checkpoint(TRUNCATE)');
    database.sql.exec('PRAGMA wal_autocheckpoint=0');
    e.write('Row-before').set('ready', true); // Publish live WAL/shm through the writable alias before the reader opens.
    child = fork(fileURLToPath(import.meta.url), ['reader', path], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    exited = once(child, 'exit');
    exited.catch(() => {});
    const message = () => Promise.race([
      once(child, 'message').then(([value]) => value),
      exited.then(([code, signal]) => { throw new Error(`Reader exited before its witness: code=${code}, signal=${signal}`); }),
    ]);
    const pinned = await message();
    assert.equal(pinned.phase, 'pinned');
    report.reader = pinned; save();
    for (let i = 0; i < 16; i++) e.create('Row', { id: `Row-new-${i}`, body: 'x'.repeat(32768) });
    report.writerCount = e.query('Row').count(); assert.equal(report.writerCount, 17);
    report.walBytesWhilePinned = statSync(join(writablePath, 'data.sqlite3-wal')).size;
    assert(report.walBytesWhilePinned > 16 * 32768);
    report.blockedCheckpoint = database.all('PRAGMA wal_checkpoint(TRUNCATE)')[0];
    assert.equal(report.blockedCheckpoint.busy, 1);
    assert(report.blockedCheckpoint.checkpointed < report.blockedCheckpoint.log);
    child.send({ phase: 'release' });
    const released = await message();
    assert.equal(released.phase, 'released');
    report.released = released;
    const [code, signal] = await exited;
    assert.equal(code, 0); assert.equal(signal, null);
    report.readerExited = true;
    report.finalCheckpoint = database.all('PRAGMA wal_checkpoint(TRUNCATE)')[0];
    assert.equal(report.finalCheckpoint.busy, 0);
    report.walBytesAfterRelease = statSync(join(writablePath, 'data.sqlite3-wal')).size;
    assert.equal(report.walBytesAfterRelease, 0);
    assert.equal(e.query('Row').count(), 17);
    report.completed = true;
  } finally {
    try {
      if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    } finally {
      try { database?.close(); } finally { save(); }
    }
  }
}
