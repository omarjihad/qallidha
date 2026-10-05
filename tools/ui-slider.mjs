// شرائط الصوت بالإعدادات واللعبة مدوّرة: سحب بالإصبع حقيقي (أحداث لمس من Chrome) لازم يحرّك الشريط بسلاسة،
// وما يصير تمرير للوحة، وزر + و − يمشون 10.
//   node tools/ui-slider.mjs <out-dir>
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const out = process.argv[2] || '/tmp/ui-slider';
mkdirSync(out, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
let ok = 0;
let bad = 0;
const check = (cond, label) => {
  if (cond) ok++;
  else bad++;
  log(cond ? '✅' : '❌', label);
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE + '/');
await page.waitForTimeout(2500);
check(await page.evaluate(() => document.documentElement.dataset.rotated === '1'), 'اللعبة مدوّرة (شاشة طولية)');

const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }] });
const val = (key) => page.$eval(`.vslider[data-key="${key}"]`, (e) => Number(e.getAttribute('aria-valuenow')));
const saved = (key) => page.evaluate((k) => JSON.parse(localStorage.getItem('qd_settings') || '{}')[k], key);
const shot = async (name) => {
  const f = `${out}/${name}`;
  await page.screenshot({ path: f + '-raw.png' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f + '-raw.png', '-vf', 'transpose=2,scale=1100:-1', f + '.png']);
  log('📸', name);
};

// يفتح الإعدادات من زر ⚙️
const gear = await page.$('.menu-top .gear');
const gb = await gear.boundingBox();
await page.touchscreen.tap(gb.x + gb.width / 2, gb.y + gb.height / 2);
await page.waitForSelector('.panel.settings .vslider');
await page.waitForTimeout(700);

for (const key of ['volume', 'sfx']) {
  const track = await page.$(`.vslider[data-key="${key}"] .vs-track`);
  const r = await track.boundingBox(); // بالجهاز: الشريط عمودي (المحتوى مدوّر 90°)
  const scrollBefore = await page.$eval('.set-body', (e) => e.scrollTop);
  // يسار الشريط بالمحتوى = فوك بالجهاز. نسحب من 80% إلى 20% على طوله بخطوات صغيرة مثل الإصبع
  const x = r.x + r.width / 2;
  const at = (f) => r.y + r.height * f;
  await touch('touchStart', x, at(0.8));
  const mid = [];
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', x + (i % 2 ? 1.5 : -1.5), at(0.8 - (0.6 * i) / 12));
    if (i === 6) mid.push(await val(key));
  }
  await touch('touchEnd', 0, 0);
  await page.waitForTimeout(200);
  const v = await val(key);
  const scrollAfter = await page.$eval('.set-body', (e) => e.scrollTop);
  check(Math.abs(v - 20) <= 3, `${key}: السحب يحرّك الشريط لحد الإصبع (${v}%، بالنص ${mid[0]}%)`);
  check(mid[0] > 35 && mid[0] < 65, `${key}: يمشي ويا الإصبع وقت السحب مو بس بالآخر (${mid[0]}%)`);
  check(Math.abs((await saved(key)) - v / 100) < 0.001, `${key}: انحفظ بالإعدادات (${await saved(key)})`);
  check(scrollAfter === scrollBefore, `${key}: اللوحة ما تمرّرت وقت السحب`);
  // سحب للآخر = 100
  await touch('touchStart', x, at(0.5));
  for (let i = 1; i <= 8; i++) await touch('touchMove', x, at(0.5 + (0.6 * i) / 8));
  await touch('touchEnd', 0, 0);
  await page.waitForTimeout(150);
  check((await val(key)) === 100, `${key}: يوصل 100% (${await val(key)})`);
  // ضغطة وحدة على مكان بالشريط
  await page.touchscreen.tap(x, at(0.3));
  await page.waitForTimeout(150);
  const tv = await val(key);
  check(Math.abs(tv - 30) <= 3, `${key}: ضغطة على الشريط تروح لمكانها (${tv}%)`);
}

// زر + و −
const plus = (await page.$$('.slider-box'))[0];
const btns = await plus.$$('.step-btn');
const before = await val('volume');
const pb = await btns[1].boundingBox();
await page.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2);
await page.waitForTimeout(150);
check((await val('volume')) === Math.min(100, before + 10), `زر + يزيد 10 (${before}→${await val('volume')})`);
const mb = await btns[0].boundingBox();
await page.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height / 2);
await page.waitForTimeout(150);
check((await val('volume')) === before, `زر − ينقص 10 (${await val('volume')})`);
await shot('settings-sliders');
check(errors.length === 0, `ماكو أخطاء ${errors.join(' | ')}`);
console.log(`\n${ok} ✅  ${bad} ❌`);
await browser.close();
process.exit(bad ? 1 : 0);
