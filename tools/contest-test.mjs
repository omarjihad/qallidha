// اختبار مسابقة المتصدرين ولوحة المطوّر باللعبة (v1.7):
// الصلاحيات، نشر المسابقة (بداية ← تذكير بالوقت المتبقي)، النقاط (بس الألعاب اللي بيها لاعبين تيليجرام اثنين أو أكثر)،
// التعديل، النهاية والفائزين ورسائلهم، «انطيته»، إعلان الفائزين، الهدايا (مايكات، لفل، سكنات، باس، لفلات باس)،
// صندوق اللاعب (نافذة باللعبة مرة وحدة)، الحظر، الإذاعة النصية، الأصوات، المدفوعات والاسترجاع.
// التشغيل: npx wrangler dev --var BC_GAP_MS:300 + node tools/mock-tg.mjs ثم: node tools/contest-test.mjs
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { seasonOf, levelReward } from '../public/js/catalog.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8790';
const TOKEN = process.env.TOKEN || '123456:TEST-token_abcdefghijklmnop';
const ADMIN = Number(process.env.ADMIN || 42);
const secret = createHmac('sha256', TOKEN).update('qallidha-webhook').digest('hex').slice(0, 48);
let ok = 0;
let bad = 0;
const check = (cond, label) => {
  if (cond) ok++;
  else bad++;
  console.log(cond ? '✅' : '❌', label);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;

function sign(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAcst', user: JSON.stringify(user) });
  const pairs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(pairs).digest('hex'));
  return p.toString();
}
const post = async (path, user, body = {}) => {
  const auth = user ? { initData: sign(user) } : { guestId: 'cstguest' + Date.now(), guestName: 'Guest' };
  const r = await fetch(BASE + path, { method: 'POST', body: JSON.stringify({ ...auth, ...body }) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
let seq = 500000 + Math.floor(Math.random() * 100000);
async function hook(body) {
  const r = await fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ update_id: ++seq, ...body }),
  });
  return r.status;
}
const say = (u, text) => hook({ message: { message_id: ++seq, date: Math.floor(Date.now() / 1000), from: u, chat: { id: u.id, type: 'private', first_name: u.first_name }, text } });
const calls = async () => (await fetch(MOCK + '/__calls')).json();
const mark = async () => (await calls()).length;
const since = async (n) => (await calls()).slice(n);
const msgsTo = (cs, id) => cs.filter((x) => x.method === 'sendMessage' && Number(x.payload.chat_id) === Number(id) && !/لاعب جديد/.test(x.payload.text || ''));

const admin = { id: ADMIN, first_name: 'Omar', username: 'omar_dev', is_bot: false };
const B = (3000 + Math.floor(Math.random() * 3000)) * 1000;
const U = (k, name, lang = 'ar', username = '') => ({ id: B + k, first_name: name, language_code: lang, is_bot: false, ...(username ? { username } : {}) });
const u1 = U(21, 'Ahmed', 'ar', 'ahmed_' + (B % 100000));
const u2 = U(31, 'Sam', 'en');
const u3 = U(41, 'Ivan', 'ru');
const ublk = U(913, 'Gone'); // حاظر البوت (التيليجرام الوهمي يرفض رسائله)
const A = (op, args = {}) => post('/api/admin', admin, { op, ...args });

/** ننتظر الإذاعة تخلص */
async function bcDone(max = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const s = await A('bc.status');
    if (!s.bc) return true;
    await wait(300);
  }
  return false;
}

/** لعبة كاملة بالمحاكي: n بوتات بهوية تيليجرام (آيديات تبدي من base) */
function sim(n, base) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['tools/sim.mjs', String(n)], { env: { ...process.env, BASE, SIM_TG_TOKEN: TOKEN, SIM_TG_ID: String(base) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    const kill = setTimeout(() => p.kill('SIGKILL'), 240000);
    p.on('close', (code) => {
      clearTimeout(kill);
      const rewards = [...out.matchAll(/reward (\{.*\}|null)/g)].map((m) => JSON.parse(m[1]));
      resolve({ code, out, rewards });
    });
  });
}

