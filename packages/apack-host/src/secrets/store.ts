// The user's API keys: metadata in plain text and each value encrypted (AES-256-GCM) in one file, with the data key in
// a KeyVault. Listing, selecting, renaming and deleting never need the data key; the data key is read the first time a
// value is encrypted or decrypted, and kept in memory after that. Values are decrypted on each use. The first status
// checks the OS vault can be reached, reading an account that holds no item. Every value it encrypts or decrypts is
// also recorded as a digest, so logs can mask it (`rememberForRedaction`); no plaintext is kept.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { _secretRules, _secretProviderLabel, _toSecretMetadata, type ProviderName, type SecretMetadata, type SecretProvider, type SecretsStatus } from '@apackdev/sdk/services';
import { registerSecretValue } from './redaction.ts';
import { writePrivateFile } from '../private-file.ts';
import { dataKeyAccount, KeyVaultUnavailableError, type KeyVault } from './vault.ts';

const FORMAT = 1;
const AUTH_TAG_BYTES = 16;

interface EncryptedValue { keyId: string; iv: string; tag: string; data: string }
interface StoredSecret extends SecretMetadata { value: EncryptedValue }
interface SecretsFile { format: number; protection: 'os-keystore' | 'unprotected'; keyId: string; secrets: StoredSecret[] }

export interface SecretsStoreOptions {
  /** The store's file; its directory also holds the file vault's data keys */
  filePath: string;
  osVault: () => KeyVault;
  fileVault: () => KeyVault;
  /** Always use the file vault (the test environment, or a development opt-in) */
  useFileVault?: boolean;
  now?: () => number;
}

export interface SecretsStore {
  status(): SecretsStatus;
  list(): SecretMetadata[];
  select(id: string): void;
  rename(id: string, label: string): void;
  delete(id: string): void;
  add(provider: SecretProvider, label: string, value: string): SecretMetadata;
  replaceValue(id: string, value: string): void;
  /** The selected key's value for a provider; throws naming the fix when there's none or it can't be read */
  keyFor(provider: ProviderName): string;
  /** Keeps data keys in a file from now on, where the OS has no credential store */
  allowUnprotected(): void;
  /**
   * Deletes every stored key. The data key stays in its vault, where a copy of the data directory may share it, and
   * encrypts the keys added next; a file that can't be read is deleted.
   */
  clearAll(): void;
  /** Tells listeners the stored keys may have changed, as when another process wrote them: what `list` reads is the file */
  changedElsewhere(): void;
  /**
   * Calls `listener` after every change to what `list` or `status` return: each change to the stored keys, and the OS
   * credential store failing (status `unavailable`) or working again. Returns a function that stops the calls.
   */
  onChange(listener: () => void): () => void;
}


/**
 * Lets redaction mask this value wherever it's printed, without keeping it: only its digest and length are recorded,
 * and only for values this process handled. It's how keys with no recognizable prefix (Mistral, Cohere) stay out of logs.
 */
const rememberForRedaction = (value: string) => { registerSecretValue(value); };

const newKeyId = () => `k_${crypto.randomBytes(12).toString('base64url')}`;
/** An account no data key uses (key ids start with `k_`): reading it checks the OS vault without finding an item to prompt for */
const PROBE_ACCOUNT = dataKeyAccount('probe');

