// لقطات العجلة بالمتصفح: لاعب حقيقي + بوتين، والعجلة مثبّتة على قطعة (WHEEL_FORCE بالسيرفر).
// FORCE=swap: اختيار لاعب للتبديل ولافتة «أخذ صوت…» بالإعادة — FORCE=p10: +10 معلّقة على الكارت وتنضاف ويا الدرجة.
//   BASE=http://127.0.0.1:8792 FORCE=swap node tools/ui-wheel.mjs <out-dir>
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { mulawEncode } from '../public/js/dsp.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8792';
const FORCE = process.env.FORCE || 'swap';
const out = process.argv[2] || '/tmp/ui-wheel';
mkdirSync(out, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
let ok = 0;
let bad = 0;
const check = (cond, label) => {
  if (cond) ok++;
  else bad++;
  log(cond ? '✅' : '❌', label);
};

function tone(seconds, f) {
  const n = Math.floor(seconds * 16000);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * f * i) / 16000) * Math.min(1, i / 800, (n - i) / 800);
  return x;
}

class Bot {
  constructor(i, code) {
    this.i = i;
    this.code = code;
    this.done = {};
    this.name = ['سارة', 'حيدر'][i];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(BASE.replace('http', 'ws') + `/ws/${this.code}?g=uiw${this.i}${Date.now()}&n=${encodeURIComponent(this.name)}`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (e) => this.onMsg(e.data);
    });
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
    const st = (this.st = m.st);
    const r = st.round;
    if (st.phase === 'intro') this.once('l' + r, () => this.ws.send(JSON.stringify({ t: 'loaded', r, dur: 1.4 })), 300);
    if (st.phase === 'perform')
      this.once('p' + r, () => {
        const enc = mulawEncode(tone(1.4, 260 + this.i * 140));
        const o = new Uint8Array(enc.length + 4);
        o[0] = 1;
        o[1] = r & 255;
        o.set(enc, 4);
        this.ws.send(o);
      }, Math.max(0, st.t.recEnd - Date.now()) + 150);
    if (st.phase === 'analyze')
      this.once('a' + r, () => {
        const v = {};
        for (const uid of st.takes) v[uid] = 30 + 20 * st.players.find((p) => p.uid === uid).seat;
        this.ws.send(JSON.stringify({ t: 'scores', r, v }));
      }, 300);
    if (st.phase === 'wheel' && st.wheel) {
      const w = st.wheel[this.me];
      if (w && w.seg == null) this.once('s' + r, () => this.ws.send(JSON.stringify({ t: 'spin' })), 400);
      if (w && w.needTarget && !w.done) {
        // البوتين يختارون بعض حتى يبقى تبديل اللاعب الحقيقي واضح
        const other = st.players.find((p) => p.uid !== this.me && p.seat !== 0);
        this.once('t' + r, () => this.ws.send(JSON.stringify({ t: 'target', uid: other.uid })), 5200);
      }
    }
  }
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('qd_gname', 'عمر');
  } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let shotN = 0;
