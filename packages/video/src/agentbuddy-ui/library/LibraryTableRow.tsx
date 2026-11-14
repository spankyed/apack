import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import type {LibraryItemState} from './libraryTypes';
import type {ReactNode} from 'react';
import './LibraryTableRow.module.css';

const styles = makeStyles('LibraryTableRow');

export function LibraryTableRow({depth = 0, item, loadingFolderIds = []}: {depth?: number; item: LibraryItemState; loadingFolderIds?: string[]}) {
  const isFolder = item.type === 'folder';
  const isBrokenSymlink = isFolder && item.isSymlink && item.isBroken;
  const isLoading = isFolder && item.expanded && loadingFolderIds.includes(item.id);
  const hasSymlinkPath = Boolean(item.filePath);
  const isSymlinkedItem = Boolean(item.isSymlinked || item.isSymlink);
  const ItemIcon = isBrokenSymlink ? Icons.Link2Off : item.isSymlink ? Icons.Link2 : isFolder ? Icons.Folder : Icons.FileText;

  return (
    <>
      <tr className={cx(styles.root, item.selected && styles.selected, item.isContextMenuOpen && !item.selected && styles.menuOpen, isBrokenSymlink && styles.broken)}>
        <td className={styles.nameCell}>
          <div className={styles.nameInner} style={{paddingLeft: `${depth * 24}px`}}>
            {isFolder && !isBrokenSymlink ? (
              <span className={cx(styles.disclosure, item.expanded && styles.disclosureExpanded)}>
                <Icons.ChevronRight size={12} />
              </span>
            ) : (
              <span className={styles.disclosureSpacer} />
            )}
            <ItemIcon className={cx(styles.itemIcon, isFolder && styles.folderIcon, item.isSymlink && !isBrokenSymlink && styles.symlinkIcon)} size={isFolder ? 20 : 16} />
            <div className={styles.nameLabelWrap}>
              <span className={cx(styles.itemName, isFolder && styles.folderName, item.isEditing && styles.invisibleName)}>{item.name}</span>
              {item.isEditing ? (
                <input className={cx(styles.renameInput, isFolder && styles.folderName)} readOnly value={item.name} />
              ) : null}
            </div>
          </div>
          {item.isContextMenuOpen ? (
            <div className={styles.contextMenu}>
              <MenuItem icon={<Icons.Edit2 size={16} />} label="Rename" />
              <MenuItem icon={<Icons.Copy size={16} />} label="Copy Id" />
              {isSymlinkedItem && isFolder ? <MenuItem icon={<Icons.RefreshCw size={16} />} label="Refresh" /> : null}
              {hasSymlinkPath ? <MenuItem icon={<Icons.Copy size={16} />} label="Copy Path" /> : null}
              {hasSymlinkPath ? <MenuItem icon={<Icons.FolderOpen size={16} />} label="Open in Finder" /> : null}
              <div className={styles.menuSeparator} />
              {isBrokenSymlink ? <MenuItem icon={<Icons.Link2 size={16} />} label="Re-link" tone="blue" /> : null}
              <MenuItem icon={item.isSymlink ? <Icons.Unlink size={16} /> : <Icons.Trash2 size={16} />} label={item.isSymlink ? 'Unlink' : 'Delete'} tone={item.isSymlink ? 'purple' : 'red'} />
            </div>
          ) : null}
        </td>
        <td className={styles.cell}>{formatDate(item.updatedAt)}</td>
        <td className={styles.cell}>{item.size}</td>
        <td className={cx(styles.cell, styles.kindCell)}>{item.kind}</td>
      </tr>
      {isBrokenSymlink && item.relinkForm?.show ? (
        <tr className={styles.relinkRow}>
          <td colSpan={4}>
            <div className={styles.relinkInner} style={{paddingLeft: `${depth * 24 + 20}px`}}>
              <input className={styles.relinkInput} readOnly value={item.relinkForm.path} placeholder="Enter directory path" />
              <button className={styles.relinkButton} type="button">Browse</button>
              <button className={styles.relinkPrimary} type="button">Re-link</button>
              <button className={styles.relinkClose} type="button">x</button>
            </div>
          </td>
        </tr>
      ) : null}
      {isLoading ? (
        <tr className={styles.loadingRow}>
          <td colSpan={4}>
            <div className={styles.loadingInner} style={{paddingLeft: `${(depth + 1) * 16 + 16}px`}}>
              <span className={styles.spinner} />
              <span>Loading...</span>
            </div>
          </td>
        </tr>
      ) : null}
      {isFolder && item.expanded && !isLoading && item.children?.map(child => <LibraryTableRow depth={depth + 1} item={child} loadingFolderIds={loadingFolderIds} key={child.id} />)}
    </>
  );
}

function MenuItem({icon, label, tone}: {icon: ReactNode; label: string; tone?: 'blue' | 'purple' | 'red'}) {
  return (
    <div className={cx(styles.menuItem, tone === 'blue' && styles.menuItemBlue, tone === 'purple' && styles.menuItemPurple, tone === 'red' && styles.menuItemRed)}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

  if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString()}, ${time}`;
}
