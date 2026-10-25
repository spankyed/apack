// What a dependency tree declares, and which pack declares it. A dependent sees only its direct
// dependencies' snapshots, so each snapshot carries the whole tree's names — otherwise a dependent of
// two packs sharing an ancestor reads the ancestor's names arriving from both as a collision.
//
// Entities, relation kinds and surfaces used to travel as three differently-shaped fields with
// three readers running this same algorithm. These tests are on the one that replaced them.
import { describe, expect, it } from 'vitest';
import { PROVENANCE_KINDS, _buildProvenance, _mergeProvenance, type ProvenanceSource } from '../../src/build/manifest.ts';

const dep = (id: string, source: ProvenanceSource) => [id, source] as const;

describe('_mergeProvenance', () => {
  it('attributes a dependency\'s own names to that dependency', () => {
    expect(_mergeProvenance('entities', [dep('base-pack', { manifest: { data: { entities: { note: {} } } } })]))
      .toEqual({ note: 'base-pack' });
  });

  // The whole reason a snapshot carries more than its own pack's names
  it("carries a dependency's inherited names through, attributed to whoever declared them", () => {
    const merged = _mergeProvenance('entities', [
      dep('mid-pack', { manifest: { features: { notes: { entities: { Note: {} } } } }, provenance: { entities: { Memo: 'deep-pack' } } }),
    ]);
    expect(merged).toEqual({ Memo: 'deep-pack', Note: 'mid-pack' });
  });

  /**
   * The nearer pack wins, which is why each dependency's inherited record goes in before its own
   * manifest: that is the pack a dependent could add to its own dependencies to reach the name.
   */
  it('lets a dependency that declares a name itself win over one that only inherited it', () => {
    const inheritedOnly = dep('left-pack', { manifest: {}, provenance: { entities: { note: 'deep-pack' } } });
    const declaresIt = dep('right-pack', { manifest: { data: { entities: { note: {} } } } });

    expect(_mergeProvenance('entities', [inheritedOnly, declaresIt])).toEqual({ note: 'right-pack' });
    // …and the reverse order still prefers the one that declares it, because its manifest pass is last
    expect(_mergeProvenance('entities', [declaresIt, inheritedOnly])).toEqual({ note: 'deep-pack' });
  });

  /**
   * Within one dependency the order is inherited first, then its own manifest — so a pack that
   * redeclares a name it also inherited is credited with it. Nothing else in these fixtures can tell
   * the two passes apart: a dependency that only inherits, or only declares, reads the same either way.
   */
  it("credits a dependency for a name it redeclares over the one it inherited it from", () => {
    const merged = _mergeProvenance('entities', [
      dep('mid-pack', { manifest: { data: { entities: { note: {} } } }, provenance: { entities: { note: 'deep-pack' } } }),
    ]);
    expect(merged).toEqual({ note: 'mid-pack' });
  });

  it('lets the pack being built win over everything it depends on', () => {
    const merged = _mergeProvenance(
      'entities',
      [dep('base-pack', { manifest: { features: { notes: { entities: { Note: {} } } } } })],
      { id: 'app-pack', manifest: { features: { notes: { entities: { Note: {} } } } } },
    );
    expect(merged).toEqual({ Note: 'app-pack' });
  });

  it('reads a snapshot that declares nothing and inherited nothing', () => {
    expect(_mergeProvenance('surfaces', [dep('bare-pack', { manifest: {} })])).toEqual({});
    expect(_mergeProvenance('surfaces', [])).toEqual({});
  });

  // One table entry per kind, so a new kind is a line rather than a type pair and a reader
  describe('reads every kind off a manifest', () => {
    const manifest = {
      data: { entities: { Note: {} }, relations: { tagged: {} }, roles: ['starred'] },

      extensions: { textEditor: { suggestions: { extensions: { mention: 'src/editor.ts#Mention' } } } },
      features: { memos: { surface: {}, references: {
        types: { memo: { category: 'memos', icon: 'NotebookText', svgElements: [] } },
        categories: { memos: { label: 'Memos', icon: 'NotebookText', useItems: 'src/ref.ts#useItems' } },
      } }, headless: {} },
    };
    const cases: Array<[keyof typeof PROVENANCE_KINDS, Record<string, string>]> = [
      ['entities', { Note: 'base-pack' }],
      ['relKinds', { TAGGED: 'base-pack' }],
      ['roles', { STARRED: 'base-pack' }],
      ['tiptapExtensions', { mention: 'base-pack' }],
      ['referenceTypes', { memo: 'base-pack' }],
      ['referenceCategories', { memos: 'base-pack' }],
      // A feature without a surface owns no surface id: nothing could be sent there
      ['surfaces', { 'base-pack/memos': 'base-pack' }],
    ];
    it.each(cases)('%s', (kind, expected) => {
      expect(_mergeProvenance(kind, [dep('base-pack', { manifest })])).toEqual(expected);
    });

    it('covers every kind in the table, so a new one cannot be added untested', () => {
      expect(cases.map(([kind]) => kind).sort()).toEqual(Object.keys(PROVENANCE_KINDS).sort());
    });
  });
});

