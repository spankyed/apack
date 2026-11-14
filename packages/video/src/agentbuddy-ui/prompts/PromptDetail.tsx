import {CollapsibleSection} from '../actions/CollapsibleSection';
import {NameSaveHeader} from '../actions/NameSaveHeader';
import {JsonSchemaEditor} from '../design/JsonSchemaEditor';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import {PromptInputsEditor} from './PromptInputsEditor';
import {PromptTemplateEditor} from './PromptTemplateEditor';
import type {PromptDetailState} from './promptTypes';
import './PromptDetail.module.css';

const styles = makeStyles('PromptDetail');

type PromptDetailProps = {
  state: PromptDetailState;
};

export function PromptDetail({state}: PromptDetailProps) {
  const isEditing = Boolean(state.prompt);
  const isValid = state.formData.label.trim() !== '' && state.formData.templateFn.trim() !== '';

  return (
    <div className={styles.root}>
      <NameSaveHeader isEditing={isEditing} isValid={isValid}>
        <input
          className={styles.nameInput}
          data-onboarding-id="prompt-name-input"
          placeholder="Enter prompt name"
          readOnly
          type="text"
          value={state.formData.label}
        />
        <select className={styles.categorySelect} value={state.formData.category ?? ''}>
          <option value="">No Category</option>
          {state.categories.map(category => (
            <option key={category.name} value={category.name}>{category.name}</option>
          ))}
        </select>
      </NameSaveHeader>

      <div className={styles.contentScroll}>
        <div className={styles.content}>
          <div className={styles.sectionFirst}>
            <CollapsibleSection label="Input Parameters" open={state.inputsExpanded ?? true}>
              <PromptInputsEditor expandedKeys={state.expandedInputKeys} inputs={state.formData.inputs} />
            </CollapsibleSection>
          </div>

          <div className={styles.section}>
            <div className={styles.templateLabelRow}>
              <label>
                Function Template <span>*</span>
              </label>
              {state.prompt ? (
                <button className={styles.openEditorButton} type="button">
                  <Icons.ExternalLink size={12} />
                  Open in editor
                </button>
              ) : null}
            </div>
            <p className={styles.templateInfo}>
              Write a JavaScript function body that returns a template string. The function will receive a `params` object with your defined inputs.
            </p>
            <PromptTemplateEditor value={state.formData.templateFn} />
          </div>

          <div className={styles.section}>
            <CollapsibleSection label="Output Schema (Optional)" open={state.outputExpanded ?? Boolean(state.formData.outputSchema)}>
              <JsonSchemaEditor value={state.formData.outputSchema} />
            </CollapsibleSection>
          </div>

          <div className={styles.section}>
            <CollapsibleSection label="Description" open={false}>
              <textarea
                className={styles.descriptionBox}
                placeholder="Describe what this prompt template does..."
                readOnly
                rows={3}
                value={state.formData.description ?? ''}
              />
            </CollapsibleSection>
          </div>

          <div className={styles.section}>
            <CollapsibleSection label="Metadata" open={state.metadataExpanded ?? true}>
              <div className={styles.metadata}>
                <span>ID <span className={styles.metadataMono}>{state.prompt?.id}</span></span>
                <span>Created <span className={styles.metadataValue}>{formatDate(state.prompt?.createdAt)}</span></span>
                <span>Updated <span className={styles.metadataValue}>{formatDate(state.prompt?.updatedAt)}</span></span>
              </div>
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDate(timestamp?: number) {
  if (!timestamp) return 'N/A';
  return new Date(timestamp).toLocaleString();
}
