// اختبار الاقتصاد: المايكات، المتجر، الإعلانات المكافأة، الرويال باس والدفع بالنجوم (مقابل تيليجرام الوهمي).
// التشغيل: npx wrangler dev (مع .dev.vars فيها ADSGRAM_REWARDED) + node tools/mock-tg.mjs ثم: ECO_UID=<رقم جديد> node tools/eco-test.mjs
import { createHmac } from 'node:crypto';
import { seasonOf } from '../public/js/catalog.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8790';
const TOKEN = process.env.TOKEN || '123456:TEST-token_abcdefghijklmnop';
const UID = Number(process.env.ECO_UID || 777);
const secret = createHmac('sha256', TOKEN).update('qallidha-webhook').digest('hex').slice(0, 48);
let ok = 0;
let bad = 0;
const check = (cond, label) => {
  if (cond) ok++;
  else bad++;
  console.log(cond ? '✅' : '❌', label);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function signInitData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAH', user: JSON.stringify(user) });
  const pairs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(pairs).digest('hex'));
  return p.toString();
}
const initData = signInitData({ id: UID, first_name: 'Eco', last_name: 'Tester' });
const api = async (path, body = {}) => {
  const r = await fetch(BASE + path, { method: 'POST', body: JSON.stringify({ initData, ...body }) });
  return { status: r.status, ...(await r.json()) };
};
const calls = async () => (await fetch(MOCK + '/__calls')).json();
const lastCall = async (method) => {
  const c = (await calls()).filter((x) => x.method === method);
  return c[c.length - 1] && c[c.length - 1].payload;
};
let uidSeq = 50000;
async function update(obj) {
  const r = await fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ update_id: ++uidSeq, ...obj }),
  });
  return r.status;
}
const msg = (from, text, extra = {}) => ({ message: { message_id: ++uidSeq, date: Math.floor(Date.now() / 1000), from, chat: { id: from.id, type: 'private' }, text, ...extra } });
const ad = async (kind, item) => {
  const i = await api('/api/ads/intent', { kind, item });
  if (!i.ok) return i;
  return api('/api/ads/done', { nonce: i.nonce });
};

// ---------------- الملف الشخصي
let me = await api('/api/me');
const m0 = me.profile ? me.profile.mics : -1;
check(me.profile && m0 >= 0 && me.profile.level.level >= 1 && me.profile.equip.stage === 'stage:classic', `الملف الشخصي: ${m0} مايك، لفل ${me.profile && me.profile.level.level}`);
const guest = await fetch(BASE + '/api/shop/buy', { method: 'POST', body: JSON.stringify({ guestId: 'g123456', guestName: 'ضيف', item: 'head:party' }) });
check(guest.status === 403, 'الضيف ما يكدر يشتري (403)');

// ---------------- مايكات مجانية بإعلان (5 باليوم)
let last;
for (let i = 0; i < 5; i++) last = await ad('coins');
check(last.result && last.result.mics === 20 && last.profile.mics === m0 + 100 && last.profile.daily.coins === 0, '5 إعلانات = 100 مايك');
last = await ad('coins');
check(!!last.error, 'الإعلان السادس للمايكات مرفوض');

// ---------------- فتح إكسسوار بإعلانات
last = await ad('unlock', 'face:sunglasses');
check(last.result && last.result.unlocked && last.profile.owned['face:sunglasses'] === 0, 'نظارة شمسية انفتحت بإعلان واحد');
last = await ad('unlock', 'face:mustache');
check(last.result && !last.result.unlocked && last.result.n === 1 && last.result.need === 2 && last.profile.adProgress['face:mustache'] === 1, 'شوارب: 1 من 2');
last = await ad('unlock', 'face:mustache');
check(last.result && last.result.unlocked, 'شوارب انفتحت بالإعلان الثاني');
last = await ad('unlock', 'face:mustache');
check(!!last.error, 'ما تكدر تفتح غرض عندك');
last = await ad('unlock', 'skin:14');
check(!!last.error, 'غرض الباس ما ينفتح بإعلان');

