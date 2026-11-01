/** Connection-owned exact dependency tags; commits visit subscribers, never unrelated readers. */
export interface SqliteTrackedRead {
  token: number;
  order: number;
  keys: Set<string>;
  ranges: Set<string>;
}

export class SqliteReadTracking {
  private readonly readers = new Map<number, SqliteTrackedRead>();
  private readonly subscribers = new Map<string, Set<number>>();
  private order = 0;
  private keyCount = 0;
  private rangeCount = 0;

  track(token: number): SqliteTrackedRead {
    let read = this.readers.get(token);
    if (!read) {
      read = { token, order: this.order++, keys: new Set(), ranges: new Set() };
      this.readers.set(token, read);
    }
    return read;
  }
  add(read: SqliteTrackedRead | undefined, kind: 'keys' | 'ranges', tag: string): void {
    if (!read || this.readers.get(read.token) !== read || read[kind].has(tag)) return;
    read[kind].add(tag);
    if (kind === 'keys') this.keyCount++; else this.rangeCount++;
    let owners = this.subscribers.get(tag);
    if (!owners) this.subscribers.set(tag, owners = new Set());
    owners.add(read.token);
  }
  affected(changes: ReadonlySet<string>): number[] {
    if (changes.has('all')) return [...this.readers.values()]
      .filter(read => read.keys.size || read.ranges.size).map(read => read.token);
    const affected = new Set<number>(this.subscribers.get('all'));
    for (const tag of changes) for (const token of this.subscribers.get(tag) ?? []) affected.add(token);
    // Preserve reader registration order regardless of which mutation tag discovered it first.
    return [...affected].sort((a, b) => this.readers.get(a)!.order - this.readers.get(b)!.order);
  }
  untrack(token: number): void {
    const read = this.readers.get(token);
    if (!read) return;
    for (const tag of new Set([...read.keys, ...read.ranges])) {
      const owners = this.subscribers.get(tag)!;
      owners.delete(token);
      if (!owners.size) this.subscribers.delete(tag);
    }
    this.keyCount -= read.keys.size;
    this.rangeCount -= read.ranges.size;
    this.readers.delete(token);
  }
  stats(): { owners: number; keys: number; ranges: number } {
    return { owners: this.readers.size, keys: this.keyCount, ranges: this.rangeCount };
  }
  clear(): void {
    this.readers.clear(); this.subscribers.clear();
    this.keyCount = 0; this.rangeCount = 0; this.order = 0;
  }
}
