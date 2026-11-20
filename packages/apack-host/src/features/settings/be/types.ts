import type { ApplicationHotkeys, SettingsTarget, SettingsSnapshot, SettingsRecovery, SettingsRecoveryRequest, SettingsWriteCondition } from '@apackdev/sdk/types';
import type { ApplyResult } from '@apackdev/sdk/utils';
import type { PackContentPreview } from '@apackdev/sdk/content';
import type { SecretMetadata, SecretsStatus } from '@apackdev/sdk/services';
// The settings feature's contract: what its system receives, what it sends its surface, and its context.
// A leaf the system module doesn't import back, so codegen reads it without resolving the machine.

export type IncomingSettingsEvents = { type: 'RESET_APP' };

/** What a read of the settings answers with: the snapshot, or, while they need repair, what is wrong with them */
export type SettingsRead = { snapshot: SettingsSnapshot } | { recovery: SettingsRecovery };

/** A change refused, and why: the store's reasons, each the user's to fix, and nothing was stored */
type Refusable = { fails: { refused: { problems: string[] } } };

/** A change that was stored answers with the settings as they now are */
type Stored = { answer: { snapshot: SettingsSnapshot } } & Refusable;

/**
 * What the settings system answers: a read, and each change, which whoever asked hears was stored or refused. A
 * settings form says "Saved" only then, and a drive session's `/set-setting` answers `ok: false` only then.
 */
export type SettingsAsks = {
  GET_SETTINGS: { answer: SettingsRead };
  RECOVER_SETTINGS: { ask: { request: SettingsRecoveryRequest }; answer: { recovery: SettingsRecovery } } & Refusable;
  UPDATE_SETTINGS: { ask: { target: SettingsTarget; path: string[]; value: unknown; condition?: SettingsWriteCondition } } & Stored;
  RESET_SETTINGS: { ask: { target: SettingsTarget } } & Stored;
  RESET_ALL_SETTINGS: Stored;
  REPLACE_SETTINGS: { ask: { data: unknown; condition?: SettingsWriteCondition } } & Stored;
};

/** A change to the settings, as a window asks for one */
export type SettingsChange = import('@apackdev/sdk/events').AskEventsOf<{ asks: Omit<SettingsAsks, 'GET_SETTINGS'> }>;

// The host's secrets store sends this over the bus (`secrets/index.ts`, `forwardSecretsChanges`), so it arrives
// from outside the feature like any other incoming event, not from a child of this system
export type IncomingSecretsEvents =
  | { type: 'SECRETS_CHANGED' } // The host's stored keys or their protection changed (no values)

// What this system's own `fromCallback` children send it. Nothing else sends these.
export type SettingsInternalEvents =
  | { type: 'SETTINGS_WRITTEN' } // Something wrote the stored settings: this system, a feature's system, an action or an apply
  // The stored data is being replaced wholesale (a backup import), and has been: what each feature was told is then
  // stale either way, since a failed import may have migrated some of the data already
  | { type: 'DATA_REPLACING' }
  | { type: 'DATA_REPLACED' }

export type OutgoingSettingsEvents =
  | { type: 'SETTINGS_RECOVERY'; recovery: SettingsRecovery }
  | { type: 'SETTINGS_LOADED'; snapshot: SettingsSnapshot }
  /** The installed packs changed, so what they answer with in Help has too */
  | { type: 'SETTINGS_UPDATED'; snapshot: SettingsSnapshot }
  | { type: 'SETTINGS_RESET'; snapshot: SettingsSnapshot }
  | { type: 'APPLICATION_HOTKEYS'; hotkeys: ApplicationHotkeys }
  // The four content events are sent by the `packs` system, not this one: the work is pack-level and lives
  // there, while the view that draws it is the settings surface, whose inbox this type is.
  /** `errors` lists the items that couldn't be written (`<key>: <error>`); the rest were imported */
  | { type: 'PACK_CONTENT_IMPORTED'; result: Record<string, ApplyResult>; errors: string[] }
  | { type: 'PACK_CONTENT_IMPORT_FAILED'; error: string }
  | { type: 'PACK_CONTENT_PREVIEW'; preview: PackContentPreview }
  | { type: 'PACK_CONTENT_PREVIEW_FAILED'; error: string }
  | { type: 'APP_RESET_COMPLETE' }
  | { type: 'APP_RESET_FAILED'; error: string }
  /** The stored API keys, without values, and how they're protected */
  | { type: 'SECRETS_UPDATED'; secrets: SecretMetadata[]; status: SecretsStatus }

export type SettingsContext = {
  applied: Record<string, unknown>;
  /** Why a change is refused now, while the stored data is being replaced or reset: storing it would be lost with the data */
  busy?: string;
};
