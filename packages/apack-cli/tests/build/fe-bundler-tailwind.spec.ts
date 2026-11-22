import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundlePackFE } from '../../src/build/fe-bundler';

// Computed here rather than taken from @app/internal-publish-checks, whose import checks that
// the published packages' dist is up to date — irrelevant to this suite, which builds from source.
const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

/**
 * A pack whose Tailwind setup doesn't work must never build quietly: the bundle would load with
 * every component unstyled and nothing to read anywhere. See `tailwindPostcssPlugins`.
 */

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

interface PackFiles {
  manifest?: Record<string, unknown> | string;
  tailwindConfig?: string;
  entry?: string;
  /** Link the repo's node_modules, so @apackdev/ui and vue resolve (default: yes) */
  linkNodeModules?: boolean;
}

function makePack({ manifest = {}, tailwindConfig, entry, linkNodeModules = true }: PackFiles): string {
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-tw-'));
  tmpDirs.push(packDir);
  fs.writeFileSync(path.join(packDir, 'package.json'), JSON.stringify({ name: 'tw-pack', type: 'module' }));
  fs.writeFileSync(
    path.join(packDir, 'apack.json'),
    typeof manifest === 'string'
      ? manifest
      : JSON.stringify({ id: 'tw-pack', name: 'TW Pack', version: '1.0.0', ...manifest }),
  );
  if (linkNodeModules) fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(packDir, 'node_modules'), 'dir');
  if (tailwindConfig !== undefined) fs.writeFileSync(path.join(packDir, 'tailwind.config.ts'), tailwindConfig);
  fs.mkdirSync(path.join(packDir, 'src'));
  fs.writeFileSync(path.join(packDir, 'src', 'entry.ts'), entry ?? "export const cls = 'text-[#abc123]';\n");
  return packDir;
}

function build(packDir: string) {
  return bundlePackFE({ packDir, outputDir: path.join(packDir, 'dist'), entryPoint: path.join(packDir, 'src', 'entry.ts') });
}

function emittedCss(packDir: string): string {
  const dist = path.join(packDir, 'dist');
  return fs.readdirSync(dist)
    .filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(dist, f), 'utf-8'))
    .join('\n');
}

