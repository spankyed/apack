import { state, type Value } from '@apackdev/state';
import { entityTypeOf, type SurfaceEvent } from '@apackdev/sdk/fe';
import type { EARS } from '@apackdev/sdk';
import { newCall, type OpenEntity } from '@apackdev/sdk/events';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { isEqual } from '../../settings/document.ts';
import {
  selectEntityDestination,
  getEligibleSurface,
  type EntityDestinationSelection,
  type ShellSurfaceCatalog,
} from '../../../fe/surface-selection.ts';
import type { SurfaceFrontendBinding } from '../../../fe/pack-store.ts';
import type { SurfaceCatalogEntry } from '../../../packs/catalog.ts';
import type { ShellClient } from '../../../fe/client.ts';

export const ENTITY_OPENING_ID = 'entity-opening';

export interface EntityOpenRequest {
  readonly id: EARS.EntityId;
  readonly token: string;
  readonly target?: {
    readonly declaration: SurfaceCatalogEntry;
    readonly binding?: SurfaceFrontendBinding;
  };
}

export type EntityOpeningEvent =
  | OpenEntity
  | { type: 'CANCEL' }
  | { type: 'CHANGED' }
  | { type: 'UNLOADED'; packId: string }
  | { type: 'RUNTIMES_UPDATED'; runtimes: Record<string, string> }
  | { type: 'READY'; token: string }
  | { type: 'DELIVER'; token: string }
  | { type: 'REFUSED'; token: string; detail: string };

export type EntityOpeningReport =
  | { type: 'ENTITY_OPEN_FINISHED'; token: string }
  | { type: 'OPEN_SURFACE'; surface: string; events: SurfaceEvent[]; entityToken: string };

export type EntityOpeningShape = {
  data: {
    request: EntityOpenRequest | null;
  };
  reports: EntityOpeningReport;
  states: {
    idle: {};
    catalog: {};
    checking: {};
    waiting: {};
  };
};

export interface EntityOpeningOptions {
  client: ShellClient;
  catalog: ShellSurfaceCatalog;
  bindings(): ReadonlyMap<string, SurfaceFrontendBinding>;
  isConnected(): boolean;
  hasSurface(surfaceRef: string): boolean;
  deliverEntity(surfaceRef: string, event: OpenEntity): void;
  refuse(title: string, detail: string): void;
}

function destinationDetail(selection: EntityDestinationSelection): string {
  switch (selection.status) {
    case 'disabled': return `The destination is disabled: ${selection.destinations.map((entry) => entry.featureRef).join(', ')}.`;
    case 'ambiguous': return `Multiple destinations claim this entity: ${selection.destinations.map((entry) => entry.featureRef).join(', ')}.`;
    case 'unclaimed': return 'No enabled feature declares that it opens this entity type.';
    default: return 'Entity destinations are unavailable.';
  }
}

export function destinationProblem(
  options: Pick<EntityOpeningOptions, 'catalog' | 'bindings'>,
  request: EntityOpenRequest,
): string | undefined {
  const selection = selectEntityDestination(options.catalog, entityTypeOf(request.id));
  if (selection.status !== 'declared') return destinationDetail(selection);
  if (request.target && (!isEqual(selection.destination, request.target.declaration)
    || (request.target.binding && options.bindings().get(selection.destination.featureRef) !== request.target.binding))) {
    return 'The destination changed while this entity was opening. Open it again.';
  }
}

