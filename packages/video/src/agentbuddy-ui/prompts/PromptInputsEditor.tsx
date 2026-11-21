import {ParameterRow} from '../actions/ParameterRow';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {TemplateInput} from './promptTypes';
import './PromptInputsEditor.module.css';

const styles = makeStyles('PromptInputsEditor');

type PromptInputsEditorProps = {
  inputs: Record<string, TemplateInput>;
};

export function PromptInputsEditor({inputs}: PromptInputsEditorProps) {
  const entries = Object.entries(inputs);
  return (
    <div className={styles.root}>
      {entries.map(([key, input]) => (
        <ParameterRow
          expanded={false}
          key={key}
          parameter={{
            description: input.description,
            required: input.required,
            type: input.type,
          }}
          paramKey={input.name}
        />
      ))}
      <button className={styles.addButton} data-onboarding-id="prompt-inputs-add" type="button">
        <Icons.Plus size={16} />
        Add Parameter
      </button>
    </div>
  );
}
