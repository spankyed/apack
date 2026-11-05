import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { _byDeadline } from '@apackdev/sdk/testing/waiting';
import { createInputSubscriptions, type InputSubscription } from '../../src/build/input-subscriptions.ts';

const SAVES = 300;
const SAVES_PER_PASS = 10;
const OTHER_WATCHES = 27;

let temporary: string | undefined;
afterEach(() => { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); temporary = undefined; });

const yieldToEvents = () => new Promise(resolve => setImmediate(resolve));

// What this guards exists only where libuv serves every directory watch in a process from one FSEvents stream, so a
// Linux pass would show nothing. Runs on the macOS runner: gh workflow run ci.yml --ref <branch> -f compiler_macos=true
// -f compiler_macos_test='sees every save'.
it.runIf(process.platform === 'darwin')('sees every save while watcher passes hold the same set', async () => {
  temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-input-subscriptions-')));
  const watched = path.join(temporary, 'watched');
  fs.mkdirSync(watched);
  const others = Array.from({ length: OTHER_WATCHES }, (_, index) => {
    const directory = path.join(temporary!, `other-${index}`);
    fs.mkdirSync(directory);
    return directory;
  });

  const seen = new Set<string>();
  let onEvent = () => {};
  const subscriptions: InputSubscription[] = [
    { key: 'watched', directory: watched, recursive: true, receive(_event, file) { if (file) seen.add(path.basename(file)); onEvent(); } },
    ...others.map((directory): InputSubscription => ({ key: directory, directory, recursive: false, receive() {} })),
  ];
  const held = createInputSubscriptions((directory, error) => new Error(`Cannot watch ${directory}`, { cause: error }));
  try {
    held.hold(subscriptions);
    // A stream is live once it has delivered something, and a save before that proves nothing
    let attempt = 0;
    const live = new Promise<void>(resolve => { onEvent = () => { if ([...seen].some(file => file.startsWith('live-'))) resolve(); }; });
    const proving = setInterval(() => fs.writeFileSync(path.join(watched, `live-${attempt++}`), ''), 200);
    try { await _byDeadline(live, 'the first file event'); } finally { clearInterval(proving); }

    const names = Array.from({ length: SAVES }, (_, index) => `save-${index}`);
    const allSeen = new Promise<void>(resolve => { onEvent = () => { if (names.every(name => seen.has(name))) resolve(); }; });
    for (const [index, name] of names.entries()) {
      if (index % SAVES_PER_PASS === 0) expect(held.hold(subscriptions)).toBe(false);
      fs.writeFileSync(path.join(watched, name), '');
      await yieldToEvents();
    }
    await _byDeadline(allSeen, 'every save').catch(() => {});
    expect(names.filter(name => !seen.has(name))).toEqual([]);
  } finally { held.close(); }
});
