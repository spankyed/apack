import type {ReactNode} from 'react';
import type {CSSProperties} from 'react';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {NoteTreeNodeState} from './noteTypes';
import './NotesHomeSurface.module.css';

const styles = makeStyles('NotesHomeSurface');

export type NotesHomeCardState = Pick<NoteTreeNodeState, 'icon' | 'id' | 'noteType' | 'title'> & {
  active?: boolean;
  pressed?: boolean;
  updatedAt: string;
};

export function NotesHomeSurface({
  favorites,
  greeting,
  newNotePressed = false,
  recent,
  searchQuery = '',
  searchResults = [],
  showFavorites = true,
  showRecent = true,
  showSearch = true,
  style,
}: {
  favorites: NotesHomeCardState[];
  greeting: string;
  newNotePressed?: boolean;
  recent: NotesHomeCardState[];
  searchQuery?: string;
  searchResults?: NotesHomeCardState[];
  showFavorites?: boolean;
  showRecent?: boolean;
  showSearch?: boolean;
  style?: CSSProperties;
}) {
  const isSearching = searchQuery.trim().length > 0;
  return (
    <div className={styles.root} style={style}>
      <h1 className={styles.greeting}>{greeting}</h1>
      <div className={styles.content}>
        {showSearch ? <div className={styles.searchRow}>
          <div className={styles.searchBox}>
            <Icons.Search className={styles.searchIcon} size={16} />
            <input placeholder="Search notes..." readOnly type="text" value={searchQuery} />
          </div>
          <button className={styles.newNoteButton} data-pressed={newNotePressed ? 'true' : undefined} type="button">
            <Icons.Plus size={16} />
            <span>New note</span>
          </button>
        </div> : null}

        {isSearching ? (
          <div className={styles.searchResults}>
            {searchResults.length === 0 ? (
              <div className={styles.noResults}>No notes found</div>
            ) : (
              searchResults.map(note => <SearchResult key={note.id} note={note} />)
            )}
          </div>
        ) : (
          <>
            {showRecent ? <Section emptyLabel="No recently viewed notes" icon={<Icons.Clock size={16} />} title="Recently visited">
              {recent.map(note => <NoteCard key={note.id} note={note} />)}
            </Section> : null}
            {showFavorites && favorites.length > 0 ? (
              <Section icon={<Icons.Star size={16} />} title="Favorites">
                {favorites.map(note => <NoteCard key={note.id} note={note} favorite />)}
              </Section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Section({children, emptyLabel, icon, title}: {children: ReactNode; emptyLabel?: string; icon: ReactNode; title: string}) {
  return (
    <section className={styles.section}>
      <header className={styles.header}>{icon}<span>{title}</span></header>
      {Array.isArray(children) && children.length === 0 && emptyLabel ? (
        <div className={styles.empty}>{emptyLabel}</div>
      ) : (
        <div className={styles.cards}>{children}</div>
      )}
    </section>
  );
}

function SearchResult({note}: {note: NotesHomeCardState}) {
  const icon = note.icon ?? (note.noteType === 'tasklist' ? <Icons.ListChecks size={16} /> : note.noteType === 'task' ? <Icons.CircleCheck size={16} /> : <Icons.FileText size={16} />);
  return (
    <button className={styles.searchResult} type="button">
      <span className={styles.searchResultIcon}>{icon}</span>
      <span>{note.title || 'Untitled'}</span>
    </button>
  );
}

function NoteCard({favorite, note}: {favorite?: boolean; note: NotesHomeCardState}) {
  const icon = note.icon ?? (note.noteType === 'tasklist' ? <Icons.ListChecks size={28} /> : note.noteType === 'task' ? <Icons.CircleCheck size={28} /> : <Icons.FileText size={28} />);
  return (
    <button
      className={styles.card}
      data-active={note.active ? 'true' : undefined}
      data-favorite={favorite ? 'true' : undefined}
      data-pressed={note.pressed ? 'true' : undefined}
      type="button"
    >
      <div className={styles.cardIcon}>{icon}</div>
      <div className={styles.cardCopy}>
        <span>{note.title || 'Untitled'}</span>
        <small>{note.updatedAt}</small>
      </div>
    </button>
  );
}
