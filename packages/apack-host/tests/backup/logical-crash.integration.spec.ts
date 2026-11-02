import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { afterEach, expect, it } from 'vitest';
import { createEarsEngine } from '@apackdev/ears';
import { openDatabase, stageLogicalSnapshot } from '@apackdev/ears/sqlite';
import { exportLogicalDatabase } from '../../src/backup/logical.ts';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it.each(['before', 'after'] as const)('retains exclusive complete archive semantics when killed %s publication', async point => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'apack-logical-crash-')); roots.push(root);
  const source = path.join(root, 'source'), target = path.join(root, 'snapshot.ears');
  const db = openDatabase({ path: source, syncs: false, schema: { types: { Row: { required: [] } }, relations: {}, roles: [] } });
  const e = createEarsEngine({ database: db }); e.create('Row', { id: 'Row-one', text: 'x'.repeat(256000), negative: -0 });
  const sequence = e.lastCommit(); db.close();
  const module = new URL('../../src/backup/logical.ts', import.meta.url).href;
  const code = `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    import {openDatabase} from '@apackdev/ears/sqlite';
    const [source,target,point]=process.argv.slice(1), link=fs.linkSync, deadline=performance.now()+10000;
    const stop=()=>{
      fs.writeSync(1,JSON.stringify({point,targetExists:fs.existsSync(target)})+'\\n');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.max(0,deadline-performance.now()));
      process.exit(2);
    };
    fs.linkSync=(from,to)=>{
      if(to===target&&point==='before')stop();
      const result=link(from,to);
      if(to===target&&point==='after')stop();
      return result;
    };
    syncBuiltinESMExports();
    const {exportLogicalDatabase}=await import(${JSON.stringify(module)});
    const db=openDatabase({path:source,readOnly:true});
    try{await exportLogicalDatabase(db,target);}finally{db.close();}
  `;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, source, target, point], { timeout: 10000, killSignal: 'SIGKILL' });
  const exited = once(child, 'exit'), lines = createInterface({ input: child.stdout }); let stderr = '';
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
  try {
    const [line] = await Promise.race([once(lines, 'line'), exited.then(([status, signal]) => {
      throw Error(`Archive child exited before its publication witness: ${status}/${signal}: ${stderr}`);
    })]);
    expect(JSON.parse(String(line))).toEqual({ point, targetExists: point === 'after' });
    expect(child.kill('SIGKILL'), stderr).toBe(true); const [, signal] = await exited; expect(signal, stderr).toBe('SIGKILL');
    const reader = openDatabase({ path: source, readOnly: true });
    try {
      expect(reader.sequence).toBe(sequence); expect(Object.is(createEarsEngine({ database: reader }).getAttr('Row-one', 'negative'), -0)).toBe(true);
      if (point === 'before') {
        expect(fs.existsSync(target)).toBe(false);
        // Process death leaves private scratch; a retry must own a new directory and leave the old one alone.
        const scratch = fs.readdirSync(root).filter(name => name.startsWith('.apack-logical-export-'));
        expect(scratch.length).toBeGreaterThan(0);
        await exportLogicalDatabase(reader, target);
        for (const directory of scratch) expect(fs.existsSync(path.join(root, directory))).toBe(true);
      } else {
        const bytes = fs.readFileSync(target);
        await expect(exportLogicalDatabase(reader, target)).rejects.toMatchObject({ code: 'EEXIST' });
        expect(fs.readFileSync(target)).toEqual(bytes);
      }
    } finally { reader.close(); }
    const staged = await stageLogicalSnapshot(fs.createReadStream(target), path.join(root, 'check'));
    expect(staged).toMatchObject({ sequence, audit: { ok: true, checkedEntities: 1 } });
    const restored = openDatabase({ path: staged.path, readOnly: true });
    try { expect(createEarsEngine({ database: restored }).getAttr('Row-one', 'text')).toBe('x'.repeat(256000)); } finally { restored.close(); }
  } finally {
    lines.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  }
});
