import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createModuleExports } from '../src/module-exports.ts';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

it('refuses missing inherited configuration instead of reading exports under partial options', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-module-config-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ extends: './missing.json' }));
  const entry = path.join(root, 'entry.ts');
  fs.writeFileSync(entry, 'export interface Shape { name: string }');
  expect(() => createModuleExports(root, [entry])).toThrow('missing.json');
});

it('allows entry-driven type inspection when configured include paths are empty', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-module-config-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: ['empty'] }));
  const entry = path.join(root, 'entry.ts');
  fs.writeFileSync(entry, 'export interface Shape { name: string }');
  expect(createModuleExports(root, [entry]).hasTypeExport(entry, 'Shape')).toBe(true);
});
