import type { ComponentTarget } from './surface-declaration.ts';

/** Editor contribution identities and targets; implementations remain frontend bindings. */
export interface TextEditorExtensionsDeclaration {
  extensions?: Record<string, string>;
  popups?: Record<string, ComponentTarget>;
  isSuggestionActive?: string;
}

/** Frontend data shared by authored manifests, installed builds and native composition. */
export interface FrontendDeclaration {
  textEditor?: Record<string, TextEditorExtensionsDeclaration>;
  appExtensions?: Record<string, ComponentTarget>;
}
