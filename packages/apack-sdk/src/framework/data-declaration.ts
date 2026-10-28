import { hasOwn } from '../utils/shared.ts';
import type { EmbedDeclaration, RelationRules, RowRules, SearchDeclaration } from '@apackdev/ears';
import type { EmbeddingModelId } from '../services/models.ts';

/** One entity type's declaration: everything the manifest says about it, in its own entry */
export interface PackEntityDeclaration {
  /** The pack-root-relative TypeScript export of its row's shape (`path#Export`); none for an untyped entity */
  readonly shape?: string;
  /** The prefix `create` numbers its rows' short codes with, `<prefix>-<n>`; none for an entity that isn't numbered */
  readonly shortCode?: string;
  /** The fields a `where` on its rows reads an index for; any other field is found by filtering the type */
  readonly indexes?: readonly string[];
  /** Its text index: the fields `search` matches, each at its weight, and the language it stems in */
  readonly search?: PackSearchDeclaration;
  /** Its vector index: the fields whose text is embedded, and the model `services.inference` embeds it with */
  readonly embed?: PackEmbedDeclaration;
  /** Its trigram index: the fields `containing` and `matching` read */
  readonly substrings?: readonly string[];
}

/** A vector index as a manifest declares it: the engine's `EmbedDeclaration`, its model one `services.inference` runs */
export interface PackEmbedDeclaration extends EmbedDeclaration {
  /** The model, as `provider:model`, that `embedPending` (`@apackdev/sdk/services`) embeds the chunks with */
  readonly model: EmbeddingModelId;
}

/** A language a text index stems in (ISO 639-1): Snowball's, as elmdb names them */
export type SearchStemLanguage = (typeof _SEARCH_STEM_LANGUAGES)[number];

/** A text index as a manifest declares it: the engine's `SearchDeclaration`, its language one elmdb stems in */
export interface PackSearchDeclaration extends SearchDeclaration {
  /** The language whose stems match a word's other forms: with `en`, "running" matches "runs" */
  readonly stem?: SearchStemLanguage;
}

/**
 * One relation kind's declaration: what its edges are held to, each rule off unless declared. `{}` declares a kind
 * with none
 */
export interface PackRelationDeclaration {
  /** A link that would close a cycle through this kind is refused (`CYCLE`): a tree, a folder hierarchy */
  readonly acyclic?: boolean;
  /** At most one edge of this kind from an entity to another; linking the pair again replaces the edge's info */
  readonly unique?: boolean;
}

/** Declarative entity ownership/shapes and the pack-level relation wire vocabulary. */
export interface PackDataDeclarations {
  data?: {
    entities?: Readonly<Record<string, PackEntityDeclaration>>;
    relations?: Readonly<Record<string, PackRelationDeclaration>>;
    roles?: readonly string[];
  };
  features?: Readonly<Record<string, object>>;
}

/** @internal A normalized entity declaration; paths are relative to the pack root. */
export interface _PackEntityDeclaration {
  name: string;
  owner: string;
  shape: string | null;
  /** The prefix its short codes are numbered with, when its entry names one */
  shortCode?: string;
  /** The fields it declares an index for, when its entry names any */
  indexes?: readonly string[];
  /** Its text index, when its entry declares one */
  search?: SearchDeclaration;
  /** Its vector index, when its entry declares one */
  embed?: EmbedDeclaration;
  /** The fields its trigram index reads, when its entry declares one */
  substrings?: readonly string[];
}

/**
 * @internal A short code prefix: three uppercase letters — the word's common abbreviation where it has one (`DOC`, `MSG`), and
 * otherwise its first letter and next two distinct consonants (`THR`, `FLW`). The pattern is the rule; the choice
 * of letters is the convention
 */
export const _SHORT_CODE_PATTERN = /^[A-Z]{3}$/;

type DeclarationBlock = { entities?: Readonly<Record<string, PackEntityDeclaration>> } | null | undefined;

/** @internal Read declarations without loading shape modules; refuse ambiguous ownership. */
export function _packEntities(declaration: PackDataDeclarations): _PackEntityDeclaration[] {
  const result = new Map<string, _PackEntityDeclaration>();
  const homes: Array<[string, DeclarationBlock]> = [
    ['data', declaration.data],
    ...Object.entries(declaration.features ?? {}).map(([id, feature]): [string, DeclarationBlock] => [`features.${id}`, feature as DeclarationBlock]),
  ];
  const prefixOwners = new Map<string, string>();
  for (const [owner, block] of homes) {
    for (const [name, entry] of Object.entries(block?.entities ?? {})) {
      const previous = result.get(name);
      if (previous) throw new Error(`Entity "${name}" is declared by both "${previous.owner}" and "${owner}"`);
      const { shape, shortCode, indexes, search, embed, substrings } = entry ?? {};
      if (shortCode !== undefined) {
        if (!_SHORT_CODE_PATTERN.test(shortCode)) throw new Error(`The short code prefix of "${name}" is "${shortCode}": a prefix is three uppercase letters`);
        const taken = prefixOwners.get(shortCode);
        if (taken) throw new Error(`The short code prefix "${shortCode}" is declared for both "${taken}" and "${name}"`);
        prefixOwners.set(shortCode, name);
      }
      result.set(name, {
        name, owner, shape: shape ?? null,
        ...(shortCode !== undefined && { shortCode }), ...(indexes?.length && { indexes }), ...(search && { search }), ...(embed && { embed }),
        ...(substrings?.length && { substrings }),
      });
    }
  }
  return [...result.values()];
}

