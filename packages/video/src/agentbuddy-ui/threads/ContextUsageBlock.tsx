import {makeStyles} from '../primitives/makeStyles';
import type {ContextUsageBlockState} from './threadTypes';
import './ContextUsageBlock.module.css';

const styles = makeStyles('ContextUsageBlock');

const colors: Record<string, string> = {
  'System prompt': 'rgb(115 115 115)',
  'System tools': 'rgb(59 130 246)',
  'MCP tools': 'rgb(6 182 212)',
  'Memory files': 'rgb(249 115 22)',
  Skills: 'rgb(234 179 8)',
  Messages: 'rgb(168 85 247)',
  'Custom Agents': 'rgb(16 185 129)',
};

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/blocks/ContextUsageBlock.vue.
export function ContextUsageBlock({state}: {state: ContextUsageBlockState}) {
  const categories = state.categories.filter(category => category.name !== 'Free space' && category.name !== 'Autocompact buffer');
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.topLine}>
          <span className={styles.model}>{state.model || '-'}</span>
          <span className={percentageClass(state.percentage)}>{state.percentage}%</span>
        </div>
        <div className={styles.stack}>
          {categories.map(category => (
            <span className={styles.segment} key={category.name} style={{background: colorFor(category.name), width: `${category.percentage}%`}} />
          ))}
        </div>
        <div className={styles.limits}>
          <span>{fmt(state.totalTokens)} used</span>
          <span>{fmt(state.maxTokens)} limit</span>
        </div>
      </div>
      <div className={styles.breakdown}>
        <p className={styles.breakdownTitle}>Breakdown</p>
        {categories.map(category => (
          <div className={styles.category} key={category.name}>
            <div className={styles.categoryRow}>
              <span className={styles.categoryName}>
                <span className={styles.swatch} style={{background: colorFor(category.name)}} />
                <span>{category.name}</span>
              </span>
              <span className={styles.categoryStats}>
                <span className={styles.tokens}>{fmt(category.tokens)}</span>
                <span className={styles.categoryPercent}>{category.percentage.toFixed(1)}%</span>
              </span>
            </div>
            <div className={styles.bar}><span className={styles.barFill} style={{background: colorFor(category.name), width: barWidth(category.percentage)}} /></div>
          </div>
        ))}
      </div>
      {state.memoryFiles?.length ? (
        <div className={styles.details}>
          <p className={styles.detailsTitle}>Memory Files</p>
          {state.memoryFiles.map(file => (
            <div className={styles.detailRow} key={file.path}>
              <span className={styles.detailType}>{file.type}</span>
              <span className={styles.detailName}>{shortenPath(file.path)}</span>
              <span className={styles.tokens}>{fmt(file.tokens)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function percentageClass(percentage: number) {
  if (percentage >= 90) return styles.percentageDanger;
  if (percentage >= 75) return styles.percentageWarn;
  return styles.percentage;
}

function colorFor(name: string) {
  return colors[name] ?? 'rgb(115 115 115)';
}

function fmt(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function barWidth(percentage: number) {
  if (percentage <= 0) return '0%';
  return `${Math.max(percentage, 0.5)}%`;
}

function shortenPath(path: string) {
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 3) return path;
  return `.../${segments.slice(-3).join('/')}`;
}
