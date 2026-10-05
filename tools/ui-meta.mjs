// اختبار واجهة الحساب كلاعب تيليجرام (initData موقّعة) بمتصفح حقيقي:
// القائمة، المتجر بكل أقسامه، الإعلانات (AdsGram وهمي)، اللبس، الرويال باس والدفع بالنجوم، لعبة كاملة ومكافآتها.
// التشغيل: npx wrangler dev + node tools/mock-tg.mjs ثم:  node tools/ui-meta.mjs <out-dir>
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const TOKEN = process.env.TOKEN || '123456:TEST-token_abcdefghijklmnop';
const out = process.argv[2] || '/tmp/ui-meta';
const UID = Number(process.env.UI_UID || 600000 + Math.floor(Math.random() * 90000));
const PLAY = process.env.PLAY !== '0';
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

function signInitData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAui', user: JSON.stringify(user) });
  const pairs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(pairs).digest('hex'));
  return p.toString();
}
const user = { id: UID, first_name: 'عمر', last_name: 'UI', language_code: 'ar' };
const initData = signInitData(user);
const api = async (path, body = {}) => {
  const r = await fetch(BASE + path, { method: 'POST', body: JSON.stringify({ initData, ...body }) });
  return { status: r.status, ...(await r.json()) };
};
let upd = 90000 + Math.floor(Math.random() * 9000);
async function update(obj) {
  const r = await fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ update_id: ++upd, ...obj }),
  });
  return r.status;
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const adsShown = [];
const toasts = [];

async function newPage(tgUser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  // AdsGram وهمي: كل إعلان يكمل بعد 300ms
  await ctx.route('https://sad.adsgram.ai/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.Adsgram={init:function(o){return{show:function(){console.log('[adsgram] '+o.blockId);return new Promise(function(res){setTimeout(function(){res({done:true,description:'Adsgram',state:'destroy',error:false})},300)})},addEventListener:function(){},destroy:function(){}}}};`,
    }),
  );
  // كل تنبيه يطلع ينكتب باللوك
  await ctx.addInitScript(() => {
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
  });
  if (tgUser) {
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
            openInvoice: (url, cb) => {
              console.log('[tg] invoice ' + url);
              window.__payInvoice(url).then((s) => cb && cb(s));
            },
            // ملء الشاشة مثل تيليجرام أندرويد: شريط الحالة 32 + أزرار تيليجرام 56 بأعلى الجهاز
            isFullscreen: true,
            safeAreaInset: { top: 32, bottom: 16, left: 0, right: 0 },
            contentSafeAreaInset: { top: 56, bottom: 0, left: 0, right: 0 },
            viewportStableHeight: 0,
            CloudStorage: {
              _m: JSON.parse(sessionStorage.getItem('__cloud') || '{}'),
              setItem(k, v, cb) {
                this._m[k] = v;
                sessionStorage.setItem('__cloud', JSON.stringify(this._m));
                cb && cb(null, true);
              },
              getItem(k, cb) {
                cb && cb(null, this._m[k] || '');
              },
            },
          },
        };
        // أزرار تيليجرام فوق (ما تدور ويا اللعبة) — حتى نشوف شنو يغطي
        document.addEventListener('DOMContentLoaded', () => {
          const bar = document.createElement('div');
          bar.id = '__tgbar';
          bar.innerHTML = '<span>✕ Close</span><span>⌄ ⋮</span>';
          bar.style.cssText = 'position:fixed;left:0;right:0;top:32px;height:56px;display:flex;justify-content:space-between;align-items:center;padding:0 10px;z-index:99999;pointer-events:none;font:600 15px sans-serif;color:#fff';
          for (const sp of bar.children) sp.style.cssText = 'background:rgba(40,40,40,.85);border-radius:20px;padding:8px 14px';
          document.documentElement.appendChild(bar);
        });
        // كم مرة طلبت اللعبة المايك (تيليجرام أندرويد يسأل عن الإذن كل مرة)
        window.__gum = 0;
        const md = navigator.mediaDevices;
        if (md && md.getUserMedia) {
          const orig = md.getUserMedia.bind(md);
          md.getUserMedia = (c) => {
            window.__gum++;
            return orig(c);
          };
        }
      },
      { initData, user: tgUser },
    );
  }
  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[adsgram] ')) adsShown.push(t.slice(10));
    if (t.startsWith('[toast] ')) {
      toasts.push(t.slice(8));
      log('   💬', t.slice(8));
    }
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
  return page;
}

