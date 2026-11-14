import type {ReactNode} from 'react';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './NotesRailSection.module.css';

const styles = makeStyles('NotesRailSection');

// Mirrors the collapsible Favorites section label in packages/renderer/src/plugins/notes/panel.vue.
export function NotesRailSection({children, expanded = true, label}: {children: ReactNode; expanded?: boolean; label: string}) {
  return (
    <section className={styles.root}>
      <button className={styles.label} type="button">
        <span className={styles.iconWrap}>
          <Icons.Star className={styles.star} size={12} />
          <Icons.ChevronRight className={expanded ? styles.chevronExpanded : styles.chevron} size={12} />
        </span>
        <span>{label}</span>
      </button>
      {children}
    </section>
  );
}
