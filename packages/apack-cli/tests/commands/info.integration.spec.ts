// @slow: two actual pack builds plus offline CLI inspection and validation through the dependent facade.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { buildPack, preparePack, packageJson, tsconfig, CLI } from '../_support/pack-builds.ts';
import { runCommand } from '../_support/run-command.ts';
import { cpuBudget } from '@apackdev/testing/vitest';

let root: string | undefined;
afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); root = undefined; });

describe('external pack offline inspection', () => {
  it('reports authentic compiled content and cached dependency provenance after producer source removal', { meta: cpuBudget(5 * 60_000 + 20_000) }, async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-info-external-'));
    const producerManifest = { id: 'info-provider', name: 'Info provider', version: '1.0.0',
      data: { entities: { InfoMemo: {} } }, lifecycle: { onInit: 'src/hooks.ts#onInit' },
      content: { formats: { memos: { format: 'json', entity: 'InfoMemo', identity: ['name'] } },
        sources: { memos: { path: 'content/memos.json', format: 'memos' } } },
    };
    const producer = preparePack(root, producerManifest.id, {
      'apack.json': JSON.stringify(producerManifest), 'package.json': packageJson(producerManifest.id), 'tsconfig.json': tsconfig,
      'src/hooks.ts': 'throw new Error("Inspection activated the producer"); export function onInit() {}',
      'content/memos.json': JSON.stringify([{ name: 'one', description: 'First memo' }, { name: 'two' }]),
    }, path.join(REPO_ROOT, 'node_modules'));
    await buildPack(producer);
    const consumerManifest = { id: 'info-consumer', name: 'Info consumer', version: '1.0.0',
      dependencies: { 'info-provider': `file:${producer}` },
    };
    const consumer = preparePack(root, consumerManifest.id, {
      'apack.json': JSON.stringify(consumerManifest), 'package.json': packageJson(consumerManifest.id), 'tsconfig.json': tsconfig,
    }, path.join(REPO_ROOT, 'node_modules'));
    await buildPack(consumer);
    fs.rmSync(path.join(producer, 'src'), { recursive: true });
    fs.rmSync(path.join(producer, 'content'), { recursive: true });
    const inspected = await runCommand(process.execPath, [CLI, 'pack', 'info', '--json'], producer);
    expect(inspected.code, inspected.output).toBe(0);
    expect(JSON.parse(inspected.stdout).build.content.entries).toMatchObject([
      { key: 'memos', count: 2, items: [{ key: 'one', description: 'First memo' }, { key: 'two' }] },
    ]);
    const record = path.join(consumer, '.apack/deps/info-provider/resolution.json');
    const recorded = fs.readFileSync(record);
    fs.rmSync(producer, { recursive: true });
    fs.writeFileSync(path.join(consumer, 'apack.json'), JSON.stringify({ ...consumerManifest, dependencies: { 'info-provider': '^1.0.0' } }));
    const cached = await runCommand(process.execPath, [CLI, 'pack', 'info', '--json'], consumer);
    expect(cached.code, cached.output).toBe(0);
    expect(JSON.parse(cached.stdout).dependencies).toMatchObject([
      { id: 'info-provider', version: '1.0.0', delivery: 'cache', origin: { kind: 'file', directory: producer } },
    ]);
    const doctor = await runCommand(process.execPath, [CLI, 'pack', 'doctor', '--json'], consumer);
    expect(doctor.code, doctor.output).toBe(0);
    const report = JSON.parse(doctor.stdout);
    expect(report.status).toBe('valid');
    expect(report.dependencies).toEqual(JSON.parse(cached.stdout).dependencies);
    expect(fs.readFileSync(record)).toEqual(recorded);
    expect(inspected.output + cached.output + doctor.output).not.toContain('Inspection activated');
  });
});
