// Redaction's side of the secrets store: the key values this process has used, so logs can mask them wherever they
// are printed. The app binds this as HostRuntime.redaction; the SDK reads it and has no way to install another, so
// what counts as a secret is the host's to say.
import * as crypto from 'node:crypto';
import type { SecretRedaction } from '@apackdev/sdk/runtime';

const digests = new Set<string>();
const lengths = new Set<number>();
const sha256 = (text: string) => crypto.hash('sha256', text, 'hex');

/**
 * Lets redaction mask this value wherever it's printed, without keeping it: only its digest and its length are
 * recorded. The secrets store registers every value it encrypts or decrypts.
 */
export function registerSecretValue(value: string): void {
  if (value === '') return;
  digests.add(sha256(value));
  lengths.add(value.length);
}

/** What the app binds as `HostRuntime.redaction` */
export const secretRedaction: SecretRedaction = {
  // The length check comes first, so a run that can't be a stored value is never copied or hashed
  matchesSecret: (text, from, to) => lengths.has(to - from) && digests.has(sha256(text.slice(from, to))),
};
