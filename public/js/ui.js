// عناصر الواجهة (DOM) فوق المسرح: الكروت، اللافتات، شريط الموجة، القوائم.

import { portrait, SKINS } from './stage.js';
import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) e.style.setProperty(sk, sv);
        else e.style[sk] = sv;
      }
    }
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

/** توقيت عدّاد الدرجة: يعد للدرجة، وبعدها كل مضاعف/نقاط عجلة خطوة لحالها */
export const SCORE_COUNT_MS = 700;
const STEP_GAP = 300;
const STEP_COUNT_MS = 450;

/** متى تخلص كل الخطوات (ملي ثانية من بداية العرض) */
export function scoreSettleMs(mult = 1, bonus = 0, stepMs = 800) {
  const steps = (mult > 1 ? 1 : 0) + (bonus > 0 ? 1 : 0);
  return steps ? SCORE_COUNT_MS + STEP_GAP + (steps - 1) * stepMs + STEP_COUNT_MS : SCORE_COUNT_MS;
}

/**
 * «X / 100» بالوردي الغامق تحت المايك — مثل الأصلية.
 * إذا عنده مضاعف أو نقاط من العجلة: الرقم يوكف على الدرجة، وبعدها ×2 تطلع وتضرب الرقم قدّامك،
 * و+10 تطلع وتنضاف (40/100 ← 50/100). onStep(kind) لكل خطوة (صوت واهتزاز).
 */
