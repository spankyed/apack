import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createEarsEngine } from '../../src/index.ts';
import { createTemporaryDatabases } from '../../src/sqlite/index.ts';

const schema = { types: { Row: { required: [] } }, relations: {}, roles: [] };
describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite watch ownership', () => {
  it('releases tracked dependencies when closing under a pending watch', async () => {
    const temporary = createTemporaryDatabases(), { database } = temporary.open(schema);
    try {
      const e = createEarsEngine({ database });
      const id = e.create('Row', { title: 'before' }).id();
      e.watch(() => e.getAttr(id, 'title'), () => {});
      await e.admin.watchesSettled();
      expect(database.trackStats().owners).toBe(1);
      e.write(id).set('title', 'after');
      database.close();
      await e.admin.watchesSettled();
      expect(e.admin.watchStats()).toEqual({ watches: 0, keys: 0, ranges: 0 });
      expect(database.trackStats()).toEqual({ owners: 0, keys: 0, ranges: 0 });
    } finally { temporary.disposeAll(); }
  });

  it.each(['caller', 'observer', 'unawaited'] as const)('owns only explicit settlement waits (%s)', (mode) => {
    const engine = new URL('../../src/index.ts', import.meta.url).href;
    const factory = new URL('../../src/sqlite/index.ts', import.meta.url).href;
    const code = `
      import { writeSync } from 'node:fs';
      const { createEarsEngine } = await import(${JSON.stringify(engine)});
      const { createTemporaryDatabases } = await import(${JSON.stringify(factory)});
      const temporary = createTemporaryDatabases();
      const { database } = temporary.open(${JSON.stringify(schema)});
      const e = createEarsEngine({ database });
      const id = e.create('Row', { title: 'before' }).id();
      let seen;
      let resolve;
      const done = new Promise(r => { resolve = r; });
      e.watch(() => {
        const until = performance.now() + 10;
        while (performance.now() < until) {}
        return e.getAttr(id, 'title');
      }, value => {
        seen = value;
        if (${JSON.stringify(mode)} === 'observer' && value === 'before') {
          const settled = e.admin.watchesSettled();
          e.write(id).set('title', 'after');
          settled.then(resolve);
        }
      });
      if (${JSON.stringify(mode)} === 'observer') await done;
      else {
        await e.admin.watchesSettled();
        e.write(id).set('title', 'after');
        if (${JSON.stringify(mode)} === 'caller') {
          await new Promise(r => setImmediate(r));
          await e.admin.watchesSettled();
        }
        else {
          // Let the flush schedule its gap; the pending watch must not own process lifetime.
          await new Promise(r => setImmediate(r));
          process.on('exit', () => writeSync(1, JSON.stringify({ seen })));
          await new Promise(() => {});
        }
      }
      writeSync(1, JSON.stringify({ seen }));
      temporary.disposeAll();
    `;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
    expect(result.status, result.stderr).toBe(mode === 'unawaited' ? 13 : 0);
    expect(JSON.parse(result.stdout)).toEqual({ seen: mode === 'unawaited' ? 'before' : 'after' });
  });
});
