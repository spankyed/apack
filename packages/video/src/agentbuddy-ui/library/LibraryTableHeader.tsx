import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import type {LibrarySurfaceState} from './libraryTypes';
import './LibraryTableHeader.module.css';

const styles = makeStyles('LibraryTableHeader');

export function LibraryTableHeader({
  children,
  column,
  sortBy,
  sortDirection,
}: {
  children: React.ReactNode;
  column: LibrarySurfaceState['sortBy'];
  sortBy: LibrarySurfaceState['sortBy'];
  sortDirection: LibrarySurfaceState['sortDirection'];
}) {
  const active = column === sortBy;
  const SortIcon = active ? (sortDirection === 'asc' ? Icons.ArrowUp : Icons.ArrowDown) : Icons.ArrowUpDown;
  return (
    <th className={cx(styles.root, styles[column])}>
      <div className={styles.inner}>
        {children}
        <SortIcon className={active ? undefined : styles.inactiveIcon} size={12} />
      </div>
    </th>
  );
}
