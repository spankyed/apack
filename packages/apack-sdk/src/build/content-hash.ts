import * as crypto from 'node:crypto';

export function contentHash(data: object): string {
  return crypto.createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .slice(0, 16);
}