// ---------------- جرّب قبل تشتري
last = await ad('trial', 'head:crown');
const until = last.profile && last.profile.owned['head:crown'];
check(until && until > Date.now() + 23 * 3600000, 'التاج للتجربة 24 ساعة');
last = await api('/api/shop/equip', { slot: 'head', item: 'head:crown' });
check(last.ok && last.profile.equip.head === 'head:crown', 'لبس التاج (تجربة)');
last = await api('/api/shop/equip', { slot: 'face', item: 'face:mustache' });
check(last.ok && last.profile.equip.face === 'face:mustache', 'لبس الشوارب');
last = await api('/api/shop/equip', { slot: 'head', item: 'head:horns' });
check(last.error, 'ما يلبس شي ما يملكه');
last = await api('/api/shop/equip', { slot: 'face', item: 'head:party' });
check(last.error, 'ما يلبس قبعة بخانة الوجه');

// ---------------- شراء
last = await api('/api/shop/buy', { item: 'stage:neon' });
check(last.error && last.profile.mics === m0 + 100, 'مايكات ما تكفي للنيون');
last = await api('/api/shop/buy', { item: 'skin:15' });
check(last.error, 'شخصية الباس مو للبيع');
const mBuy = last.profile.mics;
last = await api('/api/shop/buy', { item: 'face:clown' });
if (mBuy >= 120) {
  check(last.ok && last.profile.mics === mBuy - 120 && last.profile.owned['face:clown'] === 0, 'شراء خشم المهرج بـ120');
  last = await api('/api/shop/buy', { item: 'face:clown' });
  check(last.error, 'ما يشتري نفس الغرض مرتين');
} else check(last.error && last.need === 120 - mBuy, `ما يكفي للمهرج (ناقص ${last.need})`);

// ---------------- صندوق يومي + الباس بإعلان + المضاعفة
last = await ad('box');
check(last.result && (last.result.mics || last.result.item || last.result.pass), `الصندوق اليومي: ${JSON.stringify(last.result)}`);
last = await ad('box');
check(!!last.error, 'صندوق ثاني بنفس اليوم مرفوض');
for (let i = 0; i < 3; i++) last = await ad('pass');
check(last.result && last.result.pass && last.profile.daily.pass === 0 && last.profile.pass.xp >= 180, `الباس بالإعلانات: ${last.profile && last.profile.pass.xp} خبرة`);
last = await ad('pass');
check(!!last.error, 'الإعلان الرابع للباس مرفوض');
me = await api('/api/me');
if (me.profile.lastGame && me.profile.lastGame.canDouble) {
  const before = me.profile.mics;
  last = await ad('double');
  check(last.result && last.result.mics === me.profile.lastGame.mics && last.profile.mics === before + me.profile.lastGame.mics, `ضاعف مايكات آخر لعبة (+${me.profile.lastGame.mics})`);
  last = await ad('double');
  check(!!last.error, 'ما تتضاعف نفس اللعبة مرتين');
} else {
  last = await ad('double');
  check(!!last.error, 'ماكو لعبة تضاعفها');
}

// ---------------- رابط مكافأة AdsGram بدون مفتاح
let r = await fetch(BASE + `/api/adsgram/reward?userid=${UID}&key=wrong`);
check(r.status === 403, 'رابط مكافأة AdsGram يرفض بدون مفتاح صحيح');

