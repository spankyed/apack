import type { BrainContext } from './contract.ts';

export const isShown = (brain: { readonly data: unknown }) => (brain.data as BrainContext).inspectEnabled;
