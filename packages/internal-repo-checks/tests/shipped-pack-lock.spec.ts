import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { preparePinnedAsset, readShippedPackLock } from '../../../scripts/lib/shipped-pack-lock.ts';

const fixtures: string[] = [];
afterEach(() => fixtures.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function temporary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-pack-lock-'));
  fixtures.push(dir);
  return dir;
}

const payload = 'verified release asset';
const pin = { url: 'https://example.test/pack.tgz', sha256: createHash('sha256').update(payload).digest('hex') };

it('accepts an intentionally empty selection and rejects duplicate starter IDs', () => {
  const file = path.join(temporary(), 'shipped-packs.lock.json');
  fs.writeFileSync(file, JSON.stringify({ format: 1, packs: [] }));
  expect(readShippedPackLock(file)).toEqual([]);
  const entry = { id: 'example', version: '1.0.0', archive: pin, redistribution: pin };
  fs.writeFileSync(file, JSON.stringify({ format: 1, packs: [entry, entry] }));
  expect(() => readShippedPackLock(file)).toThrow('duplicate');
});

it('serves pinned bytes from disk offline and replaces a corrupt cache entry', async () => {
  const cache = temporary();
  const get = vi.fn<typeof fetch>(async () => new Response(payload));
  const cached = await preparePinnedAsset(pin, cache, get);
  expect(fs.readFileSync(cached, 'utf8')).toBe(payload);
  expect(get).toHaveBeenCalledTimes(1);
  const offline = vi.fn<typeof fetch>(async () => { throw new Error('offline'); });
  expect(await preparePinnedAsset(pin, cache, offline)).toBe(cached);
  expect(offline).not.toHaveBeenCalled();

  fs.writeFileSync(cached, 'corrupt');
  expect(await preparePinnedAsset(pin, cache, get)).toBe(cached);
  expect(fs.readFileSync(cached, 'utf8')).toBe(payload);
  expect(get).toHaveBeenCalledTimes(2);
});

it('discards a mismatched download before it reaches the cache', async () => {
  const cache = temporary();
  await expect(preparePinnedAsset(pin, cache, async () => new Response('wrong'))).rejects.toThrow('checksum mismatch');
  expect(fs.readdirSync(cache)).toEqual([]);
});
