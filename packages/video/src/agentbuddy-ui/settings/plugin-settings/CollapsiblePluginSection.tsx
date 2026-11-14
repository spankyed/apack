import {Icons} from '../../primitives/Icon';
import './CollapsiblePluginSection.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('CollapsiblePluginSection');

export function CollapsiblePluginSection({children, defaultOpen = true, label}: {children: React.ReactNode; defaultOpen?: boolean; label: string}) {
  return (
    <section className={styles.root}>
      <div className={styles.header}>
        <button className={styles.button} type="button">
          <Icons.ChevronRight className={defaultOpen ? styles.chevronOpen : undefined} size={16} />
          <span>{label}</span>
        </button>
      </div>
      {defaultOpen ? <div className={styles.body}>{children}</div> : null}
    </section>
  );
}
