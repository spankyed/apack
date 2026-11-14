# Cursor Assets

The rendered SVG assets live in `packages/video/public/cursors` so Remotion can serve them through `staticFile()`.

`public/cursors/apple/` contains the upstream SVG source assets from `ful1e5/apple_cursor`.

`public/cursors/apple-white/` is the same SVG set recolored for the launch film: base `#FFFFFF`, outline `#000000`.

Source: https://github.com/ful1e5/apple_cursor

License: GPL-3.0, included at `public/cursors/apple/LICENSE` and `public/cursors/apple-white/LICENSE`.

The film overlay should use `cursorRegistry.ts` instead of referencing asset paths directly. This keeps cursor choice, dimensions, and hotspot metadata centralized so shots can switch cursor styles without reworking motion logic.
