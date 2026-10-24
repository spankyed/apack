#!/usr/bin/env node
/**
 * Converts a copy of a data dir's databases from an older EARS storage format to the current one, in place:
 *
 *   npx tsx scripts/ears-convert.ts <data dir>
 *
 * Run it on a copy. The app refuses an older database rather than convert it at boot, so this is the one
 * place the conversion happens, explicitly, once (`convertToCurrentFormat`, `@apackdev/ears/lmdb`). It converts
 * the data dir's database a step per format, and prints what each step rewrote. An `ears-trace` directory beside it
 * is an older app's run history, which this version no longer reads: delete it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { convertToCurrentFormat } from '@apackdev/ears/lmdb';

/** The data dir's database directory, in the app's layout or directly */
function database(dataDir: string): string {
  for (const base of [path.join(dataDir, 'apack'), dataDir]) {
    const dir = path.join(base, 'ears-db');
    if (fs.existsSync(path.join(dir, 'data.mdb'))) return dir;
  }
  throw new Error(`No ears-db database under ${dataDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('usage: npx tsx scripts/ears-convert.ts <data dir>   (a copy: it converts in place)');
    process.exit(2);
  }
  const dir = database(path.resolve(dataDir));
  console.log(dir, JSON.stringify(convertToCurrentFormat(dir)));
}
