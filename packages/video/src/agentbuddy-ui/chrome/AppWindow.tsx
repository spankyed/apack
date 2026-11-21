import type {CSSProperties, ReactNode} from 'react';
import type {ChatComposerState} from '../chat/chatTypes';
import {ChatComposer} from '../chat/ChatComposer';
import {CanvasHeader} from './CanvasHeader';
import {Toolbar, type PluginId} from './Toolbar';
import {WindowTrafficLights} from './WindowTrafficLights';
import './AppWindow.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('AppWindow');

export type AppWindowLayout = {
  gridStyle: CSSProperties;
  showRightRail: boolean;
  windowStyle: CSSProperties;
};

type AppWindowProps = {
  activePlugin: PluginId;
  breadcrumbs: string[];
  children: ReactNode;
  composer?: ChatComposerState | false;
  layout: AppWindowLayout;
  rightRail?: ReactNode;
  title?: string;
};

export function AppWindow({activePlugin, breadcrumbs, children, composer, layout, rightRail, title}: AppWindowProps) {
  return (
    <div className={styles.window} style={layout.windowStyle}>
      <WindowTrafficLights />
      <div className={styles.grid} style={layout.gridStyle}>
        <Toolbar activePlugin={activePlugin} />
        <main className={styles.main}>
          <CanvasHeader breadcrumbs={breadcrumbs} title={title} />
          <section className={styles.surface}>{children}</section>
          {composer === false || composer == null ? null : <ChatComposer state={composer} />}
        </main>
        {rightRail && layout.showRightRail ? <aside className={styles.rightRail}>{rightRail}</aside> : null}
      </div>
    </div>
  );
}
