// اختبار البوت والتحقق من initData مقابل خادم تيليجرام وهمي (tools/mock-tg.mjs).
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8790';
const TOKEN = process.env.TOKEN || '123456:TEST-token_abcdefghijklmnop';
const secret = createHmac('sha256', TOKEN).update('qallidha-webhook').digest('hex').slice(0, 48);
let ok = 0;
let bad = 0;
const check = (cond, label) => {
  if (cond) ok++;
  else bad++;
  console.log(cond ? '✅' : '❌', label);
};

let uid = 1000;
async function update(message) {
  const r = await fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ update_id: ++uid, message: { message_id: uid, date: Math.floor(Date.now() / 1000), ...message } }),
  });
  return r.status;
}
async function callback(from, data, messageId = 777) {
  const r = await fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({
      update_id: ++uid,
      callback_query: { id: 'cb' + uid, from, data, message: { message_id: messageId, chat: { id: from.id, type: 'private' }, date: 0 } },
    }),
  });
  return r.status;
}
const calls = async () => (await fetch(MOCK + '/__calls')).json();
const lastCall = async (method) => {
  const c = (await calls()).filter((x) => x.method === method);
  return c[c.length - 1] && c[c.length - 1].payload;
};
const health = async () => (await fetch(BASE + '/api/health')).json();
const lastSend = async () => {
  const c = (await calls()).filter((x) => x.method === 'sendMessage');
  return c[c.length - 1] && c[c.length - 1].payload;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = { id: 42, first_name: 'Omar', is_bot: false };
const user = { id: 99, first_name: 'Ali', is_bot: false };
const pchat = (u) => ({ id: u.id, type: 'private', first_name: u.first_name });
const group = { id: -100123, type: 'supergroup', title: 'OPBR' };

// webhook بلا سر
const forb = await fetch(BASE + '/api/telegram/webhook', { method: 'POST', body: '{}' });
check(forb.status === 403, 'webhook يرفض بدون secret');

// مكتبة الميمز: تنزل لوحدها بعد أول طلب (من myinstants الوهمي)، وصوت «bruh» صفحته مكسورة
let lib = null;
for (let i = 0; i < 120; i++) {
  lib = (await health()).library;
  if (lib && !lib.running && lib.pending === 0) break;
  await wait(500);
}
check(lib && lib.ready === lib.total - 1 && lib.failed === 1 && lib.on === lib.ready, `مكتبة الميمز نزلت لوحدها (${lib && lib.ready}/${lib && lib.total}، فشل ${lib && lib.failed})`);
await wait(300);
const libMsg = (await calls()).filter((x) => x.method === 'sendMessage' && x.payload.chat_id === '42' && x.payload.text.includes('مكتبة الميمز')).pop();
check(libMsg && libMsg.payload.text.includes(`انضاف للعبة ${lib.ready} صوت`) && libMsg.payload.text.includes('ما نزلت (1)'), 'الأدمن توصله رسالة بعدد الأصوات اللي انضافت واللي فشلت');
let lf = await fetch(BASE + '/lib/omae-wa-mou-shindeiru-nani-494.mp3');
const lfb = new Uint8Array(await lf.arrayBuffer());
check(lf.status === 200 && lf.headers.get('content-type') === 'audio/mpeg' && lfb.length > 1000 && /immutable/.test(lf.headers.get('cache-control') || ''), `/lib يخدم صوت المكتبة (${lfb.length} bytes)`);
lf = await fetch(BASE + '/lib/bruh.mp3');
const lf2 = await fetch(BASE + '/lib/not-in-the-list.mp3');
check(lf.status === 404 && lf2.status === 404, '/lib: الصوت اللي فشل أو مو بالقائمة = 404');

await update({ from: admin, chat: pchat(admin), text: '/start' });
await wait(400);
let m = await lastSend();
check(m && m.text.includes('قلّدها') && m.reply_markup.inline_keyboard[0][0].web_app, '/start بالخاص: رسالة ترحيب + زر web_app');

await update({ from: admin, chat: pchat(admin), text: '/id' });
await wait(300);
m = await lastSend();
check(m && m.text.includes('42') && m.text.includes('أدمن'), '/id يعرض الآيدي ويعرف الأدمن');

await update({ from: admin, chat: pchat(admin), voice: { file_id: 'FILEID_voice_0123456789abcdef', duration: 2, file_size: 4800 }, caption: 'ميم البزونة' });
await wait(400);
m = await lastSend();
check(m && m.text.includes('انضاف الصوت #1') && m.text.includes('ميم البزونة'), 'الأدمن يضيف فويس');

await update({ from: admin, chat: pchat(admin), photo: [{ file_id: 'small', width: 90, height: 90 }, { file_id: 'FILEID_photo_0123456789abcdef', width: 320, height: 240 }] });
await wait(300);
m = await lastSend();
check(m && m.text.includes('انضافت الصورة'), 'صورة للصوت');

await update({ from: admin, chat: pchat(admin), text: '/sounds' });
await wait(300);
m = await lastSend();
const kb = (m && m.reply_markup && m.reply_markup.inline_keyboard) || [];
check(
  m && kb[0] && kb[0][0].text.includes('✅') && kb[0][0].text.includes('🖼️') && kb[0][0].callback_data === 't|c:1|0' && kb[0][1].callback_data === 'd|c:1|0',
  '/sounds: قائمة بأزرار (صوتك أول مع الصورة + زر حذف)',
);
check(kb.some((row) => row[0] && /^ba\|0\|/.test(row[0].callback_data)), '/sounds: زر تعطيل كل أصوات النظام');
const builtinKey = kb.map((row) => row[0].callback_data.split('|')[1]).find((k) => k.startsWith('m:') || k.startsWith('b:'));
let h0 = await health();
check(m.text.includes(`✅ الأصوات الفعّالة باللعبة: ${h0.soundsActive}`) && h0.soundsActive === h0.builtinOn + h0.library.on + h0.sounds, `/sounds يكول كم صوت فعّال (${h0.soundsActive})`);
check(kb.some((row) => row[0] && row[0].callback_data === 'lr||0'), '/sounds: زر «أعد تحميل» للأصوات اللي ما نزلت');

// تعطيل صوت واحد بالزر
await callback(admin, `t|${builtinKey}|0`);
await wait(400);
let h1 = await health();
let edit = await lastCall('editMessageText');
let ans = await lastCall('answerCallbackQuery');
check(h1.soundsActive === h0.soundsActive - 1 && edit && edit.message_id === 777 && ans && ans.text.includes('انعطل'), `زر يعطّل صوت (${h0.soundsActive}→${h1.soundsActive}) ويحدّث الرسالة`);
await callback(admin, `t|${builtinKey}|0`);
await wait(400);
check((await health()).soundsActive === h0.soundsActive, 'نفس الزر يرجّعه');

// غير الأدمن: /sounds يعطي العدد بس
await update({ from: user, chat: pchat(user), text: '/sounds' });
await wait(300);
m = await lastSend();
check(m && m.chat_id === 99 && m.text.includes(`الأصوات الفعّالة باللعبة: ${h0.soundsActive}`) && !m.reply_markup, '/sounds لغير الأدمن: عدد الأصوات الفعّالة بس');

// غير الأدمن ما يكدر
await callback(user, `ba|0|0`);
await wait(300);
ans = await lastCall('answerCallbackQuery');
check(ans && ans.text.includes('بس الأدمن') && (await health()).soundsActive === h0.soundsActive, 'غير الأدمن ما يكدر يعدّل الأصوات');

// تعطيل كل أصوات النظام ثم إرجاعها
await callback(admin, 'ba|0|0');
await wait(400);
let hz = await health();
check(hz.builtinOn === 0 && hz.library.on === 0 && hz.soundsActive === hz.sounds, 'زر يعطّل كل أصوات النظام والمكتبة');
await callback(admin, 'ba|1|0');
await wait(400);
check((await health()).soundsActive === h0.soundsActive, 'زر يرجّع كل أصوات النظام والمكتبة');

// إعادة تحميل اللي فشلت (تبقى فاشلة لأن صفحتها مكسورة بالخادم الوهمي)
await callback(admin, 'lr||0');
await wait(400);
ans = await lastCall('answerCallbackQuery');
for (let i = 0; i < 40; i++) {
  lib = (await health()).library;
  if (!lib.running && lib.pending === 0) break;
  await wait(300);
}
check(ans && ans.text.includes('جاري التحميل') && lib.failed === 1 && lib.ready === lib.total - 1, 'زر «أعد تحميل» يعيد المحاولة');

await update({ from: user, chat: pchat(user), voice: { file_id: 'FILEID_voice_x', duration: 2 } });
await wait(300);
m = await lastSend();
check(m && m.text.includes('بس الأدمن'), 'غير الأدمن ما يكدر يضيف');

await update({ from: user, chat: group, text: '/play@qallidha_test_bot' });
await wait(500);
m = await lastSend();
const btn = m && m.reply_markup && m.reply_markup.inline_keyboard[0][0];
check(m && /الغرفة: \d{5}/.test(m.text) && btn && /^https:\/\/t\.me\/qallidha_test_bot\?startapp=r\d{5}$/.test(btn.url), '/play بالكروب: غرفة + رابط startapp');

await update({ from: user, chat: group, text: '/top' });
await wait(300);
m = await lastSend();
check(m && m.text.includes('🏆'), '/top');

await update({ from: admin, chat: pchat(admin), text: '/title 1 قطة غاضبة' });
await wait(300);
m = await lastSend();
check(m && m.text.includes('تغيّر'), '/title');

// بروكسي ملفات تيليجرام
const f = await fetch(BASE + '/tgfile/FILEID_voice_0123456789abcdef');
const fb = new Uint8Array(await f.arrayBuffer());
check(f.status === 200 && f.headers.get('content-type') === 'audio/ogg' && fb[0] === 0x4f && fb.length > 1000, `/tgfile يخدم الفويس (${fb.length} bytes, ${f.headers.get('content-type')})`);
const f404 = await fetch(BASE + '/tgfile/FILEID_doesnotexist_00000000');
check(f404.status === 404, '/tgfile ملف غير موجود = 404');

// initData
function signInitData(userObj, token, extra = {}) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAH', user: JSON.stringify(userObj), ...extra });
  const pairs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', key).update(pairs).digest('hex'));
  return p.toString();
}
const good = signInitData({ id: 42, first_name: 'Omar', last_name: 'J', username: 'omar' }, TOKEN, { start_param: 'r12345' });
let r = await fetch(BASE + '/api/me', { method: 'POST', body: JSON.stringify({ initData: good }) });
let j = await r.json();
check(r.status === 200 && j.user.uid === 't42' && j.user.name === 'Omar J' && j.user.startParam === 'r12345', 'initData صحيح مقبول');
const tampered = good.replace('Omar', 'Hack');
r = await fetch(BASE + '/api/me', { method: 'POST', body: JSON.stringify({ initData: tampered }) });
check(r.status === 401, 'initData معدّل مرفوض');
const old = signInitData({ id: 42, first_name: 'Omar' }, TOKEN, { auth_date: String(Math.floor(Date.now() / 1000) - 90000) });
r = await fetch(BASE + '/api/me', { method: 'POST', body: JSON.stringify({ initData: old }) });
check(r.status === 401, 'initData قديم مرفوض');

