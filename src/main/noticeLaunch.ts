/* Notification launch decisions. Windows exposes no reply channel for a toast
   we do not own, so both handlers only open and focus the source app. Every
   failure carries a code and a message the renderer can show. */

export type NoticeCode = 'disabled' | 'unknown-app' | 'launch-failed';
export type NoticeVia = 'aumid' | 'protocol' | 'none';
export type NoticeLaunchResult = {
  ok: boolean;
  kind: 'app';
  app: string;
  via: NoticeVia;
  launched: boolean;
  focused: boolean;
  code?: NoticeCode;
  error?: string;
};
export type NoticeReplyResult = NoticeLaunchResult & { hint: string };

export type NoticeTarget = {
  key: string;
  open: string;
  aumidPatterns: RegExp[];
  processes: string[];
  aliases: string[];
};

/* Aliases are matched as whole token sequences: "TeamViewer" must never be
   routed to Teams just because both contain "team". */
const TARGETS: NoticeTarget[] = [
  { key: 'whatsapp', open: 'whatsapp://', aumidPatterns: [/whatsapp/i], processes: ['WhatsApp', 'WhatsAppDesktop'], aliases: ['whatsapp', 'whatsapp desktop'] },
  { key: 'discord', open: 'discord://', aumidPatterns: [/discord/i], processes: ['Discord'], aliases: ['discord'] },
  { key: 'telegram', open: 'tg://', aumidPatterns: [/telegram/i], processes: ['Telegram'], aliases: ['telegram', 'telegram desktop'] },
  { key: 'zoom', open: 'zoommtg://', aumidPatterns: [/zoom/i], processes: ['Zoom'], aliases: ['zoom', 'zoom meeting'] },
  { key: 'teams', open: 'msteams://', aumidPatterns: [/teams?$|microsoft[ ._-]?teams?/i], processes: ['ms-teams', 'Teams'], aliases: ['teams', 'microsoft teams', 'ms teams', 'ms-teams'] },
  { key: 'gmail', open: 'https://mail.google.com', aumidPatterns: [/gmail/i], processes: ['chrome', 'msedge', 'firefox'], aliases: ['gmail', 'google mail'] },
  { key: 'outlook', open: 'msoutlook://', aumidPatterns: [/outlook/i], processes: ['OUTLOOK'], aliases: ['outlook', 'microsoft outlook'] },
  { key: 'slack', open: 'slack://', aumidPatterns: [/slack/i], processes: ['Slack'], aliases: ['slack'] },
];

const DISABLED = 'Tautan notifikasi dinonaktifkan di pengaturan.';
const UNKNOWN = 'Aplikasi sumber tidak dikenali.';
const LAUNCH_FAILED = 'Aplikasi tidak dapat dibuka.';
const REPLY_HINT = 'Aplikasi dibuka · ketik dan kirim di sana';
const REPLY_UNFOCUSED = 'Perintah dibuka diterima Windows · cek jendela aplikasi';

type LaunchHooks = {
  openExternal(url: string): Promise<void>;
  focus(app: string): boolean;
  setting(): boolean;
};

/* Defaults stay lazy: plain-node probes replace all three hooks and must not
   load Electron just to test the decision table. */
let hooks: LaunchHooks = {
  async openExternal(url: string): Promise<void> {
    const electron = require('electron') as { shell: { openExternal(value: string): Promise<void> } };
    await electron.shell.openExternal(url);
  },
  focus(app: string): boolean {
    const { focusProcessWindow } = require('./activeWindow') as {
      focusProcessWindow(value: string): boolean;
    };
    return focusProcessWindow(app);
  },
  setting(): boolean {
    const { loadSettings } = require('./settings') as {
      loadSettings(): { noticeOpenLinks?: boolean };
    };
    return Boolean(loadSettings().noticeOpenLinks);
  },
};

/** Probe seam. Production never calls this; the real OS hooks stay in place. */
export function setNoticeLaunchHooks(next: Partial<LaunchHooks>): void {
  hooks = { ...hooks, ...next };
}

export function validAumid(aumid: string): boolean {
  return /^[A-Za-z0-9._!-]{1,200}$/.test(String(aumid || ''));
}

