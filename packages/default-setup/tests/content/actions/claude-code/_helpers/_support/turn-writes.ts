/**
 * What a turn's writers write, and what their writes leave behind.
 *
 * **One declaration of "amplification", because there were three.** The writer specs each phrased the same
 * question their own way — `AMPLIFICATION = 4`, `= 30`, `reply * 8` — so there was no one concept to hold a
 * new writer to, and the figure that mattered most was measured against the wrong denominator for a while:
 * a turn's writes compared with one block's text rather than with everything the turn keeps.
 *
 * So the rule is here. `written()` is what reached storage, by block when asked; `kept()` is what the rows
 * hold at the end, which is what a multiple is *of*. A recorder also models the store — a block write
 * replaces its text, an append splices onto it — because the cases about what a row holds need that and
 * each spec had its own half-copy of it.
 */
import type { Services } from '#generated/services.ts';

export interface TurnWrites {
  readonly services: Services;
  /** Every write's bytes, for one block's type or for the turn */
  written(block?: string): number;
  /** What the rows hold once the turn is over: the denominator of any multiple */
  kept(): number;
  /** What the block's text holds after the nth write, assembled as a read assembles it */
  rowAfter(nth: number): string;
  /** Each write as it was recorded, for a case about which call happened when */
  readonly writes: readonly string[];
}

/** Records what a writer writes, modelling the store well enough to answer what a row holds */
export function recordTurnWrites(): TurnWrites {
  const writes: string[] = [];
  const sizes: Array<{ block: string; bytes: number }> = [];
  const rows: string[] = [];
  /** A block's row by its type: its last whole write, plus the entries hanging off it */
  const blocks = new Map<string, string>();
  const entries = new Map<string, Map<string, string>>();
  let text = '';

  const entriesOf = (block: string) => {
    const held = entries.get(block) ?? new Map<string, string>();
    entries.set(block, held);
    return held;
  };

  const services = {
    chat: {
      // The message's own text, which the stream writer owns. Not a block, so it is counted under the name
      // `text` — what matters is that each owner's writes are weighed against what that owner keeps
      updateMessageState: (_id: unknown, updates: { text?: string }) => {
        if (updates.text === undefined) return;
        const bytes = JSON.stringify(updates);
        writes.push(bytes);
        sizes.push({ block: 'text', bytes: bytes.length });
        blocks.set('text', bytes);
      },
      streamMessageText: () => {},
      updateMessageBlock: (_id: unknown, block: { type: string; props: { content?: string } }) => {
        const bytes = JSON.stringify(block);
        writes.push(bytes);
        sizes.push({ block: block.type, bytes: bytes.length });
        blocks.set(block.type, bytes);
        text = block.props.content ?? '';
        rows.push(text);
        return `row-${block.type}`;
      },
      appendMessageBlockText: (blockId: string, at: number, appended: string) => {
        const bytes = JSON.stringify({ at, text: appended });
        writes.push(bytes);
        sizes.push({ block: String(blockId).replace('row-', ''), bytes: bytes.length });
        text = text.slice(0, at) + appended;
        rows.push(text);
      },
      updateMessageToolEntry: (blockId: string, entry: { id: string }, rowId?: string) => {
        const bytes = JSON.stringify(entry);
        writes.push(bytes);
        sizes.push({ block: String(blockId).replace('row-', ''), bytes: bytes.length });
        entriesOf(String(blockId).replace('row-', '')).set(entry.id, bytes);
        return rowId ?? `entry-${entry.id}`;
      },
      removeMessageBlock: (_id: unknown, type: string) => { blocks.delete(type); entries.delete(type); },
      streamMessageBlockText: () => {},
    },
  } as unknown as Services;

  return {
    services,
    writes,
    written: (block?: string) => sizes
      .filter((one) => block === undefined || one.block === block)
      .reduce((total, one) => total + one.bytes, 0),
    kept: () => [...blocks.values()].reduce((total, row) => total + row.length, 0)
      + [...entries.values()].flatMap((held) => [...held.values()]).reduce((total, row) => total + row.length, 0),
    rowAfter: (nth: number) => rows[nth] as string,
  };
}
