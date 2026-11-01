'use strict';
/* =========================================================
   Corkly — a playful pinboard
   ========================================================= */
(async () => {
  // ---------- platform bridge (falls back to localStorage in a plain browser) ----------
  const api = window.corkly || {
    platform: 'web',
    info: async () => ({ imagesBase: '', firebase: window.__corklyFirebase || null }),
    load: async () => { try { return localStorage.getItem('corkly'); } catch { return null; } },
    save: async (j) => { try { localStorage.setItem('corkly', j); } catch {} },
    saveSync: (j) => { try { localStorage.setItem('corkly', j); } catch {} },
    pickImages: null,
    importImage: null,
    imageFromBuffer: null,
    openLink: async (u) => window.open(u, '_blank'),
    exportPng: null,
    mode: new URLSearchParams(location.search).get('mode') === 'widget' ? 'widget' : 'window',
    _settings: { openAtLogin: true, loginAsWidget: true, widgetOnTop: false, closeToTray: true, shortcut: true, shortcutLabel: 'Ctrl + Shift + Space', platform: 'web', packaged: false },
    async getSettings() { return { ...this._settings, mode: this.mode }; },
    async setSettings(p) { Object.assign(this._settings, p); if (p.mode && p.mode !== this.mode) this.setMode(p.mode); return this.getSettings(); },
    async setMode(m) { location.search = m === 'widget' ? '?mode=widget' : ''; },
    async hideWindow() {},
    async openTip() { window.open('https://ko-fi.com/', '_blank'); },
    readImage: null,
    track() {},
    async showWindow() { window.focus(); },
    async pendingJoin() { return null; },
    onJoinLink() {},
    async checkUpdates() { return { state: 'dev' }; },
    async installUpdate() {},
    onUpdate() {},
    async setClean() {},
    onSettingsChanged() {},
    onOpenSettings() {},
  };
  document.body.classList.add('platform-' + api.platform);
  const VIEW_MODE = api.mode === 'widget' ? 'widget' : 'window';
  const VK = VIEW_MODE === 'widget' ? 'widgetView' : 'view';
  document.body.classList.add('view-' + VIEW_MODE);
  const info = await api.info();
  const imagesBase = info.imagesBase || '';

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isMac = api.platform === 'darwin' || /Mac/.test(navigator.platform);
  const mod = (e) => (isMac ? e.metaKey : e.ctrlKey);
  const svgEl = (tag, attrs = {}) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };
  const isEditing = () => {
    const a = document.activeElement;
    return a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  };
  const normalizeUrl = (u) => {
    u = (u || '').trim();
    if (!u) return '';
    if (!/^[a-z]+:\/\//i.test(u) && /^[\w-]+(\.[\w-]+)+/.test(u)) u = 'https://' + u;
    return u;
  };
  const domainOf = (u) => { try { return new URL(normalizeUrl(u)).hostname.replace(/^www\./, ''); } catch { return ''; } };

  // ---------- constants ----------
  const NOTE_COLORS = { yellow: '#ffe97a', pink: '#ffb3c7', mint: '#b8f0c8', blue: '#a9d8ff', orange: '#ffc078', lilac: '#d9c4ff' };
  const PIN_COLORS = ['#e63946', '#2a9d8f', '#f4a261', '#3a86ff', '#9b5de5', '#ffd166', '#06d6a0', '#222222'];
  const TAPES = ['tape-pink', 'tape-mint', 'tape-sun', 'tape-sky'];
  const YARN_COLORS = ['#d62828', '#1d4ed8', '#15803d', '#f59e0b', '#db2777', '#1f1f1f'];
  const TYPES = {
    note: { w: 210, data: () => ({ text: '', color: pick(Object.keys(NOTE_COLORS)) }) },
    card: { w: 300, data: () => ({ title: '', text: '' }) },
    photo: { w: 240, data: () => ({ caption: '' }) },
    list: { w: 260, data: () => ({ title: 'To do', items: [{ id: uid(), text: '', done: false }] }) },
    link: { w: 290, data: () => ({ url: '', title: '' }) },
  };

  // ---------- sound (synthesised, no files) ----------
  const Sound = (() => {
    let ctx;
    let on = true;
    const ac = () => ctx || (ctx = new (window.AudioContext || window.webkitAudioContext)());
    function noise(dur, { freq = 2000, q = 1, gain = 0.3, type = 'bandpass', at = 0 } = {}) {
      const c = ac(); const t = c.currentTime + at;
      const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = gain;
      src.connect(f).connect(g).connect(c.destination); src.start(t);
    }
    function tone(f0, f1, dur, { type = 'sine', gain = 0.2, at = 0 } = {}) {
      const c = ac(); const t = c.currentTime + at;
      const o = c.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
    }
    const fx = {
      pin() { noise(0.03, { freq: 3200, q: 0.8, gain: 0.35 }); tone(190, 60, 0.1, { gain: 0.35 }); },
      lift() { tone(300, 620, 0.07, { gain: 0.1 }); },
      twang() { tone(233, 207, 0.6, { type: 'triangle', gain: 0.16 }); tone(466, 415, 0.4, { gain: 0.05 }); },
      crumple() { for (let i = 0; i < 8; i++) noise(0.05, { freq: rand(700, 4200), q: 0.6, gain: 0.22, at: i * 0.035 }); },
      check() { tone(880, 1400, 0.09, { type: 'triangle', gain: 0.13 }); },
      tada() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.25, { type: 'triangle', gain: 0.11, at: i * 0.08 })); },
      snip() { noise(0.02, { freq: 5200, q: 2, gain: 0.3 }); noise(0.02, { freq: 6400, q: 2, gain: 0.3, at: 0.08 }); },
      pop() { tone(480, 980, 0.08, { gain: 0.13 }); },
      whoosh() { noise(0.3, { freq: 900, q: 0.4, gain: 0.12, type: 'lowpass' }); },
      shake() { for (let i = 0; i < 6; i++) { noise(0.04, { freq: 2600, q: 1, gain: 0.15, at: i * 0.07 }); tone(160, 90, 0.06, { gain: 0.1, at: i * 0.07 }); } },
    };
    return {
      play(n) { if (!on) return; try { fx[n] && fx[n](); } catch {} },
      set(v) { on = v; },
    };
  })();

  // ---------- DOM refs ----------
  const boardEl = $('#board');
  const world = $('#world');
  const stringLayer = $('#stringLayer');
  const yarnTemp = $('#yarnTemp');
  const scissors = $('#scissors');
  const menu = $('#menu');
  const hint = $('#hint');
  const toastEl = $('#toast');

  // ---------- state ----------
  let store;
  let board;
  const els = new Map();     // item id -> element
  const strEls = new Map();  // string id -> svg parts
  let selectedId = null;
  let selectedString = null;
  let mode = 'select';
  let yarnFrom = null;
  let yarnColor = YARN_COLORS[0];
  let history = [];
  let future = [];
  let pointerWorld = { x: 0, y: 0 };

  // Each board remembers its own pan/zoom for the full window and for the widget.
  function vw() {
    if (!board[VK]) { board[VK] = { x: 0, y: 0, zoom: 1 }; board._fit = true; }
    return board[VK];
  }
  const getItem = (id) => board.items.find((i) => i.id === id);
  const topZ = () => board.items.reduce((m, i) => Math.max(m, i.z || 0), 0) + 1;

  function newBoard(name) {
    return { id: uid(), name, bg: 'cork', items: [], strings: [] };
  }

  function makeItem(type, cx, cy, data = {}) {
    const def = TYPES[type];
    const item = {
      id: uid(), type,
      w: def.w, x: Math.round(cx - def.w / 2), y: Math.round(cy - 40),
      rot: +rand(-6, 6).toFixed(1),
      z: topZ(),
      pin: { style: type === 'photo' ? 'tape' : 'pin', color: pick(PIN_COLORS), tape: pick(TAPES) },
      data: { ...def.data(), ...data },
    };
    if (board.cloud) stampAuthor(item);
    board.items.push(item);
    return item;
  }

  function welcomeBoard() {
    const b = newBoard('My first board');
    board = b;
    const n = makeItem('note', 0, -120, { color: 'yellow', text: 'Welcome to Corkly!\nDouble-click the board to add a note.' });
    n.rot = -4;
    const l = makeItem('list', 360, -150, {
      title: 'Try these',
      items: [
        { id: uid(), text: 'Drag me around', done: false },
        { id: uid(), text: 'Right-click anything', done: false },
        { id: uid(), text: 'Tie two things with yarn', done: false },
        { id: uid(), text: 'Drop a photo on the board', done: false },
      ],
    });
    l.rot = 3;
    const c = makeItem('card', -370, -120, { title: 'Big idea', text: 'Index cards are great for\nplans, quotes and recipes.' });
    c.rot = 2;
    const p = makeItem('photo', -40, 230, { caption: 'drop a photo here' });
    p.rot = -2;
    b.strings.push({ id: uid(), from: n.id, to: l.id, color: '#d62828' });
    b.strings.push({ id: uid(), from: n.id, to: p.id, color: '#d62828' });
    return b;
  }

  // ---------- persistence ----------
  async function loadStore() {
    let raw = null;
    try { raw = await api.load(); } catch {}
    try { store = raw ? JSON.parse(raw) : null; } catch { store = null; }
    if (!store || !Array.isArray(store.boards) || !store.boards.length) {
      store = { version: 1, sound: true, boards: [], currentId: null };
      const b = welcomeBoard();
      store.boards.push(b);
      store.currentId = b.id;
    }
  }
  const serialize = () => JSON.stringify(store, (k, v) => (k.startsWith('_') ? undefined : v));
  let saveTimer = null;
  let dirty = false;
  function scheduleSave() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 400);
  }
  async function flushSave() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    dirty = false;
    try { await api.save(serialize()); } catch (e) { console.error(e); }
  }
  window.addEventListener('beforeunload', () => { if (dirty) api.saveSync(serialize()); });

  // ---------- undo / redo ----------
  const snap = () => JSON.stringify({ items: board.items, strings: board.strings, bg: board.bg });
  function resetHistory() { history = [snap()]; future = []; }
  function commit() {
    const s = snap();
    if (history[history.length - 1] !== s) {
      history.push(s);
      if (history.length > 80) history.shift();
      future = [];
    }
    scheduleSave();
    updateHint();
    if (board.cloud) cloudPush(board);
  }
  let commitTimer = null;
  const commitSoon = () => { clearTimeout(commitTimer); commitTimer = setTimeout(commit, 700); };
  function restore(s) {
    const d = JSON.parse(s);
    board.items = d.items; board.strings = d.strings; board.bg = d.bg;
    renderAll();
    scheduleSave();
  }
  function undo() {
    clearTimeout(commitTimer);
    if (history[history.length - 1] !== snap()) commit();
    if (history.length < 2) return toast('Nothing to undo');
    future.push(history.pop());
    restore(history[history.length - 1]);
    Sound.play('whoosh');
  }
  function redo() {
    if (!future.length) return;
    const s = future.pop();
    history.push(s);
    restore(s);
    Sound.play('whoosh');
  }

  // ---------- view (pan / zoom) ----------
  function applyView() {
    const v = vw();
    world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
    boardEl.style.setProperty('--bx', v.x + 'px');
    boardEl.style.setProperty('--by', v.y + 'px');
    boardEl.style.setProperty('--bz', v.zoom);
    world.style.setProperty('--inv-z', 1 / v.zoom);
    $('#zoomPct').textContent = Math.round(v.zoom * 100) + '%';
  }
  function zoomAt(factor, cx, cy) {
    const v = vw();
    const r = boardEl.getBoundingClientRect();
    const px = cx - r.left, py = cy - r.top;
    const nz = clamp(v.zoom * factor, 0.25, 2.5);
    v.x = px - ((px - v.x) * nz) / v.zoom;
    v.y = py - ((py - v.y) * nz) / v.zoom;
    v.zoom = nz;
    applyView();
    scheduleSave();
  }
  function toWorld(cx, cy) {
    const r = boardEl.getBoundingClientRect();
    const v = vw();
    return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom };
  }
  function viewCenter() {
    const r = boardEl.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height * 0.42);
  }
  function fitAll() {
    const r = boardEl.getBoundingClientRect();
    const v = vw();
    if (!board.items.length) { v.zoom = 1; v.x = r.width / 2; v.y = r.height / 2; applyView(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of board.items) {
      const el = els.get(it.id);
      const h = el ? el.offsetHeight : 200;
      x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y - 20);
      x1 = Math.max(x1, it.x + it.w); y1 = Math.max(y1, it.y + h);
    }
    const pad = 80;
    const z = clamp(Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2 - 90) / (y1 - y0)), VIEW_MODE === 'widget' ? 0.55 : 0.25, 1.4);
    v.zoom = z;
    v.x = r.width / 2 - ((x0 + x1) / 2) * z;
    v.y = (r.height - 90) / 2 - ((y0 + y1) / 2) * z;
    world.style.transition = 'transform .45s cubic-bezier(.34,1.3,.64,1)';
    applyView();
    setTimeout(() => (world.style.transition = ''), 460);
    scheduleSave();
  }

  // ---------- rendering items ----------
  function paperHTML(item) {
    const d = item.data;
    switch (item.type) {
      case 'note':
        return `<div class="paper note-paper"><div class="txt" contenteditable="true" data-field="text" data-ph="Write something…"></div></div>`;
      case 'card':
        return `<div class="paper card-paper"><div class="card-title" contenteditable="true" data-single data-field="title" data-ph="Title"></div><div class="card-body" contenteditable="true" data-field="text" data-ph="Notes…"></div></div>`;
      case 'photo':
        return `<div class="paper polaroid"><div class="ph"></div><div class="cap" contenteditable="true" data-single data-field="caption" data-ph="add a caption"></div></div>`;
      case 'list':
        return `<div class="paper list-paper"><div class="pg"><div class="list-title" contenteditable="true" data-single data-field="title" data-ph="List title"></div><ul></ul><button class="add-li">+ add item</button><div class="stamp">DONE!</div></div></div>`;
      case 'link':
        return `<div class="paper ticket"><div class="pg"><div class="tk-top"><img class="fav" alt="" hidden /><span class="tk-dom">link</span><span class="tk-badge">admit one</span></div><div class="tk-title" contenteditable="true" data-single data-field="title" data-ph="Name this link"></div><div class="tk-url" contenteditable="true" data-single data-field="url" data-ph="paste a URL…"></div><div class="tk-foot"><button class="tk-open">OPEN &#8599;</button></div></div></div>`;
    }
    return `<div class="paper"></div>`;
  }

  function buildItem(item, { arrive = false } = {}) {
    const el = document.createElement('div');
    el.className = `item type-${item.type}`;
    el.dataset.id = item.id;
    el.innerHTML = `<div class="fastener"></div>${paperHTML(item)}<div class="resize"></div>`;
    el.querySelectorAll('[data-field]').forEach((f) => { f.textContent = item.data[f.dataset.field] || ''; });
    world.appendChild(el);
    els.set(item.id, el);
    if (item.type === 'list') renderList(item);
    if (item.type === 'photo') renderPhoto(item);
    if (item.type === 'link') renderLinkMeta(item);
    if (board.cloud) {
      if (item.authorName && item.authorId !== myUid()) el.insertAdjacentHTML('beforeend', `<div class="by">— ${esc(item.authorName)}</div>`);
      if (board.cloud.unseen && board.cloud.unseen.includes(item.id)) el.insertAdjacentHTML('beforeend', '<div class="new-sticker">NEW</div>');
      if (!canTouch(item)) {
        el.classList.add('locked');
        el.querySelectorAll('[contenteditable]').forEach((f) => f.setAttribute('contenteditable', 'false'));
      }
    }
    applyItem(item);
    if (arrive) {
      el.classList.add('arrive');
      el.addEventListener('animationend', () => el.classList.remove('arrive'), { once: true });
    }
    return el;
  }

  function applyItem(item) {
    const el = els.get(item.id);
    if (!el) return;
    el.style.left = item.x + 'px';
    el.style.top = item.y + 'px';
    el.style.width = item.w + 'px';
    el.style.zIndex = item.z;
    el.style.setProperty('--rot', item.rot);
    el.style.setProperty('--w', item.w + 'px');
    const f = el.firstElementChild;
    f.className = 'fastener ' + (item.pin.style === 'tape' ? 'tape ' + item.pin.tape : 'pin');
    f.style.setProperty('--pin', item.pin.color);
    if (item.type === 'note') el.querySelector('.paper').style.setProperty('--note', NOTE_COLORS[item.data.color] || NOTE_COLORS.yellow);
    el.classList.toggle('selected', item.id === selectedId);
  }

  function renderList(item, focusId) {
    const el = els.get(item.id);
    const ul = el.querySelector('ul');
    ul.innerHTML = item.data.items.map((li) =>
      `<li data-li="${li.id}" class="${li.done ? 'done' : ''}"><button class="chk" title="Tick"></button><div class="li-txt" contenteditable="true" data-ph="something to do"></div></li>`).join('');
    ul.querySelectorAll('li').forEach((liEl, i) => { liEl.querySelector('.li-txt').textContent = item.data.items[i].text; });
    updateListDone(item, false);
    if (focusId) {
      const t = ul.querySelector(`[data-li="${focusId}"] .li-txt`);
      if (t) { t.focus(); caretToEnd(t); }
    }
  }

  function updateListDone(item, celebrate) {
    const paper = els.get(item.id)?.querySelector('.list-paper');
    if (!paper) return;
    const its = item.data.items.filter((i) => i.text.trim() || i.done);
    const all = its.length > 0 && its.every((i) => i.done);
    const was = paper.classList.contains('all-done');
    paper.classList.toggle('all-done', all);
    if (all && !was && celebrate) {
      Sound.play('tada');
      const r = paper.getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top + r.height / 2);
    }
  }

  function renderPhoto(item) {
    const ph = els.get(item.id).querySelector('.ph');
    const d = item.data;
    const src = d.file && imagesBase ? imagesBase + encodeURIComponent(d.file) : (d.src || d.url);
    const ratio = clamp(d.ratio || 1, 0.6, 1.5);
    ph.style.aspectRatio = `${1} / ${ratio}`;
    if (!src && d.cloudImage) {
      ph.classList.remove('empty');
      ph.innerHTML = '<div class="developing"><span>developing…</span></div>';
      return;
    }
    if (src) {
      ph.classList.remove('empty');
      ph.innerHTML = `<img alt="" draggable="false" src="${esc(src)}" />`;
    } else {
      ph.classList.add('empty');
      ph.innerHTML = `<button class="ph-pick"><svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>choose a photo</button>`;
    }
  }

  function renderLinkMeta(item) {
    const el = els.get(item.id);
    const dom = domainOf(item.data.url);
    el.querySelector('.tk-dom').textContent = dom || 'link';
    const fav = el.querySelector('.fav');
    if (dom) {
      fav.hidden = false;
      fav.onerror = () => { fav.hidden = true; };
      fav.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(dom)}&sz=64`;
    } else fav.hidden = true;
    el.querySelector('.tk-open').disabled = !dom;
  }

  function renderAll() {
    world.querySelectorAll('.item').forEach((e) => e.remove());
    els.clear();
    stringLayer.innerHTML = '';
    strEls.clear();
    selectedId = null;
    selectString(null);
    for (const it of board.items) buildItem(it);
    syncStrings();
    boardEl.className = 'board bg-' + board.bg;
    document.querySelectorAll('.bg-picker button').forEach((b) => b.classList.toggle('active', b.dataset.bg === board.bg));
    $('#boardName').textContent = board.name;
    applyView();
    updateHint();
    if (board._fit) { delete board._fit; requestAnimationFrame(() => requestAnimationFrame(fitAll)); }
  }

  function updateHint() { hint.hidden = board.items.length > 0; }

  // ---------- adding / removing ----------
  function addItem(type, at, data, opts = {}) {
    const p = at || viewCenter();
    const jitter = at ? 0 : 1;
    const item = makeItem(type, p.x + rand(-60, 60) * jitter, p.y + rand(-40, 40) * jitter, data);
    buildItem(item, { arrive: opts.arrive !== false });
    select(item.id);
    Sound.play('pin');
    commit();
    if (opts.focus !== false) {
      const field = els.get(item.id).querySelector(item.type === 'list' ? '.li-txt' : '[contenteditable]');
      if (field && !opts.noFocus) setTimeout(() => { field.focus(); caretToEnd(field); }, 60);
    }
    return item;
  }

  function removeItem(id) {
    if (!canTouch(getItem(id))) return nope(getItem(id));
    const el = els.get(id);
    board.items = board.items.filter((i) => i.id !== id);
    board.strings = board.strings.filter((s) => s.from !== id && s.to !== id);
    els.delete(id);
    if (selectedId === id) selectedId = null;
    if (yarnFrom === id) cancelYarn();
    syncStrings();
    Sound.play('crumple');
    if (el) {
      el.classList.remove('selected', 'lifted', 'arrive', 'swing');
      el.classList.add('crumpling');
      setTimeout(() => el.remove(), 720);
    }
    commit();
  }

  function duplicateItem(id) {
    const src = getItem(id);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    copy.x += 34; copy.y += 34; copy.z = topZ();
    copy.rot = +rand(-6, 6).toFixed(1);
    if (copy.type === 'list') copy.data.items.forEach((i) => (i.id = uid()));
    if (board.cloud) stampAuthor(copy);
    board.items.push(copy);
    buildItem(copy, { arrive: true });
    select(copy.id);
    Sound.play('pop');
    commit();
  }

  async function addPhotos(at) {
    if (api.pickImages) {
      const imgs = await api.pickImages();
      imgs.forEach((img, i) => {
        const p = at || viewCenter();
        addItem('photo', { x: p.x + i * 40, y: p.y + i * 30 }, { file: img.file, ratio: img.ratio }, { noFocus: true });
      });
    } else {
      const input = $('#filePick');
      input.onchange = async () => {
        const files = [...input.files];
        input.value = '';
        for (let i = 0; i < files.length; i++) {
          const p = at || viewCenter();
          await addPhotoFromFile(files[i], { x: p.x + i * 40, y: p.y + i * 30 });
        }
      };
      input.click();
    }
  }

  const readDataUrl = (file) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  const imgRatio = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im.naturalHeight / im.naturalWidth || 1); im.onerror = () => res(1); im.src = src; });

  async function photoDataFromFile(file) {
    if (api.importImage) {
      const r = await api.importImage(file);
      if (r) return { file: r.file, ratio: r.ratio };
    }
    if (api.imageFromBuffer) {
      const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const r = await api.imageFromBuffer(await file.arrayBuffer(), ext);
      return { file: r.file, ratio: r.ratio };
    }
    const src = await readDataUrl(file);
    return { src, ratio: await imgRatio(src) };
  }
  async function addPhotoFromFile(file, at) {
    const data = await photoDataFromFile(file);
    return addItem('photo', at, data, { noFocus: true });
  }
  async function setPhotoOn(item) {
    if (api.pickImages) {
      const [img] = await api.pickImages();
      if (!img) return;
      item.data.file = img.file; item.data.ratio = img.ratio; delete item.data.src; delete item.data.cloudImage;
      renderPhoto(item); Sound.play('pin'); commit();
    } else {
      const input = $('#filePick');
      input.onchange = async () => {
        const f = input.files[0]; input.value = '';
        if (!f) return;
        Object.assign(item.data, await photoDataFromFile(f));
        delete item.data.cloudImage;
        renderPhoto(item); Sound.play('pin'); commit();
      };
      input.click();
    }
  }

  // ---------- selection ----------
  function select(id) {
    if (selectedId === id) return;
    const prev = selectedId && els.get(selectedId);
    if (prev) prev.classList.remove('selected');
    selectedId = id;
    if (id) els.get(id)?.classList.add('selected');
  }

  // ---------- caret helpers ----------
  function caretToEnd(el) {
    const r = document.createRange();
    r.selectNodeContents(el); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function caretAtPoint(el, x, y) {
    el.focus();
    const r = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
    if (r && el.contains(r.startContainer)) {
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    } else caretToEnd(el);
  }

  // ---------- pointer: drag items, pan board, resize ----------
  let drag = null;
  let rightOnFocusedText = false;
  let pan = null;
  let resize = null;

  function beginDrag() {
    const d = drag;
    d.started = true;
    d.item.z = topZ();
    applyItem(d.item);
    d.el.classList.remove('swing', 'arrive');
    d.el.classList.add('lifted');
    document.body.classList.add('dragging');
    if (isEditing()) document.activeElement.blur();
    getSelection().removeAllRanges();
    Sound.play('lift');
  }

  world.addEventListener('pointerdown', (e) => {
    const itemEl = e.target.closest('.item');
    if (!itemEl) return;
    if (e.button === 2) {
      const ed = e.target.closest('[contenteditable]');
      rightOnFocusedText = !!ed && document.activeElement === ed;
      if (!rightOnFocusedText) e.preventDefault(); // don't focus text on right-click
      return;
    }
    if (e.button !== 0) return;
    const item = getItem(itemEl.dataset.id);
    if (!item) return;
    e.stopPropagation();
    closeMenu();
    selectString(null);
    markSeen(item.id);
    if (mode === 'yarn') { e.preventDefault(); yarnClick(item); return; }
    if (!canTouch(item)) {
      select(item.id);
      if (!e.target.closest('.tk-open')) { e.preventDefault(); if (!e.target.closest('button')) nope(item); }
      return;
    }
    if (e.target.closest('.resize')) {
      e.preventDefault();
      select(item.id);
      resize = { item, sx: e.clientX, sy: e.clientY, ow: item.w };
      return;
    }
    if (e.target.closest('button')) { select(item.id); return; }
    const editable = e.target.closest('[contenteditable]');
    select(item.id);
    if (editable && document.activeElement === editable) return;
    e.preventDefault();
    drag = { item, el: itemEl, sx: e.clientX, sy: e.clientY, ox: item.x, oy: item.y, started: false, editable, tilt: 0, vt: 0, lastX: e.clientX };
  });

  boardEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.item, #scissors, .yarn')) return;
    if (e.button === 2) return;
    closeMenu();
    if (isEditing()) document.activeElement.blur();
    if (mode === 'yarn' && yarnFrom) cancelYarn();
    select(null);
    selectString(null);
    pan = { sx: e.clientX, sy: e.clientY, vx: vw().x, vy: vw().y };
    boardEl.classList.add('panning');
  });

  window.addEventListener('pointermove', (e) => {
    pointerWorld = toWorld(e.clientX, e.clientY);
    if (drag) {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.started) {
        if (Math.hypot(dx, dy) < 4) return;
        beginDrag();
      }
      const z = vw().zoom;
      drag.item.x = Math.round(drag.ox + dx / z);
      drag.item.y = Math.round(drag.oy + dy / z);
      drag.vt += (e.clientX - drag.lastX) * 0.7;
      drag.lastX = e.clientX;
      drag.el.style.left = drag.item.x + 'px';
      drag.el.style.top = drag.item.y + 'px';
      kickStrings(drag.item.id, Math.abs(e.movementX) + Math.abs(e.movementY));
    } else if (pan) {
      vw().x = pan.vx + e.clientX - pan.sx;
      vw().y = pan.vy + e.clientY - pan.sy;
      applyView();
    } else if (resize) {
      const z = vw().zoom;
      const d = ((e.clientX - resize.sx) + (e.clientY - resize.sy) * 0.6) / z;
      resize.item.w = Math.round(clamp(resize.ow + d, 150, 620));
      applyItem(resize.item);
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (drag) {
      const d = drag;
      drag = null;
      if (d.started) {
        document.body.classList.remove('dragging');
        d.el.classList.remove('lifted');
        d.el.style.setProperty('--t0', d.tilt.toFixed(2));
        d.el.style.setProperty('--tilt', 0);
        void d.el.offsetWidth;
        d.el.classList.add('swing');
        d.el.addEventListener('animationend', () => d.el.classList.remove('swing'), { once: true });
        kickStrings(d.item.id, 30);
        Sound.play('pin');
        commit();
        if (d.focusAfter) {
          const f = d.el.querySelector(d.item.type === 'list' ? '.li-txt' : '[contenteditable]');
          if (f && d.item.type !== 'photo') { f.focus(); caretToEnd(f); }
          if (d.item.type === 'photo') setPhotoOn(d.item);
        }
      } else if (d.editable) {
        caretAtPoint(d.editable, e.clientX, e.clientY);
      }
    }
    if (pan) { pan = null; boardEl.classList.remove('panning'); scheduleSave(); }
    if (resize) { resize = null; commit(); }
  });

  boardEl.addEventListener('dblclick', (e) => {
    if (e.target.closest('.item, #scissors, .yarn')) return;
    const p = toWorld(e.clientX, e.clientY);
    addItem('note', { x: p.x, y: p.y + 30 });
  });

  boardEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    } else {
      vw().x -= e.deltaX;
      vw().y -= e.deltaY;
      applyView();
      scheduleSave();
    }
  }, { passive: false });

  // ---------- text editing ----------
  world.addEventListener('input', (e) => {
    const t = e.target;
    const itemEl = t.closest('.item');
    if (!itemEl) return;
    const item = getItem(itemEl.dataset.id);
    if (!t.textContent.trim() && !t.querySelector('img')) t.innerHTML = '';
    if (t.dataset.field) {
      item.data[t.dataset.field] = t.innerText.replace(/\n$/, '');
      if (item.type === 'link' && t.dataset.field === 'url') renderLinkMeta(item);
    } else if (t.classList.contains('li-txt')) {
      const li = item.data.items.find((i) => i.id === t.closest('li').dataset.li);
      if (li) li.text = t.innerText.replace(/\n/g, ' ');
    }
    commitSoon();
  });

  world.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t.isContentEditable) return;
    const itemEl = t.closest('.item');
    const item = itemEl && getItem(itemEl.dataset.id);
    if (e.key === 'Escape') { e.stopPropagation(); t.blur(); return; }
    if (t.classList.contains('li-txt') && item) {
      const liId = t.closest('li').dataset.li;
      const idx = item.data.items.findIndex((i) => i.id === liId);
      if (e.key === 'Enter') {
        e.preventDefault();
        const n = { id: uid(), text: '', done: false };
        item.data.items.splice(idx + 1, 0, n);
        renderList(item, n.id);
        commit();
      } else if (e.key === 'Backspace' && !t.textContent && item.data.items.length > 1) {
        e.preventDefault();
        item.data.items.splice(idx, 1);
        renderList(item, item.data.items[Math.max(0, idx - 1)].id);
        commit();
      }
      return;
    }
    if (t.hasAttribute('data-single') && e.key === 'Enter') {
      e.preventDefault();
      if (item && item.type === 'list' && t.classList.contains('list-title')) {
        const first = itemEl.querySelector('.li-txt');
        if (first) { first.focus(); caretToEnd(first); return; }
      }
      t.blur();
    }
  });

  world.addEventListener('pointerover', (e) => {
    const it = e.target.closest('.item');
    if (it && it.querySelector('.new-sticker')) setTimeout(() => markSeen(it.dataset.id), 1200);
  });
  world.addEventListener('focusin', (e) => {
    const it = e.target.closest('.item');
    if (it) { it.classList.add('editing'); select(it.dataset.id); }
  });
  world.addEventListener('focusout', (e) => {
    const it = e.target.closest('.item');
    if (it) it.classList.remove('editing');
    if (e.target.isContentEditable) commit();
  });

  // Plain-text paste inside notes
  world.addEventListener('paste', (e) => {
    const t = e.target.closest('[contenteditable]');
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    let txt = e.clipboardData.getData('text/plain');
    if (t.hasAttribute('data-single') || t.classList.contains('li-txt')) txt = txt.replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, txt);
  });

  // Buttons inside items
  world.addEventListener('click', (e) => {
    const itemEl = e.target.closest('.item');
    if (!itemEl) return;
    const item = getItem(itemEl.dataset.id);
    if (!item || mode === 'yarn') return;
    if (!canTouch(item) && !e.target.closest('.tk-open')) return;
    if (e.target.closest('.chk')) {
      const liEl = e.target.closest('li');
      const li = item.data.items.find((i) => i.id === liEl.dataset.li);
      li.done = !li.done;
      liEl.classList.toggle('done', li.done);
      Sound.play(li.done ? 'check' : 'pop');
      updateListDone(item, true);
      commit();
    } else if (e.target.closest('.add-li')) {
      const n = { id: uid(), text: '', done: false };
      item.data.items.push(n);
      renderList(item, n.id);
      commit();
    } else if (e.target.closest('.tk-open')) {
      const url = normalizeUrl(item.data.url);
      if (url) api.openLink(url);
    } else if (e.target.closest('.ph-pick')) {
      setPhotoOn(item);
    }
  });

  // ---------- yarn ----------
  function setMode(m) {
    mode = m;
    document.body.classList.toggle('mode-yarn', m === 'yarn');
    $('#yarnTool').classList.toggle('active', m === 'yarn');
    $('#yarnColors').classList.toggle('show', m === 'yarn');
    if (m !== 'yarn') cancelYarn();
    if (m === 'yarn') { select(null); toast('Click one thing, then another, to tie them together'); }
  }
  function cancelYarn() {
    if (yarnFrom) els.get(yarnFrom)?.classList.remove('yarn-src');
    yarnFrom = null;
    yarnTemp.setAttribute('d', '');
  }
  function yarnClick(item) {
    if (!yarnFrom) {
      yarnFrom = item.id;
      els.get(item.id).classList.add('yarn-src');
      Sound.play('pop');
      return;
    }
    if (yarnFrom === item.id) { cancelYarn(); return; }
    const a = yarnFrom, b = item.id;
    const exists = board.strings.some((s) => (s.from === a && s.to === b) || (s.from === b && s.to === a));
    if (!exists) {
      const s = { id: uid(), from: a, to: b, color: yarnColor, authorId: myUid() || undefined };
      board.strings.push(s);
      syncStrings();
      const o = strEls.get(s.id);
      o.sag = 0; o.v = 7;
      Sound.play('twang');
      commit();
    }
    cancelYarn();
  }
  function anchor(item) {
    return { x: item.x + item.w / 2, y: item.y + 6 };
  }
  function syncStrings() {
    board.strings = board.strings.filter((s) => getItem(s.from) && getItem(s.to));
    for (const [id, o] of strEls) {
      if (!board.strings.some((s) => s.id === id)) { o.g.remove(); strEls.delete(id); }
    }
    for (const s of board.strings) {
      if (strEls.has(s.id)) continue;
      const g = svgEl('g', { class: 'yarn' });
      g.style.setProperty('--yarn', s.color);
      const parts = {
        g,
        shadow: svgEl('path', { class: 'y-shadow' }),
        main: svgEl('path', { class: 'y-main' }),
        twist: svgEl('path', { class: 'y-twist' }),
        k1: svgEl('circle', { class: 'y-knot', r: 4.5 }),
        k2: svgEl('circle', { class: 'y-knot', r: 4.5 }),
        hit: svgEl('path', { class: 'y-hit' }),
        sag: null, v: 0, d: '', mid: { x: 0, y: 0 },
      };
      g.append(parts.shadow, parts.main, parts.twist, parts.k1, parts.k2, parts.hit);
      parts.hit.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        if (mode === 'yarn') return;
        select(null);
        selectString(s.id);
        Sound.play('pop');
      });
      parts.hit.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        selectString(s.id);
        openStringMenu(s, e.clientX, e.clientY);
      });
      stringLayer.appendChild(g);
      strEls.set(s.id, parts);
    }
  }
  function kickStrings(id, amt) {
    for (const s of board.strings) {
      if (s.from !== id && s.to !== id) continue;
      const o = strEls.get(s.id);
      if (o) o.v = clamp(o.v + amt * 0.05, -14, 14);
    }
  }
  function selectString(id) {
    if (selectedString) strEls.get(selectedString)?.g.classList.remove('selected');
    selectedString = id;
    if (id) strEls.get(id)?.g.classList.add('selected');
    scissors.classList.toggle('show', !!id);
  }
  function cutString(id) {
    const st = board.strings.find((x) => x.id === id);
    if (st && !canTouchString(st)) { selectString(null); return toast('Only the person who tied that string can cut it'); }
    const o = strEls.get(id);
    selectString(null);
    Sound.play('snip');
    board.strings = board.strings.filter((s) => s.id !== id);
    if (o) {
      strEls.delete(id);
      o.g.classList.add('snapping');
      setTimeout(() => o.g.remove(), 360);
    }
    commit();
  }
  scissors.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  scissors.addEventListener('click', () => selectedString && cutString(selectedString));

  // ---------- animation loop (tilt physics + sagging yarn) ----------
  function frame() {
    if (drag && drag.started) {
      drag.tilt += (clamp(drag.vt, -22, 22) - drag.tilt) * 0.22;
      drag.vt *= 0.82;
      drag.el.style.setProperty('--tilt', drag.tilt.toFixed(2));
    }
    for (const s of board.strings) {
      const o = strEls.get(s.id);
      if (!o) continue;
      const A = getItem(s.from), B = getItem(s.to);
      if (!A || !B) continue;
      const a = anchor(A), b = anchor(B);
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const target = Math.min(160, 14 + dist * 0.13);
      if (o.sag === null) o.sag = target;
      o.v += (target - o.sag) * 0.05;
      o.v *= 0.92;
      o.sag += o.v;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 + o.sag * 2;
      const d = `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
      if (d !== o.d) {
        o.d = d;
        o.shadow.setAttribute('d', d); o.main.setAttribute('d', d); o.twist.setAttribute('d', d); o.hit.setAttribute('d', d);
        o.k1.setAttribute('cx', a.x); o.k1.setAttribute('cy', a.y);
        o.k2.setAttribute('cx', b.x); o.k2.setAttribute('cy', b.y);
        o.mid = { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 };
      }
    }
    if (selectedString) {
      const o = strEls.get(selectedString);
      if (o) { scissors.style.left = o.mid.x + 'px'; scissors.style.top = o.mid.y + 'px'; }
    }
    if (mode === 'yarn' && yarnFrom) {
      const A = getItem(yarnFrom);
      if (A) {
        const a = anchor(A), b = pointerWorld;
        const sag = Math.min(120, Math.hypot(b.x - a.x, b.y - a.y) * 0.12);
        yarnTemp.setAttribute('d', `M${a.x},${a.y} Q${(a.x + b.x) / 2},${(a.y + b.y) / 2 + sag * 2} ${b.x},${b.y}`);
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- menus ----------
  function closeMenu() { menu.hidden = true; menu.innerHTML = ''; }
  function openMenu(x, y, entries) {
    menu.innerHTML = '';
    for (const en of entries) {
      if (en === '-') { menu.insertAdjacentHTML('beforeend', '<div class="sep"></div>'); continue; }
      if (en.label && !en.action) { menu.insertAdjacentHTML('beforeend', `<div class="lbl">${esc(en.label)}</div>`); }
      if (en.swatches) {
        const row = document.createElement('div');
        row.className = 'sw';
        for (const sw of en.swatches) {
          const b = document.createElement('button');
          b.title = sw.title || '';
          b.style.background = sw.bg;
          if (sw.cls) b.className = sw.cls;
          if (sw.active) b.classList.add('active');
          b.onclick = () => { sw.action(); closeMenu(); };
          row.appendChild(b);
        }
        menu.appendChild(row);
        continue;
      }
      if (en.action) {
        const b = document.createElement('button');
        b.className = 'mi' + (en.danger ? ' danger' : '') + (en.current ? ' current' : '');
        b.innerHTML = `<span>${esc(en.label)}</span>${en.key ? `<span class="k">${esc(en.key)}</span>` : ''}`;
        b.onclick = () => { closeMenu(); en.action(); };
        menu.appendChild(b);
      }
    }
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = clamp(x, 8, innerWidth - r.width - 8) + 'px';
    menu.style.top = clamp(y, 8, innerHeight - r.height - 8) + 'px';
  }
  const K = (k) => (isMac ? '⌘' : 'Ctrl+') + k;

  function openItemMenu(item, x, y) {
    const entries = [];
    if (!canTouch(item)) {
      entries.push({ label: `pinned by ${item.authorName || 'someone'}` });
      entries.push({ label: 'Tie yarn from here', key: 'Y', action: () => { setMode('yarn'); yarnClick(item); } });
      if (item.type === 'link' && item.data.url) entries.push({ label: 'Open link', action: () => api.openLink(normalizeUrl(item.data.url)) });
      return openMenu(x, y, entries);
    }
    if (item.type === 'note') {
      entries.push({ label: 'paper colour' });
      entries.push({
        swatches: Object.entries(NOTE_COLORS).map(([name, c]) => ({
          bg: c, title: name, active: item.data.color === name,
          action: () => { item.data.color = name; applyItem(item); Sound.play('pop'); commit(); },
        })),
      });
    }
    entries.push({ label: 'pinned with' });
    entries.push({
      swatches: [
        ...PIN_COLORS.map((c) => ({
          bg: `radial-gradient(circle at 35% 30%, #fff9 0 2px, transparent 3px), ${c}`,
          active: item.pin.style === 'pin' && item.pin.color === c,
          action: () => { item.pin.style = 'pin'; item.pin.color = c; applyItem(item); Sound.play('pin'); commit(); },
        })),
        ...TAPES.map((t) => ({
          bg: '', cls: 'tapebtn ' + t, title: 'washi tape',
          active: item.pin.style === 'tape' && item.pin.tape === t,
          action: () => { item.pin.style = 'tape'; item.pin.tape = t; applyItem(item); Sound.play('pop'); commit(); },
        })),
      ],
    });
    entries.push('-');
    if (item.type === 'photo') entries.push({ label: item.data.file || item.data.src ? 'Swap photo…' : 'Choose photo…', action: () => setPhotoOn(item) });
    entries.push({ label: 'Tie yarn from here', key: 'Y', action: () => { setMode('yarn'); yarnClick(item); } });
    entries.push({ label: 'Bring to front', action: () => { item.z = topZ(); applyItem(item); commit(); } });
    entries.push({ label: 'Send to back', action: () => {
      const minZ = board.items.reduce((m, i) => Math.min(m, i.z), Infinity);
      item.z = minZ - 1; applyItem(item); commit();
    } });
    entries.push({ label: 'Give it a wiggle', action: () => { item.rot = +rand(-9, 9).toFixed(1); applyItem(item); jiggle(item); commit(); } });
    entries.push({ label: 'Straighten', action: () => { item.rot = 0; applyItem(item); commit(); } });
    entries.push({ label: 'Duplicate', key: K('D'), action: () => duplicateItem(item.id) });
    entries.push('-');
    entries.push({ label: 'Crumple & toss', key: '⌫', danger: true, action: () => removeItem(item.id) });
    openMenu(x, y, entries);
  }

  function openStringMenu(s, x, y) {
    openMenu(x, y, [
      { label: 'yarn colour' },
      {
        swatches: YARN_COLORS.map((c) => ({
          bg: c, active: s.color === c,
          action: () => { s.color = c; strEls.get(s.id)?.g.style.setProperty('--yarn', c); commit(); },
        })),
      },
      '-',
      { label: 'Cut the string', danger: true, action: () => cutString(s.id) },
    ]);
  }

  function openBoardMenu(x, y) {
    const p = toWorld(x, y);
    openMenu(x, y, [
      { label: 'Sticky note here', key: 'N', action: () => addItem('note', p) },
      { label: 'Index card here', key: 'C', action: () => addItem('card', p) },
      { label: 'Polaroid here', key: 'P', action: () => addPhotos(p) },
      { label: 'Checklist here', key: 'L', action: () => addItem('list', p) },
      { label: 'Link ticket here', key: 'K', action: () => addItem('link', p) },
      '-',
      { label: 'Shake the board!', action: shakeBoard },
      { label: 'Fit everything in view', action: fitAll },
    ]);
  }

  world.addEventListener('contextmenu', (e) => {
    const itemEl = e.target.closest('.item');
    if (!itemEl) return;
    e.stopPropagation();
    if (rightOnFocusedText) return; // let the text field keep its own behaviour
    e.preventDefault();
    const item = getItem(itemEl.dataset.id);
    select(item.id);
    openItemMenu(item, e.clientX, e.clientY);
  });
  boardEl.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    openBoardMenu(e.clientX, e.clientY);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) closeMenu();
  }, true);

  // ---------- fun bits ----------
  function jiggle(item, delay = 0) {
    const el = els.get(item.id);
    if (!el) return;
    setTimeout(() => {
      el.classList.remove('jiggle'); void el.offsetWidth; el.classList.add('jiggle');
      el.addEventListener('animationend', () => el.classList.remove('jiggle'), { once: true });
    }, delay);
  }
  function shakeBoard() {
    Sound.play('shake');
    boardEl.animate([
      { transform: 'translate(0,0)' }, { transform: 'translate(-8px,3px) rotate(-.4deg)' }, { transform: 'translate(7px,-3px) rotate(.4deg)' },
      { transform: 'translate(-5px,2px)' }, { transform: 'translate(3px,-1px)' }, { transform: 'translate(0,0)' },
    ], { duration: 520, easing: 'ease-out' });
    board.items.forEach((it) => {
      if (!canTouch(it)) return jiggle(it, rand(0, 160));
      it.rot = +rand(-8, 8).toFixed(1);
      applyItem(it);
      jiggle(it, rand(0, 160));
      kickStrings(it.id, 80);
    });
    commit();
  }
  function confetti(x, y) {
    const colors = ['#e63946', '#ffd166', '#06d6a0', '#3a86ff', '#9b5de5', '#ff8fab', '#f4a261'];
    for (let i = 0; i < 70; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.background = pick(colors);
      c.style.left = x + 'px'; c.style.top = y + 'px';
      if (Math.random() < 0.3) c.style.borderRadius = '50%';
      document.body.appendChild(c);
      const ang = rand(0, Math.PI * 2), sp = rand(120, 360);
      const dx = Math.cos(ang) * sp, dy = Math.sin(ang) * sp - 180;
      c.animate([
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) rotate(${rand(180, 540)}deg)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${dx}px, ${dy + 420}px) rotate(${rand(540, 1080)}deg)`, opacity: 0 },
      ], { duration: rand(1100, 1700), easing: 'cubic-bezier(.2,.6,.4,1)' }).onfinish = () => c.remove();
    }
  }
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  // ---------- tray (click or drag items onto the board) ----------
  let traySpawn = null;
  document.querySelectorAll('.tool').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const tool = btn.dataset.tool;
      if (tool === 'yarn') return;
      e.preventDefault();
      traySpawn = { tool, sx: e.clientX, sy: e.clientY, done: false };
    });
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (tool === 'yarn') { setMode(mode === 'yarn' ? 'select' : 'yarn'); Sound.play('pop'); return; }
    });
  });
  window.addEventListener('pointermove', (e) => {
    if (!traySpawn || traySpawn.done) return;
    if (Math.hypot(e.clientX - traySpawn.sx, e.clientY - traySpawn.sy) < 8) return;
    traySpawn.done = true;
    if (mode === 'yarn') setMode('select');
    const p = toWorld(e.clientX, e.clientY);
    const item = makeItem(traySpawn.tool, p.x, p.y + 20);
    const el = buildItem(item);
    select(item.id);
    drag = { item, el, sx: e.clientX, sy: e.clientY, ox: item.x, oy: item.y, started: false, editable: null, tilt: 0, vt: 0, lastX: e.clientX, focusAfter: true };
    beginDrag();
  });
  window.addEventListener('pointerup', () => {
    if (!traySpawn) return;
    const t = traySpawn;
    traySpawn = null;
    if (t.done) return; // became a drag; drop handled by the drag code
    if (mode === 'yarn') setMode('select');
    if (t.tool === 'photo') addPhotos();
    else addItem(t.tool);
  });

  const yc = $('#yarnColors');
  YARN_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.style.background = c;
    b.onclick = () => {
      yarnColor = c;
      document.documentElement.style.setProperty('--yarn-color', c);
      yc.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    };
    if (c === yarnColor) b.classList.add('active');
    yc.appendChild(b);
  });
  document.documentElement.style.setProperty('--yarn-color', yarnColor);

  // ---------- top bar ----------
  document.querySelectorAll('.bg-picker button').forEach((b) => {
    b.addEventListener('click', () => {
      if (!canEditBoard()) return toast('Only the board owner (or editors) can change the surface');
      board.bg = b.dataset.bg;
      boardEl.className = 'board bg-' + board.bg;
      document.querySelectorAll('.bg-picker button').forEach((x) => x.classList.toggle('active', x.dataset.bg === board.bg));
      Sound.play('whoosh');
      commit();
    });
  });
  $('#zoomIn').onclick = () => { const r = boardEl.getBoundingClientRect(); zoomAt(1.2, r.left + r.width / 2, r.top + r.height / 2); };
  $('#zoomOut').onclick = () => { const r = boardEl.getBoundingClientRect(); zoomAt(1 / 1.2, r.left + r.width / 2, r.top + r.height / 2); };
  $('#zoomPct').onclick = fitAll;

  const soundBtn = $('#soundBtn');
  function applySound() { Sound.set(store.sound !== false); soundBtn.classList.toggle('off', store.sound === false); }
  soundBtn.onclick = () => { store.sound = store.sound === false; applySound(); Sound.play('pop'); scheduleSave(); };

  $('#exportBtn').onclick = async () => {
    if (!api.exportPng) return toast('Saving as an image works in the desktop app');
    select(null); selectString(null);
    document.body.classList.add('exporting');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));
    try {
      const out = await api.exportPng(board.name);
      if (out) { toast('Snap! Saved your board'); Sound.play('tada'); }
    } finally {
      document.body.classList.remove('exporting');
    }
  };

  // Boards
  const nameEl = $('#boardName');
  function switchBoard(id) {
    flushSave();
    store.currentId = id;
    board = store.boards.find((b) => b.id === id);
    renderAll();
    resetHistory();
    scheduleSave();
    updateUnseenBadge();
    Sound.play('whoosh');
  }
  function renameBoard() {
    if (!canEditBoard()) return toast('Only the board owner (or editors) can rename it');
    nameEl.contentEditable = 'true';
    nameEl.focus();
    const r = document.createRange(); r.selectNodeContents(nameEl);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); nameEl.blur(); }
    e.stopPropagation();
  });
  nameEl.addEventListener('blur', () => {
    if (nameEl.contentEditable !== 'true') return;
    nameEl.contentEditable = 'false';
    board.name = nameEl.textContent.trim() || 'Untitled board';
    nameEl.textContent = board.name;
    scheduleSave();
    if (board.cloud) cloudPush(board);
  });
  $('#boardBtn').addEventListener('click', (e) => {
    if (nameEl.contentEditable === 'true') return;
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(r.left, r.bottom + 10, [
      { label: 'your boards' },
      ...store.boards.map((b) => {
        const n = (b.cloud && b.cloud.unseen && b.cloud.unseen.length) || 0;
        const tag = b.cloud ? (b.cloud.role === 'owner' ? '  · shared' : `  · from ${b.cloud.ownerName || 'a friend'}`) : '';
        return { label: b.name + tag + (n ? `  (${n} new)` : ''), current: b.id === board.id, action: () => b.id !== board.id && switchBoard(b.id) };
      }),
      '-',
      { label: board.cloud ? 'Sharing & people…' : 'Share this board…', action: openShare },
      { label: 'Join a shared board…', action: () => openJoin() },
      '-',
      { label: '+ New board', action: () => {
        const b = newBoard('Board ' + (store.boards.length + 1));
        b.bg = pick(['cork', 'cork', 'felt', 'chalk', 'grid']);
        api.track('board_created', { boards: store.boards.length + 1 });
        store.boards.push(b);
        switchBoard(b.id);
        setTimeout(renameBoard, 50);
      } },
      { label: 'Rename this board', action: renameBoard },
      ...(store.boards.length > 1 && !board.cloud ? [{ label: 'Delete this board', danger: true, action: () => {
        if (!confirm(`Delete "${board.name}" and everything pinned on it?`)) return;
        store.boards = store.boards.filter((b) => b.id !== board.id);
        switchBoard(store.boards[0].id);
      } }] : []),
    ]);
  });
  $('#boardBtn').addEventListener('dblclick', renameBoard);

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (mod(e) && e.key === ',') { e.preventDefault(); openSettings(); return; }
    if (!settingsEl.hidden) { if (e.key === 'Escape') closeSettings(); return; }
    if (isPanelOpen()) { if (e.key === 'Escape') document.querySelector('.panel-close')?.click(); return; }
    if (mod(e) && e.key.toLowerCase() === 'z' && !isEditing()) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod(e) && e.key.toLowerCase() === 'y' && !isEditing()) { e.preventDefault(); redo(); return; }
    if (mod(e) && (e.key === '=' || e.key === '+')) { e.preventDefault(); $('#zoomIn').click(); return; }
    if (mod(e) && e.key === '-') { e.preventDefault(); $('#zoomOut').click(); return; }
    if (mod(e) && e.key === '0') { e.preventDefault(); fitAll(); return; }
    if (isEditing()) return;
    if (mod(e) && e.key.toLowerCase() === 'd') { e.preventDefault(); if (selectedId) duplicateItem(selectedId); return; }
    if (e.key === 'Escape' && document.body.classList.contains('clean') && !selectedId && !selectedString && mode !== 'yarn' && menu.hidden) { setClean(false); return; }
    if (mod(e) && e.key === '\\') { e.preventDefault(); setClean(!document.body.classList.contains('clean')); return; }
    if (e.key === 'Escape') { closeMenu(); select(null); selectString(null); if (mode === 'yarn') setMode('select'); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedString) cutString(selectedString);
      else if (selectedId) removeItem(selectedId);
      return;
    }
    if (mod(e) || e.altKey) return;
    const k = e.key.toLowerCase();
    const map = { n: 'note', c: 'card', l: 'list', k: 'link' };
    if (map[k]) { addItem(map[k], pointerInBoard() ? pointerWorld : null); return; }
    if (k === 'p') { addPhotos(); return; }
    if (k === 'h') { setClean(!document.body.classList.contains('clean')); return; }
    if (k === 'y') { setMode(mode === 'yarn' ? 'select' : 'yarn'); return; }
    if (selectedId && e.key.startsWith('Arrow')) {
      const it = getItem(selectedId);
      const step = e.shiftKey ? 20 : 4;
      if (e.key === 'ArrowLeft') it.x -= step;
      if (e.key === 'ArrowRight') it.x += step;
      if (e.key === 'ArrowUp') it.y -= step;
      if (e.key === 'ArrowDown') it.y += step;
      applyItem(it);
      commitSoon();
      e.preventDefault();
    }
  });
  let lastClient = { x: -1, y: -1 };
  window.addEventListener('pointermove', (e) => { lastClient = { x: e.clientX, y: e.clientY }; });
  function pointerInBoard() {
    const r = boardEl.getBoundingClientRect();
    const t = $('#tray').getBoundingClientRect();
    const inTray = lastClient.x > t.left && lastClient.x < t.right && lastClient.y > t.top;
    return !inTray && lastClient.x > r.left && lastClient.x < r.right && lastClient.y > r.top && lastClient.y < r.bottom;
  }

  // ---------- drag & drop files, paste ----------
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; boardEl.classList.add('dragover'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; boardEl.classList.remove('dragover'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    boardEl.classList.remove('dragover');
    const p = toWorld(e.clientX, e.clientY);
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      for (let i = 0; i < files.length; i++) await addPhotoFromFile(files[i], { x: p.x + i * 40, y: p.y + i * 30 });
      return;
    }
    const text = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
    if (text) pinText(text, p);
  });

  function pinText(text, at) {
    text = text.trim();
    if (!text) return;
    if (/^https?:\/\/\S+$/i.test(text)) {
      addItem('link', at, { url: text, title: domainOf(text) }, { noFocus: true });
    } else {
      addItem('note', at, { text: text.slice(0, 600) }, { noFocus: true });
    }
  }

  document.addEventListener('paste', async (e) => {
    if (isEditing()) return;
    const items = [...(e.clipboardData?.items || [])];
    const img = items.find((i) => i.type.startsWith('image/'));
    if (img) {
      e.preventDefault();
      const f = img.getAsFile();
      if (f) await addPhotoFromFile(f, pointerInBoard() ? pointerWorld : null);
      return;
    }
    const text = e.clipboardData?.getData('text/plain');
    if (text) { e.preventDefault(); pinText(text, pointerInBoard() ? pointerWorld : null); }
  });

  // ---------- desktop widget + settings ----------
  const settingsEl = $('#settings');
  let settings = await api.getSettings();
  const isWebPreview = api.platform === 'web';
  const trayWord = isMac ? 'menu bar' : 'system tray';

  function paintSettings() {
    settingsEl.querySelectorAll('[data-set]').forEach((inp) => { inp.checked = !!settings[inp.dataset.set]; });
    const sub = settingsEl.querySelector('[data-set="loginAsWidget"]').closest('.opt');
    sub.classList.toggle('disabled', !settings.openAtLogin);
    sub.querySelector('input').disabled = !settings.openAtLogin;
    settingsEl.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === VIEW_MODE));
    $('#soundSet').checked = store.sound !== false;
    $('#shortcutLabel').textContent = settings.shortcutLabel;
    $('#trayNote').textContent = `Closing tucks Corkly into the ${trayWord} instead of quitting.`;
    $('#loginNote').textContent = settings.packaged === false && !isWebPreview
      ? 'Saved now — it kicks in once Corkly is installed (not while running from npm start).'
      : 'Your board will be waiting for you every time you log in.';
    $('#webNote').hidden = !isWebPreview;
    $('#statsOpt').hidden = !settings.analyticsAvailable;
    paintAccount();
    document.querySelectorAll('.bg-picker button').forEach((x) => x.classList.toggle('active', x.dataset.bg === board.bg));
  }
  function openSettings() {
    closeMenu();
    paintSettings();
    settingsEl.hidden = false;
    Sound.play('pop');
  }
  function closeSettings() {
    settingsEl.hidden = true;
  }
  settingsEl.addEventListener('change', async (e) => {
    const inp = e.target;
    if (inp.id === 'soundSet') {
      store.sound = inp.checked; applySound(); Sound.play('pop'); scheduleSave();
      return;
    }
    if (!inp.dataset.set) return;
    settings = await api.setSettings({ [inp.dataset.set]: inp.checked });
    Sound.play(inp.checked ? 'check' : 'pop');
    paintSettings();
  });
  settingsEl.addEventListener('pointerdown', (e) => { if (e.target === settingsEl) closeSettings(); });
  $('#settingsDone').onclick = closeSettings;
  $('#settingsBtn').onclick = openSettings;
  settingsEl.querySelectorAll('#modeSeg button').forEach((b) => {
    b.onclick = () => switchViewMode(b.dataset.mode);
  });
  async function switchViewMode(m) {
    if (m === VIEW_MODE) return;
    Sound.play('whoosh');
    await flushSave();
    api.track('mode_switched', { to: m });
    api.setMode(m);
  }
  $('#modeBtn').onclick = () => switchViewMode(VIEW_MODE === 'widget' ? 'window' : 'widget');
  $('#modeBtn').title = VIEW_MODE === 'widget' ? 'Open as a full window' : 'Shrink to a desktop widget';
  $('#hideBtn').onclick = async () => { await flushSave(); api.hideWindow(); };
  api.onSettingsChanged((s) => { settings = s; if (!settingsEl.hidden) paintSettings(); });
  api.onOpenSettings(openSettings);

  // ---------- updates ----------
  const updateNote = $('#updateNote');
  const checkBtn = $('#checkUpdatesBtn');
  $('#versionLabel').textContent = `Corkly ${info.version ? 'v' + info.version : ''}`.trim();
  function showUpdate(s) {
    if (s.state === 'ready' || s.state === 'available') {
      $('#updateText').textContent = s.state === 'ready'
        ? `Corkly ${s.version} is downloaded. Restart to pin it in — your boards stay exactly as they are.`
        : `Corkly ${s.version} is out! Grab the new version — your boards stay exactly as they are.`;
      $('#updateAction').textContent = s.state === 'ready' ? 'Restart & update' : 'Download';
      if (updateNote.hidden) { updateNote.hidden = false; Sound.play('pop'); }
    }
    const labels = {
      checking: 'Checking…', none: 'You’re up to date ✓', downloading: `Downloading ${s.version || ''}…`,
      ready: 'Update ready ✓', available: `Version ${s.version} available`, error: 'Couldn’t check — try later',
      dev: 'Updates work in the installed app',
    };
    if (labels[s.state]) checkBtn.textContent = labels[s.state];
  }
  api.onUpdate(showUpdate);
  checkBtn.onclick = async () => { checkBtn.textContent = 'Checking…'; showUpdate(await api.checkUpdates()); };
  $('#updateAction').onclick = async () => { await flushSave(); api.installUpdate(); };
  $('#updateLater').onclick = () => {
    updateNote.classList.add('leaving');
    setTimeout(() => { updateNote.hidden = true; updateNote.classList.remove('leaving'); }, 350);
  };

  // ---------- tip jar ("buy me a coffee") ----------
  const tipCfg = info.tip || { label: 'Buy me a coffee', nudge: { afterLaunches: 5, afterDays: 3, remindEveryDays: 30 }, enabled: true };
  const tipNudge = $('#tipNudge');
  const DAY = 864e5;
  if (tipCfg.label) document.querySelectorAll('[data-tip]').forEach((b) => (b.textContent = tipCfg.label));
  function hideNudge() {
    if (tipNudge.hidden) return;
    tipNudge.classList.add('leaving');
    setTimeout(() => { tipNudge.hidden = true; tipNudge.classList.remove('leaving'); }, 350);
  }
  function openTip() {
    api.openTip();
    api.track('tip_clicked', {});
    const m = store.meta;
    m.tippedAt = Date.now();
    scheduleSave();
    hideNudge();
    Sound.play('tada');
    confetti(innerWidth / 2, innerHeight / 3);
    toast('Thank you! You just made my day');
  }
  document.querySelectorAll('[data-tip]').forEach((b) => b.addEventListener('click', openTip));
  $('#coffeeBtn').onclick = openTip;
  $('#tipLater').onclick = () => { store.meta.tipPromptedAt = Date.now(); scheduleSave(); hideNudge(); };
  $('#tipNever').onclick = () => { store.meta.tipNever = true; scheduleSave(); hideNudge(); Sound.play('pop'); };
  if (!tipCfg.enabled) {
    // No tip link configured yet — keep the coffee buttons out of sight.
    $('#coffeeBtn').hidden = true;
    document.querySelector('.tip-row').previousElementSibling.hidden = true;
    document.querySelector('.tip-row').hidden = true;
  }
  function maybeNudge() {
    const m = store.meta;
    const n = tipCfg.nudge || {};
    if (!tipCfg.enabled || m.tipNever) return;
    if (m.launches < (n.afterLaunches ?? 5)) return;
    if (Date.now() - m.firstUse < (n.afterDays ?? 3) * DAY) return;
    const last = Math.max(m.tipPromptedAt || 0, m.tippedAt || 0);
    if (last && Date.now() - last < (n.remindEveryDays ?? 30) * DAY) return;
    setTimeout(() => {
      if (!settingsEl.hidden) return;
      tipNudge.hidden = false;
      m.tipPromptedAt = Date.now();
      scheduleSave();
      Sound.play('pop');
    }, 4000);
  }

  // ---------- "just the board" (hide toolbars & frame) ----------
  const cleanKey = VIEW_MODE === 'widget' ? 'cleanWidget' : 'cleanWindow';
  function setClean(on, { quiet = false } = {}) {
    on = !!on;
    const r0 = boardEl.getBoundingClientRect();
    document.body.classList.toggle('clean', on);
    // keep the pinned things exactly where they are on screen while the frame disappears
    const r1 = boardEl.getBoundingClientRect();
    const v = vw();
    v.x += r0.left - r1.left;
    v.y += r0.top - r1.top;
    applyView();
    closeMenu();
    api.setClean(on);
    if (store[cleanKey] !== on) { store[cleanKey] = on; scheduleSave(); }
    if (!quiet) {
      Sound.play('whoosh');
      if (on) {
        toast('Just the board! Press H or tap “Show controls” to bring them back');
        document.body.classList.add('peek-hint');
        setTimeout(() => document.body.classList.remove('peek-hint'), 2600);
      }
    }
  }
  $('#cleanBtn').onclick = () => setClean(true);
  $('#showChromeBtn').onclick = () => setClean(false);

  // =========================================================
  // ---------- shared boards (Firebase) ----------
  // =========================================================
  const Cloud = window.CorklyCloud && info.firebase && window.CorklyCloud.init(info.firebase) ? window.CorklyCloud : null;
  let cloudUser = null;
  const watchers = new Map(); // cloud board id -> unsubscribe
  let myBoardsUnsub = null;
  const myUid = () => (cloudUser ? cloudUser.uid : null);
  const stable = (v) => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val)
    ? Object.keys(val).sort().reduce((o, key) => { o[key] = val[key]; return o; }, {}) : val));

  function canTouch(item, b = board) {
    const c = b && b.cloud;
    if (!c || c.role !== 'pin') return true;
    return !!item && item.authorId === myUid();
  }
  const canTouchString = (s, b = board) => !b.cloud || b.cloud.role !== 'pin' || s.authorId === myUid();
  const canEditBoard = (b = board) => !b.cloud || b.cloud.role !== 'pin';
  function nope(item) {
    Sound.play('pop');
    toast(item && item.authorName ? `Only ${item.authorName} (or the board owner) can change that one` : 'You can add things here, but not change this');
  }

  function stampAuthor(item) {
    if (!board.cloud || !cloudUser) return;
    item.authorId = cloudUser.uid;
    item.authorName = cloudUser.name;
    item.createdAt = Date.now();
  }

  // What gets stored in the cloud for an item (no local file names, no huge data URLs)
  function toCloudItem(item) {
    const data = { ...item.data };
    delete data.file;
    if (data.src && /^(data|blob):/.test(String(data.src))) delete data.src;
    return {
      id: item.id, type: item.type, x: item.x, y: item.y, w: item.w, rot: item.rot, z: item.z,
      pin: item.pin, data,
      authorId: item.authorId || null, authorName: item.authorName || null, createdAt: item.createdAt || null,
    };
  }
  const toCloudString = (s) => ({ id: s.id, from: s.from, to: s.to, color: s.color, authorId: s.authorId || null });
  const syncOf = (b) => b._sync || (b._sync = { items: new Map(), strings: new Map(), meta: '', ready: false, uploading: new Set() });

  function cloudFail(e) {
    console.warn('cloud write failed', e);
    if (e && e.code === 'permission-denied') toast('Couldn’t save that change — you don’t have permission');
  }

  // ---------- photos on shared boards ----------
  // Photos travel as shrunk JPEGs stored in Firestore (each well under its 1 MB limit).
  const MAX_IMG_BYTES = 700 * 1024;
  async function photoBytes(item) {
    const d = item.data;
    if (d.file && api.readImage) {
      const img = await api.readImage(d.file);
      if (img) return new Blob([img.bytes], { type: img.type });
    }
    if (d.src && String(d.src).startsWith('data:')) {
      // decode by hand — fetch() of data: URLs is blocked by the page's security policy
      const [head, b64] = d.src.split(',');
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: (head.match(/data:([^;]+)/) || [])[1] || 'image/png' });
    }
    return null;
  }
  async function shrinkPhoto(blob) {
    const bmp = await createImageBitmap(blob);
    let max = 1400, quality = 0.84, out = null;
    for (let i = 0; i < 6; i++) {
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); // transparent PNGs get a white backing
      ctx.drawImage(bmp, 0, 0, w, h);
      out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      if (out.size <= MAX_IMG_BYTES) break;
      max = Math.round(max * 0.8); quality = Math.max(0.6, quality - 0.06);
    }
    const ratio = bmp.height / bmp.width || 1;
    bmp.close && bmp.close();
    return { bytes: new Uint8Array(await out.arrayBuffer()), ratio };
  }
  async function sharePhoto(b, item) {
    const s = syncOf(b);
    if (s.uploading.has(item.id) || (s.failed && s.failed.has(item.id))) return false;
    s.uploading.add(item.id);
    try {
      const blob = await photoBytes(item);
      if (!blob) return false;
      const { bytes, ratio } = await shrinkPhoto(blob);
      const imageId = uid();
      await Cloud.saveImage(b.cloud.id, imageId, bytes, 'image/jpeg', ratio);
      item.data.cloudImage = imageId;
      if (item.data.file) (store.imageCache = store.imageCache || {})[imageId] = item.data.file;
      scheduleSave();
      return true;
    } catch (e) {
      (s.failed = s.failed || new Set()).add(item.id); // don't retry on every change; retried next launch
      console.warn('photo upload failed', e);
      return false;
    } finally { s.uploading.delete(item.id); }
  }
  const fetchingImages = new Set();
  // Download a photo someone else pinned, keep it on this computer, and show it.
  async function fetchPhoto(b, item) {
    const imageId = item.data.cloudImage;
    if (!imageId || fetchingImages.has(imageId)) return;
    fetchingImages.add(imageId);
    try {
      const img = await Cloud.loadImage(b.cloud.id, imageId);
      if (!img) return;
      if (api.imageFromBuffer) {
        const saved = await api.imageFromBuffer(img.bytes.buffer.slice(img.bytes.byteOffset, img.bytes.byteOffset + img.bytes.byteLength), 'jpg');
        (store.imageCache = store.imageCache || {})[imageId] = saved.file;
        item.data.file = saved.file;
      } else {
        item.data.src = URL.createObjectURL(new Blob([img.bytes], { type: img.mime || 'image/jpeg' }));
      }
      if (!item.data.ratio) item.data.ratio = img.ratio;
      if (b === board && els.get(item.id)) renderPhoto(item);
      scheduleSave();
    } catch (e) {
      console.warn('photo download failed', e);
    } finally { fetchingImages.delete(imageId); }
  }
  const needsShare = (item) => item.type === 'photo' && !item.data.cloudImage && (item.data.file || String(item.data.src || '').startsWith('data:'));

  // Push local changes (diffed against what we last saw in the cloud)
  function cloudPush(b = board) {
    if (!Cloud || !b.cloud || !cloudUser || b.cloud.uid !== cloudUser.uid) return;
    const s = syncOf(b);
    if (!s.ready) { s.pushLater = true; return; }
    const cid = b.cloud.id;
    const ids = new Set();
    for (const item of b.items) {
      ids.add(item.id);
      if (!canTouch(item, b)) continue;
      if (needsShare(item) && !(s.failed && s.failed.has(item.id))) {
        // upload the photo first, then the pin (if the upload fails, the pin is shared without its photo)
        sharePhoto(b, item).then(() => cloudPush(b));
        continue;
      }
      if (item.data && item.data.cloudImage) (s.images = s.images || new Map()).set(item.id, item.data.cloudImage);
      const c = toCloudItem(item);
      if (!c.authorId) { c.authorId = cloudUser.uid; c.authorName = cloudUser.name; item.authorId = c.authorId; item.authorName = c.authorName; }
      const key = stable(c);
      if (s.items.get(item.id) === key) continue;
      s.items.set(item.id, key);
      Cloud.writeItem(cid, c).catch(cloudFail);
    }
    for (const id of [...s.items.keys()]) {
      if (!ids.has(id)) {
        s.items.delete(id);
        Cloud.deleteItem(cid, id).catch(cloudFail);
        const img = s.images && s.images.get(id);
        if (img) { s.images.delete(id); Cloud.deleteImage(cid, img).catch(() => {}); }
      }
    }
    const sids = new Set();
    for (const str of b.strings) {
      sids.add(str.id);
      if (!str.authorId) str.authorId = cloudUser.uid;
      const c = toCloudString(str);
      const key = stable(c);
      if (s.strings.get(str.id) === key) continue;
      if (!canTouchString(str, b) && s.strings.has(str.id)) continue;
      s.strings.set(str.id, key);
      Cloud.writeString(cid, c).catch(cloudFail);
    }
    for (const id of [...s.strings.keys()]) {
      if (!sids.has(id)) { s.strings.delete(id); Cloud.deleteString(cid, id).catch(cloudFail); }
    }
    if (canEditBoard(b)) {
      const meta = stable({ name: b.name, bg: b.bg });
      if (s.meta && s.meta !== meta) Cloud.updateBoard(cid, { name: b.name, bg: b.bg }).catch(cloudFail);
      s.meta = meta;
    }
  }

  function previewOf(it) {
    const d = it.data || {};
    if (it.type === 'note') return (d.text || 'a sticky note').slice(0, 120);
    if (it.type === 'card') return d.title || (d.text || 'an index card').slice(0, 120);
    if (it.type === 'photo') return d.caption ? `a photo — “${d.caption}”` : 'a photo';
    if (it.type === 'list') return `a checklist: ${d.title || 'To do'}`;
    if (it.type === 'link') return d.title || d.url || 'a link';
    return 'something';
  }
  function notify(title, body) {
    try {
      const n = new Notification(title, { body });
      n.onclick = () => { api.showWindow && api.showWindow(); };
    } catch {}
  }
  function updateUnseenBadge() {
    const total = store.boards.reduce((n, b) => n + ((b.cloud && b.cloud.unseen && b.cloud.unseen.length) || 0), 0);
    $('#boardBtn').classList.toggle('has-new', total > 0);
    $('#boardBtn').dataset.count = total > 9 ? '9+' : String(total);
    $('#boardBtn').classList.toggle('is-shared', !!board.cloud);
  }
  function markSeen(id) {
    const c = board.cloud;
    if (!c || !c.unseen || !c.unseen.includes(id)) return;
    c.unseen = c.unseen.filter((x) => x !== id);
    els.get(id)?.querySelector('.new-sticker')?.remove();
    updateUnseenBadge();
    scheduleSave();
  }

  // Apply item changes that came from the cloud
  function applyRemoteItems(b, changes, isFirst, allIds) {
    const s = syncOf(b);
    const isCur = b === board;
    let touched = false;
    const fresh = [];
    const remoteIds = new Set(allIds || []);
    for (const ch of changes) {
      if (ch.type === 'removed') {
        s.items.delete(ch.id);
        const idx = b.items.findIndex((i) => i.id === ch.id);
        if (idx === -1) continue;
        b.items.splice(idx, 1);
        b.strings = b.strings.filter((x) => x.from !== ch.id && x.to !== ch.id);
        touched = true;
        if (isCur) {
          const el = els.get(ch.id);
          els.delete(ch.id);
          if (selectedId === ch.id) selectedId = null;
          if (el) { el.classList.add('crumpling'); setTimeout(() => el.remove(), 720); }
        }
        continue;
      }
      const d = ch.data;
      remoteIds.add(ch.id);
      const incoming = {
        id: ch.id, type: d.type, x: d.x, y: d.y, w: d.w, rot: d.rot, z: d.z, pin: d.pin, data: d.data || {},
        authorId: d.authorId || null, authorName: d.authorName || null, createdAt: d.createdAt || null,
      };
      const key = stable(toCloudItem(incoming));
      if (s.items.get(ch.id) === key) continue;
      s.items.set(ch.id, key);
      touched = true;
      const local = b.items.find((i) => i.id === ch.id);
      const cached = incoming.data.cloudImage && store.imageCache && store.imageCache[incoming.data.cloudImage];
      if (cached) incoming.data.file = cached;
      if (local) {
        if (local.data && local.data.cloudImage && local.data.cloudImage === incoming.data.cloudImage) {
          if (local.data.file) incoming.data.file = local.data.file;
          if (local.data.src && /^(data|blob):/.test(local.data.src)) incoming.data.src = local.data.src;
        }
        const el = isCur && els.get(ch.id);
        if (isCur && drag && drag.item === local) continue; // you're holding it — your drop wins
        if (el && el.contains(document.activeElement)) {
          Object.assign(local, { x: incoming.x, y: incoming.y, w: incoming.w, rot: incoming.rot, z: incoming.z, pin: incoming.pin });
          applyItem(local);
          continue;
        }
        Object.assign(local, incoming);
        if (el) {
          const wasSel = selectedId === local.id;
          el.remove(); els.delete(local.id);
          buildItem(local);
          if (wasSel) { selectedId = null; select(local.id); }
        }
      } else {
        b.items.push(incoming);
        const byOther = incoming.authorId && incoming.authorId !== myUid();
        const newSinceLastVisit = isFirst ? (incoming.createdAt || 0) > (b.cloud.lastSync || 0) : true;
        if (byOther && newSinceLastVisit && b.cloud.lastSync) {
          b.cloud.unseen = [...new Set([...(b.cloud.unseen || []), incoming.id])];
          fresh.push(incoming);
        }
        if (isCur) buildItem(incoming, { arrive: !isFirst });
      }
    }
    if (isFirst) {
      // Things that only exist locally: keep (and upload) ones made since the last sync, drop the rest.
      const keep = (it) => remoteIds.has(it.id) || (it.createdAt || 0) > (b.cloud.lastSync || 0);
      const gone = b.items.filter((it) => !keep(it));
      if (gone.length) {
        b.items = b.items.filter(keep);
        if (isCur) gone.forEach((it) => { els.get(it.id)?.remove(); els.delete(it.id); });
        touched = true;
      }
    }
    for (const it of b.items) {
      if (it.type === 'photo' && it.data.cloudImage && !it.data.file && !it.data.src) fetchPhoto(b, it);
    }
    if (fresh.length) {
      const who = fresh[0].authorName || 'Someone';
      if (fresh.length === 1) notify(`${who} pinned something on “${b.name}”`, previewOf(fresh[0]));
      else notify(`${fresh.length} new things on “${b.name}”`, `${who}${fresh.some((f) => f.authorName !== who) ? ' and others' : ''} added to your board`);
      if (isCur) Sound.play('pin');
    }
    afterRemote(b, touched);
  }

  function applyRemoteStrings(b, changes, isFirst, allIds) {
    const s = syncOf(b);
    let touched = false;
    const remoteIds = new Set(allIds || []);
    for (const ch of changes) {
      if (ch.type === 'removed') {
        s.strings.delete(ch.id);
        const before = b.strings.length;
        b.strings = b.strings.filter((x) => x.id !== ch.id);
        touched = touched || before !== b.strings.length;
        continue;
      }
      remoteIds.add(ch.id);
      const inc = toCloudString({ id: ch.id, ...ch.data });
      const key = stable(inc);
      if (s.strings.get(ch.id) === key) continue;
      s.strings.set(ch.id, key);
      const local = b.strings.find((x) => x.id === ch.id);
      if (local) {
        Object.assign(local, inc);
        if (b === board) strEls.get(local.id)?.g.style.setProperty('--yarn', local.color);
      } else b.strings.push(inc);
      touched = true;
    }
    if (isFirst) {
      const before = b.strings.length;
      b.strings = b.strings.filter((x) => remoteIds.has(x.id));
      touched = touched || before !== b.strings.length;
    }
    afterRemote(b, touched);
  }

  function afterRemote(b, touched) {
    b.cloud.lastSync = Date.now();
    if (!touched) return;
    if (b === board) {
      syncStrings();
      updateHint();
      resetHistory(); // undo only covers your own changes made after this
    }
    updateUnseenBadge();
    scheduleSave();
  }

  function applyRemoteBoard(b, data) {
    const s = syncOf(b);
    s.meta = stable({ name: data.name, bg: data.bg });
    let changed = false;
    if (data.name && data.name !== b.name) { b.name = data.name; changed = true; }
    if (data.bg && data.bg !== b.bg) { b.bg = data.bg; changed = true; }
    b.cloud.ownerName = data.ownerName || b.cloud.ownerName;
    if (changed && b === board) {
      boardEl.className = 'board bg-' + board.bg;
      $('#boardName').textContent = board.name;
      document.querySelectorAll('.bg-picker button').forEach((x) => x.classList.toggle('active', x.dataset.bg === board.bg));
    }
    if (changed) scheduleSave();
  }

  function detachCloud(b, message) {
    const un = watchers.get(b.cloud.id);
    if (un) { un(); watchers.delete(b.cloud.id); }
    const name = b.name;
    if (Cloud) Cloud.forgetBoard(b.cloud.id);
    delete b.cloud;
    delete b._sync;
    if (message) toast(message.replace('%s', name));
    if (b === board) renderAll();
    updateUnseenBadge();
    scheduleSave();
  }

  function startWatching(b) {
    if (!Cloud || !cloudUser || !b.cloud || b.cloud.uid !== cloudUser.uid || watchers.has(b.cloud.id)) return;
    const s = syncOf(b);
    let gotItems = false, gotStrings = false;
    const ready = () => {
      if (!gotItems || !gotStrings || s.ready) return;
      s.ready = true;
      cloudPush(b); // upload anything made while offline
    };
    const un = Cloud.watchBoard(b.cloud.id, {
      onBoard: (d) => applyRemoteBoard(b, d),
      onItems: (ch, first, all) => { applyRemoteItems(b, ch, first, all); gotItems = true; ready(); },
      onStrings: (ch, first, all) => { applyRemoteStrings(b, ch, first, all); gotStrings = true; ready(); },
      onLost: () => detachCloud(b, '“%s” isn’t shared with you anymore — you’ve kept a copy'),
    });
    watchers.set(b.cloud.id, un);
  }
  function stopWatchingAll() {
    for (const un of watchers.values()) un();
    watchers.clear();
    store.boards.forEach((b) => { if (b._sync) b._sync.ready = false; });
    if (myBoardsUnsub) { myBoardsUnsub(); myBoardsUnsub = null; }
  }

  function onSignedIn() {
    store.boards.forEach(startWatching);
    myBoardsUnsub = Cloud.watchMyBoards((list) => {
      for (const entry of list) {
        if (store.boards.some((b) => b.cloud && b.cloud.id === entry.id)) continue;
        // a board you joined on another computer
        const b = { ...newBoard(entry.name || 'Shared board'), cloud: { id: entry.id, role: entry.role, uid: cloudUser.uid, ownerName: entry.ownerName || '', unseen: [], lastSync: 0 } };
        store.boards.push(b);
        startWatching(b);
        scheduleSave();
      }
    });
  }

  function initCloudAuth() {
    if (!Cloud) return;
    Cloud.onAuth((u) => {
      const was = cloudUser && cloudUser.uid;
      cloudUser = u;
      if (u && u.uid !== was) onSignedIn();
      if (!u) stopWatchingAll();
      if (board) updateUnseenBadge();
      if (!settingsEl.hidden) paintAccount();
    });
  }

  // ---------- panels (account, share, join) ----------
  function openPanel(title, cls = '') {
    closeMenu();
    document.querySelector('.panel-backdrop')?.remove();
    const back = document.createElement('div');
    back.className = 'settings-backdrop panel-backdrop';
    back.innerHTML = `<section class="settings-card panel ${cls}" role="dialog"><span class="settings-pin"></span><h2>${esc(title)}</h2><div class="panel-body"></div><button class="done-btn panel-close">Done</button></section>`;
    document.body.appendChild(back);
    const close = () => { back.remove(); };
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    back.querySelector('.panel-close').onclick = close;
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    Sound.play('pop');
    return { el: back, body: back.querySelector('.panel-body'), close, setTitle: (t) => (back.querySelector('h2').textContent = t) };
  }
  const isPanelOpen = () => !!document.querySelector('.panel-backdrop');

  function notConfigured(p) {
    p.body.innerHTML = `<p class="panel-text">Sharing needs a Firebase project connected to this copy of Corkly.</p><p class="panel-note">Add your project’s web config to <code>src/firebase-config.json</code> — the steps are in <b>CLOUD.md</b>.</p>`;
  }

  function openAccount(then) {
    const p = openPanel(cloudUser ? 'Your account' : 'Sign in to share');
    if (!Cloud) return notConfigured(p);
    if (cloudUser) {
      p.body.innerHTML = `<div class="who"><span class="avatar">${esc((cloudUser.name || '?')[0].toUpperCase())}</span><span><b>${esc(cloudUser.name)}</b><small>${esc(cloudUser.email || '')}</small></span></div>
        <p class="panel-note">Your shared boards sync while you’re signed in.</p>
        <button class="pill-btn ghost" id="signOutBtn">Sign out</button>`;
      p.body.querySelector('#signOutBtn').onclick = async () => { await Cloud.signOut(); p.close(); toast('Signed out — shared boards will catch up when you sign back in'); };
      return;
    }
    let mode = 'in';
    const draw = () => {
      p.body.innerHTML = `
        <div class="seg small"><button data-m="in" class="${mode === 'in' ? 'active' : ''}">Sign in</button><button data-m="up" class="${mode === 'up' ? 'active' : ''}">Create account</button></div>
        <form class="auth-form">
          ${mode === 'up' ? '<label>Your name<input name="name" autocomplete="name" placeholder="What friends call you" required></label>' : ''}
          <label>Email<input name="email" type="email" autocomplete="email" required></label>
          <label>Password<input name="password" type="password" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}" minlength="6" required></label>
          <p class="form-error" hidden></p>
          <button class="pill-btn" type="submit">${mode === 'up' ? 'Create account' : 'Sign in'}</button>
          ${mode === 'in' ? '<button type="button" class="link-btn" id="forgotBtn">Forgot password?</button>' : ''}
        </form>`;
      p.body.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => { mode = b.dataset.m; draw(); }));
      const form = p.body.querySelector('form');
      const err = p.body.querySelector('.form-error');
      const showErr = (e) => { err.hidden = false; err.textContent = Cloud.friendlyError(e); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true; err.hidden = true;
        try {
          cloudUser = mode === 'up'
            ? await Cloud.signUp(f.get('email'), f.get('password'), f.get('name'))
            : await Cloud.signIn(f.get('email'), f.get('password'));
          p.close();
          toast(`Hi ${cloudUser.name}!`);
          Sound.play('check');
          if (then) then();
        } catch (ex) { showErr(ex); btn.disabled = false; }
      };
      const forgot = p.body.querySelector('#forgotBtn');
      if (forgot) forgot.onclick = async () => {
        const email = form.email.value.trim();
        if (!email) { err.hidden = false; err.textContent = 'Type your email above first.'; return; }
        try { await Cloud.resetPassword(email); err.hidden = false; err.textContent = 'Check your inbox for a reset link.'; } catch (ex) { showErr(ex); }
      };
      setTimeout(() => { if (form.isConnected && !form.contains(document.activeElement)) form.querySelector('input')?.focus(); }, 50);
    };
    draw();
  }

  function requireSignIn(then) {
    if (!Cloud) { notConfigured(openPanel('Sharing')); return false; }
    if (!cloudUser) { openAccount(then); return false; }
    return true;
  }

  async function shareCurrentBoard(p) {
    const b = board;
    const status = p.body.querySelector('.share-status');
    const btn = p.body.querySelector('#startShareBtn');
    btn.disabled = true;
    try {
      // stamp everything as yours
      for (const it of b.items) { if (!it.authorId) { it.authorId = cloudUser.uid; it.authorName = cloudUser.name; it.createdAt = it.createdAt || Date.now(); } }
      for (const st of b.strings) if (!st.authorId) st.authorId = cloudUser.uid;
      // first create the board so photos can be uploaded under it
      const cid = await Cloud.createSharedBoard({ name: b.name, bg: b.bg, items: [], strings: [] });
      b.cloud = { id: cid, role: 'owner', uid: cloudUser.uid, ownerName: cloudUser.name, unseen: [], lastSync: Date.now() };
      const photos = b.items.filter(needsShare);
      let n = 0;
      for (const ph of photos) {
        status.textContent = `Uploading photos… ${++n}/${photos.length}`;
        await sharePhoto(b, ph);
      }
      status.textContent = 'Pinning everything up…';
      const s = syncOf(b);
      s.ready = true;
      s.meta = stable({ name: b.name, bg: b.bg });
      cloudPush(b);
      startWatching(b);
      scheduleSave();
      updateUnseenBadge();
      Sound.play('tada');
      api.track('board_shared', { items: b.items.length });
      openShare();
    } catch (e) {
      status.textContent = Cloud.friendlyError(e);
      btn.disabled = false;
    }
  }

  function openShare() {
    if (!requireSignIn(openShare)) return;
    const b = board;
    const p = openPanel(b.cloud ? `Sharing “${b.name}”` : `Share “${b.name}”`, 'share-panel');
    if (!b.cloud) {
      p.body.innerHTML = `
        <p class="panel-text">Invite people to this board. They can pin notes, photos and links that show up on your board straight away — and you’ll get a little notification.</p>
        <ul class="panel-list">
          <li><b>Pin only</b> — they can add things and change their own pins.</li>
          <li><b>Can edit</b> — they can move and change anything.</li>
        </ul>
        <p class="panel-note">The board is stored online so it can sync. Your other boards stay private on this computer.</p>
        <button class="pill-btn" id="startShareBtn">Start sharing this board</button>
        <p class="share-status panel-note"></p>`;
      p.body.querySelector('#startShareBtn').onclick = () => shareCurrentBoard(p);
      return;
    }
    const isOwner = b.cloud.role === 'owner';
    const roleName = { owner: 'Owner', edit: 'Can edit', pin: 'Pin only' };
    p.body.innerHTML = `
      ${isOwner ? `
      <h3>Invite someone</h3>
      <div class="seg small" id="roleSeg"><button data-r="pin" class="active">Pin only</button><button data-r="edit">Can edit</button></div>
      <button class="pill-btn" id="makeInvite">Create invite code</button>
      <div class="invite-out" hidden></div>
      <h3>Active invites</h3><div class="invite-list panel-note">Loading…</div>` : `<p class="panel-text">${esc(b.cloud.ownerName || 'Someone')} shared this board with you. You can <b>${b.cloud.role === 'edit' ? 'change anything' : 'add things and change your own pins'}</b>.</p>`}
      <h3>People</h3><div class="member-list panel-note">Loading…</div>
      <div class="danger-zone">${isOwner ? '<button class="link-btn danger" id="stopShare">Stop sharing this board</button>' : '<button class="link-btn danger" id="leaveBoard">Leave this board</button>'}</div>`;

    const unsubs = [];
    const origClose = p.close;
    p.close = () => { unsubs.forEach((u) => u()); origClose(); };
    p.el.querySelector('.panel-close').onclick = p.close;

    unsubs.push(Cloud.watchMembers(b.cloud.id, (list) => {
      const box = p.body.querySelector('.member-list');
      if (!box) return;
      list.sort((a, c) => (a.role === 'owner' ? -1 : c.role === 'owner' ? 1 : (a.name || '').localeCompare(c.name || '')));
      box.innerHTML = list.map((m) => `<div class="member"><span class="avatar">${esc((m.name || '?')[0].toUpperCase())}</span><span class="m-name">${esc(m.name || m.email || 'Someone')}${m.uid === myUid() ? ' <small>(you)</small>' : ''}</span><span class="chip-role">${roleName[m.role] || m.role}</span>${isOwner && m.role !== 'owner' ? `<button class="link-btn danger" data-remove="${m.uid}">Remove</button>` : ''}</div>`).join('') || 'Just you so far.';
      box.querySelectorAll('[data-remove]').forEach((btn) => (btn.onclick = async () => {
        const m = list.find((x) => x.uid === btn.dataset.remove);
        if (!confirm(`Remove ${m.name || 'this person'} from “${b.name}”?`)) return;
        await Cloud.removeMember(b.cloud.id, m.uid).catch(cloudFail);
      }));
    }));

    if (isOwner) {
      let role = 'pin';
      p.body.querySelectorAll('#roleSeg button').forEach((btn) => (btn.onclick = () => {
        role = btn.dataset.r;
        p.body.querySelectorAll('#roleSeg button').forEach((x) => x.classList.toggle('active', x === btn));
      }));
      const out = p.body.querySelector('.invite-out');
      const showCode = (code, r) => {
        const pretty = Cloud.prettyCode(code);
        const link = `corkly://join/${code}`;
        out.hidden = false;
        out.innerHTML = `<div class="code">${pretty}</div>
          <p class="panel-note">Send this code — they open Corkly, click the board name → <b>Join a shared board</b>, and type it in. It works for 14 days and lets them <b>${r === 'edit' ? 'edit anything' : 'pin things'}</b>.</p>
          <div class="row"><button class="pill-btn small" data-copy="${esc(`Join my Corkly board “${b.name}”! Open Corkly → board menu → Join a shared board, and enter: ${pretty}  (or click ${link})`)}">Copy invite message</button><button class="pill-btn small ghost" data-copy="${pretty}">Copy code</button></div>`;
        out.querySelectorAll('[data-copy]').forEach((x) => (x.onclick = async () => {
          try { await navigator.clipboard.writeText(x.dataset.copy); toast('Copied!'); } catch { toast('Couldn’t copy — select the code instead'); }
        }));
      };
      p.body.querySelector('#makeInvite').onclick = async (e) => {
        e.target.disabled = true;
        try { const code = await Cloud.createInvite(b.cloud.id, b.name, role); showCode(code, role); Sound.play('pin'); api.track('invite_created', { role }); } catch (ex) { toast(Cloud.friendlyError(ex)); }
        e.target.disabled = false;
      };
      unsubs.push(Cloud.watchInvites(b.cloud.id, (list) => {
        const box = p.body.querySelector('.invite-list');
        if (!box) return;
        box.innerHTML = list.length ? list.map((i) => `<div class="member"><span class="m-name code-sm">${Cloud.prettyCode(i.code)}</span><span class="chip-role">${roleName[i.role]}</span><small>until ${i.expiresAt.toDate().toLocaleDateString()}</small><button class="link-btn danger" data-revoke="${i.code}">Turn off</button></div>`).join('') : 'No active invites.';
        box.querySelectorAll('[data-revoke]').forEach((btn) => (btn.onclick = () => Cloud.revokeInvite(btn.dataset.revoke).catch(cloudFail)));
      }));
      p.body.querySelector('#stopShare').onclick = async () => {
        if (!confirm(`Stop sharing “${b.name}”? Everyone else loses access. You keep everything on your board.`)) return;
        try {
          await Cloud.stopSharing(b.cloud.id);
          p.close();
          detachCloud(b, '“%s” is private again');
        } catch (ex) { toast(Cloud.friendlyError(ex)); }
      };
    } else {
      p.body.querySelector('#leaveBoard').onclick = async () => {
        if (!confirm(`Leave “${b.name}”? It will disappear from your boards.`)) return;
        const cid = b.cloud.id;
        p.close();
        const un = watchers.get(cid); if (un) { un(); watchers.delete(cid); }
        await Cloud.leaveBoard(cid).catch(() => {});
        store.boards = store.boards.filter((x) => x !== b);
        if (!store.boards.length) store.boards.push(newBoard('My board'));
        switchBoard(store.boards[0].id);
        toast(`You left “${b.name}”`);
      };
    }
  }

  function openJoin(prefill = '') {
    if (!requireSignIn(() => openJoin(prefill))) return;
    const p = openPanel('Join a shared board');
    p.body.innerHTML = `
      <p class="panel-text">Got an invite code from a friend? Type it in and their board will appear in your boards.</p>
      <form class="auth-form"><label>Invite code<input name="code" class="code-input" placeholder="ABCDE-FGHJK" autocomplete="off" spellcheck="false" value="${esc(prefill)}"></label>
      <p class="form-error" hidden></p><button class="pill-btn" type="submit">Join board</button></form>`;
    const form = p.body.querySelector('form');
    const err = p.body.querySelector('.form-error');
    setTimeout(() => form.code.focus(), 50);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true; err.hidden = true;
      try {
        const j = await Cloud.joinByCode(form.code.value);
        let b = store.boards.find((x) => x.cloud && x.cloud.id === j.id);
        if (!b) {
          b = { ...newBoard(j.name), bg: j.bg || 'cork', cloud: { id: j.id, role: j.role, uid: cloudUser.uid, ownerName: j.ownerName || '', unseen: [], lastSync: 0 } };
          store.boards.push(b);
        }
        p.close();
        switchBoard(b.id);
        startWatching(b);
        Sound.play('tada');
        api.track('board_joined', { role: j.role });
        toast(`You joined “${j.name}”${j.ownerName ? ` by ${j.ownerName}` : ''}!`);
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex.code === 'bad-code' || ex.code === 'expired' ? ex.message : Cloud.friendlyError(ex);
        btn.disabled = false;
      }
    };
  }
  if (api.onJoinLink) api.onJoinLink((code) => openJoin(code));

  // Settings: account row
  function paintAccount() {
    const row = $('#accountRow');
    if (!row) return;
    if (!Cloud) { row.querySelector('b').textContent = 'Shared boards'; row.querySelector('small').textContent = 'Not set up in this build yet (see CLOUD.md).'; row.querySelector('button').hidden = true; return; }
    row.querySelector('button').hidden = false;
    row.querySelector('b').textContent = cloudUser ? cloudUser.name : 'Not signed in';
    row.querySelector('small').textContent = cloudUser ? cloudUser.email : 'Sign in to share boards with friends.';
    row.querySelector('button').textContent = cloudUser ? 'Account' : 'Sign in';
  }
  $('#accountBtn').onclick = () => { closeSettings(); openAccount(); };
  $('#shareBtn').onclick = openShare;


  // ---------- boot ----------
  await loadStore();
  board = store.boards.find((b) => b.id === store.currentId) || store.boards[0];
  store.currentId = board.id;
  applySound();
  renderAll();
  store.meta = store.meta || {};
  store.meta.firstUse = store.meta.firstUse || Date.now();
  store.meta.launches = (store.meta.launches || 0) + 1;
  if (info.firstLaunch) { store.cleanWidget = false; store.cleanWindow = false; }
  else if (store[cleanKey]) setClean(true, { quiet: true });
  resetHistory();
  requestAnimationFrame(frame);
  scheduleSave();
  maybeNudge();
  updateUnseenBadge();
  initCloudAuth();
  if (api.pendingJoin) api.pendingJoin().then((code) => code && openJoin(code));
})();