function tokens(value: string): string[] {
  return String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function matchTokens(parts: string[], phrase: string): boolean {
  const wanted = tokens(phrase);
  if (wanted.length === 0 || wanted.length > parts.length) return false;
  for (let i = 0; i + wanted.length <= parts.length; i += 1) {
    if (wanted.every((word, j) => parts[i + j] === word)) return true;
  }
  return false;
}

/** Whole-token app match, with an optional AUMID fallback for unknown names. */
export function matchKey(appName: string, aumid = ''): string | null {
  const parts = tokens(appName);
  const named = TARGETS.find((t) => [t.key, ...t.aliases].some((alias) => matchTokens(parts, alias)));
  if (named) return named.key;
  if (!validAumid(aumid)) return null;
  return TARGETS.find((t) => t.aumidPatterns.some((re) => re.test(aumid)))?.key ?? null;
}

function aumidMatches(key: string, aumid: string): boolean {
  const target = TARGETS.find((t) => t.key === key);
  return Boolean(target && validAumid(aumid)
    && target.aumidPatterns.some((re) => re.test(aumid)));
}

export function targetUrl(key: string, aumid = ''): { url: string; via: NoticeVia } {
  const target = TARGETS.find((t) => t.key === key);
  if (!target) return { url: '', via: 'none' };
  if (aumidMatches(key, aumid)) {
    return { url: `shell:AppsFolder\\${aumid}`, via: 'aumid' };
  }
  return { url: target.open, via: 'protocol' };
}

export function guard(enabled: boolean, app: string): NoticeLaunchResult | null {
  if (enabled) return null;
  return {
    ok: false, kind: 'app', app, via: 'none', launched: false, focused: false,
    code: 'disabled', error: DISABLED,
  };
}

function focusTarget(key: string, aumid: string): boolean {
  const target = TARGETS.find((t) => t.key === key);
  if (!target) return false;
  const candidates = [...target.processes];
  if (aumidMatches(key, aumid)) candidates.unshift(aumid);
  return candidates.some((proc) => {
    try { return hooks.focus(proc); } catch { return false; }
  });
}

/** openExternal resolving means the OS accepted the command, not that the
    app window appeared. `launched` and `focused` report those separately. */
export async function launchNotice(
  url: string,
  key: string,
  app: string,
  via: NoticeVia,
  aumid: string,
  fallbackUrl = '',
): Promise<NoticeLaunchResult> {
  const attempt = async (target: string): Promise<string> => {
    try {
      await hooks.openExternal(target);
      return '';
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err ?? '');
      return detail || LAUNCH_FAILED;
    }
  };
  let error = await attempt(url);
  let activeVia = via;
  if (error && via === 'aumid' && fallbackUrl) {
    activeVia = 'protocol';
    error = await attempt(fallbackUrl);
  }
  if (error) {
    return {
      ok: false, kind: 'app', app, via: activeVia, launched: false, focused: false,
      code: 'launch-failed', error: error || LAUNCH_FAILED,
    };
  }
  return {
    ok: true, kind: 'app', app, via: activeVia, launched: true,
    focused: focusTarget(key, aumid),
  };
}

export async function open(
  appName: string,
  _body: string,
  aumid = '',
  noticeOpenLinks?: boolean,
): Promise<NoticeLaunchResult> {
  const app = String(appName || '').trim();
  const allowed = noticeOpenLinks === undefined ? hooks.setting() : noticeOpenLinks;
  const blocked = guard(allowed, app);
  if (blocked) return blocked;
  const key = matchKey(app, aumid);
  if (!key) {
    return {
      ok: false, kind: 'app', app, via: 'none', launched: false, focused: false,
      code: 'unknown-app', error: UNKNOWN,
    };
  }
  const { url, via } = targetUrl(key, aumid);
  const target = TARGETS.find((t) => t.key === key);
  return launchNotice(url, key, app, via, aumid, via === 'aumid' ? target?.open ?? '' : '');
}

/** `text` is accepted for old callers but deliberately unused. No clipboard,
    no prefill, no paste: the user types and sends in the source app. */
export async function reply(
  appName: string,
  _body: string,
  _text: string,
  aumid = '',
  noticeOpenLinks?: boolean,
): Promise<NoticeReplyResult> {
  const app = String(appName || '').trim();
  const allowed = noticeOpenLinks === undefined ? hooks.setting() : noticeOpenLinks;
  const blocked = guard(allowed, app);
  if (blocked) return { ...blocked, hint: blocked.error || DISABLED };
  const result = await open(appName, _body, aumid, allowed);
  if (!result.ok) return { ...result, hint: result.error || LAUNCH_FAILED };
  return {
    ...result,
    hint: result.focused ? REPLY_HINT : REPLY_UNFOCUSED,
  };
}