let shotN = 0;
async function shot(page, name) {
  shotN++;
  const file = `${out}/${String(shotN).padStart(2, '0')}-${name}`;
  await page.screenshot({ path: file + '-raw.png' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file + '-raw.png', '-vf', 'transpose=2,scale=1100:-1', file + '.png']);
  log('📸', name);
}
const tap = async (page, selector, nth = 0) => {
  await page.waitForSelector(selector, { timeout: 15000 });
  const els = await page.$$(selector);
  const el = els[nth];
  if (!el) throw new Error('ماكو ' + selector + ' #' + nth);
  await el.scrollIntoViewIfNeeded().catch(() => null);
  // نستنى أنيميشن فتح اللوحة يخلص (وإلا مكان الزر يتغيّر وقت اللمسة)
  await el
    .evaluate((e) =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => {
            const t = a.effect && a.effect.target;
            return t && t.contains && t.contains(e) && a.effect.getComputedTiming().iterations !== Infinity;
          })
          .map((a) => a.finished.catch(() => null)),
      ),
    )
    .catch(() => null);
  const box = await el.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
};
const profile = (page) => page.evaluate(() => window.__qd.meta.profile);
const sawToast = (re, from = 0) => toasts.slice(from).some((t) => re.test(t));
const waitFor = async (page, fn, arg, ms = 8000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
// أعلى الجهاز: شريط الحالة 32 + أزرار تيليجرام 56 — ما لازم يكون فيها أي زر
const HEADER_Y = 88;
async function clearOfHeader(page, sel, label) {
  const boxes = await page.$$eval(sel, (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { y: r.top, b: r.bottom, w: r.width, h: r.height, H: innerHeight };
    }),
  );
  const under = boxes.filter((b) => b.w > 0 && b.y < HEADER_Y - 0.5);
  // الطرف الثاني (جوّه الجهاز): لا ينكص زر برا الشاشة
  const cut = boxes.filter((b) => b.w > 0 && b.b > b.H - 15.5);
  check(
    boxes.length > 0 && under.length === 0 && cut.length === 0,
    `${label}: بعيد عن أزرار تيليجرام (${boxes.length}${under.length ? ' — ' + under.length + ' تحتها، أعلى y=' + Math.round(Math.min(...under.map((b) => b.y))) : ''}${cut.length ? ' — ' + cut.length + ' مكصوص' : ''})`,
  );
}

/** يضغط زر داخل كارت غرض بالمتجر حسب اسمه */
async function cardBtn(page, itemName, cls) {
  const idx = await page.evaluate(
    ({ itemName, cls }) => {
      const cards = [...document.querySelectorAll('.it-card')];
      const card = cards.find((c) => c.querySelector('.it-name').textContent === itemName);
      if (!card) return -1;
      const all = [...document.querySelectorAll('.it-card .it-btn')];
      const b = card.querySelector('.it-btn.' + cls);
      return b ? all.indexOf(b) : -2;
    },
    { itemName, cls },
  );
  if (idx < 0) throw new Error(`ماكو زر ${cls} للغرض ${itemName} (${idx})`);
  await tap(page, '.it-card .it-btn', idx);
}

/* ====================================================== الضيف */
{
  const g = await newPage(null);
  await g.goto(BASE + '/');
  await g.waitForTimeout(2500);
  await shot(g, 'guest-menu');
  const chip = await g.$eval('.profile-chip', (e) => e.innerText);
  check(/ضيف/.test(chip), 'الضيف يشوف «افتح من تيليجرام حتى تجمع»');
  const t0 = toasts.length;
  await tap(g, '.menu-side .side-btn', 0);
  await g.waitForTimeout(500);
  check(sawToast(/تيليجرام/, t0) && !(await g.$('.panel.shop')), 'الضيف ما يفتح المتجر — يطلعله تنبيه');
  await g.context().close();
}

