import { _boundBackendHost } from '../runtime/backend-port.ts';

/** A Markdown article contributed by a pack. IDs are unique within that pack. */
export interface HelpDocument {
  id: string;
  title: string;
  body: string;
  features?: string[];
  order?: number;
}

/** An article in the app's catalog, qualified by its contributing pack. */
export interface HelpArticle extends HelpDocument {
  packId: string;
  packName: string;
}

export interface HelpProblem { packId: string; message: string }
export interface HelpCatalog { articles: HelpArticle[]; problems: HelpProblem[] }
export interface HelpTarget { packId?: string; articleId?: string; featureId?: string }

export function getPackHelp(): HelpCatalog {
  return _boundBackendHost().packs.help();
}
