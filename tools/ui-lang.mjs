// لقطات الواجهة بلغة ثانية: لاعب تيليجرام لغته ru أو en (بدون اختيار) → اللعبة تفتح بلغته لوحدها.
// القائمة، المتجر، الباس، الإعدادات، المساعدة، المتصدرين، الكود، الغرفة، وجولة وحدة لحد العجلة.
//   UI_LANG=en node tools/ui-lang.mjs <out-dir>     (UI_LANG=ru هو الافتراضي)
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const TOKEN = process.env.TOKEN || '123456:TEST-token_abcdefghijklmnop';
const LANG = /^(ru|en)$/.test(process.env.UI_LANG || '') ? process.env.UI_LANG : 'ru';
const out = process.argv[2] || `/tmp/ui-${LANG}`;
mkdirSync(out, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
let ok = 0;
let bad = 0;
const check = (cond, label) => {
  if (cond) ok++;
  else bad++;
  log(cond ? '✅' : '❌', label);
};
// نصوص متوقعة بكل لغة
const X = {
  ru: { name: 'Иван', tz: 'Europe/Moscow', random: /Случайная/, wheel: /очк|×|Обмен|Помех|Эхо|Пук|Белка|Нарезка/ },
  en: { name: 'Sam', tz: 'Europe/London', random: /Random/, wheel: /points|×|Swap|Echo|Static|Fart|Squirrel|Chop/ },
}[LANG];

function sign(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAlang', user: JSON.stringify(user) });
  const pairs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(pairs).digest('hex'));
  return p.toString();
}
const user = { id: 780000 + Math.floor(Math.random() * 9000), first_name: X.name, language_code: LANG };
const initData = sign(user);

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, timezoneId: X.tz, locale: LANG });
await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await ctx.addInitScript(
  ({ initData, user }) => {
    const noop = () => {};
    window.Telegram = {
      WebApp: {
        initData,
        initDataUnsafe: { user },
        platform: 'android',
        version: '8.0',
        isVersionAtLeast: () => true,
        ready: noop,
        expand: noop,
        onEvent: noop,
        offEvent: noop,
        enableClosingConfirmation: noop,
        disableClosingConfirmation: noop,
        HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
        BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
        isFullscreen: true,
        safeAreaInset: { top: 32, bottom: 16, left: 0, right: 0 },
        contentSafeAreaInset: { top: 56, bottom: 0, left: 0, right: 0 },
      },
    };
    document.addEventListener('DOMContentLoaded', () => {
      const bar = document.createElement('div');
      bar.innerHTML = '<span>✕ Close</span><span>⌄ ⋮</span>';
      bar.style.cssText = 'position:fixed;left:0;right:0;top:32px;height:56px;display:flex;justify-content:space-between;align-items:center;padding:0 10px;z-index:99999;pointer-events:none;font:600 15px sans-serif;color:#fff;direction:ltr';
      for (const sp of bar.children) sp.style.cssText = 'background:rgba(40,40,40,.85);border-radius:20px;padding:8px 14px';
      document.documentElement.appendChild(bar);
    });
  },
  { initData, user },
);
const page = await ctx.newPage();
const warns = [];
page.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && warns.push(m.text()));
page.on('pageerror', (e) => warns.push('[pageerror] ' + e.message));