async function shot(name) {
  shotN++;
  const f = `${out}/${String(shotN).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: f + '-raw.png' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f + '-raw.png', '-vf', 'transpose=2,scale=1100:-1', f + '.png']);
  log('📸', name);
}
const tap = async (sel) => {
  const e = await page.waitForSelector(sel, { timeout: 15000 });
  const b = await e.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
};
const state = () => page.evaluate(() => (window.__qd.game && window.__qd.game.st) || null);
const serverNow = () => page.evaluate(() => window.__qd.game.serverNow());
const sleepUntil = async (ts) => {
  const ms = ts - (await serverNow());
  if (ms > 0) await page.waitForTimeout(ms);
};

await page.goto(BASE + '/');
await page.waitForTimeout(2000);
await tap('.menu-btns .btn.friends');
await page.waitForSelector('#lobbyBar .room-code b');
const code = await page.$eval('#lobbyBar .room-code b', (e) => e.textContent);
log('room', code);
const bots = [new Bot(0, code), new Bot(1, code)];
for (const b of bots) await b.connect();
await page.waitForTimeout(1200);
const mic = await page.$('#lobbyBar .btn.orange');
if (mic) await tap('#lobbyBar .btn.orange');
await page.waitForTimeout(600);
await tap('#lobbyBar .btn.pink');

const seen = new Set();
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  const st = await state();
  if (!st) {
    await page.waitForTimeout(200);
    continue;
  }
  const key = `${st.round}:${st.phase}`;
  if (!seen.has(key)) {
    seen.add(key);
    log('phase', key);
    if (st.phase === 'wheel' && st.round === 1) {
      // نقرا النتيجة أول ما توكف: إذا الكل خلص المرحلة تعبر بسرعة
      await page.waitForSelector('.wheel-result', { timeout: 12000 }).catch(() => null);
      const title = await page.$eval('.wheel-result', (e) => e.textContent).catch(() => '');
      const desc0 = await page.$eval('.wheel-desc', (e) => e.textContent).catch(() => '');
      await shot('wheel-landed');
      if (FORCE === 'swap') {
        check(/تبديل/.test(title), `العجلة وكفت على التبديل: «${title}»`);
        await page.waitForTimeout(1500);
        const pick = await page.$('.banner.pick');
        const pickTxt = pick ? await pick.textContent() : '';
        check(/تبدّل صوتك/.test(pickTxt), `يطلب تختار لاعب للتبديل: «${pickTxt}»`);
        await shot('swap-pick');
        const hit = await page.$('.phit.on');
        if (hit) await hit.evaluate((e) => e.click());
        await page.waitForTimeout(700);
        const desc = await page.$$eval('.wheel-desc', (els) => els.map((e) => e.textContent).join(' | ')).catch(() => '');
        check(/تاخذ صوت/.test(desc), `بعد الاختيار: «${desc.split(' | ').pop()}»`);
        await shot('swap-picked');
      } else {
        check(/\+10/.test(title), `العجلة وكفت على +10: «${title}»`);
        check(/الجولة الجاية/.test(desc0), `الوصف يكول بالجولة الجاية: «${desc0}»`);
        const scoreAtWheel = st.players.find((p) => p.seat === 0).score;
        await page.waitForTimeout(300);
        const after = (await state()).players.find((p) => p.seat === 0).score;
        check(after === scoreAtWheel, `النقاط ما زادت وقت العجلة (${scoreAtWheel})`);
      }
    }
    if (st.phase === 'intro' && st.round === 2 && FORCE === 'p10') {
      await page.waitForTimeout(600);
      const badge = await page.$$eval('.pc-bonus', (els) => els.map((e) => e.textContent));
      check(badge.length === 3 && badge.every((b) => b === '+10'), `+10 معلّقة على الكروت (${badge.join(',')})`);
      await shot('bonus-pending');
    }
    if (st.phase === 'playback' && st.round === 2) {
      const play = st.play || [];
      const me = st.players.find((p) => p.seat === 0);
      const mine = play.find((x) => x.uid === me.uid);
      if (FORCE === 'swap') {
        check(mine && mine.src && mine.src !== me.uid, `دوري بالإعادة يشغّل صوت لاعب ثاني (${mine && mine.src})`);
        await sleepUntil(mine.at + 500);
        const sw = await page.$('.banner.swap');
        const swTxt = sw ? await sw.textContent() : '';
        check(/أخذ صوت/.test(swTxt), `لافتة التبديل: «${swTxt}»`);
        await shot('swap-banner');
        await sleepUntil(mine.at + mine.walk + mine.dur + 600);
        await shot('swap-score');
      } else {
        // الدرجة توكف أول (مثلًا 30/100)، وبعدها +10 تطلع وتنضاف للرقم قدّامك (40/100)
        const first = play[0];
        const res = st.results[first.uid];
        check(first.reveal > 2200, `وقت العرض يطول بقدر الإضافة (${first.reveal}ms)`);
        await sleepUntil(first.at + first.walk + first.dur + 850);
        const num1 = await page.$eval('.banner.score > .num', (e) => e.textContent).catch(() => '');
        const chipOn1 = await page.$eval('.banner.score .mult.bonus', (e) => e.classList.contains('go')).catch(() => null);
        check(num1 === String(res.raw) && chipOn1 === false, `أول شي الدرجة بس: ${num1}/100 (المطلوب ${res.raw})`);
        await shot('bonus-before');
        await sleepUntil(first.at + first.walk + first.dur + 1900);
        const num2 = await page.$eval('.banner.score > .num', (e) => e.textContent).catch(() => '');
        const chips = await page.$$eval('.banner.score .mult.bonus.go', (els) => els.map((e) => e.textContent));
        check(chips.includes('+10') && num2 === String(res.raw + 10), `وبعدها +10 تنضاف: ${num1} ← ${num2}/100 (${chips.join(',')})`);
        await shot('bonus-score');
      }
    }
    if (st.phase === 'final') break;
  }
  await page.waitForTimeout(150);
}
for (const b of bots) b.ws.close();
console.log('errors:', errors.filter((e) => !/WebGL|GPU|swiftshader/i.test(e)).join(' | ') || '(none)');
console.log(`\n${ok} ✅  ${bad} ❌`);
await browser.close();
process.exit(bad ? 1 : 0);
