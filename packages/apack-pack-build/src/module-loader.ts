import { pathToFileURL } from 'node:url';
import type { PackModuleLoader } from './types.ts';

/** Default for standalone SDK consumers; build owners provide their execution namespace. */
export const importPackModule: PackModuleLoader = file => import(pathToFileURL(file).href);
