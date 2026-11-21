import type {ReactNode} from 'react';
import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import './CollapsibleSection.module.css';

const styles = makeStyles('ActionsCollapsibleSection');

type CollapsibleSectionProps = {
  children: ReactNode;
  headerActions?: ReactNode;
  label: ReactNode;
  open?: boolean;
};

export function CollapsibleSection({children, headerActions, label, open = true}: CollapsibleSectionProps) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <button className={styles.trigger} type="button">
          <Icons.ChevronRight className={cx(styles.chevron, open && styles.chevronOpen)} size={16} />
          <label>{label}</label>
        </button>
        {open && headerActions ? <div className={styles.headerActions}>{headerActions}</div> : null}
      </div>
      {open ? <div className={styles.content}>{children}</div> : null}
    </div>
  );
}
