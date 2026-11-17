/** The window size the layout was drawn against. */
const DESIGN_WIDTH = 1280
const DESIGN_HEIGHT = 800

/**
 * Browser zoom that fills `width` x `height` with the design size.
 *
 * Gamescope scales whatever window an app opens up to the television, which is
 * what made the app look zoomed in and pixelated on a big set. Fullscreen at
 * the display's own resolution plus this zoom let Chromium draw the text and
 * artwork at the real pixel size, while every screen keeps the proportions it
 * was designed with. The smaller of the two ratios keeps the whole window in
 * view (a 16:9 display is shorter than the 16:10 design).
 */
export function pageZoom(width: number, height: number): number {
  return Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT)
}
