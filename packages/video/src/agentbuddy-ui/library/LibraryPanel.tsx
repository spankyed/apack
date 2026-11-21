import {makeStyles} from '../primitives/makeStyles';
import type {LibraryPanelState} from './libraryTypes';
import './LibraryPanel.module.css';

const styles = makeStyles('LibraryPanel');

export function LibraryPanel({state}: {state: LibraryPanelState}) {
  const selected = state.selectedItem;
  return (
    <div className={styles.root}>
      <section>
        <h3 className={styles.heading}>Library Stats</h3>
        <div className={styles.statStack}>
          <Stat label="Documents:" value={state.documentsCount} />
          <Stat label="Folders:" value={state.foldersCount} />
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>{selected?.type === 'folder' ? 'Selected Folder' : 'Selected Document'}</h3>
        {selected ? (
          <div className={styles.detailStack}>
            <Detail label="Name:" value={selected.name} />
            {selected.filePath ? <Detail label="Path:" value={selected.filePath} alignTop /> : null}
            {selected.shortCode ? <Detail label="Code:" value={selected.shortCode === 'DOC-0' ? '' : selected.shortCode} code /> : null}
            {selected.tags?.length ? (
              <div className={styles.tagsBlock}>
                <h4>Tags:</h4>
                <div className={styles.tagList}>
                  {selected.tags.map(tag => <span className={styles.selectedTag} key={tag}>{tag}</span>)}
                </div>
              </div>
            ) : null}
            <Detail label="Modified:" value={formatDate(selected.updatedAt)} />
          </div>
        ) : (
          <p className={styles.empty}>Select items to view details</p>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>All Tags</h3>
        <div className={styles.allTags}>
          {state.allTags.map(tag => (
            <button className={styles.allTag} data-tone={tag.tone} key={tag.name} type="button">
              {tag.name} ({tag.count})
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({label, value}: {label: string; value: number}) {
  return (
    <div className={styles.statRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Detail({alignTop, code, label, value}: {alignTop?: boolean; code?: boolean; label: string; value: string}) {
  return (
    <div className={styles.detailRow} data-align-top={alignTop ? 'true' : undefined}>
      <span>{label}</span>
      <strong data-code={code ? 'true' : undefined}>{value}</strong>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'});
}