/** @internal Flat wire identities for EARS and compiled type inventories. */
export function _packEntityTypes(declaration: PackDataDeclarations): Record<string, string> {
  return Object.fromEntries(_packEntities(declaration).map(({ name }) => [name, name]));
}

/** @internal Each of the pack's numbered entity types and the prefix its manifest declares */
export function _packShortCodes(declaration: PackDataDeclarations): Record<string, string> {
  return Object.fromEntries(_packEntities(declaration).flatMap(({ name, shortCode }) => (shortCode === undefined ? [] : [[name, shortCode]])));
}

/**
 * @internal A lookup from a short code to the entity type that numbers it, built from the row rules holding each
 * type's prefix (`RowRules.shortCode`): `THR-41` → `Thread`. Undefined for a code that isn't `<prefix>-<n>`, or whose
 * prefix no type declares. A prefix belongs to one type across the app, which the registry and the manifest schema
 * enforce, so the answer is never ambiguous; the app's registry, a data dir's schema and the test runtime build theirs
 * with this, so all three answer alike.
 */
export function _shortCodeTypes(rules: ReadonlyArray<readonly [string, Partial<RowRules>]>): (code: string) => string | undefined {
  const byPrefix = new Map<string, string>();
  for (const [type, { shortCode }] of rules) if (shortCode) byPrefix.set(shortCode, type);
  return (code) => {
    if (typeof code !== 'string') return undefined;
    const dash = code.lastIndexOf('-');
    if (dash <= 0 || !/^[1-9][0-9]*$/.test(code.slice(dash + 1))) return undefined;
    return byPrefix.get(code.slice(0, dash));
  };
}

/** @internal The languages a text index stems in: Snowball's, as elmdb names them (ISO 639-1) */
export const _SEARCH_STEM_LANGUAGES = ['ar', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hu', 'it', 'nl', 'no', 'pt', 'ro', 'ru', 'sv', 'ta', 'tr'] as const;

/** An entity type's name: PascalCase, as the database holds a type's */
export const _ENTITY_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

/** A field the database is told of, one a shape requires or an entry indexes: lowerCamelCase, as it holds a field's */
export const _FIELD_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;

/** A relation kind's or a role's stored name: snake_case, its generated EARS constant the same in uppercase */
export const _WIRE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** The flat EARS constants of a list of wire names, refusing an invalid or repeated one */
function wireConstants(wires: readonly string[], what: 'Relation' | 'Role', key: 'relations' | 'roles'): Record<string, string> {
  const constants: Record<string, string> = {};
  for (const wire of wires) {
    if (!_WIRE_NAME_PATTERN.test(wire)) throw new Error(`${what} "${wire}" must be a snake_case wire name`);
    const name = wire.toUpperCase();
    if (hasOwn(constants, name)) throw new Error(`${what} "${wire}" is declared twice in data.${key}`);
    constants[name] = wire;
  }
  return constants;
}

/** @internal The pack's relation kinds as EARS constants (`tagged_with` → `TAGGED_WITH`) */
export function _packRelationTypes(declaration: PackDataDeclarations): Record<string, string> {
  return wireConstants(Object.keys(declaration.data?.relations ?? {}), 'Relation', 'relations');
}

/** @internal What each of the pack's relation kinds that declares a rule holds its edges to, by wire name */
export function _packRelationRules(declaration: PackDataDeclarations): Record<string, RelationRules> {
  const rules: Record<string, RelationRules> = {};
  for (const [wire, { acyclic, unique }] of Object.entries(declaration.data?.relations ?? {})) {
    if (acyclic || unique) rules[wire] = { ...(acyclic && { acyclic }), ...(unique && { unique }) };
  }
  return rules;
}

/** @internal The pack's roles as EARS constants (`entry_event` → `ENTRY_EVENT`) */
export function _packRoles(declaration: PackDataDeclarations): Record<string, string> {
  return wireConstants(declaration.data?.roles ?? [], 'Role', 'roles');
}
