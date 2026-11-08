// Real pack builds pass definitions directly to the compiler; they never register them in the
// runtime registry the process has bound (an app's or a test's).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PACK_LAYOUT } from '@apackdev/host/packs';
import { startTestRuntime } from '@apackdev/sdk/testing';
import { stepRegistry } from '@apackdev/sdk/steps';
import { createPackRegistry } from '@apackdev/host/packs';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { build } from '../../src/commands/build';
import { cpuBudget } from '@apackdev/testing/vitest';

const bound = createPackRegistry();
const roots: string[] = [];

beforeAll(() => {
  process.env.APACK_ENV ??= 'test';
  process.env.APACK_USER_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'apack-build-registry-data-'));
  startTestRuntime({ packs: bound });
});
afterAll(() => { for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true }); });

/**
 * The pack: two step definitions, and one flow whose single step is `stepInFlow`.
 *
 * **A directory of its own per case**, because the content compiler loads a pack's TypeScript through tsx, which
 * caches by path: two packs at one path leave the second case compiling the first one's flow, and reporting it.
 */
function pack(stepInFlow: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-build-registry-'));
  roots.push(root);
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  write('package.json', JSON.stringify({ name: 'registry-pack', type: 'module' }));
  write('apack.json', JSON.stringify({
    id: 'registry-pack', name: 'Registry pack', version: '1.0.0',
    // Declared here, which is what makes the generated module below the pack's own steps
    extensions: {
      steps: {
        listener: { kind: 'trigger', node: { label: 'Listener' }, trigger: { trackField: "event", compile: 'src/steps/listener/build.ts#compile', decompile: 'src/steps/listener/build.ts#decompile' } },
        note: { node: { label: 'Note' }, build: { compile: 'src/steps/note/build.ts#compile', validate: 'src/steps/note/build.ts#validate', getLabel: 'src/steps/note/build.ts#getLabel' } },
      },
    },
    content: { sources: { flows: 'src/content/flows' } },
  }));
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  write('src/steps/listener/build.ts', "export const listenerNode = { label: 'Listener' };\nexport const compile = () => ({});\nexport const decompile = () => ({});\n");
  write('src/steps/note/build.ts', "export const noteNode = { label: 'Note' };\nexport const compile = () => ({ entity: {}, relations: [] });\nexport const validate = () => [];\nexport const getLabel = () => 'Note';\n");
  write('src/content/flows/main.ts', `export default { Main: [{ event: 'flow.entry', exits: [[{ type: '${stepInFlow}' }]] }] };\n`);
  return root;
}

async function compiledContent(root: string): Promise<string> {
  const cwd = process.cwd();
  process.chdir(root);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await build([]);
    return log.mock.calls.flat().join('\n');
  } finally {
    process.chdir(cwd);
    vi.restoreAllMocks();
  }
}

describe('a build', () => {
  it('compiles flows against the steps it loaded, and leaves the bound registry untouched', { meta: cpuBudget(2 * 60_000 + 20_000) }, async () => {
    const root = pack('note');
    expect(await compiledContent(root), 'the flow compiled using its loaded step definitions')
      .toMatch(/flows: 1/);
    expect(bound.steps(), 'and the registry this process bound saw none of them').toEqual([]);
    expect(stepRegistry.all()).toEqual([]);

    expect(fs.existsSync(path.join(root, 'dist', PACK_LAYOUT.contentDir, 'flows.content.json'))).toBe(true);
    const receipt = fs.readFileSync(path.join(root, 'dist', PACK_LAYOUT.integrity), 'utf8');
    await expect(build(['--skip-fe'], root)).rejects.toThrow('missing required runtime/fe.js');
    expect(fs.readFileSync(path.join(root, 'dist', PACK_LAYOUT.integrity), 'utf8')).toBe(receipt);
  });

  it('refuses a flow that names an undeclared step', async () => {
    const root = pack('no-such-step');
    await expect(compiledContent(root)).rejects.toThrow('Invalid step type: "no-such-step"');
    expect(fs.existsSync(path.join(root, 'dist', PACK_LAYOUT.snapshot))).toBe(false);
    expect(bound.steps()).toEqual([]);
    expect(stepRegistry.all()).toEqual([]);
  });
});
