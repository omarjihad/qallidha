// مدخل عامل Cloudflare: يوجّه الطلبات. الملفات الثابتة تُقدَّم من الحافة مباشرة (مجانًا وبلا حد).

import { Room } from './room.js';
import { Hub } from './hub.js';
import { identify, AuthError, webhookSecret } from './auth.js';
import { handleUpdate, Tg, adminIds } from './telegram.js';
import { VERSION, MAX_PLAYERS } from '../public/js/shared.js';
import { LIBRARY_BY_SLUG } from './library-sounds.js';
import { seasonOf } from '../public/js/catalog.js';
import { passPrice, passInvoice, packInvoice } from './pass.js';
import { STAR_PACKS, packPrice } from '../public/js/catalog.js';
import { adminApi } from './admin.js';

export { Room, Hub };

let webhookOkAt = 0; // نجح التسجيل بهذا الـisolate: ما نعيد
let webhookTryAt = 0; // آخر محاولة (إذا فشلت نعيد بعد دقيقة)
const filePathCache = new Map(); // file_id → { path, at }

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

function stub(ns, name, env) {
  const id = ns.idFromName(name);
  const hint = (env.DO_LOCATION_HINT || '').trim();
  return hint ? ns.get(id, { locationHint: hint }) : ns.get(id);
}
const hubOf = (env) => stub(env.HUB, 'hub', env);
const roomOf = (env, code) => stub(env.ROOMS, 'r' + code, env);

/* ---------------- الصيانة والحظر (من لوحة المطوّر): نخزنها بالذاكرة 20 ثانية حتى ما نسأل الـHub بكل طلب */
let flagsCache = { at: 0, maint: false, banned: new Set() };
async function flags(env) {
  if (Date.now() - flagsCache.at < 20000) return flagsCache;
  try {
    const f = await hubOf(env).flags();
    flagsCache = { at: Date.now(), maint: !!f.maint, banned: new Set(f.banned || []) };
  } catch {
    flagsCache.at = Date.now() - 15000;
  }
  return flagsCache;
}
const isAdminUser = (env, user) => !!user && !user.guest && adminIds(env).includes(String(user.tgId));
const BANNED = { error: 'banned', message: '🚫 حسابك محظور من اللعبة' };
const MAINT = { error: 'maint', message: '🛠️ اللعبة بالصيانة هسه — نرجع قريب' };

/** يرفض الدخول (محظور/صيانة) قبل ما يوصل للغرفة. يرجع Response أو null */
async function gate(env, user) {
  const f = await flags(env);
  if (user && f.banned.has(user.uid)) return json(BANNED, 403);
  if (f.maint && !isAdminUser(env, user)) return json(MAINT, 503);
  return null;
}

/** WebSocket مرفوض بس برسالة واضحة (حتى اللعبة ما تعيد الاتصال كل شوية) */
function wsReject(code, m) {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  server.send(JSON.stringify({ t: 'error', code, m }));
  server.close(4001, code);
  return new Response(null, { status: 101, webSocket: client });
}

function publicOrigin(env, url) {
  const fromEnv = String(env.PUBLIC_URL || '').trim().replace(/\/$/, '');
  return fromEnv || url.origin;
}

/**
 * بعد أي نشر (أول طلب يوصل): نحدّث إعدادات الـwebhook، ونبدي تنزيل أصوات المكتبة الناقصة.
 * الاثنين يتجاهلون إذا ماكو شي جديد.
 */
function checkWebhook(env, ctx, origin) {
  if (webhookOkAt || Date.now() - webhookTryAt < 60000) return;
  webhookTryAt = Date.now();
  const hub = hubOf(env);
  ctx.waitUntil(
    (async () => {
      const lib = await hub.ensureLibrary().catch(() => null);
      if (!(env.TELEGRAM_BOT_TOKEN || '').trim()) {
        if (lib) webhookOkAt = Date.now();
        return;
      }
      const r = await hub.ensureWebhook(origin).catch(() => null);
      if (r && r.ok && lib) webhookOkAt = Date.now();
    })(),
  );
}

