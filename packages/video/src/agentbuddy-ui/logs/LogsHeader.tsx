import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import type {LogLevel, LogsSurfaceState} from './logTypes';
import './LogsHeader.module.css';

const styles = makeStyles('LogsHeader');

type LogsHeaderProps = {
  filteredCount: number;
  state: LogsSurfaceState;
};

const levels: Array<{icon: keyof typeof Icons; level: LogLevel; className: string}> = [
  {level: 'debug', icon: 'Bug', className: 'debug'},
  {level: 'info', icon: 'Info', className: 'info'},
  {level: 'warn', icon: 'AlertTriangle', className: 'warn'},
  {level: 'error', icon: 'AlertCircle', className: 'error'},
];

export function LogsHeader({filteredCount, state}: LogsHeaderProps) {
  const total = state.logs.length;
  const counts = countByLevel(state.logs);
  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <div className={styles.left}>
          <div className={styles.searchBox}>
            <Icons.Search className={styles.searchIcon} size={16} />
            <input placeholder="Filter logs by message, level, or source..." readOnly type="text" value={state.searchTerm} />
            {state.searchTerm ? (
              <button className={styles.clearSearch} type="button">
                <Icons.X size={16} />
              </button>
            ) : null}
          </div>

          <div className={styles.levelPills}>
            <button className={cx(styles.allPill, state.filterLevel === 'all' && styles.allActive)} type="button">
              All
              <span>{state.filterLevel !== 'all' || state.searchTerm ? `${filteredCount}/${total}` : total}</span>
            </button>
            {levels.map(item => {
              const count = counts[item.level];
              if (count === 0) return null;
              const Icon = Icons[item.icon];
              return (
                <button className={cx(styles.levelPill, styles[item.className], state.filterLevel === item.level && styles[`${item.className}Active`])} key={item.level} type="button">
                  <Icon size={14} />
                  {state.filterLevel === item.level && state.searchTerm ? filteredCount : count}
                </button>
              );
            })}
          </div>

          <button className={cx(styles.appEvents, state.settings.showAppEvents && styles.appEventsActive)} title={state.settings.showAppEvents ? 'Hide app-events logs' : 'Show app-events logs'} type="button">
            <Icons.Radio size={14} />
            <span>app-events</span>
          </button>

          {state.settings.excludedSources.length > 0 ? (
            <button className={styles.excludedSources} title="Click to manage excluded sources" type="button">
              <Icons.AlertTriangle size={14} />
              <span>{state.settings.excludedSources.length} source{state.settings.excludedSources.length !== 1 ? 's' : ''} excluded</span>
            </button>
          ) : null}
        </div>

        <div className={styles.actions}>
          <button className={cx(styles.copyButton, state.copied && styles.copied)} title="Copy logs to clipboard" type="button">
            {state.copied ? <Icons.Check size={16} /> : <Icons.Copy size={16} />}
            <span>{state.copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button className={styles.clearButton} title="Clear all logs" type="button">
            <Icons.Trash2 size={16} />
            <span>Clear</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function countByLevel(logs: LogsSurfaceState['logs']) {
  return logs.reduce<Record<LogLevel, number>>(
    (acc, log) => {
      acc[log.level] += 1;
      return acc;
    },
    {debug: 0, error: 0, info: 0, warn: 0}
  );
}
