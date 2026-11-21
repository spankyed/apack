import type {CSSProperties} from 'react';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './NoteImageBlock.module.css';

const styles = makeStyles('NoteImageBlock');

export type NoteImageBlockState = {
  alt?: string;
  bubbleOpen?: boolean;
  resizeButtonPressed?: boolean;
  resizeOpen?: boolean;
  sliderPressed?: boolean;
  src: string;
  style?: CSSProperties;
  widthPercent: number;
};

// Mirrors the selected image styling plus packages/renderer/src/core/components/tiptap/TiptapImageBubbleMenu.vue.
export function NoteImageBlock({state}: {state: NoteImageBlockState}) {
  return (
    <div className={styles.wrap} style={state.style}>
      <div className={styles.imageFrame} data-selected={state.bubbleOpen || undefined} style={{width: `${state.widthPercent}%`}}>
        <img className={styles.image} alt={state.alt ?? ''} src={state.src} />
        {state.bubbleOpen ? (
          <div className={styles.bubble}>
            <div className={styles.bubbleActions}>
              <button title="View image" type="button"><Icons.Eye size={15} /></button>
              <button title="Copy image" type="button"><Icons.Copy size={15} /></button>
              <button className={state.resizeOpen ? styles.activeButton : undefined} data-pressed={state.resizeButtonPressed || undefined} title="Resize image" type="button"><Icons.Maximize2 size={15} /></button>
              <button className={styles.deleteButton} title="Delete image" type="button"><Icons.Trash2 size={15} /></button>
            </div>
            {state.resizeOpen ? (
              <div className={styles.resizeRow}>
                <input className={styles.slider} data-pressed={state.sliderPressed || undefined} max={100} min={25} readOnly step={5} type="range" value={state.widthPercent} />
                <span className={styles.widthLabel}>{state.widthPercent}%</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
