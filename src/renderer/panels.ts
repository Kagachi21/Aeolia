/* Calendar, prayer times, eye break, water and capture panels.
   Loaded as a second classic script; all DOM wiring stays in one closure. */
(function () {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const pad = (n: number) => String(n).padStart(2, '0');
  const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
    'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const DAYS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

  let state: CardState | null = null;
  let settings: IslandSettings | null = null;
  let extras: ExtrasState | null = null;
  let calView = new Date();
  let calSelected = new Date();

  /* Fixed-date national holidays. Religious/movable dates are intentionally
     omitted rather than guessed; the agenda says so explicitly. */
  const HOLIDAYS: { m: number; d: number; name: string }[] = [
    { m: 0, d: 1, name: 'Tahun Baru Masehi' },
    { m: 4, d: 1, name: 'Hari Buruh' },
    { m: 4, d: 20, name: 'Hari Kebangkitan Nasional' },
    { m: 5, d: 1, name: 'Hari Lahir Pancasila' },
    { m: 7, d: 17, name: 'HUT Kemerdekaan RI' },
    { m: 11, d: 25, name: 'Libur Natal' },
  ];

  const holidayOn = (d: Date) =>
    HOLIDAYS.find((h) => h.m === d.getMonth() && h.d === d.getDate());

  function nextHoliday(from: Date): { date: Date; name: string; days: number } | null {
    const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    for (let year = from.getFullYear(); year <= from.getFullYear() + 1; year++) {
      for (const h of HOLIDAYS) {
        const date = new Date(year, h.m, h.d);
        const at = Date.UTC(year, h.m, h.d);
        const days = Math.round((at - start) / 86400000);
        if (days >= 0) return { date, name: h.name, days };
      }
    }
    return null;
  }

  /* ---------- Calendar ---------- */
  function renderCalendar(): void {
    const today = new Date();
    const year = calView.getFullYear();
    const month = calView.getMonth();
    $('calDate').textContent = `${DAYS_SHORT[today.getDay()]}, ${today.getDate()} ${MONTHS_ID[today.getMonth()]} ${today.getFullYear()}`;
    $('calCity').textContent = `\u25CF ${state?.prayerCity ?? 'Jakarta'}`;
    $('calMonth').textContent = `${MONTHS_ID[month]} ${year}`;

    const grid = $('calGrid');
    grid.replaceChildren();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const start = new Date(year, month, 1 - offset);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cal-cell';
      b.textContent = String(d.getDate());
      if (d.getMonth() !== month) b.classList.add('muted');
      if (d.toDateString() === today.toDateString()) b.classList.add('today');
      if (holidayOn(d)) b.classList.add('holiday');
      if (d.toDateString() === calSelected.toDateString()) b.classList.add('selected');
      b.setAttribute('aria-label', `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`);
      b.addEventListener('click', () => {
        calSelected = d;
        if (d.getMonth() !== month || d.getFullYear() !== year) calView = new Date(d);
        renderCalendar();
      });
      grid.appendChild(b);
    }

    const own = holidayOn(calSelected);
    const upcoming = nextHoliday(today);
    const parts: string[] = [];
    if (own) parts.push(`${own.name} hari ini.`);
    else parts.push('Tidak ada acara.');
    if (upcoming) {
      parts.push(`${upcoming.name} - ${DAYS_SHORT[upcoming.date.getDay()]}, ${upcoming.date.getDate()} ${MONTHS_SHORT[upcoming.date.getMonth()]} (${upcoming.days} hari lagi)`);
    }
    parts.push('Hari libur keagamaan mengikuti kalender resmi.');
    $('calHoliday').textContent = parts.join(' ');
    $('taskCount').textContent = `${state?.tasks.length ?? 0} tugas`;
  }

  $('calPrev').addEventListener('click', () => {
    calView = new Date(calView.getFullYear(), calView.getMonth() - 1, 1);
    renderCalendar();
  });
  $('calNext').addEventListener('click', () => {
    calView = new Date(calView.getFullYear(), calView.getMonth() + 1, 1);
    renderCalendar();
  });
  $('calToday').addEventListener('click', () => {
    calView = new Date();
    calSelected = new Date();
    renderCalendar();
  });

  /* ---------- Prayer times (astronomical approximation) ---------- */
  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;
  const CITIES: Record<string, { lat: number; lng: number; tz: number }> = {
    'Jakarta': { lat: -6.2088, lng: 106.8456, tz: 7 },
    'Bandung': { lat: -6.9175, lng: 107.6191, tz: 7 },
    'Surabaya': { lat: -7.2575, lng: 112.7521, tz: 7 },
    'Yogyakarta': { lat: -7.7956, lng: 110.3695, tz: 7 },
    'Semarang': { lat: -6.9667, lng: 110.4167, tz: 7 },
    'Medan': { lat: 3.5952, lng: 98.6722, tz: 7 },
    'Makassar': { lat: -5.1477, lng: 119.4327, tz: 8 },
    'Denpasar': { lat: -8.65, lng: 115.2167, tz: 8 },
    'Banda Aceh': { lat: 5.5483, lng: 95.3238, tz: 7 },
  };
  const PRAYER_NAMES = ['Subuh', 'Dzuhur', 'Ashar', 'Maghrib', 'Isya'] as const;

  const dayOfYear = (d: Date) =>
    Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
      Date.UTC(d.getFullYear(), 0, 0)) / 86400000);

  function sunParams(d: Date): { decl: number; eqt: number } {
    const g = 2 * Math.PI / 365 * (dayOfYear(d) - 1);
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
      - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
      - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
      - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    return { decl, eqt };
  }

  function hourAngle(deg: number, lat: number, decl: number): number {
    const c = (Math.sin(-deg * D2R) - Math.sin(lat * D2R) * Math.sin(decl)) /
      (Math.cos(lat * D2R) * Math.cos(decl));
    return Math.acos(Math.max(-1, Math.min(1, c))) * R2D / 15;
  }

  /** Decimal hours in local time; +2/+3 min ihtiyat matches Kemenag rounding. */
  function prayerHours(d: Date, c: { lat: number; lng: number; tz: number }): number[] {
    const { decl, eqt } = sunParams(d);
    const noon = 12 + c.tz - c.lng / 15 - eqt / 60;
    const asrElev = Math.atan(1 / (1 + Math.tan(Math.abs(c.lat - decl * R2D) * D2R))) * R2D;
    const cAsr = (Math.sin(asrElev * D2R) - Math.sin(c.lat * D2R) * Math.sin(decl)) /
      (Math.cos(c.lat * D2R) * Math.cos(decl));
    const asr = noon + Math.acos(Math.max(-1, Math.min(1, cAsr))) * R2D / 15;
    return [
      noon - hourAngle(20, c.lat, decl) + 2 / 60,
      noon + 3 / 60,
      asr + 3 / 60,
      noon + hourAngle(0.833, c.lat, decl) + 3 / 60,
      noon + hourAngle(18, c.lat, decl) + 3 / 60,
    ];
  }

  const fmtTime = (h: number): string => {
    const m = Math.round(h * 60);
    return `${pad(Math.floor(m / 60))}.${pad(m % 60)}`;
  };

  function renderPrayerTimes(): void {
    const name = state?.prayerCity && CITIES[state.prayerCity] ? state.prayerCity : 'Jakarta';
    const c = CITIES[name];
    const now = new Date();
    const hours = prayerHours(now, c);
    const nowH = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;

    let nextIdx = hours.findIndex((h) => h > nowH);
    let nextAt = nextIdx >= 0 ? hours[nextIdx] : NaN;
    let tomorrow = false;
    if (nextIdx < 0) {
      const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      nextAt = prayerHours(tmr, c)[0] + 24;
      nextIdx = 0;
      tomorrow = true;
    }
    const mins = Math.max(0, Math.round((nextAt - nowH) * 60));
    const countdown = mins >= 60
      ? `${Math.floor(mins / 60)}j${mins % 60}m lagi`
      : `${mins}m lagi`;

    $('prayNextName').textContent = PRAYER_NAMES[nextIdx];
    $('prayNextTime').textContent = fmtTime(nextAt % 24);
    $('prayCountdown').textContent = countdown;
    $('prayDate').textContent = `${now.getDate()} ${MONTHS_SHORT[now.getMonth()]} ${now.getFullYear()}`;
    $('prayMoon').textContent = tomorrow || nowH < hours[0] || nowH > hours[4] ? '\u263E' : '\u2600';

    const box = $('prayTimes');
    box.replaceChildren();
    hours.forEach((h, i) => {
      const cell = document.createElement('div');
      cell.className = 'pray-cell' + (i === nextIdx && !tomorrow ? ' next' : '');
      const n = document.createElement('span');
      n.textContent = PRAYER_NAMES[i];
      const v = document.createElement('b');
      v.textContent = fmtTime(h);
      cell.append(n, v);
      box.appendChild(cell);
    });
    const withMarkers = settings?.worshipImsakIftar === true;
    box.classList.toggle('with-markers', withMarkers);
    if (withMarkers) {
      const markers: [string, number][] = [
        ['Imsak', hours[0] - 10 / 60],
        ['Iftar', hours[3]],
      ];
      for (const [label, h] of markers) {
        const cell = document.createElement('div');
        cell.className = 'pray-cell marker';
        const n = document.createElement('span');
        n.textContent = label;
        const v = document.createElement('b');
        v.textContent = fmtTime(h);
        cell.append(n, v);
        box.appendChild(cell);
      }
    }
  }

  $('prayCity').addEventListener('change', (e) => {
    const value = (e.target as HTMLSelectElement).value;
    window.api.patch({ prayerCity: value });
  });

  /* ---------- Shared alarm ---------- */
  let alarmTimer: number | null = null;

  function beep(): void {
    try {
      const Ctx = window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      [0, 0.28].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 740;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.22);
      });
      window.setTimeout(() => void ctx.close(), 900);
    } catch { /* audio unavailable */ }
  }

  function fireAlarm(title: string, body: string, sound: boolean): void {
    window.api.notify(title, body);
    if (sound) beep();
    const btn = $('eyeAlarm');
    btn.classList.add('ringing');
    if (alarmTimer) clearTimeout(alarmTimer);
    alarmTimer = window.setTimeout(() => btn.classList.remove('ringing'), 2600);
  }

  /* ---------- Eye break ---------- */
  let eyeNextAt = 0;
  let lastEyeMin = 30;

  function eyeReschedule(): void {
    const min = state?.eyeBreakMin ?? 0;
    eyeNextAt = min > 0 ? Date.now() + min * 60000 : 0;
  }

  let lastEyeText = '';

  function renderEye(): void {
    const min = state?.eyeBreakMin ?? 0;
    if (min > 0) lastEyeMin = min;
    const on = min > 0;
    const badge = $('eyeState');
    badge.textContent = on ? 'Aktif' : 'Mati';
    badge.classList.toggle('on', on);
    const toggle = $('eyeToggle');
    toggle.textContent = on ? 'On' : 'Off';
    toggle.classList.toggle('active', on);
    for (const b of Array.from($('eyeChips').querySelectorAll<HTMLButtonElement>('[data-min]'))) {
      b.classList.toggle('active', Number(b.dataset.min) === min);
    }
    const left = Math.max(0, Math.ceil((eyeNextAt - Date.now()) / 1000));
    const text = on
      ? `Pengingat berikutnya dalam ${Math.floor(left / 60)}:${pad(left % 60)} · lihat jauh 20 detik.`
      : 'Pengingat mata nonaktif. Pilih interval untuk mengaktifkan.';
    // Only touch the DOM when the countdown actually changes: rewriting this
    // node every second would wake the card's MutationObserver needlessly.
    if (text !== lastEyeText) {
      lastEyeText = text;
      $('eyeText').textContent = text;
    }
  }

  $('eyeToggle').addEventListener('click', () => {
    const min = state?.eyeBreakMin ?? 0;
    window.api.patch({ eyeBreakMin: min > 0 ? 0 : lastEyeMin });
  });
  $('eyeChips').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-min]');
    if (!b) return;
    window.api.patch({ eyeBreakMin: Number(b.dataset.min) });
  });
  $('eyeTry').addEventListener('click', () =>
    fireAlarm('Istirahatkan mata', 'Lihat titik jauh selama 20 detik.', state?.eyeBreakSound ?? true));
  $('eyeAlarm').addEventListener('click', () => beep());

  /* ---------- Water ---------- */
  let waterNextAt = 0;

  function waterReschedule(): void {
    const s = state;
    waterNextAt = s && s.waterEnabled ? Date.now() + s.waterEveryMin * 60000 : 0;
  }

  function renderWater(): void {
    const s = state;
    if (!s) return;
    const goal = s.waterGoalMl;
    const pct = Math.min(100, Math.round(s.waterMl / goal * 100));
    $('waterBar').style.width = `${pct}%`;
    $('waterText').textContent = `${s.waterMl} dari ${goal / 1000}L`;
    const badge = $('waterState');
    badge.textContent = s.waterEnabled ? 'Aktif' : 'Mati';
    badge.classList.toggle('on', s.waterEnabled);
    $('waterToggle').textContent = s.waterEnabled ? 'Matikan' : 'Aktifkan';
    $('wGoal').textContent = `${goal / 1000}L`;
    $('wStart').textContent = `${pad(s.waterStartHour)}.00`;
    $('wEnd').textContent = `${pad(s.waterEndHour)}.00`;
    $('wEvery').textContent = `${s.waterEveryMin} mnt`;
    ($('waterSound') as HTMLInputElement).checked = s.waterSound;

    const slots = Math.max(1, Math.round((s.waterEndHour - s.waterStartHour) * 60 / s.waterEveryMin));
    const per = Math.max(10, Math.round(goal / slots / 10) * 10);
    $('waterSchedule').textContent =
      `${slots} kali sehari, sekitar ${per} ml · ${pad(s.waterStartHour)}.00–${pad(s.waterEndHour)}.00`;
  }

  $('waterAdd').addEventListener('click', () => {
    if (!state) return;
    window.api.patch({ waterMl: state.waterMl + 140, waterDay: todayKey() });
  });
  $('waterToggle').addEventListener('click', () => {
    if (!state) return;
    window.api.patch({ waterEnabled: !state.waterEnabled });
  });
  $('waterTest').addEventListener('click', () =>
    fireAlarm('Waktunya minum', 'Minum segelas air, ya.', state?.waterSound ?? true));
  $('waterSound').addEventListener('change', (e) =>
    window.api.patch({ waterSound: (e.target as HTMLInputElement).checked }));

  document.querySelector('.step-grid')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-w]');
    if (!b || !state) return;
    const s = state;
    const next: Partial<CardState> = {};
    switch (b.dataset.w) {
      case 'goal-': next.waterGoalMl = Math.max(500, s.waterGoalMl - 250); break;
      case 'goal+': next.waterGoalMl = Math.min(5000, s.waterGoalMl + 250); break;
      case 'start-': next.waterStartHour = Math.max(0, s.waterStartHour - 1); break;
      case 'start+': next.waterStartHour = Math.min(s.waterEndHour - 1, s.waterStartHour + 1); break;
      case 'end-': next.waterEndHour = Math.max(s.waterStartHour + 1, s.waterEndHour - 1); break;
      case 'end+': next.waterEndHour = Math.min(23, s.waterEndHour + 1); break;
      case 'every-': next.waterEveryMin = Math.max(15, s.waterEveryMin - 15); break;
      case 'every+': next.waterEveryMin = Math.min(180, s.waterEveryMin + 15); break;
    }
    window.api.patch(next);
  });

  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  /* ---------- Capture ---------- */
  let recorder: MediaRecorder | null = null;
  let recordStream: MediaStream | null = null;
  let chunks: Blob[] = [];

  function capStatus(msg: string): void { $('capStatus').textContent = msg; }

  function stopRecording(): void {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else cleanupRecord();
  }

  function cleanupRecord(): void {
    recordStream?.getTracks().forEach((t) => t.stop());
    recordStream = null;
    recorder = null;
    chunks = [];
    const tile = document.querySelector<HTMLButtonElement>('.cap-rec');
    tile?.classList.remove('recording');
    const label = tile?.querySelector('b');
    if (label) label.textContent = 'Record screen';
    window.api.captureRecordAbort();
  }

  async function startRecording(): Promise<void> {
    const res = await window.api.capture('record');
    if (!res.ok || !res.sourceId) {
      capStatus(res.error ?? 'Gagal memulai rekaman');
      return;
    }
    try {
      // Electron 45 routes getDisplayMedia through setDisplayMediaRequestHandler;
      // the older chromeMediaSource path remains as a fallback.
      let stream: MediaStream;
      if (navigator.mediaDevices.getDisplayMedia) {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } else {
        const constraints = {
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: res.sourceId,
              maxFrameRate: 30,
            },
          },
        } as unknown as MediaStreamConstraints;
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      }
      // Optional microphone narration. A denied permission must not abort the
      // recording, so the audio request is isolated from the video stream.
      let micNote = '';
      if (settings?.captureMic) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          mic.getAudioTracks().forEach((track) => stream.addTrack(track));
          micNote = ' · dengan mikrofon';
        } catch {
          micNote = ' · mikrofon ditolak, rekaman tanpa suara';
        }
      }
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recordStream = stream;
      recorder = rec;
      chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: mime || 'video/webm' });
        const buf = await blob.arrayBuffer();
        const saved = await window.api.captureRecordStop(buf);
        capStatus(saved.ok ? `Tersimpan: ${saved.path?.split('\\').pop()}` : (saved.error ?? 'Gagal menyimpan'));
        cleanupRecord();
      };
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      });
      rec.start(1000);
      const tile = document.querySelector<HTMLButtonElement>('.cap-rec');
      tile?.classList.add('recording');
      const label = tile?.querySelector('b');
      if (label) label.textContent = 'Stop recording';
      capStatus(`Merekam layar… klik lagi untuk berhenti.${micNote}`);
    } catch (err) {
      capStatus(`Rekaman tidak tersedia: ${err instanceof Error ? err.message : String(err)}`);
      cleanupRecord();
    }
  }

  async function runCapture(mode: CaptureMode): Promise<void> {
    if (mode === 'record') {
      if (recorder && recorder.state !== 'inactive') stopRecording();
      else await startRecording();
      return;
    }
    const res = await window.api.capture(mode);
    capStatus(res.ok ? `Tersimpan: ${res.path?.split('\\').pop()}` : (res.error ?? 'Gagal'));
  }

  document.querySelector('.cap-grid')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cap]');
    if (b) void runCapture(b.dataset.cap as CaptureMode);
  });
  $('capFolder').addEventListener('click', () => window.api.openCaptureFolder());
  window.api.onCaptureHotkey((mode) => void runCapture(mode as CaptureMode));

  /* ---------- Worship: any religion, or none ---------- */
  const PRAYER_HINT = 'Perkiraan astronomis (Fajr 20°, Isha 18°). Bukan jadwal resmi Kemenag; untuk ibadah gunakan sumber resmi.';
  const CUSTOM_HINT = 'Jadwal ibadah Anda sendiri. Atur hari, jam, dan nama di Settings > Worship.';

  function worshipSlots(): { label: string; minutes: number; fajr: boolean }[] {
    if (!settings || settings.worshipMode === 'off') return [];
    if (settings.worshipMode === 'other') {
      const today = new Date().getDay();
      return (settings.worshipOther ?? [])
        .filter((x) => x.day === today)
        .map((x) => {
          const [h, m] = String(x.time).split(':').map(Number);
          return { label: x.label || 'Ibadah', minutes: h * 60 + m, fajr: false };
        })
        .filter((x) => Number.isFinite(x.minutes))
        .sort((a, b) => a.minutes - b.minutes);
    }
    const name = state?.prayerCity && CITIES[state.prayerCity] ? state.prayerCity : 'Jakarta';
    const hours = prayerHours(new Date(), CITIES[name]);
    return PRAYER_NAMES.map((label, i) => ({
      label, minutes: Math.round(hours[i] * 60), fajr: i === 0,
    }));
  }

  /** Across the next 8 days, so the panel is never empty just because today
      has no service. Alarm scheduling still uses today's slots only. */
  function upcomingWorship(limit = 5): { label: string; at: number; dayTag: string }[] {
    const now = new Date();
    const out: { label: string; at: number; dayTag: string }[] = [];
    for (let d = 0; d <= 7; d++) {
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      for (const item of settings?.worshipOther ?? []) {
        if (item.day !== base.getDay()) continue;
        const [h, m] = String(item.time).split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
        const at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0).getTime();
        if (at < now.getTime() - 60000) continue;
        out.push({
          label: item.label || 'Ibadah', at,
          dayTag: d === 0 ? '' : DAYS_SHORT[base.getDay()],
        });
      }
    }
    return out.sort((a, b) => a.at - b.at).slice(0, limit);
  }

  function renderCustomWorship(): void {
    const now = new Date();
    const events = upcomingWorship();
    const next = events[0];
    $('prayNextName').textContent = next?.label ?? 'Ibadah';
    $('prayNextTime').textContent = next
      ? `${pad(new Date(next.at).getHours())}.${pad(new Date(next.at).getMinutes())}`
      : '--:--';
    $('prayCountdown').textContent = next ? countdownTo(next.at) : 'Tidak ada jadwal';
    $('prayDate').textContent = `${now.getDate()} ${MONTHS_SHORT[now.getMonth()]} ${now.getFullYear()}`;
    $('prayMoon').textContent = '\u2726';
    $('prayHint').textContent = CUSTOM_HINT;
    const box = $('prayTimes');
    box.replaceChildren();
    box.classList.remove('with-markers');
    events.forEach((ev, i) => {
      const d = new Date(ev.at);
      const cell = document.createElement('div');
      cell.className = 'pray-cell' + (i === 0 ? ' next' : '');
      const n = document.createElement('span');
      n.textContent = ev.dayTag ? `${ev.dayTag} · ${ev.label}` : ev.label;
      const v = document.createElement('b');
      v.textContent = `${pad(d.getHours())}.${pad(d.getMinutes())}`;
      cell.append(n, v);
      box.appendChild(cell);
    });
    if (!events.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Belum ada jadwal. Tambahkan di Settings > Worship.';
      box.appendChild(p);
    }
  }

  function renderWorship(): void {
    const mode = settings?.worshipMode ?? 'prayer';
    if (mode === 'off') return;
    if (mode === 'other') { renderCustomWorship(); return; }
    renderPrayerTimes();
    if (settings?.worshipImsakIftar !== true) {
      $('prayHint').textContent = PRAYER_HINT;
      return;
    }
    const city = state?.prayerCity && CITIES[state.prayerCity] ? state.prayerCity : 'Jakarta';
    const now = new Date();
    const hours = prayerHours(now, CITIES[city]);
    const nowH = now.getHours() + now.getMinutes() / 60;
    const imsak = hours[0] - 10 / 60;
    const maghrib = hours[3];
    let hint = `${PRAYER_HINT} Imsak ${fmtTime(imsak)}, Iftar ${fmtTime(maghrib)}.`;
    if (nowH >= imsak && nowH < hours[0]) {
      const n = Math.max(0, Math.round((hours[0] - nowH) * 60));
      hint = `Imsak: ${n} menit menuju Subuh. ${hint}`;
    } else if (nowH >= maghrib && nowH < hours[4]) {
      hint = `Iftar: waktu berbuka puasa telah tiba. ${hint}`;
    }
    $('prayHint').textContent = hint;
  }

  /* One-shot per worship slot per day. Everything is optional so turning a
     reminder off never leaves a silent no-op behind. */
  let lastWorshipFire = '';

  function playAdhan(isFajr: boolean): void {
    if (!settings?.adhanEnabled) return;
    const file = settings.adhanFile;
    // A subdued chime instead of the full adhan when the user opts out of the
    // dawn recitation (it is longer than the other calls).
    if (!file || (isFajr && !settings.adhanFajr)) { beep(); return; }
    try {
      const url = 'file:///' + file.replace(/\\/g, '/').replace(/^\/+/, '');
      const audio = new Audio(encodeURI(url));
      audio.volume = Math.min(1, Math.max(0, settings.adhanVolume / 100));
      void audio.play().catch(() => beep());
    } catch { beep(); }
  }

  function checkWorshipTime(): void {
    if (!settings || settings.worshipMode === 'off') return;
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    for (const slot of worshipSlots()) {
      if (slot.minutes !== current) continue;
      const key = `${now.toDateString()}|${slot.label}|${slot.minutes}`;
      if (key === lastWorshipFire) continue;
      lastWorshipFire = key;
      if (settings.worshipRemind) window.api.notify('Waktu ibadah', `${slot.label} sudah masuk.`);
      if (settings.worshipPauseMusic) window.api.pauseMedia();
      playAdhan(slot.fajr);
    }
  }

  /* ---------- Lyrics: real LRC timing with speed + offset ---------- */
  type LyricLine = { at: number; text: string };
  let lyricLines: LyricLine[] = [];
  let lyricRunning = false;
  let lyricElapsed = 0;
  let lyricStartedAt = 0;
  let lyricActive = -1;

  /* The pill and the music progress strip both need the live lyric line, but
     the timing state lives in this closure. Expose one read-only snapshot
     function; total is the final stamp so the progress bar only claims real
     data (no invented song duration). */
  (window as unknown as {
    aeoliaLyricNow?: () => { text: string; at: number; total: number; running: boolean };
  }).aeoliaLyricNow = () => {
    const t = lyricNow();
    let idx = -1;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].at <= t) idx = i; else break;
    }
    const total = lyricLines.length ? lyricLines[lyricLines.length - 1].at : 0;
    return {
      text: idx >= 0 ? (lyricLines[idx].text || '\u266A') : '',
      at: Math.max(0, Math.min(t, total || t)),
      total,
      running: lyricRunning,
    };
  };

  function parseLyrics(raw: string): LyricLine[] {    const out: LyricLine[] = [];
    const plain: string[] = [];
    const stamp = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?\]/g;
    for (const line of String(raw ?? '').split(/\r?\n/)) {
      const text = line.trim();
      if (!text) continue;
      const stamps = Array.from(text.matchAll(stamp));
      if (!stamps.length) {
        // [ar:...] / [ti:...] / [offset:...] are metadata, not lyrics.
        if (!/^\[[a-z]+:/i.test(text)) plain.push(text);
        continue;
      }
      // A line may carry several timestamps for the same chorus. Everything
      // after the final stamp is the text; earlier stamps must not leak into it.
      const last = stamps[stamps.length - 1];
      const body = text.slice((last.index ?? 0) + last[0].length).trim();
      for (const m of stamps) {
        const frac = m[3] ? Number(`0.${m[3]}`) : 0;
        out.push({ at: Number(m[1]) * 60 + Number(m[2]) + frac, text: body });
      }
    }
    if (out.length) return out.sort((a, b) => a.at - b.at);
    // Plain text still scrolls: one line every 4 seconds.
    return plain.map((text, i) => ({ at: i * 4, text }));
  }

  function lyricNow(): number {
    const speed = settings?.lyricsSpeed ?? 1;
    const live = lyricRunning ? (performance.now() - lyricStartedAt) / 1000 * speed : 0;
    return lyricElapsed + live + (settings?.lyricsOffsetSec ?? 0);
  }

  function rebuildLyrics(): void {
    // Auto-fetched LRC for the current track wins; the manual paste is the
    // fallback (and the only source when the fetch found nothing).
    lyricLines = parseLyrics(autoLrc ?? settings?.lyricsText ?? '');
    const box = $('lyricLines');
    box.replaceChildren();
    if (!lyricLines.length) {
      const p = document.createElement('p');
      p.className = 'lyric-empty';
      p.textContent = autoTried
        ? 'Lirik tidak ditemukan untuk lagu ini · tempel manual di Settings > Music.'
        : 'Belum ada lirik. Tempel teks LRC di Settings > Music, lalu tekan Mulai bersamaan dengan lagu.';
      box.appendChild(p);
      $('lyricMeta').textContent = 'Belum ada lirik';
      return;
    }
    $('lyricMeta').textContent = `${lyricLines.length} baris · ${lyricLines[0].at === 0 && lyricLines.length > 1 && lyricLines[1].at === 4 ? 'teks polos' : 'LRC'}`;
    lyricLines.forEach((line) => {
      const el = document.createElement('div');
      el.className = 'lyric-line';
      el.textContent = line.text || '\u266A';
      box.appendChild(el);
    });
    lyricActive = -1;
    paintLyrics();
  }

  /* Auto lyrics consumer: renderer.js receives the fetched LRC and calls in.
     A new LRC resets and STARTS the timeline so the lyric runs with the song
     without the manual "Mulai" click. */
  let autoLrc: string | null = null;
  let autoTried = false;
  (window as unknown as { aeoliaAutoLyric?: (lrc: string | null, title: string) => void })
    .aeoliaAutoLyric = (lrc) => {
      autoLrc = lrc;
      autoTried = true;
      if (lrc) {
        lyricElapsed = 0;
        lyricActive = -1;
        lyricStartedAt = performance.now();
        lyricRunning = true;
      }
      rebuildLyrics();
      paintLyricControls();
      paintLyrics();
    };
  // An event that arrived before panels.js loaded is waiting in renderer.js.
  const pendingAuto = (window as unknown as {
    aeoliaAutoLyricPendingGet?: () => { title: string; lrc: string | null } | null;
  }).aeoliaAutoLyricPendingGet?.();
  if (pendingAuto) {
    (window as unknown as { aeoliaAutoLyric?: (lrc: string | null, title: string) => void })
      .aeoliaAutoLyric?.(pendingAuto.lrc, pendingAuto.title);
  }

  function paintLyrics(): void {
    const rows = Array.from($('lyricLines').querySelectorAll<HTMLElement>('.lyric-line'));
    if (!rows.length) { $('lyricLines').style.transform = 'translateY(0)'; return; }
    const t = lyricNow();
    let idx = -1;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].at <= t) idx = i; else break;
    }
    if (idx === lyricActive) return;
    lyricActive = idx;
    rows.forEach((row, i) => row.classList.toggle('active', i === idx));
    $('lyricLines').style.transform = `translateY(${27 - Math.max(0, idx) * 27}px)`;
    $('lyricState').textContent = lyricRunning ? 'Berputar' : lyricElapsed > 0 ? 'Jeda' : 'Berhenti';
    $('lyricState').classList.toggle('on', lyricRunning);
  }

  function paintLyricControls(): void {
    $('lyricPlay').textContent = lyricRunning ? 'Jeda' : lyricElapsed > 0 ? 'Lanjut' : 'Mulai';
    $('lyricState').textContent = lyricRunning ? 'Berputar' : lyricElapsed > 0 ? 'Jeda' : 'Berhenti';
    $('lyricState').classList.toggle('on', lyricRunning);
    $('lyricRate').textContent = `${(settings?.lyricsSpeed ?? 1).toFixed(1).replace('.', ',')}\u00D7`;
  }

  $('lyricPlay').addEventListener('click', () => {
    if (!lyricLines.length) return;
    if (lyricRunning) {
      lyricElapsed += (performance.now() - lyricStartedAt) / 1000 * (settings?.lyricsSpeed ?? 1);
      lyricRunning = false;
    } else {
      lyricStartedAt = performance.now();
      lyricRunning = true;
    }
    paintLyricControls();
    paintLyrics();
  });
  $('lyricReset').addEventListener('click', () => {
    lyricRunning = false;
    lyricElapsed = 0;
    lyricActive = -1;
    paintLyricControls();
    paintLyrics();
  });

  /* ---------- Calendar extras: weather + next iCal event ---------- */
  function countdownTo(at: number): string {
    const mins = Math.max(0, Math.round((at - Date.now()) / 60000));
    return mins >= 60 ? `${Math.floor(mins / 60)}j${pad(mins % 60)}m lagi` : `${mins}m lagi`;
  }

  function renderCalExtras(): void {
    const weather = settings?.weatherEnabled
      ? (extras?.weather
        ? `${extras.weather.temp}\u00B0C · ${extras.weather.description}`
        : extras?.weatherError ? 'Cuaca tidak tersedia' : 'Memuat cuaca…')
      : '';
    const next = (extras?.calendarEvents ?? []).find((e) => e.at >= Date.now() - 60000);
    let agenda = '';
    if (settings?.calendarIcalUrl && next) {
      const d = new Date(next.at);
      const lead = settings.calendarCountdown !== false ? `${countdownTo(next.at)} · ` : '';
      agenda = `${lead}${next.title} · ${pad(d.getHours())}.${pad(d.getMinutes())}`;
    } else if (settings?.calendarIcalUrl && extras?.calendarError) {
      agenda = `Agenda gagal dimuat: ${extras.calendarError}`;
    }
    $('calExtras').hidden = !(weather || agenda);
    $('calWeather').textContent = weather;
    $('calNext').textContent = agenda;
    window.dispatchEvent(new Event('aeolia:measure'));
  }

  function renderCaptureStatus(): void {
    const dir = settings?.captureShotDir || 'Pictures/Aeolia';
    const leaf = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
    const bits = [`Hasil ke ${leaf}`];
    if (settings?.captureClipboard) bits.push('clipboard aktif');
    if (settings?.captureMic) bits.push('mikrofon saat rekam');
    $('capStatus').textContent = bits.join(' · ');
  }

  function applySettings(s: IslandSettings): void {
    settings = s;
    const capHint = document.getElementById('capShortcutHint');
    if (capHint) capHint.hidden = s.captureShortcut === 'off';
    // A hidden panel must not stay active, otherwise the card shows a blank.
    if (s.worshipMode === 'off' && document.querySelector('.panel[data-panel="sholat"].active')) {
      document.querySelector<HTMLButtonElement>('.tab[data-tab="today"]')?.click();
    }
    rebuildLyrics();
    paintLyricControls();
    renderWorship();
    renderCalExtras();
    renderCaptureStatus();
  }

  window.api.getSettings().then(applySettings).catch(() => { /* not ready yet */ });
  window.addEventListener('aeolia:settings', (e) => applySettings((e as CustomEvent<IslandSettings>).detail));
  window.api.getExtras().then((s) => { extras = s; renderCalExtras(); }).catch(() => {});
  window.api.onExtras((s) => { extras = s; renderCalExtras(); });

  /* ---------- State + timers ---------- */
  let lastEyeMinState = 0;
  let lastWaterSig = '';

  function applyState(next: CardState): void {
    state = next;
    const city = CITIES[next.prayerCity] ? next.prayerCity : 'Jakarta';
    ($('prayCity') as HTMLSelectElement).value = city;

    if (next.eyeBreakMin !== lastEyeMinState) {
      lastEyeMinState = next.eyeBreakMin;
      eyeReschedule();
    }
    const sig = `${next.waterEnabled}|${next.waterEveryMin}|${next.waterStartHour}|${next.waterEndHour}`;
    if (sig !== lastWaterSig) {
      lastWaterSig = sig;
      waterReschedule();
    }

    // Daily reset of the water counter.
    if (next.waterDay !== todayKey() && next.waterMl > 0) {
      window.api.patch({ waterMl: 0, waterDay: todayKey() });
      return;
    }
    renderCalendar();
    renderWorship();
    renderEye();
    renderWater();
  }

  window.api.getState().then(applyState);
  window.api.onState(applyState);

  setInterval(() => {
    const s = state;
    if (!s) return;
    const now = new Date();
    if (s.eyeBreakMin > 0 && eyeNextAt > 0 && Date.now() >= eyeNextAt) {
      fireAlarm('Istirahatkan mata', `Sudah ${s.eyeBreakMin} menit. Lihat jauh 20 detik.`, s.eyeBreakSound);
      eyeReschedule();
      renderEye();
    }
    if (s.waterEnabled && waterNextAt > 0 && Date.now() >= waterNextAt &&
        now.getHours() >= s.waterStartHour && now.getHours() < s.waterEndHour) {
      fireAlarm('Waktunya minum', 'Minum segelas air, ya.', s.waterSound);
      waterReschedule();
    }
    renderEye();
    if (now.getSeconds() === 0) {
      renderWorship();
      renderCalExtras();
    }
    checkWorshipTime();
  }, 1000);

  // Lyrics need sub-second resolution so a fast line change is not a second late.
  setInterval(() => { if (lyricRunning) paintLyrics(); }, 200);
  setInterval(renderWorship, 60000);
})();
