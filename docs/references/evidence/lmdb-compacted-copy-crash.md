# A compacted LMDB copy aborts the process when it is emptied

Found 2026-10-24, while measuring `reset()` on the converted production copy. lmdb-js 3.5.9 (the newest release),
Node 23.11.1, macOS arm64.

**What happens.** A database copied with LMDB's compacting copy (`root.backup(dir, true)`, `mdb_env_copy2` with
`MDB_CP_COMPACT`), opened and then emptied in one write transaction, aborts the process:

```
../dependencies/lmdb/libraries/liblmdb/mdb.c:2953: Assertion 'key.mv_size > 0' failed in mdb_page_alloc()
```

The same data, uncompacted, empties fine. It is an abort, not an exception: nothing in JavaScript can catch it.

**What it takes.** Values that span several overflow pages. Compacted databases of small values did not crash (50k and
200k entries, 4 KB and 16 KB pages, with and without deletes before the copy). The repro below, with 16 KB pages and
one value in twenty between 2 KB and 64 KB:

| Entries | Compacted | Uncompacted |
|---|---|---|
| 500, 2,000, 5,000 | empties fine | — |
| 20,000 | aborts | empties fine |
| 100,000 | aborts | empties fine |
| 400,000 (values up to 256 KB) | aborts | — |

On the converted production copy (22,816 entities, 5,526 values over 2 KB): compacted by `compactEnvironment` or by
`copyTo`, a `reset()` aborted every time (7 runs); uncompacted, it took 18–34 ms (6 runs). Dropping the old format's
emptied tables before compacting did not change it, so it is not the conversion's leftovers.

**Cause.** A compacting copy writes an empty freeDB but keeps the source's txnid. The first transaction that frees
enough pages to need overflow pages for its free list (dropping a named database of multi-page values does) reaches
`mdb_page_alloc` while `mdb_freelist_save` has made the freeDB's root an empty leaf. With a txnid above 1, its reverse
scan of the freeDB lands on that leaf, where a cursor reads no key, and asserts. A fresh uncompacted file still has a
txnid of 1 or 2, so the scan never starts, and a long-lived one has a non-empty freeDB. Fixed upstream by
kriszyp/lmdb-js#381: an empty freeDB has nothing to load, so the scan stops before it.

**What it means here.** Nothing compacts while `COMPACT_COPIES` (`@apackdev/ears/lmdb`) is off: `copyTo` copies
uncompacted, and `compactEnvironment` refuses. A compacted file that became a live database could abort the app on a
reset, and may on any large delete. What compaction saves is space LMDB reuses for later writes anyway.

**Next action:** once `lmdb` is a release with #381, run the repro's 20,000-entry case against it, then turn
`COMPACT_COPIES` on.

## Repro

```ts
// node --import tsx repro.mts <dir> <entries> <max value KB> [compacted|uncompacted]
import * as fs from 'node:fs'; import * as path from 'node:path';
import { open } from 'lmdb';
const [base, count, maxKb, mode = 'compacted'] = process.argv.slice(2);
const src = path.join(base, 'src'), dst = path.join(base, 'dst');
fs.rmSync(base, { recursive: true, force: true }); fs.mkdirSync(src, { recursive: true }); fs.mkdirSync(dst);
const opts = { maxDbs: 8, overlappingSync: false, pageSize: 16384 };
let root = open({ path: src, ...opts });
let db = root.openDB({ name: 'kv', keyEncoding: 'binary', encoding: 'binary', compression: false });
let seed = 1; const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
root.transactionSync(() => {
  for (let i = 0; i < Number(count); i++) {
    const big = rand() < 0.05;
    db.putSync(Buffer.from(`k${String(i).padStart(7, '0')}`), Buffer.alloc(big ? Math.floor(rand() * Number(maxKb) * 1024) + 2048 : 80, i & 255));
  }
});
root.close();
let target = src;
if (mode === 'compacted') {
  const from = open({ path: src, ...opts, readOnly: true });
  await from.backup(dst, true);
  from.close();
  target = dst;
}
root = open({ path: target, ...opts });
db = root.openDB({ name: 'kv', keyEncoding: 'binary', encoding: 'binary', compression: false });
root.transactionSync(() => db.clearSync(), 3);
console.log(`${mode}: ${count} entries, values up to ${maxKb} KB: cleared fine`);
root.close();
```

`node --import tsx repro.mts /tmp/r 20000 64` aborts; `... 20000 64 uncompacted` prints `cleared fine`.
