import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settles } from '@apackdev/sdk/testing/waiting';
import { createFileWatches, createInputSubscriptions, type InputSubscription } from '../../src/build/input-subscriptions.ts';

const opened = vi.hoisted(() => [] as Array<{ directory: string; deliver: (event: string, file: string) => void; watcher: EventEmitter & { close: ReturnType<typeof vi.fn> } }>);
vi.mock('node:fs', async importOriginal => {
  const { EventEmitter } = await import('node:events');
  return {
    ...await importOriginal<typeof import('node:fs')>(),
    watch: vi.fn((directory: string, _options: unknown, deliver: (event: string, file: string) => void) => {
      const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
      opened.push({ directory, deliver, watcher });
      return watcher;
    }),
  };
});

const subscription = (key: string, receive: InputSubscription['receive'] = () => {}): InputSubscription => ({ key, path: `/${key}`, recursive: false, receive });
const refused = (directory: string, error: unknown) => new Error(`refused ${directory}`, { cause: error });

beforeEach(() => { opened.length = 0; vi.mocked(fs.watch).mockClear(); });

it('opens and closes only the difference, and says so', () => {
  const held = createInputSubscriptions(refused);
  expect(held.hold([subscription('a'), subscription('b')])).toBe(true);
  expect(held.hold([subscription('a'), subscription('b')])).toBe(false);
  expect(opened).toHaveLength(2);

  expect(held.hold([subscription('b'), subscription('c')])).toBe(true);
  expect(opened.map(entry => entry.directory)).toEqual(['/a', '/b', '/c']);
  expect(opened[0]!.watcher.close).toHaveBeenCalledTimes(1);
  expect(opened[1]!.watcher.close).not.toHaveBeenCalled();
});

it('delivers a kept watch to its newest receiver without reopening it', () => {
  const held = createInputSubscriptions(refused);
  const first = vi.fn();
  const second = vi.fn();
  held.hold([subscription('a', first)]);
  held.hold([subscription('a', second)]);
  opened[0]!.deliver('change', 'file');
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith('change', 'file');
});

it('keeps what it held when a new watch cannot open', () => {
  const report = vi.fn(refused);
  const held = createInputSubscriptions(report);
  const receive = vi.fn();
  held.hold([subscription('a', receive)]);
  const refusal = new Error('watch limit');
  vi.mocked(fs.watch).mockImplementationOnce(() => { throw refusal; });

  expect(() => held.hold([subscription('b')])).toThrow('refused /b');
  expect(report).toHaveBeenCalledWith('/b', refusal);
  expect(opened[0]!.watcher.close).not.toHaveBeenCalled();
  opened[0]!.deliver('change', 'file');
  expect(receive).toHaveBeenCalledTimes(1);
});

it('reports a held watch failing and ignores a retired one', () => {
  const report = vi.fn(refused);
  const held = createInputSubscriptions(report);
  held.hold([subscription('a')]);
  held.hold([subscription('b')]);
  opened[0]!.watcher.emit('error', new Error('retired'));
  expect(report).not.toHaveBeenCalled();
  const failure = new Error('live');
  opened[1]!.watcher.emit('error', failure);
  expect(report).toHaveBeenCalledWith('/b', failure);
});

describe('file watches', () => {
  let temporary: string;
  beforeEach(() => { temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-file-watches-'))); });
  afterEach(() => { fs.rmSync(temporary, { recursive: true, force: true }); });
  const known = (name: string, text = name) => { const file = path.join(temporary, name); fs.writeFileSync(file, text); return file; };

  it('reopens only the watch whose file was replaced', async () => {
    const [a, b] = [known('a.ts'), known('b.ts')];
    const watches = createFileWatches(() => {}, 'darwin');
    watches.hold([{ file: a, receive() {} }, { file: b, receive() {} }]);
    fs.writeFileSync(`${b}.tmp`, 'replaced');
    fs.renameSync(`${b}.tmp`, b);
    watches.hold([{ file: a, receive() {} }, { file: b, receive() {} }]);
    expect(opened.map(entry => path.basename(entry.directory))).toEqual(['a.ts', 'b.ts', 'b.ts']);
    expect(opened[0]!.watcher.close).not.toHaveBeenCalled();
    expect(opened[1]!.watcher.close).toHaveBeenCalledTimes(1);
    watches.close();
  });

  it('reports a file replaced or deleted before its watch said so, when the next hold closes that watch', () => {
    const [replaced, deleted] = [known('replaced.ts'), known('deleted.ts')];
    const receive = { replaced: vi.fn(), deleted: vi.fn() };
    const watches = createFileWatches(() => {}, 'darwin');
    watches.hold([{ file: replaced, receive: receive.replaced }, { file: deleted, receive: receive.deleted }]);
    fs.writeFileSync(`${replaced}.tmp`, 'replaced');
    fs.renameSync(`${replaced}.tmp`, replaced);
    fs.rmSync(deleted);
    watches.hold([{ file: replaced, receive: receive.replaced }]);
    expect([receive.replaced.mock.calls.length, receive.deleted.mock.calls.length]).toEqual([1, 1]);
    watches.close();
  });

  it('reports a replacement once when its watch already said so', () => {
    const file = known('a.ts');
    const receive = vi.fn();
    const watches = createFileWatches(() => {}, 'darwin');
    watches.hold([{ file, receive }]);
    fs.writeFileSync(`${file}.tmp`, 'replaced');
    fs.renameSync(`${file}.tmp`, file);
    opened[0]!.deliver('rename', 'a.ts');
    watches.hold([{ file, receive }]);
    expect(receive).toHaveBeenCalledTimes(1);
    watches.close();
  });

  it('reports an edit made before a new watch was armed, and nothing when there was none', async () => {
    const [edited, untouched] = [known('edited.ts'), known('untouched.ts')];
    const receive = { edited: vi.fn(), untouched: vi.fn() };
    const watches = createFileWatches(() => {}, 'darwin');
    watches.hold([{ file: edited, receive: receive.edited }, { file: untouched, receive: receive.untouched }]);
    fs.writeFileSync(edited, 'a longer edit than before');
    await settles(() => expect(receive.edited).toHaveBeenCalledTimes(1));
    expect(receive.untouched).not.toHaveBeenCalled();
    watches.close();
  });

  it('holds nothing off macOS', () => {
    const watches = createFileWatches(() => {}, 'linux');
    watches.hold([{ file: known('a.ts'), receive() {} }]);
    expect(opened).toEqual([]);
  });

  it('warns once and stands down when a watch cannot open', () => {
    const warn = vi.fn();
    const watches = createFileWatches(warn, 'darwin');
    vi.mocked(fs.watch).mockImplementationOnce(() => { throw Object.assign(new Error('too many open files'), { code: 'EMFILE' }); });
    expect(() => watches.hold([{ file: known('a.ts'), receive() {} }])).not.toThrow();
    watches.hold([{ file: known('b.ts'), receive() {} }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([]);
  });
});