/* ====================================================== لاعب تيليجرام */
const page = await newPage(user);
const cfg = await (await fetch(BASE + '/api/config')).json();
await page.exposeFunction('__payInvoice', async (url) => {
  const payload = Buffer.from(url.split('$invoice_')[1] || '', 'hex').toString();
  log('💳 فاتورة', payload);
  const from = { id: UID, first_name: user.first_name };
  const sku = payload.startsWith('st:') ? payload.split(':')[2] : 'pass';
  const amount = sku === 'pass' ? cfg.passPrice : cfg.packs.find((p) => p.sku === sku).stars;
  await update({ pre_checkout_query: { id: 'pcq' + upd, from, currency: 'XTR', total_amount: amount, invoice_payload: payload } });
  await update({
    message: {
      message_id: ++upd,
      date: Math.floor(Date.now() / 1000),
      from,
      chat: { id: UID, type: 'private' },
      successful_payment: { currency: 'XTR', total_amount: amount, invoice_payload: payload, telegram_payment_charge_id: 'ui-charge-' + UID + '-' + upd, provider_payment_charge_id: '' },
    },
  });
  return 'paid';
});
await page.goto(BASE + '/');
await page.waitForTimeout(3000);
let p = await profile(page);
check(p && p.mics === 0 && p.level.level === 1, `حساب جديد: ${p && p.mics} مايك، لفل ${p && p.level.level}`);
const chip = await page.$eval('.profile-chip', (e) => e.innerText);
check(/⭐ 1/.test(chip) && /🎤 0/.test(chip), 'شارة الحساب: لفل ومايكات');
check((await page.$$('.menu-side .side-btn')).length === 4, 'أزرار المتجر/الباس/مجاني/ضيف صوت بالقائمة');
check(!!(await page.$('.menu-side .side-btn.dot')), 'نقطة على «مجاني» (الصندوق متاح)');
await clearOfHeader(page, '.menu-side .side-btn, .menu-btns button, .menu-top button, .profile-chip', 'أزرار القائمة');
await shot(page, 'menu');

// ---------------- المتجر
await tap(page, '.menu-side .side-btn', 0);
await page.waitForSelector('.panel.shop');
await page.waitForTimeout(600);
await clearOfHeader(page, '.panel.shop .xbtn', 'زر ✕ المتجر');
await clearOfHeader(page, '.panel.shop .tab', 'تبويبات المتجر');
const nCards = await page.$$eval('.it-card', (c) => c.length);
check(nCards === 16, `قسم الشخصيات فيه 16 شخصية (${nCards})`);
await shot(page, 'shop-skins');
for (const [i, name] of [
  [1, 'head'],
  [2, 'face'],
  [3, 'stage'],
]) {
  await tap(page, '.tabs .tab', i);
  await page.waitForTimeout(700);
  await shot(page, 'shop-' + name);
}
await page.$eval('.shop-body', (e) => (e.scrollTop = e.scrollHeight));
await page.waitForTimeout(300);
await shot(page, 'shop-stage-bottom');

// ---------------- المايكات: إعلان مجاني + صندوق اليوم
await tap(page, '.tabs .tab', 4);
await page.waitForTimeout(500);
await shot(page, 'shop-mics');
let tn = toasts.length;
await tap(page, '.earn-card .it-btn.ad', 0);
check(await waitFor(page, () => window.__qd.meta.profile.mics === 20), 'إعلان مايكات مجانية: +20');
check(sawToast(/\+20/, tn), 'تنبيه +20 مايك');
await page.waitForTimeout(2600);
const before = (await profile(page)).mics;
await tap(page, '.earn-card .it-btn.ad', 1);
check(await waitFor(page, () => window.__qd.meta.profile.daily.box === 0), 'الصندوق اليومي انفتح');
await page.waitForTimeout(400);
await shot(page, 'shop-mics-after');
p = await profile(page);
check(p.daily.coins === 4 && p.daily.box === 0, `العدّاد: باقي ${p.daily.coins} مايكات مجانية، صندوق ${p.daily.box}`);
log('   مايكات بعد الصندوق', p.mics, '(قبل', before + ')');

// ---------------- باقة مايكات بنجوم تيليجرام
{
  const n = await page.$$eval('.earn-card.star', (c) => c.length);
  check(n === 4, `4 باقات مايكات بالنجوم (${n})`);
  const m0 = (await profile(page)).mics;
  await tap(page, '.earn-card.star .it-btn.star', 0);
  check(await waitFor(page, (m) => window.__qd.meta.profile.mics === m + 300, m0, 20000), 'دفع 15⭐ → +300 مايك');
  await page.waitForTimeout(600);
  await shot(page, 'shop-mics-stars');
}

