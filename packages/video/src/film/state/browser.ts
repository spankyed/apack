import type {BrowserSurfaceState} from '../../agentbuddy-ui/browser';
import {launchFilmStory} from './launchStory';

const supafanFavicon = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" rx="7" fill="%2314b8a6"/%3E%3Cpath d="M9 17h14M16 9v14" stroke="white" stroke-width="3" stroke-linecap="round"/%3E%3C/svg%3E';
const stripeFavicon = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" rx="7" fill="%23635bff"/%3E%3Cpath d="M10 21c2 1 8 1 8-2 0-4-8-2-8-6 0-3 5-4 10-2" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/%3E%3C/svg%3E';

export const browserSurfaceState: BrowserSurfaceState = {
  activeTabId: 3,
  addressBarValue: 'https://supafan.app/checkout',
  page: {
    accent: 'rgb(20 184 166)',
    cards: [
      {label: 'Conversion', value: '+12.4%'},
      {label: 'Checkout step', value: 'Payment'},
      {label: 'Release', value: 'Ready'},
    ],
    eyebrow: 'Supafan storefront',
    heading: 'Creator memberships without checkout friction',
    status: 'Checkout preview loaded from Browser plugin',
    subheading: 'A real in-app browser tab stays beside the implementation thread while the launch flow validates the customer path.',
  },
  selectedSuggestionIndex: -1,
  suggestions: [],
  tabGroups: [
    {color: 'teal', id: 'launch', isCollapsed: false, name: 'Launch', order: 0},
  ],
  tabs: [
    {
      canGoBack: true,
      canGoForward: false,
      favicon: supafanFavicon,
      groupId: 'launch',
      id: 3,
      title: 'Supafan Checkout',
      url: 'https://supafan.app/checkout',
    },
    {
      canGoBack: false,
      canGoForward: false,
      favicon: stripeFavicon,
      groupId: 'launch',
      id: 4,
      title: 'Stripe Dashboard',
      url: 'https://dashboard.stripe.com',
    },
  ],
};

export function browserSurfaceStateForFrame(frame: number): BrowserSurfaceState {
  const local = Math.max(0, frame - 252);
  const typed = local < 24 ? 'supa' : local < 36 ? 'supafan.app/ch' : 'https://supafan.app/checkout';
  const focused = local < 42;
  const suggestions = focused
    ? [
        {title: 'Supafan Checkout', url: 'https://supafan.app/checkout', favicon: supafanFavicon},
        {title: 'Supafan Admin', url: 'https://supafan.app/admin', favicon: supafanFavicon},
      ]
    : [];

  return {
    ...browserSurfaceState,
    addressBarValue: typed,
    addressFocused: focused,
    inlineCompletion: focused && typed === 'supa' ? 'fan.app/checkout' : null,
    page: {
      ...browserSurfaceState.page!,
      status: local < 42 ? `Opening checkout preview for ${launchFilmStory.persona.project}` : browserSurfaceState.page!.status,
    },
    selectedSuggestionIndex: local > 20 && focused ? 0 : -1,
    suggestions,
    tabs: browserSurfaceState.tabs.map(tab => (
      tab.id === 3
        ? {...tab, isLoading: local >= 36 && local < 52, title: local < 52 ? 'Loading...' : tab.title}
        : tab
    )),
  };
}
