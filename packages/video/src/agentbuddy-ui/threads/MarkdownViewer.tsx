import {Icons} from '../primitives/Icon';
import {ReferencePill} from '../chat/ReferencePill';
import {referenceTypeForProtocol} from '../chat/referenceConfig';
import {SubDocumentLink, parseSubDocumentHref} from '../notes/SubDocumentLink';
import './MarkdownViewer.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('MarkdownViewer');

type MarkdownBlock =
  | {icon?: string | null; noteId?: string; text: string; type: 'sub-document-link'}
  | {items: Array<{checked?: boolean; text: string}>; type: 'list' | 'ordered-list' | 'task-list'}
  | {language?: string; text: string; type: 'code'}
  | {rows: string[][]; type: 'table'}
  | {type: 'hr'}
  | {level: 1 | 2 | 3; text: string; type: 'heading'}
  | {text: string; type: 'paragraph' | 'quote'};

type MarkdownViewerVariant = 'chat' | 'full';

// Film replica of TiptapEditor mode="viewer". Chat is the default because
// thread messages and plan artifacts use the reduced chat viewer config.
export function MarkdownViewer({content, variant = 'chat'}: {content: string; variant?: MarkdownViewerVariant}) {
  const blocks = parseMarkdownBlocks(content, variant);
  return (
    <div className={styles.wrapper} data-variant={variant}>
      <div className={styles.prose}>
        {blocks.map((block, index) => renderBlock(block, index))}
      </div>
    </div>
  );
}

function renderBlock(block: MarkdownBlock, index: number) {
  if (block.type === 'heading') {
    const children = renderInlineMarkdown(block.text);
    if (block.level === 1) return <h1 key={index}>{children}</h1>;
    if (block.level === 2) return <h2 key={index}>{children}</h2>;
    return <h3 key={index}>{children}</h3>;
  }
  if (block.type === 'sub-document-link') {
    return <SubDocumentLink icon={block.icon} key={index} noteId={block.noteId} title={block.text} />;
  }
  if (block.type === 'list') {
    return <ul key={index}>{block.items.map(item => <li key={item.text}>{renderInlineMarkdown(item.text)}</li>)}</ul>;
  }
  if (block.type === 'ordered-list') {
    return <ol key={index}>{block.items.map(item => <li key={item.text}>{renderInlineMarkdown(item.text)}</li>)}</ol>;
  }
  if (block.type === 'task-list') {
    return (
      <ul className={styles.taskList} key={index}>
        {block.items.map(item => (
          <li data-checked={item.checked ? 'true' : undefined} key={item.text}>
            <label><input checked={Boolean(item.checked)} readOnly type="checkbox" /></label>
            <div>{renderInlineMarkdown(item.text)}</div>
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === 'code') {
    return (
      <div className={styles.codeBlock} key={index}>
        <pre><code>{block.text}</code></pre>
        <button aria-label="Copy code" className={styles.copyCode} type="button"><Icons.Copy size={13} /></button>
      </div>
    );
  }
  if (block.type === 'table') {
    const [header, ...rows] = block.rows;
    return (
      <table key={index}>
        <thead><tr>{header.map(cell => <th key={cell}>{renderInlineMarkdown(cell)}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (block.type === 'quote') return <blockquote key={index}>{renderInlineMarkdown(block.text)}</blockquote>;
  if (block.type === 'hr') return <hr key={index} />;
  if (block.type === 'paragraph') return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
  return null;
}

function parseMarkdownBlocks(markdown: string, variant: MarkdownViewerVariant): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split('\n');
  let list: Extract<MarkdownBlock, {type: 'list' | 'ordered-list' | 'task-list'}> | null = null;
  let code: {language?: string; lines: string[]} | null = null;
  let tableRows: string[][] = [];

  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  const flushTable = () => {
    if (tableRows.length) blocks.push({type: 'table', rows: tableRows});
    tableRows = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const fence = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      flushList();
      flushTable();
      if (code) {
        blocks.push({language: code.language, text: code.lines.join('\n'), type: 'code'});
        code = null;
      } else {
        code = {language: fence[1], lines: []};
      }
      continue;
    }

    if (code) {
      code.lines.push(rawLine);
      continue;
    }

    if (!line) {
      flushList();
      flushTable();
      continue;
    }

    if (/^---+$/.test(line)) {
      flushList();
      flushTable();
      blocks.push({type: 'hr'});
      continue;
    }

    if (line.includes('|') && /^\|?(.+\|)+.+\|?$/.test(line) && !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line)) {
      flushList();
      tableRows.push(line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()));
      continue;
    }

    if (tableRows.length && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line)) {
      continue;
    }
    flushTable();

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList();
      blocks.push({level: heading[1].length as 1 | 2 | 3, text: heading[2], type: 'heading'});
      continue;
    }

    if (variant === 'full' && line.includes('](document://')) {
      flushList();
      pushLineWithSubDocumentLinks(blocks, line);
      continue;
    }

    const task = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (task) {
      if (!list || list.type !== 'task-list') {
        flushList();
        list = {type: 'task-list', items: []};
      }
      list.items.push({checked: task[1].toLowerCase() === 'x', text: task[2]});
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (!list || list.type !== 'list') {
        flushList();
        list = {type: 'list', items: []};
      }
      list.items.push({text: unordered[1]});
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      if (!list || list.type !== 'ordered-list') {
        flushList();
        list = {type: 'ordered-list', items: []};
      }
      list.items.push({text: ordered[1]});
      continue;
    }

    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      flushList();
      blocks.push({text: quote[1], type: 'quote'});
      continue;
    }

    flushList();
    blocks.push({text: line, type: 'paragraph'});
  }

  if (code) blocks.push({language: code.language, text: code.lines.join('\n'), type: 'code'});
  flushList();
  flushTable();
  return blocks;
}

function pushLineWithSubDocumentLinks(blocks: MarkdownBlock[], line: string) {
  const documentLinkPattern = /\[([^\]]+)\]\((document:\/\/[^)]+)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = documentLinkPattern.exec(line))) {
    const textBefore = line.slice(cursor, match.index).trim();
    if (textBefore) blocks.push({text: textBefore, type: 'paragraph'});

    const parsed = parseSubDocumentHref(match[2]);
    blocks.push({
      icon: parsed?.icon,
      noteId: parsed?.noteId,
      text: match[1],
      type: 'sub-document-link',
    });

    cursor = match.index + match[0].length;
  }

  const textAfter = line.slice(cursor).trim();
  if (textAfter) blocks.push({text: textAfter, type: 'paragraph'});
}

