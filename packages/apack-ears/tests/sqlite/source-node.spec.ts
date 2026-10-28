import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

it('opens the app-only storage entry with plain Node source conditions and owned regex assets', () => {
  const regex = new URL('../../src/sqlite/regex.ts', import.meta.url).href;
  const code = `import assert from 'node:assert/strict';
    import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
    import {openDatabase} from '@apackdev/ears/sqlite';
    import {createRegexCompiler} from ${JSON.stringify(regex)};
    const dir=mkdtempSync(join(tmpdir(),'ears-node-source-'));let db;
    try{db=openDatabase({path:dir,syncs:false,schema:{types:{Row:{required:[]}},relations:{},roles:[]}});
      assert.equal(db.format,'sqlite/1');assert(db.stats().fileBytes>0);
      const pattern=createRegexCompiler().compile('Alpha');try{assert(pattern.matches('Alpha'));}finally{pattern.close();}
      process.stdout.write('source-storage-ok');
    }finally{db?.close();rmSync(dir,{recursive:true,force:true});}`;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--conditions=@apackdev/source', '--input-type=module', '-e', code], {
    encoding: 'utf8', timeout: 15000,
  });
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toBe('source-storage-ok');
});
