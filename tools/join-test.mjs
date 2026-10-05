// اختبار إشعار «لاعب جديد» للأدمن، ولغة البوت (عربي/روسي/إنكليزي)، وفواتير الإنكليزي، وأوامر البوت بكل لغة.
// التشغيل: npx wrangler dev + node tools/mock-tg.mjs ثم: node tools/join-test.mjs   (الأدمن بـ.dev.vars = 42)
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8790';
const TOKEN = process.env.TOKEN || '123456:TEST-token_abcdefghijklmnop';
const ADMIN = String(process.env.ADMIN || '42');
const secret = createHmac('sha256', TOKEN).update('qallidha-webhook').digest('hex').slice(0, 48);
const base = Number(process.env.JOIN_UID || 300000 + Math.floor(Math.random() * 600000));
let ok = 0;
let bad = 0;
const check = (cond, label) => {
  if (cond) ok++;
  else bad++;
  console.log(cond ? '✅' : '❌', label);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function sign(user, extra = {}) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAjoin', user: JSON.stringify(user), ...extra });
  const pairs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(pairs).digest('hex'));
  return p.toString();
}
const me = (user, extra = {}, lang = '') =>
  fetch(BASE + '/api/me', { method: 'POST', body: JSON.stringify({ initData: sign(user, extra), lang }) }).then((r) => r.json());
let upd = 500000 + Math.floor(Math.random() * 100000);
async function update(message) {
  const r = await fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ update_id: ++upd, message: { message_id: upd, date: Math.floor(Date.now() / 1000), ...message } }),
  });
  return r.status;
}
const calls = async () => (await fetch(MOCK + '/__calls')).json();
const sends = async () => (await calls()).filter((x) => x.method === 'sendMessage');
const joinsFor = async (id) => (await sends()).filter((x) => String(x.payload.chat_id) === ADMIN && /لاعب جديد/.test(x.payload.text) && x.payload.text.includes(`<code>${id}</code>`));
const replyTo = async (id) => (await sends()).filter((x) => x.payload.chat_id === id).pop();
const pchat = (u) => ({ id: u.id, type: 'private', first_name: u.first_name });
const adminUser = { id: Number(ADMIN), first_name: 'Omar', is_bot: false };

// نبدي بنافذة نظيفة للإشعارات (لا تكون مليانة من اختبارات قبل)
await update({ from: adminUser, chat: pchat(adminUser), text: '/newusers on' });
await wait(400);

// 1) أول مرة يفتح اللعبة (من رابط دعوة): إشعار بكل المعلومات
const u1 = { id: base + 1, first_name: 'John', last_name: 'Doe <b>', username: 'johnny', language_code: 'en', is_premium: true };
const r1 = await me(u1, { start_param: 'r12345', chat_type: 'sender' }, 'en');
check(r1.user && r1.user.uid === 't' + u1.id, 'فتح اللعبة');
await wait(700);
let n1 = await joinsFor(u1.id);
check(n1.length === 1, `وصل إشعار «لاعب جديد» للأدمن (${n1.length})`);
const p1 = n1[0] ? n1[0].payload : {};
check(p1.parse_mode === 'HTML' && p1.text.includes(`tg://user?id=${u1.id}`) && p1.text.includes('@johnny'), 'بيه رابط الحساب واليوزر');
check(p1.text && p1.text.includes('Doe &lt;b&gt;') && !p1.text.includes('<b>'), 'الاسم متأمّن (HTML)');
check(p1.text && p1.text.includes('اللغة: en') && p1.text.includes('بريميوم') && p1.text.includes('رابط دعوة لغرفة 12345') && /رقم \d+/.test(p1.text), 'اللغة والبريميوم ومنين دخل ورقمه');
check(p1.text && /🕒 \d\d\/\d\d\/\d{4}, \d\d:\d\d/.test(p1.text), `الوقت: ${(p1.text || '').split('\n').pop()}`);

// 2) يفتحها مرة ثانية: ماكو إشعار ثاني
await me(u1);
await update({ from: { ...u1, is_bot: false }, chat: pchat(u1), text: '/start' });
await wait(700);
check((await joinsFor(u1.id)).length === 1, 'المرة الثانية (لعبة أو بوت): ماكو إشعار ثاني');

// 3) أول مرة يدخل البوت (/start) — روسي: الإشعار + الرد بالروسي + زر القائمة بالروسي
const u2 = { id: base + 2, first_name: 'Иван', language_code: 'ru', is_bot: false };
await update({ from: u2, chat: pchat(u2), text: '/start' });
await wait(800);
const n2 = await joinsFor(u2.id);
check(n2.length === 1 && n2[0].payload.text.includes('/start بالبوت') && n2[0].payload.text.includes('اللغة: ru'), 'دخل البوت أول مرة: إشعار (/start بالبوت)');
let rep = await replyTo(u2.id);
check(rep && /Привет, Иван/.test(rep.payload.text) && rep.payload.reply_markup.inline_keyboard[0][0].text === '🎮 Играть', `ترحيب بالروسي: ${rep && rep.payload.text.split('\n')[0]}`);
const mb = (await calls()).filter((x) => x.method === 'setChatMenuButton' && x.payload.chat_id === u2.id).pop();
check(mb && mb.payload.menu_button.text === '🎮 Играть', 'زر القائمة بالروسي');

