import { BrowserWindow, ClipboardItem, clipboard, desktopCapturer, ipcMain, screen, shell, app, session } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings } from './settings';
import { activeDisplay } from './bounds';

export type CaptureResult = { ok: boolean; path?: string; error?: string; sourceId?: string };
type Rect = { x: number; y: number; width: number; height: number };
type Hooks = { hide(): void; show(): void; protect(on: boolean): void };

let overlay: BrowserWindow | null = null;
let resolveRect: ((r: Rect | null) => void) | null = null;
let hooks: Hooks = { hide() {}, show() {}, protect() {} };

/** Shots and recordings can go to separate user-chosen folders. An unusable
    path falls back to Pictures/Aeolia instead of failing the whole capture. */
function outDir(kind: 'shot' | 'video'): string {
  const s = loadSettings();
  const chosen = kind === 'video' ? s.captureVideoDir : s.captureShotDir;
  const fallback = join(app.getPath('pictures'), 'Aeolia');
  for (const dir of [chosen, fallback]) {
    if (!dir) continue;
    try {
      mkdirSync(dir, { recursive: true });
      if (existsSync(dir)) return dir;
    } catch { /* unwritable path: try the fallback */ }
  }
  return fallback;
}

function fileName(ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `Aeolia_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

function save(img: Electron.NativeImage): CaptureResult {
  const png = img.toPNG();
  const path = join(outDir('shot'), fileName('png'));
  writeFileSync(path, png);
  if (loadSettings().captureClipboard) {
    // Electron 45 replaced writeImage() with the W3C-style write(ClipboardItem).
    try {
      // Buffer's ArrayBufferLike backing is not a valid BlobPart; copy into a
      // plain Uint8Array owned by a real ArrayBuffer.
      const bytes = Uint8Array.from(png);
      const blob = new Blob([bytes], { type: 'image/png' });
      void clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
    } catch { /* clipboard held by another app */ }
  }
  return { ok: true, path };
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function screenSources() {
  const display = activeDisplay(loadSettings());
  const scale = display.scaleFactor || 1;
  const size = {
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale),
  };
  const sources = await desktopCapturer.getSources({
    types: ['screen'], thumbnailSize: size, fetchWindowIcons: false,
  });
  return { display, scale, size, sources };
}

async function captureFull(): Promise<CaptureResult> {
  const { sources } = await screenSources();
  const src = sources[0];
  if (!src) return { ok: false, error: 'Layar tidak tersedia' };
  return save(src.thumbnail);
}

async function captureWindow(): Promise<CaptureResult> {
  const display = activeDisplay(loadSettings());
  const scale = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale),
    },
    fetchWindowIcons: false,
  });
  const src = sources.find((s) => !/Aeolia/i.test(s.name)) ?? sources[0];
  if (!src) return { ok: false, error: 'Tidak ada jendela yang bisa ditangkap' };
  if (src.thumbnail.isEmpty()) return { ok: false, error: 'Jendela tidak mengembalikan gambar' };
  return save(src.thumbnail);
}

function closeOverlay(): void {
  if (overlay && !overlay.isDestroyed()) overlay.close();
  overlay = null;
}

function selectArea(): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (resolveRect) resolveRect(null);
    resolveRect = resolve;
    const display = activeDisplay(loadSettings());
    overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreenable: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/capture-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    overlay.once('ready-to-show', () => overlay?.show());
    overlay.on('closed', () => {
      overlay = null;
      if (resolveRect) { resolveRect(null); resolveRect = null; }
    });
    overlay.loadFile(join(__dirname, '../renderer/capture-overlay.html'));
  });
}

async function captureArea(): Promise<CaptureResult> {
  // Grab the screen first so the dimming overlay cannot appear in the shot.
  const { sources, scale } = await screenSources();
  const src = sources[0];
  if (!src) return { ok: false, error: 'Layar tidak tersedia' };
  const shot = src.thumbnail;
  const rect = await selectArea();
  if (!rect || rect.width < 4 || rect.height < 4) {
    return { ok: false, error: 'Dibatalkan' };
  }
  const physical = {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  };
  const bounds = shot.getSize();
  const clipped = {
    x: Math.max(0, Math.min(bounds.width - 1, physical.x)),
    y: Math.max(0, Math.min(bounds.height - 1, physical.y)),
    width: Math.max(1, Math.min(bounds.width - physical.x, physical.width)),
    height: Math.max(1, Math.min(bounds.height - physical.y, physical.height)),
  };
  return save(shot.crop(clipped));
}

async function captureRecordSource(): Promise<CaptureResult> {
  const { sources } = await screenSources();
  const src = sources[0];
  if (!src) return { ok: false, error: 'Layar tidak tersedia' };
  // Exclude the island window from its own recording (Windows 10 2004+).
  hooks.protect(true);
  return { ok: true, sourceId: src.id };
}

function stopRecording(data: ArrayBuffer): CaptureResult {
  hooks.protect(false);
  if (!(data instanceof ArrayBuffer) || data.byteLength === 0) {
    return { ok: false, error: 'Rekaman kosong' };
  }
  const path = join(outDir('video'), fileName('webm'));
  writeFileSync(path, Buffer.from(data));
  return { ok: true, path };
}

export function registerCapture(next: Hooks): void {
  hooks = next;
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const { sources } = await screenSources();
      if (sources.length === 0) { callback({}); return; }
      callback({ video: sources[0] });
    } catch {
      callback({});
    }
  });

  ipcMain.handle('capture:run', async (_e, mode: string): Promise<CaptureResult> => {
    // "Show the island" keeps it in the shot; otherwise hide it first so the
    // capture is clean. Recording never hides the window.
    const showIsland = loadSettings().captureShowIsland;
    const needsHide = !showIsland && (mode === 'full' || mode === 'window' || mode === 'area');
    if (needsHide) { hooks.hide(); await settle(140); }
    try {
      if (mode === 'full') return await captureFull();
      if (mode === 'window') return await captureWindow();
      if (mode === 'area') return await captureArea();
      if (mode === 'record') return await captureRecordSource();
      return { ok: false, error: 'Mode tidak dikenal' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      if (needsHide) { await settle(60); hooks.show(); }
    }
  });

  ipcMain.handle('capture:record-stop', (_e, data: ArrayBuffer): CaptureResult => {
    try { return stopRecording(data); }
    catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.on('capture:record-abort', () => hooks.protect(false));
  ipcMain.on('capture:folder', () => void shell.openPath(outDir('shot')));

  ipcMain.on('capture:rect', (_e, rect: Rect | null) => {
    const done = resolveRect;
    resolveRect = null;
    closeOverlay();
    done?.(rect);
  });
}

export function disposeCapture(): void {
  hooks.protect(false);
  closeOverlay();
}
