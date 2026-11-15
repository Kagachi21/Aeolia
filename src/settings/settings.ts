const nav = document.getElementById('nav') as HTMLElement;
const page = document.getElementById('page') as HTMLElement;
const title = document.getElementById('title') as HTMLElement;
const search = document.getElementById('search') as HTMLInputElement;

const PAGES = ['General', 'Appearance', 'Robot', 'Island', 'Panels', 'Keys',
  'Music', 'Meetings', 'Calendar', 'Worship', 'Capture', 'About'];

const SURFACES = ['Black', 'Pure black', 'Graphite', 'Glass', 'Acrylic', 'Rosé', 'Lavender', 'Peach', 'Sakura', 'Candy glass', 'Matcha', 'Aurora', 'Dusk', 'Neon', 'Liquid glass', 'Translucent'];
const GLASS_SURFACES = ['Liquid glass', 'Translucent'];
const PROGRESS_STYLES = ['Wave', 'Pixels', 'Comet', 'Song shape', 'Simple', 'Hearts'];
const ACCENTS = ['#e9eef7', '#ffffff', '#e9c46a', '#6ea8ff', '#b48cff', '#ff6b6b', '#ff9c6b', '#6ee7a0', '#46e0dc', '#ff8fc7', '#c3b1ff', '#ffcba4', '#ffd1dc'];
const ROBOT_EYES = ['#46e0dc', '#6ea8ff', '#b48cff', '#ff8fc7', '#e9c46a', '#ff9c6b', '#ffffff'];
const ACCESSORIES = [
  { value: 'none', label: 'None', desc: 'Eyes only.' },
  { value: 'glasses', label: 'Glasses', desc: 'Looks smart.' },
  { value: 'hat', label: 'Hat', desc: 'Relaxed.' },
  { value: 'headphones', label: 'Headphones', desc: 'A music buddy.' },
];
const MOVEMENTS = [
  { value: 'relaxed', label: 'Relaxed', desc: 'Glances around now and then.' },
  { value: 'cursor', label: 'Follow cursor', desc: 'Pupils follow the pointer.' },
];
const CARD_TABS = [
  { label: 'Web', value: 'web' },
  { label: 'Notifications', value: 'notifications' },
  { label: 'Shelf', value: 'shelf' },
  { label: 'Clipboard', value: 'clipboard' },
  { label: 'Music', value: 'music' },
  { label: 'Today', value: 'today' },
  { label: 'Sholat', value: 'sholat' },
  { label: 'Timer', value: 'timer' },
  { label: 'Reminders', value: 'reminders' },
  { label: 'Water', value: 'water' },
  { label: 'Capture', value: 'capture' },
  { label: 'Controls', value: 'controls' },
  { label: 'Deck', value: 'deck' },
  { label: 'Calls', value: 'calls' },
];

const BAR_ITEMS = [
  { value: 'clock', label: 'Jam' },
  { value: 'cat', label: 'Kucing' },
  { value: 'battery', label: 'Baterai' },
  { value: 'media', label: 'Judul lagu' },
  { value: 'mic', label: 'Tombol mic rapat' },
];

let data: Record<string, unknown> = {};
let currentPage = 'General';

/* The tab picker and the tab order editor edit the same list. A tiny in-page
   bus keeps both views in sync without rebuilding the page (which would steal
   focus from a text field). Listeners drop themselves once their node is gone. */
const visibleTabsListeners = new Set<(list: string[]) => void>();

function publishVisibleTabs(next: string[]): void {
  for (const fn of Array.from(visibleTabsListeners)) fn(next);
}

function onVisibleTabsChange(node: HTMLElement, fn: (list: string[]) => void): void {
  const wrapped = (list: string[]): void => {
    if (!node.isConnected) {
      visibleTabsListeners.delete(wrapped);
      return;
    }
    fn(list);
  };
  visibleTabsListeners.add(wrapped);
}

