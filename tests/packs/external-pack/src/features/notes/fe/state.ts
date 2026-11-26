// A surface-only feature whose id default-setup already has: two packs, one `notes` feature each, and
// each surface runs under its own pack's id. Nothing here talks to a system — what it proves is the
// addressing, so it stays the smallest surface that can be navigated to and read.
import { state } from '#generated/state.ts';

export const id = 'notes' as const;

const notesState = state<{ data: { label: string } }, never>()({
  data: { label: "the fixture's own notes" },
});

export default notesState;
