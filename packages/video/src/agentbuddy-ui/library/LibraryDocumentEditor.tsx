import {Icons} from '../primitives/Icon';
import {LibraryContentSectionEditor} from './LibraryContentSectionEditor';
import {LibraryNameSaveHeader} from './LibraryNameSaveHeader';
import {LibraryTagInput} from './LibraryTagInput';
import type {LibraryDocumentEditorState} from './libraryTypes';
import {makeStyles} from '../primitives/makeStyles';
import './LibraryDocumentEditor.module.css';

const styles = makeStyles('LibraryDocumentEditor');

export function LibraryDocumentEditor({state}: {state: LibraryDocumentEditorState}) {
  const isEditMode = Boolean(state.document);
  const isValid = state.name.trim() !== '' && state.sections.length > 0;
  return (
    <div className={styles.root}>
      <LibraryNameSaveHeader isEditing={isEditMode} isValid={isValid} label="Name">
        {isEditMode ? (
          <div className={styles.nameInputWithCode}>
            <input className={styles.nameInputInline} readOnly value={state.name} placeholder="Enter document name" />
            {!state.isSymlink && state.document ? <span className={styles.shortCode}>{state.document.shortCode}</span> : null}
          </div>
        ) : (
          <input className={styles.nameInput} readOnly value={state.name} placeholder="Enter document name" />
        )}
      </LibraryNameSaveHeader>

      <div className={styles.scroller}>
        <form className={styles.form}>
          <div className={styles.sections} data-onboarding-id={!isEditMode ? 'library-content-sections' : undefined}>
            {state.sections.map((section, index) => (
              <LibraryContentSectionEditor
                fileName={state.name}
                key={`${section.type}-${index}`}
                section={section}
                showRemove={state.sections.length > 1}
              />
            ))}
          </div>

          {!state.isSymlink ? (
            <button className={styles.addSectionButton} type="button">
              <Icons.Plus size={16} />
              Add Section
            </button>
          ) : null}

          {!state.isSymlink ? (
            <div className={styles.tagsSection}>
              <button className={styles.tagsToggle} type="button">
                <Icons.ChevronRight size={16} />
                Tags
                {state.tags.length > 0 ? <span>({state.tags.length})</span> : null}
              </button>
              <LibraryTagInput availableTags={state.availableTags} selectedTags={state.tags} />
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
