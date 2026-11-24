import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  capturedDescriptor,
  descriptorStats,
  releaseDescriptor,
  instrumentFileHandle,
  rememberDescriptor,
} from '@apackdev/host/build/compiler-inputs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-descriptor-owner-'));
  roots.push(root);
  const first = path.join(root, 'first.txt'), second = path.join(root, 'second.txt');
  fs.writeFileSync(first, 'FIRST'); fs.writeFileSync(second, 'SECOND');
  return { first, second };
}

it('discards a stale descriptor owner when the actual opened file has a different identity', () => {
  const { first, second } = fixture();
  const readStats = vi.fn(() => fs.statSync(first));
  const fd = fs.openSync(first, 'r');
  rememberDescriptor(fd, { readStats });
  const saved = capturedDescriptor(fd);
  fs.closeSync(fd);
  const replacement = fs.openSync(second, 'r');
  try {
    const actual = fs.fstatSync(replacement);
    expect(descriptorStats(replacement, actual, [], saved)).toBe(actual);
    expect(readStats).not.toHaveBeenCalled();
  } finally { fs.closeSync(replacement); releaseDescriptor(fd, saved); releaseDescriptor(replacement, capturedDescriptor(replacement)); }
});

it('preserves native handle identity, borrowed stat receivers and disposal', async () => {
  const { first, second } = fixture();
  const copyOne = `${first}.copy`, copyTwo = `${second}.copy`;
  fs.copyFileSync(first, copyOne); fs.copyFileSync(second, copyTwo);
  const one = await fs.promises.open(copyOne, 'r'), two = await fs.promises.open(copyTwo, 'r');
  const prototype = Object.getPrototypeOf(one), fd = one.fd;
  rememberDescriptor(one.fd, { readStats: () => fs.statSync(first) });
  rememberDescriptor(two.fd, { readStats: () => fs.statSync(second) });
  instrumentFileHandle(one); instrumentFileHandle(two);
  try {
    expect(Object.getPrototypeOf(one)).toBe(prototype);
    const borrowed = await one.stat.call(two);
    expect(borrowed?.size).toBe(6);
    expect(borrowed?.ino).toBe(fs.statSync(second).ino);
    await one[Symbol.asyncDispose]();
    expect(capturedDescriptor(fd)).toBeUndefined();
    await expect(one.stat()).rejects.toMatchObject({ code: 'EBADF' });
  } finally { await one.close(); await two.close(); }
});

it('does not adopt or release a newer owner for an operation that started unowned', () => {
  const { first } = fixture();
  const fd = fs.openSync(first, 'r');
  const readStats = vi.fn(() => fs.statSync(first));
  rememberDescriptor(fd, { readStats });
  const owner = capturedDescriptor(fd);
  try {
    releaseDescriptor(fd, undefined);
    expect(capturedDescriptor(fd)).toBe(owner);
    const actual = fs.fstatSync(fd);
    expect(descriptorStats(fd, actual, [], undefined)).toBe(actual);
    expect(readStats).not.toHaveBeenCalled();
  } finally { fs.closeSync(fd); releaseDescriptor(fd, owner); }
});
