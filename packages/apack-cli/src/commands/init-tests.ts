import * as fs from 'node:fs';
import * as path from 'node:path';
import { packFeatures } from '@apackdev/sdk/build';
import { renderTemplate } from '../templates.ts';
import { cliVersion, findPackRoot } from '../utils';
import { scaffoldUnitTestSetup } from './init';

// The Playwright version @apackdev/testing is tested with
const PLAYWRIGHT_RANGE = '^1.55.1';


/**
 * Two files rather than one template with a placeholder: the difference is two *statements* — real calls when
 * the pack has a surface, commented-out ones when it does not — and a placeholder in a statement slot would stop
 * the template parsing as TypeScript, which is what lets every rule read it (`src/templates.ts`).
 */
function sampleTest(surfaceId: string | undefined): string {
  return surfaceId
    ? renderTemplate('pack/tests/e2e/smoke.spec.ts', { SURFACE_ID: surfaceId })
    : renderTemplate('pack/tests/e2e/smoke-without-surface.spec.ts');
}

export async function initTests(_args: string[]): Promise<void> {
  if (_args.length) throw new Error('Usage: apack pack init-tests');
  const cwd = findPackRoot(process.cwd());
  const manifestPath = path.join(cwd, 'apack.json');

  if (!fs.existsSync(manifestPath)) {
    console.error('No apack.json found in current directory. Run this from your pack root.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const feat = packFeatures(manifest).find((f) => f.surface);
  const surfaceId: string | undefined = feat?.id;

  const configPath = path.join(cwd, 'playwright.config.ts');
  if (fs.existsSync(configPath)) {
    console.log('playwright.config.ts already exists, skipping');
  } else {
    fs.writeFileSync(configPath, renderTemplate('pack/playwright.config.ts'));
    console.log('Created playwright.config.ts');
  }

  const testDir = path.join(cwd, 'tests', 'e2e');
  fs.mkdirSync(testDir, { recursive: true });

  const smokeFile = path.join(testDir, 'smoke.spec.ts');
  if (fs.existsSync(smokeFile)) {
    console.log('tests/e2e/smoke.spec.ts already exists, skipping');
  } else {
    fs.writeFileSync(smokeFile, sampleTest(surfaceId));
    console.log('Created tests/e2e/smoke.spec.ts');
  }

  const gitignorePath = path.join(cwd, '.gitignore');
  const gitignoreEntries = ['.apack/'];
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf-8');
    const toAdd = gitignoreEntries.filter(e => !existing.includes(e));
    if (toAdd.length > 0) {
      fs.appendFileSync(gitignorePath, '\n# Test output\n' + toAdd.join('\n') + '\n');
      console.log('Updated .gitignore with test output paths');
    }
  } else {
    fs.writeFileSync(gitignorePath, '# Test output\n' + gitignoreEntries.join('\n') + '\n');
    console.log('Created .gitignore with test output paths');
  }

  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    // `playwright-core` beside the runner, because the two paths need different halves of it: a script
    // runs on `@playwright/test`, and `npm run dev:drive -- --eval` attaches with `playwright-core`'s
    // `connectOverCDP`. It arrives by hoisting under npm, so the attach usually works without it being
    // declared — and "usually" is the problem: under pnpm or `--no-hoist` the bare import misses and the
    // author meets an install hint for something `init-tests` could have written. The three ship in
    // lockstep, so one range names all of them.
    const wanted: Record<string, string> = {
      '@apackdev/testing': `^${cliVersion()}`,
      '@playwright/test': PLAYWRIGHT_RANGE,
      'playwright-core': PLAYWRIGHT_RANGE,
    };
    const missing = Object.keys(wanted).filter(name => !pkg.devDependencies?.[name] && !pkg.dependencies?.[name]);
    if (missing.length > 0) {
      pkg.devDependencies = { ...pkg.devDependencies, ...Object.fromEntries(missing.map(name => [name, wanted[name]])) };
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      console.log(`Added ${missing.join(', ')} to devDependencies. Run: npm install`);
    }
  }

  // Both halves, because a pack has both: `apack pack test` needs an app and `apack pack test --contract` does not.
  // Scaffolding only the Playwright half left an author with no way to check compiled output without one.
  if (!fs.existsSync(path.join(cwd, 'tests', 'setup.ts'))) {
    const { keptConfig, addedDependencies, upgrades } = scaffoldUnitTestSetup(cwd);
    console.log('Created tests/setup.ts for the contract half (@apackdev/testing/harness)');
    if (keptConfig) {
      console.log(`  ${keptConfig} already exists: give its test options isolatedDataDir()'s env and globalSetup, and setupFiles: [...dataDir.setupFiles, './tests/setup.ts'] (@apackdev/testing/vitest)`);
    } else {
      console.log('Created vitest.config.ts');
    }
    if (addedDependencies.length > 0) console.log(`  Added ${addedDependencies.join(', ')} to devDependencies. Run: npm install`);
    if (upgrades.length > 0) {
      console.log(`  The harness can't run on the pack's ${upgrades.map(({ name, reason }) => `${name} (${reason})`).join(', ')}.`);
      console.log(`  Upgrade: npm install -D ${upgrades.map(({ name, range }) => `${name}@"${range}"`).join(' ')}`);
    }
  }

  console.log('\nTo run tests:');
  console.log('  apack pack test --contract   # the pack\'s vitest, no app');
  console.log('  apack pack test              # Playwright, in apack');
}
