import { existsSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';

export const TYPE_MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const;
export const SCRIPT_MODULE_EXTENSIONS = [...TYPE_MODULE_EXTENSIONS, '.js', '.jsx', '.mjs', '.cjs'] as const;

/** Find a declared module without importing it, resolving extensionless and directory targets alike. */
export function findSourceModule(root: string, target: string, extensions: readonly string[], label: string): string | undefined {
  const normalized = target.split('\\').join('/');
  if (!existsSync(root)) return undefined;
  const canonicalRoot = realpathSync(root);
  const outside = (file: string) => {
    const local = relative(canonicalRoot, file).split('\\').join('/');
    return local === '..' || local.startsWith('../') || isAbsolute(local);
  };
  if (isAbsolute(normalized) || outside(resolve(canonicalRoot, normalized))) {
    throw new Error(`${label}: module must be pack-root-relative and stay within the pack`);
  }
  const file = [normalized, `${normalized}.ts`, `${normalized}/index.ts`]
    .map(candidate => resolve(root, candidate))
    .find(candidate => extensions.includes(extname(candidate)) && existsSync(candidate) && statSync(candidate).isFile());
  if (!file) return undefined;
  if (outside(realpathSync(file))) throw new Error(`${label}: module must stay within the pack`);
  return file;
}
