import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {QueryExample} from './databaseTypes';
import './QueryEditorExamples.module.css';

const styles = makeStyles('DatabaseQueryEditorExamples');

type QueryEditorExamplesProps = {
  examples: QueryExample[];
};

export function QueryEditorExamples({examples}: QueryEditorExamplesProps) {
  return (
    <div className={styles.root}>
      <div className={styles.scroll}>
        <div className={styles.stack}>
          {examples.map(example => (
            <div className={styles.card} key={example.title}>
              <div className={styles.cardBody}>
                <h4>{example.title}</h4>
                <p>{example.description}</p>
                <pre>{example.query}</pre>
              </div>
              <button className={styles.useButton} title="Use this example" type="button">
                <Icons.ArrowRight size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
