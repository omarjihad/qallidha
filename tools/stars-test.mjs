// اختبار الشراء بالنجوم: باقات المايكات، لفلات الباس، المميز+، حدود الباس، الاسترجاع، ورسائل البوت بالروسي.
// التشغيل: npx wrangler dev + node tools/mock-tg.mjs ثم: STARS_UID=<رقم جديد> node tools/stars-test.mjs
import { createHmac } from 'node:crypto';
import { seasonOf, PASS } from '../public/js/catalog.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8790';
const TOKEN = process.env.TOKEN || '123456:TEST-token_abcdefghijklmnop';
const UID = Number(process.env.STARS_UID || 730000 + Math.floor(Math.random() * 60000));
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
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAst', user: JSON.stringify(user) });
  const pairs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(pairs).digest('hex'));
  return p.toString();
}
const from = { id: UID, first_name: 'Звезда', language_code: 'ru' };
const initData = signInitData(from);
const api = async (path, body = {}) => {
  const r = await fetch(BASE + path, { method: 'POST', body: JSON.stringify({ initData, ...body }) });
  return { status: r.status, ...(await r.json()) };
};
const calls = async () => (await fetch(MOCK + '/__calls')).json();
const lastCall = async (method) => {
  const c = (await calls()).filter((x) => x.method === method);
  return c[c.length - 1] && c[c.length - 1].payload;
};
let seq = 70000 + Math.floor(Math.random() * 9000);
const update = (obj) =>
  fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ update_id: ++seq, ...obj }),
  });
const season = seasonOf();
const config = await (await fetch(BASE + '/api/config')).json();
const price = (sku) => config.packs.find((p) => p.sku === sku).stars;
check(Array.isArray(config.packs) && price('mics300') === 15 && price('lv5') === 45 && price('passplus') === config.passPrice + 70, `الأسعار من /api/config (المميز+ = ${price('passplus')})`);

/** فاتورة → موافقة → دفع. يرجع آخر رسالة للاعب */
async function buy(sku, { amount = null, payer = from, expectOk = true } = {}) {
  const r = await api('/api/stars/invoice', { sku, lang: 'ru' });
  if (!r.ok) return { invoiceError: r.error };
  const inv = await lastCall('createInvoiceLink');
  const pid = 'pcq' + ++seq;
  await update({ pre_checkout_query: { id: pid, from: payer, currency: 'XTR', total_amount: amount ?? inv.prices[0].amount, invoice_payload: inv.payload } });
  await wait(250);
  const pc = await lastCall('answerPreCheckoutQuery');
  if (!pc || pc.pre_checkout_query_id !== pid || !pc.ok) return { inv, pc };
  const charge = `ch-${sku}-${seq}`;
  await update({
    message: {
      message_id: ++seq,
      date: Math.floor(Date.now() / 1000),
      from: payer,
      chat: { id: payer.id, type: 'private' },
      successful_payment: { currency: 'XTR', total_amount: inv.prices[0].amount, invoice_payload: inv.payload, telegram_payment_charge_id: charge, provider_payment_charge_id: '' },
    },
  });
  await wait(350);
  const sent = (await calls()).filter((x) => x.method === 'sendMessage' && x.payload.chat_id === payer.id).pop();
  return { inv, pc, charge, sent: sent && sent.payload.text, expectOk };
}

let me = await api('/api/me');
const m0 = me.profile.mics;
check(me.profile.pass.level === 0 && !me.profile.pass.premium, `حساب جديد (${UID})`);

// ---------------- باقة مايكات
let b = await buy('mics300');
me = await api('/api/me');
check(b.inv && b.inv.currency === 'XTR' && b.inv.prices[0].amount === 15 && b.inv.payload === `st:t${UID}:mics300:${season}` && b.inv.provider_token === '', 'فاتورة 300 مايك = 15⭐');
check(/микрофонов/.test(b.inv.title), `عنوان الفاتورة بالروسي: «${b.inv && b.inv.title}»`);
check(me.profile.mics === m0 + 300, `+300 مايك (${me.profile.mics})`);
check(b.sent && /Зачислено 300/.test(b.sent) && !b.sent.includes('‏'), `رسالة البوت بالروسي وبدون RLM: «${(b.sent || '').split('\n')[0]}»`);
const admin = (await calls()).filter((x) => x.method === 'sendMessage' && String(x.payload.chat_id) === '42').pop();
check(admin && admin.payload.text.includes('300 مايك') && admin.payload.text.includes('/refund ' + b.charge), 'الأدمن توصله الدفعة واسمها وأمر الاسترجاع');