export function createSecretsStore(options: SecretsStoreOptions): SecretsStore {
  const now = options.now ?? Date.now;
  /** Data keys read or created this process, by key id */
  const dataKeys = new Map<string, Buffer>();
  /** The OS vault failed its last use: status is `unavailable` until a vault call succeeds or the user allows unprotected storage */
  let osVaultUnavailable = false;
  /** Whether `status` has checked this process that the OS vault can be reached */
  let osVaultProbed = false;
  /** Data keys set in a vault for a file not written yet: removed again when that write fails */
  const pendingKeys: Array<{ vault: KeyVault; keyId: string }> = [];
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        // The change is already stored: a listener's failure doesn't undo or fail it
        console.error('[secrets] A change listener failed:', error);
      }
    }
  };

  const read = (): SecretsFile => {
    if (!fs.existsSync(options.filePath)) return { format: FORMAT, protection: 'os-keystore', keyId: newKeyId(), secrets: [] };
    const file = JSON.parse(fs.readFileSync(options.filePath, 'utf-8')) as SecretsFile;
    if (file.format !== FORMAT) throw new Error(`Unknown stored keys format ${file.format} in ${options.filePath}`);
    return file;
  };

  const write = (file: SecretsFile) => {
    const created = pendingKeys.splice(0);
    try {
      writePrivateFile(options.filePath, JSON.stringify(file, null, 2));
    } catch (error) {
      // No written file names these data keys: don't leave them in the vault
      for (const { vault, keyId } of created) {
        dataKeys.delete(keyId);
        try {
          vault.delete(dataKeyAccount(keyId));
        } catch {
          // The vault is unavailable too; nothing more to do
        }
      }
      throw error;
    }
    notify();
  };

  const vaultFor = (file: SecretsFile): KeyVault =>
    options.useFileVault || file.protection === 'unprotected' ? options.fileVault() : options.osVault();

  const setOsVaultUnavailable = (unavailable: boolean) => {
    if (osVaultUnavailable === unavailable) return;
    osVaultUnavailable = unavailable;
    notify();
  };

  /** Runs a vault call, remembering whether the OS vault could be used */
  const withVault = <T>(file: SecretsFile, run: (vault: KeyVault) => T): T => {
    const vault = vaultFor(file);
    if (vault.protection !== 'os-keystore') return run(vault);
    try {
      const result = run(vault);
      setOsVaultUnavailable(false);
      return result;
    } catch (error) {
      if (error instanceof KeyVaultUnavailableError) setOsVaultUnavailable(true);
      throw error;
    }
  };

  const loadKey = (file: SecretsFile, keyId: string): Buffer | undefined => {
    const cached = dataKeys.get(keyId);
    if (cached) return cached;
    const stored = withVault(file, (vault) => vault.get(dataKeyAccount(keyId)));
    if (!stored) return undefined;
    const key = Buffer.from(stored, 'base64');
    dataKeys.set(keyId, key);
    return key;
  };

  /** The key new values are encrypted with: the file's, created when missing (a new key id when older values need the lost one) */
  const encryptionKey = (file: SecretsFile): Buffer => {
    const existing = loadKey(file, file.keyId);
    if (existing) return existing;
    if (file.secrets.some((secret) => secret.value.keyId === file.keyId)) file.keyId = newKeyId();
    const key = crypto.randomBytes(32);
    const keyId = file.keyId;
    withVault(file, (vault) => {
      vault.set(dataKeyAccount(keyId), key.toString('base64'));
      pendingKeys.push({ vault, keyId });
    });
    dataKeys.set(keyId, key);
    return key;
  };

  const aad = (id: string, provider: SecretProvider) => Buffer.from(`${id}:${provider}`);

  const encrypt = (file: SecretsFile, id: string, provider: SecretProvider, value: string): EncryptedValue => {
    rememberForRedaction(value);
    const key = encryptionKey(file);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(id, provider));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { keyId: file.keyId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  };

  const decrypt = (file: SecretsFile, secret: StoredSecret): string => {
    const unreadable = new Error(`The ${_secretProviderLabel(secret.provider)} key "${secret.label}" can't be read on this machine: enter it again in Settings → Secrets`);
    const key = loadKey(file, secret.value.keyId);
    if (!key) throw unreadable;
    try {
      const tag = Buffer.from(secret.value.tag, 'base64');
      if (tag.length !== AUTH_TAG_BYTES) throw unreadable;
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(secret.value.iv, 'base64'), { authTagLength: AUTH_TAG_BYTES });
      decipher.setAAD(aad(secret.id, secret.provider));
      decipher.setAuthTag(tag);
      const value = Buffer.concat([decipher.update(Buffer.from(secret.value.data, 'base64')), decipher.final()]).toString('utf8');
      rememberForRedaction(value);
      return value;
    } catch {
      throw unreadable;
    }
  };

  const change = (update: (secrets: StoredSecret[]) => StoredSecret[]) => {
    const file = read();
    write({ ...file, secrets: update(file.secrets) });
  };

  return {
    status() {
      const file = read();
      const vault = vaultFor(file);
      if (vault.protection === 'os-keystore' && !osVaultProbed) {
        osVaultProbed = true;
        try {
          withVault(file, (probe) => probe.get(PROBE_ACCOUNT));
        } catch (error) {
          // A vault that can't be reached marks the status unavailable (and listeners hear of it); anything else is the next use's to report
          if (!(error instanceof KeyVaultUnavailableError)) console.warn('[secrets] Checking the OS credential store failed:', error);
        }
      }
      if (osVaultUnavailable && vault.protection === 'os-keystore') return { protection: 'unavailable', backend: vault.backend };
      return { protection: vault.protection, backend: vault.backend };
    },
    list: () => read().secrets.map(_toSecretMetadata),
    select: (id) => change((secrets) => _secretRules.select(secrets, id, now())),
    rename: (id, label) => change((secrets) => _secretRules.rename(secrets, id, label, now())),
    delete: (id) => change((secrets) => _secretRules.remove(secrets, id)),

    add(provider, label, value) {
      const file = read();
      const id = `Secret-${crypto.randomUUID()}`;
      // The label is checked before a value is encrypted, so a refused one creates no data key
      const added = _secretRules.add(file.secrets.map(_toSecretMetadata), { id, provider, label, createdAt: now() }).at(-1)!;
      file.secrets = [...file.secrets, { ...added, value: encrypt(file, id, provider, value) }];
      write(file);
      return _toSecretMetadata(file.secrets.find((secret) => secret.id === id)!);
    },

    replaceValue(id, value) {
      const file = read();
      const secret = file.secrets.find((candidate) => candidate.id === id);
      if (!secret) throw new Error(`No stored key "${id}"`);
      const encrypted = encrypt(file, id, secret.provider, value);
      file.secrets = file.secrets.map((candidate) => candidate.id === id ? { ...candidate, value: encrypted, updatedAt: now() } : candidate);
      write(file);
    },

    keyFor(provider) {
      const file = read();
      return decrypt(file, _secretRules.selectedFor(file.secrets, provider));
    },

    allowUnprotected() {
      const file = read();
      if (options.useFileVault || file.protection === 'unprotected') return;
      // Values the OS vault can still decrypt move to a file key; the rest stay unreadable until entered again
      const readable = new Map<string, string>();
      for (const secret of file.secrets) {
        try {
          readable.set(secret.id, decrypt(file, secret));
        } catch {
          // Unreadable here (the OS vault is gone or lost the key)
        }
      }
      const previousKeyIds = new Set(file.secrets.map((secret) => secret.value.keyId).concat(file.keyId));
      const next: SecretsFile = { ...file, protection: 'unprotected', keyId: newKeyId() };
      next.secrets = file.secrets.map((secret) => readable.has(secret.id)
        ? { ...secret, value: encrypt(next, secret.id, secret.provider, readable.get(secret.id)!) }
        : secret);
      write(next);
      osVaultUnavailable = false;
      for (const keyId of previousKeyIds) {
        try {
          options.osVault().delete(dataKeyAccount(keyId));
        } catch {
          // Nothing to delete where the OS vault is unavailable
        }
      }
    },

    clearAll() {
      if (!fs.existsSync(options.filePath)) return;
      const remove = (reason: string, error: unknown) => {
        console.warn(`[secrets] Deleting ${options.filePath}, which ${reason}:`, error instanceof Error ? error.message : error);
        fs.rmSync(options.filePath, { force: true });
        notify();
      };
      let file: SecretsFile;
      try {
        file = read();
      } catch (error) {
        // Nothing in it can be kept
        remove("can't be read", error);
        return;
      }
      try {
        // Keeps the key id and protection, so the next key added reuses the vault's data key
        write({ format: FORMAT, protection: file.protection, keyId: file.keyId, secrets: [] });
      } catch (error) {
        remove("couldn't be emptied", error);
      }
    },

    changedElsewhere: notify,

    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

