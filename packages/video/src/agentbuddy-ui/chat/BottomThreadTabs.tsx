import type {ChatComposerState} from './chatTypes';
import {NewThreadContextMenu} from './NewThreadContextMenu';
import {RecentThreadsMenu} from './RecentThreadsMenu';
import {Icons} from '../primitives/Icon';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('ChatComposer');

type BottomThreadTabsProps = NonNullable<ChatComposerState['bottomTabs']>;

export function BottomThreadTabs({active = 'active', activeEditing, activeLabel, newThreadMenu, pressed, recentThreadsMenu}: BottomThreadTabsProps) {
  return (
    <div className={styles.bottomTabs}>
      <div className={styles.bottomTabSlot} data-slot="recent">
        <button className={styles.bottomTabButton} data-active={active === 'recent'} data-pressed={pressed === 'recent'} type="button">
          {recentThreadsMenu ? <Icons.ChevronUp size={16} /> : <Icons.History size={16} />}
          <ResponsiveBottomTabLabel first="Recent" rest="Threads" />
        </button>
      </div>
      <div className={styles.bottomTabSlot} data-slot="active">
        <span className={styles.bottomTabActiveGroup} data-active={active === 'active'} data-pressed={pressed === 'active'}>
          <span className={styles.bottomTabDashboardIconWrap} title="Toggle inline dashboard">
            <Icons.PanelLeft className={styles.bottomTabDashboardIcon} size={14} />
          </span>
          {activeEditing ? (
            <input className={styles.bottomTabActiveRenameInput} readOnly size={Math.max(activeLabel.length + 1, 1)} value={activeLabel} />
          ) : (
            <span className={styles.bottomTabActiveTitle} title="Thread Artifacts">{activeLabel}</span>
          )}
        </span>
      </div>
      <div className={styles.bottomTabSlot} data-slot="new">
        <button className={styles.bottomTabButton} data-active={active === 'new'} data-pressed={pressed === 'new'} type="button"><Icons.Plus size={16} /><ResponsiveBottomTabLabel first="New" rest="thread" /></button>
        {newThreadMenu ? <NewThreadContextMenu menu={newThreadMenu} /> : null}
      </div>
      {recentThreadsMenu ? <RecentThreadsMenu menu={recentThreadsMenu} /> : null}
    </div>
  );
}

function ResponsiveBottomTabLabel({first, rest}: {first: string; rest: string}) {
  return (
    <span>
      {first}
      <span className={styles.bottomTabResponsiveText}>{` ${rest}`}</span>
    </span>
  );
}
