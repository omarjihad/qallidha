// يتحقق من خط التسجيل والتقييم كامل بالمتصفح: مايك مُحقن يشغّل الصوت الأصلي نفسه بلحظة التسجيل.
// اللاعب 1: نفس الصوت (لازم درجة عالية) — اللاعب 2: الصوت مسرّع 12% — اللاعب 3: ساكت (لازم صفر).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const out = process.argv[2] || '/tmp/e2e2';
const ROUNDS_TO_CHECK = Number(process.env.CHECK || 4);

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const errors = [];

const FAKE_MIC = () => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    // ضجيج غرفة خفيف حتى يكون الوضع واقعي
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.003;
    const ns = ctx.createBufferSource();
    ns.buffer = noise;
    ns.loop = true;
    ns.connect(dest);
    ns.start();
    window.__fakeMicPlay = async (url, rate = 1, gain = 0.45) => {
      if (ctx.state !== 'running') await ctx.resume();
      const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = gain;
      s.connect(g);
      g.connect(dest);
      s.start();
    };
    return dest.stream;
  };
};

async function newPlayer(i) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await ctx.addInitScript((n) => {
    try {
      localStorage.setItem('qd_gname', n);
    } catch {}
  }, ['مطابق', 'مسرّع', 'ساكت'][i]);
  await ctx.addInitScript(FAKE_MIC);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`p${i} ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`p${i} [pageerror] ${e.message}`));
  return page;
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
    return { phase: g.st.phase, round: g.st.round, t: g.st.t, now: g.serverNow(), sound: g.st.sound, players: g.st.players.map((p) => [p.uid, p.name]), results: g.st.results, sab: g.st.sab };
  });

let shotN = 0;
async function shot(page, name) {
  shotN++;
  const file = `${out}/${String(shotN).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: file + '-raw.png' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file + '-raw.png', '-vf', 'transpose=2,scale=844:-1', file + '.png']);
}

const pages = [];
for (let i = 0; i < 3; i++) pages.push(await newPlayer(i));
const [host, ...guests] = pages;
await host.goto(BASE + '/');
await host.waitForTimeout(1500);
await tap(host, '.menu-btns .btn.pink');
await host.waitForSelector('.room-code b');
const code = await host.$eval('.room-code b', (e) => e.textContent);
for (const g of guests) await g.goto(BASE + '/?room=' + code);
await host.waitForTimeout(2500);
for (const p of pages) await p.evaluate(() => document.querySelector('#lobbyBar .btn.orange')?.click());
await host.waitForTimeout(800);
await tap(host, '#lobbyBar .btn.pink');

const seen = new Set();
const t0 = Date.now();
const summary = [];
while (Date.now() - t0 < 300000) {
  const s = await state(host);
  if (!s) {
    await host.waitForTimeout(150);
    continue;
  }
  const key = `${s.round}:${s.phase}`;
  if (!seen.has(key)) {
    seen.add(key);
    if (s.phase === 'perform') {
      const delay = s.t.recAt + 150 - s.now;
      log(`round ${s.round}: «${s.sound.title}» dur=${s.t.dur.toFixed(2)}s`);
      setTimeout(() => {
        pages[0].evaluate((u) => window.__fakeMicPlay(u, 1.0), s.sound.url).catch((e) => log('play err', e.message));
        pages[1].evaluate((u) => window.__fakeMicPlay(u, 1.12), s.sound.url).catch((e) => log('play err', e.message));
      }, Math.max(0, delay));
      if (s.round === 1) {
        await host.waitForTimeout(Math.max(0, s.t.listenAt + 250 - s.now));
        await shot(host, 'listen');
        const s2 = await state(host);
        await host.waitForTimeout(Math.max(0, s.t.recAt + 1200 - s2.now));
        await shot(host, 'record');
      }
    }
    if (s.phase === 'playback') {
      const names = Object.fromEntries(s.players);
      const row = { round: s.round, sound: s.sound.title };
      for (const [uid, r] of Object.entries(s.results)) row[names[uid]] = `${r.raw}${r.sab.length ? '(' + r.sab.join('+') + ')' : ''} v${r.votes}`;
      summary.push(row);
      if (process.env.DUMP) {
        const dump = await host.evaluate((r) => {
          const g = window.__qd.game;
          const out = {};
          for (const [k, v] of g.takes) if (k.startsWith(r + ':')) out[k] = Array.from(v);
          return out;
        }, s.round);
        const fs = await import('node:fs');
        for (const [k, arr] of Object.entries(dump)) fs.writeFileSync(`${out}/take-${k.replace(':', '-')}.ulaw`, Buffer.from(arr));
        fs.writeFileSync(`${out}/round-${s.round}.json`, JSON.stringify({ sound: s.sound, players: s.players, t: s.t }));
      }
      log('results', JSON.stringify(row));
      if (s.round === 1) {
        const play = await host.evaluate(() => window.__qd.game.st.play);
        const first = play[0];
        await host.waitForTimeout(Math.max(0, first.at + first.walk + 500 - s.now));
        await shot(host, 'playback-sing');
      }
    }
    if (s.phase === 'wheel') {
      await host.waitForTimeout(400);
      if (s.round === 1) await shot(host, 'wheel');
      for (const p of pages) await p.evaluate(() => document.querySelector('.spin-btn')?.click());
      await host.waitForTimeout(4800);
      if (s.round === 1) await shot(host, 'wheel-result');
      for (const p of pages) {
        const hit = await p.$('.phit.on');
        if (hit) {
          if (seen.has('shot-target') === false) {
            seen.add('shot-target');
            await shot(p, 'target');
          }
          await hit.evaluate((e) => e.click());
        }
      }
    }
    if (s.phase === 'final') break;
    if (s.round > ROUNDS_TO_CHECK) break;
  }
  await host.waitForTimeout(100);
}
// رجوع للقائمة ثم غرفة جديدة: لازم ما يبقى أثر من اللعبة السابقة
await host.waitForTimeout(1500);
await host.evaluate(() => document.querySelector('.final-btns .btn.ghost')?.click());
await host.waitForTimeout(1500);
const menuOk = await host.evaluate(() => document.documentElement.dataset.screen === 'menu' && !!document.querySelector('.menu-btns'));
await host.evaluate(() => document.querySelector('.menu-btns .btn.pink')?.click());
await host.waitForSelector('.room-code b', { timeout: 15000 });
await host.waitForTimeout(1500);
const clean = await host.evaluate(() => ({
  labels: document.querySelectorAll('.plabel').length,
  hits: document.querySelectorAll('.phit').length,
  chars: window.__qd.stage.chars.size,
  cards: document.querySelectorAll('.pcard').length,
  listeners: window.__qd.stage.listeners.length,
}));
console.log('menu after final:', menuOk, 'new room state:', JSON.stringify(clean));
await shot(host, 'new-room');
console.table(summary);
console.log('errors:', errors.length ? errors.join('\n') : '(none)');
await browser.close();
