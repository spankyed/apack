export interface KittyOptions {
  /**
   * 'scrollback' anchors a placement to its buffer row so it scrolls away with
   * the text, which is what a shell running chafa expects. It suits a
   * full-screen application too, since the alternate screen has no scrollback
   * and the anchoring row is the screen row there. 'viewport' pins a placement
   * to the visible grid, for an inline compositor on the main screen that
   * re-emits its placements every frame. Default 'scrollback'.
   */
  anchor?: 'scrollback' | 'viewport';
  /** Decoded bitmaps retained before the least recently used is evicted. Default 128. */
  storageLimit?: number;
  /**
   * Decoded bytes (width x height x 4) all stored images may hold together
   * before the least recently used unplaced one is evicted. Default 320 MiB.
   */
  storageBytes?: number;
  /**
   * The largest image, in pixels, that is decoded. A larger one is refused
   * with an EFBIG reply, and so is a transmission longer than such an image
   * could need. Default 4096 x 4096.
   */
  maxImagePixels?: number;
  /** zIndex of the overlay layer. Default 5. */
  zIndex?: number;
}
