// Proves the Phase 3 type-aware oxlint boundary (`lint:type-aware` + `.oxlintrc.type-aware.json`) actually
// loads tsgolint and catches floating promises, misused promises, and awaiting non-thenables — rather than
// silently passing with zero type information.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';

const OXLINT = path.join(REPO_ROOT, 'node_modules', '.bin', 'oxlint');
const CONFIG = path.join(REPO_ROOT, '.oxlintrc.type-aware.json');

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('type-aware oxlint boundary', () => {
  it('catches floating promises, misused promises, and await-thenable with the repo config', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-oxlint-ta-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2024',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
      },
      include: ['bad.ts'],
    }));
    fs.writeFileSync(path.join(dir, 'bad.ts'), [
      'async function work(): Promise<number> { return 1; }',
      'export async function bad(): Promise<void> {',
      '  work();',
      '  const p = work();',
      '  if (p) { /* misused promise in condition */ }',
      '  await 42;',
      '}',
      '',
    ].join('\n'));

    let stdout = '';
    let stderr = '';
    try {
      ({ stdout, stderr } = await execFileWhileWorking(
        OXLINT,
        ['--type-aware', '-c', CONFIG, '-f', 'json', path.join(dir, 'bad.ts')],
        { cwd: dir },
      ));
    } catch (error) {
      stdout = (error as { stdout?: string }).stdout ?? '';
      stderr = (error as { stderr?: string }).stderr ?? '';
    }

    expect(stdout.trim(), `oxlint produced no JSON stdout (stderr: ${stderr})`).not.toBe('');
    const parsed = JSON.parse(stdout) as { diagnostics?: Array<{ code?: string }> };
    const codes = new Set((parsed.diagnostics ?? []).map((d) => d.code ?? ''));
    expect(codes).toContain('typescript(no-floating-promises)');
    expect(codes).toContain('typescript(no-misused-promises)');
    expect(codes).toContain('typescript(await-thenable)');
  });
});
