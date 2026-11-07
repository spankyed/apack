import { _electron } from '@playwright/test';
import { mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Diagnostic overlay only: the normal startup scenario, assertions and app entry stay intact.
const launch = _electron.launch.bind(_electron);
_electron.launch = async options => {
  if (Number(process.env.APACK_PERFORMANCE_INDEX ?? -1) < 5) return launch(options);
  const directory = path.join(process.env.APACK_PERFORMANCE_OUTPUT, 'entry-profile');
  mkdirSync(directory, { recursive: true });
  appendFileSync(path.join(directory, 'driver.jsonl'), JSON.stringify({ name: 'launch-request', epochMs: Date.now(), monotonicMs: performance.now() }) + '\n');
  return launch({ ...options,
    args: [
      '--trace-startup=toplevel,loading,navigation,blink.user_timing,devtools.timeline,v8,disabled-by-default-v8.cpu_profiler,disabled-by-default-v8.compile',
      '--trace-startup-duration=10', '--trace-startup-format=json',
      `--trace-startup-file=${path.join(directory, 'chromium.json')}`, ...options.args,
    ],
    env: { ...options.env, APACK_ENTRY_PROFILE_DIRECTORY: directory,
      NODE_OPTIONS: `${options.env.NODE_OPTIONS ?? ''} --require=${JSON.stringify(fileURLToPath(new URL('./process.cjs', import.meta.url)))}` },
  });
};
