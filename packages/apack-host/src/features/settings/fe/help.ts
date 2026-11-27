import type { Read } from '@apackdev/state';
import type { HelpCatalog, HelpTarget } from '@apackdev/sdk/framework';

interface HelpView {
  target: HelpTarget;
  query: string;
}

export interface HelpContext extends HelpView {
  catalog: HelpCatalog;
  history: HelpView[];
  loading: boolean;
}

export type HelpEvent =
  | { type: 'HELP_CATALOG'; catalog: HelpCatalog }
  | { type: 'HELP.OPEN'; target: HelpTarget }
  | { type: 'HELP.READ'; packId: string; articleId: string }
  | { type: 'HELP.BACK' }
  | { type: 'HELP.SEARCH'; query: string };

export function createHelpContext(): HelpContext {
  return { catalog: { articles: [], problems: [] }, target: {}, query: '', history: [], loading: true };
}

/** Help navigation stays with Settings; the catalog remains independent of persisted settings. */
export function reduceHelp(context: Read<HelpContext>, event: HelpEvent): Read<HelpContext> {
  const { target, query, history } = context;
  switch (event.type) {
    case 'HELP_CATALOG':
      return { ...context, catalog: event.catalog, loading: false };
    case 'HELP.OPEN':
      return { ...context, target: event.target, query: '', history: [] };
    case 'HELP.READ':
      return {
        ...context,
        target: { packId: event.packId, articleId: event.articleId,
          ...(target.packId === event.packId && target.featureId ? { featureId: target.featureId } : {}) },
        history: [...history, { target, query }],
      };
    case 'HELP.BACK':
      return { ...context, ...(history.at(-1) ?? { target: {}, query: '' }), history: history.slice(0, -1) };
    case 'HELP.SEARCH':
      return { ...context, query: event.query, target: target.featureId ? { packId: target.packId, featureId: target.featureId } : {}, history: [] };
  }
}
