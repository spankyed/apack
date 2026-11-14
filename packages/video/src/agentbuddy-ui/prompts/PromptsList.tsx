import {Button} from '../actions/Button';
import {categoryStyle, getCategoryName} from '../actions/categoryStyle';
import {CategoryFilter} from '../design/CategoryFilter';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {PromptsListState} from './promptTypes';
import './PromptsList.module.css';

const styles = makeStyles('PromptsList');

type PromptsListProps = {
  state: PromptsListState;
};

export function PromptsList({state}: PromptsListProps) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Icons.Sparkle className={styles.headerIcon} size={16} />
          <p>Manage prompt templates</p>
        </div>
        <Button data-onboarding-id="prompts-create-button">New Prompt</Button>
      </div>

      <div className={styles.tableRegion}>
        {state.hasPrompts ? (
          <div className={styles.scrollArea}>
            <table className={styles.table}>
              <thead className={styles.tableHead}>
                <tr>
                  <th>Label</th>
                  <th>Description</th>
                  <th className={styles.categoryFilterCell}>
                    <CategoryFilter categories={state.categories} selectedCategories={state.selectedCategories} />
                  </th>
                  <th className={styles.inputsColumn}>Inputs</th>
                  <th className={styles.actionsColumn}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.prompts.map(prompt => {
                  const inputEntries = Object.entries(prompt.inputs ?? {});
                  return (
                    <tr className={styles.row} key={prompt.id}>
                      <td className={styles.labelCell}>{prompt.label}</td>
                      <td className={styles.descriptionCell}>
                        <span title={prompt.description}>{prompt.description || 'No description'}</span>
                      </td>
                      <td>
                        <span className={prompt.category ? styles.categoryBadge : styles.emptyCategory} style={categoryStyle(state.categories, prompt.category)}>
                          {getCategoryName(state.categories, prompt.category)}
                        </span>
                      </td>
                      <td className={styles.inputsColumn}>
                        <div className={styles.inputBadges}>
                          {inputEntries.length > 0 ? (
                            <>
                              {inputEntries.slice(0, 2).map(([key, input]) => (
                                <span className={styles.inputBadge} key={key} title={input.description ?? ''}>
                                  {input.name || key}
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
                          <button aria-label="Delete prompt" className={styles.deleteButton} title="Delete prompt" type="button">
                            <Icons.Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {state.loadingMore ? <div className={styles.loadingMore}>Loading more prompts...</div> : null}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIconWrap}>
              <Icons.Sparkle className={styles.emptyIcon} size={32} />
            </div>
            <h3>No prompts yet</h3>
            <p>Create your first prompt template to get started with reusable AI workflows</p>
            <Button className={styles.emptyButton}>
              <Icons.Plus size={16} />
              <span>New Prompt</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
