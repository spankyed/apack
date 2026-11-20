// Derive a reviewed facade report from current sources, or reuse a verified current build explicitly.
// The build path is read-only: it replays the common input record instead of regenerating entries.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { compareFacadeReport, facadeReportFile, facadeReportText, readBuiltFacadeReport, shownPath } from '../build/facade-report';
import { bundlePackTypes } from '../build/types-bundler';
import { assertGeneratedCurrent, generateEntries } from './generate-entries';
import { findPackRoot, readValidManifest } from '../utils';
import { resolveDeps } from './generate';

export async function facadeReport(args: string[]): Promise<void> {
  if (args.some(arg => !['--update', '--skip-generate', '--from-build'].includes(arg))
    || (args.includes('--from-build') && args.some(arg => ['--update', '--skip-generate'].includes(arg)))) {
    throw new Error('Usage: apack pack facade-report [--update] [--skip-generate] | --from-build');
  }
  const update = args.includes('--update');
  const packDir = findPackRoot(process.cwd());
  const reportFile = facadeReportFile(packDir);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'facade-report-'));

  try {
    let next: string;
    if (args.includes('--from-build')) next = readBuiltFacadeReport(packDir);
    else {
      if (args.includes('--skip-generate')) {
        const manifest = readValidManifest(packDir);
        const dependencies = await resolveDeps(packDir, manifest.dependencies, { readOnly: true });
        assertGeneratedCurrent(packDir, manifest, dependencies);
      } else await generateEntries([]);
      const built = await bundlePackTypes(packDir, path.join(scratch, 'pack-types.d.ts'));
      if (!built.success) throw new Error(`The pack's facade types couldn't be bundled: ${built.error}`);
      const { id } = readValidManifest(packDir);
      next = facadeReportText(built.content, packDir, id);
    }
    const comparison = compareFacadeReport(packDir, next);

    if (comparison.state === 'current') {
      console.log(`${shownPath(reportFile)} is up to date`);
      return;
    }
    if (update) {
      fs.mkdirSync(path.dirname(reportFile), { recursive: true });
      fs.writeFileSync(reportFile, next);
      console.log(`Updated ${shownPath(reportFile)}`);
      return;
    }
    // The diff is the useful half of the failure, so it is printed before the throw that sets the exit code.
    // It is the command's to print and not the comparison's: the build warns with the same sentence, where a
    // few thousand lines of diff nobody asked for is noise
    if (comparison.state === 'stale') {
      const derived = path.join(scratch, 'pack-types.api.md');
      fs.writeFileSync(derived, next);
      spawnSync('diff', ['-u', reportFile, derived], { stdio: 'inherit' });
    }
    throw new Error(`\n${comparison.problem}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  }
}
