import type {CSSProperties, ReactNode} from 'react';
import './NoteEditor.module.css';
import {makeStyles} from '../primitives/makeStyles';
import {NoteImageBlock, type NoteImageBlockState} from './NoteImageBlock';
import {NoteTitleRow} from './NoteTitleRow';
const styles = makeStyles('NoteEditor');

type NoteEditorProps = {
  afterLines: ReactNode[];
  beforeLines: ReactNode[];
  image?: NoteImageBlockState;
  style?: CSSProperties;
  title: {
    icon: string;
    text: string;
  };
};

export function NoteEditor({afterLines, beforeLines, image, style, title}: NoteEditorProps) {
  return (
    <article className={styles.root} style={style}>
      <div className={styles.scroller}>
        <NoteTitleRow icon={title.icon} title={title.text} />
        <div className={styles.editor}>
          <ul className={styles.list}>{beforeLines.map((line, index) => <li key={index}>{line}</li>)}</ul>
          {image ? <NoteImageBlock state={image} /> : null}
          <div className={styles.rule} />
          <ul className={`${styles.list} ${styles.connected}`}>{afterLines.map((line, index) => <li key={index}>{line}</li>)}</ul>
        </div>
      </div>
    </article>
  );
}
