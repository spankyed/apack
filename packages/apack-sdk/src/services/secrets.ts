import type { ProviderName } from './models.ts';

/** Whom a stored key is for: a model provider, or `custom` for keys the app's own integrations name */
export type SecretProvider = ProviderName | 'custom';

/** A stored key, without its value: packs and the frontend never receive values */
export interface SecretMetadata {
  id: string;
  provider: SecretProvider;
  /** Names the account, e.g. "Work"; unique per provider */
  label: string;
  /** The key `services.inference` uses for the provider; at most one per provider */
  selected: boolean;
  createdAt: number;
  updatedAt?: number;
}

/**
 * How stored keys are protected on this system:
 * - `os-keystore`: encrypted, with the data key in the OS credential store (`backend` names it)
 * - `unprotected`: encrypted with a data key kept in a file next to them, after the user chose to
 * - `unavailable`: the OS credential store failed its last use (none on this system, or locked); adding a key
 *   tries it again, and the user can allow unprotected storage instead
 */
export type SecretsProtection = 'os-keystore' | 'unprotected' | 'unavailable';

export interface SecretsStatus {
  protection: SecretsProtection;
  /** The store holding the data key, e.g. "macOS Keychain" */
  backend: string;
}

/**
 * The secrets one pack keeps for itself, by a name it chooses: a sign-in's token, say. Another pack cannot read,
 * replace or delete them, and they are not among the user's keys `list` returns. Stored and protected as those
 * keys are, and masked in logs once used.
 */
export interface OwnSecrets {
  /** The value stored under `name`, or `undefined` when there is none */
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  /** Deleting a name that holds nothing does nothing */
  delete(name: string): void;
}

/** The user's API keys as metadata, beside nothing of any pack's: what the host holds before it binds a caller */
export interface UserSecrets {
  status(): SecretsStatus;
  /** Every stored key, without values */
  list(): SecretMetadata[];
  /** Makes the key the one its provider uses, and its provider's other keys not */
  select(id: string): void;
  rename(id: string, label: string): void;
  /** Deleting the selected key leaves its provider with none selected */
  delete(id: string): void;
}

/**
 * The user's API keys, as metadata: list, select, rename and delete them, and the calling pack's own secrets.
 * Adding a key or replacing its value happens only in Settings → Secrets (the host's `secrets` procedures), so no
 * key's value passes through packs or events. The host implements it, bound to the pack calling it.
 */
export interface SecretsService extends UserSecrets {
  /** The calling pack's own secrets */
  own: OwnSecrets;
}

/** Trusted host operations: the user's keys, and a pack's service bound to that pack */
export interface SecretsAdmin extends UserSecrets {
  forPack(packId: string): SecretsService;
}

/** The user's stored keys (without values) and how they're protected */
export interface SecretsSnapshot {
  secrets: SecretMetadata[];
  status: SecretsStatus;
}
