import { expect, it } from 'vitest';
import { build, type Options } from 'tsup';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import configure from '../../tsup.config.ts';

it('runs the API bundler’s SQLite entry with its package-owned native loader', async () => {
  const parent = fileURLToPath(new URL('../../.temp/', import.meta.url)); mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'sqlite-bundle-'));
  try {
    const entry = join(dir, 'probe.ts');
    writeFileSync(entry, `import {openDatabase} from '@apackdev/ears/sqlite';
      import {createEarsEngine} from '@apackdev/ears';import assert from 'node:assert/strict';
      const db=openDatabase({path:process.argv[2]!,syncs:false,schema:{types:{Row:{required:[],
        substrings:['title'],search:{fields:{title:1}},embed:{from:['title'],model:'probe',dims:3}}},relations:{},roles:[]}});
      try{const e=createEarsEngine({database:db});e.create('Row',{id:'Row-probe',title:'alpha marker'});
        const {model,chunks}=e.pendingEmbeddings('Row');e.embed(chunks.map(chunk=>({...chunk,model,vector:[1,0,0]})));
        assert.deepEqual(e.query('Row').matching('^alpha').ids(),['Row-probe']);
        assert.deepEqual(e.query('Row').search('alpha',{fuzzy:false}).ids(),['Row-probe']);
        assert.deepEqual(e.query('Row').near([1,0,0],{k:1}).ids(),['Row-probe']);
        process.stdout.write(db.format);
      }finally{db.close();}`);
    const options = typeof configure === 'function' ? await configure({ env: { NODE_ENV: 'development' } }) : configure;
    if (Array.isArray(options)) throw new Error('Expected one API build configuration');
    await build({ ...options, config: false, entry: [entry], outDir: join(dir, 'out'), format: ['esm'],
      dts: false, sourcemap: false, watch: false, clean: false, silent: true } as Options);
    const child = spawnSync(process.execPath, ['--experimental-strip-types', '--conditions=@apackdev/source', join(dir, 'out/probe.js'), join(dir, 'profile')], {
      encoding: 'utf8', timeout: 15000,
    });
    expect(child.status, child.stderr).toBe(0); expect(child.stdout).toBe('sqlite/1');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
