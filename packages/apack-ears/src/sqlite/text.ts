// FTS documents are individual source strings. SQL combines their clauses by entity; phrases stay in one element.
import { createHash, randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './database.ts';
import { searchTable, type SqliteIndexJob } from './index-builds.ts';
import type { SqliteSearchStructure } from './search-structures.ts';

type Data = Record<string, any>;
interface Clause { match: string; fields: number[]; negative: boolean }
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const fail = (message: string): never => { throw Object.assign(new Error(message), { code: 'CORRUPT' }); };

/** Only insert spaces; original UTF-16 offsets are recovered by subtracting preceding insertions. */
function identifierParts(source: string): { text: string; spaces: number[] } {
  const cuts = [...source.matchAll(/(?:\p{Ll}|\p{N})(?=\p{Lu})|\p{Lu}(?=\p{Lu}\p{Ll})/gu)]
    .map(match => match.index + match[0].length);
  if (!cuts.length) return { text: '', spaces: [] };
  const pieces: string[] = []; let start = 0;
  for (const cut of cuts) { pieces.push(source.slice(start, cut)); start = cut; }
  pieces.push(source.slice(start));
  return { text: pieces.join(' '), spaces: cuts.map((cut, index) => cut + index) };
}
function sourceOffset(offset: number, spaces: number[]): number {
  let low = 0, high = spaces.length;
  while (low < high) { const mid = (low + high) >>> 1; if (spaces[mid]! < offset) low = mid + 1; else high = mid; }
  return offset - low;
}
function markedRanges(marked: string, open: string, close: string): { clean: string; ranges: number[][]; terms: string[] } {
  let clean = '', start = -1, offset = 0; const ranges: number[][] = [], terms: string[] = [];
  while (offset < marked.length) {
    if (marked.startsWith(open, offset)) { start = clean.length; offset += open.length; }
    else if (marked.startsWith(close, offset)) {
      if (start >= 0) { ranges.push([start, clean.length]); terms.push(fold(clean.slice(start))); start = -1; }
      offset += close.length;
    } else clean += marked[offset++]!;
  }
  return { clean, ranges, terms };
}
function mergeRanges(ranges: number[][]): number[][] {
  const merged: number[][] = [];
  for (const range of ranges.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!)) {
    const last = merged.at(-1);
    if (last && last[0] === range[0] && range[1]! <= last[2]!) last[2] = Math.max(last[2]!, range[2]!);
    else merged.push([...range]);
  }
  return merged;
}
export class SqliteText {
  private readonly db: SqliteDatabase;
  constructor(db: SqliteDatabase) { this.db = db; }
  structure(job: SqliteIndexJob): SqliteSearchStructure {
    const table = searchTable(job);
    return { types: [job.type], indexes: [job], objects: [['table', table], ['table', table + '_vocab'],
      ['table', table + '_docs'], ['index', table + '_docs_entity'],
      ...['data', 'idx', 'content', 'docsize', 'config'].map(suffix => ['table', table + '_' + suffix] as const)],
      reset: `DROP TABLE IF EXISTS ${table}_vocab; DROP TABLE IF EXISTS ${table}; DROP TABLE IF EXISTS ${table}_docs;` };
  }
  ensure(job: SqliteIndexJob): void {
    const table = searchTable(job), index = job.definition;
    if (index.stem && index.stem !== 'en') throw Object.assign(new Error('SQLite text indexes support English stemming only'), { code: 'UNSUPPORTED' });
    this.db.sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING fts5(entity_id UNINDEXED,field UNINDEXED,element UNINDEXED,body,aliases,
      tokenize='${index.stem ? 'porter ' : ''}unicode61 remove_diacritics 2');
      CREATE VIRTUAL TABLE IF NOT EXISTS ${table}_vocab USING fts5vocab(${table},row);
      CREATE TABLE IF NOT EXISTS ${table}_docs(id INTEGER PRIMARY KEY,entity_id TEXT NOT NULL,field INTEGER NOT NULL,element INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS ${table}_docs_entity ON ${table}_docs(entity_id,field,element);`);
  }
  remove(job: SqliteIndexJob, id: string, field?: number): void {
    const table = searchTable(job), where = 'entity_id=?' + (field === undefined ? '' : ' AND field=?');
    const args = field === undefined ? [id] : [id, field];
    this.db.run(`DELETE FROM ${table} WHERE rowid IN (SELECT id FROM ${table}_docs WHERE ${where})`, args);
    this.db.run(`DELETE FROM ${table}_docs WHERE ${where}`, args);
  }
  refile(row: Data, job: SqliteIndexJob, changed?: ReadonlySet<string>): void {
    const fields = Object.keys(job.definition.fields);
    const old = this.db.get('SELECT hashes FROM text_meta WHERE entity_id=? AND index_name=? AND generation=?', [row.id, job.name, job.generation]);
    let decoded: unknown;
    try { decoded = old ? JSON.parse(old.hashes) : undefined; } catch { fail('Invalid text field hashes'); }
    if (old && (!Array.isArray(decoded) || decoded.length !== fields.length || decoded.some(hash => typeof hash !== 'string')))
      fail('Invalid text field hashes');
    const previous = Array.isArray(decoded) ? decoded as string[] : undefined;
    // A row changed ahead of a new generation's cursor still needs all of its initial postings.
    if (!previous && changed) row = this.db.row(row.id, fields)!;
    const grouped = fields.map(() => [] as Array<{ field: number; element: number; body: string }>);
    fields.forEach((field, position) => {
      if (previous && changed && !changed.has(field)) return;
      const source = row[field];
      if (typeof source === 'string' && source) grouped[position]!.push({ field: position, element: 0, body: source });
      else if (Array.isArray(source)) source.forEach((body, element) => {
        if (typeof body === 'string' && body) grouped[position]!.push({ field: position, element, body });
      });
    });
    const hashes = grouped.map((docs, i) => previous && changed && !changed.has(fields[i]!) ? previous[i]! :
      createHash('sha256').update(JSON.stringify(docs)).digest('hex'));
    const table = searchTable(job);
    for (const [field, docs] of grouped.entries()) {
      if (previous?.[field] === hashes[field]) continue;
      this.remove(job, row.id, field);
      for (const doc of docs) {
        const id = this.db.run(`INSERT INTO ${table}_docs(entity_id,field,element) VALUES (?,?,?)`, [row.id, doc.field, doc.element]).lastInsertRowid;
        this.db.run(`INSERT INTO ${table}(rowid,entity_id,field,element,body,aliases) VALUES (?,?,?,?,?,?)`,
          [id, row.id, doc.field, doc.element, doc.body, identifierParts(doc.body).text]);
      }
    }
    if (!previous || hashes.some((hash, i) => previous[i] !== hash))
      this.db.run('INSERT OR REPLACE INTO text_meta VALUES (?,?,?,?)', [row.id, job.name, job.generation, JSON.stringify(hashes)]);
  }
  collect(job: SqliteIndexJob, limit: number): boolean {
    const table = searchTable(job);
    this.db.run(`DELETE FROM ${table} WHERE rowid IN (SELECT id FROM ${table}_docs ORDER BY id LIMIT ?)`, [limit]);
    return Number(this.db.run(`DELETE FROM ${table}_docs WHERE id IN (SELECT id FROM ${table}_docs ORDER BY id LIMIT ?)`, [limit]).changes) < limit;
  }
  search(job: SqliteIndexJob, ids: string[] | null, query: string, options: Data, wantHits: boolean): Data[] {
    const table = searchTable(job), fields = Object.keys(job.definition.fields);
    const tokens = query.match(/-?(?:[^\s:"]+:)?(?:"[^"]+"|\S+)/g) ?? [];
    const vocabulary = options.fuzzy === false ? [] : this.db.all(`SELECT term FROM ${table}_vocab`).map(row => String(row.term));
    const distance = (a: string, b: string): number => {
      let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + Number(a[i - 1] !== b[j - 1]));
        prev = row;
      }
      return prev[b.length]!;
    };
    const clauses: Clause[] = [], groups: number[][] = [[]];
    for (const [position, rawToken] of tokens.entries()) {
      if (rawToken === 'OR') { if (groups.at(-1)!.length) groups.push([]); continue; }
      const negative = rawToken.startsWith('-'); let token = negative ? rawToken.slice(1) : rawToken;
      const colon = token.startsWith('"') ? -1 : token.indexOf(':');
      const field = colon < 0 ? undefined : token.slice(0, colon);
      if (colon >= 0) token = token.slice(colon + 1);
      const phrase = token.startsWith('"'), raw = token.replace(/^"|"$/g, ''), normalized = fold(raw);
      if (!normalized) continue;
      const max = normalized.length >= 9 ? 2 : normalized.length >= 5 ? 1 : 0;
      const expanded = !phrase && max ? vocabulary.filter(term => Math.abs(term.length - normalized.length) <= max && distance(term, normalized) <= max) : [];
      const prefix = options.prefix && !phrase && position === tokens.length - 1 ? '*' : '';
      const words = prefix || phrase ? [raw] : [...new Set([raw, ...expanded])];
      const match = words.map(word => `(body : ${quote(word)}${prefix} OR aliases : ${quote(identifierParts(word).text || word)}${prefix})`).join(' OR ');
      const selected = (field === undefined ? fields : [field]).filter(f => !options.fields?.length || options.fields.includes(f))
        .map(f => fields.indexOf(f)).filter(i => i >= 0);
      if (!negative) groups.at(-1)!.push(clauses.length);
      clauses.push({ match, fields: selected, negative });
    }
    const positive = groups.flat(); if (!positive.length) return [];
    const required = options.any ? positive.map(i => [i]) : groups.filter(group => group.length);
    const condition = required.map(group => '(' + group.map(i => `max(clause=${i})`).join(' AND ') + ')').join(' OR ');
    const select = (open: string, close: string) => {
      const args: any[] = [], ctes = clauses.map((clause, i) => {
        const weights = fields.map((field, position) => `WHEN ${position} THEN ${Number(job.definition.fields[field].weight ?? 1)}`).join(' ');
        if (wantHits) args.push(open, close, open, close);
        args.push(clause.match);
        if (ids !== null) args.push(JSON.stringify(ids));
        return `c${i} AS MATERIALIZED (SELECT ${i} clause,${Number(clause.negative)} negative,f.rowid docid,f.entity_id id,f.field,f.element,
          -bm25(${table},0,0,0,1,1)*(CASE CAST(f.field AS INTEGER) ${weights} END) score
          ${wantHits ? `,f.body,f.aliases,highlight(${table},3,?,?) hbody,highlight(${table},4,?,?) halias` : ''}
          FROM ${table} f JOIN entities e ON e.id=f.entity_id WHERE ${table} MATCH ? AND CAST(f.field AS INTEGER) IN (${clause.fields.join(',')})
          AND ${ids === null ? 'e.trashed=0' : 'f.entity_id IN (SELECT value FROM json_each(?))'})`;
      });
      return this.db.all(`WITH ${ctes.join(',')}, matches AS MATERIALIZED (${clauses.map((_, i) => `SELECT * FROM c${i}`).join(' UNION ALL ')}),
        clause_scores AS (SELECT clause,id,max(score) score FROM matches WHERE negative=0 GROUP BY clause,id),
        accepted AS (SELECT id,sum(score) score FROM clause_scores GROUP BY id HAVING (${condition}) AND id NOT IN (SELECT id FROM matches WHERE negative=1))
        SELECT a.id,a.score${wantHits ? ',m.field,m.element,m.body,m.aliases,m.hbody,m.halias' : ''} FROM accepted a
        JOIN entities e ON e.id=a.id ${wantHits ? 'JOIN matches m ON m.id=a.id AND m.negative=0' : ''}
        ORDER BY a.score DESC,e.seq${wantHits ? ',m.docid,m.clause' : ''}`, args);
    };
    let open = '\u0001', close = '\u0002', rows = select(open, close);
    if (wantHits) {
      const contains = (marker: string) => rows.some(row => String(row.body).includes(marker) || String(row.aliases).includes(marker));
      if (contains(open) || contains(close)) {
        do { open = '\u0001' + randomUUID() + '\u0001'; close = '\u0002' + randomUUID() + '\u0002'; } while (contains(open) || contains(close));
        rows = select(open, close);
      }
    }
    const hits = new Map<string, Data>();
    for (const row of rows) {
      let hit = hits.get(row.id);
      if (!hit) { hit = { id: row.id, score: row.score, terms: [], highlights: {} }; hits.set(row.id, hit); }
      if (!wantHits) continue;
      const field = fields[Number(row.field)]!, ranges: number[][] = Object.hasOwn(hit.highlights, field) ? hit.highlights[field] : [];
      const parts = identifierParts(String(row.body));
      if (parts.text !== row.aliases) fail('Text identifier offsets disagree with their indexed source');
      for (const [marked, source, spaces] of [[row.hbody, row.body, []], [row.halias, row.aliases, parts.spaces]] as Array<[string, string, number[]]>) {
        const decoded = markedRanges(marked, open, close);
        if (decoded.clean !== source) fail('Text highlights disagree with their indexed source');
        for (const [start, end] of decoded.ranges) ranges.push([Number(row.element), sourceOffset(start!, spaces), sourceOffset(end!, spaces)]);
        for (const term of decoded.terms) if (!hit.terms.includes(term)) hit.terms.push(term);
      }
      if (ranges.length) Object.defineProperty(hit.highlights, field, { value: mergeRanges(ranges), enumerable: true, configurable: true, writable: true });
    }
    if (options.recency) {
      const payloads = new Map(this.db.rows([...hits.keys()], [options.recency.field]).map(row => [row.id, row]));
      for (const hit of hits.values()) {
        const at = payloads.get(hit.id)?.[options.recency.field];
        if (typeof at === 'number') hit.score *= Math.pow(0.5, Math.max(0, (options.recency.now ?? Date.now()) - at) / options.recency.halfLife);
      }
    }
    return [...hits.values()].sort((a, b) => b.score - a.score);
  }
}