/**
 * Declared names are user input, and the schemas allow names that mean something to an ordinary object:
 * `constructor` matches the command-name and feature-id patterns, and `entities`/`relKinds` are
 * unrestricted strings. A record indexed by them has to be a record, not an object with a prototype.
 */
describe('a name that means something to an ordinary object', () => {
  it('is not found on a record that never declared it', () => {
    const merged = _mergeProvenance('entities', [dep('base-pack', { manifest: { data: { entities: { Memo: {} } } } })]);
    expect(merged['constructor']).toBeUndefined();
    expect(merged['toString']).toBeUndefined();
  });

  it('is recorded like any other name when a pack does declare it', () => {
    const merged = _mergeProvenance('entities', [dep('base-pack', { manifest: { data: { entities: { constructor: {} } } } })]);
    expect(merged['constructor']).toBe('base-pack');
  });

  // `record['__proto__'] = id` on an ordinary object sets the prototype and adds no entry, so the name
  // vanished from the snapshot — and a dependent then fell back to the pack it arrived through
  it("keeps an entity named __proto__, which assignment to an ordinary object would drop", () => {
    const merged = _mergeProvenance('entities', [dep('base-pack', { manifest: { data: { entities: { ['__proto__']: {}, Memo: {} } } } })]);
    expect(Object.keys(merged).sort()).toEqual(['Memo', '__proto__']);
    expect(merged['__proto__']).toBe('base-pack');
  });

  /**
   * The round trip a dependency's provenance actually makes. `JSON.parse` *defines* `__proto__` as an
   * own property where assignment would not, so the read side was never the half that lost it.
   */
  it('survives being written to a snapshot and read back', () => {
    const written = _buildProvenance([dep('deep-pack', { manifest: { data: { entities: { ['__proto__']: {} } } } })]);
    const readBack = JSON.parse(JSON.stringify(written));
    const merged = _mergeProvenance('entities', [dep('mid-pack', { manifest: {}, provenance: readBack })]);
    expect(merged['__proto__']).toBe('deep-pack');
  });
});

describe('_buildProvenance', () => {
  it('records every kind that declared something', () => {
    const provenance = _buildProvenance(
      [dep('base-pack', { manifest: { data: { entities: { Note: {} } } } })],
      { id: 'app-pack', manifest: { features: { app: { surface: {} } } } },
    );
    expect(provenance).toEqual({ entities: { Note: 'base-pack' }, surfaces: { 'app-pack/app': 'app-pack' } });
  });

  // An empty record and an absent kind would read the same; the absent one says what it means
  it('leaves out a kind nothing declared, rather than writing it empty', () => {
    expect(_buildProvenance([dep('bare-pack', { manifest: {} })])).toEqual({});
  });
});
