import { screen } from 'electron';
import type { Settings } from './settings';

export type IslandState = 'mini' | 'pill' | 'open';
export type Rect = { x: number; y: number; width: number; height: number };

/** The display the island (and everything that measures against it) lives on.
    Centralised so active-window and capture checks cannot silently disagree
    with the window geometry when monitor='cursor' is selected. */
export function activeDisplay(settings: Settings) {
  return settings.monitor === 'cursor'
    ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    : screen.getPrimaryDisplay();
}

/** Fixed steps offered in Settings, matching the reference control. */
export const ISLAND_SCALE_STEPS = [75, 90, 100, 115, 130];
/** Auto scales against a 1920 px baseline, clamped to the same range. */
const AUTO_BASELINE_PX = 1920;

/** The percent the island is actually drawn at. 'auto' resolves against the
    display the island lives on, so it tracks monitor changes for free. */
export function effectiveScalePct(settings: Settings): number {
  if (settings.islandScale !== 'auto') return settings.islandScale;
  const width = activeDisplay(settings).bounds.width;
  return Math.min(130, Math.max(75, Math.round((width / AUTO_BASELINE_PX) * 100)));
}

/** Extra pill width reserved for the separate mic + cam capsules: 76 + 8 gap
    + 68 + 10 padding on each side. The renderer mirrors this in MIC_EXTRA
    (renderer.ts) so #island can give the strip back and the capsules get a
    real 10 px gap from the island body. */
export const MIC_PILL_EXTRA = 172;
/** Extra pill width reserved for the notice/meeting banner overlay. */
export const BANNER_EXTRA = 250;

/** The part of the pill window that belongs ONLY to the meeting capsules.
    #micPill is a sibling of #island and #island gives this strip back with
    `--mic-extra` (renderer.ts). Hover-to-open must never claim it, otherwise
    the card opens before a click on Mic/Cam can land. Pure geometry so the
    rule can be pinned by probes without launching Electron. */
export function micStripRect(
  bounds: Rect,
  settings: Settings,
  active: boolean
): Rect | null {
  if (!active) return null;
  const scale = effectiveScalePct(settings) / 100;
  const extra = Math.min(bounds.width, Math.round(MIC_PILL_EXTRA * scale));
  if (extra <= 0) return null;
  const rightSide = settings.islandPosition === 'right'
    || settings.islandPosition === 'right-side';
  return {
    x: rightSide ? bounds.x : bounds.x + bounds.width - extra,
    y: bounds.y,
    width: extra,
    height: bounds.height,
  };
}

/** Inclusive point-in-rect test. */
export function pointInRect(
  point: { x: number; y: number },
  rect: Rect | null
): boolean {
  if (!rect) return false;
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height;
}

// The window is exactly the island, never a full-width overlay, so a click
// outside it lands on the app below. openHeight fits the open card to its
// panel; pillWidth makes room for the cat and the scrolling track name.
// micExtra widens the pill window during meetings so a separate mic capsule
// fits beside it; bannerExtra widens it while a notice banner overlays the
// pill. Neither touches the open card or the mini notch.
export function boundsFor(
  state: IslandState,
  settings: Settings,
  openHeight?: number,
  pillWidth?: number,
  micExtra?: number,
  bannerExtra?: number
): Rect {
  const display = activeDisplay(settings);
  const stored = settings[state];
  // islandScale enlarges every state, the notch included, so the mini clock
  // and cat grow with the same slider that sizes the pill and the card.
  const scale = effectiveScalePct(settings) / 100;
  const size = state === 'open'
    ? { width: Math.round(settings.cardWidth * scale), height: Math.round((openHeight ?? stored.height) * scale) }
    : state === 'pill'
      ? { width: Math.round(((pillWidth ?? stored.width) + (micExtra ?? 0) + (bannerExtra ?? 0)) * scale), height: Math.round(stored.height * scale) }
      : { width: Math.round(stored.width * scale), height: Math.round(stored.height * scale) };
  const margin = Math.max(0, settings.edgeMargin);
  const right = display.bounds.x + display.bounds.width - size.width - margin;
  const left = display.bounds.x + margin;
  // The reserved capsule strip must never move the island body: the body is
  // anchored with its width WITHOUT micExtra (bannerExtra stays in, because a
  // banner widens the body itself), so the strip always grows into free space.
  // center/left keep the body where it was and the strip goes right of it;
  // right/right-side anchor the window's right edge instead, which leaves the
  // body flush with the screen edge and puts the strip on its left.
  const anchorWidth = state === 'pill'
    ? Math.round(((pillWidth ?? stored.width) + (bannerExtra ?? 0)) * scale)
    : size.width;

  let x = Math.round(display.bounds.x + (display.bounds.width - anchorWidth) / 2);
  switch (settings.islandPosition) {
    case 'left':
    case 'left-side':
      x = Math.round(left);
      break;
    case 'right':
    case 'right-side':
      x = Math.round(right);
      break;
    default:
      break;
  }

  // "Notched" is documented as attached to the top edge, so it has to sit
  // flush; "Dynamic" keeps the floating gap. The side margin is unchanged.
  const topGap = settings.islandStyle === 'notched' ? 0 : margin;
  let y = Math.round(display.bounds.y + (state === 'mini' ? 0 : topGap));
  // A drag offset is applied to every state so the island keeps its place when
  // it shrinks to the notch or grows into the card. Clamping keeps the whole
  // pane on the display it lives on, including secondary monitors whose origin
  // is not 0,0. The default {0,0} leaves all fixed positions byte-for-byte.
  const off = settings.islandOffset ?? { x: 0, y: 0 };
  x = Math.round(x + off.x);
  y = Math.round(y + off.y);
  const minX = display.bounds.x;
  const minY = display.bounds.y;
  const maxX = display.bounds.x + display.bounds.width - size.width;
  const maxY = display.bounds.y + display.bounds.height - size.height;
  x = Math.round(Math.min(Math.max(x, minX), Math.max(minX, maxX)));
  y = Math.round(Math.min(Math.max(y, minY), Math.max(minY, maxY)));
  return { x, y, width: size.width, height: size.height };
}
