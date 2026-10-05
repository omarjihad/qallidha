// التحقق من هوية اللاعب: initData الموقّعة من تيليجرام، أو ضيف (للتجربة من المتصفح).

const enc = new TextEncoder();

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data));
}

export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function dataCheckString(params, includeSignature) {
  const pairs = [];
  for (const [k, v] of params.entries()) {
    if (k === 'hash') continue;
    if (k === 'signature' && !includeSignature) continue;
    pairs.push([k, v]);
  }
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('\n');
}

/**
 * secret = HMAC_SHA256("WebAppData", token) ، hash = HMAC_SHA256(secret, data_check_string)
 * يعيد المستخدم أو يرمي خطأ برسالة عربية واضحة.
 */
export async function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  if (!botToken) throw new AuthError('التوكن غير مضبوط على السيرفر');
  if (!initData) throw new AuthError('بيانات تيليجرام غير موجودة');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new AuthError('بيانات تيليجرام ناقصة');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  let ok = safeEqual(toHex(await hmac(secret, dataCheckString(params, true))), hash);
  if (!ok && params.has('signature')) ok = safeEqual(toHex(await hmac(secret, dataCheckString(params, false))), hash);
  if (!ok) throw new AuthError('تعذّر التحقق من بيانات تيليجرام');
  const authDate = Number(params.get('auth_date') || 0);
  if (maxAgeSec > 0 && Date.now() / 1000 - authDate > maxAgeSec) throw new AuthError('انتهت الجلسة، سكّر اللعبة وافتحها من جديد');
  let user;
  try {
    user = JSON.parse(params.get('user') || '');
  } catch {
    throw new AuthError('بيانات المستخدم تالفة');
  }
  if (!user || typeof user.id !== 'number') throw new AuthError('بيانات المستخدم ناقصة');
  return {
    uid: 't' + user.id,
    tgId: user.id,
    name: cleanName([user.first_name, user.last_name].filter(Boolean).join(' ')) || 'لاعب',
    username: user.username || '',
    photo: typeof user.photo_url === 'string' && user.photo_url.startsWith('https://') ? user.photo_url : '',
    guest: false,
    startParam: params.get('start_param') || '',
    chatInstance: params.get('chat_instance') || '',
    chatType: params.get('chat_type') || '',
    // لإشعار «لاعب جديد» للأدمن
    tg: {
      id: user.id,
      first_name: String(user.first_name || '').slice(0, 64),
      last_name: String(user.last_name || '').slice(0, 64),
      username: String(user.username || '').slice(0, 40),
      language_code: String(user.language_code || '').slice(0, 12),
      is_premium: !!user.is_premium,
    },
  };
}

export class AuthError extends Error {}

export function cleanName(s) {
  return String(s || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18);
}

/** يستخرج هوية الطلب: من initData، أو ضيف إذا مسموح. */
export async function identify(env, { initData, guestId, guestName }) {
  if (initData) {
    return verifyInitData(initData, (env.TELEGRAM_BOT_TOKEN || '').trim(), Number(env.INIT_DATA_MAX_AGE || 86400));
  }
  if (String(env.ALLOW_GUEST || 'true') === 'false') throw new AuthError('افتح اللعبة من داخل تيليجرام');
  const gid = String(guestId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  if (gid.length < 6) throw new AuthError('هوية الضيف غير صالحة');
  return {
    uid: 'g' + gid,
    tgId: 0,
    name: cleanName(guestName) || 'ضيف ' + gid.slice(0, 3).toUpperCase(),
    username: '',
    photo: '',
    guest: true,
    startParam: '',
  };
}

export async function webhookSecret(token) {
  return toHex(await hmac(enc.encode(token || 'none'), 'qallidha-webhook')).slice(0, 48);
}
