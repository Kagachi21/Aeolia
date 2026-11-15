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

/** Extra pill width reserved for the separate mic capsule (gap + capsule). */
export const MIC_PILL_EXTRA = 170;
/** Extra pill width reserved for the notice/meeting banner overlay. */
export const BANNER_EXTRA = 250;

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

  let x = Math.round(display.bounds.x + (display.bounds.width - size.width) / 2);
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
  const y = Math.round(display.bounds.y + (state === 'mini' ? 0 : topGap));
  return { x, y, width: size.width, height: size.height };
}
