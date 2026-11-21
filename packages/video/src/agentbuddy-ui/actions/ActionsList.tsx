import {Icons} from '../primitives/Icon';
import {CategoryFilter} from '../design/CategoryFilter';
import {makeStyles} from '../primitives/makeStyles';
import type {ActionsListState} from './actionTypes';
import {Button} from './Button';
import {categoryStyle, getCategoryName} from './categoryStyle';
import './ActionsList.module.css';

const styles = makeStyles('ActionsList');

type ActionsListProps = {
  state: ActionsListState;
};

export function ActionsList({state}: ActionsListProps) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Icons.Play className={styles.headerIcon} size={16} />
          <p>Manage action templates</p>
        </div>
        <Button data-onboarding-id="actions-create-button">New Action</Button>
      </div>

      <div className={styles.tableRegion}>
        {state.hasActions ? (
          <div className={styles.scrollArea}>
            <table className={styles.table}>
              <thead className={styles.tableHead}>
                <tr>
                  <th>Label</th>
                  <th>Description</th>
                  <th className={styles.categoryFilterCell}>
                    <CategoryFilter categories={state.categories} open={state.categoryFilterOpen} selectedCategories={state.selectedCategories} />
                  </th>
                  <th className={styles.inputsColumn}>Inputs</th>
                  <th className={styles.actionsColumn}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.actions.map(action => {
                  const inputEntries = Object.entries(action.input ?? {});
                  return (
                    <tr className={styles.row} key={action.id}>
                      <td className={styles.labelCell}>{action.label}</td>
                      <td className={styles.descriptionCell}>
                        <span title={action.description}>{action.description || 'No description'}</span>
                      </td>
                      <td>
                        <span className={action.category ? styles.categoryBadge : styles.emptyCategory} style={categoryStyle(state.categories, action.category)}>
                          {getCategoryName(state.categories, action.category)}
                        </span>
                      </td>
                      <td className={styles.inputsColumn}>
                        <div className={styles.inputBadges}>
                          {inputEntries.length > 0 ? (
                            <>
                              {inputEntries.slice(0, 2).map(([key, parameter]) => (
                                <span className={styles.inputBadge} key={key} title={parameter.description ?? ''}>
                                  {key}
                                </span>
                              ))}
                              {inputEntries.length > 2 ? (
                                <span className={styles.moreBadge} title={inputEntries.slice(2).map(([key]) => key).join(', ')}>
                                  +{inputEntries.length - 2} more
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className={styles.noneText}>none</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <button aria-label="Delete action" className={styles.deleteButton} data-onboarding-id="action-delete-button" title="Delete action">
                            <Icons.Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {state.loadingMore ? <div className={styles.loadingMore}>Loading more actions...</div> : null}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <Icons.Play className={styles.emptyIcon} size={48} />
            <h3>No actions yet</h3>
            <p>Create your first action function to get started</p>
            <Button className={styles.emptyButton}>
              <Icons.Plus size={16} />
              <span>New Action</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
