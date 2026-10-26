# EARS value compression

**Status:** superseded, not implemented, 2026-10-25: apack's engine moved onto elmdb ([ears-on-elmdb.md](ears-on-elmdb.md)),
so there is no `kv.ts` seam to compress in. Compression belongs to elmdb's value format, deferred there
(`elmdb/docs/roadmap.md`, Later).

Large values are most of the database, and they are text that compresses to about a quarter of its size. This plan
compresses each value above a threshold in the seam's value codec (`kv.ts`), with zstd from `node:zlib`, as storage
format 5.

## Why

On the converted production copy (the backup of 2026-10-17, 22,816 entities):

- 10,063 values over 512 bytes, mostly message text, hold 150.4 MB. The other 396,906 values hold 15.5 MB, and keys
  18 MB.
- Compacted, the file is 271 MB (`docs/plans/ears-storage-layout.md`, Step 5). The large values are most of it.

Compression shrinks the data itself, where compaction (`COMPACT_COPIES`) only removes the space deletes freed. The two
are independent and add up.

## What the compressors do on our data

Every value over 512 bytes in that copy, compressed one at a time, as the codec would (2026-10-24, MacBook Pro, Node
23.11, 74% idle):

| Codec | Size | Of the original | Encode per value | Decode per value |
|---|---|---|---|---|
| zstd, level 3 (zstd's default) | 36.5 MB | 24% | 58 µs | 21 µs |
| zstd, level 1 | 38.4 MB | 26% | 47 µs | 23 µs |
| deflate, level 6 | 37.7 MB | 25% | 237 µs | 31 µs |
| brotli, quality 4 | 35.1 MB | 23% | 150 µs | 38 µs |

zstd level 3 is the choice: within a few percent of the smallest, and the fastest to encode and decode. The 114 MB it
saves would take the compacted file from about 271 MB to about 157 MB.

**Availability.** `zlib.zstdCompressSync` is in Node 23.11 (the repo's floor is 23.5) and in the app's Electron 37
(Node 22.17), checked on both. It is still marked experimental in Node, which is the main risk (below).

## Design

**In our codec, not lmdb-js's `compression` option.** The seam owns how values are encoded (`createOrderedKV`'s
msgpackr encoder), so compressing there:

- covers both backends, so the memory backend, and every spec on it, exercises it;
- keeps the format ours, with nothing new depending on lmdb-js-specific behaviour (`docs/references/pr-274-review.md`
  has why that matters);
- avoids lmdb-js's compression, which its README describes as built for its asynchronous write path, which we don't
  use.

**A tag byte, only on compressed values.** The msgpack spec never uses the byte `0xc1`. A compressed value is `0xc1`
followed by the zstd frame of its msgpack encoding; every other value stays the plain msgpack it is today. So reading
one is: first byte `0xc1`, decompress then decode, otherwise decode. No flag on every value, and no extra byte on the
397k small ones.

msgpackr does write `0xc1` in two cases: with its `bundleStrings` option, and for its own `C1` marker object. Our
encoder (`useRecords: false, moreTypes: true, mapsAsObjects: false`) enables neither, and no stored value is `C1`,
so no plain value starts with it. That holds because of our encoder's settings, not the format, so a spec pins it: a
plain value never starts with `0xc1`, and a stored `C1` is refused rather than misread.

**A threshold, and only when it pays.** Values of at least `COMPRESS_FROM` bytes of msgpack (512 to start, set by
Step 1's readings) are compressed, and stored compressed only if that is smaller. Small values stay plain: they're
3% of the bytes, and compressing them costs CPU for little.

**Keys are never compressed.** Their byte order is the store's order. Index keys hold values up to 256 characters and
are keys, so they're unaffected.

**Format 5.** Format 4 data is valid format 5 data, since an untagged value reads exactly as it does now. The stamp
moves anyway, because a format 4 build would misread a compressed value: bumping it makes an older build refuse the
files, naming the conversion, as it refuses every newer format.

`convertToFormat5` compresses the large values already stored, in one unit, and records format 5. Run on a copy, as
every conversion is (`scripts/ears-convert.ts`). It is not a fallback read: once converted, every large value is
compressed, and new ones are written that way.

## Steps

### 1. The codec

- `encodeValue` and `decodeValue` in `kv.ts`: the tag, the threshold and the size check, with zstd level 3.
- The seam's contract (`tests/lmdb/ordered-kv.spec.ts`, both backends):
  - a value at the threshold and above round-trips, and is stored as fewer bytes;
  - a value below it is stored as today's msgpack, byte for byte;
  - a value that compresses badly (random bytes) is stored plain.
- Readings of the threshold on the production copy's values (256, 512, 1,024, 2,048), the size and a read of the
  largest thread each: pick `COMPRESS_FROM` from them.

**Done when:** the contract passes on both backends, and the model-based harness (`tests/engine/model-based.spec.ts`)
passes unchanged. Its workload already writes values of 2 KB and more, so it covers compressed values with no change.

### 2. Format 5 and its conversion

- `LMDB_FORMAT_VERSION = 5`, and `convertToFormat5`, which rewrites every value at the threshold or above, compressed,
  in one unit.
- `convertToCurrentFormat` takes format 4 to 5. With `COMPACT_COPIES` on, the convert script's compaction then
  reclaims the pages the rewrite freed.
- A spec in `tests/lmdb/convert.spec.ts`: a format 4 database converts, holds the same rows, and its large values are
  stored compressed.

**Done when:** the conversion spec passes, a converted copy of the production backup reads back the same entities,
and a format 4 build refuses a format 5 file by name.

### 3. Measured

On the production copy, converted to format 5, against Step 5 of the storage plan:

- size on disk, uncompacted and (with `COMPACT_COPIES` on) compacted;
- the ears bench on LMDB;
- a cold read of the largest thread, and `query('Message').pickAll()`;
- a create and an update of a large value, profiled (`node --cpu-prof`).

The trade to watch is reads: each large value read now pays about 21 µs to decode, against fewer pages read. A whole
read of messages decodes about 10k values, about 0.2 s of CPU, where it read 150 MB before.

**Done when:** each reading is recorded in this plan.

### 4. The app on format 5

- Convert the development data dir, on a copy, and boot the built API on it end to end.
- The ears guide (Persistence, Storage format) and the root guide's Data layer say values are compressed above the
  threshold.

**Done when:** the app boots on converted data, and the guides describe format 5.

## Risks

- **zstd is experimental in Node.** Its API could change before it's stable. If it moves, the codec is one function
  to adapt, and Electron pins the Node it ships, so a change arrives only with an Electron upgrade. The fallback is
  deflate: a 25% ratio, but four times slower to encode.
- **The write path.** A streaming message is rewritten every 80 ms as it grows (`stream-writer.ts`), and each rewrite
  re-compresses it: about 58 µs per write, small against a commit, but it is measured in Step 3 rather than assumed.
- **Mixed values in one file.** A file holds compressed and plain values side by side. That's by design (the
  threshold) and costs nothing, since the tag says which is which.

## Open

- `COMPRESS_FROM`: 512 to start; Step 1's readings decide.
- A shared dictionary: zstd can compress small values well with one trained on our data, but it then becomes part of
  the format and has to ship with it. Not now; revisit if small values grow to matter.

## Out of scope

- lmdb-js's `compression` option, for the reasons under Design.
- Compressing keys, which would break their order.
- Encryption at rest, a separate product decision.
- The run history's record store, which holds whole records as JSON and is small; it can follow the same codec later.
