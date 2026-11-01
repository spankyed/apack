/** Request-owned SQL exposing an id column, evaluated on the current query's connection and snapshot. */
export interface SqliteEntityScope {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}
