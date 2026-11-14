import type {ActionCategory} from '../actions/actionTypes';
import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import './CategoryFilter.module.css';

const styles = makeStyles('CategoryFilter');

type CategoryFilterProps = {
  categories: ActionCategory[];
  open?: boolean;
  selectedCategories: string[];
};

export function CategoryFilter({categories, open = false, selectedCategories}: CategoryFilterProps) {
  const activeFilterCount = selectedCategories.length;

  return (
    <div className={styles.root}>
      <button className={styles.button} type="button">
        <span>Category</span>
        {activeFilterCount > 0 ? <span className={styles.count}>{activeFilterCount}</span> : null}
      </button>
      {open ? (
        <div className={styles.dropdown}>
          <div className={cx(styles.option, activeFilterCount === 0 && styles.optionSelected)}>
            <div className={styles.optionInner}>
              <Checkbox checked={activeFilterCount === 0} />
              <span className={styles.allLabel}>All</span>
            </div>
          </div>
          {categories.length > 0 ? (
            categories.map(category => {
              const selected = selectedCategories.includes(category.name);
              return (
                <div className={cx(styles.option, selected && styles.optionSelected)} key={category.name}>
                  <div className={styles.optionInner}>
                    <Checkbox checked={selected} />
                    <span
                      className={styles.badge}
                      style={{
                        backgroundColor: `${category.color}15`,
                        borderColor: category.color,
                        color: category.color,
                      }}
                    >
                      {category.name}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className={styles.empty}>No categories available</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Checkbox({checked}: {checked: boolean}) {
  return <span className={cx(styles.checkbox, checked && styles.checkboxSelected)}>{checked ? <Icons.Check size={12} /> : null}</span>;
}
