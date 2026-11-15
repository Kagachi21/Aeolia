/* Headless check for the Win32 foreground-window reader: npm run probe */
import { getActiveWindow, isBusyProcess } from './activeWindow';

const width = Number(process.argv[2] ?? 1920);
const height = Number(process.argv[3] ?? 1080);
const monitor = { x: 0, y: 0, width, height };

let left = 3;
const timer = setInterval(() => {
  const w = getActiveWindow(monitor);
  console.log(
    JSON.stringify({
      process: w.process,
      exe: w.exe,
      maximized: w.maximized,
      fullscreen: w.fullscreen,
      busy: isBusyProcess(w.process),
      rect: w.rect,
    })
  );
  if (--left <= 0) clearInterval(timer);
}, 400);