export function scoreBanner(raw, mult = 1, bonus = 0, { ms = 2000, stepMs = 800, onStep = null } = {}) {
  const c = $('#center');
  const num = el('span', { class: 'num' }, '0');
  const den = el('span', { class: 'den' }, el('span', { class: 'slash' }, '/'), el('span', { class: 'num' }, '100'));
  const steps = [];
  let value = raw;
  if (mult > 1) {
    value = Math.round(raw * mult);
    steps.push({ kind: 'mult', chip: el('span', { class: 'mult' }, `×${mult}`), to: value });
  }
  if (bonus > 0) {
    value += bonus;
    steps.push({ kind: 'bonus', chip: el('span', { class: 'mult bonus' }, `+${bonus}`), to: value });
  }
  const b = el('div', { class: 'banner score' + (steps.length ? ' steps' : '') }, num, den, steps.map((s) => s.chip));
  c.appendChild(b);
  setTimeout(() => {
    b.classList.add('out');
    setTimeout(() => b.remove(), 320);
  }, ms);

  let shown = 0;
  const countTo = (from, to, dur) => {
    const t0 = performance.now();
    const tick = (now) => {
      if (!b.isConnected) return;
      const p = Math.min(1, (now - t0) / dur);
      shown = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      num.textContent = String(shown);
      if (shown > 100) b.classList.add('over');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  countTo(0, raw, SCORE_COUNT_MS);
  steps.forEach((s, i) => {
    setTimeout(
      () => {
        if (!b.isConnected) return;
        s.chip.classList.add('go');
        num.classList.remove('hit');
        void num.offsetWidth;
        num.classList.add('hit');
        countTo(i ? steps[i - 1].to : raw, s.to, STEP_COUNT_MS);
        if (onStep) onStep(s.kind);
      },
      SCORE_COUNT_MS + STEP_GAP + i * stepMs,
    );
  });
  return b;
}

/* ------------------------------------------------------------ «حاول… تقلّدها!» */
// الحروف تطير وتستقر واحد واحد مثل الأصلية. للعربي نحافظ على اتصال الحروف بـZWJ
// لأن كل حرف بعنصر مستقل.
const NO_JOIN_NEXT = new Set([...'اأإآٱدذرزوؤةىءژ']);
const isArLetter = (ch) => /[ؠ-يٮ-ۓۺ-ۿ]/.test(ch);
const isMark = (ch) => /[ً-ٰٟۖ-ۭ]/.test(ch);

function letterPieces(word) {
  const cs = [];
  for (const ch of word) {
    if (isMark(ch) && cs.length) cs[cs.length - 1] += ch;
    else cs.push(ch);
  }
  const base = cs.map((c) => [...c][0]);
  const joinsNext = base.map((b, i) => isArLetter(b) && !NO_JOIN_NEXT.has(b) && i + 1 < base.length && isArLetter(base[i + 1]) && base[i + 1] !== 'ء');
  return cs.map((c, i) => (i > 0 && joinsNext[i - 1] ? '‍' : '') + c + (joinsNext[i] ? '‍' : ''));
}

export function reproduceBanner(ms = 1600, lines = [t('حاول..'), t('تقلّدها!')]) {
  const c = $('#center');
  c.querySelectorAll('.repro').forEach((x) => x.remove());
  let k = 0;
  const frac = (v) => v - Math.floor(v);
  const box = el(
    'div',
    { class: 'banner repro bubble' },
    lines.map((line) =>
      el(
        'div',
        { class: 'repro-line' },
        letterPieces(line).map((p) => {
          const i = k++;
          // نقطة انطلاق عشوائية ثابتة لكل حرف (من فوق ومن الجوانب)
          const f = frac(Math.sin(i * 12.9898 + 4.1) * 43758.5453);
          const g = frac(Math.sin(i * 78.233 + 1.7) * 12543.13);
          const s = el('span', { class: 'ch' }, p);
          s.style.setProperty('--x', `${((f - 0.5) * 140).toFixed(0)}%`);
          s.style.setProperty('--y', `${(-70 - g * 170).toFixed(0)}%`);
          s.style.setProperty('--r', `${((f - 0.5) * 80).toFixed(0)}deg`);
          s.style.animationDelay = `${(i * 0.055).toFixed(3)}s`;
          return s;
        }),
      ),
    ),
  );
  c.appendChild(box);
  if (ms > 0) {
    setTimeout(() => {
      box.classList.add('out');
      setTimeout(() => box.remove(), 320);
    }, ms);
  }
  return box;
}

/* ------------------------------------------------------------ الكروت */
const CARD_TILT = [-2, 1.5, -1, 2, 0];
export function renderCards(players, { me, host, gains = {}, badges = {} } = {}) {
  const wrap = $('#cards');
  const n = players.length;
  const prev = new Map([...wrap.children].map((c) => [c.dataset.uid, c]));
  wrap.innerHTML = '';
  players.forEach((p, i) => {
    const off = i - (n - 1) / 2;
    const rot = off * 6.5 + CARD_TILT[i % CARD_TILT.length];
    const lift = Math.abs(off) * 0.9;
    const card = el(
      'div',
      {
        class: 'pcard' + (p.uid === me ? ' me' : '') + (p.on === false ? ' off' : ''),
        'data-uid': p.uid,
        style: { transform: `translateY(calc(var(--u) * ${lift.toFixed(2)})) rotate(${rot.toFixed(1)}deg)`, zIndex: String(10 + n - i) },
      },
      el('div', { class: 'pc-face', style: { background: SKINS[p.skin % SKINS.length].card } }, el('img', { src: portrait(p.skin, p.acc || null), alt: '' })),
      p.lvl ? el('div', { class: 'pc-lvl' }, String(p.lvl)) : null,
      el('div', { class: 'pc-name' }, p.name),
      el('div', { class: 'pc-score' }, String(p.score)),
      p.uid === host ? el('div', { class: 'pc-host', title: t('المضيف') }, '👑') : null,
      p.mult > 1 ? el('div', { class: 'pc-mult' }, `×${p.mult}`) : null,
      p.bonus > 0 ? el('div', { class: 'pc-bonus' }, `+${p.bonus}`) : null,
      badges[p.uid] ? el('div', { class: 'pc-badge' }, badges[p.uid]) : null,
      gains[p.uid] ? el('div', { class: 'pc-gain' }, `+${gains[p.uid]}`) : null,
    );
    const old = prev.get(p.uid);
    if (old && old.querySelector('.pc-score').textContent !== String(p.score)) card.classList.add('bump');
    wrap.appendChild(card);
  });
}

/* ------------------------------------------------------------ شريط الموجة */
// شريط أسود بعرض الشاشة: موجة المثال رمادية بالنص (~ثلث العرض)، المؤشر أحمر، ووقت التسجيل تتلوّن زرقاء.
// المحور الأفقي = الزمن: المؤشر يبدي قبل الموجة بشوية (مهلة lead) ويكمل بعدها لنهاية نافذة التسجيل.
const WAVE_W = 0.34;
const WIN_W = 0.62;

function envelope(peaks) {
  const n = peaks ? peaks.length : 0;
  if (!n) return new Float32Array(160).fill(0.5);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (peaks[Math.max(0, i - 1)] + 2 * peaks[i] + peaks[Math.min(n - 1, i + 1)]) / 4;
    out[i] = 0.16 + 0.84 * Math.sqrt(Math.max(0, a));
  }
  // أطراف مدوّرة مثل الأصلية
  const tap = Math.max(2, Math.round(n * 0.045));
  for (let i = 0; i < tap; i++) {
    const k = Math.sin(((i + 0.5) / tap) * (Math.PI / 2));
    out[i] *= k;
    out[n - 1 - i] *= k;
  }
  return out;
}

export class WaveBar {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector('canvas');
    this.g = this.canvas.getContext('2d');
    this.ref = null;
    this.dur = 2;
    this.win = 2.9;
    this.lead = 0.25;
    this.time = -1; // موقع المؤشر بالثواني داخل النافذة (-1 = مخفي)
    this.fillTo = -1; // لحد وين تتلوّن الموجة زرقاء (ثواني)
    this._mode = 'hidden';
    this.mode = 'hidden';
  }
  get mode() {
    return this._mode;
  }
  set mode(m) {
    this._mode = m;
    this.root.dataset.mode = m;
    if (this.root.parentElement) this.root.parentElement.dataset.mode = m;
  }
  show(on) {
    this.root.classList.toggle('show', on);
    if (!on) this.mode = 'hidden';
  }
  setRef(peaks, dur = 2, win = dur + 0.9, lead = 0.25) {
    this.ref = envelope(peaks);
    this.dur = Math.max(0.2, dur);
    this.lead = lead;
    this.win = Math.max(this.lead + 0.3, win);
    this.time = -1;
    this.fillTo = -1;
  }
  /** نهاية موجة المثال داخل النافذة (ثواني) */
  get refEnd() {
    return Math.min(this.win, this.lead + this.dur);
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
    const len = this.refEnd - this.lead;
    const pps = Math.min(WAVE_W / Math.max(0.05, len), WIN_W / this.win) * w; // بكسل لكل ثانية
    const a = w / 2 - (len * pps) / 2;
    const xT = (t) => a + (t - this.lead) * pps;
    const b = xT(this.refEnd);
    const n = this.ref.length;
    const mid = h / 2;
    const amp = h * 0.4;
    const path = () => {
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const x = a + ((b - a) * i) / (n - 1);
        const y = mid - this.ref[i] * amp;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      for (let i = n - 1; i >= 0; i--) g.lineTo(a + ((b - a) * i) / (n - 1), mid + this.ref[i] * amp);
      g.closePath();
    };
    path();
    g.fillStyle = '#958ea9';
    g.fill();
    g.lineWidth = Math.max(1, dpr * 1.2);
    g.strokeStyle = 'rgba(214,208,232,0.55)';
    g.stroke();
    if (this.fillTo > 0) {
      g.save();
      g.beginPath();
      g.rect(0, 0, Math.min(w, xT(this.fillTo)), h);
      g.clip();
      path();
      g.fillStyle = '#35befd';
      g.fill();
      g.restore();
    }
    if (this.time >= 0) {
      const x = Math.min(w - dpr * 4, xT(Math.min(this.win, this.time)));
      g.fillStyle = '#e8141e';
      g.fillRect(Math.round(x - dpr * 2.2), Math.round(h * 0.03), Math.round(dpr * 4.4), Math.round(h * 0.94));
    }
  }
}

