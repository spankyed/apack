import type { ActionParameter, TemplateInput } from '../types/sdk-entities.ts';
import type { ContentFormatConfig } from '../framework/declaration-types.ts';
import type { ContentItem } from '../content/item-types.ts';

export interface ActionMeta {
  label: string;
  description?: string;
  category?: string;
  input: Record<string, ActionParameter>;
  output?: unknown;
}

export interface PromptMeta {
  label: string;
  description?: string;
  category?: string;
  inputs: Record<string, TemplateInput>;
  outputSchema?: unknown;
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** Where a field's value comes from in a markdown item */
export type ContentFieldSource = 'body' | 'filename' | 'path' | `frontmatter.${string}`;

export type ContentFieldSpec = NonNullable<ContentFormatConfig['fields']>[string];
export type ContentTreeSpec = NonNullable<ContentFormatConfig['tree']>;

/** A markdown file or directory, as `compileMarkdownTree` reads it */
export interface MarkdownItem {
  /** A directory (whose own file, if any, gives its frontmatter and body) or a markdown file */
  kind: 'branch' | 'leaf';
  /** The file or directory name, without `.md` */
  filename: string;
  /** `filename` with dashes turned into spaces */
  displayName: string;
  /** Path relative to the walked directory, with `/` separators */
  path: string;
  frontmatter: Record<string, unknown>;
  /** The markdown after the frontmatter block (the whole file when it has none) */
  body: string;
  /** The file's full text; empty for a directory without its own file */
  text: string;
  children: MarkdownItem[];
}

export interface MarkdownTreeOptions {
  /** A directory's own file (e.g. `index.md`, `_meta.md`). Without it, directories carry no frontmatter or body. */
  branch?: string;
  /** Walk subdirectories. Default true; false reads only the directory's markdown files. */
  recursive?: boolean;
  /** A subdirectory (relative, `/` separators) copied as media rather than read as content: the format's `media` */
  media?: string;
}

/** What a compiler module's default export receives */
export interface ContentCompileContext {
  key: string;
  /** Absolute path of the entry's `path` */
  path: string;
  /** The pack writing the entry (a dependency's format still compiles the writing pack's sources) */
  packDir: string;
  format: ContentFormatConfig;
  /** Walks a markdown directory and parses YAML frontmatter using the pack compiler's built-in walker. */
  compileMarkdownTree: (dir: string, options?: MarkdownTreeOptions) => MarkdownItem[];
}

export type ContentCompilerModule = (context: ContentCompileContext) => ContentItem[] | Promise<ContentItem[]>;
