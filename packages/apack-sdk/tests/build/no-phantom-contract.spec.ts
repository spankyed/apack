// A contract used to be a value carrying phantom properties — `_incoming`/`_outgoing` on the object `defineSystem`
// returned — which codegen read with `propertyType(spec, '_outgoing')`. That is why an entry declared
// `const entry: SystemEntry = …` silently published no events: the annotation widened the value and took the
// phantoms with it. Contracts are declared types now, read with `declaredTypeOf`, and there is no value to widen.
//
// Nothing in the type system stops the pattern coming back, so these pin both halves of it: no `_`-prefixed member
// on the spec, and no property read of one in the reader.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '../../src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

describe('a contract is a type, not a value with phantoms', () => {
  // Both, because `SystemSpec extends Handlers`: a phantom could come back on either and reach the spec
  it.each(['SystemSpec', 'Handlers'])('%s declares no `_`-prefixed member', (name) => {
    const source = read('framework/define-system.ts');
    const body = new RegExp(`export interface ${name}<[\\s\\S]*?\\{([\\s\\S]*?)\\n\\}`).exec(source);
    expect(body, `${name} should still be an interface in define-system.ts`).not.toBeNull();
    expect([...body![1].matchAll(/^\s*(_\w+)\s*[?:]/gm)].map((m) => m[1])).toEqual([]);
  });

  it('SystemEntry carries the spec whole, rather than picking members off it', () => {
    // `spec: Pick<SystemSpec<…>, '_incoming' | '_outgoing'>` was how the entry kept the phantoms in reach
    expect(read('framework/system-utils.ts')).not.toMatch(/spec:\s*Pick</);
  });

  // But `__entity`: the brand `EARS.EntityId<'T'>` declares (`apack-ears/src/entities.ts`), a property of the id's
  // type rather than a phantom of a value, which is how the field-type reader knows which entity types an id names
  it('the reader reads no `_`-prefixed property but the id brand', () => {
    const source = read('build/module-exports.ts');
    const names = [...source.matchAll(/propertyType\([^,]+,\s*'(_\w+)'/g)].map((m) => m[1]);
    expect(names.filter((name) => name !== '__entity')).toEqual([]);
  });
});
