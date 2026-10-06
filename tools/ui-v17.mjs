// لقطات وفحص ميزات 1.7 بالمتصفح: لوحة المطوّر داخل اللعبة (للأدمن بس، طولية برا اللعبة المدوّرة والكتابة تشتغل)،
// كارت مسابقة المتصدرين بالقائمة (عدّاد حي)، المتصدرين (تبويب المسابقة والعام)، ونوافذ الهدية والفوز.
//   npx wrangler dev --var BC_GAP_MS:300 + node tools/mock-tg.mjs ثم: node tools/ui-v17.mjs <out-dir>
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const TOKEN = process.env.TOKEN || '123456:TEST-token_abcdefghijklmnop';
const out = process.argv[2] || '/tmp/ui-v17';
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

function sign(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAv17', user: JSON.stringify(user) });
  const pairs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(pairs).digest('hex'));
  return p.toString();
}
const post = (path, user, body = {}) => fetch(BASE + path, { method: 'POST', body: JSON.stringify({ initData: sign(user), ...body }) }).then((r) => r.json());
let upd = 90000 + Math.floor(Math.random() * 9000);
const hook = (obj) =>
  fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ update_id: ++upd, ...obj }),
  });
const say = (u, text) => hook({ message: { message_id: ++upd, date: Math.floor(Date.now() / 1000), from: u, chat: { id: u.id, type: 'private' }, text } });

const admin = { id: 42, first_name: 'Omar', is_bot: false, language_code: 'ar' };
const A = (op, args = {}) => post('/api/admin', admin, { op, ...args });
const R = 100000 + Math.floor(Math.random() * 800000);
const player = { id: R * 10 + 1, first_name: 'حسن', last_name: 'V17', language_code: 'ar', username: 'hasan_v17' };
const P = R * 10 + 5; // بوتات المحاكي

function sim(n, base) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['tools/sim.mjs', String(n)], { env: { ...process.env, BASE, SIM_TG_TOKEN: TOKEN, SIM_TG_ID: String(base) }, stdio: 'ignore' });
    const kill = setTimeout(() => p.kill('SIGKILL'), 240000);
    p.on('close', (code) => {
      clearTimeout(kill);
      resolve(code);
    });
  });
}

// ---------------- تجهيز: مسابقة شغّالة بيها لاعبين، ولاعب وصلته هدايا
await say(admin, '/start');
await say(player, '/start');
await post('/api/me', player);
let st = await A('contest');
if (!st.contest || st.contest.status !== 'running') await A('contest.publish', { silent: true, days: 7, prizes: [150, 75, 50] });
log('⏳ لعبة بالمحاكي (لاعبين تيليجرام اثنين) حتى يصير بالمتصدرين ناس…');
await sim(2, P);
await A('gift', { uid: player.id, kind: 'items', items: ['skin:10', 'head:crown', 'stage:neon', 'face:mustache'] });
await A('gift', { uid: player.id, kind: 'level', to: 12 });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const failed = [];

async function open(user, path = '/') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, timezoneId: 'Asia/Baghdad' });
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await ctx.addInitScript(
    ({ initData, user }) => {
      const noop = () => {};
      window.__back = null;
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
          BackButton: { show: noop, hide: noop, onClick: (h) => (window.__back = h), offClick: () => (window.__back = null) },
          openTelegramLink: (u) => console.log('[tg] link ' + u),
          isFullscreen: true,
          safeAreaInset: { top: 32, bottom: 16, left: 0, right: 0 },
          contentSafeAreaInset: { top: 56, bottom: 0, left: 0, right: 0 },
          viewportStableHeight: 0,
          CloudStorage: { setItem: (k, v, cb) => cb && cb(null, true), getItem: (k, cb) => cb && cb(null, '') },
        },
      };
    },
    { initData: sign(user), user },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${new URL(r.url()).pathname}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(BASE + path);
  return page;
}