// ---------------- البداية: الكل دخل البوت وفتح اللعبة
for (const u of [admin, u1, u2, u3, ublk]) await say(u, '/start');
for (const u of [admin, u1, u2, u3]) await post('/api/me', u);
await wait(500);

/* ================= 1) الصلاحيات */
{
  const r = await post('/api/admin', u1, { op: 'dash' });
  check(r.status === 403 && r.message === '⛔ هاي اللوحة للمطوّر بس', 'لاعب عادي: اللوحة ممنوعة (403)');
  const g = await post('/api/admin', null, { op: 'dash' });
  check(g.status === 403, 'ضيف: ممنوع');
  const f = await fetch(BASE + '/api/admin', { method: 'POST', body: JSON.stringify({ initData: sign(admin).replace(/hash=[0-9a-f]+/, 'hash=' + '0'.repeat(64)), op: 'dash' }) });
  check(f.status === 401 || f.status === 403, `توقيع مزوّر: ممنوع (${f.status})`);
  const d = await A('dash');
  check(d.ok && d.stats && d.stats.users >= 5 && d.contest, `الأدمن: الرئيسية (${d.stats && d.stats.users} لاعب)`);
  const me = await post('/api/me', admin);
  check(me.user && me.user.admin === true, 'الأدمن: /api/me يرجّع admin=true (زر 🛠️ يبين)');
  const me1 = await post('/api/me', u1);
  check(me1.user && me1.user.admin === false, 'اللاعب: admin=false');
  const x = await A('nope');
  check(x.status === 400 && x.error === 'أمر غلط', 'أمر غلط');
}

/* ================= 2) نشر المسابقة: البداية */
let c0 = await A('contest');
if (c0.contest && c0.contest.status === 'running') {
  await A('contest.cancel');
  c0 = await A('contest');
}
check(c0.ok && c0.preview && c0.preview.tpl === 'start' && /بدأت مسابقة المتصدرين/.test(c0.preview.text), 'ماكو مسابقة: المعاينة = «بدأت»');
{
  const pv = await A('contest.preview', { days: 3, prizes: [10, 5, 1] });
  check(pv.tpl === 'start' && /10 ⭐/.test(pv.text) && /تبقى (يومين و 23:5\d:\d\d|3 أيام و 00:00:00)/.test(pv.text), 'المعاينة تتغيّر بالمدة والجوائز');
}
let n = await mark();
let r = await A('contest.publish', { days: 7, prizes: [150, 75, 50] });
check(r.ok && r.tpl === 'start' && r.total >= 5, `📢 نشر ← بدت مسابقة جديدة وإذاعة لـ${r.total}`);
const cid = r.contest && r.contest.id;
check(r.contest && r.contest.status === 'running' && Math.abs(r.contest.end - r.contest.start - 7 * DAY) < 5000 && r.contest.prizes.join() === '150,75,50', 'المسابقة: أسبوع وجوائز 150/75/50');
check(await bcDone(), 'الإذاعة خلصت');
{
  const cs = await since(n);
  const m1 = msgsTo(cs, u1.id).find((x) => /بدأت مسابقة المتصدرين/.test(x.payload.text));
  check(m1 && /المركز الأول: 150 ⭐/.test(m1.payload.text) && /تبقى 6 أيام و 23:5\d:\d\d على انتهاء المسابقة/.test(m1.payload.text), 'العربي: «بدأت» + الجوائز + «تبقى 6 أيام و 23:59:xx»');
  const kb = m1 && m1.payload.reply_markup && m1.payload.reply_markup.inline_keyboard;
  check(kb && kb[0][0].web_app && /\/$/.test(kb[0][0].web_app.url) && kb[1][0].web_app && /\/\?view=contest$/.test(kb[1][0].web_app.url), 'أزرار: «العب هسه» + «شوف المتصدرين» (?view=contest)');
  const m2 = msgsTo(cs, u2.id).find((x) => /leaderboard contest has started/.test(x.payload.text));
  check(m2 && /1st place: 150 ⭐/.test(m2.payload.text) && m2.payload.reply_markup.inline_keyboard[0][0].text === '🎮 Play now', 'الإنكليزي بلغته');
  const m3 = msgsTo(cs, u3.id).find((x) => /Конкурс лидеров начался/.test(x.payload.text));
  check(m3 && /6 д 23:5\d:\d\d/.test(m3.payload.text), 'الروسي بلغته');
  const rep = msgsTo(cs, ADMIN).find((x) => /خلصت إذاعة بداية المسابقة/.test(x.payload.text));
  check(rep && /❌ ما وصلت: 1/.test(rep.payload.text), 'تقرير للأدمن: وصلت/ما وصلت (الحاظر = 1)');
  const u = await A('user', { uid: ublk.id });
  check(u.user && u.user.blocked === true, 'اللي حاظر البوت تعلّم (ما توصله الإذاعات الجاية)');
}
{
  const cfg = await (await fetch(BASE + '/api/config')).json();
  check(cfg.contest && cfg.contest.id === cid && cfg.contest.prizes.join() === '150,75,50' && cfg.contest.end > Date.now() + 6.9 * DAY && cfg.contest.now > 0, 'كارت القائمة: /api/config فيه المسابقة (الوقت والجوائز)');
  const v = await post('/api/contest', u1);
  check(v.contest && v.contest.status === 'running' && v.top.length === 0 && v.me && v.me.rank === null && v.contest.minPlayers === 2, 'المتصدرين: فارغ وترتيبي بعد ماكو');
  const me = await post('/api/me', u1, { inbox: true });
  check(me.contest && me.contest.id === cid && me.contest.end === cfg.contest.end && Array.isArray(me.inbox), 'رجعة القائمة: /api/me (inbox) يجيب المسابقة وياه بنفس الطلب');
  const me2 = await post('/api/me', u1);
  check(!('contest' in me2), 'بدون inbox ما يجيبها (طلبات أقل)');
}

