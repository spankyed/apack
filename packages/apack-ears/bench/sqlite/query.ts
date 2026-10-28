// SQL selection and traversal; explicit application fallbacks preserve ICU ordering and deep-value semantics.
import type { SqliteDatabase } from "./database.ts";
import { scalarKey } from "./database.ts";
import { sameValue } from "../../src/watch.ts";
type Data = Record<string, any>;
const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code });
};
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const path = (field: string) => literal(`$.${JSON.stringify(field)}`);

export function executeQuery(
  db: SqliteDatabase,
  plan: Data,
  countVisits = false
): Data {
  const schema = db.schemaForQueries(),
    scope = plan.scope ?? "live",
    steps: Data[] = plan.steps ?? [];
  const reachable = (alias: string) =>
    scope === "withTrashed"
      ? "1"
      : `${alias}.trashed=${scope === "trashed" ? 1 : 0}`;
  let parameters: any[] = [];
  let sql: string;
  let types: string[] =
    plan.start.from === "types" ? plan.start.types : Object.keys(schema.types);
  for (const type of types) {
    db.definition(type);
    db.trackRange(`members:${type}`);
  }
  if (plan.start.from === "ids") {
    const ids = plan.start.ids;
    for (const id of ids) db.trackKey(`exists:${id}`);
    sql = `SELECT e.id,0 major,j.key ord FROM json_each(?) j JOIN entities e ON e.id=j.value WHERE ${reachable(
      "e"
    )}`;
    parameters.push(JSON.stringify(ids));
  } else if (plan.start.from === "types") {
    const order = types.map((t, i) => `WHEN ${literal(t)} THEN ${i}`).join(" ");
    sql = `SELECT e.id,CASE e.type ${
      order || "WHEN '' THEN 0"
    } END major,e.seq ord FROM entities e WHERE e.type IN (SELECT value FROM json_each(?)) AND ${reachable(
      "e"
    )}`;
    parameters.push(JSON.stringify(types));
  } else
    sql = `SELECT e.id,0 major,e.seq ord FROM entities e WHERE ${reachable(
      "e"
    )}`;
  const ordered = () => `SELECT p.id FROM (${sql}) p ORDER BY p.major,p.ord`;
  const idsNow = () => db.all(ordered(), parameters).map((r) => r.id as string);
  const restart = (ids: string[]) => {
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
  for (const step of steps) {
    switch (step.step) {
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
        const valuePath = path(field);
        const raw =
          value === null
            ? `json_type(e.doc,${valuePath}) IS NULL OR json_type(e.doc,${valuePath})='null' OR (json_type(e.doc,${valuePath})='array' AND EXISTS(SELECT 1 FROM json_each(e.doc,${valuePath}) v WHERE v.type='null'))`
            : `(json_type(e.doc,${valuePath})!='object' AND EXISTS(SELECT 1 FROM json_each(e.doc,${valuePath}) v WHERE v.value IS ? AND v.type IN (${
                typeof value === "string"
                  ? "'text'"
                  : typeof value === "boolean"
                  ? "'true','false'"
                  : "'integer','real'"
              })))`;
        if (key !== undefined && value !== null && indexed.length) {
          const list = indexed.map(literal).join(",");
          if (indexed.length === types.length) {
            // Drive an indexed equality from its selective lookup, then resolve only matching entities.
            // CROSS JOIN makes this access path explicit rather than scanning the type's candidate rows.
            sql = `SELECT p.* FROM field_index x CROSS JOIN (${sql}) p WHERE x.entity_id=p.id AND x.type IN (${list}) AND x.field=? AND x.value=?`;
            parameters.push(field, key);
          } else
            filter(
              `((e.type IN (${list}) AND e.id IN (SELECT entity_id FROM field_index WHERE type IN (${list}) AND field=? AND value=?)) OR (e.type NOT IN (${list}) AND (${raw})))`,
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
        filter(
          `json_type(e.doc,${path(step.field)}) IS ${
            step.step === "has" ? "NOT " : ""
          }NULL`
        );
        break;
      case "linkedWith":
      case "linkedTo":
      case "linkedFrom":
      case "unlinkedTo":
      case "unlinkedFrom": {
        const outward = step.step.endsWith("To"),
          negative = step.step.startsWith("unlinked");
        const kind = step.kind;
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
        conditions.push(`${reachable("far")}`);
        const far =
          step.step === "linkedWith"
            ? "CASE WHEN r.source=e.id THEN r.target ELSE r.source END"
            : `r.${outward ? "target" : "source"}`;
        filter(
          `${
            negative ? "NOT " : ""
          }EXISTS(SELECT 1 FROM relations r JOIN entities far ON far.id=${far} WHERE ${conditions.join(
            " AND "
          )})`,
          args
        );
        break;
      }
      case "out":
      case "in":
      case "descendants":
      case "ancestors": {
        const outward = step.step === "out" || step.step === "descendants",
          deep = step.step === "descendants" || step.step === "ancestors";
        const kinds: string[] = step.kinds;
        for (const k of kinds) {
          db.relationDefinition(k);
          db.trackRange(`kind:${k}`);
        }
        for (const t of step.types ?? []) db.definition(t);
        const seeds = idsNow(),
          seen = new Set<string>(deep ? seeds : []),
          found: string[] = [];
        let frontier = seeds;
        do {
          const next: string[] = [];
          for (const id of frontier) {
            const ends = db.all(
              `SELECT far.id,far.type FROM relations r JOIN entities far ON far.id=r.${
                outward ? "target" : "source"
              } WHERE r.${
                outward ? "source" : "target"
              }=? AND r.kind IN (SELECT value FROM json_each(?)) AND ${reachable(
                "far"
              )} ORDER BY r.seq`,
              [id, JSON.stringify(kinds)]
            );
            for (const end of ends)
              if (!seen.has(end.id)) {
                seen.add(end.id);
                next.push(end.id);
                if (!step.types || step.types.includes(end.type))
                  found.push(end.id);
              }
          }
          frontier = next;
        } while (deep && frontier.length);
        restart(found);
        types = step.types ?? Object.keys(schema.types);
        break;
      }
      case "limit":
        sql = `SELECT p.* FROM (${sql}) p ORDER BY p.major,p.ord LIMIT ?`;
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
        const seen: any[] = [];
        restart(
          idsNow().filter((id) => {
            const value =
              step.field === undefined ? id : db.row(id)?.[step.field];
            if (seen.some((v) => sameValue(v, value))) return false;
            seen.push(value);
            return true;
          })
        );
        if (step.field !== undefined) trackField(step.field);
        break;
      }
      case "orderBy": {
        trackField(step.field);
        const collator = new Intl.Collator(
          schema.collation?.locale ?? "en",
          schema.collation?.options ?? {}
        );
        const ids = idsNow(),
          values = new Map(ids.map((id) => [id, db.row(id)?.[step.field]]));
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
      case "search":
      case "near":
      case "like":
      case "hybrid": {
        const ids =
          plan.start.from === "types" && steps[0] === step && scope === "live"
            ? null
            : idsNow();
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
                ["out", "in", "descendants", "ancestors"].includes(s.step)
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
                step.options,
                plan.terminal.answer === "hits"
              )
            );
          else if (step.step === "near")
            hits.push(
              ...db.search.vector(ids, type, step.vector, step.k ?? 10)
            );
          else if (step.step === "like")
            hits.push(...db.search.like(ids, type, step.id, step.k ?? 10));
          else {
            const text = db.search.text(
                ids,
                type,
                step.query,
                step.options,
                plan.terminal.answer === "hits"
              ),
              vector = db.search.vector(
                ids,
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
          `SQLite query step ${step.step} is not implemented`
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
      const result: Data = { id, score: hit.score, terms: hit.terms ?? [] };
      if (terminal.highlights) result.highlights = hit.highlights ?? {};
      if (terminal.fields) {
        const row = db.row(id)!;
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
  if (["rows", "firstRow", "hits"].includes(terminal.answer)) {
    const chosen = db.all(
      `SELECT e.payload FROM (${sql}) p JOIN entities e ON e.id=p.id ORDER BY p.major,p.ord${
        terminal.answer === "firstRow" ? " LIMIT 1" : ""
      }`,
      parameters
    );
    const projected = (payload: Uint8Array) => {
      const row = db.unpack(payload),
        id = row.id;
      db.trackKey(`entity:${id}`);
      if (!terminal.fields) return row;
      return Object.fromEntries([
        ["id", id],
        ...terminal.fields
          .filter((f: string) => f !== "id" && Object.hasOwn(row, f))
          .map((f: string) => [f, row[f]]),
      ]);
    };
    const rows = chosen.map((r) => projected(r.payload));
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
      kind: "boolean",
      value: !!db.get(ordered() + " LIMIT 1", parameters),
      __visited: visited ?? 0,
    };
  const ids = idsNow();
  if (terminal.answer === "first" || terminal.answer === "last")
    return {
      kind: "id",
      id: (terminal.answer === "first" ? ids[0] : ids.at(-1)) ?? null,
      __visited: visited ?? ids.length,
    };
  if (terminal.answer === "groupBy") {
    trackField(terminal.field);
    const groups: Array<[unknown, string[]]> = [];
    for (const id of ids) {
      const value = db.row(id)?.[terminal.field];
      const group = groups.find(([key]) => sameValue(key, value));
      if (group) group[1].push(id);
      else groups.push([value ?? null, [id]]);
    }
    return { kind: "groups", groups, __visited: visited ?? ids.length };
  }
  if (terminal.answer === "edges") {
    const groups: string[] = terminal.kinds;
    for (const k of groups) {
      db.relationDefinition(k);
      db.trackRange(`kind:${k}`);
    }
    const edges: Data[] = [];
    for (const id of ids)
      for (const r of db.all(
        `SELECT r.id FROM relations r JOIN entities far ON far.id=r.${
          terminal.outward ? "target" : "source"
        } WHERE r.${
          terminal.outward ? "source" : "target"
        }=? AND r.kind IN (SELECT value FROM json_each(?)) AND ${reachable(
          "far"
        )}` +
          (terminal.types
            ? " AND far.type IN (SELECT value FROM json_each(?))"
            : "") +
          " ORDER BY (SELECT key FROM json_each(?) WHERE value=r.kind),r.seq",
        [
          id,
          JSON.stringify(groups),
          ...(terminal.types ? [JSON.stringify(terminal.types)] : []),
          JSON.stringify(groups),
        ]
      ))
        edges.push(db.relation(r.id)!);
    return {
      kind: "relations",
      relations: edges,
      __visited: visited ?? ids.length,
    };
  }
  return { kind: "ids", ids, __visited: visited ?? ids.length };
}