/** One owner from intent to delivery; the shell readiness queue carries only its token. */
export function createEntityOpeningState(options: EntityOpeningOptions) {
  const { client, catalog, bindings } = options;
  const refuse = (request: EntityOpenRequest | null, detail: string) => {
    if (request) options.refuse(`Couldn't open ${request.id}`, detail);
  };

  return state<EntityOpeningShape, EntityOpeningEvent>()({
    initial: 'idle',
    data: {
      request: null,
    },
    on: {
      OPEN_ENTITY: (event, { data, report }) => {
        if (data.request) report({ type: 'ENTITY_OPEN_FINISHED', token: data.request.token });
        const request: EntityOpenRequest = { id: event.id, token: newCall() };
        if (typeof request.id !== 'string' || !request.id.includes('-')) {
          refuse(request, 'The entity ID is invalid.');
          report({ type: 'ENTITY_OPEN_FINISHED', token: request.token });
          return { at: 'idle', data: { request: null } };
        }
        if (!options.isConnected()) {
          refuse(request, 'The app is disconnected.');
          report({ type: 'ENTITY_OPEN_FINISHED', token: request.token });
          return { at: 'idle', data: { request: null } };
        }
        if (catalog.status() === 'loading') {
          return { at: 'catalog', data: { request } };
        }
        const problem = destinationProblem(options, request);
        if (problem) {
          refuse(request, problem);
          report({ type: 'ENTITY_OPEN_FINISHED', token: request.token });
          return { at: 'idle', data: { request: null } };
        }
        const selection = selectEntityDestination(catalog, entityTypeOf(request.id));
        if (selection.status !== 'declared') throw new Error('Entity destination was not resolved');
        const declaration = selection.destination;
        const binding = getEligibleSurface(catalog, bindings(), declaration.featureRef)
          ? bindings().get(declaration.featureRef)
          : undefined;
        return {
          at: 'checking',
          data: { request: { ...request, target: { declaration, binding } } },
        };
      },
      CANCEL: (_event, { data, report }) => {
        if (data.request) report({ type: 'ENTITY_OPEN_FINISHED', token: data.request.token });
        return { at: 'idle', data: { request: null } };
      },
      REFUSED: (event, { data, report }) => {
        if (!data.request || data.request.token !== event.token) return;
        refuse(data.request, event.detail);
        report({ type: 'ENTITY_OPEN_FINISHED', token: data.request.token });
        return { at: 'idle', data: { request: null } };
      },
      UNLOADED: (event, { data, report }) => {
        if (data.request?.target?.declaration.packId !== event.packId) return;
        refuse(data.request, 'Its destination was unloaded.');
        report({ type: 'ENTITY_OPEN_FINISHED', token: data.request.token });
        return { at: 'idle', data: { request: null } };
      },
      RUNTIMES_UPDATED: (event, { data, report }) => {
        const binding = data.request?.target?.binding;
        if (!binding?.registrationId || event.runtimes[binding.packId] === binding.registrationId) return;
        refuse(data.request, 'Its destination was replaced. Open it again.');
        report({ type: 'ENTITY_OPEN_FINISHED', token: data.request!.token });
        return { at: 'idle', data: { request: null } };
      },
      CHANGED: (_event, { data, report }) => {
        if (!data.request?.target) return;
        const problem = destinationProblem(options, data.request);
        if (!problem) return;
        refuse(data.request, problem);
        report({ type: 'ENTITY_OPEN_FINISHED', token: data.request.token });
        return { at: 'idle', data: { request: null } };
      },
    },
    states: {
      idle: {},
      catalog: {
        on: {
          CHANGED: (_event, { data, report }) => {
            const request = data.request;
            if (!request) return { at: 'idle', data: { request: null } };
            if (!options.isConnected()) {
              refuse(request, 'The app is disconnected.');
              report({ type: 'ENTITY_OPEN_FINISHED', token: request.token });
              return { at: 'idle', data: { request: null } };
            }
            if (catalog.status() === 'loading') return;
            const problem = destinationProblem(options, request);
            if (problem) {
              refuse(request, problem);
              report({ type: 'ENTITY_OPEN_FINISHED', token: request.token });
              return { at: 'idle', data: { request: null } };
            }
            const selection = selectEntityDestination(catalog, entityTypeOf(request.id));
            if (selection.status !== 'declared') throw new Error('Entity destination was not resolved');
            const declaration = selection.destination;
            const binding = getEligibleSurface(catalog, bindings(), declaration.featureRef)
              ? bindings().get(declaration.featureRef)
              : undefined;
            return {
              at: 'checking',
              data: { request: { ...request, target: { declaration, binding } } },
            };
          },
        },
      },
      checking: {
        run: async ({ data, signal, report }) => {
          const request = data.request;
          if (!request) return { at: 'idle', data: { request: null } };
          const exists = await client.entityExists(request.id, signal);
          if (signal.aborted) return;
          if (!exists) {
            refuse(request, 'This entity no longer exists or is in the trash.');
            report({ type: 'ENTITY_OPEN_FINISHED', token: request.token });
            return { at: 'idle', data: { request: null } };
          }
          return { at: 'waiting' };
        },
        failed: (error, { data, report }) => {
          const request = data.request;
          refuse(request, errorMessage(error));
          if (request) report({ type: 'ENTITY_OPEN_FINISHED', token: request.token });
          return { at: 'idle', data: { request: null } };
        },
      },
      waiting: {
        run: ({ data, report }) => {
          const request = data.request;
          if (!request?.target) return;
          report({
            type: 'OPEN_SURFACE',
            surface: request.target.declaration.featureRef,
            events: [],
            entityToken: request.token,
          });
        },
        on: {
          READY: (event, { data, report }) => {
            const request = data.request;
            if (!request || request.token !== event.token) return;
            const problem = destinationProblem(options, request);
            if (problem) {
              refuse(request, problem);
              report({ type: 'ENTITY_OPEN_FINISHED', token: request.token });
              return { at: 'idle', data: { request: null } };
            }
            return {
              data: {
                request: {
                  ...request,
                  target: {
                    ...request.target!,
                    binding: request.target!.binding ?? bindings().get(request.target!.declaration.featureRef),
                  },
                },
              },
            };
          },
          DELIVER: (event, { data, report }) => {
            const request = data.request;
            if (!request || request.token !== event.token) return;
            const surface = request.target!.declaration.featureRef;
            const problem = destinationProblem(options, request)
              ?? (!getEligibleSurface(catalog, bindings(), surface) ? `The surface "${surface}" is no longer ready.` : undefined)
              ?? (!options.hasSurface(surface) ? `The destination actor "${surface}" is no longer available.` : undefined);
            if (problem) refuse(request, problem);
            else options.deliverEntity(surface, { type: 'OPEN_ENTITY', id: request.id });
            report({ type: 'ENTITY_OPEN_FINISHED', token: request.token });
            return { at: 'idle', data: { request: null } };
          },
        },
      },
    },
  });
}

export type EntityOpeningState = ReturnType<typeof createEntityOpeningState>;

/** Queue admission reads the owner's current request; it never captures another request copy. */
export function checkEntityOpening(
  opening: Value<EntityOpeningShape> | undefined,
  token: string,
  options: Pick<EntityOpeningOptions, 'catalog' | 'bindings'>,
): { current: false } | { current: true; problem?: string } {
  const request = opening?.data.request ?? null;
  return request?.token === token ? { current: true, problem: destinationProblem(options, request) } : { current: false };
}
