// The app's own state: one AppState row the host declares and alone reads and writes. Packs never read
// it; they learn whether the user onboarded through services.onboarding, and the renderer through the
// application surface's CLIENT_CONNECTED. Resetting the user's settings doesn't touch it; resetting the
// app (appData.reset()) empties it with everything else.
import { type Ears } from '@elmdb/ears';
import { untypedUpsert, untypedQuery } from '@apackdev/sdk/ears';
import type { EARS } from '@apackdev/sdk';
import { SETTINGS_ENTITY } from '../features/settings/be/store.ts';
import { APPLIED_CONTENT_ENTITY } from './applied-content.ts';

export { appliedContent, APPLIED_CONTENT_ENTITY, type AppliedContent } from './applied-content.ts';

/** The entity type the host declares, next to the SDK's */
export const APP_STATE_ENTITY = 'AppState';

/**
 * The entity types the host declares — its state, the settings row, and each pack's applied content; no pack
 * may declare them.
 */
export const HOST_ENTITY_TYPES: readonly string[] = [APP_STATE_ENTITY, SETTINGS_ENTITY, APPLIED_CONTENT_ENTITY];

const APP_STATE_ID = `${APP_STATE_ENTITY}-app` as EARS.EntityId;

export interface AppState {
  /** Whether the user finished onboarding */
  hasOnboarded: boolean;
  /** The app version the data was last migrated to; absent until the first migrations run records it */
  version?: string;
  /**
   * Each external pack's version its migrations last ran to, by pack id.
   *
   * Kept when the pack is uninstalled, as its applied content is: these say what has been done to the
   * data, and uninstalling a pack deletes its directory, not its entities. Forgetting them would run a
   * reinstalled pack's migrations again over data they have already moved. A pack reinstalled at the
   * version it was therefore neither migrates nor re-applies — `services.appData` re-imports its content
   * if the entities really are gone.
   */
  packVersions: Record<string, string>;
  /**
   * For each pack whose last apply of its content failed, the state of the packs it depends on at that
   * moment. A pack that applied cleanly has no entry.
   *
   * It is what makes a failed apply retryable without re-importing it on every boot: the pack's own
   * revision (`AppliedContent.revision`) says whether its data changed, and this says whether anything it
   * depends on has applied since — the other thing that could change the outcome.
   */
  failedAgainst: Record<string, string>;
  /**
   * The surfaces whose sidebar tab the user showed or hid, by ref. A surface not here shows as its feature declares
   * (`features[].settings`' `visible`), so a pack's default reaches everyone who never touched its tab.
   */
  surfaceVisibility: Record<string, boolean>;
  /** The surface the user last had open, by ref; a window opens on it once it connects */
  lastActiveSurface?: string;
}

const FIELDS = [
  'hasOnboarded', 'version', 'packVersions', 'failedAgainst',
  'surfaceVisibility', 'lastActiveSurface',
] as const satisfies readonly (keyof AppState)[];

/**
 * `FIELDS` is what `stored()` reads back, so a field the interface has and this list lacks is written and
 * then always reads as its default — no type error, and only a round-trip test would notice. This makes
 * the omission a build failure naming the field.
 */
type UnreadField = Exclude<keyof AppState, (typeof FIELDS)[number]>;
const _everyFieldIsRead: [UnreadField] extends [never] ? true : UnreadField = true;
void _everyFieldIsRead;

/** The fields holding one entry per pack, from the shape rather than a list of their names */
type PerPackField = { [K in keyof AppState]-?: AppState[K] extends Record<string, PerPackValue> ? K : never }[keyof AppState];
/** What one pack's entry may be */
type PerPackValue = string;

type StoredAppState = Partial<AppState>;

/** App state on a specific engine; the default instance follows the installed app engine. */
export function createAppState(ears: Pick<Ears, 'query' | 'upsert'>) {
  function stored(): StoredAppState | undefined {
    return ears.query.ids(APP_STATE_ID).pickOne([...FIELDS]) as StoredAppState | undefined ?? undefined;
  }

  const state = {
    /** Whether the row exists: data from before AppState, or no data at all, has none */
    exists: (): boolean => stored() !== undefined,

    /** The app's state; fields never written read as their defaults */
    get: (): AppState => {
      const row = stored() ?? {};
      return {
        hasOnboarded: row.hasOnboarded ?? false,
        ...(row.version !== undefined && { version: row.version }),
        packVersions: row.packVersions ?? {},
        failedAgainst: row.failedAgainst ?? {},
        surfaceVisibility: row.surfaceVisibility ?? {},
        ...(row.lastActiveSurface != null && { lastActiveSurface: row.lastActiveSurface }),
      };
    },

    /** Writes the given fields, creating the row on the first write */
    update: (changes: Partial<AppState>): void => {
      // A field given as undefined is left alone, as setMany leaves one
      ears.upsert(APP_STATE_ENTITY, { id: APP_STATE_ID, ...changes });
    },

    /** Records one pack's entry in a per-pack field, or with `undefined` removes it, leaving the others' alone */
    updatePackEntry: (field: PerPackField, packId: string, value: PerPackValue | undefined): void => {
      const entries = { ...state.get()[field] };
      if (value === undefined) delete entries[packId];
      else entries[packId] = value;
      state.update({ [field]: entries });
    },
  };
  return state;
}

export const appState = createAppState({ query: untypedQuery, upsert: untypedUpsert });
