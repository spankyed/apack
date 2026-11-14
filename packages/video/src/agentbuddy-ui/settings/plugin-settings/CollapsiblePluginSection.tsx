import {Icons} from '../../primitives/Icon';
import './CollapsiblePluginSection.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('CollapsiblePluginSection');

export function CollapsiblePluginSection({children, defaultOpen = true, label}: {children: React.ReactNode; defaultOpen?: boolean; label: string}) {
  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <Icons.ChevronRight className={defaultOpen ? styles.chevronOpen : undefined} size={16} />
        <span>{label}</span>
      </header>
      {defaultOpen ? <div className={styles.body}>{children}</div> : null}
    </section>
  );
}
