import {useCurrentFrame} from 'remotion';
import type {PromptsSurfaceState} from '../../agentbuddy-ui/prompts/promptTypes';
import {PromptsSurface} from '../../agentbuddy-ui/prompts/PromptsSurface';
import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {
  promptCreateState,
  promptCollapsedSectionsState,
  promptDetailState,
  promptsEmptyState,
  promptsFilteredState,
  promptsListState,
  promptsLoadingMoreState,
  promptsSurfaceStateForFrame,
} from '../../film/state/prompts';

function PromptsDemoWindow({state = promptsListState}: {state?: PromptsSurfaceState}) {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="prompts" breadcrumbs={['PROMPTS']} composer={false} layout={layout}>
        <PromptsSurface state={state} />
      </AppWindow>
    </SurfaceFrame>
  );
}

export const PromptsListDemo = () => <PromptsDemoWindow state={promptsListState} />;

export const PromptsEmptyDemo = () => <PromptsDemoWindow state={promptsEmptyState} />;

export const PromptsFilteredDemo = () => <PromptsDemoWindow state={promptsFilteredState} />;

export const PromptsLoadingMoreDemo = () => <PromptsDemoWindow state={promptsLoadingMoreState} />;

export const PromptCreateDemo = () => <PromptsDemoWindow state={promptCreateState} />;

export const PromptDetailDemo = () => <PromptsDemoWindow state={promptDetailState} />;

export const PromptCollapsedSectionsDemo = () => <PromptsDemoWindow state={promptCollapsedSectionsState} />;

export const PromptsSurfaceDemo = () => {
  const frame = useCurrentFrame();
  return <PromptsDemoWindow state={promptsSurfaceStateForFrame(frame)} />;
};
