import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import {LibraryButton} from './LibraryButton';
import {LibraryTableHeader} from './LibraryTableHeader';
import {LibraryTableRow} from './LibraryTableRow';
import type {LibrarySurfaceState} from './libraryTypes';
import './LibraryBrowser.module.css';

const styles = makeStyles('LibraryBrowser');

export function LibraryBrowser({state}: {state: LibrarySurfaceState}) {
  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.navigationRow}>
          <div className={styles.breadcrumbGroup}>
            <button className={styles.backButton} data-disabled={state.currentFolderId === null} type="button" title="Go back">
              <Icons.ChevronLeft size={16} />
            </button>
            <nav className={styles.breadcrumbs} aria-label="Folder path">
              <button className={styles.homeButton} data-active={state.currentFolderId === null} type="button" title="Home">
                <Icons.Home size={16} />
              </button>
              {state.breadcrumbs.map((crumb, index) => (
                <span className={styles.crumbGroup} key={`${crumb.id}-${index}`}>
                  <span className={styles.slash}>/</span>
                  <button className={styles.crumbButton} data-active={index === state.breadcrumbs.length - 1} type="button">
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>
          </div>

          <div className={styles.actions}>
            {state.selectedItemIds.length > 0 ? (
              <>
                <span className={styles.selectionCount}>{state.selectedItemIds.length} selected</span>
                <LibraryButton size="sm" variant="transparent">
                  <Icons.Trash2 size={16} />
                </LibraryButton>
                <span className={styles.divider} />
              </>
            ) : null}
            <div className={styles.splitButton}>
              <button className={styles.splitMain} type="button">
                <Icons.FolderPlus size={16} />
                <span>New Folder</span>
              </button>
              <button className={styles.splitChevron} type="button" aria-label="New symlink folder">
                <Icons.ChevronDown size={12} />
              </button>
            </div>
            <LibraryButton size="sm" variant="primary">
              <Icons.FileText size={16} />
              <span>New Document</span>
            </LibraryButton>
          </div>
        </div>
      </div>

      <div className={styles.tableScroller}>
        <table className={styles.table} data-onboarding-id="library-table">
          <thead className={styles.thead}>
            <tr>
              <LibraryTableHeader column="name" sortBy={state.sortBy} sortDirection={state.sortDirection}>Name</LibraryTableHeader>
              <LibraryTableHeader column="modified" sortBy={state.sortBy} sortDirection={state.sortDirection}>Date Modified</LibraryTableHeader>
              <LibraryTableHeader column="size" sortBy={state.sortBy} sortDirection={state.sortDirection}>Size</LibraryTableHeader>
              <LibraryTableHeader column="kind" sortBy={state.sortBy} sortDirection={state.sortDirection}>Kind</LibraryTableHeader>
            </tr>
          </thead>
          <tbody>
            {state.items.length > 0 ? (
              state.items.map(item => <LibraryTableRow item={item} key={item.id} />)
            ) : (
              <tr>
                <td className={styles.emptyCell} colSpan={4}>
                  <div className={styles.emptyState}>
                    <Icons.FolderOpen size={40} />
                    <p>This folder is empty</p>
                  </div>
                </td>
              </tr>
            )}
            {state.items.length > 0
              ? Array.from({length: Math.max(0, 8 - state.items.length)}).map((_, index) => (
                <tr className={styles.emptyRow} key={`empty-${index}`}>
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                </tr>
              ))
              : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
