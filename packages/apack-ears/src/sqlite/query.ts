// SQL selection and traversal; explicit application fallbacks preserve ICU ordering and deep-value semantics.
import type { SqliteDatabase } from "./database.ts";
import { scalarKey } from "./database.ts";
import { orderNumericIds } from "./numeric-order.ts";
import type { QueryPlan, QueryStep, QueryAnswer, StoredHit } from "../storage.ts";
import { SqliteValueGroups } from "./value-groups.ts";
import { distinctScalarIds, countScalarGroups } from "./scalar-groups.ts";
import { projectGraph, graphComponents, rankGraph } from './graph-algorithms.ts';
import { graphCommunities } from './communities.ts';
type Data = Record<string, any>;
const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code });
};
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;

export function executeQuery(
  db: SqliteDatabase,
  plan: QueryPlan,
  countVisits = false
): QueryAnswer {
  const cleanup: Array<() => void> = [];
  try { return executeScopedQuery(db, plan, countVisits, cleanup); }
  finally { for (const close of cleanup.reverse()) close(); }
}

function executeScopedQuery(db: SqliteDatabase, plan: QueryPlan, countVisits: boolean, cleanup: Array<() => void>): QueryAnswer {
  const schema = db.schemaForQueries(),
    scope = plan.scope ?? "live",
    steps: QueryStep[] = plan.steps ?? [];
  const reachable = (alias: string) =>
    scope === "withTrashed"
      ? "1"
      : `${alias}.trashed=${scope === "trashed" ? 1 : 0}`;
  let specificTypes = plan.start.from === "types";
  let parameters: any[] = [];
  let sql: string;
  let types: string[] =
    plan.start.from === "types" ? plan.start.types : Object.keys(schema.types);
  for (const type of types) {
    db.definition(type);
    db.trackRange(`members:${type}`);
  }
  let multipleGroups = plan.start.from === 'types' && plan.start.types.length > 1;
  if (plan.start.from === "ids") {
    const ids = plan.start.ids;
    for (const id of ids) db.trackKey(`exists:${id}`);
    sql = `SELECT e.id,0 major,j.key ord FROM json_each(?) j JOIN entities e ON e.id=j.value WHERE ${reachable(
      "e"
    )}`;
    parameters.push(JSON.stringify(ids));
  } else if (plan.start.from === "types") {
    if (types.length === 1) {
      sql = `SELECT e.id,0 major,e.seq ord FROM entities e WHERE e.type=? AND ${reachable('e')}`;
      parameters.push(types[0]);
    } else {
      const typeOrder = types.map((t, i) => `WHEN ${literal(t)} THEN ${i}`).join(" ");
      sql = `SELECT e.id,CASE e.type ${typeOrder || "WHEN '' THEN 0"} END major,e.seq ord
        FROM entities e WHERE e.type IN (SELECT value FROM json_each(?)) AND ${reachable('e')}`;
      parameters.push(JSON.stringify(types));
    }
  } else
    sql = `SELECT e.id,0 major,e.seq ord FROM entities e WHERE ${reachable(
      "e"
    )}`;
  // A constant group key must not force a temp sort before LIMIT. For one type, the type/sequence indexes can
  // stream in insertion order; explicit multi-type starts still keep their requested group order.
  const order = () => multipleGroups ? 'p.major,p.ord' : 'p.ord';
  const ordered = () => `SELECT p.id FROM (${sql}) p ORDER BY ${order()}`;
  const idsNow = () => db.all(ordered(), parameters).map((r) => r.id as string);
  const restart = (ids: string[]) => {
    multipleGroups = false;
    sql = `SELECT value id,0 major,key ord FROM json_each(?)`;
    parameters = [JSON.stringify(ids)];
  };
  const trackField = (field: string) => {
    for (const t of types) db.trackRange(`fieldType:${t}:${field}`);
    db.trackRange(`fieldAny:${field}`);
  };
  const filter = (condition: string, args: any[] = []) => {
    sql = `SELECT p.* FROM (${sql}) p JOIN entities e ON e.id=p.id WHERE ${condition}`;
    parameters.push(...args);
  };
  let searchHits: Map<string, Data> | undefined;
  let visited: number | undefined;
  let scanSource: { sql: string; parameters: any[] } | undefined;
  for (const [stepIndex, step] of steps.entries()) {
    switch (step.step) {
      case 'rank': {
        const graph = projectGraph(db, idsNow(), step.kinds, step.direction);
        const scores = rankGraph(graph, step.seeds, step.damping, step.iterations, step.tolerance);
        const ranked = scores ? graph.ids.map((id, at) => ({ id, score: scores[at]!, terms: [] })) : [];
        ranked.sort((a, b) => b.score - a.score);
        searchHits = new Map(ranked.map(hit => [hit.id, hit]));
        restart(ranked.map(hit => hit.id));
        break;
      }
      case "ofType":
        filter("e.type=?", [step.type]);
        break;
      case "within":
        filter("e.id IN (SELECT value FROM json_each(?))", [
          JSON.stringify(step.ids),
        ]);
        break;
      case "where":
      case "withRole": {
        const field = step.step === "withRole" ? "role" : step.field,
          value = step.step === "withRole" ? step.role : step.value;
        trackField(field);
        const key = scalarKey(value);
        const indexed = types.filter((t) => db.isIndexed(t, field));
        const source = db.fieldSource(field, specificTypes ? types : undefined);
        const kinds = typeof value === 'string' ? "'text'" : typeof value === 'boolean' ? "'bool'" : "'num','zero'";
        const raw = value === null
          ? `(NOT EXISTS(SELECT 1 FROM (${source}) f WHERE f.id=e.id AND f.kind IS NOT NULL)
              OR EXISTS(SELECT 1 FROM (${source}) f WHERE f.id=e.id AND f.kind='null')
              OR EXISTS(SELECT 1 FROM value_members m WHERE m.entity_id=e.id AND m.field=${literal(field)} AND m.kind='null'))`
          : `EXISTS(SELECT 1 FROM (SELECT ? value) probe WHERE
              EXISTS(SELECT 1 FROM (${source}) f WHERE f.id=e.id AND f.kind IN (${kinds}) AND f.value IS probe.value)
              OR EXISTS(SELECT 1 FROM value_members m WHERE m.entity_id=e.id AND m.field=${literal(field)} AND m.kind IN (${kinds}) AND m.value IS probe.value))`;
        if (key !== undefined && value !== null && indexed.length) {
          const list = indexed.map(literal).join(",");
          if (specificTypes && indexed.length === types.length) {
            // Drive an indexed equality from its selective lookup, then resolve only matching entities.
            // CROSS JOIN makes this access path explicit rather than scanning the type's candidate rows.
            sql = `SELECT p.* FROM index_builds b CROSS JOIN field_index x CROSS JOIN (${sql}) p
              WHERE b.type IN (${list}) AND b.name=? AND b.kind='value' AND b.state='ready'
              AND x.type=b.type AND x.field=b.name AND x.generation=b.generation AND x.value=? AND x.entity_id=p.id`;
            parameters.push(field, key);
          } else
            filter(
              `((e.type IN (${list}) AND e.id IN (SELECT x.entity_id FROM index_builds b JOIN field_index x
                ON x.type=b.type AND x.field=b.name AND x.generation=b.generation
                WHERE b.type IN (${list}) AND b.name=? AND b.kind='value' AND b.state='ready' AND x.value=?)) OR (e.type NOT IN (${list}) AND (${raw})))`,
              [field, key, typeof value === "boolean" ? Number(value) : value]
            );
        } else {
          if (countVisits && !scanSource) {
            scanSource = { sql, parameters: [...parameters] };
            visited = db.get(`SELECT count(*) n FROM (${sql})`, parameters)!.n;
          }
          filter(
            `(${raw})`,
            value === null
              ? []
              : [typeof value === "boolean" ? Number(value) : value]
          );
        }
        break;
      }
      case "has":
      case "lacks":
        trackField(step.field);
        filter(`${step.step === "lacks" ? "NOT " : ""}EXISTS(SELECT 1 FROM (${db.fieldSource(step.field, specificTypes ? types : undefined)}) f WHERE f.id=e.id AND f.kind IS NOT NULL)`);
        break;
      case "linkedWith":
      case "linkedTo":
      case "linkedFrom":
      case "unlinkedTo":
      case "unlinkedFrom": {
        db.trackRange('membersAny');
        const outward = step.step.endsWith("To"),
          negative = step.step.startsWith("unlinked");
        const kind = step.step === "linkedWith" ? undefined : step.kind;
        const other = step.other;
        const args: any[] = [];
        const conditions: string[] = [];
        if (kind !== undefined) {
          db.relationDefinition(kind);
          db.trackRange(`kind:${kind}`);
          conditions.push("r.kind=?");
          args.push(kind);
        } else
          for (const k of Object.keys(schema.relations))
            db.trackRange(`kind:${k}`);
        if (step.step === "linkedWith") {
          conditions.push(
            "((r.source=e.id AND r.target=?) OR (r.target=e.id AND r.source=?))"
          );
          args.push(step.other, step.other);
        } else {
          conditions.push(`r.${outward ? "source" : "target"}=e.id`);
          if (other !== undefined) {
            conditions.push(`r.${outward ? "target" : "source"}=?`);
            args.push(other);
          }
        }
        const needsFar = step.step !== "linkedWith" && other === undefined;
        if (needsFar) conditions.push(`${reachable("far")}`, `far.id!=e.id`);
        const far =
          step.step === "linkedWith"
            ? "CASE WHEN r.source=e.id THEN r.target ELSE r.source END"
            : `r.${outward ? "target" : "source"}`;
        filter(
          `${
            negative ? "NOT " : ""
          }EXISTS(SELECT 1 FROM relations r ${needsFar ? `JOIN entities far ON far.id=${far}` : ""} WHERE ${conditions.join(
            " AND "
          )})`,
          args
        );
        break;
      }
      case "out":
      case "in":
      case "both":
      case "descendants":
      case "ancestors": {
        const outward = step.step === "out" || step.step === "descendants",
          both = step.step === 'both', deep = step.step === "descendants" || step.step === "ancestors";
        const kinds: string[] = step.kinds;
        for (const k of kinds) {
          db.relationDefinition(k);
          db.trackRange(`kind:${k}`);
        }
        for (const t of step.types ?? []) db.definition(t);
        specificTypes = step.types !== undefined;
        // An intermediate type can change reachability even when the final output is type-restricted.
        db.trackRange('membersAny');
        if (!deep) {
          // Keep the whole adjacency selection in SQL. Deduplicate by first encounter, preserving source order
          // and relation insertion order, rather than doing one binding call for each source entity.
          sql = `SELECT id,0 major,ROW_NUMBER() OVER (ORDER BY major,ord,kind_ord,side,edge_seq) ord FROM (
            SELECT far.id,p.major,p.ord,kind.key kind_ord,r.seq edge_seq,
              ${both ? 'CASE WHEN r.source=p.id THEN 0 ELSE 1 END' : '0'} side,
              ROW_NUMBER() OVER (PARTITION BY far.id ORDER BY p.major,p.ord,kind.key,
                ${both ? 'CASE WHEN r.source=p.id THEN 0 ELSE 1 END' : '0'},r.seq) encounter
            FROM (${sql}) p JOIN relations r ON ${both ? '(r.source=p.id OR r.target=p.id)' : `r.${outward ? 'source' : 'target'}=p.id`}
            JOIN json_each(?) kind ON kind.value=r.kind
            JOIN entities far ON far.id=${both ? 'CASE WHEN r.source=p.id THEN r.target ELSE r.source END' : `r.${outward ? 'target' : 'source'}`}
            WHERE far.id!=p.id AND ${reachable("far")}
            ${step.types ? "AND far.type IN (SELECT value FROM json_each(?))" : ""}
          ) WHERE encounter=1`;
          parameters.push(JSON.stringify(kinds), ...(step.types ? [JSON.stringify(step.types)] : []));
          types = step.types ?? Object.keys(schema.types);
          multipleGroups = false;
          break;
        }
        const seeds = idsNow(),
          seen = new Set<string>(seeds),
          found: string[] = [];
        let frontier = seeds, level = 0;
        while (frontier.length && (step.depth === undefined || level < step.depth)) {
          level++;
          const next: string[] = [];
          const ends = db.iterate(
            `SELECT far.id,far.type FROM json_each(?) seed JOIN relations r
              ON r.${outward ? "source" : "target"}=seed.value
              JOIN json_each(?) kind ON kind.value=r.kind
              JOIN entities far ON far.id=r.${outward ? "target" : "source"}
              WHERE ${reachable("far")}
              ORDER BY seed.key,kind.key,r.seq`,
            [JSON.stringify(frontier), JSON.stringify(kinds)]
          );
          for (const end of ends) {
            if (seen.has(end.id)) continue;
            seen.add(end.id);
            next.push(end.id);
            if (!step.types || step.types.includes(end.type)) found.push(end.id);
          }
          frontier = next;
        }
        restart(found);
        types = step.types ?? Object.keys(schema.types);
        break;
      }
      case 'pathTo': {
        for (const kind of step.kinds) { db.relationDefinition(kind); db.trackRange(`kind:${kind}`); }
        db.trackRange('membersAny'); db.trackKey(`exists:${step.to}`);
        const seeds = idsNow(), seen = new Set(seeds), parents = new Map<string, string>();
        let path: string[] = [], frontier = seeds, level = 0;
        if (seen.has(step.to)) path = [step.to];
        else if (db.get(`SELECT 1 FROM entities far WHERE far.id=? AND ${reachable('far')}`, [step.to])) {
          const direction = step.direction ?? 'out';
          if (!['out', 'in', 'both'].includes(direction)) fail('VALUE_INVALID', 'Invalid graph direction');
          const both = direction === 'both', outward = direction === 'out';
          while (!path.length && frontier.length && (step.depth === undefined || level < step.depth)) {
            level++;
            const next: string[] = [];
            const ends = db.iterate(`SELECT seed.value parent,far.id FROM json_each(?) seed JOIN relations r
              ON ${both ? '(r.source=seed.value OR r.target=seed.value)' : `r.${outward ? 'source' : 'target'}=seed.value`}
              JOIN json_each(?) kind ON kind.value=r.kind
              JOIN entities far ON far.id=${both ? 'CASE WHEN r.source=seed.value THEN r.target ELSE r.source END' : `r.${outward ? 'target' : 'source'}`}
              WHERE ${reachable('far')} ORDER BY seed.key,kind.key,
                ${both ? 'CASE WHEN r.source=seed.value THEN 0 ELSE 1 END,' : ''}r.seq`,
            [JSON.stringify(frontier), JSON.stringify(step.kinds)]);
            for (const end of ends) {
              if (seen.has(end.id)) continue;
              seen.add(end.id); parents.set(end.id, end.parent);
              if (end.id === step.to) {
                path = [step.to];
                while (parents.has(path[path.length - 1])) path.push(parents.get(path[path.length - 1])!);
                path.reverse(); break;
              }
              next.push(end.id);
            }
            frontier = next;
          }
        }
        restart(path); types = Object.keys(schema.types); specificTypes = false;
        break;
      }
      case "limit":
        sql = `SELECT p.* FROM (${sql}) p ORDER BY ${order()} LIMIT ?`;
        parameters.push(Math.max(0, Math.floor(step.n)));
        break;
      case "after": {
        const ids = idsNow(),
          at = ids.indexOf(step.id);
        restart(at < 0 ? [] : ids.slice(at + 1));
        break;
      }
      case "reverse":
        restart(idsNow().reverse());
        break;
      case "distinct": {
        if (step.field === undefined) restart([...new Set(idsNow())]);
        else {
          trackField(step.field);
          const native = specificTypes ? distinctScalarIds(db, { sql, parameters, order: order(), field: step.field, types }) : undefined;
          if (native !== undefined) { restart(native); break; }
          const ids = idsNow(), rows = db.rows(ids, [step.field]), groups = new SqliteValueGroups();
          restart(ids.filter((id, index) => groups.add(rows[index]?.[step.field!], id)));
        }
        break;
      }
      case "orderBy": {
        trackField(step.field);
        const collator = new Intl.Collator(
          schema.collation === 'root' ? 'und' : schema.collation ?? 'en'
        );
        const next = steps[stepIndex + 1];
        const native = orderNumericIds(db, { sql, parameters, order: order(), field: step.field,
          descending: step.descending,
          limit: next?.step === 'limit' ? Math.max(0, Math.floor(next.n)) : undefined });
        if (native !== undefined) { restart(native); break; }
        const ids = idsNow(),
          values = new Map(db.rows(ids, [step.field]).map(row => [row.id, row[step.field]]));
        const rank = (v: any) =>
          v == null
            ? 5
            : typeof v === "boolean"
            ? 0
            : typeof v === "number"
            ? 1
            : v instanceof Date
            ? 2
            : typeof v === "string"
            ? 3
            : 4;
        const compare = (a: any, b: any): number => {
          const ar = rank(a),
            br = rank(b);
          if (ar === 5 || br === 5) {
            const n = ar === br ? 0 : ar === 5 ? 1 : -1;
            return step.descending ? -n : n;
          }
          const n =
            ar !== br
              ? ar - br
              : ar === 0 || ar === 1
              ? Number(a) - Number(b)
              : ar === 2
              ? a.getTime() - b.getTime()
              : collator.compare(
                  typeof a === "string" ? a : JSON.stringify(a),
                  typeof b === "string" ? b : JSON.stringify(b)
                );
          return step.descending ? -n : n;
        };
        ids.sort((a, b) => compare(values.get(a), values.get(b)));
        restart(ids);
        break;
      }
      case "containing":
      case "matching": {
        const direct = plan.start.from === 'types' && stepIndex === 0;
        const selected = direct ? types : db.all(`SELECT DISTINCT e.type FROM (${sql}) p JOIN entities e ON e.id=p.id`, parameters)
          .map(row => String(row.type));
        const result = db.search.trigrams.select({ sql, parameters, types: selected, direct }, step);
        cleanup.push(result.close); sql = result.sql; parameters = result.parameters;
        break;
      }
      case "search":
      case "near":
      case "like":
      case "hybrid": {
        const root = plan.start.from === 'types' && steps[0] === step && scope === 'live';
        const vectorScope = root ? null : { sql: `SELECT p.id FROM (${sql}) p`, parameters: [...parameters] };
        // Vector eligibility stays in SQLite. Text's existing adapter still consumes an explicit ID list.
        const ids = root || step.step === 'near' || step.step === 'like' ? null : idsNow();
        const next = steps[stepIndex + 1];
        // Each type's top k contains every possible global winner. Earlier limits and later filters
        // retain their own pipeline scope; hybrid fusion still needs its complete text ranking.
        let textLimit: number | undefined;
        if (step.step === 'search') {
          if (next?.step === 'limit') textLimit = Math.max(0, Math.floor(next.n));
          else if (stepIndex === steps.length - 1 && ['first', 'firstRow', 'exists'].includes(plan.terminal.answer)) textLimit = 1;
        }
        const options = step.step === 'search' || step.step === 'hybrid' ? step.options : undefined;
        const searchOptions = options?.recency && options.recency.halfLife > 0 && options.recency.now === undefined ?
          { ...options, recency: { ...options.recency, now: Date.now() } } : options;
        let hits: Data[] = [];
        for (const type of types) {
          const needs =
            step.step === "search"
              ? ["text"]
              : step.step === "hybrid"
              ? ["text", "vector"]
              : ["vector"];
          const available = Object.values(
            schema.types[type]?.indexes ?? {}
          ).map((d: any) => d.kind);
          if (
            !needs.every((k) => available.includes(k)) &&
            (plan.start.from === "ids" ||
              steps.some((s) =>
                ["out", "in", "both", "descendants", "ancestors", "pathTo"].includes(s.step)
              ))
          )
            continue;
          db.trackRange(`rows:${type}`);
          if (step.step === "search")
            hits.push(
              ...db.search.text(
                ids,
                type,
                step.query,
                searchOptions,
                plan.terminal.answer === "hits",
                textLimit
              )
            );
          else if (step.step === "near")
            hits.push(
              ...db.search.vector(vectorScope, type, step.vector, step.k ?? 10)
            );
          else if (step.step === "like")
            hits.push(...db.search.like(vectorScope, type, step.id, step.k ?? 10));
          else {
            const text = db.search.text(
                ids,
                type,
                step.query,
                searchOptions,
                plan.terminal.answer === "hits"
              ),
              vector = db.search.vector(
                vectorScope,
                type,
                step.vector,
                Math.max(
                  step.k ?? 10,
                  ids?.length ??
                    Number(
                      db.get("SELECT count(*) n FROM entities WHERE type=?", [
                        type,
                      ])!.n
                    )
                )
              );
            const merged = new Map<string, Data>();
            for (const ranked of [text, vector])
              ranked.forEach((hit, i) => {
                const held = merged.get(hit.id) ?? {
                  id: hit.id,
                  score: 0,
                  terms: hit.terms,
                };
                held.score += 1 / (61 + i);
                merged.set(hit.id, held);
              });
            hits.push(
              ...[...merged.values()]
                .sort((a, b) => b.score - a.score)
                .slice(0, step.k ?? 10)
            );
          }
        }
        hits.sort((a, b) => b.score - a.score);
        searchHits = new Map(hits.map((h) => [h.id, h]));
        restart(hits.map((h) => h.id));
        break;
      }
      default:
        fail(
          "UNSUPPORTED",
          `SQLite query step ${String(step)} is not implemented`
        );
    }
  }
  const terminal = plan.terminal;
  // Diagnostic visits describe the logical input prefix consumed by an early terminal, not global entity sequence.
  // SQLite's physical VM work is a different metric; retain EXPLAIN for assessing the SQL access path.
  if (
    scanSource &&
    ["first", "firstRow", "exists"].includes(terminal.answer) &&
    steps.every((s) =>
      [
        "where",
        "has",
        "lacks",
        "limit",
        "within",
        "ofType",
        "withRole",
      ].includes(s.step)
    )
  ) {
    const first = db.get(ordered() + " LIMIT 1", parameters);
    if (first) {
      const source = db.get(
        `SELECT major,ord FROM (${scanSource.sql}) WHERE id=?`,
        [...scanSource.parameters, first.id]
      );
      if (source)
        visited = db.get(
          `SELECT count(*) n FROM (${scanSource.sql}) WHERE major<? OR (major=? AND ord<=?)`,
          [...scanSource.parameters, source.major, source.major, source.ord]
        )!.n;
    }
  }
  if (terminal.answer === "hits") {
    if (!searchHits) fail("NO_SEARCH", "No search in query");
    const hits = idsNow().map((id) => {
      const hit = searchHits!.get(id)!;
      const result: StoredHit = { id, score: hit.score, terms: hit.terms ?? [] };
      if (terminal.highlights) result.highlights = hit.highlights ?? {};
      if (terminal.fields) {
        const row = db.row(id, terminal.fields)!;
        result.row = Object.fromEntries([
          ["id", id],
          ...terminal.fields
            .filter((f: string) => f !== "id" && Object.hasOwn(row, f))
            .map((f: string) => [f, row[f]]),
        ]);
      }
      return result;
    });
    return {
      kind: "hits",
      hits,
      plainObjects: true,
      __visited: visited ?? hits.length,
    };
  }
  if ((terminal.answer === "rows" || terminal.answer === "firstRow")) {
    const chosen = db.all(
      `SELECT e.id,e.type FROM (${sql}) p JOIN entities e ON e.id=p.id ORDER BY ${order()}${terminal.answer === "firstRow" ? " LIMIT 1" : ""}`,
      parameters
    );
    const rows = db.hydrate(chosen as Array<{id:string;type:string}>, terminal.fields);
    for (const row of rows) db.trackKey(`entity:${row.id}`);
    if (terminal.fields) for (let i = 0; i < rows.length; i++) rows[i] = Object.fromEntries([
      ["id", rows[i].id], ...terminal.fields.filter((field: string) => field !== 'id' && Object.hasOwn(rows[i], field))
        .map((field: string) => [field, rows[i][field]])]);
    return terminal.answer === "firstRow"
      ? {
          kind: "row",
          row: rows[0] ?? null,
          plainObjects: true,
          __visited: visited ?? chosen.length,
        }
      : {
          kind: "rows",
          rows,
          plainObjects: true,
          __visited: visited ?? chosen.length,
        };
  }
  if (terminal.answer === "count")
    return {
      kind: "count",
      n: db.get(`SELECT count(*) n FROM (${sql})`, parameters)!.n,
      __visited: visited ?? 0,
    };
  if (terminal.answer === "exists")
    return {
      kind: "bool",
      value: !!db.get(ordered() + " LIMIT 1", parameters),
      __visited: visited ?? 0,
    };
  if (terminal.answer === 'groupBy' && terminal.counts && specificTypes) {
    trackField(terminal.field);
    const groups = countScalarGroups(db, { sql, parameters, order: order(), field: terminal.field, types });
    if (groups !== undefined) return { kind: 'groups', groups,
      __visited: visited ?? groups.reduce((sum, [, count]) => sum + count, 0) };
  }
  const ids = idsNow();
  if (terminal.answer === "first" || terminal.answer === "last")
    return {
      kind: "id",
      id: (terminal.answer === "first" ? ids[0] : ids.at(-1)) ?? null,
      __visited: visited ?? ids.length,
    };
  if (terminal.answer === "groupBy") {
    trackField(terminal.field);
    const groups = new SqliteValueGroups(), rows = db.rows(ids, [terminal.field]);
    for (let index = 0; index < ids.length; index++) groups.add(rows[index]?.[terminal.field] ?? null, ids[index]!);
    return { kind: "groups", groups: terminal.counts ? groups.entries.map(([value, ids]) => [value, ids.length]) : groups.entries, __visited: visited ?? ids.length };
  }

  if (terminal.answer === 'weakComponents' || terminal.answer === 'strongComponents') {
    const groups = graphComponents(projectGraph(db, ids, terminal.kinds), terminal.answer === 'strongComponents');
    const members = terminal.counts ? groups.map(group => group.length) : groups;
    return terminal.answer === 'weakComponents'
      ? { kind: 'weakComponents', weakComponents: members, __visited: ids.length }
      : { kind: 'strongComponents', strongComponents: members, __visited: ids.length };
  }
  if (terminal.answer === 'communities') return { kind: 'communities',
    communities: graphCommunities(projectGraph(db, ids, terminal.kinds), terminal.resolution, terminal.seed, db.graphCommunities), __visited: ids.length };
  if (terminal.answer === 'degrees') {
    for (const kind of terminal.kinds) { db.relationDefinition(kind); db.trackRange(`kind:${kind}`); }
    for (const type of terminal.types ?? []) db.definition(type);
    db.trackRange('membersAny');
    const direction = terminal.direction ?? 'out';
    if (!['out', 'in', 'both'].includes(direction)) fail('VALUE_INVALID', 'Invalid graph direction');
    const both = direction === 'both', outward = direction === 'out';
    const rows = db.all(`SELECT seed.value id,COALESCE((SELECT sum(
        ${both ? 'CASE WHEN r.source=seed.value AND r.target=seed.value THEN 2 ELSE 1 END' : '1'})
      FROM relations r JOIN json_each(?) kind ON kind.value=r.kind
      JOIN entities far ON far.id=${both ? 'CASE WHEN r.source=seed.value THEN r.target ELSE r.source END' : `r.${outward ? 'target' : 'source'}`}
      WHERE ${both ? '(r.source=seed.value OR r.target=seed.value)' : `r.${outward ? 'source' : 'target'}=seed.value`}
        AND ${reachable('far')} ${terminal.types ? 'AND far.type IN (SELECT value FROM json_each(?))' : ''}),0) n
      FROM json_each(?) seed ORDER BY seed.key`,
      [JSON.stringify(terminal.kinds), ...(terminal.types ? [JSON.stringify(terminal.types)] : []), JSON.stringify(ids)]);
    return { kind: 'degrees', degrees: rows.map(row => [row.id, Number(row.n)]), __visited: visited ?? ids.length };
  }
  if (terminal.answer === "edges") {
    const groups: string[] = terminal.kinds;
    for (const k of groups) {
      db.relationDefinition(k);
      db.trackRange(`kind:${k}`);
    }
    const edges = db.all(
      `SELECT r.* FROM json_each(?) seed JOIN relations r
        ON r.${terminal.direction === 'out' ? "source" : "target"}=seed.value
        JOIN entities far ON far.id=r.${terminal.direction === 'out' ? "target" : "source"}
        WHERE r.kind IN (SELECT value FROM json_each(?)) AND ${reachable("far")}
        ${terminal.types ? "AND far.type IN (SELECT value FROM json_each(?))" : ""}
        ORDER BY seed.key,(SELECT key FROM json_each(?) WHERE value=r.kind),r.seq`,
      [JSON.stringify(ids), JSON.stringify(groups),
        ...(terminal.types ? [JSON.stringify(terminal.types)] : []), JSON.stringify(groups)]
    ).map(row => db.decodeRelation(row));
    return {
      kind: "relations",
      relations: edges,
      __visited: visited ?? ids.length,
    };
  }
  return { kind: "ids", ids, __visited: visited ?? ids.length };
}