let n = 0;
async function shot(name) {
  n++;
  const f = `${out}/${String(n).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: f + '-raw.png' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f + '-raw.png', '-vf', 'transpose=2,scale=1100:-1', f + '.png']);
  log('📸', name);
}
async function tap(sel, i = 0) {
  await page.waitForSelector(sel, { timeout: 15000 });
  const el = (await page.$$(sel))[i];
  await el
    .evaluate((e) => Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.contains && a.effect.target.contains(e) && a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null))))
    .catch(() => null);
  const b = await el.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}
async function clearOfHeader(sel, label) {
  // مدوّرة: يسار المحتوى = فوق الجهاز (هيدر تيليجرام)، ويمينه = جوّه الجهاز
  const boxes = await page.$$eval(sel, (els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ y: r.top, b: r.bottom, w: r.width, H: innerHeight })));
  const under = boxes.filter((b) => b.w > 0 && b.y < 87.5);
  const cut = boxes.filter((b) => b.w > 0 && b.b > b.H - 15.5);
  check(boxes.length > 0 && under.length === 0 && cut.length === 0, `${label}: بعيد عن أزرار تيليجرام وما مكصوص (${boxes.length}، تحت الهيدر ${under.length}، مكصوص ${cut.length})`);
}

await page.goto(BASE + '/');
await page.waitForTimeout(3000);
const head = await page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang, play: document.querySelector('.menu-btns .btn.pink').textContent }));
check(head.dir === 'ltr' && head.lang === LANG && X.random.test(head.play), `تلقائي من لغة تيليجرام: ${JSON.stringify(head)}`);
await clearOfHeader('.menu-side .side-btn, .menu-btns button, .menu-top button, .profile-chip', 'أزرار القائمة');
// اللعبة مدوّرة: سطر المحتوى = نفس x بالجهاز، فنقارن مراكز الأزرار
const rows = await page.$$eval('.menu-btns button', (bs) => new Set(bs.map((b) => { const r = b.getBoundingClientRect(); return Math.round((r.left + r.width / 2) / 6); })).size);
check(rows === 1, `أزرار القائمة الأربعة بسطر واحد (${rows})`);
await shot('menu');

await tap('.menu-side .side-btn', 0);
await page.waitForSelector('.panel.shop');
await page.waitForTimeout(700);
await shot('shop-skins');
await tap('.tabs .tab', 1);
await page.waitForTimeout(600);
await shot('shop-head');
await tap('.tabs .tab', 4);
await page.waitForTimeout(600);
await shot('shop-mics');
await tap('.panel.shop .xbtn');
await page.waitForTimeout(800);

await tap('.menu-side .side-btn.pass');
await page.waitForSelector('.panel.pass');
await page.waitForTimeout(800);
await shot('pass');
await tap('.panel.pass .xbtn');
await page.waitForTimeout(800);

await tap('.menu-top .gear');
await page.waitForSelector('.panel.settings');
await page.waitForTimeout(600);
const langs = await page.$$eval('.set-row:first-child .seg-btn', (bs) => bs.map((b) => b.textContent));
check(langs.join(',') === 'العربية,English,Русский', `الإعدادات: ثلاث لغات (${langs.join(',')})`);
await shot('settings');
await page.$eval('.set-body', (e) => (e.scrollTop = e.scrollHeight));
await page.waitForTimeout(300);
await shot('settings-bottom');
await tap('.panel.settings .xbtn');
await page.waitForTimeout(600);

await tap('.menu-top .help');
await page.waitForTimeout(800);
await shot('help');
await tap('.panel.help .xbtn');
await page.waitForTimeout(700);
await tap('.menu-top .top');
await page.waitForTimeout(1500);
await shot('top');
await tap('.panel.board .xbtn');
await page.waitForTimeout(700);

// جولة وحدة (غرفة ويا الربع، المضيف يبدي)
await tap('.menu-btns .btn.friends');
await page.waitForSelector('#lobbyBar .room-code b', { timeout: 15000 });
await page.waitForTimeout(2000);
await clearOfHeader('#exitBtn, #setBtn, #lobbyBar button, #lobbyBar .room-code', 'أزرار الغرفة');
await shot('lobby');
const mic = await page.$('#lobbyBar .btn.orange');
if (mic) await tap('#lobbyBar .btn.orange');
await page.waitForTimeout(700);
await tap('#lobbyBar .btn.pink');
const seen = new Set();
const t0 = Date.now();
while (Date.now() - t0 < 150000) {
  const s = await page.evaluate(() => (window.__qd.game && window.__qd.game.st ? { phase: window.__qd.game.st.phase, round: window.__qd.game.st.round, t: window.__qd.game.st.t, now: window.__qd.game.serverNow() } : null));
  if (s) {
    const k = s.round + ':' + s.phase;
    if (!seen.has(k)) {
      seen.add(k);
      log('phase', k);
      if (k === '1:intro') {
        await page.waitForTimeout(500);
        await shot('round-intro');
      }
      if (k === '1:perform') {
        await page.waitForTimeout(Math.max(0, s.t.reproduceAt - s.now + 700));
        await shot('try-repeat');
      }
      if (k === '1:playback') {
        await page.waitForTimeout(3500);
        await shot('playback');
      }
      if (k === '1:wheel') {
        await page.waitForSelector('.wheel-result', { timeout: 12000 }).catch(() => null);
        // نقرا النص قبل اللقطة: بالسولو المرحلة تخلص بسرعة بعد ما توكف
        const res = await page.$eval('.wheel-result', (e) => e.textContent).catch(() => '');
        await page.waitForTimeout(400);
        await shot('wheel');
        check(X.wheel.test(res), `نتيجة العجلة مترجمة: «${res}»`);
        break;
      }
    }
  }
  await page.waitForTimeout(250);
}
const missing = warns.filter((w) => /(ru|en) missing/.test(w));
check(missing.length === 0, `ماكو نص ناقص الترجمة (${missing.length})${missing.length ? ': ' + missing.slice(0, 6).join(' | ') : ''}`);
const errs = warns.filter((w) => /pageerror/.test(w));
check(errs.length === 0, `ماكو أخطاء بالصفحة ${errs.join(' | ')}`);
console.log(`\n${ok} ✅  ${bad} ❌`);
await browser.close();
process.exit(bad ? 1 : 0);
