import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PackManifest, HelpDocument } from '@apackdev/sdk/framework';
import { parseMarkdownFile } from './content/markdown-tree.ts';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import type { Nodes } from 'mdast';

/** Materialize snapshot articles; installed packs need neither Markdown sources nor executable help loaders. */
export function compileHelp(root: string, manifest: PackManifest): HelpDocument[] {
  if (!manifest.extensions?.help) return [];
  const dir = path.resolve(root, manifest.extensions.help.path);
  const inside = (base: string, file: string) => {
    const relative = path.relative(base, file);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  if (!inside(path.resolve(root), dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory() || !inside(fs.realpathSync(root), fs.realpathSync(dir))) {
    throw new Error(`Help directory "${manifest.extensions.help.path}" must exist inside the pack.`);
  }
  const files: string[] = [];
  function walk(folder: string): void {
    for (const item of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, item.name);
      if (item.isSymbolicLink()) throw new Error(`${file}: help does not follow symbolic links.`);
      if (item.isDirectory()) walk(file);
      else if (item.isFile() && item.name.endsWith('.md')) files.push(file);
    }
  }
  walk(dir);
  const ids = new Set<string>();
  const documents = files.map(file => {
    const { body, frontmatter: meta } = parseMarkdownFile(fs.readFileSync(file, 'utf8'), file);
    const tree = fromMarkdown(body);
    const heading = tree.children[0];
    const title = heading?.type === 'heading' && heading.depth === 1 ? headingText(heading).trim() : '';
    if (!title) throw new Error(`${file}: help requires a first H1 title.`);
    const id = meta.id ?? path.relative(dir, file).replace(/\\/g, '/').slice(0, -3);
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(id)) throw new Error(`${file}: invalid help id.`);
    if (ids.has(id)) throw new Error(`${file}: duplicate help id "${id}".`);
    ids.add(id);
    if (meta.order !== undefined && (typeof meta.order !== 'number' || !Number.isFinite(meta.order))) throw new Error(`${file}: order must be a finite number.`);
    if (meta.features !== undefined && (!Array.isArray(meta.features) || meta.features.some(f => typeof f !== 'string' || !Object.prototype.hasOwnProperty.call(manifest.features ?? {}, f)))) {
      throw new Error(`${file}: features must name features declared by this pack.`);
    }
    tree.children.shift();
    return { file, tree, article: { id, title, body: '',
      ...(meta.features !== undefined ? { features: meta.features as string[] } : {}),
      ...(meta.order !== undefined ? { order: meta.order as number } : {}),
    } satisfies HelpDocument };
  });
  const byFile = new Map(documents.map(d => [d.file, d.article.id]));
  for (const { file, tree, article } of documents) {
    // Rewrite Markdown article destinations to an internal HTTPS-shaped URL the safe viewer accepts.
    // The parser distinguishes real links from inline, indented and fenced code examples.
    const resolveLink = (href: string): string => {
      const [target, fragment] = href.split('#', 2);
      if (!target.endsWith('.md') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return href;
      const id = byFile.get(path.resolve(path.dirname(file), decodeURIComponent(target)));
      if (!id) throw new Error(`${file}: help link "${href}" does not name an article in this pack.`);
      return `https://help.apack.invalid/${encodeURIComponent(manifest.id)}/${encodeURIComponent(id)}${fragment ? `#${fragment}` : ''}`;
    };
    rewriteLinks(tree, resolveLink);
    article.body = toMarkdown(tree).trim();
  }
  return documents.map(d => d.article);
}

function headingText(node: Nodes): string {
  if (node.type === 'html') return '';
  if ('value' in node) return node.value;
  if ('children' in node) return node.children.map(headingText).join('');
  return node.type === 'image' ? node.alt ?? '' : '';
}

function rewriteLinks(node: Nodes, resolve: (href: string) => string): void {
  if (node.type === 'link' || node.type === 'definition') node.url = resolve(node.url);
  if ('children' in node) node.children.forEach(child => rewriteLinks(child, resolve));
}
