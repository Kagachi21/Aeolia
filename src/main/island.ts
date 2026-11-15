import type { BrowserWindow } from 'electron';
import { boundsFor, BANNER_EXTRA, MIC_PILL_EXTRA, type IslandState, type Rect } from './bounds';
import type { Settings } from './settings';

export type BaseState = 'mini' | 'pill';

const FRAME_MS = 16;

export class Island {
  private state: IslandState = 'pill';
  private base: BaseState = 'pill';
  private timer: NodeJS.Timeout | null = null;
  private openHeight: number | null = null;
  private mediaPillWidth: number | null = null;
  private micExtra: number | null = null;
  private bannerExtra: number | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly settings: Settings,
    private readonly onChange: (state: IslandState) => void = () => {}
  ) {}

  get current(): IslandState {
    return this.state;
  }

  get baseState(): BaseState {
    return this.base;
  }

  private bounds(state: IslandState): Rect {
    return boundsFor(
      state,
      this.settings,
      state === 'open' ? this.openHeight ?? undefined : undefined,
      state === 'pill' ? this.mediaPillWidth ?? undefined : undefined,
      state === 'pill' ? this.micExtra ?? undefined : undefined,
      state === 'pill' ? this.bannerExtra ?? undefined : undefined
    );
  }

  /** First placement, no animation. */
  place(): void {
    const b = this.bounds(this.state);
    this.win.setBounds(b);
    console.log('[island] place', this.state, JSON.stringify(b));
  }

  /** Re-apply bounds after a position or margin change. */
  reposition(): void {
    // A settings change can land mid-transition. Without stopping the running
    // animation its remaining frames would drag the window back to stale bounds.
    this.stop();
    this.openHeight = null;
    this.win.setBounds(this.bounds(this.state));
  }

  /** Fit the open card to the panel the renderer just measured. */
  setOpenHeight(height: number): void {
    const clamped = Math.min(420, Math.max(72, Math.round(height)));
    if (this.openHeight === clamped) return;
    this.openHeight = clamped;
    if (this.state === 'open') this.animateTo(this.bounds('open'));
  }

  /** Widen the pill while a track is playing, then restore the stored width. */
  setMedia(playing: boolean): void {
    const next = playing ? 264 : null;
    if (this.mediaPillWidth === next) return;
    this.mediaPillWidth = next;
    if (this.state === 'pill') this.win.setBounds(this.bounds('pill'));
  }

  /** Reserve room for the separate mic capsule while a meeting runs. The
      stored flag also survives transitions: bounds() re-applies it whenever
      the island returns to the pill state. */
  setMicPill(active: boolean): void {
    const next = active ? MIC_PILL_EXTRA : null;
    if (this.micExtra === next) return;
    this.micExtra = next;
    if (this.state === 'pill') this.win.setBounds(this.bounds('pill'));
  }

  /** Widen the pill while a notice/meeting banner overlays it; the renderer
      owns the timing and calls this for the whole banner duration. */
  setBanner(active: boolean): void {
    const next = active ? BANNER_EXTRA : null;
    if (this.bannerExtra === next) return;
    this.bannerExtra = next;
    if (this.state === 'pill') this.win.setBounds(this.bounds('pill'));
  }

  setBase(next: BaseState): void {
    if (this.base === next) return;
    this.base = next;
    if (this.state !== 'open') this.transition(next);
  }

  open(): void {
    if (this.state !== 'open') this.transition('open');
  }

  close(): void {
    if (this.state === 'open') this.transition(this.base);
  }

  private transition(next: IslandState): void {
    this.state = next;
    if (next !== 'open') this.openHeight = null;
    const target = this.bounds(next);
    console.log('[island] ->', next, JSON.stringify(target));
    this.animateTo(target);
    this.onChange(next);
    setTimeout(() => {
      console.log('[island] actual', next, JSON.stringify(this.win.getBounds()));
    }, this.settings.animationMs + 120);
  }

  /**
   * Steps setBounds with an ease-out curve. The window is only ever the island,
   * so the intermediate frames are island-sized too.
   */
  private animateTo(target: Rect): void {
    this.stop();
    const start = this.win.getBounds();
    const duration = Math.max(1, this.settings.animationMs);
    const startedAt = Date.now();

    this.timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - startedAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.win.setBounds({
        x: Math.round(start.x + (target.x - start.x) * eased),
        y: Math.round(start.y + (target.y - start.y) * eased),
        width: Math.round(start.width + (target.width - start.width) * eased),
        height: Math.round(start.height + (target.height - start.height) * eased),
      });
      if (t >= 1) this.stop();
    }, FRAME_MS);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.stop();
  }
}