/* ================= 3) نشر وهي شغّالة = تذكير بالوقت المتبقي (ومرتين ورا بعض = وحدة بس) */
n = await mark();
{
  const [a, b] = await Promise.all([A('contest.publish'), A('contest.publish')]);
  const good = [a, b].filter((x) => x.ok);
  const busy = [a, b].filter((x) => x.error);
  check(good.length === 1 && good[0].tpl === 'remind', 'منشورة من قبل ← كليشة تذكير');
  check(busy.length === 1 && /أكو إذاعة شغّالة/.test(busy[0].error), 'نشرتين بنفس الوقت: الثانية تنرفض (أكو إذاعة)');
  check(await bcDone(), 'إذاعة التذكير خلصت');
  const cs = await since(n);
  const m1 = msgsTo(cs, u1.id).find((x) => /مسابقة المتصدرين شغّالة/.test(x.payload.text));
  check(m1 && /تبقى 6 أيام و 23:5\d:\d\d/.test(m1.payload.text) && /بعد ماكو أحد بالتوب/.test(m1.payload.text), 'التذكير: الوقت المتبقي + «بعد ماكو أحد بالتوب»');
  check(msgsTo(cs, ublk.id).length === 0, 'الحاظر ما انبعثله (تعلّم من أول إذاعة)');
  const st = await A('contest');
  check(st.contest.pubs === 2 && st.contest.lastPub > 0, `انذاعت مرتين (pubs=${st.contest.pubs})`);
  const stale = await A('contest.publish', { expect: 'start', silent: true });
  check(!stale.ok && /أكو مسابقة شغّالة/.test(stale.error), 'زر «ابدي» من لوحة قديمة والمسابقة شغّالة: يرفض (ما تنعاد)');
  const wrong = await A('contest.publish', { expect: 'remind', cid: cid + 99 });
  check(!wrong.ok && /حدّث اللوحة/.test(wrong.error), 'تذكير لمسابقة ثانية: يرفض');
}

