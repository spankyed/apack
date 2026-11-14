import {makeStyles} from '../primitives/makeStyles';
import type {LibraryContentSectionState, LibraryPanelState} from './libraryTypes';
import './LibraryPanel.module.css';

const styles = makeStyles('LibraryPanel');

export function LibraryPanel({state}: {state: LibraryPanelState}) {
  const selected = state.selectedItem;
  const selectedItemsCount = state.selectedItemsCount ?? (selected ? 1 : 0);
  const title = selectedItemsCount > 1
    ? `Selected Items (${selectedItemsCount})`
    : selected?.type === 'folder'
      ? 'Selected Folder'
      : 'Selected Document';

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
        <h3 className={styles.heading}>{title}</h3>
        {selected?.type === 'document' ? (
          <div className={styles.detailStack}>
            <Detail label="Name:" value={selected.name} />
            {selected.filePath ? <Detail label="Path:" value={selected.filePath} alignTop /> : null}
            {selected.shortCode ? <Detail label="Code:" value={selected.shortCode === 'DOC-0' ? '' : selected.shortCode} code /> : null}
            {selected.content?.length ? <ContentPreview sections={selected.content} /> : null}
            {selected.tags?.length ? (
              <div className={styles.tagsBlock}>
                <h4>Tags:</h4>
                <div className={styles.tagList}>
                  {selected.tags.map(tag => <span className={styles.selectedTag} key={tag}>{tag}</span>)}
                </div>
              </div>
            ) : null}
            <div className={styles.dateStack}>
              {selected.createdAt ? <Detail label="Created:" value={formatDate(selected.createdAt)} compact /> : null}
              {selected.updatedAt ? <Detail label="Modified:" value={formatDate(selected.updatedAt)} compact /> : null}
            </div>
          </div>
        ) : selected?.type === 'folder' ? (
          <div className={styles.detailStack}>
            <Detail label="Name:" value={selected.name} />
            {selected.filePath ? <Detail label="Path:" value={selected.filePath} alignTop compact /> : null}
          </div>
        ) : selectedItemsCount > 1 ? (
          <div className={styles.detailStack}>
            <div className={styles.multiStats}>
              <Stat label="Documents:" value={state.selectedDocumentsCount ?? 0} />
              <Stat label="Folders:" value={state.selectedFoldersCount ?? 0} />
            </div>
            {state.selectedItemsTags?.length ? (
              <div className={styles.tagsBlock}>
                <h4>Combined Tags:</h4>
                <div className={styles.tagList}>
                  {state.selectedItemsTags.map(tag => <span className={styles.combinedTag} key={tag}>{tag}</span>)}
                </div>
              </div>
            ) : null}
            <p className={styles.bulkHint}>Use bulk actions to manage multiple items at once</p>
          </div>
        ) : (
          <p className={styles.empty}>Select items to view details</p>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>All Tags</h3>
        {state.allTags.length ? (
          <div className={styles.allTags}>
            {state.allTags.map(tag => (
              <button className={styles.allTag} data-tone={tag.tone} key={tag.name} type="button">
                {tag.name} ({tag.count})
              </button>
            ))}
          </div>
        ) : <p className={styles.empty}>No tags yet</p>}
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

function Detail({alignTop, code, compact, label, value}: {alignTop?: boolean; code?: boolean; compact?: boolean; label: string; value: string}) {
  return (
    <div className={styles.detailRow} data-align-top={alignTop ? 'true' : undefined} data-compact={compact ? 'true' : undefined}>
      <span>{label}</span>
      <strong data-code={code ? 'true' : undefined}>{value}</strong>
    </div>
  );
}

function ContentPreview({sections}: {sections: LibraryContentSectionState[]}) {
  return (
    <div className={styles.previewBlock}>
      <h4>Content Preview:</h4>
      <div className={styles.previewList}>
        {sections.map((section, index) => (
          <div className={styles.previewRow} key={`${section.type}-${index}`}>
            {sectionPreview(section)}
          </div>
        ))}
      </div>
    </div>
  );
}

function sectionPreview(section: LibraryContentSectionState) {
  if (section.type === 'markdown' || section.type === 'text') {
    return <span>{truncateText(section.text, 60)}</span>;
  }

  if (section.type === 'field') {
    return (
      <>
        <span className={styles.previewMuted}>Fields ({countValidFields(section.fields)}):</span>
        <span>{getFieldPreview(section.fields)}</span>
      </>
    );
  }

  if (section.type === 'list') {
    return <span className={styles.previewMuted}>List ({countValidItems(section.items)} items)</span>;
  }

  return <span>{truncateText(section.text, 60)}</span>;
}

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
}

function countValidFields(fields: Array<{key: string; value: string}>): number {
  return fields.filter(field => field.key.trim() || field.value.trim()).length;
}

function countValidItems(items: string[]): number {
  return items.filter(item => item.trim()).length;
}

function getFieldPreview(fields: Array<{key: string; value: string}>): string {
  const validFields = fields.filter(field => field.key.trim());
  if (!validFields.length) return 'No fields';

  const preview = validFields.slice(0, 2).map(field => field.key).join(', ');
  return validFields.length > 2 ? `${preview}, ...` : preview;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const time = date.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'});

  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;

  return `${date.toLocaleDateString('en-US')}, ${time}`;
}
