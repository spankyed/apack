import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './MessageReferences.module.css';

const styles = makeStyles('MessageReferences');

export type MessageFileReference = {
  isImage?: boolean;
  name: string;
  path?: string;
  previewUrl?: string;
  typeLabel?: string;
};

export type MessageImageReference = {
  name: string;
  url: string;
};

export type MessageReferencesState = {
  files?: MessageFileReference[];
  images?: MessageImageReference[];
};

// Mirrors the references/files/images strip in packages/renderer/src/plugins/threads/chat/message.vue.
export function MessageReferences({references}: {references?: MessageReferencesState}) {
  const images = references?.images ?? [];
  const files = references?.files ?? [];
  if (images.length === 0 && files.length === 0) return null;

  return (
    <div className={styles.root}>
      {images.map(reference => <ImageReference key={reference.name} reference={reference} />)}
      {files.map(reference => <FileReference key={reference.name} reference={reference} />)}
    </div>
  );
}

function ImageReference({reference}: {reference: MessageImageReference}) {
  return (
    <div className={styles.image} title={reference.name}>
      <img src={reference.url} alt="" />
      <span className={styles.imageLabel}>{reference.name.replace(/\.[^.]+$/, '')}</span>
    </div>
  );
}

function FileReference({reference}: {reference: MessageFileReference}) {
  const canShowPreview = Boolean(reference.isImage && reference.previewUrl);
  return (
    <div className={styles.file} title={reference.name}>
      <span className={styles.fileIcon}>
        {canShowPreview ? <img src={reference.previewUrl} alt="" /> : <Icons.File size={20} />}
      </span>
      <span className={styles.fileText}>
        <span>{reference.name}</span>
        <small>{reference.typeLabel ?? ''}</small>
      </span>
    </div>
  );
}
