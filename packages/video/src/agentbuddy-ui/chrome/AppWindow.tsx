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
  chromeOpacity?: number;
  composer?: ChatComposerState | false;
  frameOpacity?: number;
  headerOpacity?: number;
  layout: AppWindowLayout;
  mainBackground?: string;
  rightRail?: ReactNode;
  surfaceBackground?: string;
  title?: string;
};

export function AppWindow({
  activePlugin,
  breadcrumbs,
  children,
  chromeOpacity = 1,
  composer,
  frameOpacity = 1,
  headerOpacity = chromeOpacity,
  layout,
  mainBackground,
  rightRail,
  surfaceBackground,
  title,
}: AppWindowProps) {
  return (
    <div
      className={styles.window}
      style={{
        ...layout.windowStyle,
        backgroundColor: `rgb(23 23 23 / ${frameOpacity})`,
        borderColor: `rgb(64 64 64 / ${0.65 * frameOpacity})`,
        borderRadius: `${0.5 * frameOpacity}rem`,
        boxShadow: `0 48px 150px rgb(0 0 0 / ${0.58 * frameOpacity})`,
      }}
    >
      <div className={styles.trafficLayer} style={{opacity: chromeOpacity}}>
        <WindowTrafficLights />
      </div>
      <div className={styles.grid} style={layout.gridStyle}>
        <div className={styles.toolbarLayer} style={{opacity: chromeOpacity}}>
          <Toolbar activePlugin={activePlugin} height={layout.windowStyle.height} />
        </div>
        <main className={styles.main} style={mainBackground ? {background: mainBackground} : undefined}>
          <div className={styles.headerLayer} style={{opacity: headerOpacity}}>
            <CanvasHeader breadcrumbs={breadcrumbs} title={title} />
          </div>
          <section className={styles.surface} style={surfaceBackground ? {background: surfaceBackground} : undefined}>{children}</section>
          {composer === false || composer == null ? null : (
            <div className={styles.composerDock}>
              <ChatComposer state={composer} />
            </div>
          )}
        </main>
        {rightRail && layout.showRightRail ? <aside className={styles.rightRail}>{rightRail}</aside> : null}
      </div>
    </div>
  );
}
