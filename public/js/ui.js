// عناصر الواجهة (DOM) فوق المسرح: الكروت، اللافتات، شريط الموجة، القوائم.

import { portrait, SKINS } from './stage.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return e;
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* ------------------------------------------------------------ تنبيهات */
let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ------------------------------------------------------------ لافتات الوسط */
export function banner(text, kind = 'bubble', ms = 1600) {
  const c = $('#center');
  const b = el('div', { class: `banner ${kind}` }, text);
  c.appendChild(b);
  if (ms > 0) {
    setTimeout(() => {
      b.classList.add('out');
      setTimeout(() => b.remove(), 320);
    }, ms);
  }
  return b;
}

export function clearCenter() {
  $('#center').innerHTML = '';
}

export function scoreBanner(raw, mult = 1, sab = []) {
  const c = $('#center');
  const b = el(
    'div',
    { class: 'banner score' },
    el('span', { class: 'num' }, String(raw)),
    el('span', { class: 'slash' }, ' / 100'),
    mult > 1 ? el('span', { class: 'mult' }, `×${mult}`) : null,
  );
  c.appendChild(b);
  setTimeout(() => {
    b.classList.add('out');
    setTimeout(() => b.remove(), 320);
  }, 2000);
  // عدّاد تصاعدي
  const num = b.querySelector('.num');
  const t0 = performance.now();
  const dur = 700;
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    num.textContent = String(Math.round(raw * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return b;
}

/* ------------------------------------------------------------ الكروت */
export function renderCards(players, { me, host, gains = {}, badges = {} } = {}) {
  const wrap = $('#cards');
  const n = players.length;
  const prev = new Map([...wrap.children].map((c) => [c.dataset.uid, c]));
  wrap.innerHTML = '';
  players.forEach((p, i) => {
    const rot = (i - (n - 1) / 2) * 6;
    const lift = Math.abs(i - (n - 1) / 2) * 3;
    const card = el(
      'div',
      {
        class: 'pcard' + (p.uid === me ? ' me' : '') + (p.on === false ? ' off' : ''),
        'data-uid': p.uid,
        style: { transform: `translateY(${lift}px) rotate(${rot}deg)`, zIndex: String(10 + i) },
      },
      el('div', { class: 'pc-face', style: { background: SKINS[p.skin % SKINS.length].card } }, el('img', { src: portrait(p.skin), alt: '' })),
      el('div', { class: 'pc-name' }, p.name),
      el('div', { class: 'pc-score' }, String(p.score)),
      p.uid === host ? el('div', { class: 'pc-host', title: 'المضيف' }, '👑') : null,
      p.mult > 1 ? el('div', { class: 'pc-mult' }, `×${p.mult}`) : null,
      badges[p.uid] ? el('div', { class: 'pc-badge' }, badges[p.uid]) : null,
      gains[p.uid] ? el('div', { class: 'pc-gain' }, `+${gains[p.uid]}`) : null,
    );
    const old = prev.get(p.uid);
    if (old && old.querySelector('.pc-score').textContent !== String(p.score)) card.classList.add('bump');
    wrap.appendChild(card);
  });
}

/* ------------------------------------------------------------ شريط الموجة */
export class WaveBar {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector('canvas');
    this.g = this.canvas.getContext('2d');
    this.ref = null;
    this.take = new Float32Array(200);
    this.takeTo = 0;
    this.progress = -1;
    this.mode = 'hidden';
  }
  show(on) {
    this.root.classList.toggle('show', on);
    if (!on) this.mode = 'hidden';
  }
  setRef(peaks) {
    this.ref = peaks;
    this.take = new Float32Array(peaks ? peaks.length : 200);
    this.takeTo = 0;
    this.progress = -1;
  }
  pushTake(frac, level) {
    const n = this.take.length;
    const k = Math.min(n - 1, Math.max(0, Math.floor(frac * n)));
    for (let i = this.takeTo; i <= k; i++) this.take[i] = Math.max(this.take[i], Math.min(1, level));
    this.takeTo = Math.max(this.takeTo, k);
  }
  draw() {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(10, Math.round(c.clientWidth * dpr));
    const h = Math.max(10, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = this.g;
    g.clearRect(0, 0, w, h);
    if (!this.ref) return;
    const n = this.ref.length;
    const pad = h * 0.1;
    const mid = h / 2;
    const amp = (h / 2 - pad) * 0.95;
    const xAt = (i) => pad * 2 + ((w - pad * 4) * i) / (n - 1);
    const shape = (arr, upto, color) => {
      g.beginPath();
      g.moveTo(xAt(0), mid);
      for (let i = 0; i <= upto; i++) g.lineTo(xAt(i), mid - Math.max(0.04, arr[i]) * amp);
      for (let i = upto; i >= 0; i--) g.lineTo(xAt(i), mid + Math.max(0.04, arr[i]) * amp);
      g.closePath();
      g.fillStyle = color;
      g.fill();
    };
    shape(this.ref, n - 1, '#b9b3c9');
    if (this.mode === 'record' && this.takeTo > 0) shape(this.take, this.takeTo, '#33b9ff');
    if (this.progress >= 0) {
      const x = xAt(Math.min(n - 1, this.progress * (n - 1)));
      g.fillStyle = '#ff2d2d';
      g.fillRect(x - dpr * 1.5, pad * 0.4, dpr * 3, h - pad * 0.8);
    }
  }
}

/* ------------------------------------------------------------ بطاقة الميم */
export function showMeme(sound, entry) {
  const m = $('#meme');
  m.innerHTML = '';
  m.className = 'show';
  let media;
  if (entry && entry.videoUrl) {
    media = el('video', { src: entry.videoUrl, muted: true, playsinline: true, 'webkit-playsinline': true, preload: 'auto' });
    media.muted = true;
  } else if (sound.img) {
    media = el('img', { src: sound.img, alt: '' });
  } else {
    media = el('div', { class: 'meme-emoji', style: { background: `radial-gradient(circle at 50% 40%, #fff6, transparent 60%), ${sound.color || '#ff4f8b'}` } }, sound.emoji || '🎤');
  }
  m.appendChild(el('div', { class: 'meme-card' }, media, el('div', { class: 'meme-title' }, sound.title || '')));
  return media;
}

export function hideMeme() {
  const m = $('#meme');
  m.classList.remove('show');
  const v = m.querySelector('video');
  if (v) v.pause();
  setTimeout(() => {
    if (!m.classList.contains('show')) m.innerHTML = '';
  }, 400);
}

/* ------------------------------------------------------------ نوافذ */
export function overlay(content, cls = '') {
  const o = $('#overlay');
  o.innerHTML = '';
  o.className = 'show ' + cls;
  if (content) o.appendChild(content);
  return o;
}

export function closeOverlay() {
  const o = $('#overlay');
  o.className = '';
  o.innerHTML = '';
}

export function confirmDialog(text, yes = 'إي', no = 'لا') {
  return new Promise((resolve) => {
    const box = el(
      'div',
      { class: 'dialog' },
      el('div', { class: 'dialog-text' }, text),
      el(
        'div',
        { class: 'dialog-btns' },
        el('button', { class: 'btn pink', onclick: () => done(true) }, yes),
        el('button', { class: 'btn ghost', onclick: () => done(false) }, no),
      ),
    );
    const layer = el('div', { class: 'dialog-layer' }, box);
    $('#app').appendChild(layer);
    function done(v) {
      layer.remove();
      resolve(v);
    }
  });
}

/** لوحة أرقام للدخول بكود (بدون كيبورد النظام لأن الشاشة مُدارة). */
export function keypad(onSubmit, onClose) {
  let code = '';
  const disp = el('div', { class: 'kp-display' });
  const render = () => {
    disp.innerHTML = '';
    for (let i = 0; i < 5; i++) disp.appendChild(el('span', { class: 'kp-digit' + (code[i] ? ' on' : '') }, code[i] || ''));
  };
  render();
  const press = (d) => {
    if (d === 'del') code = code.slice(0, -1);
    else if (code.length < 5) code += d;
    render();
    if (code.length === 5) setTimeout(() => onSubmit(code), 120);
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  const pad = el(
    'div',
    { class: 'kp-grid' },
    keys.map((k) =>
      el(
        'button',
        {
          class: 'kp-key' + (k === 'ok' ? ' ok' : k === 'del' ? ' del' : ''),
          onclick: () => (k === 'ok' ? code.length === 5 && onSubmit(code) : press(k)),
        },
        k === 'del' ? '⌫' : k === 'ok' ? '✓' : k,
      ),
    ),
  );
  return el(
    'div',
    { class: 'panel keypad' },
    el('button', { class: 'xbtn', onclick: onClose }, '✕'),
    el('div', { class: 'kp-side' }, el('div', { class: 'panel-title' }, 'ادخل كود الغرفة'), disp, el('div', { class: 'hint' }, 'الكود 5 أرقام — تلگاه عند صاحب الغرفة')),
    pad,
  );
}

export function leaderboardPanel(rows, meUid, onClose) {
  const medal = ['🥇', '🥈', '🥉'];
  const list = rows.length
    ? rows.map((r, i) =>
        el(
          'div',
          { class: 'lb-row' + (r.id === meUid ? ' me' : '') },
          el('span', { class: 'lb-rank' }, medal[i] || String(i + 1)),
          r.photo ? el('img', { class: 'lb-ph', src: r.photo, alt: '' }) : el('span', { class: 'lb-ph ph-empty' }, (r.name || '?').slice(0, 1)),
          el('span', { class: 'lb-name' }, r.name),
          el('span', { class: 'lb-pts' }, `${r.points}`),
          el('span', { class: 'lb-wins' }, `🏆 ${r.wins}`),
        ),
      )
    : [el('div', { class: 'hint center' }, 'بعد ماكو أحد — كون أول واحد! 🎤')];
  return el(
    'div',
    { class: 'panel board' },
    el('button', { class: 'xbtn', onclick: onClose }, '✕'),
    el('div', { class: 'panel-title' }, '🏆 المتصدرين'),
    el('div', { class: 'lb-list' }, list),
  );
}