// 4) إنكليزي
const u3 = { id: base + 3, first_name: 'Sam', language_code: 'en-GB', is_bot: false };
await update({ from: u3, chat: pchat(u3), text: '/start r54321' });
await wait(800);
rep = await replyTo(u3.id);
check(rep && /^🎤 Hi Sam!/.test(rep.payload.text) && rep.payload.reply_markup.inline_keyboard[0][0].text === '🎮 Play now', `ترحيب بالإنكليزي: ${rep && rep.payload.text.split('\n')[0]}`);
check(!rep.payload.text.includes('\u200f'), 'الإنكليزي بدون علامات RTL');
check((await joinsFor(u3.id)).some((x) => x.payload.text.includes('رابط دعوة لغرفة 54321')), 'الإشعار يكول دخل من رابط دعوة');
await update({ from: u3, chat: pchat(u3), text: '/help' });
await wait(500);
rep = await replyTo(u3.id);
check(rep && rep.payload.text.includes('/play — create a game room') && !rep.payload.text.includes('أوامر الأدمن'), '/help بالإنكليزي وبدون أوامر الأدمن');

// 5) تيليجرامه إنكليزي بس اللعبة عربي (محفوظة): البوت يحچي عربي
const u4 = { id: base + 4, first_name: 'Ali', language_code: 'en', is_bot: false };
await me(u4, {}, 'ar');
await update({ from: u4, chat: pchat(u4), text: '/terms' });
await wait(500);
rep = await replyTo(u4.id);
check(rep && rep.payload.text.includes('شروط «قلّدها»'), 'لغة اللعبة المحفوظة تغلب لغة تيليجرام');
await me(u4, {}, 'ru');
await update({ from: u4, chat: pchat(u4), text: '/terms' });
await wait(500);
rep = await replyTo(u4.id);
check(rep && rep.payload.text.includes('Условия'), 'غيّر لغة اللعبة لروسي: البوت صار روسي');

// 6) فاتورة بالإنكليزي
const inv = await fetch(BASE + '/api/stars/invoice', { method: 'POST', body: JSON.stringify({ initData: sign(u1), sku: 'mics300', lang: 'en' }) }).then((r) => r.json());
const link = (await calls()).filter((x) => x.method === 'createInvoiceLink').pop();
check(inv.ok && link && link.payload.title === '300 mics 🎤' && /Copy That/.test(link.payload.description), `فاتورة بالإنكليزي: «${link && link.payload.title}»`);

// 7) /newusers يطفي ويشغّل
await update({ from: adminUser, chat: pchat(adminUser), text: '/newusers off' });
await wait(500);
rep = await replyTo(Number(ADMIN));
check(rep && rep.payload.text.includes('مطفي') && /كل اللاعبين: \d+/.test(rep.payload.text), `/newusers off: ${rep && rep.payload.text.split('\n')[0]}`);
const u5 = { id: base + 5, first_name: 'Quiet' };
await me(u5);
await wait(600);
check((await joinsFor(u5.id)).length === 0, 'مطفي: ماكو إشعار');
await update({ from: adminUser, chat: pchat(adminUser), text: '/newusers' });
await wait(500);
rep = await replyTo(Number(ADMIN));
check(rep && rep.payload.text.includes('شغّال'), '/newusers مرة ثانية يرجّعه');
const u6 = { id: base + 6, first_name: 'Loud' };
await me(u6);
await wait(600);
check((await joinsFor(u6.id)).length === 1, 'رجع يوصل الإشعار');

// 8) زحمة: أكثر من 12 بالدقيقة → الزايد ينجمع بإشعار وحد بعدين
const burst = Array.from({ length: 14 }, (_, i) => ({ id: base + 100 + i, first_name: 'B' + i }));
for (const u of burst) await me(u);
await wait(1200);
const got = (await Promise.all(burst.map((u) => joinsFor(u.id)))).filter((x) => x.length).length;
check(got < burst.length && got > 0, `زحمة: وصل ${got} من ${burst.length} بس`);
if (process.env.SLOW !== '0') {
  console.log('… ننتظر دقيقة حتى تتجدد النافذة');
  await wait(61000);
  const u7 = { id: base + 7, first_name: 'After' };
  await me(u7);
  await wait(700);
  const n7 = await joinsFor(u7.id);
  check(n7.length === 1 && /➕ وقبله \d+ لاعب جديد ما وصلك إشعارهم/.test(n7[0].payload.text), 'بعد الدقيقة: الإشعار الجاي يذكر اللي ما وصل');
}

// 9) أوامر البوت بكل لغة (بعد /api/setup)
await fetch(BASE + '/api/setup');
await wait(300);
const cmds = (await calls()).filter((x) => x.method === 'setMyCommands');
const langs = new Set(cmds.map((x) => x.payload.language_code || 'default'));
check(['default', 'ru', 'en'].every((l) => langs.has(l)), `أوامر البوت بالعربي والروسي والإنكليزي (${[...langs].join(',')})`);

console.log(`\n${ok} نجح، ${bad} فشل`);
process.exit(bad ? 1 : 0);
