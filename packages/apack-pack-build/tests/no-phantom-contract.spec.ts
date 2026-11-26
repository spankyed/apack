// Contracts are declared types read with `declaredTypeOf`, never values carrying phantom properties.
//
// Nothing in the type system stops the pattern coming back, so these pin both halves of it: no `_`-prefixed member
// on `SystemContract`, and no property read of one in the reader.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SDK_SRC = path.resolve(import.meta.dirname, '../../apack-sdk/src');
const BUILD_SRC = path.resolve(import.meta.dirname, '../src');
const readSdk = (rel: string) => fs.readFileSync(path.join(SDK_SRC, rel), 'utf-8');
const readBuild = (rel: string) => fs.readFileSync(path.join(BUILD_SRC, rel), 'utf-8');

describe('a contract is a type, not a value with phantoms', () => {
  it('SystemContract declares no `_`-prefixed member', () => {
    const source = readSdk('framework/define-system.ts');
    const body = /export interface SystemContract\s*\{([\s\S]*?)\n\}/.exec(source);
    expect(body, 'SystemContract should still be an interface in define-system.ts').not.toBeNull();
    expect([...body![1].matchAll(/^\s*(_\w+)\s*[?:]/gm)].map((m) => m[1])).toEqual([]);
  });

  // But `__entity`: the brand `EARS.EntityId<'T'>` declares (`@elmdb/ears`' `entities.ts`), a property of the id's
  // type rather than a phantom of a value, which is how the field-type reader knows which entity types an id names
  it('the reader reads no `_`-prefixed property but the id brand', () => {
    const source = readBuild('module-exports.ts');
    const names = [...source.matchAll(/propertyType\([^,]+,\s*'(_\w+)'/g)].map((m) => m[1]);
    expect(names.filter((name) => name !== '__entity')).toEqual([]);
  });
});
