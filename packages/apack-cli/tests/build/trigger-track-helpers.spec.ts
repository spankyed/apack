import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generatePackFiles } from '@apackdev/pack-build';
import type { PackManifest } from '@apackdev/pack-format';

let tmp: string | undefined;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('generated trigger track builders', () => {
  it('reads trackField from declarations without scanning implementation spelling or neighboring modules', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'track-helpers-'));
    const stepDir = path.join(tmp, 'src', 'extensions', 'steps', 'tick');
    fs.mkdirSync(stepDir, { recursive: true });
    fs.writeFileSync(path.join(stepDir, 'build.ts'), "export function compile() { return {}; } export function decompile() { return {}; }\n");
    fs.writeFileSync(path.join(stepDir, 'unrelated.ts'), "export const other = { trackField: 'whenever' };\n");
    const manifest: PackManifest = {
      id: 'ticks', name: 'Ticks', version: '1.0.0',
      extensions: { steps: { tick: { node: { label: 'Tick' }, kind: 'trigger', trigger: { trackField: 'every', compile: 'src/extensions/steps/tick/build.ts#compile', decompile: 'src/extensions/steps/tick/build.ts#decompile' } } } },
    };

    const files = await generatePackFiles(manifest, { packRoot: tmp });
    const helpers = Object.entries(files).find(([file]) => file.endsWith('flow-helpers.ts'))?.[1] ?? '';

    expect(helpers).toMatch(/export function every\(every: string/);
    expect(helpers).not.toMatch(/whenever/);
  });
});
