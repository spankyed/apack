import * as path from 'node:path';
import { contentFile } from '@apackdev/pack-format';

export function contentPath(compiledDir: string, name: string): string {
  return path.join(compiledDir, contentFile(name));
}