// ---------------- فتح إكسسوار بإعلان ثم لبسه
await tap(page, '.tabs .tab', 1);
await page.waitForTimeout(500);
const headAd = await page.evaluate(() => {
  const c = [...document.querySelectorAll('.it-card')].find((c) => c.querySelector('.it-btn.ad') && /1$/.test(c.querySelector('.it-btn.ad').textContent));
  return c ? c.querySelector('.it-name').textContent : null;
});
check(!!headAd, 'إكسسوار رأس ينفتح بإعلان واحد: ' + headAd);
await cardBtn(page, headAd, 'ad');
check(await waitFor(page, (n) => [...document.querySelectorAll('.it-card.has .it-name')].some((e) => e.textContent === n), headAd), `انفتح ${headAd}`);
await cardBtn(page, headAd, 'green');
check(await waitFor(page, () => !!window.__qd.meta.profile.equip.head), 'لبس الإكسسوار');
await page.waitForTimeout(500);
await shot(page, 'shop-head-equipped');

// ---------------- وجه: جرّب 24 ساعة
await tap(page, '.tabs .tab', 2);
await page.waitForTimeout(500);
await cardBtn(page, 'نظارة شمسية', 'try').catch(async () => {
  const n = await page.$eval('.it-card .it-btn.try', (b) => b.closest('.it-card').querySelector('.it-name').textContent);
  await cardBtn(page, n, 'try');
});
check(await waitFor(page, () => Object.values(window.__qd.meta.profile.owned).some((v) => v > Date.now())), 'تجربة 24 ساعة انضافت');
const faceTrial = await page.evaluate(() => {
  const c = [...document.querySelectorAll('.it-card')].find((c) => /تجربة/.test(c.textContent));
  return c ? c.querySelector('.it-name').textContent : null;
});
check(!!faceTrial, 'الكارت يكول «تجربة: باقي … ساعة»: ' + faceTrial);
if (faceTrial) await cardBtn(page, faceTrial, 'green');
check(await waitFor(page, () => !!window.__qd.meta.profile.equip.face), 'لبس غرض التجربة');

// ---------------- شخصية: تجربة + مسرح: تجربة
await tap(page, '.tabs .tab', 0);
await page.waitForTimeout(500);
await cardBtn(page, 'الروبوت', 'try');
check(await waitFor(page, () => window.__qd.meta.profile.owned['skin:10'] > Date.now()), 'تجربة الروبوت');
await cardBtn(page, 'الروبوت', 'green');
check(await waitFor(page, () => window.__qd.meta.profile.equip.skin === 'skin:10'), 'لبس الروبوت');
await page.waitForTimeout(400);
await shot(page, 'shop-skin-robot');
await tap(page, '.tabs .tab', 3);
await page.waitForTimeout(500);
const neon = await page.evaluate(() => [...document.querySelectorAll('.it-card .it-name')].map((e) => e.textContent));
log('   المسارح:', neon.join('، '));
const stageName = neon.find((n) => /نيون/.test(n)) || neon[neon.length - 1];
await cardBtn(page, stageName, 'try');
check(await waitFor(page, () => Object.keys(window.__qd.meta.profile.owned).some((k) => k.startsWith('stage:') && window.__qd.meta.profile.owned[k] > Date.now())), 'تجربة مسرح ' + stageName);
await cardBtn(page, stageName, 'green');
check(await waitFor(page, () => window.__qd.meta.profile.equip.stage !== 'stage:classic'), 'اختار المسرح');

// ---------------- الشراء بالمايكات: خشم مهرج (120) — نكمّل المايكات بإعلانات إذا ناقصة
await tap(page, '.tabs .tab', 4);
await page.waitForTimeout(400);
for (let i = 0; i < 4 && (await profile(page)).mics < 120; i++) {
  await tap(page, '.earn-card .it-btn.ad', 0);
  await page.waitForTimeout(2000);
}
p = await profile(page);
log('   الرصيد قبل الشراء', p.mics);
await tap(page, '.tabs .tab', 2);
await page.waitForTimeout(500);
if (p.mics >= 120) {
  await cardBtn(page, 'خشم مهرج', 'buy');
  check(await waitFor(page, (m) => window.__qd.meta.profile.mics === m - 120 && window.__qd.meta.profile.owned['face:clown'] === 0, p.mics), 'شراء خشم مهرج بـ120 مايك');
  check(await waitFor(page, () => window.__qd.meta.profile.equip.face === 'face:clown'), 'بعد الشراء لبسه تلقائيًا');
  await page.waitForTimeout(400);
  await shot(page, 'shop-face-bought');
} else {
  tn = toasts.length;
  await cardBtn(page, 'خشم مهرج', 'buy');
  await page.waitForTimeout(500);
  check(sawToast(/ناقصك/, tn) && (await profile(page)).owned['face:clown'] === undefined, `رصيد ${p.mics} ما يكفي: «ناقصك …» وما انشرى`);
}

