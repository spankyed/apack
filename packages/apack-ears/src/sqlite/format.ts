/** Format provenance; format 1 changes in place before the first public release. */
export const DATABASE_FORMAT = 'sqlite/1';

const APPLICATION_ID = 0x45415253; // EARS in the SQLite file header.
const FORMAT_VERSION = 1;
const primaryTables = ['meta', 'entities', 'relations', 'embedding_values', 'value_types', 'value_fields', 'value_overflow'];
interface FormatReader { get(sql: string): Record<string, unknown> | undefined }
const refuse = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };

/** Inspect before any initializer or persistent pragma. An unclaimed empty file contains no schema objects. */
export function readDatabaseFormat(database: FormatReader): 'empty' | 'current' {
  const application = database.get('PRAGMA application_id')?.application_id;
  const version = database.get('PRAGMA user_version')?.user_version;
  if (application === 0 && version === 0 && !database.get('SELECT 1 FROM sqlite_schema LIMIT 1')) return 'empty';
  if (application !== APPLICATION_ID || version !== FORMAT_VERSION)
    return refuse('WRONG_FORMAT', 'This SQLite file is not an EARS database in the current format');
  // Missing authoritative tables are damage, never permission to create an empty replacement over the file.
  const present = database.get(`SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name IN (
    ${primaryTables.map(name => `'${name}'`).join(',')})`)?.n;
  if (present !== primaryTables.length) return refuse('CORRUPT', 'Missing authoritative SQLite storage');
  if (database.get(`SELECT 1 FROM value_types t WHERE t.id<1 OR t.id>9007199254740991 OR NOT EXISTS (
    SELECT 1 FROM sqlite_schema s WHERE s.type='table' AND s.name='values_t'||t.id) LIMIT 1`))
    return refuse('CORRUPT', 'Missing authoritative SQLite type storage');
  return 'current';
}

/** Caller holds the empty-file initialization transaction; identity and primary tables publish together. */
export const databaseFormatPragmas = `PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${FORMAT_VERSION};`;