// غرفة بهوية تيليجرام عبر WebSocket
r = await fetch(BASE + '/api/rooms', { method: 'POST', body: JSON.stringify({ initData: good }) });
const { code } = await r.json();
const hello = await new Promise((resolve) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + `/ws/${code}?a=${encodeURIComponent(good)}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.t === 'state') {
      resolve(msg);
      ws.close();
    }
  };
  ws.onerror = () => resolve(null);
  setTimeout(() => resolve(null), 5000);
});
check(hello && hello.st.players[0].uid === 't42' && hello.st.host === 't42', 'دخول غرفة بهوية تيليجرام');

const wsBad = await new Promise((resolve) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + `/ws/${code}?a=${encodeURIComponent(tampered)}`);
  ws.onopen = () => resolve('opened');
  ws.onerror = () => resolve('rejected');
  setTimeout(() => resolve('timeout'), 4000);
});
check(wsBad === 'rejected', 'WebSocket بهوية مزوّرة مرفوض');

// الدخول بكود غرفة غير موجودة: لا تنخلق غرفة
r = await fetch(BASE + '/api/rooms/99999');
j = await r.json();
check(r.status === 200 && j.exists === false, 'GET /api/rooms/99999 → غير موجودة');
r = await fetch(BASE + `/api/rooms/${code}`);
j = await r.json();
check(j.exists === true && j.phase === 'lobby', 'GET /api/rooms/<كود موجود> → موجودة بغرفة الانتظار');
const nf = await new Promise((resolve) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + `/ws/99998?a=${encodeURIComponent(good)}`);
  let err = null;
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.t === 'error') err = msg.code;
    if (msg.t === 'state') resolve('state');
  };
  ws.onclose = () => resolve(err || 'closed');
  ws.onerror = () => resolve(err || 'error');
  setTimeout(() => resolve(err || 'timeout'), 5000);
});
r = await fetch(BASE + '/api/rooms/99998');
j = await r.json();
check(nf === 'notfound' && j.exists === false, `WebSocket لغرفة غير موجودة → notfound (${nf}) وما تنخلق`);

// حذف صوتك نهائيًا بالزر
await callback(admin, 'd|c:1|0');
await wait(400);
ans = await lastCall('answerCallbackQuery');
await update({ from: admin, chat: pchat(admin), text: '/sounds' });
await wait(300);
m = await lastSend();
check(ans && ans.text.includes('انحذف') && !m.reply_markup.inline_keyboard.some((row) => row[0].callback_data === 't|c:1|0'), 'زر 🗑️ يحذف صوتك نهائيًا');

console.log(`\n${ok} نجح، ${bad} فشل`);
process.exit(bad ? 1 : 0);
