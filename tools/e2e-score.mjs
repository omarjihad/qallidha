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
  const file = /^\d\d-/.test(name) ? `${out}/${name}` : `${out}/${String(shotN).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: file + '-raw.png' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file + '-raw.png', '-vf', 'transpose=2,scale=844:-1', file + '.png']);
}

const pages = [];
for (let i = 0; i < 3; i++) pages.push(await newPlayer(i));
const [host, ...guests] = pages;
await host.goto(BASE + '/');
await host.waitForTimeout(1500);
await shot(host, 'menu');

// كود غرفة غير موجود: لازم يطلع «ماكو غرفة» وما تنخلق غرفة
await host.evaluate(() => [...document.querySelectorAll('.menu-btns .btn')].find((b) => b.textContent.includes('بكود'))?.click());
await host.waitForSelector('.kp-key');
for (const d of '99999') await host.evaluate((k) => [...document.querySelectorAll('.kp-key')].find((b) => b.textContent === k)?.click(), d);
await host.waitForSelector('.kp-hint.err', { timeout: 8000 });
const kpMsg = await host.$eval('.kp-hint', (e) => e.textContent);
const stillMenu = await host.evaluate(() => document.documentElement.dataset.screen !== 'room');
console.log('join unknown code →', JSON.stringify(kpMsg), stillMenu ? '(stayed on menu ✅)' : '(entered a room ❌)');
if (!/ماكو غرفة/.test(kpMsg) || !stillMenu) errors.push('unknown room code was not rejected');
await shot(host, 'join-notfound');
await host.evaluate(() => document.querySelector('.keypad .xbtn')?.click());
await host.waitForTimeout(500);

await tap(host, '.menu-btns .btn.friends');
await host.waitForSelector('.room-code b');
const code = await host.$eval('.room-code b', (e) => e.textContent);
for (const g of guests) await g.goto(BASE + '/?room=' + code);
await host.waitForTimeout(2500);
for (const p of pages) await p.evaluate(() => document.querySelector('#lobbyBar .btn.orange')?.click());
await host.waitForTimeout(1200);
await shot(host, 'lobby');
await tap(host, '#lobbyBar .btn.pink');
const audible = [];
const later = [];

const seen = new Set();
const s_final_needed = () => !seen.has('final-reached');
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
        // كل لقطة من صفحة مختلفة بالتوازي حتى ما يتأخر التوقيت (الرسم بالمحاكاة بطيء)
        const at = async (page, ts, name) => {
          const s2 = await state(page);
          await page.waitForTimeout(Math.max(0, ts - s2.now));
          await shot(page, name);
        };
        later.push(at(pages[2], s.t.listenAt - 350, '20-letters'));
        later.push(at(pages[1], s.t.listenAt + Math.min(600, s.t.dur * 500), '21-listen'));
        later.push(at(pages[2], s.t.countAt + 2 * 750 + 250, '22-count1'));
        later.push(at(pages[0], s.t.recAt + 700, '23-record'));
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
      const play = await host.evaluate(() => window.__qd.game.st.play);
      const first = play.find((x) => !x.none) || play[0];
      if (s.round === 1) {
        const at = async (page, ts, name) => {
          const s2 = await state(page);
          await page.waitForTimeout(Math.max(0, ts - s2.now));
          await shot(page, name);
        };
        later.push(at(pages[1], first.at + 400, '30-walk'));
        later.push(at(pages[2], first.at + first.walk + Math.min(first.dur, 1500) * 0.5, '31-sing'));
        later.push(at(pages[1], first.at + first.walk + first.dur + 650, '32-score'));
      }
      {
        const s3 = await state(host);
        await host.waitForTimeout(Math.max(0, first.at + first.walk + first.dur + 200 - s3.now));
        const lp = await host.evaluate(() => {
          const g = window.__qd.game;
          return g.lastPlayback ? { uid: g.lastPlayback.uid, max: g.lastPlayback.max } : null;
        });
        audible.push({ round: s.round, ...lp });
        log('playback level', JSON.stringify(lp));
      }
    }
    if (s.phase === 'wheel') {
      await host.waitForTimeout(700);
      if (s.round === 1) await shot(host, 'wheel');
      for (const p of pages) await p.evaluate(() => document.querySelector('.wheel-holder.tappable')?.click());
      await host.waitForTimeout(1500);
      if (s.round === 1) await shot(host, 'wheel-spin');
      await host.waitForTimeout(3300);
      if (s.round === 1) await shot(host, 'wheel-result');
      await host.waitForTimeout(1500);
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
    if (s.round === 1 && (s.phase === 'intro' || s.phase === 'analyze')) {
      await host.waitForTimeout(500);
      await shot(host, s.phase);
    }
    if (s.phase === 'final') {
      seen.add('final-reached');
      await host.waitForTimeout(1500);
      await shot(host, 'final');
      break;
    }
    if (s.round > ROUNDS_TO_CHECK) break;
  }
  await host.waitForTimeout(100);
}
await Promise.all(later);
if (s_final_needed()) {
  // (CHECK أقل من 4: ما وصلنا للنهاية)
  console.log('stopped early at round', ROUNDS_TO_CHECK);
  console.table(summary);
  console.log('playback audible:', JSON.stringify(audible));
  console.log('errors:', errors.length ? errors.join('\n') : '(none)');
  await browser.close();
  process.exit(0);
}
// رجوع للقائمة ثم غرفة جديدة: لازم ما يبقى أثر من اللعبة السابقة
await host.waitForTimeout(1500);
await host.evaluate(() => document.querySelector('.final-btns .btn.ghost')?.click());
await host.waitForTimeout(1500);
const menuOk = await host.evaluate(() => document.documentElement.dataset.screen === 'menu' && !!document.querySelector('.menu-btns'));
await host.evaluate(() => document.querySelector('.menu-btns .btn.friends')?.click());
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
console.log('playback audible:', JSON.stringify(audible));
const silentPlays = audible.filter((a) => !(a.max > 0.05));
if (silentPlays.length) errors.push('silent playback: ' + JSON.stringify(silentPlays));
console.log('errors:', errors.length ? errors.join('\n') : '(none)');
await browser.close();
