import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { preparePack, packageJson, tsconfig } from '../_support/pack-builds.ts';
import { runCommand } from '../_support/run-command.ts';
import { cpuBudget } from '@apackdev/testing/vitest';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

// Four CLI commands, each bounded at 60s and run off the worker's event loop, then verification and cleanup
it('refuses skipped generation after a packaged helper chunk changes at the same CLI version', { meta: cpuBudget(4 * 60_000 + 20_000) }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-packaged-tool-'));
  roots.push(root);
  const cli = path.join(root, 'cli');
  fs.cpSync(path.join(REPO_ROOT, 'packages/apack-cli/dist/package'), cli, { recursive: true });
  const cliModules = path.join(cli, 'node_modules');
  fs.mkdirSync(cliModules);
  // Preserve npm's package-local overrides (the checkout root has AJV 6; this CLI needs AJV 8).
  for (const directory of [path.join(REPO_ROOT, 'node_modules'), path.join(REPO_ROOT, 'packages/apack-cli/node_modules')]) {
    for (const name of fs.readdirSync(directory).filter(name => !name.startsWith('.'))) {
      const target = path.join(cliModules, name);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      fs.symlinkSync(path.join(directory, name), target, 'dir');
    }
  }
  // The real bin hands off to the project's CLI. Pin this copied package, not the workspace CLI.
  const modules = path.join(root, 'node_modules');
  fs.mkdirSync(path.join(modules, '@apackdev'), { recursive: true });
  fs.symlinkSync(cli, path.join(modules, '@apackdev/cli'), 'dir');
  for (const name of ['sdk', 'ears', 'ui']) {
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules/@apackdev', name), path.join(modules, '@apackdev', name), 'dir');
  }
  const pack = preparePack(root, 'tool-consumer', {
    'apack.json': JSON.stringify({ id: 'tool-consumer', name: 'Tool Consumer', version: '1.0.0', data: { entities: { Memo: {} } } }),
    'package.json': packageJson('tool-consumer'), 'tsconfig.json': tsconfig,
  }, modules);
  const entry = path.join(cli, 'bin/apack.mjs');
  const generate = () => runCommand(process.execPath, [entry, 'pack', 'generate-entries'], pack);
  const first = await generate();
  expect(first.code, first.output).toBe(0);
  const unchanged = await generate();
  expect(unchanged.code, unchanged.output).toBe(0);
  expect(unchanged.output).toContain('inputs unchanged');
  const generated = fs.readFileSync(path.join(pack, 'src/__generated__/ears.ts'));
  const manifest = fs.readFileSync(path.join(cli, 'package.json'));
  const helper = fs.readdirSync(path.join(cli, 'dist')).find(file => file.startsWith('chunk-') && file.endsWith('.js'))!;
  fs.appendFileSync(path.join(cli, 'dist', helper), '\n// Changed helper implementation, unchanged CLI version.\n');
  const refused = await runCommand(process.execPath, [entry, 'pack', 'build', '--skip-generate', '--skip-fe'], pack);
  expect(refused.code, refused.output).toBe(1);
  expect(refused.output).toContain('Generated pack files are stale: inputs changed');
  expect(fs.readFileSync(path.join(pack, 'src/__generated__/ears.ts'))).toEqual(generated);
  expect(fs.readFileSync(path.join(cli, 'package.json'))).toEqual(manifest);
  const rebuilt = await generate();
  expect(rebuilt.code, rebuilt.output).toBe(0);
  expect(rebuilt.output).not.toContain('inputs unchanged');
  expect(fs.readFileSync(path.join(pack, 'src/__generated__/ears.ts'))).toEqual(generated);
});