describe('pack FE Tailwind setup', () => {
  it('generates the classes a pack uses', async () => {
    const packDir = makePack({});
    const result = await build(packDir);
    expect(result).toEqual({ success: true });
    expect(emittedCss(packDir)).toContain('#abc123');
  });

  it('fails the build when a pack that bundles @apackdev/ui has a tailwind.config that throws', async () => {
    const packDir = makePack({
      manifest: { build: { bundleUi: true } },
      tailwindConfig: "throw new Error('bad tailwind config');\n",
    });
    const result = await build(packDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('tailwind.config.ts');
    expect(result.error).toContain('bad tailwind config');
  });

  it("fails the build when a bundleUi pack's tailwind.config has no usable content", async () => {
    const packDir = makePack({
      manifest: { build: { bundleUi: true } },
      tailwindConfig: 'export default { theme: {} };\n',
    });
    const result = await build(packDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('`content`');
  });

  it("fails the build when a bundleUi pack can't resolve @apackdev/ui", async () => {
    const packDir = makePack({ manifest: { build: { bundleUi: true } }, linkNodeModules: false });
    const result = await build(packDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('@apackdev/ui');
    expect(result.error).toContain('build.bundleUi');
  });

  /** A bundleUi pack whose @apackdev/ui resolves but has no build: a checkout before packages:build */
  function uiWithoutBuild(): string {
    const packDir = makePack({ manifest: { build: { bundleUi: true } }, linkNodeModules: false });
    const modules = path.join(packDir, 'node_modules', '@apackdev');
    fs.mkdirSync(path.join(modules, 'ui'), { recursive: true });
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, 'node_modules'))) {
      if (entry === '@apackdev' || entry.startsWith('.')) continue;
      fs.symlinkSync(path.join(REPO_ROOT, 'node_modules', entry), path.join(packDir, 'node_modules', entry), 'dir');
    }
    fs.symlinkSync(path.join(REPO_ROOT, 'packages', 'apack-sdk'), path.join(modules, 'sdk'), 'dir');
    fs.writeFileSync(path.join(modules, 'ui', 'package.json'), JSON.stringify({ name: '@apackdev/ui', version: '0.0.0', exports: { '.': './dist/index.js', './package.json': './package.json' } }));
    return packDir;
  }

  it("fails the build when a bundleUi pack's @apackdev/ui has no build to read classes from", async () => {
    // Resolving the package isn't enough: Tailwind reads its compiled output, and an empty dist globs
    // nothing, which would ship every @apackdev/ui component unstyled with no error at all.
    const packDir = uiWithoutBuild();

    const result = await build(packDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('@apackdev/ui has no built modules');
    expect(result.error).toContain('packages:ensure');
  });

  it("fails the build when a bundleUi pack's @apackdev/ui dist holds no module to read", async () => {
    // A dist with only declarations in it is the same silence: Tailwind's glob matches no file either
    // way, so "the directory exists and is not empty" is not the question worth asking
    const packDir = uiWithoutBuild();
    const dist = path.join(packDir, 'node_modules', '@apackdev', 'ui', 'dist', 'design');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'button.d.ts'), 'export declare const x: number;\n');

    const result = await build(packDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('@apackdev/ui has no built modules');
  });

  it("fails the build when apack.json can't be read, so build.bundleUi is unknown", async () => {
    const packDir = makePack({ manifest: '{ not json' });
    const result = await build(packDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('apack.json');
    expect(result.error).toContain('build.bundleUi');
  });

  /**
   * An unparseable tsconfig fails the build, and nothing in this build reads that file to say so.
   *
   * The case has been rewritten twice for the same reason each time — it was pinning a *mechanism* rather
   * than a property. It began as a block comment, because the alias reader's line-comment stripping could
   * not parse one and the build carried on without the aliases; when that reader moved to TypeScript's own
   * (`c9033ebd7`) it became a tsconfig no reader can make sense of, warning and then failing; and now the
   * reader is gone entirely, packs naming their own modules with `#` subpath imports, so there is no warning
   * left to assert.
   *
   * What survived all three is the property worth having: **Vite parses the pack's tsconfig itself and
   * refuses it.** That does not depend on anything this repo wrote.
   */
  it('does not build a pack whose tsconfig cannot be parsed', async () => {
    const packDir = makePack({});
    fs.writeFileSync(path.join(packDir, 'tsconfig.json'), '{ "compilerOptions": { not json');

    const result = await build(packDir);

    expect(result.success, 'vite parses the same file and refuses it').toBe(false);
    expect(String((result as { error?: unknown }).error)).toContain('tsconfig.json');
  });
});

describe('pack FE Tailwind setup when Tailwind cannot be loaded', () => {
  async function buildWithoutTailwind(packDir: string) {
    vi.resetModules();
    vi.doMock('tailwindcss', () => { throw new Error('Cannot find module tailwindcss'); });
    try {
      const { bundlePackFE: bundle } = await import('../../src/build/fe-bundler');
      return await bundle({ packDir, outputDir: path.join(packDir, 'dist'), entryPoint: path.join(packDir, 'src', 'entry.ts') });
    } finally {
      vi.doUnmock('tailwindcss');
      vi.resetModules();
    }
  }

  it('warns and builds on for a pack that gave no sign it needs Tailwind', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const packDir = makePack({});
    const result = await buildWithoutTailwind(packDir);
    expect(result.success).toBe(true);
    expect(warn.mock.calls.flat().join('\n')).toContain("Tailwind CSS couldn't be loaded");
  });

  it('fails the build for a pack that bundles @apackdev/ui', async () => {
    const packDir = makePack({ manifest: { build: { bundleUi: true } } });
    const result = await buildWithoutTailwind(packDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Tailwind CSS couldn't be loaded");
    expect(result.error).toContain('build.bundleUi');
  });

  it('fails the build for a pack that has its own tailwind.config', async () => {
    const packDir = makePack({ tailwindConfig: "export default { content: ['./src/**/*.ts'] };\n" });
    const result = await buildWithoutTailwind(packDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('tailwind.config.ts');
  });
});
