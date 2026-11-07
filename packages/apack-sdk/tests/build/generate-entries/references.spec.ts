import { describe, expect, it } from 'vitest';
import { ManifestSchema, _NativePackDeclarationSchema } from '../../../src/framework/declaration-schema.ts';
import { _buildProvenance } from '../../../src/build/manifest.ts';
import { setupPackFixture, generate, dependency, manifest, write } from './_support/pack.ts';

setupPackFixture();

const references = {
  types: { memo: { category: 'memos', icon: 'NotebookText', svgElements: [['path', { d: 'M2 6h4' }]] } },
  categories: { memos: { label: 'Memos', icon: 'NotebookText', useItems: 'src/references.ts#useItems' } },
};
const fields = { features: { memos: { description: 'Feature declaration fixture.', references } } };
const source = () => write('src/references.ts', "throw new Error('Must never execute during generation');\nexport function useItems() { return []; }\n");

const parse = (features: unknown) => ManifestSchema.safeParse({ id: 'fixture-pack', name: 'Fixture', version: '1.0.0', features });

describe('declarative references', () => {
  it('discovers literal metadata and generates checked bindings without executing the module', async () => {
    source();
    const parsed = parse(fields.features);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.features!.memos.references).toEqual(references);
    const files = await generate(fields);
    const output = files['src/__generated__/references.ts'];
    expect(output).toContain('"memo": { ...{"category":"memos","svgElements"');
    expect(output).toContain('import { useItems as');
    expect(output).toContain('label: "Memos"');
    expect(output).not.toContain('...types');
    expect(files['src/__generated__/pack-entry-fe.ts']).toContain("import { FEATURE_REFERENCES } from './references.ts';");
    expect(files['src/__generated__/pack-entry-fe.ts']).toContain('references: FEATURE_REFERENCES["memos"]!');
  });

  it('applies duplicate ownership checks to native declarations too', () => {
    const result = _NativePackDeclarationSchema.safeParse({ id: 'native-pack', features: {
      first: { description: 'Feature declaration fixture.', references }, second: { description: 'Feature declaration fixture.', references },
    } });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected refusal');
    expect(result.error.issues.some(issue => issue.message.includes('"first"') && issue.message.includes('"second"'))).toBe(true);
  });

  it('defaults custom icons to lazy loading and honors explicit eager bindings', async () => {
    source();
    write('src/icon.vue', '<template><span>Icon</span></template>');
    write('src/eager-icon.vue', '<template><span>Eager icon</span></template>');
    const files = await generate({ features: { memos: { references: {
      ...references, types: { memo: { ...references.types.memo, icon: { entry: 'src/icon.vue' } } },
      categories: { memos: { ...references.categories.memos, icon: { entry: 'src/eager-icon.vue', load: 'eager' } } },
    } } } });
    expect(files['src/__generated__/references.ts']).toContain('defineAsyncComponent(() => import("../icon.vue")');
    expect(files['src/__generated__/references.ts']).toMatch(/import __reference_\d+ from "..\/eager-icon.vue"/);
    expect(files['src/__generated__/references.ts']).not.toContain('import("../eager-icon.vue")');
    expect(files['src/__generated__/references.ts']).not.toMatch(/import __reference_\d+ from "..\/icon.vue"/);
  });

  it('refuses a non-function item provider', async () => {
    write('src/references.ts', 'export const useItems = {};');
    await expect(generate(fields)).rejects.toThrow('must export useItems as a function');
  });

  it.each(['types', 'categories'])('refuses duplicate %s claims naming both features', kind => {
    const second = structuredClone(references);
    if (kind !== 'categories') second.categories = {} as typeof second.categories;
    if (kind === 'categories') second.types = {} as typeof second.types;
    const result = parse({ first: { description: 'Declare first references.', references }, second: { description: 'Declare second references.', references: second } });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected refusal');
    expect(result.error.issues.some(issue => issue.message.includes(`Reference ${kind}`) && issue.message.includes('"first"') && issue.message.includes('"second"'))).toBe(true);
  });

  it.each([
    'src/references.ts',
    { ...references, categories: { memos: { ...references.categories.memos, useItems: 'src/references.ts' } } },
    { ...references, types: { memo: { ...references.types.memo, protocol: 'memo' } } },
    { ...references, types: { memo: { ...references.types.memo, svgElements: [['script', {}]] } } },
  ])('refuses invalid declarations (%j)', declaration => {
    expect(parse({ memos: { references: declaration } }).success).toBe(false);
  });

  it('refuses unknown categories', async () => {
    source();
    await expect(generate({ features: { memos: { references: { ...references, categories: {} } } } })).rejects.toThrow('undeclared category "memos"');
  });

  it('accepts a dependency category and refuses a conflicting type owner', async () => {
    source();
    const dep = dependency({ id: 'base-pack', features: { base: { references: { types: {}, categories: references.categories } } } });
    await expect(generate({ features: { memos: { references: { ...references, categories: {} } } } }, { 'base-pack': dep })).resolves.toBeDefined();
    const collision = dependency({ id: 'base-pack', ...fields });
    await expect(generate(fields, { 'base-pack': collision })).rejects.toThrow('referenceTypes "memo" declared by both packs "base-pack" and "demo-pack"');
  });

  it('retains an ancestor owner through a diamond and refuses unrelated ancestors', async () => {
    const origin = dependency({ id: 'origin-pack', ...fields });
    const provenance = _buildProvenance([], { id: 'origin-pack', manifest: origin.manifest });
    const left = { ...dependency({ id: 'left-pack' }), provenance };
    const right = { ...dependency({ id: 'right-pack' }), provenance };
    await expect(generate({}, { 'left-pack': left, 'right-pack': right })).resolves.toBeDefined();
    const other = { ...right, provenance: { ...provenance, referenceTypes: { memo: 'other-pack' } } };
    await expect(generate({}, { 'left-pack': left, 'right-pack': other })).rejects.toThrow('"origin-pack" and "other-pack"');
    expect(_buildProvenance([], { id: 'origin-pack', manifest: manifest(fields) })).toMatchObject({ referenceTypes: { memo: 'origin-pack' }, referenceCategories: { memos: 'origin-pack' } });
  });
});
