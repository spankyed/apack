/**
 * The entity types and relation kinds the SDK owns: the data model the SDK's compilers, appliers and
 * repositories are written against (flows and their nodes, actions, prompts and documents). A relation
 * is not an entity: `findRelations` reads them. A flow run is not one: it is a record in the run history
 * (`services.runHistory`). Every pack has them, and no pack declares them. The
 * generator, the manifest schema and the host all read this module.
 *
 * The shapes here are part of the typed EARS contract (packages/apack-sdk/TYPED-EARS.md).
 */
import type { BaseEntity, RelationRules, RequiredField, RowRules, ShortCode } from '@apackdev/ears';

export const SDK_ENTITIES = {
  Flow: 'Flow',
  /** A flow's step or trigger */
  Node: 'Node',
  Action: 'Action',
  Prompt: 'Prompt',
  /** Text a pack ships and the user edits; a feature's surface is the editor over these rows */
  Document: 'Document',
  /** A folder documents and other folders sit in */
  Collection: 'Collection',
} as const;

/**
 * The short code prefix of each SDK entity that is numbered, as a pack's manifest entry declares one (`shortCode`): three
 * uppercase letters, the word's common abbreviation where it has one (`DOC`) and otherwise its first letter and
 * next two consonants (`FLW`, `PRM`). The shapes' `ShortCode` and `SDK_ROW_RULES` both take theirs from here
 */
export const SDK_SHORT_CODES = {
  Flow: 'FLW',
  Action: 'ACT',
  Prompt: 'PRM',
  Document: 'DOC',
} as const;

export const SDK_REL_KINDS = {
  CONTAINS: 'contains',
  TRANSITIONS_TO: 'transitions_to',
  INSTANCE_OF: 'instance_of',
  /** A folder's child folders; its documents are `contains` */
  PARENT_OF: 'parent_of',
} as const;

/** What the SDK's relation kinds hold their edges to: folders nest as a tree, so `parent_of` closes no cycle */
export const SDK_RELATION_RULES: Readonly<Record<string, RelationRules>> = {
  [SDK_REL_KINDS.PARENT_OF]: { acyclic: true },
};

/** The roles the SDK's flow model grants, which every pack has and none declares */
export const SDK_ROLES = {
  /** The flow that starts when the app boots */
  ROOT_FLOW: 'root_flow',
  /** A flow's entry listener: the node a flow's entry track starts from */
  ENTRY_EVENT: 'entry_event',
} as const;

export interface ActionParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
  description?: string;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
}

export interface TemplateInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  example?: unknown;
}

/**
 * The fields every Node row has. A pack's step node types extend it (`interface FireNode extends
 * NodeBase`), and `apack pack generate-entries` unions them into the pack's shape for Node.
 */
export interface NodeBase extends BaseEntity {
  entityType: typeof SDK_ENTITIES.Node;
  nodeType: string;
  label: string;
  description?: string;
  color?: string;
  final?: boolean;
}

export interface FlowEntity extends BaseEntity {
  entityType: typeof SDK_ENTITIES.Flow;
  /** Numbered by `create` */
  shortCode: ShortCode<typeof SDK_SHORT_CODES.Flow>;
  label: string;
  description?: string;
  flowType: 'workflow' | 'integration';
  createdAt: number;
  contentHash?: string;
}

export interface ActionEntity extends BaseEntity {
  entityType: typeof SDK_ENTITIES.Action;
  label: string;
  description?: string;
  category?: string;
  input: Record<string, ActionParameter>;
  actionFn: string;
  output?: unknown;
  /** SHA256 hash of DSL source at the last apply. Absent on user-created actions. */
  contentHash?: string;
  /** Numbered by `create` */
  shortCode: ShortCode<typeof SDK_SHORT_CODES.Action>;
  createdAt: number;
  updatedAt: number;
}

export interface PromptEntity extends BaseEntity {
  entityType: typeof SDK_ENTITIES.Prompt;
  label: string;
  description?: string;
  category?: string;
  inputs: Record<string, TemplateInput>;
  /** Stored as a string, evaluated at runtime */
  templateFn: string;
  /** Optional JSON schema for structured output */
  outputSchema?: unknown;
  /** SHA256 hash of DSL source at the last apply. Absent on user-created prompts. */
  contentHash?: string;
  /** Numbered by `create` */
  shortCode: ShortCode<typeof SDK_SHORT_CODES.Prompt>;
  createdAt: number;
  updatedAt: number;
}

export interface FieldContent { type: 'field'; fields: Array<{ key: string; value: string }> }
export interface ListContent { type: 'list'; items: string[] }
export interface MarkdownContent { type: 'markdown'; text: string }
export interface TextContent { type: 'text'; text: string }
export interface CodeContent { type: 'code'; text: string; language: string }

/** A section of a document's content, as a markdown source's `<!-- section:<type> -->` markers split it */
export type ContentSection = FieldContent | ListContent | MarkdownContent | TextContent | CodeContent;
export type ContentType = ContentSection['type'];

/** A document's human-readable code, which `create` numbers */
export type DocumentShortCode = ShortCode<typeof SDK_SHORT_CODES.Document>;

/**
 * A document: text a pack ships and the user edits.
 *
 * The SDK owns it because the app reads it — `getCommands()` is a query over the documents whose
 * `documentType` marks them command lists — and because a pack can then store one without depending on
 * whichever pack used to own them. A feature's surface is the editor over these rows, as the flows canvas
 * is over `Flow`.
 *
 * `displayOrder` is here rather than with that editor because it is written when a document is created,
 * and its siblings are mixed: folders by `parent_of`, documents by `contains`. An entity that moved
 * without it would sort differently depending on who wrote it.
 */