// نفس الدفعة مرتين
await update({
  message: {
    message_id: ++seq,
    date: Math.floor(Date.now() / 1000),
    from,
    chat: { id: UID, type: 'private' },
    successful_payment: { currency: 'XTR', total_amount: 15, invoice_payload: b.inv.payload, telegram_payment_charge_id: b.charge, provider_payment_charge_id: '' },
  },
});
await wait(300);
me = await api('/api/me');
check(me.profile.mics === m0 + 300, 'نفس الدفعة ما تنحسب مرتين');

// سعر غلط / دافع ثاني
b = await buy('mics700', { amount: 1 });
check(b.pc && b.pc.ok === false && /Цена/.test(b.pc.error_message), `سعر غلط مرفوض (بالروسي): ${b.pc && b.pc.error_message}`);
b = await buy('mics700', { payer: { id: UID + 1, first_name: 'X' } });
check(b.pc && b.pc.ok === false, 'دافع ثاني مرفوض');
b = await api('/api/stars/invoice', { sku: 'nope' });
check(b.status === 400, 'باقة مو موجودة = 400');

// ---------------- لفلات الباس
b = await buy('lv5');
me = await api('/api/me');
check(me.profile.pass.level === 5 && me.profile.pass.xp === 5 * PASS.xpPerLevel, `+5 لفلات باس → لفل ${me.profile.pass.level}`);
check(b.sent && /уровень 5/.test(b.sent), 'رسالة اللفلات بالروسي');
const micsAfter5 = me.profile.mics;
check(micsAfter5 > m0 + 300, `جوائز اللفلات انضافت (${micsAfter5 - m0 - 300} مايك)`);
await buy('lv25');
await buy('lv10');
await buy('lv10');
me = await api('/api/me');
check(me.profile.pass.level === 50, `المجاني يوصل 50 بالضبط (${me.profile.pass.level})`);
b = await buy('lv1');
check(b.invoiceError && /50/.test(b.invoiceError), `بعد 50 بدون مميز: الفاتورة ترفض («${b.invoiceError}»)`);

// ---------------- المميز + 10 لفلات
b = await buy('passplus');
me = await api('/api/me');
check(me.profile.pass.premium && me.profile.pass.level === 60, `المميز+ : مميز ولفل ${me.profile.pass.level}`);
const plusCharge = b.charge;
b = await api('/api/stars/invoice', { sku: 'passplus' });
check(b.error, 'المميز+ ما ينشرى مرتين بنفس الموسم');
b = await api('/api/pass/invoice', {});
check(b.error, 'الباس المميز ما ينشرى بعد المميز+');
b = await buy('lv25');
me = await api('/api/me');
check(me.profile.pass.level === 85, `بعد المميز: لفلات لحد 100 (${me.profile.pass.level})`);
b = await buy('lv25');
check(b.invoiceError && /уровней|باقة/.test(b.invoiceError + ''), `ما تعبر 100: «${b.invoiceError}»`);

// ---------------- الاسترجاع
const before = await api('/api/me');
await update({ message: { message_id: ++seq, date: Math.floor(Date.now() / 1000), from: { id: 42, first_name: 'Omar' }, chat: { id: 42, type: 'private' }, text: '/refund ' + plusCharge } });
await wait(400);
const rf = await lastCall('refundStarPayment');
me = await api('/api/me');
check(rf && rf.telegram_payment_charge_id === plusCharge && !me.profile.pass.premium && me.profile.pass.xp === before.profile.pass.xp - 10 * PASS.xpPerLevel, `/refund للمميز+ يلغي المميز ويسحب 10 لفلات (${me.profile.pass.level})`);
const refundMsg = (await calls()).filter((x) => x.method === 'sendMessage' && String(x.payload.chat_id) === '42').pop();
check(refundMsg && refundMsg.payload.text.includes('باس مميز + 10 لفلات'), 'رسالة الاسترجاع تكول شنو انسحب');

console.log(`\n${ok} نجح، ${bad} فشل`);
process.exit(bad ? 1 : 0);
