import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {CalendarSurface} from '../../agentbuddy-ui/calendar';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {
  calendarDayDemoState,
  calendarDayPickerDemoState,
  calendarDialogDemoState,
  calendarMonthDemoState,
  calendarPickerDemoState,
} from '../../film/state/calendar';
import {launchFilmStory} from '../../film/state/launchStory';

const dayBreadcrumbs = ['Calendar', launchFilmStory.calendar.dayBreadcrumb];

export const CalendarMonthDemo = () => {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="calendar" breadcrumbs={['Calendar']} composer={false} layout={layout}>
        <CalendarSurface state={calendarMonthDemoState} />
      </AppWindow>
    </SurfaceFrame>
  );
};

export const CalendarDayDemo = () => {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="calendar" breadcrumbs={dayBreadcrumbs} composer={false} layout={layout}>
        <CalendarSurface state={calendarDayDemoState} />
      </AppWindow>
    </SurfaceFrame>
  );
};

export const CalendarDialogDemo = () => {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="calendar" breadcrumbs={dayBreadcrumbs} composer={false} layout={layout}>
        <CalendarSurface state={calendarDialogDemoState} />
      </AppWindow>
    </SurfaceFrame>
  );
};

export const CalendarMonthPickerDemo = () => {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="calendar" breadcrumbs={['Calendar']} composer={false} layout={layout}>
        <CalendarSurface state={calendarPickerDemoState} />
      </AppWindow>
    </SurfaceFrame>
  );
};

export const CalendarDayPickerDemo = () => {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="calendar" breadcrumbs={dayBreadcrumbs} composer={false} layout={layout}>
        <CalendarSurface state={calendarDayPickerDemoState} />
      </AppWindow>
    </SurfaceFrame>
  );
};