/* ------------------------------------------------------------ خلفية المثال (فيديو/صورة) */
// الأصوات اللي إلها فيديو أو صورة تنعرض خلفية معتّمة ورا «حاول تقلّدها»؛ الأصوات العادية بلا خلفية مثل الأصلية.
export function showMeme(sound, entry) {
  const m = $('#meme');
  m.innerHTML = '';
  let media = null;
  if (entry && entry.videoUrl) {
    media = el('video', { src: entry.videoUrl, muted: true, playsinline: true, 'webkit-playsinline': true, preload: 'auto' });
    media.muted = true;
  } else if (sound && sound.img) {
    media = el('img', { src: sound.img, alt: '' });
  }
  if (!media) {
    m.className = '';
    return null;
  }
  m.appendChild(media);
  m.className = 'show';
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

export function confirmDialog(text, yes = t('إي'), no = t('لا')) {
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

/**
 * لوحة أرقام للدخول بكود (بدون كيبورد النظام لأن الشاشة مُدارة).
 * onSubmit(code) ترجع true للنجاح، أو نص خطأ يظهر تحت الأرقام.
 */
export function keypad(onSubmit, onClose) {
  let code = '';
  let busy = false;
  const disp = el('div', { class: 'kp-display' });
  const hint = el('div', { class: 'hint kp-hint' }, t('الكود 5 أرقام — تلگاه عند صاحب الغرفة'));
  const render = () => {
    disp.innerHTML = '';
    for (let i = 0; i < 5; i++) disp.appendChild(el('span', { class: 'kp-digit' + (code[i] ? ' on' : '') }, code[i] || ''));
  };
  render();
  const submit = async () => {
    if (busy || code.length !== 5) return;
    busy = true;
    hint.textContent = t('جاري البحث عن الغرفة…');
    hint.classList.remove('err');
    let res;
    try {
      res = await onSubmit(code);
    } catch (e) {
      res = t((e && e.message) || 'صار خطأ بالاتصال');
    }
    busy = false;
    if (res === true) return;
    hint.textContent = typeof res === 'string' ? res : t('ماكو غرفة بهالكود');
    hint.classList.add('err');
    disp.classList.remove('shake');
    void disp.offsetWidth;
    disp.classList.add('shake');
    code = '';
    render();
  };
  const press = (d) => {
    if (busy) return;
    if (d === 'del') code = code.slice(0, -1);
    else if (code.length < 5) code += d;
    render();
    if (code.length === 5) setTimeout(submit, 120);
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
          onclick: () => (k === 'ok' ? submit() : press(k)),
        },
        k === 'del' ? '⌫' : k === 'ok' ? '✓' : k,
      ),
    ),
  );
  return el(
    'div',
    { class: 'panel keypad' },
    el('button', { class: 'xbtn', onclick: onClose }, '✕'),
    el('div', { class: 'kp-side' }, el('div', { class: 'panel-title' }, t('ادخل كود الغرفة')), disp, hint),
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
    : [el('div', { class: 'hint center' }, t('بعد ماكو أحد — كون أول واحد! 🎤'))];
  return el(
    'div',
    { class: 'panel board' },
    el('button', { class: 'xbtn', onclick: onClose }, '✕'),
    el('div', { class: 'panel-title' }, t('🏆 المتصدرين')),
    el('div', { class: 'lb-list' }, list),
  );
}
