import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {PullRequestPanelState, PullRequestReviewThreadState} from './codeTypes';
import './PRComments.module.css';

const styles = makeStyles('PRComments');

export function PRComments({state}: {state: PullRequestPanelState}) {
  const comments = state.comments ?? [];
  const reviewThreads = state.reviewThreads ?? [];
  const tab = state.selectedCommentTab ?? 'discussion';
  const isOpen = state.createdPr?.state === 'OPEN';

  return (
    <section className={styles.root}>
      <div className={styles.tabs}>
        <button className={tab === 'discussion' ? styles.activeTab : undefined} type="button">
          <Icons.MessageSquare size={12} />
          <span>Discussion</span>
          {comments.length ? <span className={styles.count}>({comments.length})</span> : null}
        </button>
        <button className={tab === 'reviews' ? styles.activeTab : undefined} type="button">
          <Icons.Code size={12} />
          <span>Reviews</span>
          {reviewThreads.length ? <span className={styles.count}>({reviewThreads.length})</span> : null}
        </button>
      </div>

      {tab === 'reviews' ? (
        <ReviewThreads reviewThreads={reviewThreads} />
      ) : (
        <Discussion comments={comments} isOpen={isOpen} />
      )}
    </section>
  );
}

function Discussion({
  comments,
  isOpen,
}: {
  comments: NonNullable<PullRequestPanelState['comments']>;
  isOpen: boolean;
}) {
  return (
    <div className={styles.panel}>
      {comments.length === 0 && !isOpen ? <div className={styles.empty}>No comments yet.</div> : null}
      {comments.map(comment => (
        <article className={styles.commentCard} key={comment.id}>
          <header>
            <strong>{comment.authorName}</strong>
            <span>{comment.createdAt}</span>
            {comment.viewerDidAuthor ? (
              <div className={styles.commentActions}>
                <button title="Edit" type="button"><Icons.Pencil size={10} /></button>
                <button title="Delete" type="button"><Icons.Trash2 size={10} /></button>
              </div>
            ) : null}
          </header>
          <div className={styles.commentBody}>{comment.body}</div>
        </article>
      ))}
      {isOpen ? (
        <div className={styles.commentInput}>
          <span>Write a comment...</span>
          <button type="button">Comment</button>
        </div>
      ) : null}
    </div>
  );
}

function ReviewThreads({reviewThreads}: {reviewThreads: NonNullable<PullRequestPanelState['reviewThreads']>}) {
  return (
    <div className={styles.panel}>
      {reviewThreads.length === 0 ? <div className={styles.empty}>No review comments.</div> : null}
      {reviewThreads.map(thread => <ReviewThread key={thread.id} thread={thread} />)}
    </div>
  );
}

function ReviewThread({thread}: {thread: PullRequestReviewThreadState}) {
  return (
    <article className={styles.reviewThread}>
      <header>
        <Icons.ChevronRight className={styles.expandedChevron} size={11} />
        <div>
          <strong title={thread.path}>{thread.path}</strong>
          <span>{thread.location}</span>
        </div>
        <em data-resolved={thread.isResolved ? 'true' : undefined}>
          {thread.isResolved ? 'Resolved' : 'Unresolved'}
        </em>
      </header>
      {thread.diffLines?.length ? (
        <pre className={styles.diffBlock}>
          {thread.diffLines.map((line, index) => (
            <span data-kind={line.kind} key={`${line.text}-${index}`}>{line.text}</span>
          ))}
        </pre>
      ) : null}
      {thread.comments.map((comment, index) => (
        <div className={styles.reviewComment} data-divider={index > 0 ? 'true' : undefined} key={comment.id}>
          <div className={styles.reviewCommentHeader}>
            <strong>{comment.authorName}</strong>
            <span>{comment.createdAt}</span>
          </div>
          <div className={styles.commentBody}>{comment.body}</div>
        </div>
      ))}
      <footer>
        <button type="button">Reply</button>
        <span />
        <button className={thread.isResolved ? styles.unresolveButton : styles.resolveButton} type="button">
          {thread.isResolved ? 'Unresolve' : 'Resolve'}
        </button>
      </footer>
    </article>
  );
}
