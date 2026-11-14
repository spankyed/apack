import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {ToolActivityBlockState, ToolActivityItemState} from './threadTypes';
import './ToolActivityBlock.module.css';

const styles = makeStyles('ToolActivityBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/blocks/ToolActivityBlock.vue.
export function ToolActivityBlock({rowOpacities, state}: {rowOpacities?: number[]; state: ToolActivityBlockState}) {
  const visibleRows = state.entries
    .map((item, index) => ({item, opacity: rowOpacities?.[index] ?? 1}))
    .filter(row => row.opacity > 0);
  const visibleItems = visibleRows.map(row => row.item);
  const isOpen = state.defaultOpen || state.state === 'error';
  const preview = getPreviewEntry(visibleItems, state.state);
  const label = state.label || computeLabel(visibleItems, state.state, state.phase);
  return (
    <div className={styles.root}>
      <button className={styles.header} type="button">
        <Icons.ChevronRight className={isOpen ? styles.chevronOpen : styles.chevron} size={16} />
        <Icons.Wrench className={styles.wrench} size={16} />
        <span className={styles.label}>{label}</span>
        <span className={styles.spacer} />
        {preview ? (
          <>
            <span className={styles.previewTool}>{preview.tool}</span>
            <span className={styles.previewSummary}>{preview.summary}</span>
          </>
        ) : null}
      </button>
      {state.artifactRef && state.state !== 'streaming' ? (
        <button className={styles.artifactLink} type="button">
          <Icons.ArrowRight size={12} />
          <span>View changes ({state.artifactRef.label})</span>
        </button>
      ) : null}
      {isOpen && visibleRows.length > 0 ? (
        <div className={styles.list}>
          {visibleRows.map(({item, opacity}) => (
            <div
              key={item.id}
              className={styles.row}
              data-status={item.status}
              style={{opacity: item.status === 'denied' ? opacity * 0.5 : opacity}}
            >
              <StatusIcon status={item.status} />
              <span className={styles.tool}>{item.tool}</span>
              <div className={styles.summaryStack}>
                <span className={styles.summary}>{item.summary}</span>
                {item.outputSummary && item.status !== 'running' ? <span className={styles.output}>{item.outputSummary}</span> : null}
              </div>
              {item.durationMs != null || item.status === 'running' ? (
                <small>{item.durationMs != null ? formatDuration(item.durationMs) : 'running'}</small>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getPreviewEntry(entries: ToolActivityItemState[], state: ToolActivityBlockState['state']) {
  if (!entries.length) return null;
  if (state === 'streaming') {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (entries[index].status === 'running') return entries[index];
    }
  }
  return entries[entries.length - 1];
}

function StatusIcon({status}: {status: ToolActivityItemState['status']}) {
  if (status === 'ok') return <Icons.Check className={styles.statusOk} size={12} />;
  if (status === 'running') return <Icons.Loader2 className={styles.statusRunning} size={12} />;
  if (status === 'denied') return <Icons.X className={styles.statusMuted} size={12} />;
  return <Icons.AlertCircle className={styles.statusError} size={12} />;
}

function formatDuration(durationMs?: number) {
  if (durationMs == null) return '';
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const mins = Math.floor(durationMs / 60_000);
  const secs = Math.round((durationMs % 60_000) / 1000);
  return `${mins}m${secs}s`;
}

function computeLabel(entries: ToolActivityItemState[], state: ToolActivityBlockState['state'], phase?: string) {
  const streamingLabel = phase === 'Plan' ? 'Planning' : 'Working';
  if (entries.length === 0) return state === 'streaming' ? streamingLabel : 'No activity';

  const running = entries.filter(entry => entry.status === 'running');
  const errored = entries.filter(entry => entry.status === 'error');
  const groups = groupByTool(entries);

  if (state === 'done' || state === 'error') {
    const errorSuffix = errored.length > 0 ? ` · ${errored.length} error${errored.length === 1 ? '' : 's'}` : '';
    if (groups.length === 1) {
      const [group] = groups;
      return `${pastVerb(group.tool)} ${group.count} ${noun(group.tool, group.count)}${errorSuffix}`;
    }
    if (groups.length === 2) {
      const [a, b] = groups;
      return `${pastVerb(a.tool)} ${a.count} ${noun(a.tool, a.count)}, ${pastVerb(b.tool).toLowerCase()} ${b.count} ${noun(b.tool, b.count)}${errorSuffix}`;
    }
    return `Ran ${entries.length} tools${errorSuffix}`;
  }

  if (running.length === 1 && running[0].tool === 'Bash') {
    const secs = running[0].durationMs ? Math.round(running[0].durationMs / 1000) : 0;
    return `Running bash${secs >= 5 ? ` (${secs}s)` : ''}`;
  }

  if (groups.length === 1) {
    const [group] = groups;
    return `${presentVerb(group.tool)} ${group.count} ${noun(group.tool, group.count)}`;
  }

  return streamingLabel;
}

function groupByTool(entries: ToolActivityItemState[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.tool, (counts.get(entry.tool) ?? 0) + 1);
  return Array.from(counts.entries()).map(([tool, count]) => ({tool, count}));
}

function presentVerb(tool: string) {
  switch (tool) {
    case 'Read': return 'Reading';
    case 'Write': return 'Writing';
    case 'Edit':
    case 'NotebookEdit': return 'Editing';
    case 'Glob':
    case 'Grep':
    case 'WebSearch': return 'Searching';
    case 'Bash': return 'Running';
    case 'WebFetch': return 'Fetching';
    case 'Task': return 'Delegating';
    default: return 'Running';
  }
}

function pastVerb(tool: string) {
  switch (tool) {
    case 'Read': return 'Read';
    case 'Write': return 'Wrote';
    case 'Edit':
    case 'NotebookEdit': return 'Edited';
    case 'Glob':
    case 'Grep':
    case 'WebSearch': return 'Searched';
    case 'Bash': return 'Ran';
    case 'WebFetch': return 'Fetched';
    case 'Task': return 'Delegated';
    default: return 'Ran';
  }
}

function noun(tool: string, count: number) {
  const plural = count !== 1;
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return plural ? 'files' : 'file';
    case 'Glob':
    case 'Grep':
    case 'WebSearch':
      return plural ? 'searches' : 'search';
    case 'Bash':
      return plural ? 'commands' : 'command';
    case 'WebFetch':
      return plural ? 'pages' : 'page';
    case 'Task':
      return plural ? 'tasks' : 'task';
    default:
      return plural ? 'tools' : 'tool';
  }
}
