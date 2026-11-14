import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './MessageReferences.module.css';

const styles = makeStyles('MessageReferences');

export type MessageReference = {
  isImage?: boolean;
  name: string;
  previewUrl?: string;
  typeLabel?: string;
};

// Mirrors the references/files/images strip in packages/renderer/src/plugins/threads/chat/message.vue.
export function MessageReferences({references}: {references: MessageReference[]}) {
  if (references.length === 0) return null;
  const images = references.filter(reference => reference.isImage);
  const files = references.filter(reference => !reference.isImage);

  return (
    <div className={styles.root}>
      {images.map(reference => <ImageReference key={reference.name} reference={reference} />)}
      {files.map(reference => <FileReference key={reference.name} reference={reference} />)}
    </div>
  );
}

function ImageReference({reference}: {reference: MessageReference}) {
  return (
    <div className={styles.image} title={reference.name}>
      {reference.previewUrl ? <img src={reference.previewUrl} alt="" /> : <span className={styles.imageFallback} />}
      <span className={styles.imageLabel}>{reference.name.replace(/\.[^.]+$/, '')}</span>
    </div>
  );
}

function FileReference({reference}: {reference: MessageReference}) {
  return (
    <div className={styles.file} title={reference.name}>
      <span className={styles.fileIcon}>
        <Icons.File size={20} />
      </span>
      <span className={styles.fileText}>
        <span>{reference.name}</span>
        <small>{reference.typeLabel ?? 'Document'}</small>
      </span>
    </div>
  );
}
