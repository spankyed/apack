import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {PullRequestPanelState} from './codeTypes';
import './CreatePRForm.module.css';

const styles = makeStyles('CreatePRForm');

export function CreatePRForm({creating, state}: {creating?: boolean; state: PullRequestPanelState}) {
  return (
    <section className={styles.root}>
      <div className={styles.field}>
        <label>Title</label>
        <input className={styles.input} readOnly value={state.title} />
      </div>
      <div className={styles.bodyField}>
        <label>Description</label>
        <div className={styles.editor}>{state.body}</div>
      </div>
      <div className={styles.field}>
        <label>Merge into</label>
        <div className={styles.mergeRow}>
          <div className={styles.branchPill} title={state.headBranch}>
            <Icons.GitBranch size={11} />
            <span>{state.headBranch}</span>
          </div>
          <Icons.ArrowRight size={12} />
          <select className={styles.select} value={state.baseBranch}>
            <option>{state.baseBranch}</option>
          </select>
        </div>
      </div>
      <div className={styles.actions}>
        <button className={styles.primary} type="button">
          {creating ? <Icons.Loader2 size={12} /> : <Icons.PullRequest size={12} />}
          <span>{creating ? 'Creating PR' : 'Create PR'}</span>
        </button>
        <button className={styles.secondary} type="button">
          <Icons.FileEdit size={12} />
          <span>Create Draft</span>
        </button>
      </div>
    </section>
  );
}
