export { KittyGraphics, type KittyGraphicsOptions } from './overlay.ts';
export { installPlaceholderGlyph, withPlaceholderFont } from './placeholder-glyph.ts';
export { scanPlaceholders, PLACEHOLDER_CODE, type PlaceholderRun } from './placeholders.ts';
export {
  createXtermAdapter,
  supportsApc,
  type XtermAdapter,
  type XtermDisposable,
} from './xterm-adapter.ts';
export {
  KITTY_APC_IDENT,
  base64Decode,
  clampSourceRect,
  fitRgba,
  parseControl,
  rgbToRgba,
  splitApc,
  type KittyCommand,
} from './protocol.ts';
