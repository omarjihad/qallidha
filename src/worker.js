// مدخل عامل Cloudflare: يوجّه الطلبات. الملفات الثابتة تُقدَّم من الحافة مباشرة (مجانًا وبلا حد).

import { Room } from './room.js';
import { Hub } from './hub.js';
import { identify, AuthError, webhookSecret } from './auth.js';
import { handleUpdate, Tg } from './telegram.js';
import { VERSION } from '../public/js/shared.js';
import { LIBRARY_BY_SLUG } from './library-sounds.js';
import { seasonOf } from '../public/js/catalog.js';
import { passPrice, passInvoice } from './pass.js';

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

async function claimRoom(env, chatId = null) {
  for (let i = 0; i < 8; i++) {
    const code = String(10000 + Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) * 90000));
    if (await roomOf(env, code).claim({ code, chatId })) return code;
  }
  throw new Error('ما لگينا غرفة فارغة، جرّب مرة ثانية');
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
    const bot = token ? await hubOf(env).getKV('bot') : null;
    return json({
      version: VERSION,
      bot: bot || String(env.BOT_USERNAME || '').replace('@', '') || null,
      appShort: String(env.APP_SHORT_NAME || '').trim() || null,
      guests: String(env.ALLOW_GUEST || 'true') !== 'false',
      ads: adsConfig(env),
      passPrice: passPrice(env),
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
    const hub = hubOf(env);
    const stats = user.guest ? { games: 0, wins: 0, points: 0, best: 0, rank: null } : await hub.me(user.uid);
    const profile = user.guest ? null : await hub.profile(user.uid, user.name, user.photo);
    return json({ user: { uid: user.uid, name: user.name, photo: user.photo, guest: user.guest, startParam: user.startParam }, stats, profile });
  }

  // ---------------- المتجر والإعلانات والباس (لاعبين تيليجرام بس)
  if (path.startsWith('/api/shop/') || path.startsWith('/api/ads/') || path === '/api/pass/invoice') {
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    const body = await readAuth(request);
    const user = await identify(env, body);
    if (user.guest) return json({ error: 'tg_only', message: 'افتح اللعبة من تيليجرام حتى تجمع مايكات وتشتري' }, 403);
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
      const link = await new Tg(token, env.TG_API_BASE).call('createInvoiceLink', passInvoice(env, user.uid, season));
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

  if (path === '/api/rooms' && request.method === 'POST') {
    const body = await readAuth(request);
    await identify(env, body);
    return json({ code: await claimRoom(env) });
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
