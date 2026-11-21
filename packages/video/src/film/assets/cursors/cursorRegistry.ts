import {staticFile} from 'remotion';

// Asset names mirror ful1e5/apple_cursor/svg so new cursor themes can reuse
// the same typed ids and only swap the directory passed to buildAppleCursorTheme.
export type CursorThemeId = 'apple-source' | 'apple-white';

export type CursorAssetId =
  | 'X_cursor'
  | 'all-scroll'
  | 'bottom_left_corner'
  | 'bottom_right_corner'
  | 'bottom_tee'
  | 'center_ptr'
  | 'context-menu'
  | 'copy'
  | 'cross'
  | 'crossed_circle'
  | 'crosshair'
  | 'dnd_no_drop'
  | 'dotbox'
  | 'hand1'
  | 'hand2'
  | 'left_ptr'
  | 'left_side'
  | 'left_tee'
  | 'link'
  | 'll_angle'
  | 'lr_angle'
  | 'move'
  | 'pencil'
  | 'person'
  | 'pin'
  | 'plus'
  | 'question_arrow'
  | 'right_ptr'
  | 'right_tee'
  | 'sb_down_arrow'
  | 'sb_h_double_arrow'
  | 'sb_left_arrow'
  | 'sb_right_arrow'
  | 'sb_up_arrow'
  | 'sb_v_double_arrow'
  | 'top_side'
  | 'top_tee'
  | 'ul_angle'
  | 'ur_angle'
  | 'vertical-text'
  | 'wayland-cursor'
  | 'xterm'
  | 'zoom-in'
  | 'zoom-out';

type CursorAsset = {
  file: string;
  height: number;
  hotspot: [number, number];
  id: CursorAssetId;
  source: 'ful1e5/apple_cursor';
  width: number;
};

const appleCursorAssetIds = [
  'X_cursor',
  'all-scroll',
  'bottom_left_corner',
  'bottom_right_corner',
  'bottom_tee',
  'center_ptr',
  'context-menu',
  'copy',
  'cross',
  'crossed_circle',
  'crosshair',
  'dnd_no_drop',
  'dotbox',
  'hand1',
  'hand2',
  'left_ptr',
  'left_side',
  'left_tee',
  'link',
  'll_angle',
  'lr_angle',
  'move',
  'pencil',
  'person',
  'pin',
  'plus',
  'question_arrow',
  'right_ptr',
  'right_tee',
  'sb_down_arrow',
  'sb_h_double_arrow',
  'sb_left_arrow',
  'sb_right_arrow',
  'sb_up_arrow',
  'sb_v_double_arrow',
  'top_side',
  'top_tee',
  'ul_angle',
  'ur_angle',
  'vertical-text',
  'wayland-cursor',
  'xterm',
  'zoom-in',
  'zoom-out',
] as const satisfies readonly CursorAssetId[];

const centeredHotspotIds = new Set<CursorAssetId>([
  'all-scroll',
  'cross',
  'crossed_circle',
  'crosshair',
  'dotbox',
  'move',
  'sb_h_double_arrow',
  'sb_v_double_arrow',
  'wayland-cursor',
]);

const edgeHotspots: Partial<Record<CursorAssetId, [number, number]>> = {
  bottom_left_corner: [64, 192],
  bottom_right_corner: [192, 192],
  bottom_tee: [128, 214],
  center_ptr: [128, 128],
  hand1: [101, 55],
  hand2: [101, 55],
  left_ptr: [84, 49],
  left_side: [42, 128],
  left_tee: [44, 128],
  ll_angle: [64, 192],
  lr_angle: [192, 192],
  pencil: [61, 207],
  person: [128, 128],
  pin: [128, 45],
  plus: [128, 128],
  right_ptr: [172, 49],
  right_tee: [212, 128],
  sb_down_arrow: [128, 184],
  sb_left_arrow: [76, 128],
  sb_right_arrow: [180, 128],
  sb_up_arrow: [128, 72],
  top_side: [128, 42],
  top_tee: [128, 42],
  ul_angle: [64, 64],
  ur_angle: [192, 64],
  'vertical-text': [128, 128],
  xterm: [128, 128],
  'context-menu': [84, 49],
  copy: [84, 49],
  dnd_no_drop: [84, 49],
  link: [84, 49],
  question_arrow: [84, 49],
  'zoom-in': [84, 49],
  'zoom-out': [84, 49],
};

export const cursorAssets: Record<CursorThemeId, Record<CursorAssetId, CursorAsset>> = {
  'apple-source': buildAppleCursorTheme('apple'),
  'apple-white': buildAppleCursorTheme('apple-white'),
};

export const defaultCursorTheme: CursorThemeId = 'apple-white';
export const defaultCursorAsset: CursorAssetId = 'left_ptr';

export function getCursorAsset({
  cursor = defaultCursorAsset,
  theme = defaultCursorTheme,
}: {
  cursor?: CursorAssetId;
  theme?: CursorThemeId;
}) {
  return cursorAssets[theme][cursor];
}

function buildAppleCursorTheme(directory: 'apple' | 'apple-white') {
  return Object.fromEntries(
    appleCursorAssetIds.map(id => [
      id,
      {
        file: staticFile(`cursors/${directory}/svg/${id}.svg`),
        height: id === 'hand2' ? 257 : 256,
        hotspot: edgeHotspots[id] ?? (centeredHotspotIds.has(id) ? [128, 128] : [84, 49]),
        id,
        source: 'ful1e5/apple_cursor',
        width: id === 'hand2' || id === 'xterm' ? 257 : 256,
      },
    ]),
  ) as Record<CursorAssetId, CursorAsset>;
}
