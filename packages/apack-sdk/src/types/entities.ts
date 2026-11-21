/*───────────────────────────────────────────────────────────────────────────
 * The SDK's EARS namespace: the engine's (@elmdb/ears) with the entity types,
 * relation kinds and roles the SDK owns (sdk-entities.ts). Packs add theirs in their
 * generated EARS.
 *
 * CHANGE CONTROL: these types are a specified contract, and editor completions and error messages
 * depend on their exact form. Don't change them to make one call site compile; fix the call site.
 * Read packages/apack-sdk/TYPED-EARS.md (the contract and the pre-change checklist) first.
 *───────────────────────────────────────────────────────────────────────────*/
import { EARS as Core } from '@elmdb/ears';
import { SDK_ENTITIES, SDK_REL_KINDS, SDK_ROLES } from './sdk-entities.ts';

export namespace EARS {
  // ─── Entity ────────────────────────────────────────────────────────────
  // The SDK's own entities; packs add theirs in their generated EARS
  export const Entity = SDK_ENTITIES;

  export type Entity = typeof Entity[keyof typeof Entity] | (string & {});
  export type EntityId<E extends string = string> = Core.EntityId<E>;
  export type RelationId = Core.RelationId;

  // ─── RelKind ───────────────────────────────────────────────────────────
  export const RelKind = SDK_REL_KINDS;

  export type RelKind = Core.RelKind;

  // ─── RoleKind ──────────────────────────────────────────────────────────
  export const RoleKind = SDK_ROLES;
  export type RoleKind = Core.RoleKind;

  export const AttrKindValues = Core.AttrKindValues;
  export const AttrKind = Core.AttrKind;
  export type AttrKind = Core.AttrKind;

  export type AttributePayloads = Core.AttributePayloads;
  export type AttributeValue<K extends AttrKind = AttrKind> = Core.AttributeValue<K>;
  export type AttributeTypeMap = Core.AttributeTypeMap;
  export type AttributeType = Core.AttributeType;
  export type AttributeStore = Core.AttributeStore;

}
