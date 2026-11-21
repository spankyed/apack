import {Icons} from '../primitives/Icon';
import {TextCaret} from '../primitives/TextCaret';
import {makeStyles} from '../primitives/makeStyles';
import './ThreadCreateForm.module.css';

const styles = makeStyles('ThreadCreateForm');

export type ThreadCreateFormState = {
  createPressed?: boolean;
  instructions: string;
  instructionsCaretVisible?: boolean;
  linkPressed?: boolean;
  linkedThreadsOpen?: boolean;
  linkInputVisible?: boolean;
  linkedThreadQuery?: string;
  linkedThreadCandidate?: {
    shortCode?: string;
    relation: string;
    status: string;
    tags: string[];
    title: string;
  };
  parentThread?: {
    shortCode?: string;
    relation: string;
    status: string;
    tags: string[];
    title: string;
  };
  tags?: string[];
  tagsOpen?: boolean;
  title: string;
  titleCaretVisible?: boolean;
};

// Mirrors packages/renderer/src/plugins/threads/canvas/ThreadDetail.vue in create mode.
export function ThreadCreateForm({state}: {state: ThreadCreateFormState}) {
  const valid = state.title.trim().length > 0 && Boolean(state.parentThread);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.back} type="button"><Icons.ArrowLeft size={15} /><span>Back</span></button>
          <span className={styles.headerLabel}>Title</span>
        </div>
        <div className={styles.headerCenter}>
          <div className={styles.titleInput} data-onboarding-id="thread-topic-input">
            {!state.title && state.titleCaretVisible ? <TextCaret leading /> : null}
            <span className={state.title ? styles.titleInputText : styles.titleInputPlaceholder}>{state.title || 'Enter thread topic'}</span>
            {state.title && state.titleCaretVisible ? <TextCaret /> : null}
          </div>
          <select className={styles.statusSelect} disabled value="Backlog">
            <option>Backlog</option>
          </select>
        </div>
        <div className={styles.headerRight}>
          <button className={valid ? styles.saveButton : styles.saveButtonDisabled} data-onboarding-id="thread-create-save-button" data-pressed={state.createPressed || undefined} type="button">
            Create
          </button>
        </div>
      </header>

      <div className={styles.scroller}>
        <div className={styles.content}>
          <section data-onboarding-id="thread-instructions-input">
            <label className={styles.sectionLabel}>Instructions</label>
            <div className={styles.editor}>
              <div className={styles.gutter}>1</div>
              <div className={state.instructions ? styles.editorText : styles.editorPlaceholder}>
                {!state.instructions && state.instructionsCaretVisible ? <TextCaret leading /> : null}
                {state.instructions || 'Enter instructions for the agent'}
                {state.instructions && state.instructionsCaretVisible ? <TextCaret /> : null}
              </div>
            </div>
          </section>

          <section className={styles.collapsible}>
            <div className={styles.collapsibleHeader}>
              <div className={styles.sectionSummary}>
                <Icons.ChevronRight className={styles.sectionChevron} data-open={state.tagsOpen || undefined} size={14} />
                <span>Tags</span>
              </div>
              {state.tags?.length ? (
                <div className={styles.tags}>
                  {state.tags.map(tag => <span className={styles.tag} key={tag}>{tag}</span>)}
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.linkedSection}>
            <div className={styles.linkedHeader}>
              <div className={styles.sectionSummary}>
                <Icons.ChevronRight className={styles.sectionChevron} data-open={state.linkedThreadsOpen || undefined} size={14} />
                <span>Linked Threads ({state.parentThread ? 1 : 0})</span>
              </div>
              <button data-onboarding-id="thread-linked-section" type="button">
                <Icons.Link size={14} />
                Link Thread
              </button>
            </div>
            {state.linkedThreadsOpen ? <LinkedThreads state={state} /> : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function LinkedThreads({state}: {state: ThreadCreateFormState}) {
  if (!state.parentThread && !state.linkInputVisible) return null;

  return (
    <div className={styles.linkedTableWrap}>
      <table className={styles.linkedTable}>
        <colgroup>
          <col className={styles.removeCol} />
          <col className={styles.relationCol} />
          <col className={styles.labelCol} />
          <col className={styles.tagsCol} />
          <col className={styles.statusCol} />
        </colgroup>
        {state.parentThread ? (
          <thead>
            <tr>
              <th />
              <th>Relation</th>
              <th>Label</th>
              <th>Tags</th>
              <th>Status</th>
            </tr>
          </thead>
        ) : null}
        <tbody>
          {state.parentThread ? (
            <tr>
              <td><button className={styles.iconOnly} type="button"><Icons.X size={14} /></button></td>
              <td><span className={styles.relation}>{state.parentThread.relation}</span></td>
              <td>
                <div className={styles.threadTitleCell}>
                  <span className={styles.statusDot} />
                  <span className={styles.threadTitle}>{state.parentThread.title}</span>
                </div>
              </td>
              <td>
                <div className={styles.tags}>{state.parentThread.tags.map(tag => <span className={styles.tag} key={tag}>{tag}</span>)}</div>
              </td>
              <td><span className={styles.status}>{state.parentThread.status}</span></td>
            </tr>
          ) : null}
          {state.linkInputVisible ? (
            <tr className={styles.inputRow}>
              <td><button className={styles.iconOnly} type="button"><Icons.X size={14} /></button></td>
              <td>
                <select className={styles.relationSelect} value="parent_of" disabled>
                  <option>parent_of</option>
                </select>
              </td>
              <td colSpan={2}>
                <div className={styles.combobox}>
                  <div className={styles.threadSearch}>{state.linkedThreadQuery || 'Search for threads...'}</div>
                  {state.linkedThreadCandidate ? (
                    <div className={styles.comboboxContent}>
                      <div className={styles.comboboxViewport}>
                        <div className={styles.comboboxItem} data-highlighted="true">
                          <span>{state.linkedThreadCandidate.title || 'Untitled thread...'}</span>
                          {state.linkedThreadCandidate.shortCode ? <small>{state.linkedThreadCandidate.shortCode}</small> : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </td>
              <td className={styles.inputActionsCell}>
                <div className={styles.linkActions}>
                  <button className={styles.linkButton} data-pressed={state.linkPressed || undefined} type="button">Link</button>
                  <button className={styles.cancelButton} type="button">Cancel</button>
                </div>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
