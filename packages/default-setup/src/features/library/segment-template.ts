// How a search index's `constructTemplate` is filled in (plain string work, shared by the backend and the index
// editor): the author writes `{{segment 1}}`, `{{segment 2}}` … and each is replaced by the segment its rule
// selected. The search index is dormant: see be/search-index/README.md.
//
// It lives here rather than in the backend because the index editor needs the same rule to preview a template, and a
// value imported from `be/` would pull backend modules into the renderer bundle — every cross-half import in this
// pack is `import type` for that reason.
//
// Nothing here may log or otherwise reach the SDK's host binding: the pack FE bundler refuses an inlined module
// that does, and the index editor imports this.

/** Every `{{segment N}}` in an author's template, N being 1-based */
const SEGMENT_PLACEHOLDER = /\{\{segment (\d+)\}\}/g

/**
 * `template` with each `{{segment N}}` replaced by `textFor(N)`, and by `unfilled` where that has none.
 *
 * One scan with a replacer, which is what makes it correct rather than merely shorter — the five call sites this
 * replaced each did `result = result.replace('{{segment 1}}', text)` in a loop, and that shape is wrong four ways:
 * a string pattern replaces only the *first* occurrence, so an author repeating a placeholder lost the repeat; a
 * string *replacement* interprets `$&`, `` $` ``, `$'` and `$1`, so document content containing them was
 * corrupted (`replaceAll` would not have fixed that); assigning back means the next pass substitutes into content
 * already substituted in, so a segment whose text contains `{{segment 2}}` was itself filled; and each site made
 * its own choice about a placeholder with no segment, so four of the five left `{{segment 7}}` in the text that
 * gets embedded and stored, where the editor's preview had promised the author it would be filled.
 *
 * `textFor` rather than an array because the multi-index path fills one template once per separated item, each
 * time with a different value for one index. `unfilled` is the only thing its callers disagree about: the backend
 * wants nothing, since a leftover placeholder is noise an embedding encodes as readily as prose, and the editor
 * wants something its reader recognises as a gap.
 */
export function fillSegments(
  template: string,
  textFor: (n: number) => string | undefined,
  unfilled = ''
): string {
  return template.replace(SEGMENT_PLACEHOLDER, (_match, n: string) => textFor(Number(n)) ?? unfilled)
}
