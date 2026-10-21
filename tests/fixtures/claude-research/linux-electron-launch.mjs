import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

// Only this owned Docker fixture runs Electron as root; the normal app sandbox is unchanged.
if (process.platform !== 'linux' || !existsSync('/.dockerenv')) throw Error('Linux Electron fixture requires Docker');
const { _electron } = createRequire(import.meta.url)('@playwright/test');
const launch = _electron.launch.bind(_electron);
_electron.launch = options => launch({ ...options, args: ['--no-sandbox', ...(options?.args ?? [])] });