/* ================= 4) تعديل الجوائز والوقت */
{
  let e = await A('contest.edit', { prizes: [200, 100, 50] });
  check(e.ok && e.contest.prizes.join() === '200,100,50', 'تغيير الجوائز 200/100/50');
  e = await A('contest.edit', { end: Date.now() + 30000 });
  check(!e.ok && /بعد دقيقة/.test(e.error), 'نهاية بعد 30 ثانية: ترفض');
  const end2 = Date.now() + 2 * DAY;
  e = await A('contest.edit', { end: end2 });
  check(e.ok && Math.abs(e.contest.end - end2) < 2000, 'تقصير المسابقة ليومين');
}

/* ================= 5) النقاط: لعبة بلاعبين تيليجرام اثنين تنحسب، ولعبة وحدك لا */
const P = B + 500; // بوتات المحاكي: P و P+1
console.log('⏳ لعبة كاملة (لاعبين تيليجرام اثنين)…');
let g = await sim(2, P);
check(g.code === 0 && g.rewards.length === 2, `المحاكي خلص (${g.rewards.length} مكافآت)`);
check(
  g.rewards.every((x) => x && x.contest && x.contest.cid === cid && !x.contest.solo && x.contest.games === 1 && (x.contest.pts > 0 ? x.contest.rank >= 1 : true)),
  'مكافأة نهاية اللعبة فيها نقاط المسابقة وترتيبك',
);
{
  const pA = { id: P, first_name: 'بوت0' };
  const v = await post('/api/contest', pA);
  check(v.top.length === 2 && v.me && v.me.games === 1 && v.me.rank >= 1, `المتصدرين: لاعبين اثنين (ترتيبي #${v.me && v.me.rank})`);
  const pts = v.top.map((x) => x.points);
  check(pts[0] >= pts[1] && pts[1] > 0, `مرتبين بالنقاط (${pts.join(' ≥ ')})`);
}
console.log('⏳ لعبة وحدك (لاعب تيليجرام واحد)…');
g = await sim(1, B + 600);
check(g.rewards.length === 1 && g.rewards[0] && g.rewards[0].contest && g.rewards[0].contest.solo === true, 'لعبة وحدك: «اللعب وحدك ما ينحسب للمسابقة»');
{
  const v = await post('/api/contest', { id: B + 600, first_name: 'بوت0' });
  check(v.me && v.me.points === 0 && v.me.rank === null && v.top.length === 2, 'لعبة وحدك: ماكو نقاط ولا ترتيب');
  const ad = await A('contest');
  check(ad.top.length === 2 && ad.players.n === 2 && ad.players.g === 2, `اللوحة: ${ad.players.n} لاعب و${ad.players.g} لعبة بالمسابقة`);
}

