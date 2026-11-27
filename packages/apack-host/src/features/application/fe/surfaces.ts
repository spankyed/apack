// The shell's surfaces: their order, moving between them, and surface history.
import type { Surface } from '@apackdev/sdk/fe';
import { HOST_PACK_ID, splitRef } from '@apackdev/sdk/ids';
import type { ShellContext } from './types.ts';

/** `surfaces` with the app's own (the host's: the Packs tab) after every pack's, each group in its order */
export function withHostLast(surfaces: Surface[]): Surface[] {
  const isHost = (surface: Surface) => splitRef(surface.id)?.packId === HOST_PACK_ID;
  return [...surfaces.filter((surface) => !isHost(surface)), ...surfaces.filter(isHost)];
}

/** The adjacent declared tab, wrapping around; absent when the current tab is hidden. */
export function neighbourOf<T extends { id: string }>(visible: readonly T[], activeSurfaceId: string, direction: 'up' | 'down'): T | undefined {
  const index = visible.findIndex((surface) => surface.id === activeSurfaceId);
  if (index === -1) return undefined;
  return visible[(index + (direction === 'up' ? -1 : 1) + visible.length) % visible.length];
}

/** The history after opening `surface`: moved within it when `historyIndex` is set (back and forward), else extended */
export function historyAfter(
  context: Pick<ShellContext, 'surfaceHistory' | 'historyIndex'>,
  surface: string,
  historyIndex?: number,
): Pick<ShellContext, 'surfaceHistory' | 'historyIndex'> {
  if (historyIndex !== undefined) return { surfaceHistory: context.surfaceHistory, historyIndex };
  const history = context.surfaceHistory.slice(0, context.historyIndex + 1);
  if (history[history.length - 1] === surface) return { surfaceHistory: context.surfaceHistory, historyIndex: context.historyIndex };
  return { surfaceHistory: [...history, surface], historyIndex: history.length };
}
