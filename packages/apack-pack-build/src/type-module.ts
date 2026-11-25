import { _parseModulePath } from '@apackdev/sdk/framework';
import { relative } from 'node:path';
import { findSourceModule, TYPE_MODULE_EXTENSIONS } from './source-module.ts';

/** Resolve a declared type-only module; its public types enter the generated barrel. */
export function resolveTypeModule(root: string, target: string, label: string): string {
  const file = findSourceModule(root, _parseModulePath(target, label), TYPE_MODULE_EXTENSIONS, label);
  if (!file) throw new Error(`${label}: no TypeScript module found at ${target} (.ts or /index.ts)`);
  return relative(root, file).split('\\').join('/');
}