/* ================= 6) الهدايا */
{
  const me0 = await post('/api/me', u1);
  const mics0 = me0.profile.mics;
  n = await mark();
  let x = await A('gift', { uid: u1.id, kind: 'mics', n: 500 });
  check(x.ok && x.res.mics === 500 && x.dm === true, 'هدية 500 مايك + إشعار بالبوت');
  let me = await post('/api/me', u1);
  check(me.profile.mics === mics0 + 500, `المايكات ${mics0} ← ${me.profile.mics}`);
  const dm = msgsTo(await since(n), u1.id).pop();
  check(dm && /وصلتك هدية من المطوّر/.test(dm.payload.text) && /500 🎤 مايك/.test(dm.payload.text) && dm.payload.reply_markup.inline_keyboard[0][0].web_app, 'رسالة الهدية بالعربي + زر العب');

  x = await A('gift', { uid: u1.id, kind: 'level', to: 10 });
  let expMics = 0;
  for (let l = (x.res && x.res.from) + 1; l <= 10; l++) expMics += levelReward(l);
  check(x.ok && x.res.to === 10 && x.res.mics === expMics, `هدية لفل ${x.res && x.res.from} ← 10 (+${x.res && x.res.mics} مايك جوائز اللفلات)`);
  me = await post('/api/me', u1);
  check(me.profile.level.level === 10, `اللفل صار ${me.profile.level.level}`);
  x = await A('gift', { uid: u1.id, kind: 'level', to: 5 });
  check(!x.ok && /اختار لفل أعلى/.test(x.error), 'لفل أقل من لفله: يرفض');

  x = await A('gift', { uid: u1.id, kind: 'items', items: ['skin:8', 'head:crown', 'skin:14', 'skin:0'] });
  check(x.ok && x.res.items.join() === 'skin:8,head:crown,skin:14', 'هدية سكنات وأغراض (المجاني ينشال)');
  me = await post('/api/me', u1);
  check(me.profile.owned['skin:8'] === 0 && me.profile.owned['skin:14'] === 0 && me.profile.owned['head:crown'] === 0, 'صارت عنده للأبد (حتى سكن الباس)');
  x = await A('gift', { uid: u1.id, kind: 'items', items: ['skin:8'] });
  check(!x.ok && /عنده كل الأغراض/.test(x.error), 'عنده الغرض: يرفض');

  x = await A('gift', { uid: u1.id, kind: 'pass' });
  check(x.ok && x.res.season === seasonOf(), 'هدية الرويال باس المميز');
  me = await post('/api/me', u1);
  check(me.profile.pass.premium === true, 'الباس صار مميز');
  x = await A('gift', { uid: u1.id, kind: 'pass' });
  check(!x.ok && /عنده الباس المميز/.test(x.error), 'عنده المميز: يرفض');

  const pl0 = me.profile.pass.level;
  x = await A('gift', { uid: u1.id, kind: 'passlv', n: 5 });
  check(x.ok && x.res.levels === 5 && x.res.to === pl0 + 5, `هدية 5 لفلات باس (${pl0} ← ${x.res && x.res.to})`);
  me = await post('/api/me', u1);
  check(me.profile.pass.level === pl0 + 5, 'لفل الباس تحدّث');

  x = await A('gift', { uid: 't999999999', kind: 'mics', n: 10 });
  check(!x.ok && /ما دخل اللعبة ولا البوت/.test(x.error), 'لاعب ما موجود: يرفض');
  x = await A('gift', { uid: u1.id, kind: 'bogus' });
  check(!x.ok, 'نوع هدية غلط: يرفض');

  n = await mark();
  x = await A('gift', { uid: u2.id, kind: 'mics', n: 100 });
  const dm2 = msgsTo(await since(n), u2.id).pop();
  check(x.ok && dm2 && /You got a gift from the developer/.test(dm2.payload.text) && /100 🎤 mics/.test(dm2.payload.text), 'رسالة الهدية للإنكليزي بلغته');
  n = await mark();
  x = await A('gift', { uid: u3.id, kind: 'mics', n: 100, notify: false });
  check(x.ok && x.dm === false && msgsTo(await since(n), u3.id).length === 0, 'بدون إشعار: ما توصله رسالة');

  const card = await A('user', { uid: u1.id });
  check(card.user && card.user.level === 10 && card.user.owned.includes('skin:8') && card.user.pass.premium && card.user.username === u1.username, 'كارت اللاعب: اللفل والأغراض والباس واليوزر');
  const found = await A('users', { q: '@' + u1.username });
  check(found.users.length === 1 && found.users[0].uid === 't' + u1.id, 'بحث بـ@اليوزر');
  const byId = await A('users', { q: String(u2.id) });
  check(byId.users.some((u) => u.uid === 't' + u2.id), 'بحث بالآيدي');
  const byName = await A('users', { q: 'Ivan' });
  check(byName.users.some((u) => u.uid === 't' + u3.id), 'بحث بالاسم');
  const gl = await A('gifts');
  check(gl.gifts.length >= 7 && gl.gifts[0].uid === 't' + u3.id, `آخر الهدايا (${gl.gifts.length})`);
}

