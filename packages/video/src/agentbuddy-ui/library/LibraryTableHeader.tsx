import {Icons} from '../primitives/Icon';
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
    <th className={styles.root}>
      <div className={styles.inner}>
        {children}
        <SortIcon className={active ? undefined : styles.inactiveIcon} size={12} />
      </div>
    </th>
  );
}
