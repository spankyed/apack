import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {ChatAttachment} from './chatTypes';
import './ChatComposer.module.css';

const styles = makeStyles('ChatComposer');

// Mirrors packages/renderer/src/plugins/threads/chat/FileBlock.vue.
export function FileAttachment({attachment}: {attachment: ChatAttachment}) {
  return (
    <div className={styles.fileAttachment} title={attachment.label}>
      <span className={styles.fileIcon}>
        {attachment.previewUrl ? <img src={attachment.previewUrl} alt="" /> : <Icons.File size={20} />}
      </span>
      <span className={styles.fileText}>
        <span>{attachment.label}</span>
        <small>{attachment.typeLabel ?? 'Document'}</small>
      </span>
      <button className={styles.attachmentRemove} type="button" aria-label={`Remove ${attachment.label}`}>
        <Icons.X size={10} />
      </button>
    </div>
  );
}