function row(label: string, desc: string, control: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'row';
  const txt = document.createElement('div');
  txt.className = 'txt';
  const t = document.createElement('label');
  t.className = 't';
  t.textContent = label;
  const d = document.createElement('div');
  d.className = 'd';
  d.textContent = desc;
  txt.append(t, d);
  const ctl = document.createElement('div');
  ctl.className = 'ctl';
  ctl.appendChild(control);
  // The visible row title doubles as the field's label. Button groups keep the
  // title as a caption and get their own aria-label from the factory.
  const field = control.matches('input, select, textarea')
    ? control
    : control.querySelector<HTMLElement>('input, select, textarea');
  if (field) {
    if (!field.id) field.id = `ctl-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    t.htmlFor = field.id;
  }
  el.append(txt, ctl);
  return el;
}

function section(label: string): HTMLElement {
  const h = document.createElement('h2');
  h.className = 'section';
  h.textContent = label;
  return h;
}

async function set(key: string, value: unknown): Promise<void> {
  data = await window.settingsApi.set(key, value);
}

function toggle(key: string): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(data[key]);
  input.addEventListener('change', () => void set(key, input.checked));
  const knob = document.createElement('span');
  wrap.append(input, knob);
  return wrap;
}

function segment(key: string, options: { label: string; value: string | number }[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'seg';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', key);
  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = opt.label;
    b.classList.toggle('on', String(data[key]) === String(opt.value));
    b.addEventListener('click', async () => {
      const value = typeof opt.value === 'number' ? opt.value : opt.value;
      await set(key, value);
      Array.from(wrap.children).forEach((c) => c.classList.toggle('on', c === b));
    });
    wrap.appendChild(b);
  }
  return wrap;
}

function dropdown(key: string, options: string[]): HTMLElement {
  const select = document.createElement('select');
  select.className = 'select';
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    select.appendChild(o);
  }
  select.value = String(data[key] ?? options[0]);
  select.addEventListener('change', () => void set(key, select.value));
  return select;
}

function slider(key: string, min: number, max: number, step: number, suffix: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'range';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(data[key] ?? min);
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = `${input.value}${suffix}`;
  input.addEventListener('input', () => { val.textContent = `${input.value}${suffix}`; });
  input.addEventListener('change', () => void set(key, Number(input.value)));
  wrap.append(input, val);
  return wrap;
}

function swatches(key: string, options: string[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'swatches';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', key);
  options.forEach((hex, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw';
    b.dataset.i = String(i);
    b.title = hex;
    b.classList.toggle('on', String(data[key]).toLowerCase() === hex.toLowerCase());
    b.addEventListener('click', async () => {
      await set(key, hex);
      Array.from(wrap.children).forEach((c) => c.classList.toggle('on', c === b));
    });
    wrap.appendChild(b);
  });
  return wrap;
}

function tabPicker(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'tabpicker';
  const chosen = new Set(Array.isArray(data.visibleTabs) ? (data.visibleTabs as string[]) : []);

  const sync = (list: string[]): void => {
    chosen.clear();
    for (const value of list) chosen.add(value);
    for (const b of Array.from(wrap.querySelectorAll<HTMLButtonElement>('.tabchip'))) {
      const on = chosen.has(b.dataset.tab ?? '');
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };

  for (const tab of CARD_TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tabchip';
    b.dataset.tab = tab.value;
    b.textContent = tab.label;
    const on = chosen.has(tab.value);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', async () => {
      if (chosen.has(tab.value)) chosen.delete(tab.value);
      else chosen.add(tab.value);
      const selected = chosen.has(tab.value);
      b.classList.toggle('on', selected);
      b.setAttribute('aria-pressed', String(selected));
      // Keep the order the user built (by dragging on the card or with the
      // arrows below); only the membership changes here. An empty list is a
      // valid choice and hides every panel tab.
      const current = Array.isArray(data.visibleTabs) ? [...(data.visibleTabs as string[])] : [];
      const next = current.filter((v) => chosen.has(v));
      for (const t of CARD_TABS) if (chosen.has(t.value) && !next.includes(t.value)) next.push(t.value);
      await set('visibleTabs', next);
      publishVisibleTabs(next);
    });
    wrap.appendChild(b);
  }

  onVisibleTabsChange(wrap, sync);
  return wrap;
}

function textField(key: string, placeholder: string, wide = false): HTMLElement {
  const input = document.createElement('input');
  input.className = wide ? 'txtin wide' : 'txtin';
  input.value = String(data[key] ?? '');
  input.placeholder = placeholder;
  input.addEventListener('change', () => void set(key, input.value.trim()));
  return input;
}

function note(msg: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = msg;
  return p;
}

/** Comma-separated editor for a string[] setting. */
function csvField(key: string, placeholder: string): HTMLElement {
  const input = document.createElement('input');
  input.className = 'txtin wide';
  const list = Array.isArray(data[key]) ? (data[key] as string[]) : [];
  input.value = list.join(', ');
  input.placeholder = placeholder;
  input.addEventListener('change', () => {
    const next = input.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 40);
    void set(key, next);
  });
  return input;
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'labeled';
  const t = document.createElement('span');
  t.className = 'labeled-title';
  t.textContent = label;
  wrap.append(t, control);
  return wrap;
}

function textArea(key: string, placeholder: string): HTMLElement {
  const area = document.createElement('textarea');
  area.className = 'txtarea';
  area.value = String(data[key] ?? '');
  area.placeholder = placeholder;
  area.spellcheck = false;
  area.addEventListener('change', () => void set(key, area.value));
  return area;
}

/** Path field with a native picker. Empty means "use the default location". */
function pathField(key: string, kind: 'file' | 'folder'): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pathfield';
  const input = document.createElement('input');
  input.className = 'txtin';
  input.value = String(data[key] ?? '');
  input.placeholder = kind === 'file' ? 'Belum ada berkas dipilih' : 'Bawaan: Pictures/Aeolia';
  input.addEventListener('change', () => void set(key, input.value.trim()));
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'pickbtn';
  pick.textContent = 'Pilih';
  pick.setAttribute('aria-label', 'Pilih lokasi');
  pick.addEventListener('click', async () => {
    const chosen = kind === 'file'
      ? await window.settingsApi.pickFile()
      : await window.settingsApi.pickFolder();
    if (!chosen) return;
    input.value = chosen;
    await set(key, chosen);
  });
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'pickbtn ghost';
  open.textContent = 'Buka';
  open.setAttribute('aria-label', 'Buka lokasi');
  open.addEventListener('click', () => {
    const value = String(data[key] ?? '').trim();
    if (value) window.settingsApi.openPath(value);
  });
  wrap.append(input, pick, open);
  return wrap;
}

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** Small editor for a user's own worship schedule (any religion). */
type WorshipItem = { day: number; time: string; label: string };

function scheduleEditor(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sched';
  const read = (): WorshipItem[] => Array.isArray(data.worshipOther)
    ? (data.worshipOther as WorshipItem[]).map((x) => ({
      day: Number(x.day), time: String(x.time), label: String(x.label),
    }))
    : [];
  const draw = (): void => {
    wrap.replaceChildren();
    read().forEach((item, index) => {
      const line = document.createElement('div');
      line.className = 'sched-row';

      const day = document.createElement('select');
      day.className = 'select';
      DAY_NAMES.forEach((name, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = name;
        day.appendChild(o);
      });
      day.value = String(item.day);
      day.setAttribute('aria-label', 'Hari');

      const time = document.createElement('input');
      time.type = 'time';
      time.className = 'txtin';
      time.value = item.time;
      time.setAttribute('aria-label', 'Jam');

      const label = document.createElement('input');
      label.type = 'text';
      label.className = 'txtin';
      label.value = item.label;
      label.placeholder = 'Nama ibadah';
      label.setAttribute('aria-label', 'Nama ibadah');

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'pickbtn ghost';
      del.textContent = '\u00D7';
      del.setAttribute('aria-label', 'Hapus jadwal');

      const commit = async (): Promise<void> => {
        const next = read();
        next[index] = { day: Number(day.value), time: time.value, label: label.value };
        await set('worshipOther', next);
        draw();
      };
      day.addEventListener('change', () => void commit());
      time.addEventListener('change', () => void commit());
      label.addEventListener('change', () => void commit());
      del.addEventListener('click', async () => {
        await set('worshipOther', read().filter((_, i) => i !== index));
        draw();
      });
      line.append(day, time, label, del);
      wrap.appendChild(line);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'pickbtn';
    add.textContent = '+ Tambah jadwal';
    add.addEventListener('click', async () => {
      const next = read();
      if (next.length >= 20) return;
      next.push({ day: 0, time: '09:00', label: 'Ibadah' });
      await set('worshipOther', next);
      draw();
    });
    wrap.appendChild(add);
  };
  draw();
  return wrap;
}

/** Reorderable list for a string[] setting (bar order / tab order). */
function orderEditor(
  key: string,
  items: { value: string; label: string }[],
  allWhenEmpty = false,
  complete = true,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'order-list';
  const known = items.map((i) => i.value);
  const labelOf = (value: string): string =>
    items.find((i) => i.value === value)?.label ?? value;

  const read = (): string[] => {
    const raw = Array.isArray(data[key]) ? (data[key] as string[]) : [];
    if (allWhenEmpty && raw.length === 0) return [...known];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of raw) {
      if (known.includes(value) && !seen.has(value)) { seen.add(value); out.push(value); }
    }
    // barOrder is a permutation of every item. visibleTabs is a membership
    // list, so completing it here would resurrect tabs the user removed.
    if (complete) {
      for (const value of known) {
        if (!seen.has(value)) { seen.add(value); out.push(value); }
      }
    }
    return out;
  };

  const draw = (): void => {
    wrap.replaceChildren();
    const current = read();

    if (current.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'order-empty';
      empty.textContent = 'Semua tab disembunyikan. Pilih tab di atas, atau tampilkan semuanya lagi. Tombol grid dan Settings tetap ada di kartu. ';
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'pickbtn';
      restore.textContent = 'Tampilkan semua tab';
      restore.addEventListener('click', async () => {
        const next = [...known];
        await set(key, next);
        publishVisibleTabs(next);
        draw();
      });
      empty.appendChild(restore);
      wrap.appendChild(empty);
      return;
    }

    current.forEach((value, index) => {
      const line = document.createElement('div');
      line.className = 'order-row';

      const label = document.createElement('span');
      label.className = 'order-label';
      label.textContent = labelOf(value);

      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'orderbtn';
      up.textContent = '↑';
      up.setAttribute('aria-label', `Naik ${labelOf(value)}`);
      up.disabled = index === 0;
      up.addEventListener('click', async () => {
        if (index === 0) return;
        const next = read();
        const swapped = [...next.slice(0, index - 1), next[index], next[index - 1], ...next.slice(index + 1)];
        await set(key, swapped);
        if (key === 'visibleTabs') publishVisibleTabs(swapped);
        draw();
      });

      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'orderbtn';
      down.textContent = '↓';
      down.setAttribute('aria-label', `Turun ${labelOf(value)}`);
      down.disabled = index === current.length - 1;
      down.addEventListener('click', async () => {
        const next = read();
        if (index >= next.length - 1) return;
        const swapped = [...next.slice(0, index), next[index + 1], next[index], ...next.slice(index + 2)];
        await set(key, swapped);
        if (key === 'visibleTabs') publishVisibleTabs(swapped);
        draw();
      });

      line.append(label, up, down);
      wrap.appendChild(line);
    });
  };

  if (key === 'visibleTabs') {
    onVisibleTabsChange(wrap, (list) => {
      data[key] = [...list];
      draw();
    });
  }

  draw();
  return wrap;
}

/** Live service readout so the Meetings / Calendar pages show real state. */
function serviceStatus(kind: 'meetings' | 'calendar'): HTMLElement {
  const box = document.createElement('div');
  box.className = 'svc-status';
  const paint = (s: ExtrasState): void => {
    if (kind === 'meetings') {
      const lines = [
        s.meeting ? `Rapat aktif: ${s.meetingApp || 'terdeteksi'}, notifikasi ditahan.` : 'Tidak ada rapat terdeteksi.',
        s.online ? 'Internet tersambung.' : 'Internet terputus.',
      ];
      if (s.resumeOffer) lines.push('Ada tawaran untuk melanjutkan musik.');
      box.textContent = lines.join(' ');
    } else {
      const parts: string[] = [];
      parts.push(s.weather
        ? `Cuaca ${s.weather.temp}\u00B0C, ${s.weather.description}.`
        : s.weatherError ? `Cuaca: ${s.weatherError}` : 'Cuaca belum dimuat.');
      const next = s.calendarEvents.find((e) => e.at >= Date.now() - 60000);
      parts.push(next ? `Agenda berikutnya: ${next.title}.` : 'Tidak ada agenda mendatang.');
      if (s.calendarError) parts.push(`Agenda: ${s.calendarError}`);
      box.textContent = parts.join(' ');
    }
  };
  void window.settingsApi.extras().then(paint);
  const timer = window.setInterval(() => {
    // Stop polling once this page has been replaced.
    if (!box.isConnected) { window.clearInterval(timer); return; }
    void window.settingsApi.extras().then(paint);
  }, 6000);
  box.textContent = 'Memuat status layanan…';
  return box;
}

function robotPreview(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'robot-preview';
  const index = ROBOT_EYES.indexOf(String(data.robotEyeColor ?? ''));
  box.dataset.eye = index < 0 ? 'accent' : String(index);
  box.dataset.accent = String(data.accent ?? '#e9eef7');
  const accessory = String(data.robotAccessory ?? 'none');
  const glasses = accessory === 'glasses'
    ? '<circle class="pc-lens" cx="14.5" cy="19.4" r="4.6"/><circle class="pc-lens" cx="25.5" cy="19.4" r="4.6"/><path class="pc-line" d="M19.1 19.4H20.9M10 18.8L6.4 16.8M30 18.8L33.6 16.8"/>'
    : '';
  const hat = accessory === 'hat'
    ? '<path class="pc-hat" d="M12.4 9.4Q20 0.6 27.6 9.4Z"/><rect class="pc-hat-brim" x="7" y="8.2" width="26" height="3.4" rx="1.7"/>'
    : '';
  const phones = accessory === 'headphones'
    ? '<path class="pc-band" d="M7.5 19V15.4A12.5 12.5 0 0 1 32.5 15.4V19"/><rect class="pc-cup" x="3.4" y="17" width="5" height="9" rx="2.5"/><rect class="pc-cup" x="31.6" y="17" width="5" height="9" rx="2.5"/>'
    : '';
  box.innerHTML =
    '<span class="rp-caption">Live preview</span>' +
    '<svg class="pc" viewBox="0 0 40 34" role="img" aria-label="Pratinjau robot">' +
    '<path class="pc-ear" d="M7 13L9 3L17 9Z"/><path class="pc-ear" d="M33 13L31 3L23 9Z"/>' +
    '<rect class="pc-head" x="5" y="9" width="30" height="23" rx="9"/>' +
    '<rect class="pc-eye" x="12.4" y="15" width="4.2" height="9.2" rx="2.1"/>' +
    '<rect class="pc-eye" x="23.4" y="15" width="4.2" height="9.2" rx="2.1"/>' +
    '<path class="pc-nose" d="M18.4 25L21.6 25L20 26.9Z"/>' +
    '<path class="pc-line" d="M20 26.9V28.1M20 28.1Q17.6 30 15.7 28.6M20 28.1Q22.4 30 24.3 28.6"/>' +
    '<path class="pc-line" d="M1 20H5M1 24H5M39 20H35M39 24H35"/>' +
    glasses + hat + phones +
    '</svg>';
  return box;
}

function robotEyeSwatches(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'swatches robot-swatches';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Eye colour');
  const values = ['', ...ROBOT_EYES];
  values.forEach((hex, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = hex ? 'sw' : 'sw sw-accent';
    b.dataset.ri = String(i);
    b.title = hex || 'Follow accent';
    b.setAttribute('aria-label', hex || 'Follow accent');
    const on = String(data.robotEyeColor ?? '') === hex;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('on', on);
    b.addEventListener('click', async () => {
      await set('robotEyeColor', hex);
      Array.from(wrap.children).forEach((c) => {
        const sel = c === b;
        c.classList.toggle('on', sel);
        c.setAttribute('aria-pressed', String(sel));
      });
    });
    wrap.appendChild(b);
  });
  return wrap;
}

function choiceCards(options: { value: string; label: string; desc: string }[], key: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'choice-grid';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', key);
  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice-card';
    const on = String(data[key] ?? '') === opt.value;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('on', on);
    const t = document.createElement('div');
    t.className = 'cc-title';
    t.textContent = opt.label;
    const d = document.createElement('div');
    d.className = 'cc-desc';
    d.textContent = opt.desc;
    b.append(t, d);
    b.addEventListener('click', async () => {
      await set(key, opt.value);
      Array.from(wrap.children).forEach((c) => {
        const sel = c === b;
        c.classList.toggle('on', sel);
        c.setAttribute('aria-pressed', String(sel));
      });
    });
    wrap.appendChild(b);
  }
  return wrap;
}

function sliderSeconds(key: string, minSec: number, maxSec: number, stepSec: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'range';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(minSec);
  input.max = String(maxSec);
  input.step = String(stepSec);
  const msVal = Number(data[key] ?? minSec * 1000);
  input.value = String(Math.round(msVal / 1000));
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = `${input.value} detik`;
  input.addEventListener('input', () => { val.textContent = `${input.value} detik`; });
  input.addEventListener('change', () => void set(key, Number(input.value) * 1000));
  wrap.append(input, val);
  return wrap;
}

function appearancePreview(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'appearance-preview';
  box.dataset.surface = String(data.surface ?? 'Black');
  box.dataset.accent = String(data.accent ?? '#e9eef7');
  box.innerHTML =
    '<span class="ap-caption">Live preview</span>' +
    '<span class="ap-pill"><span class="ap-cat"></span><span class="ap-clock">--:--</span></span>';
  return box;
}

function surfaceCards(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'choice-grid surface-grid';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Theme');
  SURFACES.forEach((name, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice-card surface-card';
    b.dataset.si = String(i);
    const on = String(data.surface ?? 'Black') === name;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('on', on);
    const swatch = document.createElement('span');
    swatch.className = 'sc-swatch';
    const label = document.createElement('span');
    label.className = 'cc-title';
    label.textContent = name;
    b.append(swatch, label);    b.addEventListener('click', async () => {
      await set('surface', name);
      Array.from(wrap.children).forEach((c) => {
        const sel = c === b;
        c.classList.toggle('on', sel);
        c.setAttribute('aria-pressed', String(sel));
      });
    });
    wrap.appendChild(b);
  });
  return wrap;
}

function renderPage(): void {
  title.textContent = currentPage;
  page.replaceChildren();
  const add = (el: HTMLElement) => page.appendChild(el);

  if (currentPage === 'General') {
    add(section('Startup'));
    add(row('Run at startup', 'Daftarkan Aeolia ke login Windows.', toggle('runAtStartup')));
    add(row('Poll interval', 'Seberapa sering jendela aktif diperiksa.', slider('pollIntervalMs', 200, 1500, 50, ' ms')));
    add(section('Behaviour'));
    add(row('Slim strip under maximized windows', 'Opsional: ciutkan island saat ada jendela maximized. Layar penuh tetap menciutkan island.', toggle('slimStrip')));
    add(row('Hidden until hover', 'Pill tidak terlihat sampai kursor menyentuhnya.', toggle('hiddenUntilHover')));
    add(row('When the island opens', 'Tab yang dibuka saat kartu muncul.', segment('openAction', [
      { label: 'Last tab', value: 'last' }, { label: 'Music', value: 'music' },
    ])));
    add(row('Hover grace', 'Jeda sebelum kartu menutup saat kursor keluar.', slider('hoverIdleResetMs', 0, 600, 20, ' ms')));
  } else if (currentPage === 'Appearance') {
    add(section('Preview'));
    add(appearancePreview());

    add(section('Island style'));
    add(choiceCards([
      { value: 'dynamic', label: 'Dynamic', desc: 'A floating pill with a shadow.' },
      { value: 'notched', label: 'Notched', desc: 'Attached to the top edge of the screen.' },
    ], 'islandStyle'));

    add(section('Theme'));
    add(surfaceCards());

    // Glass thickness only applies to the two glass themes; showing it for
    // every surface would be a dead control.
    if (GLASS_SURFACES.includes(String(data.surface))) {
      add(section('Kekentalan kaca'));
      add(row('Kekentalan', 'Makin tinggi makin solid. Mengikuti material Liquid Glass iOS.', slider('glassLevel', 20, 90, 5, '%')));
    }

    add(section('Island content'));
    add(choiceCards([
      { value: 'clock-battery', label: 'Clock + Battery', desc: 'Great for laptops.' },
      { value: 'clock-robot', label: 'Clock + Robot', desc: 'Great for desktops.' },
      { value: 'robot-only', label: 'Robot only', desc: 'Robot eyes always show.' },
    ], 'islandContent'));

    add(section('Urutan bar'));
    add(note('Atur urutan isi bar seenaknya dengan tombol naik / turun. Item yang sedang disembunyikan tetap mengikuti urutannya saat muncul.'));
    add(orderEditor('barOrder', BAR_ITEMS));

    add(section('Accent color'));
    add(swatches('accent', ACCENTS));

    add(section('Size'));
    add(segment('cardWidth', [
      { label: 'Small', value: 320 },
      { label: 'Medium', value: 360 },
      { label: 'Large', value: 420 },
      { label: 'Extra', value: 520 },
    ]));

    add(section('Ukuran island'));
    /* Auto toggle + a scroll-bar slider, like the reference: the slider is
       the size control, Auto just locks it and follows the screen width. */
    const autoLabel = document.createElement('label');
    autoLabel.className = 'switch';
    const autoInput = document.createElement('input');
    autoInput.type = 'checkbox';
    autoInput.checked = data.islandScale === 'auto';
    autoInput.setAttribute('aria-label', 'Ukuran otomatis mengikuti lebar layar');
    const autoKnob = document.createElement('span');
    autoLabel.append(autoInput, autoKnob);
    add(row('Otomatis', 'Ukuran island mengikuti lebar layar.', autoLabel));

    const sizeWrap = document.createElement('div');
    sizeWrap.className = 'range size';
    const sizeInput = document.createElement('input');
    sizeInput.type = 'range';
    sizeInput.min = '75';
    sizeInput.max = '130';
    sizeInput.step = '5';
    sizeInput.setAttribute('aria-label', 'Ukuran island dalam persen');
    const sizeVal = document.createElement('span');
    sizeVal.className = 'val';
    const paintFill = (): void => {
      const pct = ((Number(sizeInput.value) - 75) / 55) * 100;
      sizeInput.style.setProperty('--fill', `${pct}%`);
      sizeVal.textContent = `${sizeInput.value}%`;
    };
    const applyAutoState = (): void => {
      sizeInput.disabled = autoInput.checked;
      sizeWrap.classList.toggle('locked', autoInput.checked);
    };
    autoInput.addEventListener('change', () => {
      if (autoInput.checked) {
        void set('islandScale', 'auto');
      } else {
        void set('islandScale', Number(sizeInput.value) || 100);
      }
      applyAutoState();
      paintFill();
      void refreshSizeNote();
    });
    sizeInput.addEventListener('input', paintFill);
    sizeInput.addEventListener('change', () => {
      if (!autoInput.checked) void set('islandScale', Number(sizeInput.value));
    });
    sizeWrap.append(sizeInput, sizeVal);
    // When Auto is on the slider shows what Auto resolves to right now.
    // Probe harnesses may mock settingsApi without screenInfo; fall back to
    // the stored value then.
    const sizeInfo = window.settingsApi.screenInfo;
    void (typeof sizeInfo === 'function'
      ? sizeInfo.call(window.settingsApi)
      : Promise.reject(new Error('screenInfo unavailable'))).then((info) => {
      if (info.islandScale === 'auto') sizeInput.value = String(info.autoScalePct);
      applyAutoState();
      paintFill();
    }).catch(() => {
      if (data.islandScale !== 'auto') sizeInput.value = String(Number(data.islandScale) || 100);
      applyAutoState();
      paintFill();
    });
    add(row('Ukuran', 'Geser untuk memilih ukuran tetap 75-130%.', sizeWrap));

    const sizeNote = note('');
    add(sizeNote);
    const refreshSizeNote = async (): Promise<void> => {
      try {
        const info = await window.settingsApi.screenInfo();
        sizeNote.textContent = info.islandScale === 'auto'
          ? `Menyesuaikan lebar layar secara otomatis. Di layar ini: ${info.autoScalePct}%.`
          : 'Ukuran tetap. Nyalakan Otomatis bila ingin mengikuti lebar layar.';
      } catch {
        sizeNote.textContent = 'Memperbesar pill dan kartu bersama. Notch kecil tidak ikut diskalakan.';
      }
    };
    window.settingsApi.onChange(() => {
      if (sizeNote.isConnected) void refreshSizeNote();
    });
    void refreshSizeNote();

    add(note('Perubahan tampil langsung di kartu tanpa perlu memulai ulang.'));
  } else if (currentPage === 'Robot') {
    add(section('Preview'));
    add(robotPreview());
    add(section('Eye colour'));
    add(row('Eye colour', 'Warna mata kucing. "Follow accent" memakai warna aksen island.', robotEyeSwatches()));
    add(note('Mata merah dipakai untuk peringatan baterai, hijau saat penuh. Warna di atas untuk tampilan biasanya.'));
    add(section('Accessories'));
    add(choiceCards(ACCESSORIES, 'robotAccessory'));
    add(section('Eye movement'));
    add(choiceCards(MOVEMENTS, 'robotEyeMovement'));
    add(section('Behaviour'));
    add(row('Show the robot when idle', 'Sembunyikan kucing saat Anda sedang aktif.', toggle('robotIdleOnly')));
    add(row('Robot holds items', 'Kucing memegang item yang anda seret ke island.', toggle('robotHoldsItems')));
    add(row('Appears after', 'Tunda kemunculan kucing setelah komputer tidak dipakai.', sliderSeconds('robotIdleAfterMs', 5, 120, 5)));
    add(row('Battery expressions', 'Mata merah di bawah 10%, hijau saat penuh atau mengisi daya.', toggle('robotBatteryExpressions')));
    add(note('Aksesori kamera dan mikrofon memerlukan deteksi perangkat dan belum tersedia.'));
  } else if (currentPage === 'Island') {
    add(section('Placement'));
    add(row('Position', 'Posisi island di layar.', segment('islandPosition', [
      { label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }, { label: 'Right', value: 'right' },
    ])));
    add(row('Edge margin', 'Jarak dari tepi atas dan samping.', slider('edgeMargin', 0, 40, 1, ' px')));
    add(note('Saat island mengambang (Jarak dari tepi lebih dari 0), area antara tepi atas layar dan island tetap aktif. Arahkan kursor ke tepi atas untuk membuka kartu.'));
    add(row('Monitor', 'Layar yang dipakai.', segment('monitor', [
      { label: 'Main display', value: 'main' }, { label: 'Display under cursor', value: 'cursor' },
    ])));
    add(section('Timing'));
    add(row('Open delay', 'Kursor harus diam selama ini sebelum kartu terbuka.', slider('openDelayMs', 0, 600, 10, ' ms')));
    add(row('Open delay when busy', 'Jeda lebih lama saat layar penuh atau aplikasi sibuk.', slider('openDelayBusyMs', 0, 1000, 20, ' ms')));
    add(row('Animation speed', 'Durasi animasi buka/tutup.', segment('animationMs', [
      { label: 'Relaxed', value: 400 }, { label: 'Normal', value: 250 }, { label: 'Quick', value: 120 },
    ])));

    add(section('Notch kecil (banyak tab / Word)'));
    add(note('Saat jendela penuh atau aplikasi sibuk, island bisa menyusut jadi notch 14 px. Pilih apa yang ditampilkan di dalamnya.'));
    add(choiceCards([
      { value: 'off', label: 'Off', desc: 'Jangan pernah menyusut; tetap pill penuh.' },
      { value: 'hide', label: 'Hide', desc: 'Notch disembunyikan seluruhnya.' },
      { value: 'clock', label: 'Jam', desc: 'Hanya jam di notch.' },
      { value: 'clock-date', label: 'Jam + tanggal', desc: 'Jam dan tanggal ringkas.' },
      { value: 'cat', label: 'Kucing', desc: 'Hanya kucing di notch.' },
    ], 'miniMode'));
    add(section('Pemicu notch'));
    add(note('Kondisi yang membuat island menyusut. "Aplikasi sibuk" mencakup browser dengan banyak tab dan Word.'));
    add(choiceCards([
      { value: 'fullscreen', label: 'Layar penuh', desc: 'Hanya saat fullscreen.' },
      { value: 'busy', label: 'Aplikasi sibuk', desc: 'Browser, Word, atau fullscreen.' },
      { value: 'maximized', label: 'Maximized', desc: 'Semua jendela maximized.' },
    ], 'miniTrigger'));

    add(section('Kucing'));
    add(row('Sapaan saat dibuka', 'Kucing senyum di tengah sebentar, lalu pindah ke kanan.', toggle('catGreeting')));
    add(row('Kembali ke tengah saat idle', 'Saat komputer tidak dipakai, kucing pindah ke tengah.', toggle('catIdleCenter')));
    add(row('Notch kecil bisa dibuka', 'Saat notch menyusut jadi 14 px, kursor di atasnya tidak lagi membuka kartu, supaya tab di browser tetap bisa diklik.', toggle('miniOpensCard')));
  } else if (currentPage === 'Panels') {
    add(section('Visible tabs'));
    add(note('Pilih tab yang tampil di bilah kartu. Mengosongkan semua menyembunyikan seluruh tab panel; tombol grid dan Settings tetap tersedia di kartu.'));
    add(tabPicker());
    add(section('Urutan tab'));
    add(note('Urutan ini dipakai di bilah tab kartu. Tab yang tidak dipilih tetap bisa dibuka lewat tombol grid.'));
    add(orderEditor('visibleTabs', CARD_TABS.map((t) => ({ value: t.value, label: t.label })), false, false));
    add(note('Urutan juga bisa diubah langsung di kartu: seret ikon tab satu ke tab lain untuk menukar posisinya. Urutan yang diseret akan tersimpan di sini.'));
  } else if (currentPage === 'Keys') {
    add(section('Global shortcuts'));
    add(row('Open or close the island', 'Contoh: Ctrl+Alt+N', textField('hotkeyOpen', 'Ctrl+Alt+N')));
    add(row('Play / pause', 'Contoh: Ctrl+Alt+P', textField('hotkeyPlayPause', 'Ctrl+Alt+P')));
    add(note('Tekan Enter setelah mengetik. Hotkey didaftarkan ulang otomatis.'));
  } else if (currentPage === 'Music') {
    add(section('Tampilan music card'));
    add(row('Lirik di island', 'Tampilkan baris lirik yang sedang berjalan di samping judul saat pill memutar musik.', toggle('pillLyrics')));
    add(row('Visualizer', 'Gaya indikator pemutaran di pill dan music card.', segment('visualizer', [
      { label: 'Pixels', value: 'pixels' }, { label: 'Bars', value: 'bars' },
    ])));
    add(row('Background', 'Warna dasar music card.', segment('musicCardBackground', [
      { label: 'Gradasi aksen', value: 'album' }, { label: 'Polos', value: 'plain' },
    ])));
    add(row('Progress bar', 'Gaya garis kemajuan. Progress mengikuti timeline lirik, bukan posisi lagu.', dropdown('musicCardProgress', PROGRESS_STYLES)));
    add(note('Windows tidak membuka posisi lagu ke aplikasi, jadi kemajuan mengikat ke lirik LRC yang Anda tempel. Tanpa lirik, garis menampilkan keadaan kosong.'));
    add(section('Kecepatan lirik'));
    add(row('Kecepatan', 'Percepat atau pelan-kan berjalannya lirik (0,5× – 2×).', slider('lyricsSpeed', 0.5, 2, 0.1, '\u00D7')));
    add(row('Geser waktu', 'Koreksi bila lirik terlalu cepat atau lambat terhadap lagu.', slider('lyricsOffsetSec', -5, 5, 0.5, ' dtk')));
    add(note('Kedua pengaturan langsung berlaku pada panel Music tanpa memulai ulang. Tekan Mulai di kartu bersamaan dengan lagu yang diputar.'));
    add(section('Teks lirik'));
    add(labeled('Teks lirik (LRC)', textArea('lyricsText', '[00:00.00] Baris pertama\n[00:12.50] Baris kedua\n[00:24.00] Baris ketiga')));
    add(note('Format LRC dengan stempel [menit:detik]. Teks polos juga bisa: tiap baris akan bergulir setiap 4 detik. Windows tidak membuka posisi lagu ke aplikasi, jadi sinkron dimulai dari tombol Mulai.'));
  } else if (currentPage === 'Meetings') {
    add(section('Status'));
    add(serviceStatus('meetings'));
    add(section('Mode rapat'));
    add(row('Deteksi otomatis', 'Kenali rapat dari judul jendela Zoom, Teams, Meet, dan sejenisnya.', toggle('meetingAuto')));
    add(row('Tombol mikrofon', 'Tampilkan tombol bisu satu klik di island saat rapat.', toggle('meetingMicButton')));
    add(row('Abaikan aplikasi', 'Pisahkan dengan koma; nama proses atau judul jendela.', csvField('meetingIgnoreApps', 'Discord.exe, Game launch')));
    add(note('Saat rapat: notifikasi ditahan, kode OTP/verifikasi tetap lewat, dan musik yang sedang diputar dijeda. Windows tidak membuka status mikrofon, jadi deteksi memakai judul jendela.'));
    add(section('Notifikasi'));
    add(row('Klik notifikasi membuka aplikasi', 'Notifikasi WhatsApp/Discord/Telegram dkk. membuka aplikasinya. Nama lain membuka pencarian web; matikan bila tidak mau.', toggle('noticeOpenLinks')));
    add(row('Unduhan selesai', 'Beri tahu saat berkas baru muncul di folder Downloads.', toggle('notifyDownloads')));
    add(row('Internet putus / pulih', 'Pantau koneksi dan beri tahu saat berubah.', toggle('notifyInternet')));
    add(row('Tawarkan lanjut musik', 'Setelah layar dikunci cukup lama, tawarkan memutar lagi.', toggle('notifyResumeMusic')));
    add(note('Notifikasi perangkat Bluetooth belum tersedia: Windows tidak membuka peristiwa pasang/lepas perangkat ke aplikasi. Tombol Bluetooth ada di kartu Controls.'));
  } else if (currentPage === 'Calendar') {
    add(section('Status'));
    add(serviceStatus('calendar'));
    add(section('Cuaca'));
    add(row('Tampilkan cuaca', 'Suhu dan kondisi dari Open-Meteo, mengikuti kota di kartu Sholat.', toggle('weatherEnabled')));
    add(row('Peringatan hujan', 'Beri tahu saat hujan diperkirakan.', toggle('weatherRainAlert')));
    add(section('Agenda'));
    add(row('URL kalender iCal', 'Feed .ics pribadi (Google Calendar / Outlook).', textField('calendarIcalUrl', 'https://…/basic.ics', true)));
    add(row('Hitung mundur agenda', 'Tampilkan sisa waktu menuju acara berikutnya.', toggle('calendarCountdown')));
    add(note('Hanya acara dengan DTSTART dan SUMMARY yang dibaca. Feed dibaca ulang tiap 10 menit; kegagalan jaringan ditampilkan di kartu, tidak menghentikan island.'));
  } else if (currentPage === 'Worship') {
    add(section('Sesuaikan dengan ibadah Anda'));
    add(choiceCards([
      { value: 'prayer', label: 'Jadwal sholat', desc: 'Perkiraan astronomis 5 waktu, 9 kota.' },
      { value: 'other', label: 'Ibadah lain', desc: 'Pakai jadwal Anda sendiri, agama apa pun.' },
      { value: 'off', label: 'Nonaktif', desc: 'Sembunyikan tab ibadah sepenuhnya.' },
    ], 'worshipMode'));
    add(note('Mode "Ibadah lain" memakai daftar di bawah. Nama, hari, dan jam bebas ditentukan, misalnya kebaktian Minggu, puja, atau waktu hening.'));

    add(section('Jadwal ibadah sendiri'));
    add(scheduleEditor());

    add(section('Pengingat'));
    add(row('Notifikasi saat waktu ibadah', 'Kirim pengingat tepat pada jadwal.', toggle('worshipRemind')));
    add(row('Hitung mundur', 'Tampilkan sisa waktu di kartu ibadah.', toggle('worshipCountdown')));
    add(row('Jeda musik', 'Hentikan musik yang sedang diputar saat ibadah masuk.', toggle('worshipPauseMusic')));
    add(row('Imsak & Iftar', 'Khusus jadwal sholat: tambahkan penanda Imsak (10 menit sebelum Subuh) dan Iftar (Maghrib), serta keterangan saat waktunya tiba.', toggle('worshipImsakIftar')));

    add(section('Adhan / bunyi pengingat'));
    add(row('Mainkan bunyi', 'Putar berkas audio saat waktu ibadah tiba.', toggle('adhanEnabled')));
    add(row('Berkas audio', 'MP3/WAV/OGG/M4A/FLAC dari komputer Anda.', pathField('adhanFile', 'file')));
    add(row('Volume', 'Kerasnya pemutaran adhan.', slider('adhanVolume', 0, 100, 5, '%')));
    add(row('Adhan penuh saat Subuh', 'Matikan bila Subuh cukup bunyi pendek.', toggle('adhanFajr')));
    add(note('Tanpa berkas audio, pengingat memakai bunyi pendek bawaan, tidak ada tombol yang diam. Jadwal sholat adalah perkiraan astronomis, bukan jadwal resmi Kemenag.'));
  } else if (currentPage === 'Capture') {
    add(section('Pintasan'));
    add(row('Ctrl+Shift+S', 'Matikan bila pintasan ini dipakai aplikasi lain.', segment('captureShortcut', [
      { label: 'Aktif', value: 'default' }, { label: 'Mati', value: 'off' },
    ])));
    add(section('Perilaku'));
    add(row('Tampilkan island di hasil', 'Biarkan island ikut tertangkap; bila mati, island disembunyikan dulu.', toggle('captureShowIsland')));
    add(row('Rekam mikrofon', 'Sertakan suara Anda saat merekam layar.', toggle('captureMic')));
    add(row('Salin ke clipboard', 'Gambar hasil tangkapan langsung tersalin.', toggle('captureClipboard')));
    add(section('Penyimpanan'));
    add(row('Folder tangkapan', 'Kosongkan untuk Pictures/Aeolia.', pathField('captureShotDir', 'folder')));
    add(row('Folder rekaman', 'Kosongkan untuk folder yang sama.', pathField('captureVideoDir', 'folder')));
    add(note('Folder yang tidak bisa ditulis otomatis kembali ke Pictures/Aeolia. Clipboard berlaku untuk gambar; berkas rekaman selalu disimpan ke folder.'));
  } else if (currentPage === 'About') {
    add(section('Aeolia Island'));
    add(row('Version', 'Build yang sedang berjalan.', note('1.2.5')));
    add(note('Panel aktif: kalender + tugas, jadwal sholat (perkiraan astronomis, 9 kota), pengingat mata, pengingat minum, capture layar (full/area/window/rekam), timer, dan kontrol sistem.'));
    add(note('Kontrol sistem nyata: brightness lewat DDC/CI, volume dan mute lewat tombol media, CPU/RAM lewat Win32, Clear RAM lewat EmptyWorkingSet.'));
    add(note('Belum aktif: kartu musik (butuh SMTC) dan Deck (butuh penghubung ponsel). Waktu sholat bukan jadwal resmi Kemenag; hari libur keagamaan belum tercantum di kalender.'));
  }
}

function renderNav(): void {
  nav.replaceChildren();
  const q = search.value.trim().toLowerCase();
  for (const name of PAGES) {
    if (q && !name.toLowerCase().includes(q)) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.classList.toggle('active', name === currentPage);
    b.addEventListener('click', () => { currentPage = name; renderNav(); renderPage(); });
    nav.appendChild(b);
  }
}

search.addEventListener('input', renderNav);
document.getElementById('close')?.addEventListener('click', () => window.settingsApi.close());

window.settingsApi.get().then((s) => {
  data = s;
  renderNav();
  renderPage();
});

window.settingsApi.onChange((s) => {
  // Every control updates its own DOM already. Rebuilding the page here would
  // steal focus mid-typing and recreate the status pollers on every keystroke,
  // so keep the state fresh and leave the rendered controls alone.
  data = s;
});