export interface DocumentEntity extends BaseEntity {
  entityType: typeof SDK_ENTITIES.Document;
  name: string;
  content: ContentSection[];
  /** Numbered by `create` */
  shortCode: DocumentShortCode;
  displayOrder?: number;
  tags?: string[];
  /** What the document is: `commands` marks a slash-command list. Absent, it is just a document. */
  documentType?: string;
  /** Hash of the content source at the last apply. Absent on user-created documents. */
  contentHash?: string;
}

/**
 * A folder, holding documents by `contains` and other folders by `parent_of`.
 *
 * A place rather than an owner: removing one keeps what it held. `symlinkPath` is a folder standing for a
 * directory on disk — the field is stored here, and resolving it is the editor's, since nothing in the
 * core reads the filesystem.
 */
export interface CollectionEntity extends BaseEntity {
  entityType: typeof SDK_ENTITIES.Collection;
  name: string;
  description?: string;
  displayOrder?: number;
  symlinkPath?: string;
  /** Hash of the content source at the last apply. Absent on user-created folders. */
  contentHash?: string;
}

/**
 * Shapes of the SDK's entities; every pack's generated PackShapes includes them. A pack that defines
 * steps reads Node rows as its step node types (and its dependencies') instead of NodeBase.
 */
export type SdkEntityShapes = {
  Flow: FlowEntity;
  Node: NodeBase;
  Action: ActionEntity;
  Prompt: PromptEntity;
  Document: DocumentEntity;
  Collection: CollectionEntity;
};

/** The keys of SdkEntityShapes, at runtime */
export const SDK_SHAPED_ENTITIES = [
  SDK_ENTITIES.Flow, SDK_ENTITIES.Node, SDK_ENTITIES.Action, SDK_ENTITIES.Prompt,
  SDK_ENTITIES.Document, SDK_ENTITIES.Collection,
] as const;

// Fails to compile when SDK_SHAPED_ENTITIES and SdkEntityShapes list different entities
type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const shapedEntitiesMatchShapes: SameKeys<(typeof SDK_SHAPED_ENTITIES)[number], keyof SdkEntityShapes> = true;
void shapedEntitiesMatchShapes;

/** The prefix a shape's `shortCode` is numbered with (`ShortCode<prefix>`), or `never` when it has none */
type ShortCodePrefix<T> = T extends { shortCode: ShortCode<infer P> } ? P : never;

/**
 * What each SDK entity's created row is held to (`RowRules`): the fields it must hold, which `create` refuses a row
 * without at runtime as its type refuses one at compile time, and the prefix it numbers a short code with
 * (`SDK_SHORT_CODES`). The required fields are the shapes' own: this fails to compile naming the field when a list
 * misses or adds one, and when a shape's `ShortCode` and its prefix disagree.
 */
export const SDK_ROW_RULES = {
  Flow: { required: ['label', 'flowType'], shortCode: SDK_SHORT_CODES.Flow },
  Node: { required: ['nodeType', 'label'] },
  Action: { required: ['label', 'input', 'actionFn'], shortCode: SDK_SHORT_CODES.Action, indexes: ['label', 'category'] },
  Prompt: { required: ['label', 'inputs', 'templateFn'], shortCode: SDK_SHORT_CODES.Prompt, indexes: ['label'] },
  Document: { required: ['name', 'content'], shortCode: SDK_SHORT_CODES.Document, indexes: ['name'] },
  Collection: { required: ['name'], indexes: ['name'] },
} as const satisfies {
  [E in keyof SdkEntityShapes]: RowRules & {
    required: readonly RequiredField<SdkEntityShapes, E>[];
    shortCode?: ShortCodePrefix<SdkEntityShapes[E]>;
    indexes?: readonly (keyof SdkEntityShapes[E] & string)[];
  }
};

/**
 * The fields every entity type is indexed on, beside its own: `contentKey`, which the content applier finds a
 * written item by, on whatever type wrote it. A row holding no such field adds no index entry, so this costs a type
 * that never holds one nothing.
 */
export const SDK_INDEXES = ['contentKey'] as const;

/** @internal A type's row rules with the SDK's indexes added: what every engine the SDK or the app creates is given */
export function _withSdkIndexes(rules: RowRules | undefined): RowRules {
  return { required: [], ...rules, indexes: [...(rules?.indexes ?? []), ...SDK_INDEXES] };
}

type UnlistedRequired = {
  [E in keyof SdkEntityShapes]: Exclude<RequiredField<SdkEntityShapes, E>, (typeof SDK_ROW_RULES)[E]['required'][number]>
}[keyof SdkEntityShapes];
const requiredFieldsListed: [UnlistedRequired] extends [never] ? true : UnlistedRequired = true;
void requiredFieldsListed;

type UnnumberedShortCode = {
  [E in keyof SdkEntityShapes]: [ShortCodePrefix<SdkEntityShapes[E]>] extends [never] ? never
    : (typeof SDK_ROW_RULES)[E] extends { shortCode: string } ? never : E
}[keyof SdkEntityShapes];
const shortCodesNumbered: [UnnumberedShortCode] extends [never] ? true : UnnumberedShortCode = true;
void shortCodesNumbered;
