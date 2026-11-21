import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {ThreadConversation} from '../../agentbuddy-ui/threads/ThreadConversation';
import {Cursor} from '../overlays/Cursor';
import {chatShotViewForFrame} from '../state/chat';
import {Caret} from './Caret';
import {useAppWindowLayout} from '../appWindowLayout';

export function ChatShot({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const view = chatShotViewForFrame(frame);
  const layout = useAppWindowLayout({variant});
  return (
    <AppWindow activePlugin="threads" breadcrumbs={view.breadcrumbs} composer={view.composer} layout={layout}>
      <ThreadConversation
        assistant={view.conversation.assistant}
        createdAt={view.conversation.createdAt}
        systemMessage={view.conversation.systemMessage}
        userMessage={<>{view.conversation.userMessage.text}<Caret frame={frame} visible={view.conversation.userMessage.caretVisible} /></>}
      >
        <Cursor frame={frame} {...view.cursorPath} />
      </ThreadConversation>
    </AppWindow>
  );
}
