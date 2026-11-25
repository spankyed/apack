import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { errorMessage, toDisplayName } from '@apackdev/sdk/utils/pure';
import type { MarkdownItem, MarkdownTreeOptions } from '@apackdev/sdk/build';

export type { MarkdownItem, MarkdownTreeOptions } from '@apackdev/sdk/build';

const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)(?:\r?\n)?/;

/** `-` becomes a space: `getting-started` reads as `getting started` */
export { toDisplayName };

/** Splits a markdown file into YAML frontmatter (YAML 1.2) and body */
export function parseMarkdownFile(text: string, file = '<markdown>'): { frontmatter: Record<string, unknown>; body: string } {
  const match = text.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: text };
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1]);
  } catch (err) {
    throw new Error(`${file}: invalid frontmatter: ${errorMessage(err)}`);
  }
  if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new Error(`${file}: frontmatter must be a YAML mapping`);
  }
  return { frontmatter: (parsed ?? {}) as Record<string, unknown>, body: text.slice(match[0].length) };
}

/**
 * Reads a directory of markdown into a tree: each `.md` file is a leaf, each subdirectory a branch
 * (its `options.branch` file supplying the branch's frontmatter and body). Entries are sorted by
 * name; the `options.media` directory is skipped. A missing directory reads as empty.
 */
export function compileMarkdownTree(dir: string, options: MarkdownTreeOptions = {}): MarkdownItem[] {
  if (!fs.existsSync(dir)) return [];
  return walk(dir, '', { branch: options.branch, recursive: options.recursive ?? true, media: options.media });
}

function walk(root: string, relative: string, options: { branch?: string; recursive: boolean; media?: string }): MarkdownItem[] {
  const dir = path.join(root, relative);
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const items: MarkdownItem[] = [];
  for (const entry of entries) {
    const itemPath = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (itemPath === options.media || !options.recursive) continue;
      const branchFile = options.branch ? path.join(dir, entry.name, options.branch) : undefined;
      const text = branchFile && fs.existsSync(branchFile) ? fs.readFileSync(branchFile, 'utf-8') : '';
      const { frontmatter, body } = text ? parseMarkdownFile(text, branchFile) : { frontmatter: {}, body: '' };
      items.push({
        kind: 'branch',
        filename: entry.name,
        displayName: toDisplayName(entry.name),
        path: itemPath,
        frontmatter,
        body,
        text,
        children: walk(root, itemPath, options),
      });
    } else if (entry.name.endsWith('.md') && entry.name !== options.branch) {
      const file = path.join(dir, entry.name);
      const text = fs.readFileSync(file, 'utf-8');
      const { frontmatter, body } = parseMarkdownFile(text, file);
      const filename = entry.name.replace(/\.md$/, '');
      items.push({
        kind: 'leaf',
        filename,
        displayName: toDisplayName(filename),
        path: itemPath,
        frontmatter,
        body,
        text,
        children: [],
      });
    }
  }
  return items;
}
