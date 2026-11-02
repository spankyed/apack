// Bump the derived revision whenever text storage or analysis changes, so writable opens
// replace old generations rather than silently reusing incompatible postings.
export const SQLITE_TEXT_REVISION = 4;
export const TEXT_LEAD_MAX_UNITS = 256;
export const TEXT_LEAD_WEIGHT = 3;

/** A bounded source prefix, ending at whitespace so truncation never invents a partial token. */
export function textLead(source: string): string {
  if (source.length <= TEXT_LEAD_MAX_UNITS) return source;
  const prefix = source.slice(0, TEXT_LEAD_MAX_UNITS);
  if (/\s/u.test(source[TEXT_LEAD_MAX_UNITS]!)) return prefix;
  const boundary = prefix.search(/\s+\S*$/u);
  return boundary < 0 ? '' : prefix.slice(0, boundary);
}

/** Older retired generations have no literal companion and must remain collectible. */
export function hasLiteralText(definition: Record<string, any>): boolean {
  return definition.stem === 'en' && definition.textRevision >= 3;
}

/** Revision 4 stores source strings once in an ordinary shared content table. */
export function hasSharedText(definition: Record<string, any>): boolean { return definition.textRevision >= 4; }
