import type {ChatAttachment} from './chatTypes';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';
import {FileAttachment} from './FileAttachment';
import {ImageAttachment} from './ImageAttachment';
const styles = makeStyles('ChatComposer');

// Mirrors attachment strip behavior from packages/renderer/src/plugins/threads/chat/input.vue.
export function AttachmentStrip({attachments = []}: {attachments?: ChatAttachment[]}) {
  if (attachments.length === 0) return null;
  const images = attachments.filter(attachment => attachment.type === 'image');
  const files = attachments.filter(attachment => attachment.type === 'file');
  return (
    <div className={styles.attachmentStrip}>
      {images.map((attachment, index) => <ImageAttachment key={`image-${attachment.label}-${index}`} attachment={attachment} />)}
      {files.map((attachment, index) => <FileAttachment key={`file-${attachment.label}-${index}`} attachment={attachment} />)}
    </div>
  );
}
