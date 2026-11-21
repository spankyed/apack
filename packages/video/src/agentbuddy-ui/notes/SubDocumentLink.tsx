import {cx} from '../primitives/classNames';
import './SubDocumentLink.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('SubDocumentLink');

// Mirrors packages/renderer/src/core/components/tiptap/sub-document-link.ts
// and the .sub-document-link styles in tiptap-theme.css.
export function SubDocumentLink({icon, noteId, selected, title}: {icon?: string | null; noteId?: string; selected?: boolean; title: string}) {
  return (
    <div className={cx(styles.root, selected && styles.selected)} data-note-id={noteId}>
      <span className={styles.icon}>{icon ? icon : <SubDocumentFallbackIcon />}</span>
      <span className={styles.title}>{title}</span>
    </div>
  );
}

function SubDocumentFallbackIcon() {
  return (
    <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

export function parseSubDocumentHref(href: string) {
  if (!href.startsWith('document://')) return null;
  const url = href.slice('document://'.length);
  const queryIndex = url.indexOf('?icon=');
  const noteId = queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  const icon = queryIndex >= 0 ? decodeURIComponent(url.slice(queryIndex + 6)) : null;
  return {icon, noteId};
}
