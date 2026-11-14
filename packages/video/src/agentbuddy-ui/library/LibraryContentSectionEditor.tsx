import {MonacoCodeViewer} from '../code/MonacoCodeViewer';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {LibraryContentSectionState} from './libraryTypes';
import './LibraryContentSectionEditor.module.css';

const styles = makeStyles('LibraryContentSectionEditor');

const labelByType: Record<LibraryContentSectionState['type'], string> = {
  code: 'Code',
  field: 'Fields',
  list: 'List',
  markdown: 'Markdown',
  text: 'Plain Text',
};

export function LibraryContentSectionEditor({
  fileName,
  section,
  showRemove,
}: {
  fileName?: string;
  section: LibraryContentSectionState;
  showRemove?: boolean;
}) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.expandButton} type="button">
            <Icons.ChevronRight size={16} />
          </button>
          <select className={styles.typeSelect} disabled value={section.type}>
            <option value={section.type}>{labelByType[section.type]}</option>
          </select>
        </div>
        {showRemove ? (
          <button className={styles.removeButton} type="button" title="Remove section">
            <Icons.X size={16} />
          </button>
        ) : null}
      </div>
      <div className={section.type === 'markdown' ? styles.markdownBody : styles.body}>
        <SectionBody fileName={fileName} section={section} />
      </div>
    </div>
  );
}

function SectionBody({fileName, section}: {fileName?: string; section: LibraryContentSectionState}) {
  switch (section.type) {
    case 'markdown':
      return <MarkdownEditor text={section.text} />;
    case 'text':
      return <textarea className={styles.textarea} readOnly value={section.text} placeholder="Plain text content..." />;
    case 'field':
      return (
        <div className={styles.stack}>
          {section.fields.map((field, index) => (
            <div className={styles.fieldRow} key={`${field.key}-${index}`}>
              <input className={styles.input} readOnly value={field.key} placeholder="Key" />
              <input className={styles.input} readOnly value={field.value} placeholder="Value" />
              <button className={styles.inlineIconButton} type="button" title="Remove field">
                <Icons.X size={16} />
              </button>
            </div>
          ))}
          <button className={styles.secondaryButton} type="button">
            <Icons.Plus size={16} />
            Add Field
          </button>
        </div>
      );
    case 'list':
      return (
        <div className={styles.stack}>
          {section.items.map((item, index) => (
            <div className={styles.listRow} key={`${item}-${index}`}>
              <input className={styles.input} readOnly value={item} placeholder="List item" />
              <button className={styles.inlineIconButton} type="button" title="Remove item">
                <Icons.X size={16} />
              </button>
            </div>
          ))}
          <div className={styles.buttonRow}>
            <button className={styles.secondaryButton} type="button">
              <Icons.Plus size={16} />
              Add Item
            </button>
            <button className={styles.secondaryButton} type="button">Bulk Add</button>
          </div>
        </div>
      );
    case 'code':
      return <MonacoCodeViewer filePath={fileName} height={220} language={section.language ?? 'plaintext'} value={section.text} />;
  }
}

function MarkdownEditor({text}: {text: string}) {
  return (
    <div className={styles.markdownEditor}>
      <div className={styles.gutter}>
        {text.split('\n').map((_, index) => <span key={index}>{index + 1}</span>)}
      </div>
      <div className={styles.markdownContent}>
        {text.split('\n').map((line, index) => (
          <p key={index}>{line || '\u00a0'}</p>
        ))}
      </div>
    </div>
  );
}
