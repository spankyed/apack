/**
 * `--with-secrets`: give a new profile a copy of the secrets the shared data dir already holds.
 *
 * A profile starts with none, which is what makes it self-contained — its data, packs, logs and secrets
 * are all inside it, so `rm -rf` is the whole cleanup. That is the right default and it has one cost: a
 * throwaway profile cannot call a model, or reach anything else a secret is for, until someone types one
 * into Settings — every single run.
 *
 * **Secrets, not keys.** The store was always meant to hold any secret a user has; that it holds only model
 * API keys today, keyed by `SecretProvider`, is an early prototype requirement rather than the design. So
 * nothing here narrows its vocabulary to "keys" — a reader who adds the next class of secret should find
 * no wording telling them this was for API keys.
 *
 * One neighbour it is worth not confusing with: the **data key** below, which is the one key in play here
 * and encrypts the rest.
 *
 * This is the opt-out, and it keeps the property that mattered. The keys land in the profile's own file
 * vault rather than the OS keychain, so removing the directory still removes them; nothing is written to
 * the keychain, and nothing outside the profile is touched. What it costs is that the copy is protected by
 * file permissions alone (0600) rather than by the credential store — the same trade every profile already
 * makes, which the app states in Settings as "a key kept in a file on this system".
 *
 * **It copies the data key rather than re-encrypting.** The credential store never holds a secret itself —
 * it holds one data key, at `secrets:<keyId>`, and `secrets.json` holds every value encrypted under it. So
 * carrying that one key across makes the copied file readable as it stands, where decrypting and
 * re-encrypting would put every plaintext value through this process for no gain.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { appDataDirFor, resolveAppEnvironment, type AppEnv } from '@apackdev/sdk/env';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { dataKeyAccount, dataKeyFile, fileKeyVault, osKeyVault, type KeyVault } from '@apackdev/host/secrets';
import type { OpenedProfile } from './profiles.ts';

/** What a secrets file records about itself. Only the fields this needs; the store owns the rest. */
interface SecretsFile {
  protection?: 'os-keystore' | 'unprotected';
  keyId?: string;
  secrets?: unknown[];
}

const readFile = (file: string): SecretsFile | undefined => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as SecretsFile;
  } catch {
    return undefined;
  }
};

/**
 * Where the shared data dir for this environment keeps its secrets. Every *path* here comes from
 * `appDataDirFor` rather than `resolveAppEnvironment().userDataDir`, because that one follows
 * `APACK_USER_DATA_DIR`: the source has to be the environment's own directory, never whatever an enclosing
 * profile pointed this process at.
 */
function sourceSecretsFile(env: AppEnv): string {
  return _appDataPaths(appDataDirFor(env)).secretsFile;
}

/**
 * The vault a secrets file's own `protection` says its data key is in — which is a different question from the
 * one the app answers when it opens a store: the app chooses a vault for one it may be about to create, from
 * the environment and the user's choice, while a tool reading a store that already exists must use whichever
 * one the file records.
 *
 * The credential store's service is the app name, read through `resolveAppEnvironment` — the same accessor the
 * app's own store uses, so the two cannot drift. Only `appName` is taken from that context: its `userDataDir`
 * would follow `APACK_USER_DATA_DIR`, where every path here comes from `appDataDirFor` instead.
 */
function vaultFor(file: SecretsFile, secretsFile: string, env: AppEnv): KeyVault {
  if (file.protection === 'unprotected') return fileKeyVault(dataKeyFile(secretsFile));
  return osKeyVault(resolveAppEnvironment({ env }).appName);
}

export interface SecretCopy {
  /** How many stored keys the profile now has */
  count: number;
  /** Where they came from */
  from: string;
}

/**
 * Copies the environment's stored keys into `profile`, or explains why it cannot.
 *
 * Throws rather than warning: `--with-secrets` was asked for, and a run that silently starts with no keys is
 * the thing this exists to prevent. Reading the source key may prompt for keychain access, which is the
 * credential store doing its job.
 */
export function copySecretsInto(profile: OpenedProfile, env: AppEnv): SecretCopy {
  if (!profile.created) throw new Error('--with-secrets copies into a new profile only. Use --fresh or choose a new profile name.');
  const from = sourceSecretsFile(env);
  const source = readFile(from);
  if (!source) throw new Error(`--with-secrets found no keys to copy: ${from} doesn't exist or can't be read.`);

  const count = Array.isArray(source.secrets) ? source.secrets.length : 0;
  if (count === 0) throw new Error(`--with-secrets found no keys to copy: ${from} holds none.`);
  if (!source.keyId) throw new Error(`--with-secrets can't read ${from}: it records no keyId.`);

  const dataKey = vaultFor(source, from, env).get(dataKeyAccount(source.keyId));
  if (dataKey === undefined) {
    throw new Error(
      `--with-secrets could not read the data key for ${from}. Its values stay encrypted without it, so there `
      + 'is nothing useful to copy. Open Settings → Secrets in the app once to re-establish it.',
    );
  }

  const target = _appDataPaths(profile.dir).secretsFile;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // `unprotected` because the key now lives beside the file rather than in the credential store, and the
  // app reads this field to tell the user which it is
  fs.writeFileSync(target, JSON.stringify({ ...source, protection: 'unprotected' }, null, 2) + '\n');
  fileKeyVault(dataKeyFile(target)).set(dataKeyAccount(source.keyId), dataKey);

  return { count, from };
}
