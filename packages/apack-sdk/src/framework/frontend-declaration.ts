/** Editor contribution identities and targets; implementations remain frontend bindings. */
export interface TextEditorExtensionsDeclaration {
  readOnly?: false | string;
  extensions?: Record<string, string>;
  popups?: Record<string, string>;
  isSuggestionActive?: string;
}

/** Frontend data shared by authored manifests, installed builds and native composition. */
export interface FrontendDeclaration {
  textEditor?: Record<string, TextEditorExtensionsDeclaration>;
  appExtensions?: Record<string, string>;
}
