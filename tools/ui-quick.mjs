// لقطات اللعب العشوائي بالمتصفح: زر «🎲 لعب عشوائي» ← قائمة الغرف ← «⚡ دخول سريع» ← ندوّر لاعبين ← بوت يدخل ← عد تنازلي ← تبدي لوحدها
// ← النهاية («اللعبة الجاية بعد…» + «🎲 غرفة ثانية») ← ترجع غرفة انتظار.
//   node tools/ui-quick.mjs <out-dir>
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { mulawEncode } from '../public/js/dsp.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const out = process.argv[2] || '/tmp/ui-quick';
mkdirSync(out, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
let ok = 0;
let bad = 0;
const check = (cond, label) => {
  if (cond) ok++;
  else bad++;
  log(cond ? '✅' : '❌', label);
};
const post = (path, body) => fetch(BASE + path, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());

function tone(seconds, f) {
  const n = Math.floor(seconds * 16000);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * f * i) / 16000) * Math.min(1, i / 800, (n - i) / 800);
  return x;
}
class Bot {
  constructor(name) {
    this.name = name;
    this.gid = 'uiq' + Date.now().toString(36);
    this.done = {};
  }
  async join() {
    const r = await post('/api/quick', { guestId: this.gid, guestName: this.name });
    this.code = r.code;
    await new Promise((resolve) => {
      this.ws = new WebSocket(BASE.replace('http', 'ws') + `/ws/${r.code}?g=${this.gid}&n=${encodeURIComponent(this.name)}`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = resolve;
      this.ws.onmessage = (e) => this.onMsg(e.data);
    });
    return r.code;
  }
  once(k, fn, ms) {
    if (this.done[k]) return;
    this.done[k] = true;
    setTimeout(fn, ms);
  }
  onMsg(data) {
    if (typeof data !== 'string') return;
    const m = JSON.parse(data);
    if (m.t === 'hello') this.me = m.you;
    if (m.t !== 'state') return;
    const st = m.st;
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
        for (const uid of st.takes) v[uid] = 55;
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
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('qd_gname', 'عمر');
  } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
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
const hint = () => page.$eval('.lobby-hint', (e) => e.textContent).catch(() => '');

await page.goto(BASE + '/');
await page.waitForTimeout(2500);
await shot('menu');
// «🎲 لعب عشوائي» يفتح قائمة الغرف العامة، ومنها «⚡ دخول سريع»
await tap('.menu-btns .btn.quick');
await page.waitForSelector('.panel.rooms', { timeout: 8000 });
await shot('rooms-list');
await tap('.panel.rooms .rooms-actions .btn.blue');
await page.waitForSelector('#lobbyBar .room-code b', { timeout: 15000 });
await page.waitForTimeout(1500);
const s0 = await st();
check(s0 && s0.pub === true, `دخل غرفة عامة ${s0 && s0.code}`);
const h0 = await hint();
check(/ندوّر لاعبين/.test(h0), `لوحده: «${h0}»`);
const label = await page.$eval('#lobbyBar .room-code small', (e) => e.textContent);
check(/عشوائي/.test(label), `الشريط يكول عشوائي: «${label}»`);
await shot('searching');

const bot = new Bot('Lina');
const code = await bot.join();
check(code === s0.code, `اللاعب الغريب انطى نفس الغرفة (${code})`);
await page.waitForTimeout(1500);
const h1 = await hint();
check(/تبدي بعد \d+ ثانية \(2\/5\)/.test(h1), `عد تنازلي: «${h1}»`);
await shot('countdown');
await page.waitForTimeout(2200);
const h2 = await hint();
const s1 = Number((/(\d+) ثانية/.exec(h1) || [])[1]);
const s2 = Number((/(\d+) ثانية/.exec(h2) || [])[1]);
check(s2 < s1, `العد ينزل كل ثانية (${s1} ← ${s2})`);

// تبدي لوحدها (ما نضغط ابدأ)
const t0 = Date.now();
let phase = '';
while (Date.now() - t0 < 30000) {
  phase = ((await st()) || {}).phase;
  if (phase === 'intro') break;
  await page.waitForTimeout(300);
}
check(phase === 'intro', 'اللعبة بدت لوحدها');
await page.waitForTimeout(400);
await shot('auto-start');

// نكمل لحد النهاية
const t1 = Date.now();
while (Date.now() - t1 < 240000) {
  const s = await st();
  if (s && s.phase === 'final') break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1500);
const fin = await page.evaluate(() => ({
  next: (document.querySelector('.final .next-game') || {}).textContent || '',
  btns: [...document.querySelectorAll('.final-btns button')].map((b) => b.textContent),
}));
check(/اللعبة الجاية بعد \d+ ثانية/.test(fin.next) && fin.btns.some((b) => /غرفة ثانية/.test(b)) && !fin.btns.some((b) => /لعبة جديدة/.test(b)), `النهاية: «${fin.next}» + ${fin.btns.join(' | ')}`);
await shot('final');

// ترجع غرفة انتظار وعد جديد (اللاعبين باقين)
const t2 = Date.now();
while (Date.now() - t2 < 20000) {
  const s = await st();
  if (s && s.phase === 'lobby') break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(1200);
const s3 = await st();
const h3 = await hint();
check(s3 && s3.phase === 'lobby' && s3.pub && !(await page.$('.final')), `رجعت غرفة انتظار: «${h3}»`);
await shot('back-to-lobby');

bot.ws.close();
check(errors.length === 0, `ماكو أخطاء ${errors.join(' | ')}`);
console.log(`\n${ok} ✅  ${bad} ❌`);
await browser.close();
process.exit(bad ? 1 : 0);
