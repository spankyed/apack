// The two SPDX packages `third-party-notices.ts` uses ship no declarations; these are the parts it calls, as each
// package's README documents them.

declare module 'spdx-expression-parse' {
  // spdx-expression-parse 3, the version spdx-satisfies itself parses with, so both read an expression alike
  /** The expression's tree: a license, with `plus` for `+` and its `WITH` exception, or two joined by a conjunction */
  export type Node ={ license: string; plus?: true; exception?: string } | { left: Node; conjunction: 'and' | 'or'; right: Node };
  /** Throws on an expression that is not SPDX */
  export default function parse(expression: string): Node;
}

declare module 'spdx-satisfies' {
  /** Whether `expression` is satisfied by the licenses `allowed` lists, each one license, `+` and `-or-later` understood */
  export default function satisfies(expression: string, allowed: readonly string[]): boolean;
}
