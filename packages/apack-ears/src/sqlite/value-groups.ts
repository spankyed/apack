import { sameValue } from '../utils.ts';

/** Preserve first encounter order and stored deep equality, with keyed scalar/date lookup. */
export class SqliteValueGroups {
  readonly entries: Array<[unknown, string[]]> = [];
  private readonly scalars = new Map<unknown, number>();
  private readonly dates = new Map<number, number>();
  private readonly compound: number[] = [];

  add(value: unknown, id: string): boolean {
    const scalar = (value === null || typeof value !== 'object') &&
      !(typeof value === 'number' && Number.isNaN(value));
    const date = value instanceof Date && Number.isFinite(value.getTime());
    let index = scalar ? this.scalars.get(value) : date ? this.dates.get(value.getTime())
      : this.compound.find(index => sameValue(this.entries[index]![0], value));
    const first = index === undefined;
    if (index === undefined) {
      index = this.entries.length;
      this.entries.push([value, []]);
      if (scalar) this.scalars.set(value, index);
      else if (date) this.dates.set(value.getTime(), index);
      else this.compound.push(index);
    }
    this.entries[index]![1].push(id);
    return first;
  }
}
