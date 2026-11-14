import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import {PlanArtifactCard} from './PlanArtifactCard';
import {ThreadsHeader} from './ThreadsHeader';
import type {PlanArtifactState, ThreadsHeaderState} from './threadTypes';
import './ThreadDashboardSurface.module.css';

const styles = makeStyles('ThreadDashboardSurface');

export type ArtifactSidebarType = 'plan' | 'diff' | 'claude-session' | 'code' | 'note' | 'text';

export type ThreadDashboardSurfaceState = {
  activeTabId: string;
  artifactSidebar?: Array<{
    color?: 'purple' | 'emerald' | 'amber' | 'cyan';
    id: string;
    title: string;
    type?: ArtifactSidebarType;
  }>;
  artifact: PlanArtifactState;
  header?: ThreadsHeaderState;
  hoveredTabId?: string;
  pinPressed?: boolean;
  pinned?: boolean;
  tabs: Array<{
    id: string;
    label: string;
    pinned?: boolean;
  }>;
};

const artifactTypeIcon: Record<ArtifactSidebarType, typeof Icons.FileText> = {
  'claude-session': Icons.Wrench,
  code: Icons.Code,
  diff: Icons.GitBranch,
  note: Icons.StickyNote,
  plan: Icons.ClipboardList,
  text: Icons.FileText,
};

// Mirrors packages/renderer/src/plugins/threads/canvas/agent/canvas.vue: the tab
// bar, then a content viewer split into the thread's artifact list (left) and
// the selected artifact (right). There is no thread-name header above the
// artifact — the artifact card itself is the top of the content area.
export function ThreadDashboardSurface({state}: {state: ThreadDashboardSurfaceState}) {
  const pinnedTabs = state.tabs.filter(tab => tab.pinned || (tab.id === state.activeTabId && state.pinned));
  const regularTabs = state.tabs.filter(tab => !pinnedTabs.some(pinned => pinned.id === tab.id));

  return (
    <div className={styles.root}>
      {state.header ? <ThreadsHeader state={state.header} /> : null}
      {pinnedTabs.length > 0 ? (
        <div className={styles.pinnedRow}>
          {pinnedTabs.map(tab => (
            <ThreadTab
              active={tab.id === state.activeTabId}
              hovered={tab.id === state.hoveredTabId}
              key={tab.id}
              pinPressed={tab.id === state.activeTabId && state.pinPressed}
              pinned
              tab={tab}
            />
          ))}
        </div>
      ) : null}
      <div className={styles.tabRow}>
        {regularTabs.map(tab => (
          <ThreadTab
            active={tab.id === state.activeTabId}
            hovered={tab.id === state.hoveredTabId}
            key={tab.id}
            pinPressed={tab.id === state.activeTabId && state.pinPressed}
            tab={tab}
          />
        ))}
      </div>
      <div className={styles.body} data-sidebar={state.artifactSidebar?.length ? 'true' : 'false'}>
        {state.artifactSidebar?.length ? (
          <aside className={styles.artifactSidebar}>
            {state.artifactSidebar.map(item => {
              const Icon = artifactTypeIcon[item.type ?? 'text'];
              return (
                <div
                  className={styles.artifactItem}
                  data-color={item.color}
                  data-selected={item.id === state.artifact.id || undefined}
                  key={item.id}
                >
                  <Icon className={styles.artifactItemIcon} size={16} />
                  <span className={styles.artifactItemTitle}>{item.title}</span>
                </div>
              );
            })}
          </aside>
        ) : null}
        <section className={styles.content}>
          <PlanArtifactCard artifact={state.artifact} />
        </section>
      </div>
    </div>
  );
}

function ThreadTab({
  active,
  hovered,
  pinPressed,
  pinned,
  tab,
}: {
  active?: boolean;
  hovered?: boolean;
  pinPressed?: boolean;
  pinned?: boolean;
  tab: {id: string; label: string};
}) {
  return (
    <div className={active ? styles.tabActive : styles.tab} data-hovered={hovered || undefined}>
      <span className={styles.tabDot} />
      <span className={styles.tabLabel}>{tab.label}</span>
      <Icons.Pin
        className={pinned ? styles.tabPinPinned : styles.tabPin}
        data-pressed={pinPressed || undefined}
        size={12}
      />
    </div>
  );
}
