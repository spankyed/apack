import type {ChatAttachment} from './chatTypes';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';
import {FileAttachment} from './FileAttachment';
import {ImageAttachment} from './ImageAttachment';
const styles = makeStyles('ChatComposer');

// Mirrors attachment strip behavior from packages/renderer/src/plugins/threads/chat/input.vue.
export function AttachmentStrip({attachments = []}: {attachments?: ChatAttachment[]}) {
  if (attachments.length === 0) return null;
  return (
    <div className={styles.attachmentStrip}>
      {attachments.map((attachment, index) => (
        attachment.type === 'image' ? (
          <ImageAttachment key={`${attachment.label}-${index}`} attachment={attachment} />
        ) : (
          <FileAttachment key={`${attachment.label}-${index}`} attachment={attachment} />
        )
      ))}
    </div>
  );
}
