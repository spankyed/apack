import {Icons} from '../primitives/Icon';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('ChatComposer');

// Mirrors packages/renderer/src/plugins/threads/canvas/components/thread-context-menu.vue.
export function RecentThreadContextMenu({copyText, isArchived, isPinned}: {copyText: string; isArchived: boolean; isPinned: boolean}) {
  return (
    <div className={styles.threadContextMenu}>
      <button className={styles.threadContextMenuItem} type="button">
        <Icons.Pencil className={styles.threadContextMenuNeutralIcon} size={14} />
        Rename
      </button>
      <button className={styles.threadContextMenuItem} onClick={() => copyThreadId(copyText)} type="button">
        <Icons.Copy className={styles.threadContextMenuNeutralIcon} size={14} />
        Copy Id
      </button>
      <div className={styles.threadContextMenuSeparator} />
      <button className={styles.threadContextMenuItem} type="button">
        <Icons.Pin className={styles.threadContextMenuNeutralIcon} size={14} />
        {isPinned ? 'Unpin' : 'Pin'}
      </button>
      {isArchived ? (
        <button className={styles.threadContextMenuItem} type="button">
          <Icons.ArchiveRestore className={styles.threadContextMenuArchiveIcon} size={14} />
          Unarchive
        </button>
      ) : !isPinned ? (
        <button className={styles.threadContextMenuItem} type="button">
          <Icons.Archive className={styles.threadContextMenuArchiveIcon} size={14} />
          Archive
        </button>
      ) : null}
      <div className={styles.threadContextMenuSeparator} />
      <button className={styles.threadContextMenuDeleteItem} type="button">
        <Icons.Trash2 size={14} />
        Delete
      </button>
    </div>
  );
}

function copyThreadId(copyText: string) {
  if (typeof navigator === 'undefined') return;
  void navigator.clipboard?.writeText(copyText);
}