// إغلاق المتجر → القائمة بالشكل الجديد
await tap(page, '.panel.shop .xbtn');
await page.waitForTimeout(2200);
check(!(await page.$('.panel.shop')), 'المتجر تسكّر ورجعت القائمة');
await shot(page, 'menu-dressed');

// ---------------- الرويال باس
await tap(page, '.menu-side .side-btn.pass');
await page.waitForSelector('.panel.pass');
await page.waitForTimeout(700);
check((await page.$$('.rp-col')).length === 100, '100 لفل بالمسار');
check(!!(await page.$('.pass-head .btn.gold.plus')), 'زر «مميز + 10 لفلات»');
check((await page.$$('.lv-buy .it-btn.star')).length === 4, '4 باقات لفلات بالنجوم');
await clearOfHeader(page, '.panel.pass .xbtn', 'زر ✕ الباس');
await shot(page, 'pass');
await tap(page, '.pass-prog .it-btn.ad');
check(await waitFor(page, () => window.__qd.meta.profile.pass.xp >= 60), 'إعلان الباس: +60 خبرة');
await page.waitForTimeout(400);
await tap(page, '.pass-head .btn.gold');
check(await waitFor(page, () => window.__qd.meta.profile.pass.premium, null, 20000), 'الدفع بالنجوم فعّل الباس المميز');
await page.waitForTimeout(600);
check(!!(await page.$('.prem-badge')), 'شارة «مميز — 100 لفل»');
{
  const lv = (await profile(page)).pass.level;
  await tap(page, '.lv-buy .it-btn.star', 0);
  check(await waitFor(page, (l) => window.__qd.meta.profile.pass.level === l + 1, lv, 20000), `شراء لفل باس بـ10⭐ (${lv} → ${lv + 1})`);
  await page.waitForTimeout(500);
}
await shot(page, 'pass-premium');
await tap(page, '.panel.pass .xbtn');
await page.waitForTimeout(1500);

// ---------------- الإعدادات ⚙️
await tap(page, '.menu-top .gear');
await page.waitForSelector('.panel.settings');
await page.waitForTimeout(500);
await clearOfHeader(page, '.panel.settings .xbtn', 'زر ✕ الإعدادات');
await shot(page, 'settings');
const segTap = async (key, v) => {
  const idx = await page.evaluate(
    ({ key, v }) => {
      const rows = [...document.querySelectorAll('.set-row')];
      const all = [...document.querySelectorAll('.seg-btn')];
      for (const r of rows) {
        const b = r.querySelector(`.seg-btn[data-v="${v}"]`);
        if (b && r.textContent.includes(key)) return all.indexOf(b);
      }
      return -1;
    },
    { key, v: String(v) },
  );
  if (idx < 0) throw new Error('ماكو ' + key + '=' + v);
  await tap(page, '.seg-btn', idx);
  await page.waitForTimeout(400);
};
await segTap('جودة', 'low');
let q = await page.evaluate(() => ({ mode: window.__qd.stage.qualityMode, pr: window.__qd.stage.renderer.getPixelRatio(), aa: window.__qd.stage.aa }));
check(q.mode === 'low' && q.pr === 0.75 && q.aa === false, `جودة واطية: ${JSON.stringify(q)}`);
await segTap('الفريمات', 30);
const tgl = await page.$$('.set-row .toggle');
await tap(page, '.set-row .toggle', 0); // عدّاد الفريمات
await page.waitForTimeout(2600);
const fpsTxt = await page.$eval('#fps', (e) => e.textContent).catch(() => '');
const fpsN = parseInt(fpsTxt, 10);
const capMs = await page.evaluate(() => window.__qd.stage.minFrameMs);
// الرسم هنا برمجي (SwiftShader) وبطيء، فنتأكد من الحد والعدّاد مو من الرقم نفسه
check(Math.abs(capMs - 1000 / 30) < 0.01 && fpsN > 0 && fpsN <= 34, `حد 30 فريم مضبوط والعدّاد يشتغل («${fpsTxt}»)`);
await tap(page, '.step-btn', 0);
await tap(page, '.step-btn', 0);
const vol = await page.evaluate(() => JSON.parse(localStorage.getItem('qd_settings')).volume);
check(Math.abs(vol - 0.7) < 0.011, `الصوت نزل لـ70% وانحفظ (${vol})`);
const cloud = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__cloud') || '{}').settings || '');
check(/"quality":"low"/.test(cloud), 'الإعدادات انحفظت بحساب تيليجرام (CloudStorage)');
await shot(page, 'settings-changed');
await segTap('جودة', 'max');
q = await page.evaluate(() => ({ mode: window.__qd.stage.qualityMode, aa: window.__qd.stage.aa, canvas: !!document.querySelector('canvas#stage') }));
check(q.mode === 'max' && q.aa === true && q.canvas, `أعلى جودة: نعومة حواف بكانفس جديد ${JSON.stringify(q)}`);
await segTap('الفريمات', 60);
await tap(page, '.panel.settings .xbtn');
await page.waitForTimeout(800);
check(!(await page.$('.panel.settings')), 'الإعدادات تسكّرت');
await shot(page, 'menu-fps');

