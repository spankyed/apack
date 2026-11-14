import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {StashState} from './codeTypes';
import './StashesSection.module.css';

const styles = makeStyles('StashesSection');

// Mirrors the stashes section in packages/renderer/src/plugins/code/features/commit/CommitPanel.vue.
export function StashesSection({expanded = false, searchOpen = false, searchQuery = '', stashes}: {expanded?: boolean; searchOpen?: boolean; searchQuery?: string; stashes?: StashState[]}) {
  if (!stashes?.length) return null;

  const filteredStashes = searchQuery.trim()
    ? stashes.filter(stash => `${stash.ref} ${stash.message}`.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : stashes;

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div className={styles.title}>
          {expanded ? <Icons.ChevronDown size={13} /> : <Icons.ChevronRight size={13} />}
          <span>STASHES ({searchQuery.trim() ? `${filteredStashes.length}/` : ''}{stashes.length})</span>
        </div>
        <div className={styles.actions}>
          <button className={searchOpen ? styles.activeAction : undefined} type="button" title="Search Stashes"><Icons.Search size={14} /></button>
          <button type="button" title="Clear All Stashes"><Icons.Trash2 size={14} /></button>
        </div>
      </header>
      {expanded ? (
        <div className={styles.body}>
          {searchOpen ? (
            <div className={styles.searchWrap}>
              <Icons.Search className={styles.searchIcon} size={12} />
              <input className={styles.searchInput} placeholder="Search stashes..." readOnly value={searchQuery} />
              {searchQuery ? <button className={styles.clearSearch} type="button"><Icons.X size={12} /></button> : null}
            </div>
          ) : null}
          <div className={styles.list}>
            {filteredStashes.map(stash => (
              <div className={styles.row} key={stash.ref}>
                <div className={styles.copy}>
                  <div className={styles.message}>{stash.message}</div>
                  <div className={styles.meta}>{stash.ref} · {stash.branch} · {stash.date}</div>
                </div>
                <div className={styles.rowActions}>
                  <button type="button" title="Copy message"><Icons.Copy size={12} /></button>
                  <button type="button" title="Pop (apply & remove)"><Icons.ArrowDownToLine size={12} /></button>
                  <button type="button" title="Drop"><Icons.Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