/* ================= 7) صندوق اللاعب: نافذة باللعبة مرة وحدة */
{
  let me = await post('/api/me', u1);
  check(Array.isArray(me.inbox) && me.inbox.length === 0, 'بدون inbox:true ما يستهلك الصندوق');
  me = await post('/api/me', u1, { inbox: true });
  const kinds = me.inbox.map((x) => x.gift);
  check(kinds.join() === 'mics,level,items,pass,passlv', `الصندوق: ${me.inbox.length} هدايا (${kinds.join('، ')})`);
  check(me.inbox.every((x) => x.kind === 'gift' && x.id && x.at), 'كل وحدة بيها نوعها ووقتها');
  const it = me.inbox.find((x) => x.gift === 'items');
  check(it && it.items.length === 3, 'هدية الأغراض بيها قائمتها');
  me = await post('/api/me', u1, { inbox: true });
  check(me.inbox.length === 5, 'ما سكّر النوافذ بعد: ترجع تطلع (ما تضيع)');
  let gl = await A('gifts');
  check(gl.gifts.filter((x) => x.uid === 't' + u1.id).every((x) => !x.seen), 'اللوحة: بعده ما شافها');
  const ids = me.inbox.map((x) => x.id);
  const other = await post('/api/inbox/seen', u2, { ids });
  check(other.ok && other.n === 0, 'لاعب ثاني ما يكدر يعلّم صندوق غيره');
  const seen = await post('/api/inbox/seen', u1, { ids });
  check(seen.ok && seen.n === 5, 'سكّر النوافذ ← تنعلّم «شافها»');
  me = await post('/api/me', u1, { inbox: true });
  check(me.inbox.length === 0, 'بعدها: فارغ');
  gl = await A('gifts');
  check(gl.gifts.filter((x) => x.uid === 't' + u1.id).every((x) => x.seen), 'اللوحة: «👁️ شافها»');
}

