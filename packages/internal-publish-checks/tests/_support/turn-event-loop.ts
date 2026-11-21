import { afterEach } from 'vitest';

// A vitest worker answers its main process's calls only between turns of its event loop, and a case that runs
// synchronously, or awaits only resolved promises, never turns it: a file of such cases is one block as long
// as all of them, which on a slow runner passes birpc's hardcoded 60s window and fails a run whose tests all
// passed ("Timeout calling onTaskUpdate"). One turn after every case caps a block at the longest single case.
afterEach(() => new Promise<void>((resolve) => { setImmediate(resolve); }));
