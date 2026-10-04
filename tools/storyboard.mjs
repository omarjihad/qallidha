// لقطات ثابتة للكاميرا (بدون لعبة): واسعة، قريبة، متوسطة — للمقارنة مع الأصلية.
// node tools/storyboard.mjs <out-dir>
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const out = process.argv[2] || '/tmp/sb';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(BASE + '/');
await page.waitForTimeout(2500);
const shot = async (name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}-raw.png` });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', `${out}/${name}-raw.png`, '-vf', 'transpose=2', `${out}/${name}.png`]);
};
await page.evaluate(() => {
  document.querySelector('#overlay').className = '';
  document.documentElement.dataset.screen = 'room';
  const st = window.__qd.stage;
  st.setPlayers([
    { uid: 'a', skin: 1 },
    { uid: 'b', skin: 4 },
    { uid: 'c', skin: 3 },
  ]);
});
await page.waitForTimeout(800);
const set = (kind, uid, focus) =>
  page.evaluate(
    ([kind, uid, focus]) => {
      const st = window.__qd.stage;
      for (const id of ['a', 'b', 'c']) st.unfocus(id);
      if (focus) st.focus(focus);
      for (const c of st.chars.values()) {
        c.pos.copy(c.atMic ? c.target : c.home);
        c.walking = false;
      }
      st.setShot(kind, uid, true);
    },
    [kind, uid, focus],
  );
await set('wide', null, 'b');
await shot('wide-mic');
await set('wide', null, null);
await shot('wide');
await set('closeup', 'a', null);
await shot('closeup');
await set('medium', null, null);
await shot('medium');
await set('menu', null, null);
await shot('menu');

// مشاهد الواجهة فوق اللقطات (بدون سيرفر): العد على الشريط، «حاول تقلّدها»، والدرجة
await page.evaluate(async () => {
  const ui = await import('/js/ui.js');
  const peaks = new Float32Array(200).map((_, i) => 0.55 + 0.35 * Math.sin(i / 9) * Math.sin(i / 23));
  const wb = new ui.WaveBar(document.querySelector('#wavebar'));
  wb.setRef(peaks, 2.2, 3.1, 0.25);
  window.__wb = wb;
  window.__ui = ui;
  const loop = () => {
    wb.draw();
    requestAnimationFrame(loop);
  };
  loop();
});
await set('closeup', 'a', null);
await page.evaluate(() => {
  document.documentElement.dataset.phase = 'perform';
  const wb = window.__wb;
  wb.mode = 'count';
  wb.time = 0;
  wb.show(true);
  document.querySelector('#caption').textContent = 'الكل سوا — فرصة وحدة بس!';
  const b = document.querySelector('#countBadge');
  b.textContent = '1';
  b.classList.add('pop');
});
await shot('ui-count1');
await page.evaluate(() => {
  const wb = window.__wb;
  wb.mode = 'record';
  wb.time = 1.4;
  wb.fillTo = 1.4;
  document.querySelector('#caption').textContent = '';
  document.querySelector('#countBadge').textContent = '';
  document.querySelector('#goText').classList.add('show');
});
await shot('ui-record');
await page.evaluate(() => {
  document.querySelector('#goText').classList.remove('show');
  document.querySelector('#dim').className = 'show full';
  window.__ui.reproduceBanner(0);
  const wb = window.__wb;
  wb.mode = 'listen';
  wb.time = 1.1;
  wb.fillTo = -1;
  document.querySelector('#caption').textContent = '🦆 بطة';
});
await page.waitForTimeout(1800);
await shot('ui-listen');
await set('wide', null, 'b');
await page.evaluate(() => {
  document.documentElement.dataset.phase = 'playback';
  document.querySelector('#dim').className = '';
  window.__ui.clearCenter();
  window.__wb.show(false);
  document.querySelector('#caption').textContent = '';
  window.__ui.renderCards(
    [
      { uid: 'a', name: 'Djedjeska', skin: 1, score: 57 },
      { uid: 'b', name: 'بنجز', skin: 4, score: 60 },
      { uid: 'c', name: 'BLUEBERRIES78', skin: 3, score: 12 },
    ],
    { me: 'b', host: 'a' },
  );
  window.__ui.scoreBanner(13, 1);
});
await page.waitForTimeout(900);
await shot('ui-score');
await browser.close();