function renderInlineMarkdown(text: string) {
  const parts = splitInlineMarkdown(text);
  return parts.map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const refType = referenceTypeFromHref(link[2]);
      if (refType) return <ReferencePill key={index} label={link[1]} refType={refType} />;
      return <a href={link[2]} key={index}>{link[1]}</a>;
    }
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    return <span key={index}>{part}</span>;
  });
}

function splitInlineMarkdown(text: string) {
  const parts: string[] = [];
  let cursor = 0;
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;

  while (cursor < text.length) {
    const linkStart = text.indexOf('[', cursor);
    tokenPattern.lastIndex = cursor;
    const nextToken = tokenPattern.exec(text);
    const tokenStart = nextToken?.index ?? -1;

    if (linkStart !== -1 && (tokenStart === -1 || linkStart < tokenStart)) {
      const parsed = readMarkdownLink(text, linkStart);
      if (parsed) {
        if (linkStart > cursor) parts.push(text.slice(cursor, linkStart));
        parts.push(parsed.raw);
        cursor = parsed.end;
        continue;
      }
    }

    if (nextToken) {
      if (nextToken.index > cursor) parts.push(text.slice(cursor, nextToken.index));
      parts.push(nextToken[0]);
      cursor = nextToken.index + nextToken[0].length;
      continue;
    }

    parts.push(text.slice(cursor));
    break;
  }

  return parts.filter(Boolean);
}

function readMarkdownLink(text: string, start: number) {
  const labelEnd = text.indexOf(']', start + 1);
  if (labelEnd === -1 || text[labelEnd + 1] !== '(') return null;

  let depth = 0;
  for (let index = labelEnd + 2; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(') depth += 1;
    if (char === ')') {
      if (depth === 0) return {end: index + 1, raw: text.slice(start, index + 1)};
      depth -= 1;
    }
  }

  return null;
}

function referenceTypeFromHref(href: string) {
  const protocol = href.match(/^([a-z]+):\/\//i)?.[1];
  return protocol ? referenceTypeForProtocol(protocol) : null;
}
