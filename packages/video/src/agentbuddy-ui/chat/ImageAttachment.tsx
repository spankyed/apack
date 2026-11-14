import type {ChatAttachment} from './chatTypes';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './ChatComposer.module.css';

const styles = makeStyles('ChatComposer');

// Mirrors packages/renderer/src/plugins/threads/chat/ImageThumbnail.vue.
export function ImageAttachment({attachment}: {attachment: ChatAttachment}) {
  return (
    <div className={styles.imageAttachment} title={attachment.label}>
      {attachment.previewUrl ? <img src={attachment.previewUrl} alt="" /> : <span className={styles.imageFallback} />}
      <span className={styles.imageLabel}>{attachment.label.replace(/\.[^.]+$/, '')}</span>
      <button className={styles.attachmentRemove} type="button" aria-label={`Remove ${attachment.label}`}>
        <Icons.X size={10} />
      </button>
    </div>
  );
}
