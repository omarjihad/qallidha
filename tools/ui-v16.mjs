// لقطات وفحص ميزات 1.6 بالمتصفح: زر «ضيف صوت»، لوحة اللفلات، قائمة الغرف العامة، دخول اللاعبين مشي،
// الدردشة الصوتية (إرسال واستقبال، والمايك ينسد وقت التقليد)، وصورة اللاعب ويا صوته، والصيانة (MAINT=1).
//   node tools/ui-v16.mjs <out-dir>
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { mulawEncode } from '../public/js/dsp.js';
import { adpcmEncode } from '../public/js/adpcm.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const TOKEN = process.env.TOKEN || '123456:TEST-token_abcdefghijklmnop';
const out = process.argv[2] || '/tmp/ui-v16';
const UID = Number(process.env.UI_UID || 700000 + Math.floor(Math.random() * 90000));
mkdirSync(out, { recursive: true });
const secret = createHmac('sha256', TOKEN).update('qallidha-webhook').digest('hex').slice(0, 48);
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
let ok = 0;
let bad = 0;
const check = (cond, label) => {
  if (cond) ok++;
  else bad++;
  log(cond ? '✅' : '❌', label);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function signInitData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAv16', user: JSON.stringify(user) });
  const pairs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(pairs).digest('hex'));
  return p.toString();
}
const user = { id: UID, first_name: 'عمر', last_name: 'V16', language_code: 'ar' };
const initData = signInitData(user);
const post = (path, body) => fetch(BASE + path, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
let upd = 70000 + Math.floor(Math.random() * 9000);
const hook = (obj) =>
  fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ update_id: ++upd, ...obj }),
  });
const admin = { id: 42, first_name: 'Omar', is_bot: false };
const press = (data) => hook({ callback_query: { id: 'cb' + ++upd, from: admin, data, message: { message_id: 5, chat: { id: 42, type: 'private' }, date: 0 } } });

function tone(seconds, f, sr = 16000, amp = 0.5) {
  const n = Math.floor(seconds * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / sr) * Math.min(1, i / 800, (n - i) / 800);
  return x;
}