// ---------------- الرويال باس المميز بالنجوم
const season = seasonOf();
last = await api('/api/pass/invoice');
let inv = await lastCall('createInvoiceLink');
check(last.ok && /^https:\/\/t\.me\/\$invoice_/.test(last.link) && inv.currency === 'XTR' && inv.prices[0].amount === 99 && inv.payload === `pass:t${UID}:${season}` && inv.provider_token === '', 'فاتورة 99⭐ (XTR) من التطبيق');
const payload = `pass:t${UID}:${season}`;
await update({ pre_checkout_query: { id: 'pcq1', from: { id: UID, first_name: 'Eco' }, currency: 'XTR', total_amount: 99, invoice_payload: payload } });
await wait(300);
let pc = await lastCall('answerPreCheckoutQuery');
check(pc && pc.pre_checkout_query_id === 'pcq1' && pc.ok === true, 'الموافقة على الدفع (pre_checkout)');
await update({ pre_checkout_query: { id: 'pcq2', from: { id: UID + 1, first_name: 'X' }, currency: 'XTR', total_amount: 99, invoice_payload: payload } });
await wait(300);
pc = await lastCall('answerPreCheckoutQuery');
check(pc && pc.pre_checkout_query_id === 'pcq2' && pc.ok === false, 'فاتورة لاعب ثاني مرفوضة');
await update({ pre_checkout_query: { id: 'pcq3', from: { id: UID, first_name: 'Eco' }, currency: 'XTR', total_amount: 5, invoice_payload: payload } });
await wait(300);
pc = await lastCall('answerPreCheckoutQuery');
check(pc && pc.ok === false, 'سعر غلط مرفوض');
const charge = 'stxCHARGE' + Date.now();
const paid = { currency: 'XTR', total_amount: 99, invoice_payload: payload, telegram_payment_charge_id: charge, provider_payment_charge_id: '' };
await update(msg({ id: UID, first_name: 'Eco' }, undefined, { successful_payment: paid }));
await wait(400);
me = await api('/api/me');
let sent = (await calls()).filter((x) => x.method === 'sendMessage' && x.payload.chat_id === UID).pop();
check(me.profile.pass.premium && me.profile.pass.cap === 100 && sent && sent.payload.text.includes('تفعّل'), 'بعد الدفع: الباس مميز (100 لفل) ورسالة تأكيد');
const adminMsg = (await calls()).filter((x) => x.method === 'sendMessage' && String(x.payload.chat_id) === '42').pop();
check(adminMsg && adminMsg.payload.text.includes('/refund ' + charge), 'الأدمن توصله الدفعة ويا أمر الاسترجاع');
await update(msg({ id: UID, first_name: 'Eco' }, undefined, { successful_payment: paid }));
await wait(300);
sent = (await calls()).filter((x) => x.method === 'sendMessage' && x.payload.chat_id === UID).pop();
check(sent.payload.text.includes('مفعّل عندك'), 'نفس الدفعة مرتين ما تنحسب مرتين');
await update({ pre_checkout_query: { id: 'pcq4', from: { id: UID, first_name: 'Eco' }, currency: 'XTR', total_amount: 99, invoice_payload: payload } });
await wait(300);
pc = await lastCall('answerPreCheckoutQuery');
check(pc && pc.ok === false && /عندك/.test(pc.error_message), 'ما يشتري الباس مرتين بنفس الموسم');
last = await api('/api/pass/invoice');
check(last.error, 'التطبيق ما يطلع فاتورة إذا عنده الباس');

// /refund من الأدمن
await update(msg({ id: 42, first_name: 'Omar' }, '/refund ' + charge));
await wait(400);
const rf = await lastCall('refundStarPayment');
me = await api('/api/me');
check(rf && rf.telegram_payment_charge_id === charge && rf.user_id === UID && !me.profile.pass.premium, '/refund يرجّع النجوم ويلغي الباس');

// /pass و/terms و/paysupport
await update(msg({ id: UID, first_name: 'Eco' }, '/pass'));
await wait(400);
inv = await lastCall('sendInvoice');
check(inv && inv.chat_id === UID && inv.currency === 'XTR' && inv.prices[0].amount === 99, '/pass بالخاص يدز فاتورة نجوم');
await update(msg({ id: UID, first_name: 'Eco' }, '/terms'));
await wait(300);
sent = (await calls()).filter((x) => x.method === 'sendMessage' && x.payload.chat_id === UID).pop();
check(sent && sent.payload.text.includes('شروط'), '/terms');
await update(msg({ id: UID, first_name: 'Eco' }, '/paysupport دفعت وما تفعّل'));
await wait(400);
const sup = (await calls()).filter((x) => x.method === 'sendMessage' && String(x.payload.chat_id) === '42').pop();
check(sup && sup.payload.text.includes('دفعت وما تفعّل'), '/paysupport يوصل للأدمن');

// ---------------- الشكل بالغرفة
const { code } = await api('/api/rooms');
const st = await new Promise((resolve) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + `/ws/${code}?a=${encodeURIComponent(initData)}`);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'state') {
      resolve(m.st);
      ws.close();
    }
  };
  setTimeout(() => resolve(null), 5000);
});
const p = st && st.players.find((x) => x.uid === 't' + UID);
check(p && p.acc && p.acc.head === 'head:crown' && p.acc.face === 'face:mustache' && p.lvl >= 1 && st.stage === 'stage:classic', `الغرفة تشوف لبسه: ${JSON.stringify(p && p.acc)} لفل ${p && p.lvl}`);

console.log(`\n${ok} نجح، ${bad} فشل`);
process.exit(bad ? 1 : 0);
