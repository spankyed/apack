// The SDK's own entities typed by their shapes, as a pack's #generated/ears types the pack's: the SDK's repositories
// and appliers read their rows through it, on the bound engine, rather than naming a row type nothing checks
import { defineEars, type UntypedSchema } from '@apackdev/ears';
import type { SdkEntityShapes } from '../types/sdk-entities.ts';
import { boundEars } from './index.ts';

/** The SDK's entities and their names; any relation kind or role, which the engine checks */
export interface SdkSchema extends UntypedSchema {
  shapes: SdkEntityShapes;
  names: keyof SdkEntityShapes & string;
  /** The SDK declares no weighted relation kind */
  weightedKinds: never;
}

export const sdkEntities = /*#__PURE__*/ defineEars<SdkSchema>(boundEars);
