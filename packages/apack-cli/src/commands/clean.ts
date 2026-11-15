import * as fs from 'node:fs';
import * as path from 'node:path';
import { findPackRoot } from '../utils';

const CLEAN_DIRS = ['dist', '.apack', 'src/__generated__'];

const HELP = `Usage: apack pack clean

Remove this pack's build output: ${CLEAN_DIRS.join(', ')}.
Downloaded builds are apack cache clean. Data directories are apack profiles.`;

export async function clean(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }
  if (args.length) throw new Error('Usage: apack pack clean. Downloaded builds are apack cache clean.');

  const root = findPackRoot(process.cwd());

  let removed = 0;
  for (const dir of CLEAN_DIRS) {
    const fullPath = path.join(root, dir);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true, maxRetries: 5 });
      console.log(`  removed ${dir}/`);
      removed++;
    }
  }

  if (removed === 0) {
    console.log('  nothing to clean');
  } else {
    console.log(`\n  cleaned ${removed} director${removed === 1 ? 'y' : 'ies'}`);
  }
}
