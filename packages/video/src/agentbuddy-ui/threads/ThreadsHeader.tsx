import {Icons} from '../primitives/Icon';
import './ThreadsHeader.module.css';
import {makeStyles} from '../primitives/makeStyles';
import type {ThreadsHeaderState} from './threadTypes';

const styles = makeStyles('ThreadsHeader');

export function ThreadsHeader({state}: {state: ThreadsHeaderState}) {
  const activeView = state.activeView ?? 'kanban';
  const searchKeyword = state.searchKeyword ?? '';
  const HeadingIcon = state.showArchived ? Icons.Archive : Icons.History;
  const headingLabel = state.showArchived ? 'Viewing archived threads' : 'Manage agent threads';
  return (
    <div className={styles.root}>
      <div className={styles.left}>
        <HeadingIcon size={16} color="rgb(115 115 115)" />
        <span>{headingLabel}</span>
      </div>
      <div className={styles.actions}>
        <div className={styles.toggleGroup}>
          <button className={activeView === 'list' ? styles.activeIconButton : styles.iconButton} data-hovered={state.hoveredView === 'list' || undefined} data-pressed={state.pressedView === 'list' || undefined} title="List View"><Icons.List size={16} /></button>
          <button className={activeView === 'kanban' ? styles.activeIconButton : styles.iconButton} data-hovered={state.hoveredView === 'kanban' || undefined} data-pressed={state.pressedView === 'kanban' || undefined} title="Kanban Board"><Icons.Columns size={16} /></button>
          <button className={activeView === 'dashboard' ? styles.activeIconButton : styles.iconButton} data-hovered={state.hoveredView === 'dashboard' || undefined} data-pressed={state.pressedView === 'dashboard' || undefined} title="Dashboard"><Icons.PanelLeft size={16} /></button>
        </div>
        <div className={styles.filterGroup}>
          <button className={styles.filterButton}>
            <Icons.Filter size={14} />
            <span>{state.filterLabel}</span>
          </button>
          {state.activeFilterCount ? (
            <button className={styles.clearFiltersButton}>
              <span>Clear filters</span>
              <span className={styles.filterCount}>({state.activeFilterCount})</span>
            </button>
          ) : null}
          {state.filterPopover?.visible ? <FilterPopover state={state.filterPopover} /> : null}
        </div>
        <div className={styles.search}>
          <Icons.Search className={styles.searchIcon} size={16} />
          <input className={styles.searchInput} value={searchKeyword} placeholder={state.searchPlaceholder} readOnly />
          {searchKeyword ? <button className={styles.clearSearchButton} type="button"><Icons.X size={14} /></button> : null}
        </div>
        <button className={styles.newButton} data-onboarding-id="thread-create-button" data-pressed={state.newThreadPressed || undefined}>{state.newThreadLabel}</button>
      </div>
    </div>
  );
}

function FilterPopover({state}: {state: NonNullable<ThreadsHeaderState['filterPopover']>}) {
  return (
    <div className={styles.filterPopover}>
      <FilterSection label="Status" values={state.statuses ?? []} />
      <FilterSection label="Chat state" values={state.chatStates ?? []} />
      <FilterSection label="Tags" values={state.tags ?? []} />
      <div className={styles.filterToggles}>
        <div className={state.rootOnly ? styles.filterToggleActive : styles.filterToggle}>
          <span>Root threads only</span>
          <Icons.Network size={14} />
        </div>
        <div className={state.showArchived ? styles.filterToggleActive : styles.filterToggle}>
          <span>View Archive</span>
          <Icons.Archive size={14} />
        </div>
      </div>
    </div>
  );
}

function FilterSection({label, values}: {label: string; values: Array<{color?: string; label: string; selected?: boolean}>}) {
  if (values.length === 0) return null;
  return (
    <section className={styles.filterSection}>
      <h4>{label}</h4>
      <div className={styles.filterOptions}>
        {values.map(value => {
          const color = value.color ?? '#525252';
          return (
            <span
              className={value.selected ? styles.filterOptionActive : styles.filterOption}
              key={value.label}
              style={{backgroundColor: value.selected ? color : `${color}20`}}
            >
              {value.label}
            </span>
          );
        })}
      </div>
    </section>
  );
}
