import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { _byDeadline } from '@apackdev/sdk/testing/waiting';
import { createFrontendResourceFixture, externalGlobConsumer, readFrontendOutput } from '../_support/frontend-resources.ts';
import { bundlePackFE } from '../../src/build/fe-bundler.ts';
import { createFrontendWatcher } from '../../src/build/frontend-watch.ts';

const fixture = createFrontendResourceFixture();

// One expression for each shape of input the compiler reports for a glob: the physical directory, the link into the
// pack, and a directory that does not exist yet. `frontend-globs.integration.spec.ts` holds every expression to its input.
it.each([
  'import.meta.glob("../../pages/**/*.js", { eager: true })',
  'import.meta.glob("#pages/**/*.js", { eager: true })',
  'name => import(`../../pages/nested/${name}.js`)',
])('delivers a page appearing in and leaving an initially empty external glob: %s', async expression => {
  const { pack, entryPoint, page } = externalGlobConsumer(fixture, expression);
  let onChange = () => {};
  const nextChange = () => new Promise<void>(resolve => { onChange = resolve; });
  const failures: Error[] = [];
  const watcher = createFrontendWatcher(pack, undefined, () => onChange(), error => { failures.push(error); });
  const compile = () => {
    const outputDir = path.join(pack, 'dist/runtime');
    fs.rmSync(outputDir, { recursive: true, force: true });
    return bundlePackFE({ packDir: pack, entryPoint, outputDir, onInputs: inputs => watcher.observe(inputs).then(() => {}) });
  };
  try {
    const first = await compile();
    expect(first.success, first.error).toBe(true);
    const before = watcher.snapshot();
    const added = nextChange();
    fs.mkdirSync(path.dirname(page));
    fs.writeFileSync(page, 'export const marker = "NEW_GLOB_PAGE";');
    await _byDeadline(added, 'the new page');
    expect(before.current()).toBe(false);
    const second = await compile();
    expect(second.success, second.error).toBe(true);
    expect(readFrontendOutput(pack, '.js')).toContain('NEW_GLOB_PAGE');
    const removed = nextChange();
    fs.unlinkSync(page);
    await _byDeadline(removed, 'the removed page');
  } finally { await watcher.close(); expect(failures).toEqual([]); }
});