let n = 0;
async function shot(page, name, rotated = true) {
  n++;
  const f = `${out}/${String(n).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: rotated ? f + '-raw.png' : f + '.png' });
  // اللعبة مدوّرة بالشاشة الطولية: نعدّل اللقطة حتى تنقرا. لوحة المطوّر طولية أصلًا
  if (rotated) execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f + '-raw.png', '-vf', 'transpose=2,scale=1100:-1', f + '.png']);
  log('📸', name);
}
/** نستنى حركات الدخول (popIn…) تخلص حتى اللمسة توكع بمكانها الحقيقي */
const settle = (page) =>
  page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity), null, { timeout: 5000 })
    .catch(() => null);
const tap = async (page, sel) => {
  const e = await page.waitForSelector(sel, { timeout: 15000 });
  await settle(page);
  const b = await e.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
};
const text = (page, sel) => page.$eval(sel, (e) => e.textContent).catch(() => '');

/* ================= 1) اللاعب: نوافذ الهدايا ← كارت المسابقة ← المتصدرين */
let page = await open(player);
await page.waitForSelector('.ib-layer', { timeout: 15000 }).catch(() => null);
await page.waitForTimeout(900);
check(/وصلتك هدية من المطوّر/.test(await text(page, '.ib-layer')), 'نافذة «🎁 وصلتك هدية» تطلع من يفتح اللعبة');
check((await page.$$('.ib-item')).length === 4, 'الهدية الأولى: 4 أغراض بمعايناتها');
await shot(page, 'gift-items');
await tap(page, '.ib-ok');
await page.waitForTimeout(700);
check(/12/.test(await text(page, '.ib-layer .rw.up b')), 'الهدية الثانية: اللفل ← 12');
await shot(page, 'gift-level');
await tap(page, '.ib-ok');
await page.waitForTimeout(700);
check(!(await page.$('.ib-layer')), 'خلصت النوافذ');
const again = await post('/api/me', player, { inbox: true });
check(again.inbox.length === 0, 'ما ترجع تطلع (انشافت)');

check(!!(await page.$('.menu-contest')), 'كارت المسابقة بالقائمة');
const c1 = await text(page, '.menu-contest .mc-left');
await page.waitForTimeout(1300);
const c2 = await text(page, '.menu-contest .mc-left');
check(/\d{2}:\d{2}:\d{2}/.test(c1) && c1 !== c2, `العدّاد يمشي (${c1} ← ${c2})`);
check(/150/.test(await text(page, '.menu-contest .mc-prizes')), 'الجوائز بالكارت');
check(!(await page.$('.top-btn.dev')), 'زر 🛠️ ما يبين للاعب');
await shot(page, 'menu-contest');

await tap(page, '.menu-contest');
await page.waitForSelector('.ct-wrap', { timeout: 10000 });
await page.waitForTimeout(800);
check((await page.$$('.board-tabs .tab')).length === 2, 'المتصدرين: تبويبين (المسابقة + العام)');
check((await page.$$('.ct-wrap .lb-row')).length >= 2 && (await page.$$('.ct-wrap .lb-prize')).length >= 2, 'ترتيب المسابقة وجوائز الأوائل');
check(/\d+:\d{2}:\d{2}/.test(await text(page, '.ct-clock .cclock')), 'الوقت المتبقي');
check(/بعدك ما دخلت/.test(await text(page, '.ct-me')), 'ترتيبي: «بعدك ما دخلت»');
await shot(page, 'board-contest');
await tap(page, '.board-tabs .tab:not(.on)');
await page.waitForTimeout(600);
check(!!(await page.$('.board-body > .lb-list')) && !(await page.$('.ct-wrap')), 'تبويب الترتيب العام');
await shot(page, 'board-all');
await tap(page, '.panel.board .xbtn');
await page.waitForTimeout(600);
check(!!(await page.$('.menu')), 'رجوع للقائمة');
await page.context().close();

/* ================= 2) الأدمن: اللوحة باللعبة */
page = await open(admin, '/?admin=1');
await page.waitForSelector('.adm .astat', { timeout: 15000 });
await page.waitForTimeout(1200);
const box = await page.$eval('.adm', (e) => {
  const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, rotated: document.documentElement.dataset.rotated || '' };
});
check(box.x === 0 && box.y === 0 && box.w === 390 && box.h === 844 && box.rotated === '1', `اللوحة طولية وتغطي الشاشة (اللعبة وراها مدوّرة)`);
check((await page.$$('.adm-tabs .atab')).length === 9 && (await page.$$('.adm .astat')).length === 8, '9 تبويبات و8 إحصائيات');
const padTop = await page.$eval('.adm-head', (e) => parseFloat(getComputedStyle(e).paddingTop));
check(padTop >= 88, `الرأس تحت أزرار تيليجرام (${padTop}px)`);
await shot(page, 'adm-dash', false);

await tap(page, '.adm-tabs .atab:nth-child(2)');
await page.waitForSelector('.acountdown', { timeout: 10000 });
await page.waitForTimeout(600);
const l1 = await text(page, '.acountdown .aleft');
await page.waitForTimeout(1200);
const l2 = await text(page, '.acountdown .aleft');
check(/\d{2}:\d{2}:\d{2}/.test(l1) && l1 !== l2, `عدّاد المسابقة (${l1})`);
check((await page.$$('.adm .alist .arow')).length >= 2, 'الترتيب هسه');
await shot(page, 'adm-contest', false);
// نشر وهي شغّالة = تذكير: المعاينة بالتأكيد
await tap(page, '.abtn.gold.big');
await page.waitForSelector('.adm-modal .apreview', { timeout: 10000 });
await page.waitForTimeout(400);
check(/مسابقة المتصدرين شغّالة/.test(await text(page, '.adm-modal .apreview')), 'تأكيد النشر: معاينة كليشة التذكير');
await shot(page, 'adm-publish-confirm', false);
await tap(page, '.adm-modal .abtn.pink');
await page.waitForTimeout(900);
check(/بدت الإذاعة/.test(await text(page, '.adm-toast')), 'انشرت: «📢 بدت الإذاعة»');
await shot(page, 'adm-published', false);

// اللاعبين: بحث بالكتابة ← كارت اللاعب ← هدية
await tap(page, '.adm-tabs .atab:nth-child(3)');
await page.waitForSelector('.adm input[type=search]');
await page.fill('.adm input[type=search]', '@hasan_v17');
await page.press('.adm input[type=search]', 'Enter');
await page.waitForTimeout(900);
check((await page.$$('.adm .alist .arow')).length >= 1, 'بحث بالكتابة (@يوزر)');
await tap(page, '.adm .alist button.arow');
await page.waitForSelector('.auser', { timeout: 10000 });
await page.waitForTimeout(800);
check(/حسن/.test(await text(page, '.auser-n')) && /12/.test(await text(page, '.agrid.mini')), 'كارت اللاعب (اللفل 12)');
await shot(page, 'adm-user', false);
await page.fill('.adm .adm-row .ainput.num', '777');
const micsBtn = await page.$$('.adm .abtn.gold');
await micsBtn[0].scrollIntoViewIfNeeded();
const bb = await micsBtn[0].boundingBox();
await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.waitForTimeout(900);
check(/وصلته 777 مايك/.test(await text(page, '.adm-toast')), 'هدية مايكات من اللوحة (رقم مكتوب)');
await page.waitForSelector('.aitems .aitem:not(.has)');
const tiles = await page.$$('.aitems .aitem:not(.has)');
for (const tl of tiles.slice(0, 3)) {
  await tl.scrollIntoViewIfNeeded();
  const b2 = await tl.boundingBox();
  await page.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2);
}
await page.waitForTimeout(300);
check((await text(page, '.acard-h .abadge b')) === '3', 'اختيار 3 أغراض');
await shot(page, 'adm-items', false);
await tap(page, '.adm-row.sticky .abtn');
await page.waitForTimeout(1000);
check(/وصلته 3 أغراض/.test(await text(page, '.adm-toast')), 'هدية الأغراض المختارة');

// الإذاعة: الكتابة تشتغل
await tap(page, '.adm-tabs .atab:nth-child(4)');
await page.waitForSelector('.adm textarea');
await page.fill('.adm textarea', 'هلا بالكل 👋 مسابقة جديدة!');
check((await page.$eval('.adm textarea', (e) => e.value)) === 'هلا بالكل 👋 مسابقة جديدة!', 'الكتابة بالإذاعة');
await shot(page, 'adm-bc', false);

// السكر: زر الرجوع مال تيليجرام يسكّرها، والقائمة بيها 🛠️
await page.evaluate(() => window.__back && window.__back());
await page.waitForTimeout(700);
check(!(await page.$('.adm')) && !(await page.evaluate(() => document.documentElement.classList.contains('adm-open'))), 'زر الرجوع يسكّر اللوحة');
check(!!(await page.$('.top-btn.dev')), 'القائمة: زر 🛠️ للأدمن');
await shot(page, 'admin-menu');
await tap(page, '.top-btn.dev');
await page.waitForSelector('.adm .astat', { timeout: 10000 });
check(true, 'زر 🛠️ يفتح اللوحة');
await page.context().close();

/* ================= 3) الفائز: نافذة «فزت!» والمتصدرين بعد ما خلصت */
const end = await A('contest.end');
const w1 = end.contest && end.contest.winners && end.contest.winners[0];
check(!!w1, 'إنهاء المسابقة');
page = await open({ id: Number(w1.uid.slice(1)), first_name: w1.name || 'بوت', language_code: 'ar' });
await page.waitForSelector('.ib-layer.ib-layer, .panel.ib', { timeout: 15000 }).catch(() => null);
await page.waitForTimeout(900);
check(/فزت بمسابقة المتصدرين/.test(await text(page, '.panel.ib')) && /150/.test(await text(page, '.ib-prize')), 'نافذة «🎉 فزت» بالجائزة');
await shot(page, 'win-popup');
await tap(page, '.ib-ok');
await page.waitForTimeout(600);
check(!(await page.$('.menu-contest')), 'خلصت: كارت القائمة اختفى');
await tap(page, '.top-btn.top');
await page.waitForSelector('.board-tabs .tab', { timeout: 10000 });
check(/آخر مسابقة/.test(await text(page, '.board-tabs .tab:first-child')) && !(await page.$('.ct-wrap')), 'ماكو مسابقة شغّالة: يفتح على العام، وتبويب «🏁 آخر مسابقة»');
await tap(page, '.board-tabs .tab:first-child');
await page.waitForSelector('.ct-wrap', { timeout: 10000 });
await page.waitForTimeout(700);
check(/خلصت المسابقة/.test(await text(page, '.ct-clock')) && /فزت بالمركز/.test(await text(page, '.ct-me')), 'المتصدرين: «خلصت» و«فزت بالمركز 1»');
await shot(page, 'board-ended');
await page.context().close();

// نرجّع مسابقة شغّالة (حتى اللقطات الجاية يبين الكارت)
await A('contest.publish', { silent: true, days: 7, prizes: [150, 75, 50] });

const badLoads = failed.filter((f) => !/\/tgfile\//.test(f));
check(errors.length === 0 && badLoads.length === 0, `ماكو أخطاء ${[...errors, ...badLoads].slice(0, 4).join(' | ')}`);
console.log(`\n${ok} ✅  ${bad} ❌`);
await browser.close();
process.exit(bad ? 1 : 0);