/** ملف صوت من مكتبة الميمز (محفوظ بالـHub بعد ما نزل) */
async function libFile(env, slug) {
  if (!LIBRARY_BY_SLUG.has(slug)) return new Response('not found', { status: 404 });
  const f = await hubOf(env).libFile(slug);
  if (!f) return new Response('not ready', { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(f.data, {
    headers: {
      'content-type': f.mime || 'audio/mpeg',
      'content-length': String(f.data.byteLength),
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

/** إعدادات AdsGram من متغيرات Cloudflare (فارغة = الإعلانات مطفية) */
function adsConfig(env) {
  return {
    interstitial: String(env.ADSGRAM_INTERSTITIAL || '').trim() || null,
    rewarded: String(env.ADSGRAM_REWARDED || '').trim() || null,
  };
}

async function claimRoom(env, chatId = null, pub = false) {
  for (let i = 0; i < 8; i++) {
    const code = String(10000 + Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) * 90000));
    if (await roomOf(env, code).claim({ code, chatId, pub })) return code;
  }
  throw new Error('ما لگينا غرفة فارغة، جرّب مرة ثانية');
}

/** لغة الفاتورة */
const invLang = (l) => (l === 'ru' || l === 'en' ? l : 'ar');

/** منين دخل اللاعب اللعبة (لإشعار الأدمن) */
function appSource(user) {
  const m = /^r(\d{5})$/.exec(user.startParam || '');
  if (m) return `رابط دعوة لغرفة ${m[1]}`;
  if (user.chatType === 'group' || user.chatType === 'supergroup') return 'اللعبة من كروب';
  if (user.chatType === 'channel') return 'اللعبة من قناة';
  if (user.startParam) return `اللعبة (${String(user.startParam).slice(0, 30)})`;
  return 'فتح اللعبة';
}

async function readAuth(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

const CT = {
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** بروكسي لملفات تيليجرام (الأصوات المضافة من البوت) بدون كشف التوكن. */
async function tgFile(request, env, fileId) {
  if (!/^[A-Za-z0-9_-]{20,250}$/.test(fileId)) return new Response('bad id', { status: 400 });
  const token = (env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return new Response('no token', { status: 503 });
  const tg = new Tg(token, env.TG_API_BASE);
  let cached = filePathCache.get(fileId);
  if (!cached || Date.now() - cached.at > 50 * 60 * 1000) {
    try {
      const f = await tg.call('getFile', { file_id: fileId });
      cached = { path: f.file_path, at: Date.now() };
      filePathCache.set(fileId, cached);
      if (filePathCache.size > 500) filePathCache.delete(filePathCache.keys().next().value);
    } catch (e) {
      return new Response('file not found', { status: 404 });
    }
  }
  const headers = {};
  const range = request.headers.get('range');
  if (range) headers.range = range;
  const res = await fetch(tg.fileUrl(cached.path), { headers });
  if (!res.ok && res.status !== 206) return new Response('upstream ' + res.status, { status: 502 });
  const ext = (cached.path.split('.').pop() || '').toLowerCase();
  const out = new Headers();
  out.set('content-type', CT[ext] || res.headers.get('content-type') || 'application/octet-stream');
  out.set('cache-control', 'public, max-age=86400, immutable');
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers: out });
}

async function api(request, env, ctx, url) {
  const path = url.pathname;
  const origin = publicOrigin(env, url);
  const token = (env.TELEGRAM_BOT_TOKEN || '').trim();

  // تسجيل الـwebhook كسولًا: أول طلب بعد النشر يكفي
  checkWebhook(env, ctx, origin);

  if (path === '/api/health') {
    let hub = null;
    try {
      hub = await hubOf(env).status();
    } catch (e) {
      hub = { error: String(e.message || e) };
    }
    return json({
      ok: true,
      version: VERSION,
      runtime: 'cloudflare',
      colo: request.cf && request.cf.colo,
      telegram: token ? 'configured' : 'TELEGRAM_BOT_TOKEN ناقص',
      admins: String(env.ADMIN_IDS || '').trim() ? 'configured' : 'ADMIN_IDS ناقص (اختياري)',
      guests: String(env.ALLOW_GUEST || 'true') !== 'false',
      ...hub,
    });
  }

  if (path === '/api/setup') {
    // إعادة تسجيل الـwebhook يدويًا (مثلًا بعد تغيير التوكن)
    const r = await hubOf(env).ensureWebhook(origin, true);
    return json(r, r.ok ? 200 : 500);
  }

  if (path === '/api/config') {
    const [brief, f] = await Promise.all([hubOf(env).configBrief().catch(() => ({})), flags(env)]);
    return json({
      contest: brief.contest || null,
      version: VERSION,
      maintenance: f.maint,
      bot: (token && brief.bot) || String(env.BOT_USERNAME || '').replace('@', '') || null,
      appShort: String(env.APP_SHORT_NAME || '').trim() || null,
      guests: String(env.ALLOW_GUEST || 'true') !== 'false',
      ads: adsConfig(env),
      passPrice: passPrice(env),
      packs: STAR_PACKS.map((p) => ({ ...p, stars: packPrice(p, passPrice(env)) })),
    });
  }

  // ---------------- AdsGram: رابط المكافأة (السيرفر مالهم يستدعيه بعد ما يكمل المستخدم الإعلان)
  if (path === '/api/adsgram/reward') {
    const key = String(env.ADSGRAM_REWARD_KEY || '').trim();
    if (!key || url.searchParams.get('key') !== key) return new Response('forbidden', { status: 403 });
    const id = String(url.searchParams.get('userid') || '').replace(/\D/g, '');
    if (!id) return new Response('bad user', { status: 400 });
    const r = await hubOf(env).adReward('t' + id);
    return json({ ok: !!r.ok });
  }

  if (path === '/api/top') {
    const rows = await hubOf(env).top(20);
    return json({ top: rows.map(({ id, ...r }) => ({ ...r, me: false, id })) });
  }

  if (path === '/api/me' && request.method === 'POST') {
    const body = await readAuth(request);
    const user = await identify(env, body);
    if (!user.guest && (await flags(env)).banned.has(user.uid)) return json(BANNED, 403);
    const hub = hubOf(env);
    const lang = ['ar', 'ru', 'en'].includes(body.lang) ? body.lang : '';
    const stats = user.guest ? { games: 0, wins: 0, points: 0, best: 0, rank: null } : await hub.me(user.uid);
    const profile = user.guest ? null : await hub.profile(user.uid, user.name, user.photo, lang);
    // أول مرة يفتح اللعبة (وما دخل البوت قبل): إشعار للأدمن
    if (!user.guest && user.tg) ctx.waitUntil(hub.join({ ...user.tg, src: appSource(user) }).catch(() => null));
    // القائمة (inbox:true): هدايا المطوّر والفوز بالمسابقة (نافذة باللعبة مرة وحدة) + المسابقة الشغّالة لكارت القائمة
    const extra = body.inbox === true ? await hub.menuExtras(user.guest ? '' : user.uid).catch(() => null) : null;
    return json({
      user: { uid: user.uid, name: user.name, photo: user.photo, guest: user.guest, startParam: user.startParam, admin: isAdminUser(env, user) },
      stats,
      profile,
      inbox: (extra && extra.inbox) || [],
      ...(extra ? { contest: extra.contest } : {}),
    });
  }

  // اللاعب سكّر نافذة الهدية/الفوز: تنعلّم «شافها» (قبلها تبقى تطلع)
  if (path === '/api/inbox/seen' && request.method === 'POST') {
    const body = await readAuth(request);
    const user = await identify(env, body);
    if (user.guest) return json({ ok: true, n: 0 });
    return json(await hubOf(env).inboxSeen(user.uid, body.ids));
  }

  // مسابقة المتصدرين: الوقت والجوائز والترتيب وترتيبي
  if (path === '/api/contest' && request.method === 'POST') {
    const body = await readAuth(request);
    let user = null;
    try {
      user = await identify(env, body);
    } catch {
      user = null;
    }
    return json(await hubOf(env).contestView(user && !user.guest ? user.uid : '', 20));
  }

  // لوحة المطوّر داخل اللعبة: الأدمن بس (initData موقّعة + آيديه بـADMIN_IDS)
  if (path === '/api/admin' && request.method === 'POST') {
    const body = await readAuth(request);
    const user = await identify(env, body);
    if (!isAdminUser(env, user)) return json({ error: 'forbidden', message: '⛔ هاي اللوحة للمطوّر بس' }, 403);
    const r = await adminApi({ env, origin, hub: hubOf(env) }, user, body);
    // الحظر والصيانة يبينون فورًا (بهذا العامل؛ الباقي خلال 20 ثانية)
    if (!r.error && ['ban', 'unban', 'maint'].includes(String(body.op))) flagsCache.at = 0;
    return json(r, r.error ? 400 : 200);
  }

  // ---------------- المتجر والإعلانات والباس (لاعبين تيليجرام بس)
  if (path.startsWith('/api/shop/') || path.startsWith('/api/ads/') || path === '/api/pass/invoice' || path === '/api/stars/invoice') {
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    const body = await readAuth(request);
    const user = await identify(env, body);
    if (user.guest) return json({ error: 'tg_only', message: 'افتح اللعبة من تيليجرام حتى تجمع مايكات وتشتري' }, 403);
    if ((await flags(env)).banned.has(user.uid)) return json(BANNED, 403);
    const hub = hubOf(env);
    const withProfile = async (r) => json({ ...r, profile: await hub.profile(user.uid) }, r.error ? 400 : 200);
    if (path === '/api/shop/buy') return withProfile(await hub.buy(user.uid, String(body.item || '')));
    if (path === '/api/shop/equip') return withProfile(await hub.equip(user.uid, String(body.slot || ''), body.item == null ? null : String(body.item)));
    if (path === '/api/ads/intent') {
      if (!adsConfig(env).rewarded) return json({ error: 'الإعلانات بعدها ما مفعّلة' }, 400);
      return json(await hub.adIntent(user.uid, String(body.kind || ''), body.item == null ? null : String(body.item)));
    }
    if (path === '/api/ads/done') {
      const nonce = String(body.nonce || '');
      // إذا رابط المكافأة مضبوط بـAdsGram: المكافأة تجي من سيرفرهم بس (ضد الغش) — هنا نسأل عن الحالة
      const secure = !!String(env.ADSGRAM_REWARD_KEY || '').trim();
      const r = secure ? await hub.adStatus(user.uid, nonce) : await hub.adReward(user.uid, nonce);
      return withProfile(r);
    }
    if (path === '/api/pass/invoice') {
      if (!token) return json({ error: 'البوت ما مربوط' }, 400);
      const season = seasonOf();
      const can = await hub.canBuyPass(user.uid, season);
      if (!can.ok) return json({ error: can.error }, 400);
      const link = await new Tg(token, env.TG_API_BASE).call('createInvoiceLink', passInvoice(env, user.uid, season, invLang(body.lang)));
      return json({ ok: true, link });
    }
    if (path === '/api/stars/invoice') {
      if (!token) return json({ error: 'البوت ما مربوط' }, 400);
      const sku = String(body.sku || '');
      const season = seasonOf();
      const can = await hub.canBuyPack(user.uid, sku, season);
      if (!can.ok) return json({ error: can.error }, 400);
      const inv = packInvoice(env, user.uid, sku, season, invLang(body.lang));
      if (!inv) return json({ error: 'هاي الباقة مو موجودة' }, 400);
      const link = await new Tg(token, env.TG_API_BASE).call('createInvoiceLink', inv);
      return json({ ok: true, link });
    }
    return json({ error: 'not_found' }, 404);
  }

  {
    const m = /^\/api\/rooms\/(\d{5})$/.exec(path);
    if (m && request.method === 'GET') {
      const info = await roomOf(env, m[1]).info();
      return json(info);
    }
  }

  // قائمة الغرف العامة (اللعب العشوائي): يختار منها أو يسوّي وحدة
  if (path === '/api/rooms/public' && request.method === 'GET') {
    return json({ rooms: await hubOf(env).mmList(), max: MAX_PLAYERS });
  }

  // غرفة جديدة: ويا الربع = خاصة (بالكود بس)، أو عامة (تبين بالقائمة)
  if (path === '/api/rooms' && request.method === 'POST') {
    const body = await readAuth(request);
    const user = await identify(env, body);
    const no = await gate(env, user);
    if (no) return no;
    const pub = body.pub === true;
    const code = await claimRoom(env, null, pub);
    if (pub) await hubOf(env).mmAdd(code);
    return json({ code, pub });
  }

  // اللعب العشوائي: أقرب غرفة عامة بيها مكان، وإذا ماكو نسوّي وحدة جديدة وننتظر بيها ناس
  if (path === '/api/quick' && request.method === 'POST') {
    const body = await readAuth(request);
    const user = await identify(env, body);
    const no = await gate(env, user);
    if (no) return no;
    const hub = hubOf(env);
    const okCode = (c) => /^\d{5}$/.test(String(c || ''));
    const exclude = Array.isArray(body.exclude) ? body.exclude.filter(okCode).map(String).slice(0, 12) : [];
    const bad = okCode(body.bad) ? String(body.bad) : '';
    const found = await hub.quickRoom(exclude, bad);
    if (found && found.code) return json({ code: found.code, fresh: false });
    const code = await claimRoom(env, null, true);
    await hub.mmAdd(code);
    return json({ code, fresh: true });
  }

  if (path === '/api/quick/stats') {
    return json(await hubOf(env).mmStats());
  }

  return json({ error: 'not_found' }, 404);
}

async function websocket(request, env, url) {
  const code = url.pathname.split('/')[2] || '';
  if (!/^\d{5}$/.test(code)) return new Response('bad room', { status: 400 });
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
  let user;
  try {
    user = await identify(env, {
      initData: url.searchParams.get('a') || '',
      guestId: url.searchParams.get('g') || '',
      guestName: url.searchParams.get('n') || '',
    });
  } catch (e) {
    return new Response(e instanceof AuthError ? e.message : 'auth failed', { status: 401 });
  }
  const f = await flags(env);
  if (f.banned.has(user.uid)) return wsReject('banned', BANNED.message);
  if (f.maint && !isAdminUser(env, user)) return wsReject('maint', MAINT.message);
  const headers = new Headers(request.headers);
  // ترميز ASCII حتى الأسماء العربية ما تخرّب الهيدر
  headers.set('X-User', encodeURIComponent(JSON.stringify({ uid: user.uid, name: user.name, photo: user.photo, guest: user.guest })));
  return roomOf(env, code).fetch(new Request(`https://room/ws?code=${code}`, { method: 'GET', headers }));
}

async function webhook(request, env, ctx, url) {
  const token = (env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return new Response('no token', { status: 503 });
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (secret !== (await webhookSecret(token))) return new Response('forbidden', { status: 403 });
  const update = await request.json().catch(() => null);
  // بعد أي نشر جديد: نحدّث إعدادات الـwebhook (مثلًا أزرار /sounds تحتاج callback_query)
  checkWebhook(env, ctx, publicOrigin(env, url));
  if (update) {
    const origin = publicOrigin(env, url);
    ctx.waitUntil(
      handleUpdate(update, {
        env,
        origin,
        hub: hubOf(env),
        claimRoom: (chatId) => claimRoom(env, chatId),
      }),
    );
  }
  return new Response('ok');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/api/telegram/webhook' && request.method === 'POST') return await webhook(request, env, ctx, url);
      if (path.startsWith('/api/')) return await api(request, env, ctx, url);
      if (path.startsWith('/ws/')) return await websocket(request, env, url);
      if (path.startsWith('/tgfile/')) return await tgFile(request, env, decodeURIComponent(path.slice(8)));
      {
        const lm = /^\/lib\/([a-z0-9-]{1,120})\.mp3$/.exec(path);
        if (lm) {
          checkWebhook(env, ctx, publicOrigin(env, url));
          return await libFile(env, lm[1]);
        }
      }
    } catch (e) {
      if (e instanceof AuthError) return json({ error: 'auth', message: e.message }, 401);
      console.log('error', path, e && e.stack);
      return json({ error: 'server', message: String((e && e.message) || e) }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};
