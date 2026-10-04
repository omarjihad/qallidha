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
const calls = async () => (await fetch(MOCK + '/__calls')).json();
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
check(m && m.text.includes('#1') && m.text.includes('🖼️'), '/sounds يعرض الصوت مع الصورة');

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

await update({ from: admin, chat: pchat(admin), text: '/del 1' });
await wait(300);
m = await lastSend();
check(m && m.text.includes('انحذف'), '/del');

console.log(`\n${ok} نجح، ${bad} فشل`);
process.exit(bad ? 1 : 0);
