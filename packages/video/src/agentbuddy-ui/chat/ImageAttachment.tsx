import type {ChatImageAttachment} from './chatTypes';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './ChatComposer.module.css';

const styles = makeStyles('ChatComposer');

// Mirrors packages/renderer/src/plugins/threads/chat/ImageThumbnail.vue.
export function ImageAttachment({attachment}: {attachment: ChatImageAttachment}) {
  return (
    <div className={styles.imageAttachment} style={attachment.style} title={attachment.label}>
      <img className={styles.imageAttachmentPreview} src={attachment.previewUrl} alt="" />
      <span className={styles.imageLabel}>{attachment.label.replace(/\.[^.]+$/, '')}</span>
      <button className={styles.attachmentRemove} type="button" aria-label={`Remove ${attachment.label}`}>
        <Icons.X size={10} />
      </button>
    </div>
  );
}