/* ================= 8) النهاية والفائزين */
{
  n = await mark();
  const e = await A('contest.end');
  check(e.ok && e.contest.status === 'ended' && e.contest.winners.length === 2, 'إنهاء هسه: الفائزين = أول اثنين');
  const w = e.contest.winners;
  check(w[0].rank === 1 && w[0].prize === 200 && w[1].prize === 100 && !w[0].paid, 'الجوائز حسب المركز (200/100) وبعد ما انطيت');
  await wait(1500);
  const cs = await since(n);
  const adm = msgsTo(cs, ADMIN).find((x) => /خلصت مسابقة المتصدرين #/.test(x.payload.text));
  check(adm && adm.payload.parse_mode === 'HTML' && /tg:\/\/user\?id=/.test(adm.payload.text) && /200 ⭐/.test(adm.payload.text), 'إشعار الأدمن: الفائزين بروابطهم وجوائزهم');
  const wm = msgsTo(cs, P).concat(msgsTo(cs, P + 1)).filter((x) => /مبروك/.test(x.payload.text));
  check(wm.length === 2 && wm.some((x) => /200 ⭐/.test(x.payload.text)), 'رسالة لكل فائز: «مبروك… وربحت ⭐»');
  const v = await post('/api/contest', { id: P, first_name: 'بوت0' });
  check(v.contest.status === 'ended' && v.winners.length === 2 && v.winners[0].prize === 200, 'المتصدرين: «خلصت» ويبين الفائزين');
  const winner = v.winners[0].id;
  const wme = await post('/api/me', { id: Number(winner.slice(1)), first_name: 'بوت' }, { inbox: true });
  const win = wme.inbox.find((x) => x.kind === 'win');
  check(win && win.rank === 1 && win.prize === 200 && win.cid === cid, 'الفائز: نافذة «فزت!» باللعبة');
  const cfg = await (await fetch(BASE + '/api/config')).json();
  check(cfg.contest === null, 'القائمة: الكارت يختفي (ماكو مسابقة شغّالة)');
  const ad = await A('contest');
  check(ad.contest.winners.every((x) => x.dm === true), 'اللوحة: الفائزين وصلتهم الرسالة');
  check(/خلصت مسابقة المتصدرين/.test(ad.winnersPreview) && /200 ⭐/.test(ad.winnersPreview), 'معاينة إعلان الفائزين');
  const p = await A('contest.paid', { cid, uid: winner, paid: true });
  const ad2 = await A('contest');
  check(p.ok && ad2.contest.winners.find((x) => x.uid === winner).paid === true, '✅ انطيته');
  const p2 = await A('contest.paid', { cid, uid: 't123', paid: true });
  check(!p2.ok, 'مو فائز: يرفض');
  n = await mark();
  const an = await A('contest.announce');
  check(an.ok && an.total >= 4, `📢 إعلان الفائزين لـ${an.total}`);
  check(await bcDone(), 'إذاعة الفائزين خلصت');
  const cs2 = await since(n);
  const en = msgsTo(cs2, u2.id).find((x) => /leaderboard contest is over/.test(x.payload.text));
  check(en && /🥇 .+ — \d[\d,]* pts — 200 ⭐/.test(en.payload.text), 'إعلان الفائزين بالإنكليزي');
  const st = await A('contest');
  check(st.contest.announced > 0, 'تعلّمت «📢 انعلنوا»');
  const pv = await A('contest.preview');
  check(pv.tpl === 'start', 'بعد ما خلصت: النشر الجاي يبدي مسابقة جديدة');
}

/* ================= 9) مسابقة جديدة (القديمة تنحفظ بالسجل) وإلغاء */
{
  n = await mark();
  const r2 = await A('contest.publish', { expect: 'start', days: 1, prizes: [30, 20, 10] });
  const cc = await A('contest.cancel');
  check(r2.ok && r2.tpl === 'start' && r2.contest.id === cid + 1, 'بدت مسابقة #' + (cid + 1));
  check(cc.ok && cc.contest.status === 'cancelled', 'إلغاء بدون فائزين');
  await wait(1500);
  check((await A('bc.status')).bc === null && !msgsTo(await since(n), u1.id).some((x) => /30 ⭐/.test(x.payload.text || '')), 'الإلغاء يوقف إذاعة «بدت» (ما توصل لأحد)');
  const ad = await A('contest');
  const h = ad.hist.find((x) => x.id === cid);
  check(h && h.status === 'ended' && h.winners.length === 2 && h.winners.some((x) => x.paid), 'السجل: القديمة بفائزيها و«انطيته»');
  const v2 = await post('/api/contest', u1);
  check(v2.contest.id === cid && v2.contest.status === 'ended', 'بعد الإلغاء: المتصدرين يبين آخر وحدة خلصت');
  const e = await A('contest.end');
  check(!e.ok && /ماكو مسابقة شغّالة/.test(e.error), 'إنهاء وماكو شي شغّال: يرفض');
  const st = await A('contest.publish', { expect: 'remind', cid: cid + 1 });
  check(!st.ok && /حدّث اللوحة/.test(st.error), 'زر «تذكير» من لوحة قديمة والمسابقة خلصت: ما يبدي وحدة جديدة');
}

/* ================= 10) الحظر، الإذاعة، الأصوات، المدفوعات */
{
  let b = await A('ban', { uid: u3.id, reason: 'سبام' });
  check(b.ok && b.list.some((x) => x.uid === 't' + u3.id && x.reason === 'سبام'), 'حظر لاعب');
  const me3 = await post('/api/me', u3);
  check(me3.status === 403, 'المحظور: اللعبة ممنوعة');
  b = await A('ban', { uid: ADMIN });
  check(!b.ok && /أدمن/.test(b.error), 'ما تكدر تحظر أدمن');
  b = await A('unban', { uid: 't' + u3.id });
  check(b.ok && !b.list.some((x) => x.uid === 't' + u3.id), 'فك الحظر');

  n = await mark();
  const bc = await A('bc', { text: 'هلا بالكل 👋 تحديث جديد', button: true });
  check(bc.ok && bc.total >= 4, 'إذاعة نص من اللوحة');
  check(await bcDone(), 'الإذاعة خلصت');
  const cs = await since(n);
  const t1 = msgsTo(cs, u1.id).find((x) => x.payload.text === 'هلا بالكل 👋 تحديث جديد');
  const t2 = msgsTo(cs, u2.id).find((x) => x.payload.text === 'هلا بالكل 👋 تحديث جديد');
  check(t1 && t1.payload.reply_markup.inline_keyboard[0][0].text === '🎮 العب هسه' && t2 && t2.payload.reply_markup.inline_keyboard[0][0].text === '🎮 Play now', 'زر «العب هسه» بلغة كل لاعب');
  const shortT = await A('bc', { text: 'x' });
  check(!shortT.ok, 'رسالة فارغة: ترفض');

  const s = await A('sounds');
  check(s.ok && s.sounds.length > 5 && s.counts && s.sounds.every((x) => x.key && 'url' in x), `الأصوات (${s.sounds.length}) وروابط تسمعها`);
  const key = s.sounds.find((x) => x.kind === 'builtin').key;
  let tg = await A('sound.toggle', { key });
  check(tg.ok && tg.active === false, 'تعطيل صوت');
  tg = await A('sound.toggle', { key });
  check(tg.ok && tg.active === true, 'رجّعه');
  const rn = await A('sound.rename', { key, title: 'x' });
  check(!rn.ok, 'تغيير اسم صوت نظام: يرفض');

  const subs = await A('subs');
  check(subs.ok && Array.isArray(subs.subs), 'المقترحة');
  const meta = await A('meta');
  check(meta.xpPerLevel === 250, 'الثوابت');
  const set1 = await A('maint', { on: true });
  const set2 = await A('maint', { on: false });
  check(set1.stats.maint === true && set2.stats.maint === false, 'الصيانة تشتغل وتطفى');
}

/* ================= 11) استرجاع دفعة من اللوحة */
{
  const payer = { id: B + 77, first_name: 'Payer', language_code: 'ar' };
  await say(payer, '/start');
  const inv = await post('/api/stars/invoice', payer, { sku: 'mics300' });
  const link = (await calls()).filter((x) => x.method === 'createInvoiceLink').pop();
  if (inv.ok && link) {
    const charge = 'ch-cst-' + ++seq;
    await hook({ pre_checkout_query: { id: 'pcq' + seq, from: payer, currency: 'XTR', total_amount: link.payload.prices[0].amount, invoice_payload: link.payload.payload } });
    await hook({
      message: {
        message_id: ++seq,
        date: Math.floor(Date.now() / 1000),
        from: payer,
        chat: { id: payer.id, type: 'private' },
        successful_payment: { currency: 'XTR', total_amount: link.payload.prices[0].amount, invoice_payload: link.payload.payload, telegram_payment_charge_id: charge, provider_payment_charge_id: '' },
      },
    });
    await wait(400);
    let p = await A('payments');
    const row = p.payments.find((x) => x.charge === charge);
    check(row && row.stars === 15 && row.sku === 'mics300' && !row.refunded, 'المدفوعات: الدفعة تبين');
    n = await mark();
    const rf = await A('refund', { charge });
    const call = (await since(n)).find((x) => x.method === 'refundStarPayment');
    check(rf.ok && call && call.payload.telegram_payment_charge_id === charge && call.payload.user_id === payer.id, '↩️ استرجاع: تيليجرام refundStarPayment');
    p = await A('payments');
    check(p.payments.find((x) => x.charge === charge).refunded, 'تعلّمت «مرجّعة»');
    const again = await A('refund', { charge });
    check(!again.ok && /مرجّعة من قبل/.test(again.error), 'استرجاع مرتين: يرفض');
  } else check(false, 'ما انسوّت فاتورة للاختبار: ' + JSON.stringify(inv).slice(0, 120));
}

/* ================= 12) زر لوحة المطوّر بالبوت */
{
  n = await mark();
  await say(admin, '/admin');
  await wait(300);
  const m = msgsTo(await since(n), ADMIN).pop();
  const kb = m && m.payload.reply_markup && m.payload.reply_markup.inline_keyboard;
  check(kb && kb[0][0].web_app && /\/\?admin=1$/.test(kb[0][0].web_app.url), '/admin: أول زر «🛠️ افتح لوحة المطوّر باللعبة»');
}

console.log(`\n${ok} ✅ · ${bad} ❌`);
process.exit(bad ? 1 : 0);
