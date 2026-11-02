/** Query grouping follows JS Map/Set: scalar values compare by value; each decoded object is unique. */
export class SqliteValueGroups {
  readonly entries: Array<[unknown, string[]]> = [];
  private readonly scalars = new Map<unknown, number>();

  add(value: unknown, id: string): boolean {
    // Missing fields have the same query key as stored null, as in the binary backend.
    const key = value ?? null;
    const scalar = (key === null || typeof key !== 'object') &&
      !(typeof key === 'number' && Number.isNaN(key));
    let index = scalar ? this.scalars.get(key) : undefined;
    const first = index === undefined;
    if (index === undefined) {
      index = this.entries.length;
      this.entries.push([key, []]);
      if (scalar) this.scalars.set(key, index);
    }
    this.entries[index]![1].push(id);
    return first;
  }
}
