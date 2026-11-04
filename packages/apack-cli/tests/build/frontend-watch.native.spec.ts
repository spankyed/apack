import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { _byDeadline } from '@apackdev/sdk/testing/waiting';
import { createFrontendWatcher } from '../../src/build/frontend-watch.ts';
import { readBuildWatchInputs } from '../../src/build/build-watch-inputs.ts';

const failures: Error[] = [];
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); expect(failures.splice(0)).toEqual([]); });

function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-frontend-watch-'));
  const root = path.join(temporary, 'pack');
  fs.mkdirSync(root);
  let notify!: () => void;
  const firstChange = new Promise<void>(resolve => { notify = resolve; });
  const changed = vi.fn((_file: string) => notify());
  const watcher = createFrontendWatcher(root, path.join(temporary, 'profile'), changed, error => { failures.push(error); });
  cleanups.push(() => fs.rmSync(temporary, { recursive: true, force: true }), () => watcher.close());
  const write = (file: string, text: string) => {
    const absolute = path.join(temporary, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, text);
    return absolute;
  };
  return { root, temporary, watcher, changed, firstChange, write };
}

it('uses file bytes for duplicate detection and watches outside resource edits', async () => {
  const { watcher, changed, firstChange, write } = fixture();
  const file = write('resources/style.css', 'before');
  await watcher.observe({ files: [file], directories: [], successful: true });
  const before = watcher.snapshot();
  const touch = new Date(Date.now() + 60_000);
  fs.utimesSync(file, touch, touch);
  expect(before.current()).toBe(true);
  write('resources/style.css', 'after');
  await _byDeadline(firstChange, 'the outside stylesheet change');
  expect(changed).toHaveBeenCalled();
  expect(before.current(), JSON.stringify(changed.mock.calls)).toBe(false);
});

it('ignores new bytes in a file the build never read, and takes a new file in the same directory', async () => {
  const { watcher, changed, firstChange, write } = fixture();
  const file = write('resources/style.css', 'read');
  write('resources/unread.ts', 'before');
  await watcher.observe({ files: [file], directories: [], successful: true });
  const before = watcher.snapshot();
  write('resources/unread.ts', 'after');
  // Delivered after that edit's event, whose absence is what is being asserted
  await new Promise(resolve => setTimeout(resolve, 2_000));
  expect(before.current()).toBe(true);
  const added = write('resources/added.ts', 'new');
  await _byDeadline(firstChange, 'the new file');
  expect(changed.mock.calls.map(([changedFile]) => changedFile)).toEqual([added]);
  expect(before.current()).toBe(false);
});

it('ignores what a package build writes, while a source file beside it still counts', async () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-frontend-watch-')));
  const root = path.join(temporary, 'pack');
  const write = (file: string) => {
    const absolute = path.join(temporary, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, file);
    return absolute;
  };
  fs.mkdirSync(root);
  const read = write('package/dist/read.js');
  let notify!: () => void;
  const firstChange = new Promise<void>(resolve => { notify = resolve; });
  const changed = vi.fn((_file: string) => notify());
  const watcher = createFrontendWatcher(root, undefined, changed, error => { failures.push(error); }, [path.join(temporary, 'package', 'dist')]);
  cleanups.push(() => fs.rmSync(temporary, { recursive: true, force: true }), () => watcher.close());
  await watcher.observe({ files: [read, path.join(temporary, 'package', 'read.js')], directories: [], successful: true });
  const before = watcher.snapshot();
  write('package/dist/chunk.js');
  write('package/.temp/build/chunk.js');
  // Delivered after those writes' events, whose absence is what is being asserted
  await new Promise(resolve => setTimeout(resolve, 2_000));
  expect(before.current()).toBe(true);
  const source = write('package/added.ts');
  await _byDeadline(firstChange, 'the new source file');
  expect(changed.mock.calls.map(([file]) => file)).toEqual([source]);
  expect(before.current()).toBe(false);
});

it('keeps repair subscriptions through partial reports and observes nested missing targets', async () => {
  const { temporary, watcher, changed, write } = fixture();
  const stylesheet = write('styles/main.css', '@import "./future/theme.css";');
  await watcher.observe({ files: [stylesheet], directories: [], successful: true });
  await watcher.observe({ files: [path.join(temporary, 'styles/future/theme.css')], directories: [], successful: false });
  const before = watcher.snapshot();
  const repaired = write('styles/future/theme.css', '.theme {}');
  await vi.waitFor(() => expect(changed.mock.calls.some(([file]) => file === repaired || file.endsWith(`${path.sep}future`))).toBe(true));
  expect(before.current(), JSON.stringify(changed.mock.calls)).toBe(false);
});

it.each(['content', 'profile/content'])('observes compiler-reported empty directory %s gaining files', async relative => {
  const { temporary, watcher, changed, write } = fixture();
  const directory = path.join(temporary, relative);
  fs.mkdirSync(directory, { recursive: true });
  await watcher.observe({ files: [], directories: [directory], successful: true });
  const before = watcher.snapshot();
  write(`${relative}/nested/item.html`, '<div />');
  await vi.waitFor(() => expect(changed).toHaveBeenCalled());
  expect(before.current(), JSON.stringify(changed.mock.calls)).toBe(false);
});

it('accepts only the private worker message shape and absolute input paths', () => {
  const message = { type: 'apack:build-inputs', files: ['/tmp/style.css'], directories: [], successful: false };
  expect(readBuildWatchInputs(message)).toEqual({ files: message.files, directories: [], successful: false });
  expect(readBuildWatchInputs({ ...message, type: 'other' })).toBeUndefined();
  expect(readBuildWatchInputs({ ...message, files: ['relative.css'] })).toBeUndefined();
  expect(readBuildWatchInputs({ ...message, directories: [42] })).toBeUndefined();
});