if (PLAY) {
  // ---------------- لعبة كاملة (وحدي) → مكافآت النهاية + إعلان كامل الشاشة + ضاعف
  await tap(page, '.menu-btns .btn.friends');
  await page.waitForSelector('#lobbyBar .room-code b', { timeout: 15000 });
  await page.waitForTimeout(2500);
  await clearOfHeader(page, '#exitBtn, #setBtn, #lobbyBar button, #lobbyBar .room-code', 'أزرار الغرفة');
  await shot(page, 'lobby');
  await tap(page, '#setBtn');
  await page.waitForSelector('.panel.settings');
  check(!!(await page.$('.set-row .seg.off')), 'داخل الغرفة: اللغة تتغيّر بس من القائمة');
  await tap(page, '.panel.settings .xbtn');
  await page.waitForTimeout(500);
  const look = await page.evaluate(() => {
    const g = window.__qd.game;
    const me = g.st.players.find((x) => x.uid === g.me);
    return { skin: me.skin, acc: me.acc, lvl: me.lvl, stage: g.st.stage };
  });
  check(look.skin === 10 && look.acc && look.acc.head && look.acc.face && look.stage !== 'stage:classic', 'اللوبي: الشخصية بلبسها والمسرح الجديد ' + JSON.stringify(look));
  await tap(page, '#lobbyBar .btn.purple');
  await page.waitForSelector('.panel.shop');
  await page.waitForTimeout(500);
  await shot(page, 'lobby-wardrobe');
  await cardBtn(page, 'الموظف', 'green');
  await page.waitForTimeout(900);
  const sk = await page.evaluate(() => {
    const g = window.__qd.game;
    return g.st.players.find((x) => x.uid === g.me).skin;
  });
  check(sk === 0, 'تبديل الشخصية من اللوبي وصل للغرفة');
  await tap(page, '.panel.shop .xbtn');
  await page.waitForTimeout(700);
  check(!(await page.$('.panel.shop')) && !!(await page.$('#lobbyBar .btn.pink')), 'تسكّر المتجر ورجع اللوبي');
  const mic = await page.$('#lobbyBar .btn.orange');
  if (mic) await tap(page, '#lobbyBar .btn.orange');
  await page.waitForTimeout(800);
  // إعلان النهاية ما يطلع إذا شاف إعلان مكافأة قبل أقل من 3 دقايق — نصفّر حتى نختبره
  await page.evaluate(() => (window.__qd.meta.ads.lastRewardedAt = 0));
  await tap(page, '#lobbyBar .btn.pink');
  const t0 = Date.now();
  let phase = '';
  while (Date.now() - t0 < 360000) {
    const s = await page.evaluate(() => {
      const g = window.__qd.game;
      return g && g.st ? `${g.st.round}:${g.st.phase}` : '';
    });
    if (s !== phase) {
      phase = s;
      log('   phase', s);
    }
    if (s.endsWith(':final')) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1800);
  const gum = await page.evaluate(() => window.__gum);
  check(gum === 1, `المايك انطلب مرة وحدة بس طول اللعبة (getUserMedia × ${gum})`);
  await clearOfHeader(page, '.final-btns button', 'أزرار النهاية');
  await shot(page, 'final');
  check(!!(await page.$('.rewards')), 'شريط المكافآت بالنهاية');
  const rw = await page.$eval('.rewards', (e) => e.innerText).catch(() => '');
  log('   المكافآت:', rw.replace(/\n/g, ' · '));
  await page.waitForTimeout(3500);
  check(adsShown.includes('int-12345'), 'إعلان كامل الشاشة طلع بنهاية اللعبة: ' + adsShown.join(','));
  const m1 = (await profile(page)).mics;
  const dbl = await page.$('.rewards .btn.gold');
  check(!!dbl, 'زر «ضاعف مايكاتك»');
  if (dbl) {
    await tap(page, '.rewards .btn.gold');
    check(await waitFor(page, (m) => window.__qd.meta.profile.mics > m, m1), 'المضاعفة زادت المايكات');
    await page.waitForTimeout(500);
    check(!(await page.$('.rewards .btn.gold')), 'زر المضاعفة اختفى');
    await shot(page, 'final-doubled');
  }
}

