// Central authority for every text reveal in the films. One linear curve,
// one cadence per mode. Never run a character count through ease() — easing
// is for opacity/transform only; an eased character count reads as a
// "swoosh-then-stall", not typing.
export type RevealMode = 'type' | 'stream' | 'paste';

// Characters revealed per frame (30fps):
//  - type:   ~30 char/s, a person typing
//  - stream: ~90 char/s, an agent token stream
//  - paste:  appears whole at `start`
export const REVEAL_CHARS_PER_FRAME: Record<RevealMode, number> = {
  type: 1,
  stream: 3,
  paste: Infinity,
};

// Linear reveal at the mode's global cadence. Self-terminating: returns the
// full string once enough frames have elapsed, so callers never need a `to`.
export function revealText(text: string, frame: number, start: number, mode: RevealMode = 'type'): string {
  if (frame <= start) return '';
  if (mode === 'paste') return text;
  const revealed = Math.floor((frame - start) * REVEAL_CHARS_PER_FRAME[mode]);
  return text.slice(0, Math.min(text.length, revealed));
}

// Frame at which `revealText` finishes. Downstream beats reference this
// instead of a hand-picked end frame, so the timeline self-adjusts.
export function revealEnd(text: string, start: number, mode: RevealMode = 'type'): number {
  if (mode === 'paste') return start;
  return start + Math.ceil(text.length / REVEAL_CHARS_PER_FRAME[mode]);
}
