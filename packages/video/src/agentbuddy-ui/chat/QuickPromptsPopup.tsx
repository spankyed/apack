import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './QuickPromptsPopup.module.css';

const styles = makeStyles('QuickPromptsPopup');

type QuickPromptsPopupProps = {
  editing?: boolean;
  editingId?: string;
  editingText?: string;
  newPromptText?: string;
  prompts: Array<{
    id: string;
    text: string;
  }>;
  selectedIndex?: number;
};

// Mirrors packages/renderer/src/plugins/threads/chat/QuickPromptsPopup.vue.
export function QuickPromptsPopup({editing, editingId, editingText, newPromptText, prompts, selectedIndex}: QuickPromptsPopupProps) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span>Quick Prompts</span>
        <button className={editing ? styles.editButtonActive : undefined} type="button"><Icons.Pencil size={14} /></button>
      </div>
      <div className={editing ? `${styles.list} quick-prompts-list` : styles.list}>
        {editing ? (
          prompts.map(prompt => (
            <div className={styles.editItem} key={prompt.id}>
              <span className={styles.dragHandle} data-handle title="Drag to reorder"><Icons.GripVertical className={styles.pointerEventsNone} size={12} /></span>
              {editingId === prompt.id ? (
                <textarea className={styles.editTextarea} readOnly rows={1} value={editingText ?? prompt.text} />
              ) : (
                <span className={styles.editText} title={prompt.text}>
                  {prompt.text.split('\n')[0]}{prompt.text.includes('\n') ? <span className={styles.ellipsis}>...</span> : null}
                </span>
              )}
              <button className={styles.deleteButton} type="button"><Icons.X size={14} /></button>
            </div>
          ))
        ) : prompts.length ? (
          prompts.map((prompt, index) => (
            <div className={index === selectedIndex ? styles.itemActive : styles.item} key={prompt.id}>
              <button data-prompt-id={prompt.id} title={prompt.text} type="button">
                <span className={styles.index}>{index + 1}</span>
                <span className={styles.text}>
                  {prompt.text.split('\n')[0]}
                  {prompt.text.includes('\n') ? <span className={styles.ellipsis}>...</span> : null}
                </span>
              </button>
              <button className={styles.copy} title="Copy prompt" type="button"><Icons.Copy size={14} /></button>
            </div>
          ))
        ) : <div className={styles.empty}>No quick prompts</div>}
      </div>
      {editing ? (
        <div className={styles.addPrompt}>
          <textarea placeholder="Add prompt..." readOnly rows={1} value={newPromptText ?? ''} />
          <button className={newPromptText?.trim() ? styles.addButtonReady : styles.addButtonDisabled} disabled={!newPromptText?.trim()} type="button"><Icons.Plus size={14} /></button>
        </div>
      ) : null}
    </div>
  );
}
