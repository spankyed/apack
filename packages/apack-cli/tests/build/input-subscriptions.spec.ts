import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { createInputSubscriptions, type InputSubscription } from '../../src/build/input-subscriptions.ts';

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

const subscription = (key: string, receive: InputSubscription['receive'] = () => {}): InputSubscription => ({ key, directory: `/${key}`, recursive: false, receive });
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
