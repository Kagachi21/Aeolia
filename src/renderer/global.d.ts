export {};

declare global {
  type IslandState = 'mini' | 'pill' | 'open';
  type PointerKind = 'enter' | 'move' | 'leave' | 'mic-enter' | 'mic-leave';

  interface IslandStatus {
    state: IslandState;
    word: boolean;
    media: boolean;
    mediaTitle: string;
    mediaHidden?: boolean;
    accent: string;
    surface: string;
    cardWidth: number;
    islandStyle?: string;
    islandPosition?: string;
    glassLevel?: number;
    glassTint?: number;
    glassHue?: number;
    glassRefraction?: boolean;
    liquidGlassLevel?: number;
    liquidGlassTint?: number;
    translucentGlassLevel?: number;
    translucentGlassTint?: number;
    candyGlassLevel?: number;
    candyGlassTint?: number;
    candyGlassHue?: number;
    visibleTabs: string[];
    hiddenUntilHover: boolean;
    openAction: 'last' | 'music';
    meeting: boolean;
    meetingApp?: string;
    miniMode: string;
    meetingMicButton: boolean;
    islandScale?: number | 'auto';
    scaleEffective?: number;
    pillLyrics?: boolean;
    visualizer?: 'pixels' | 'bars';
    musicCardBackground?: 'album' | 'plain';
    musicCardProgress?: string;
    noticeOpenLinks?: boolean;
  }

  interface IslandSettings {
    accent: string;
    surface: string;
    cardWidth: number;
    visibleTabs: string[];
    robotEyeColor: string;
    robotAccessory: string;
    robotEyeMovement: string;
    robotIdleOnly: boolean;
    robotIdleAfterMs: number;
    robotBatteryExpressions: boolean;
    robotHoldsItems: boolean;
    islandStyle: string;
    islandContent: string;
    islandPosition: string;
    glassLevel: number;
    glassTint: number;
    glassHue: number;
    glassRefraction: boolean;
    liquidGlassLevel: number;
    liquidGlassTint: number;
    translucentGlassLevel: number;
    translucentGlassTint: number;
    candyGlassLevel: number;
    candyGlassTint: number;
    candyGlassHue: number;
    barOrder: string[];
    catGreeting: boolean;
    catIdleCenter: boolean;
    miniMode: string;
    miniTrigger: string;
    worshipMode: string;
    worshipRemind: boolean;
    worshipCountdown: boolean;
    worshipImsakIftar: boolean;
    worshipPauseMusic: boolean;
    worshipOther: { day: number; time: string; label: string }[];
    adhanEnabled: boolean;
    adhanVolume: number;
    adhanFajr: boolean;
    adhanFile: string;
    lyricsOffsetSec: number;
    lyricsSpeed: number;
    lyricsText: string;
    meetingAuto: boolean;
    meetingMicButton: boolean;
    meetingIgnoreApps: string[];
    cameraMode: 'shortcut' | 'privacy' | 'both';
    islandScale: number | 'auto';
    pillLyrics: boolean;
    visualizer: 'pixels' | 'bars';
    musicCardBackground: 'album' | 'plain';
    musicCardProgress: string;
    noticeOpenLinks: boolean;
    notifyDownloads: boolean;
    notifyInternet: boolean;
    notifyResumeMusic: boolean;
    calendarCountdown: boolean;
    calendarIcalUrl: string;
    weatherEnabled: boolean;
    weatherRainAlert: boolean;
    captureShortcut: string;
    captureShowIsland: boolean;
    captureMic: boolean;
    captureClipboard: boolean;
    captureShotDir: string;
    captureVideoDir: string;
  }

  interface RobotState {
    idle: boolean;
    batteryPercent: number;
    charging: boolean;
    cursorDx: number;
  }

  interface CardSite { id: string; name: string; url: string }
  interface CardShelf { id: string; name: string; path: string; size: number; at: number }
  interface CardClip { id: string; kind: 'text' | 'image' | 'file'; text: string; at: number }
  interface CardNotice { id: string; app: string; title: string; body: string; at: number; aumid?: string }

  type NoticeCode = 'disabled' | 'unknown-app' | 'launch-failed';
  type NoticeVia = 'aumid' | 'protocol' | 'none';
  type NoticeLaunchResult = {
    ok: boolean;
    kind: 'app';
    app: string;
    via: NoticeVia;
    launched: boolean;
    focused: boolean;
    code?: NoticeCode;
    error?: string;
  };
  type NoticeReplyResult = {
    ok: boolean;
    kind: 'app';
    app: string;
    via: NoticeVia;
    launched: boolean;
    focused: boolean;
    hint: string;
    code?: NoticeCode | 'empty-input';
    error?: string;
  };
  type CamCode = 'unverified-shortcut' | 'need-focus' | 'no-shortcut' | 'unknown-app' | 'send-failed'
    | 'privacy-verified' | 'privacy-unverified' | 'privacy-read-failed' | 'privacy-write-failed';
  /* focused = the meeting app was observed as foreground when the decision was
     made, OR focusProcessWindow succeeded for a need-focus/no-shortcut click.
     It is NOT proof of camera state. Only the privacy path, which reads the
     HKCU consent values back, may set verified:true. */
  type CamToggleResult = {
    ok: boolean;
    verified: boolean;
    sent: boolean;
    focused: boolean;
    shortcut: string;
    code: CamCode;
    hint: string;
    enabled?: boolean | null;
    mode?: 'shortcut' | 'privacy' | 'both';
  };
  interface CardTask { id: string; name: string; done: boolean }
  interface CardState {
    lastTab: string;
    sites: CardSite[];
    shelf: CardShelf[];
    clips: CardClip[];
    notices: CardNotice[];
    tasks: CardTask[];
    waterMl: number;
    waterGoalMl: number;
    waterStartHour: number;
    waterEndHour: number;
    waterEveryMin: number;
    waterEnabled: boolean;
    waterSound: boolean;
    waterDay: string;
    eyeBreakMin: number;
    eyeBreakSound: boolean;
    prayerCity: string;
    greetingSeen?: boolean;
  }

  type CaptureMode = 'full' | 'area' | 'window' | 'record';
  interface CaptureResult { ok: boolean; path?: string; error?: string; sourceId?: string }

  interface ExtrasState {
    meeting: boolean;
    meetingApp: string;
    online: boolean;
    weather: { temp: number; rain: boolean; description: string } | null;
    weatherError: string;
    calendarEvents: { at: number; title: string }[];
    calendarError: string;
    lastDownload: string;
    resumeOffer: boolean;
  }

  interface Window {
    island: {
      onStatus(cb: (status: IslandStatus) => void): () => void;
      pointer(kind: PointerKind, y?: number): void;
      dragStart(): void;
      dragMove(dx: number, dy: number): void;
      dragEnd(): void;
      onHover(cb: (inside: boolean) => void): () => void;
      onMicError(cb: (hint: string) => void): () => void;
      onRobotState(cb: (state: RobotState) => void): () => void;
    };
    api: {
      getState(): Promise<CardState>;
      onState(cb: (state: CardState) => void): () => void;
      setTab(tab: string): void;
      openUrl(url: string): void;
      addSite(name: string, url: string): void;
      addShelf(files: { name: string; path: string; size: number }[]): void;
      clearNotices(): void;
      clearClips(): void;
      patch(partial: Partial<CardState>): void;
      openSettings(uri: string): void;
      pathForFile(file: File): string;
      openWindow(): void;
      setCardHeight(height: number): void;
      onSettingsChanged(cb: (s: IslandSettings) => void): () => void;
      getSettings(): Promise<IslandSettings>;
      setSetting(key: string, value: unknown): Promise<unknown>;
      clipboardCopy(text: string): Promise<{ ok: boolean }>;
      clipboardPaste(text: string): Promise<{ ok: boolean }>;
      getExtras(): Promise<ExtrasState>;
      onExtras(cb: (s: ExtrasState) => void): () => void;
      onLyricsAuto(cb: (p: { title: string; lrc: string | null }) => void): () => void;
      onMusicColors(cb: (p: {
        title: string; colors: { c1: string; c2: string; c3: string } | null;
      }) => void): () => void;
      dismissResume(): void;
      pauseMedia(): void;
      playMedia(): void;
      bannerShow(active: boolean): void;
      setGlassCapture(active: boolean): Promise<boolean>;
      onGlassFrame(cb: (frame: { data: string | Uint8Array; width: number; height: number; origin?: string }) => void): () => void;
      islandOpen(): Promise<void>;
      micMuteState(): Promise<boolean | null>;
      micMuteToggle(): Promise<boolean | null>;
      camToggle(): Promise<CamToggleResult>;
      noticeReply(app: string, body: string, text: string, aumid?: string): Promise<NoticeReplyResult>;
      prevMedia(): void;
      nextMedia(): void;
      openNotice(app: string, body: string, aumid?: string): Promise<NoticeLaunchResult>;
      getStats(): Promise<{ cpu: number; ramUsedMb: number; ramTotalMb: number; ramPercent: number }>;
      cleanRam(): Promise<{ freedMb: number; trimmed: number; denied: number }>;
      getBrightness(): Promise<{ supported: boolean; current: number }>;
      setBrightness(percent: number): Promise<{ ok: boolean; current: number }>;
      volumeStep(direction: 'up' | 'down', steps: number): void;
      toggleMute(): void;
      capture(mode: CaptureMode): Promise<CaptureResult>;
      captureRecordStop(data: ArrayBuffer): Promise<CaptureResult>;
      captureRecordAbort(): void;
      onCaptureHotkey(cb: (mode: string) => void): () => void;
      openCaptureFolder(): void;
      notify(title: string, body: string): void;
    };
    settingsApi: {
      get(): Promise<Record<string, unknown>>;
      screenInfo(): Promise<{ screenWidth: number; autoScalePct: number; islandScale: number | 'auto' }>;
      set(key: string, value: unknown): Promise<Record<string, unknown>>;
      close(): void;
      onChange(cb: (state: Record<string, unknown>) => void): () => void;
      pickFile(): Promise<string>;
      pickFolder(): Promise<string>;
      openPath(path: string): void;
      extras(): Promise<ExtrasState>;
    };
  }
}