/** لاعب ثاني (بدون متصفح): يسوّي غرفة عامة، يلعب، ويحچي بالدردشة */
class Bot {
  constructor(name) {
    this.name = name;
    this.gid = 'v16' + Date.now().toString(36);
    this.done = {};
    this.voiceIn = 0;
    this.voiceInPerform = 0;
    this.phase = '';
    this.enc = { pred: 0, index: 0 };
    this.seq = 0;
  }
  async create() {
    const r = await post('/api/rooms', { guestId: this.gid, guestName: this.name, pub: true });
    this.code = r.code;
    await new Promise((resolve) => {
      this.ws = new WebSocket(BASE.replace('http', 'ws') + `/ws/${r.code}?g=${this.gid}&n=${encodeURIComponent(this.name)}`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = resolve;
      this.ws.onmessage = (e) => this.onMsg(e.data);
    });
    return r;
  }
  /** قطعة دردشة (200ms بـ8kHz) */
  talk() {
    const f = tone(0.2, 330, 8000, 0.35);
    const body = adpcmEncode(f, this.enc);
    const o = new Uint8Array(body.length + 2);
    o[0] = 3;
    o[1] = this.seq = (this.seq + 1) & 255;
    o.set(body, 2);
    this.ws.send(o);
  }
  once(k, fn, ms) {
    if (this.done[k]) return;
    this.done[k] = true;
    setTimeout(fn, ms);
  }
  onMsg(data) {
    if (typeof data !== 'string') {
      const u8 = new Uint8Array(data);
      if (u8[0] === 3) {
        this.voiceIn++;
        if (this.phase === 'perform') this.voiceInPerform++;
      }
      return;
    }
    const m = JSON.parse(data);
    if (m.t === 'hello') this.me = m.you;
    if (m.t !== 'state') return;
    const st = m.st;
    this.st = st;
    this.phase = st.phase;
    const k = `${st.gameNo}:${st.round}`;
    if (st.phase === 'intro') this.once('l' + k, () => this.ws.send(JSON.stringify({ t: 'loaded', r: st.round, dur: 1.3 })), 300);
    if (st.phase === 'perform')
      this.once('p' + k, () => {
        const enc = mulawEncode(tone(1.3, 300));
        const o = new Uint8Array(enc.length + 4);
        o[0] = 1;
        o[1] = st.round & 255;
        o.set(enc, 4);
        this.ws.send(o);
      }, Math.max(0, st.t.recEnd - Date.now()) + 150);
    if (st.phase === 'analyze')
      this.once('a' + k, () => {
        const v = {};
        for (const uid of st.takes) v[uid] = 60;
        this.ws.send(JSON.stringify({ t: 'scores', r: st.round, v }));
      }, 300);
    if (st.phase === 'wheel' && st.wheel) {
      const w = st.wheel[this.me];
      if (w && w.seg == null) this.once('s' + k, () => this.ws.send(JSON.stringify({ t: 'spin' })), 400);
      if (w && w.needTarget && !w.done) {
        const other = st.players.find((p) => p.uid !== this.me);
        this.once('t' + k, () => this.ws.send(JSON.stringify({ t: 'target', uid: other.uid })), 1500);
      }
    }
  }
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, timezoneId: 'Asia/Baghdad' });
await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await ctx.addInitScript(
  ({ initData, user }) => {
    const noop = () => {};
    window.Telegram = {
      WebApp: {
        initData,
        initDataUnsafe: { user, auth_date: Math.floor(Date.now() / 1000) },
        platform: 'android',
        version: '8.0',
        colorScheme: 'dark',
        themeParams: {},
        isVersionAtLeast: () => true,
        ready: noop,
        expand: noop,
        disableVerticalSwipes: noop,
        setHeaderColor: noop,
        setBackgroundColor: noop,
        setBottomBarColor: noop,
        onEvent: noop,
        offEvent: noop,
        requestFullscreen: noop,
        lockOrientation: noop,
        enableClosingConfirmation: noop,
        disableClosingConfirmation: noop,
        HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
        BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
        openTelegramLink: (u) => console.log('[tg] link ' + u),
        isFullscreen: true,
        safeAreaInset: { top: 32, bottom: 16, left: 0, right: 0 },
        contentSafeAreaInset: { top: 56, bottom: 0, left: 0, right: 0 },
        viewportStableHeight: 0,
        CloudStorage: { setItem: (k, v, cb) => cb && cb(null, true), getItem: (k, cb) => cb && cb(null, '') },
      },
    };
    document.addEventListener('DOMContentLoaded', () => {
      const t = document.getElementById('toast');
      if (!t) return;
      let last = '';
      new MutationObserver(() => {
        const txt = t.classList.contains('show') ? t.textContent : '';
        if (txt && txt !== last) console.log('[toast] ' + txt);
        last = txt;
      }).observe(t, { attributes: true, childList: true, characterData: true, subtree: true });
    });
  },
  { initData, user },
);
const page = await ctx.newPage();
const errors = [];
const toasts = [];
const links = [];
page.on('pageerror', (e) => errors.push(e.message));
const failed = [];
page.on('response', (r) => {
  if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
});
page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('[toast] ')) {
    toasts.push(t.slice(8));
    log('   💬', t.slice(8));
  }
  if (t.startsWith('[tg] link ')) links.push(t.slice(10));
  // ملفات أصوات وهمية من اختبارات البوت القديمة (/tgfile) ترجع 404 — مو خطأ باللعبة
  if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push(t);
});
let n = 0;
async function shot(name) {
  n++;
  const f = `${out}/${String(n).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: f + '-raw.png' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f + '-raw.png', '-vf', 'transpose=2,scale=1100:-1', f + '.png']);
  log('📸', name);
}
const tap = async (sel) => {
  const e = await page.waitForSelector(sel, { timeout: 15000 });
  const b = await e.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
};
const st = () => page.evaluate(() => (window.__qd.game && window.__qd.game.st) || null);

// ---------------- القائمة: زر «ضيف صوت»
await page.goto(BASE + '/');
await page.waitForTimeout(2500);
await shot('menu');
check(!!(await page.$('.menu-side .side-btn.addsnd')), 'زر «🎙️ ضيف صوت» بالقائمة');
await tap('.menu-side .side-btn.addsnd');
await page.waitForTimeout(500);
check(links.some((l) => /\?start=addsound$/.test(l)), `يفتح البوت على خطوة الصوت (${links.pop() || '—'})`);

// ---------------- لوحة اللفلات من الضغط على الاسم والصورة
await tap('.profile-chip');
await page.waitForSelector('.panel.levels', { timeout: 5000 });
await page.waitForTimeout(600);
const lv = await page.evaluate(() => ({
  rows: document.querySelectorAll('.lv-row').length,
  cur: (document.querySelector('.lv-row.cur .lv-n') || {}).textContent,
  big: (document.querySelector('.lv-big') || {}).textContent,
  left: (document.querySelector('.lv-left') || {}).textContent,
  how: document.querySelectorAll('.lv-how > div').length,
  next: (document.querySelector('.lv-row.next .lv-st') || {}).textContent,
  tenth: (document.querySelector('.lv-row.big .lv-rw') || {}).textContent,
  scrolled: document.querySelector('.lv-list').scrollTop,
}));
check(lv.rows === 100 && lv.cur === lv.big && /باقيلك \d+ نقطة للفل \d+ — جائزته/.test(lv.left) && lv.how === 3, `اللفلات: ${lv.rows} لفل، لفلك ${lv.big}، «${lv.left}»`);
check(/^باقي \d+/.test(lv.next || '') && /120/.test(lv.tenth || ''), `اللفل الجاي «${lv.next}» وكل 10 لفلات ${lv.tenth}`);
await shot('levels');
await tap('.panel.levels .xbtn');
await page.waitForTimeout(500);

// ---------------- الغرف العامة: قائمة + غرفة لاعب ثاني بيها
const bot = new Bot('Lina');
await tap('.menu-btns .btn.quick');
await page.waitForSelector('.panel.rooms', { timeout: 5000 });
check(!!(await page.$('.panel.rooms .rooms-actions .btn.pink')) && !!(await page.$('.panel.rooms .rooms-actions .btn.blue')), 'لوحة الغرف العامة: «إنشاء غرفة عامة» و«دخول سريع»');
const made = await bot.create();
check(made.pub === true && /^\d{5}$/.test(made.code), `لاعب ثاني سوّى غرفة عامة ${made.code}`);
let row = null;
for (let i = 0; i < 12 && !row; i++) {
  await page.waitForTimeout(500);
  row = await page.evaluate((code) => {
    const r = [...document.querySelectorAll('.room-row')].find((x) => x.textContent.includes('#' + code));
    return r ? r.textContent : null;
  }, made.code);
}
check(row && row.includes('Lina') && row.includes('1/5'), `الغرفة بانت بالقائمة لوحدها: «${(row || '').replace(/\s+/g, ' ').slice(0, 80)}»`);
await shot('rooms');

// ---------------- ندخل منها: اللاعبين يجون يمشون من اليسار ويوكفون بالصف
// القائمة تتحدث كل 3 ثواني: نلگي الزر ونضغطه بنفس اللحظة
const box = await page.evaluate((code) => {
  const r = [...document.querySelectorAll('.room-row')].find((x) => x.textContent.includes('#' + code));
  const b = r.querySelector('.btn.green').getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}, made.code);
await page.touchscreen.tap(box.x, box.y);
const xs = [];
for (let i = 0; i < 9; i++) {
  await page.waitForTimeout(i === 0 ? 250 : 420);
  xs.push(await page.evaluate(() => [...window.__qd.stage.chars.values()].map((c) => +c.pos.x.toFixed(2))));
  if (i === 1 || i === 3 || i === 7) await shot('walkin-' + i);
}
const first = xs.find((a) => a.length === 2) || [];
const last = xs[xs.length - 1];
check(first.length === 2 && Math.min(...first) < -6, `أول ما دخلنا: الشخصيات برّا الشاشة يسار (${JSON.stringify(first)})`);
check(last.length === 2 && last.every((x) => Math.abs(x) <= 1.6), `بعد ثواني: وكفوا بمكانهم بالصف (${JSON.stringify(last)})`);
const s0 = await st();
check(s0 && s0.code === made.code && s0.pub && s0.players.length === 2, `دخلنا الغرفة العامة (${s0 && s0.players.map((p) => p.name).join(', ')})`);

// ---------------- الدردشة الصوتية
await tap('#lobbyBar .btn.orange, #lobbyBar .btn.green');
await page.waitForTimeout(800);
const chat0 = await page.$eval('#chatBtn', (b) => b.dataset.state);
check(chat0 === 'on', `زر المايك: ${chat0}`);
// اللاعب الثاني يحچي: يوصلني ويضوي كارته
const rx0 = await page.evaluate(() => window.__qd.game.voice.rx);
const talker = setInterval(() => bot.talk(), 200);
await page.waitForTimeout(900);
const v1 = await page.evaluate((uid) => ({ rx: window.__qd.game.voice.rx, talking: !!document.querySelector(`#cards .pcard[data-uid="${uid}"].talking`) }), bot.me);
await shot('voice-talking');
clearInterval(talker);
check(v1.rx - rx0 >= 3 && v1.talking, `وصلني صوته (${v1.rx - rx0} قطعة) وكارته يضوي`);
// صوتي يوصله (المايك الوهمي يطلع صفارة)
await page.waitForTimeout(3500);
const tx = await page.evaluate(() => window.__qd.game.voice.tx);
check(tx > 0 && bot.voiceIn > 0, `صوتي وصل للاعب الثاني (أرسلت ${tx}، وصله ${bot.voiceIn})`);
// كتم لاعب: دوسة على كارته
await tap(`#cards .pcard:not(.me)`);
await page.waitForTimeout(300);
const muted = await page.evaluate(() => [...window.__qd.game.voice.muted]);
check(muted.includes(bot.me) && !!(await page.$('#cards .pcard .pc-mute')), 'دوسة على كارت لاعب: كتمته (🔇)');
const rx1 = await page.evaluate(() => window.__qd.game.voice.rx);
bot.talk();
await wait(400);
check((await page.evaluate(() => window.__qd.game.voice.rx)) === rx1, 'المكتوم ما ينسمع');
await tap(`#cards .pcard:not(.me)`);
await page.waitForTimeout(300);
// ---------------- وقت التقليد: المايك مسدود (لا إرسال ولا استقبال) — الغرفة العامة تبدي لوحدها، أو المضيف يبديها
bot.ws.send(JSON.stringify({ t: 'start' }));
let phase = '';
const t0 = Date.now();
while (Date.now() - t0 < 20000) {
  phase = ((await st()) || {}).phase;
  if (phase === 'perform') break;
  await page.waitForTimeout(200);
}
await page.waitForTimeout(500);
const lockState = await page.$eval('#chatBtn', (b) => b.dataset.state);
const rxP = await page.evaluate(() => window.__qd.game.voice.rx);
const inP = bot.voiceInPerform;
for (let i = 0; i < 4; i++) {
  bot.talk();
  await wait(200);
}
await page.waitForTimeout(300);
check(phase === 'perform' && lockState === 'lock', `وقت التقليد: زر المايك 🔒 (${lockState})`);
check((await page.evaluate(() => window.__qd.game.voice.rx)) === rxP && bot.voiceInPerform === inP, 'وقت التقليد: ماكو صوت دردشة (لا يطلع ولا يوصل)');
await shot('perform-locked');
// صوت ضافه لاعب: صورته واسمه وقت المثال
await page.evaluate(() => {
  const img = window.__qd.stage.renderer.domElement.toDataURL('image/png');
  return import('/js/ui.js').then((ui) => ui.showMeme({ by: 'أحمد', img, title: 'ضحكة أبو عصام' }, null));
});
await page.waitForTimeout(700);
const by = await page.$eval('#meme .meme-by', (e) => e.textContent).catch(() => '');
check(/صوت من/.test(by) && by.includes('أحمد'), `صوت لاعب: «${by}»`);
await shot('user-sound-credit');
await page.evaluate(() => import('/js/ui.js').then((ui) => ui.hideMeme()));
// بعد التقليد يرجع
const t1 = Date.now();
while (Date.now() - t1 < 25000) {
  phase = ((await st()) || {}).phase;
  if (phase === 'playback' || phase === 'wheel') break;
  await page.waitForTimeout(300);
}
await page.waitForTimeout(300);
check(['on', 'need'].includes(await page.$eval('#chatBtn', (b) => b.dataset.state)), `بعد التقليد رجع المايك (${phase})`);
// أسكّر مايكي: ما يرسل بعد
await tap('#chatBtn');
await page.waitForTimeout(500);
const tx1 = await page.evaluate(() => window.__qd.game.voice.tx);
await page.waitForTimeout(2500);
const tx2 = await page.evaluate(() => window.__qd.game.voice.tx);
check((await page.$eval('#chatBtn', (b) => b.dataset.state)) === 'off' && tx2 === tx1, 'زر المايك يسكّره: ما يرسل');

// ---------------- نطلع
bot.ws.close();
await page.evaluate(() => window.__qd.game && window.__qd.game.leave());
await page.waitForTimeout(1200);
check((await page.$eval('#chatBtn', (b) => b.dataset.state)) === 'hidden', 'بعد الخروج زر المايك يختفي');

// ---------------- الصيانة (MAINT=1): اللاعب يشوف شاشة الصيانة، وزر «جرّب مرة ثانية» يرجّعه
if (process.env.MAINT === '1') {
  await press('ad|maint');
  log('… ننتظر 21 ثانية (ذاكرة العامل)');
  await wait(21000);
  await page.reload();
  await page.waitForTimeout(2500);
  check(!!(await page.$('.panel.maint')), 'الصيانة: شاشة «اللعبة بالصيانة»');
  await shot('maintenance');
  await press('ad|maint');
  await wait(21000);
  await tap('.panel.maint .btn');
  await page.waitForTimeout(1200);
  check(!(await page.$('.panel.maint')) && !!(await page.$('.menu')), 'بعد الصيانة: «جرّب مرة ثانية» يرجّع القائمة');
}

const badLoads = failed.filter((f) => !/\/tgfile\//.test(f));
check(errors.length === 0 && badLoads.length === 0, `ماكو أخطاء ${[...errors, ...badLoads].slice(0, 4).join(' | ')}`);
console.log(`\n${ok} ✅  ${bad} ❌`);
await browser.close();
process.exit(bad ? 1 : 0);
