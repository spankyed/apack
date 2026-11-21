import {DataRenderer} from './DataRenderer';
import type {LogEntry} from './logTypes';
import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import './LogRow.module.css';

const styles = makeStyles('LogRow');

type LogRowProps = {
  expandedContent?: 'meta' | 'stack';
  log: LogEntry;
  searchTerm?: string;
};

export function LogRow({expandedContent, log, searchTerm = ''}: LogRowProps) {
  const hasExpandable = Boolean((log.meta && Object.keys(log.meta).length > 0) || log.stack);
  return (
    <div className={styles.root}>
      <div className={cx(styles.summary, hasExpandable && styles.clickable)}>
        <div className={cx(styles.levelIcon, styles[log.level])}>
          <LevelIcon level={log.level} />
        </div>
        <div className={styles.message}>
          <p>{renderHighlightedMessage(log.message, searchTerm)}</p>
        </div>
        <div className={styles.meta}>
          {log.source ? (
            <span className={styles.source} title={`Right-click to exclude '${log.source}' from logs`}>
              {log.source}
            </span>
          ) : null}
          <span className={styles.time}>{formatTime(log.timestamp)}</span>
          <div className={styles.chevronSlot}>
            {hasExpandable ? <Icons.ChevronRight className={expandedContent ? styles.expandedChevron : undefined} size={12} /> : null}
          </div>
        </div>
      </div>

      {expandedContent ? (
        <div className={styles.expanded}>
          <div className={styles.expandedInner}>
            {expandedContent === 'meta' && log.meta ? (
              <div className={styles.metadataPanel}>
                <div className={styles.metadataTitle}>Metadata</div>
                <DataRenderer data={log.meta} />
              </div>
            ) : null}
            {expandedContent === 'stack' && log.stack ? (
              <div className={styles.stackPanel}>
                <div className={styles.stackTitle}>
                  <Icons.FileWarning size={12} />
                  <span>Stack Trace</span>
                </div>
                <pre>{formatStackTrace(log.stack)}</pre>
              </div>
            ) : null}
            {log.meta && log.stack ? (
              <div className={styles.toggles}>
                <button className={expandedContent === 'meta' ? styles.toggleActive : undefined} type="button">View metadata</button>
                <button className={expandedContent === 'stack' ? styles.stackToggleActive : undefined} type="button">View stack trace</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderHighlightedMessage(message: string, searchTerm: string) {
  const includeTerms = parseIncludeTerms(searchTerm);
  if (includeTerms.length === 0) return message;

  const pattern = includeTerms.map(escapeRegex).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = message.split(regex);

  return parts.map((part, index) => (
    includeTerms.includes(part.toLowerCase()) ? <mark className={styles.searchMark} key={`${part}-${index}`}>{part}</mark> : part
  ));
}

function parseIncludeTerms(searchTerm: string) {
  if (!searchTerm.trim()) return [];
  return searchTerm
    .trim()
    .split(/\s+/)
    .filter(term => term && term !== '-' && !term.startsWith('-'))
    .map(term => term.toLowerCase());
}

function escapeRegex(term: string) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function LevelIcon({level}: {level: LogEntry['level']}) {
  if (level === 'debug') return <Icons.Bug size={14} />;
  if (level === 'warn') return <Icons.AlertTriangle size={14} />;
  if (level === 'error') return <Icons.AlertCircle size={14} />;
  return <Icons.Info size={14} />;
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatStackTrace(stack: string) {
  return stack
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
}
