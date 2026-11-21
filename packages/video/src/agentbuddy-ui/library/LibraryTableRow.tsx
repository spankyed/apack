import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import type {LibraryItemState} from './libraryTypes';
import './LibraryTableRow.module.css';

const styles = makeStyles('LibraryTableRow');

export function LibraryTableRow({depth = 0, item}: {depth?: number; item: LibraryItemState}) {
  const isFolder = item.type === 'folder';
  const isBrokenSymlink = isFolder && item.isSymlink && item.isBroken;
  const ItemIcon = isBrokenSymlink ? Icons.Link2Off : item.isSymlink ? Icons.Link2 : isFolder ? Icons.Folder : Icons.FileText;

  return (
    <>
      <tr className={cx(styles.root, item.selected && styles.selected, isBrokenSymlink && styles.broken)}>
        <td className={styles.nameCell}>
          <div className={styles.nameInner} style={{paddingLeft: `${depth * 24}px`}}>
            {isFolder && !isBrokenSymlink ? (
              <span className={cx(styles.disclosure, item.expanded && styles.disclosureExpanded)}>
                <Icons.ChevronRight size={12} />
              </span>
            ) : (
              <span className={styles.disclosureSpacer} />
            )}
            <ItemIcon className={cx(styles.itemIcon, isFolder && styles.folderIcon, item.isSymlink && styles.symlinkIcon)} size={isFolder ? 20 : 16} />
            <span className={cx(styles.itemName, isFolder && styles.folderName)}>{item.name}</span>
          </div>
        </td>
        <td className={styles.cell}>{formatDate(item.updatedAt)}</td>
        <td className={styles.cell}>{item.size}</td>
        <td className={cx(styles.cell, styles.kindCell)}>{item.kind}</td>
      </tr>
      {isFolder && item.expanded && item.children?.map(child => <LibraryTableRow depth={depth + 1} item={child} key={child.id} />)}
    </>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'});
}
