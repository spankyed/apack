import './NotesRightRail.module.css';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import {NoteTreeItem} from './NoteTreeItem';
import {NotesRailSection} from './NotesRailSection';
import type {NoteTreeNodeState, NotesRightRailState} from './noteTypes';
const styles = makeStyles('NotesRightRail');

type NotesRightRailProps = {
  state: NotesRightRailState;
};

export function NotesRightRail({state}: NotesRightRailProps) {
  const activeId = state.activeId ?? 'tasklist';
  const favoritesExpanded = state.favoritesExpanded ?? true;
  const searchActive = Boolean(state.search?.active);
  const searchQuery = state.search?.query?.trim() ?? '';
  const showTrash = Boolean(state.trash?.visible);
  const trashedNotes = state.trash?.items ?? [];
  const trashActionId = state.trash?.actionId;
  const searchResults = searchQuery ? findNotes([...state.favorites, ...state.items], searchQuery) : [];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.titleWrap}>
          {showTrash ? <button className={styles.backButton} type="button" title="Back to Notes"><Icons.ArrowLeft size={14} /></button> : null}
          <span className={styles.title}>{showTrash ? 'Trash' : 'Notes'}</span>
        </div>
        <div className={styles.actions}>
          {showTrash ? (
            trashedNotes.length > 0 ? <button className={styles.emptyTrash} type="button">Empty</button> : null
          ) : (
            <>
              <button type="button" title="New Document"><Icons.Plus size={16} /></button>
              <button className={searchActive ? styles.activeAction : undefined} type="button" title="Search notes"><Icons.Search size={16} /></button>
              <button type="button" title="More actions"><Icons.EllipsisVertical size={16} /></button>
            </>
          )}
        </div>
        {!showTrash && state.createMenuOpen ? <CreateMenu /> : null}
      </div>
      {showTrash ? (
        <TrashView actionId={trashActionId} items={trashedNotes} />
      ) : (
      <>
      {searchActive ? (
        <div className={styles.searchPanel}>
          <div className={styles.searchBox}>
            <Icons.Search className={styles.searchIcon} size={14} />
            <input className={styles.searchInput} value={searchQuery} placeholder="Search notes..." readOnly />
            {searchQuery ? <Icons.X className={styles.clearIcon} size={14} /> : null}
          </div>
        </div>
      ) : null}
      <div className={styles.scroller}>
        {searchActive && searchQuery ? (
          <section className={styles.searchResults}>
            {searchResults.length > 0
              ? searchResults.map(item => <SearchResultItem key={item.id} item={item} />)
              : <div className={styles.emptyState}>No notes found</div>}
          </section>
        ) : (
          <>
            {state.favorites.length > 0 ? (
              <NotesRailSection expanded={favoritesExpanded} label="Favorites">
                {favoritesExpanded ? state.favorites.map(item => <NoteTreeItem key={item.id} activeId="" node={item} />) : null}
              </NotesRailSection>
            ) : null}
            <section className={styles.tree}>
              {state.items.length > 0
                ? state.items.map(item => <NoteTreeItem key={item.id} activeId={activeId} node={item} />)
                : <div className={styles.emptyState}>No notes yet</div>}
            </section>
          </>
        )}
      </div>
      </>
      )}
    </div>
  );
}

function CreateMenu() {
  return (
    <div className={styles.menu}>
      <button type="button"><Icons.ClipboardList size={14} /><span>New TaskList</span></button>
      <button type="button"><Icons.Star size={14} /><span>Hide Favorites</span></button>
      <button type="button"><Icons.Trash2 size={14} /><span>Trash</span></button>
    </div>
  );
}

function TrashView({actionId, items}: {actionId?: string; items: NoteTreeNodeState[]}) {
  return (
    <div className={styles.trashList}>
      {items.length > 0
        ? items.map(item => (
          <div className={styles.trashRow} data-active={actionId === item.id ? 'true' : undefined} key={item.id}>
            {item.icon ? <span className={styles.trashEmoji}>{item.icon}</span> : <SearchResultGlyph item={item} />}
            <span className={styles.trashTitle}>{item.title || 'Untitled'}</span>
            <span className={styles.deletedAge}>{item.deletedAge ?? 'just now'}</span>
            <div className={styles.trashActions}>
              <button type="button" title="Restore"><Icons.Undo2 size={12} /></button>
              <button data-action="delete" type="button" title="Delete permanently"><Icons.Trash2 size={12} /></button>
            </div>
          </div>
        ))
        : <div className={styles.emptyState}>Trash is empty</div>}
    </div>
  );
}

function SearchResultItem({item}: {item: NoteTreeNodeState}) {
  return (
    <button className={styles.searchResult} type="button">
      {item.icon ? <span className={styles.searchEmoji}>{item.icon}</span> : <SearchResultGlyph item={item} />}
      <span>{item.title || 'Untitled'}</span>
    </button>
  );
}

function SearchResultGlyph({item}: {item: NoteTreeNodeState}) {
  if (item.noteType === 'tasklist') return <Icons.ClipboardList className={styles.searchGlyph} size={14} />;
  if (item.noteType === 'task') return <Icons.CircleCheck className={styles.searchGlyph} size={14} />;
  return <Icons.Notes className={styles.searchGlyph} size={14} />;
}

function findNotes(items: NoteTreeNodeState[], query: string): NoteTreeNodeState[] {
  const normalizedQuery = query.toLowerCase();
  return items.flatMap(item => {
    const children = item.children ? findNotes(item.children, query) : [];
    return item.title.toLowerCase().includes(normalizedQuery) ? [item, ...children] : children;
  });
}