// ---------------- اللغة الروسية
if (PLAY) {
  await tap(page, '.final-btns .btn.ghost');
  await page.waitForTimeout(1500);
}
await tap(page, '.menu-top .gear');
await page.waitForSelector('.panel.settings');
await Promise.all([page.waitForEvent('load', { timeout: 20000 }), tap(page, '.seg-btn[data-v="ru"]')]);
await page.waitForTimeout(3000);
const ru = await page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang, btn: (document.querySelector('.menu-btns .btn.pink') || {}).textContent, title: document.title }));
check(ru.dir === 'ltr' && ru.lang === 'ru' && /Случайная игра/.test(ru.btn || ''), `الروسي: ${JSON.stringify(ru)}`);
await clearOfHeader(page, '.menu-side .side-btn, .menu-btns button, .menu-top button, .profile-chip', 'أزرار القائمة (روسي)');
await shot(page, 'ru-menu');
await tap(page, '.menu-side .side-btn', 0);
await page.waitForSelector('.panel.shop');
await page.waitForTimeout(700);
await shot(page, 'ru-shop');
await tap(page, '.tabs .tab', 1);
await page.waitForTimeout(600);
await shot(page, 'ru-shop-head');
await tap(page, '.tabs .tab', 4);
await page.waitForTimeout(600);
await shot(page, 'ru-shop-mics');
await tap(page, '.panel.shop .xbtn');
await page.waitForTimeout(900);
await tap(page, '.menu-side .side-btn.pass');
await page.waitForSelector('.panel.pass');
await page.waitForTimeout(700);
await shot(page, 'ru-pass');
await tap(page, '.panel.pass .xbtn');
await page.waitForTimeout(900);
await tap(page, '.menu-top .gear');
await page.waitForSelector('.panel.settings');
await page.waitForTimeout(500);
await shot(page, 'ru-settings');
await tap(page, '.panel.settings .xbtn');
await page.waitForTimeout(500);
await tap(page, '.menu-top .help');
await page.waitForTimeout(700);
await shot(page, 'ru-help');
await tap(page, '.panel.help .xbtn');
await page.waitForTimeout(700);
await tap(page, '.menu-btns .btn.friends');
await page.waitForSelector('#lobbyBar .room-code b', { timeout: 15000 });
await page.waitForTimeout(2000);
await shot(page, 'ru-lobby');
const missingRu = errors.filter((e) => /ru missing/.test(e));
check(missingRu.length === 0, `كل النصوص مترجمة (${missingRu.length} ناقص)${missingRu.length ? ': ' + missingRu.slice(0, 5).join(' | ') : ''}`);

const me = await api('/api/me');
log('الحساب بالسيرفر:', JSON.stringify({ mics: me.profile.mics, level: me.profile.level.level, pass: me.profile.pass, equip: me.profile.equip }));

console.log('\n==== console errors/warnings ====');
console.log([...new Set(errors)].filter((e) => !/requestFullscreen|THREE.Clock|GPU stall|WebGL|swiftshader|Automatic fallback|Permissions policy/i.test(e)).join('\n') || '(none)');
console.log(`\n${ok} ✅  ${bad} ❌`);
await browser.close();
process.exit(bad ? 1 : 0);
