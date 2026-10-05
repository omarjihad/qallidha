// اختبار شامل: 3 لاعبين بمتصفحات حقيقية (مايك وهمي) يلعبون لعبة كاملة مع لقطات شاشة لكل مرحلة.
// npx wrangler dev   ثم:   node tools/e2e.mjs <out-dir> [fake-mic.wav]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const out = process.argv[2] || '/tmp/e2e';
const wav = process.argv[3];
const N = Number(process.env.PLAYERS || 3);

const args = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];
if (wav) args.push(`--use-file-for-fake-audio-capture=${wav}`);
const browser = await chromium.launch({ args });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const errors = [];

async function newPlayer(i) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await ctx.addInitScript((n) => {
    try {
      localStorage.setItem('qd_gname', n);
    } catch {}
  }, ['عمر', 'سارة', 'حيدر', 'نور', 'علي'][i]);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`p${i} [${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`p${i} [pageerror] ${e.message}\n${e.stack}`));
  return page;
}

let shotN = 0;
async function shot(page, name) {
  shotN++;
  const file = `${out}/${String(shotN).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: file + '-raw.png' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file + '-raw.png', '-vf', 'transpose=2,scale=844:-1', file + '.png']);
  log('📸', name);
}

const tap = async (page, selector) => {
  const el = await page.waitForSelector(selector, { timeout: 15000 });
  const box = await el.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
};

const state = (page) =>
  page.evaluate(() => {
    const g = window.__qd && window.__qd.game;
    if (!g || !g.st) return null;
    return { phase: g.st.phase, round: g.st.round, t: g.st.t, now: g.serverNow(), me: g.me, wheel: g.st.wheel, finals: g.st.finals, players: g.st.players.map((p) => [p.name, p.score]) };
  });

const pages = [];
for (let i = 0; i < N; i++) pages.push(await newPlayer(i));
const [host, ...guests] = pages;

await host.goto(BASE + '/');
await host.waitForTimeout(1800);
await tap(host, '.menu-btns .btn.pink');
await host.waitForSelector('.room-code b', { timeout: 15000 });
const code = await host.$eval('.room-code b', (e) => e.textContent);
log('room', code);
for (const g of guests) {
  await g.goto(BASE + '/?room=' + code);
}
await host.waitForTimeout(2500);
for (const p of pages) {
  const btn = await p.$('#lobbyBar .btn.orange');
  if (btn) await tap(p, '#lobbyBar .btn.orange');
}
await host.waitForTimeout(1500);
await shot(host, 'lobby');
await shot(guests[0], 'lobby-guest');
await tap(host, '#lobbyBar .btn.pink');

const seen = new Set();
const waitUntil = async (page, serverTs) => {
  const s = await state(page);
  if (!s) return;
  const ms = serverTs - s.now;
  if (ms > 0) await page.waitForTimeout(ms);
};

let done = false;
const t0 = Date.now();
while (!done && Date.now() - t0 < 300000) {
  const s = await state(host);
  if (!s) {
    await host.waitForTimeout(200);
    continue;
  }
  const key = `${s.round}:${s.phase}`;
  if (!seen.has(key)) {
    seen.add(key);
    log('phase', key, JSON.stringify(s.players));
    const r = s.round;
    if (s.phase === 'intro' && r === 1) {
      await host.waitForTimeout(500);
      await shot(host, `r${r}-intro`);
    }
    if (s.phase === 'perform' && (r === 1 || r === 2)) {
      const t = s.t;
      await waitUntil(host, t.listenAt + 400);
      await shot(host, `r${r}-listen`);
      await waitUntil(host, t.reproduceAt + 650);
      await shot(host, `r${r}-reproduce`);
      if (r === 1) {
        await waitUntil(host, t.countAt + 250);
        await shot(host, `r${r}-count3`);
      }
      await waitUntil(host, t.recAt + Math.min(1500, (t.recEnd - t.recAt) * 0.6));
      await shot(host, `r${r}-record`);
    }
    if (s.phase === 'analyze' && r === 1) await shot(host, `r${r}-analyze`);
    if (s.phase === 'playback') {
      const res = await host.evaluate(() => window.__qd.game.st.results);
      log('results', JSON.stringify(res));
    }
    if (s.phase === 'playback' && r <= 2) {
      const play = await host.evaluate(() => window.__qd.game.st.play);
      const first = play.find((x) => !x.none) || play[0];
      if (first && !first.none) {
        await waitUntil(host, first.at + first.walk + 300);
        await shot(host, `r${r}-playback-sing`);
        await waitUntil(host, first.at + first.walk + first.dur + 700);
        await shot(host, `r${r}-playback-score`);
      }
    }
    if (s.phase === 'wheel') {
      await host.waitForTimeout(600);
      if (r === 1) await shot(host, `r${r}-wheel`);
      for (const p of pages) {
        const b = await p.$('.spin-btn');
        if (b && (await b.isVisible())) await tap(p, '.spin-btn').catch(() => null);
      }
      await host.waitForTimeout(1500);
      if (r === 1) await shot(host, `r${r}-wheel-spinning`);
      await host.waitForTimeout(3400);
      if (r <= 2) await shot(host, `r${r}-wheel-result`);
      for (const p of pages) {
        const hit = await p.$('.phit.on');
        if (hit) {
          if (r <= 2) await shot(p, `r${r}-target-pick`);
          await hit.evaluate((e) => e.click());
          log('picked target');
        }
      }
    }
    if (s.phase === 'final') {
      await host.waitForTimeout(1500);
      await shot(host, 'final');
      log('finals', JSON.stringify(s.finals && s.finals.map((f) => [f.name, f.score, f.rank])));
      done = true;
    }
  }
  await host.waitForTimeout(120);
}

// قائمة الترتيب والمساعدة
await tap(host, '.final-btns .btn.ghost').catch(() => null);
await host.waitForTimeout(1500);
await shot(host, 'menu-after');
await tap(host, '.menu-top .help').catch(() => null);
await host.waitForTimeout(700);
await shot(host, 'help');
await tap(host, '.xbtn').catch(() => null);
await host.waitForTimeout(500);
await tap(host, '.menu-btns .btn.blue').catch(() => null);
await host.waitForTimeout(700);
await shot(host, 'keypad');

console.log('\n==== console errors/warnings ====');
console.log([...new Set(errors)].filter((e) => !/requestFullscreen|THREE.Clock|GPU stall|WebGL|swiftshader|Automatic fallback/i.test(e)).join('\n') || '(none)');
await browser.close();
