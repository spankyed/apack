import {Icons} from '../primitives/Icon';
import {MonacoCodeViewer} from '../code/MonacoCodeViewer';
import './MarkdownViewer.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('MarkdownViewer');

type MarkdownBlock =
  | {items: Array<{checked?: boolean; text: string}>; type: 'list' | 'ordered-list' | 'task-list'}
  | {language?: string; text: string; type: 'code'}
  | {rows: string[][]; type: 'table'}
  | {type: 'hr'}
  | {level: 1 | 2 | 3; text: string; type: 'heading'}
  | {text: string; type: 'paragraph' | 'quote'};

// Film replica of TiptapEditor mode="viewer" variant="chat" for markdown
// generated in thread messages and plan artifacts.
export function MarkdownViewer({content}: {content: string}) {
  const blocks = parseMarkdownBlocks(content);
  return (
    <div className={styles.wrapper}>
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
        <div className={styles.codeEditor}>
          <MonacoCodeViewer height={codeBlockHeight(block.text)} language={block.language} value={block.text} />
        </div>
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

function codeBlockHeight(text: string) {
  const lineCount = Math.max(1, text.split('\n').length);
  return Math.min(220, Math.max(72, lineCount * 20 + 24));
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
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

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a href={link[2]} key={index}>{link[1]}</a>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    return <span key={index}>{part}</span>;
  });
}