it.each(['outside', 'profile/content'])('observes new content beneath a nested directory link into %s', async target => {
  const { temporary, watcher, firstChange, write } = fixture();
  const directory = path.join(temporary, 'content');
  const destination = path.join(temporary, target);
  fs.mkdirSync(directory);
  fs.mkdirSync(destination, { recursive: true });
  fs.symlinkSync(destination, path.join(directory, 'linked'), 'dir');
  await watcher.observe({ files: [], directories: [directory], successful: true });
  const before = watcher.snapshot();
  write(`${target}/nested/page.html`, '<div />');
  await _byDeadline(firstChange, 'content created beneath the nested directory link');
  expect(before.current()).toBe(false);
});

it('observes repair beneath a dangling nested directory link', async () => {
  const { temporary, watcher, firstChange, write } = fixture();
  const directory = path.join(temporary, 'content');
  fs.mkdirSync(directory);
  fs.symlinkSync(path.join(temporary, 'future'), path.join(directory, 'linked'), 'dir');
  await watcher.observe({ files: [], directories: [directory], successful: true });
  const before = watcher.snapshot();
  write('future/nested/page.html', '<div />');
  await _byDeadline(firstChange, 'repair beneath a dangling content directory link');
  expect(before.current()).toBe(false);
});

it('bounds cyclic directory links and excludes linked authored outputs from input snapshots', async () => {
  const { root, temporary, watcher, firstChange, write } = fixture();
  const directory = path.join(temporary, 'content');
  fs.mkdirSync(directory);
  fs.symlinkSync(directory, path.join(directory, 'loop'), 'dir');
  fs.symlinkSync(root, path.join(directory, 'owned'), 'dir');
  const file = write('style.css', 'before');
  await watcher.observe({ files: [file], directories: [directory], successful: true });
  const before = watcher.snapshot();
  write('pack/dist/runtime/fe.css', 'output');
  expect(before.current()).toBe(true);
  write('style.css', 'after');
  await _byDeadline(firstChange, 'the resource edit beside cyclic and excluded directory links');
  expect(before.current()).toBe(false);
});

it('observes a missing stylesheet repaired by creating a symlink', async () => {
  const { temporary, watcher, firstChange, write } = fixture();
  const stylesheet = write('styles/main.css', '@import "./future.css";');
  const target = write('outside/theme.css', '.theme {}');
  await watcher.observe({ files: [stylesheet], directories: [], successful: false });
  const before = watcher.snapshot();
  fs.symlinkSync(target, path.join(temporary, 'styles/future.css'));
  await _byDeadline(firstChange, 'a stylesheet candidate repaired with a symlink');
  expect(before.current()).toBe(false);
});

it.each(['nested', 'reported'])('observes a %s directory link retargeted into authored source', async kind => {
  const { temporary, watcher, firstChange, write } = fixture();
  const outside = path.dirname(write('outside/page.html', '<div />'));
  const authored = path.dirname(write('pack/templates/page.html', '<article />'));
  const directory = path.join(temporary, 'content');
  if (kind === 'nested') fs.mkdirSync(directory);
  const link = kind === 'nested' ? path.join(directory, 'linked') : directory;
  fs.symlinkSync(outside, link, 'dir');
  await watcher.observe({ files: [], directories: [directory], successful: true });
  const before = watcher.snapshot();
  const replacement = path.join(temporary, 'replacement');
  fs.symlinkSync(authored, replacement, 'dir');
  fs.renameSync(replacement, link);
  await _byDeadline(firstChange, 'a content link retargeted into authored source');
  expect(before.current()).toBe(false);
});

it('rebuilds when a compiler-reported content directory link is retargeted', async () => {
  const { temporary, watcher, firstChange, write } = fixture();
  const original = path.dirname(write('sources/original/page.html', '<div />'));
  const replacement = path.dirname(write('sources/replacement/page.html', '<article />'));
  const link = path.join(temporary, 'content');
  fs.symlinkSync(original, link, 'dir');
  await watcher.observe({ files: [], directories: [link], successful: true });
  const before = watcher.snapshot();
  const next = path.join(temporary, 'next-content');
  fs.symlinkSync(replacement, next, 'dir');
  fs.renameSync(next, link);
  await _byDeadline(firstChange, 'the content directory link replacement');
  expect(before.current()).toBe(false);
});

it('ignores output/profile events beneath a broad parent and cannot reopen after close', async () => {
  const { root, temporary, watcher, changed, firstChange, write } = fixture();
  const file = write('style.css', 'before');
  const inputs = { files: [file], directories: [], successful: true };
  await watcher.observe(inputs);
  write('pack/dist/runtime/fe.css', 'output');
  write('profile/logs/app.log', 'app activity');
  write('style.css', 'after');
  await _byDeadline(firstChange, 'the resource event after ignored output/profile writes');
  expect(changed.mock.calls.filter(([file]) => !file.endsWith(`${path.sep}style.css`))).toEqual([]);
  await watcher.close();
  changed.mockClear();
  await watcher.observe(inputs);
  await watcher.accept(inputs);
  let notified!: () => void;
  const observed = new Promise<void>(resolve => { notified = resolve; });
  const control = createFrontendWatcher(root, path.join(temporary, 'profile'), () => notified(), error => { failures.push(error); });
  cleanups.push(() => control.close());
  await control.observe(inputs);
  write('style.css', 'closed');
  await _byDeadline(observed, 'the control watcher observing the same edit');
  expect(changed).not.toHaveBeenCalled();
});
