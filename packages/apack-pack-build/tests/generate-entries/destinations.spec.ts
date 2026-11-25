import { expect, it } from 'vitest';
import { GENERATED_ENTITY_DESTINATIONS_FILE } from '../../src/generate-entries.ts';
import { dependency, generate, setupPackFixture, write } from './_support/pack.ts';

setupPackFixture();

function destination(id: string, opens: string) {
  write(`src/${id}.ts`, `export type Contract = { opens: ${opens} }; throw new Error('Never execute'); export default {};`);
  return { description: 'Opens declared entities', surface: { label: id, state: `src/${id}.ts`, contract: `src/${id}.ts#Contract` } };
}

it('materializes SDK, own and dependency destinations as deterministic data', async () => {
  const ancestor = dependency({ id: 'ancestor', data: { entities: { Memo: {} } } });
  ancestor.types.entities = { Memo: 'Memo' };
  const files = await generate({ data: { entities: { Note: {} } }, features: {
    notes: destination('notes', "'Note' | 'Action' | 'Memo'"),
  } }, { ancestor });
  expect(JSON.parse(files[GENERATED_ENTITY_DESTINATIONS_FILE])).toEqual({ Action: 'notes', Memo: 'notes', Note: 'notes' });
  expect(Object.keys(JSON.parse(files[GENERATED_ENTITY_DESTINATIONS_FILE]))).toEqual(['Action', 'Memo', 'Note']);
  expect(files[GENERATED_ENTITY_DESTINATIONS_FILE]).not.toContain('src/');
});

it('rejects competing claims within a pack and names both owners', async () => {
  await expect(generate({ features: {
    first: destination('first', "'Action'"), second: destination('second', "'Action'"),
  } })).rejects.toThrow(/Action.*both features "first" and "second"/);
});

it('refuses unknown entities rather than inventing an entity declaration', async () => {
  await expect(generate({ features: { notes: destination('notes', "'Missing'") } }))
    .rejects.toThrow(/Feature "notes".*unknown entity "Missing"/);
});

it('emits an explicit empty destination map for packs without claims', async () => {
  expect((await generate({}))[GENERATED_ENTITY_DESTINATIONS_FILE]).toBe('{}\n');
});
