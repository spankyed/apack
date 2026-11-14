import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {FlowListItemState, FlowsListState} from './flowTypes';
import './FlowsList.module.css';

const styles = makeStyles('FlowsList');

// Mirrors packages/renderer/src/plugins/flows/canvas/components/FlowsList.vue.
export function FlowsList({state}: {state: FlowsListState}) {
  const filteredFlows = filterFlows(state.flows, state.searchQuery);
  const isSearchMode = state.searchMode === true;

  return (
    <div className={styles.root}>
      <div className={styles.content}>
        <div className={styles.header}>
          {!isSearchMode ? (
            <div className={styles.defaultControls}>
              <button className={styles.searchButton} title="Search flows" type="button">
                <Icons.Search size={16} />
              </button>
              <button className={styles.createButton} data-onboarding-id="flow-create-button" type="button">
                New Flow
              </button>
            </div>
          ) : (
            <div className={styles.searchControls}>
              <Icons.Search className={styles.searchIcon} size={14} />
              <input className={styles.searchInput} readOnly value={state.searchQuery ?? ''} placeholder="Search flows..." />
              <button className={styles.clearSearch} type="button">
                <Icons.X size={12} />
              </button>
            </div>
          )}
        </div>

        {filteredFlows.length > 0 ? (
          <div className={styles.list} tabIndex={0}>
            {filteredFlows.map(flow => (
              <FlowItem
                flow={flow}
                focused={state.focusedFlowId === flow.id}
                key={flow.id}
                menuOpen={state.menuFlowId === flow.id}
                multiSelected={state.multiSelectedFlowIds?.includes(flow.id)}
                root={state.rootFlowId === flow.id}
                selected={state.selectedFlowId === flow.id}
              />
            ))}
          </div>
        ) : isSearchMode && state.searchQuery?.trim() ? (
          <EmptySearch query={state.searchQuery} />
        ) : (
          <EmptyFlows />
        )}
      </div>
    </div>
  );
}

function FlowItem({
  flow,
  focused,
  menuOpen,
  multiSelected,
  root,
  selected,
}: {
  flow: FlowListItemState;
  focused?: boolean;
  menuOpen?: boolean;
  multiSelected?: boolean;
  root?: boolean;
  selected?: boolean;
}) {
  const Icon = root ? Icons.Brain : Icons.Workflow;
  const label = flow.label || (root ? 'Main Flow' : `Flow ${flow.id}`);

  return (
    <div className={styles.itemWrap}>
      <button
        className={styles.item}
        data-focused={focused ? 'true' : undefined}
        data-multi-selected={multiSelected ? 'true' : undefined}
        data-onboarding-id={root ? 'flow-root-item' : undefined}
        data-selected={selected ? 'true' : undefined}
        type="button"
      >
        <div className={styles.itemBody}>
          <div className={styles.itemText}>
            <span className={styles.label}>{label}</span>
            {flow.description ? <span className={styles.description}>{flow.description}</span> : null}
          </div>
          {root ? <span className={styles.rootBadge}>root</span> : null}
        </div>
        <Icon className={styles.itemIcon} size={14} />
      </button>
      {menuOpen ? <FlowItemMenu root={root} /> : null}
    </div>
  );
}

function FlowItemMenu({root}: {root?: boolean}) {
  return (
    <div className={styles.menu}>
      <button className={styles.menuItem} type="button">
        <Icons.Edit className={styles.menuEditIcon} size={14} />
        <span>Edit Label</span>
      </button>
      {!root ? (
        <>
          <div className={styles.menuSeparator} />
          <button className={styles.dangerMenuItem} type="button">
            <Icons.Trash2 size={14} />
            <span>Delete Flow</span>
          </button>
        </>
      ) : null}
    </div>
  );
}

function EmptySearch({query}: {query: string}) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}><Icons.Search size={24} /></div>
      <p>No flows match &quot;{query}&quot;</p>
    </div>
  );
}

function EmptyFlows() {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}><Icons.Workflow size={24} /></div>
      <p className={styles.emptyTitle}>No flows yet</p>
      <p className={styles.emptyCopy}>Create your first flow to get started</p>
    </div>
  );
}

function filterFlows(flows: FlowListItemState[], query?: string) {
  const trimmed = query?.trim().toLowerCase();
  if (!trimmed) return flows;
  return flows.filter(flow => `${flow.label ?? ''} ${flow.description ?? ''} ${flow.id}`.toLowerCase().includes(trimmed));
}
