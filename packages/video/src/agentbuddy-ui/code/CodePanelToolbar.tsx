import {Icons} from '../primitives/Icon';
import './CodePanelToolbar.module.css';
import {makeStyles} from '../primitives/makeStyles';
import type {ComponentType, ReactNode} from 'react';

const styles = makeStyles('CodePanelToolbar');

export function CodePanelToolbar({
  activePanel = 'commit',
  baseDirectory,
  changeCount,
  title = 'Source Control',
  titleIcon: TitleIcon = Icons.GitCommit,
  toolbar,
}: {
  activePanel?: 'explorer' | 'commit' | 'pr' | 'search' | 'actions' | 'prompts';
  baseDirectory: string;
  changeCount: number;
  title?: string;
  titleIcon?: ComponentType<{size?: number; className?: string}>;
  toolbar?: ReactNode;
}) {
  const codePanels = [
    {id: 'explorer', label: 'Explorer', icon: Icons.FolderOpen},
    {id: 'commit', label: 'Commit Changes', icon: Icons.GitCommitVertical, badge: String(changeCount)},
    {id: 'pr', label: 'Pull Request', icon: Icons.PullRequest},
    {id: 'search', label: 'Search', icon: Icons.Search},
  ] as const;
  const internalPanels = [
    {id: 'actions', label: 'Actions', icon: Icons.Play},
    {id: 'prompts', label: 'Prompts', icon: Icons.Sparkle},
  ] as const;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}><TitleIcon size={16} /><span>{title}</span></div>
        <div className={styles.headerActions}>
          <button className={styles.directoryMenu} title={baseDirectory}>
            <Icons.ChevronDown size={14} />
            <span>{directoryName(baseDirectory)}</span>
          </button>
          <button className={styles.refresh} title="Refresh"><Icons.RotateCcw size={16} /></button>
        </div>
      </div>
      <div className={styles.panelRow}>
        <div className={styles.toolbarSlot}>{toolbar}</div>
        <div className={styles.panelButtons}>
          {codePanels.map(panel => {
            const Icon = panel.icon;
            return (
              <button key={panel.id} className={panel.id === activePanel ? styles.activePanelButton : styles.panelButton} title={panel.label}>
                <Icon size={16} />
                {'badge' in panel ? <span className={styles.badge}>{panel.badge}</span> : null}
              </button>
            );
          })}
          <span className={styles.divider} />
          {internalPanels.map(panel => {
            const Icon = panel.icon;
            return <button key={panel.id} className={panel.id === activePanel ? styles.activePanelButton : styles.panelButton} title={panel.label}><Icon size={16} /></button>;
          })}
        </div>
      </div>
    </div>
  );
}

function directoryName(baseDirectory: string) {
  const parts = baseDirectory.split('/').filter(Boolean);
  return parts[parts.length - 1] || baseDirectory;
}
