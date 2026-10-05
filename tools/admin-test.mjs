// اختبار لوحة المطوّر واقتراح الأصوات: قبول/رفض أصوات اللاعبين، الإحصائيات، الصيانة، الحظر، الإذاعة، وريست التوب.
// التشغيل: npx wrangler dev --var BC_GAP_MS:300 + node tools/mock-tg.mjs ثم: node tools/admin-test.mjs
// (للريست: شغّل قبله لعبة بهوية تيليجرام: SIM_TG_TOKEN=<التوكن> node tools/sim.mjs 2)
import { createHmac } from 'node:crypto';

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

function sign(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAadm', user: JSON.stringify(user) });
  const pairs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(pairs).digest('hex'));
  return p.toString();
}
const post = async (path, user, body = {}) => {
  const r = await fetch(BASE + path, { method: 'POST', body: JSON.stringify({ initData: sign(user), ...body }) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
let seq = 800000 + Math.floor(Math.random() * 100000);
async function hook(body) {
  const r = await fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ update_id: ++seq, ...body }),
  });
  return r.status;
}
const pchat = (u) => ({ id: u.id, type: 'private', first_name: u.first_name });
/** رسالة من لاعب بالخاص. يرجع رقم الرسالة */
async function say(u, extra) {
  const id = ++seq;
  await hook({ message: { message_id: id, date: Math.floor(Date.now() / 1000), from: u, chat: pchat(u), ...(typeof extra === 'string' ? { text: extra } : extra) } });
  return id;
}
async function press(u, data, messageId = 777, text = '') {
  await hook({ callback_query: { id: 'cb' + ++seq, from: u, data, message: { message_id: messageId, chat: { id: u.id, type: 'private' }, date: 0, text } } });
}
const calls = async () => (await fetch(MOCK + '/__calls')).json();
const mark = async () => (await calls()).length;
const since = async (n) => (await calls()).slice(n);
const sentTo = (cs, id) => cs.filter((x) => x.method === 'sendMessage' && Number(x.payload.chat_id) === Number(id) && !/لاعب جديد/.test(x.payload.text || ''));
const lastTo = async (n, id) => sentTo(await since(n), id).pop();
const answers = (cs) => cs.filter((x) => x.method === 'answerCallbackQuery').map((x) => x.payload);
const edits = (cs) => cs.filter((x) => x.method === 'editMessageText').map((x) => x.payload);

const admin = { id: ADMIN, first_name: 'Omar', is_bot: false };
// آيديات: تنتهي بـ1 = عنده صورة بروفايل، بـ0 = ماكو صورة، بـ13 = حاظر البوت (الإذاعة ما توصله)
const B = (6000 + Math.floor(Math.random() * 3000)) * 1000;
const U = (k, name, lang = 'ar') => ({ id: B + k, first_name: name, language_code: lang, is_bot: false });
const u1 = U(21, 'Ahmed');
const u2 = U(31, 'Sam', 'en');
const u3 = U(40, 'Noor');
const u4 = U(51, 'Zaid');
const u5 = U(61, 'Ivan', 'ru');
const u6 = U(71, 'Spammer');
const u7 = U(81, 'Fwd');
const ublk = U(113, 'Blocked');
const urate = { id: 4290000, first_name: 'Rate', is_bot: false };

// نبدي نظيف: الكل دخل البوت (حتى توصلهم الإذاعة)، والصيانة مطفية
for (const u of [admin, u1, u2, u3, u4, u5, u6, u7, ublk, urate]) await say(u, '/start');
await wait(600);

/* ---------------- 1) اقتراح صوت خطوة بخطوة */
let n = await mark();
await say(u1, '/addsound');
await wait(400);
let m = await lastTo(n, u1.id);
check(m && m.payload.text.includes('ضيف صوتك للعبة!') && m.payload.text.includes('أقل من 15 ثانية'), '/addsound يطلب الملف (أقل من 15 ثانية)');
n = await mark();
await say(u1, 'هلو');
await wait(400);
m = await lastTo(n, u1.id);
check(m && m.payload.text.includes('بعدني أنتظر الصوت'), 'نص بدل الملف: يذكّره');
n = await mark();
await say(u1, { photo: [{ file_id: 'p1', width: 90, height: 90 }] });
await wait(400);
m = await lastTo(n, u1.id);
check(m && m.payload.text.includes('مو صورة'), 'صورة بدل الصوت: يرفضها');
n = await mark();
await say(u1, { voice: { file_id: 'FILEID_voice_0123456789abcdef', duration: 22, file_size: 50000 } });
await wait(400);
m = await lastTo(n, u1.id);
check(m && m.payload.text.includes('الصوت طويل (22 ثانية)'), 'صوت 22 ثانية: طويل');
n = await mark();
await say(u1, { voice: { file_id: 'FILEID_voice_0123456789abcdef', duration: 5, file_size: 9000 } });
await wait(400);
m = await lastTo(n, u1.id);
check(m && m.payload.text.includes('اكتب اسم الصوت'), 'صوت 5 ثواني: يطلب الاسم');
n = await mark();
await say(u1, '  ضحكة    أبو عصام ');
await wait(800);
let cs = await since(n);
m = sentTo(cs, u1.id).pop();
check(m && m.payload.text.includes('«ضحكة أبو عصام» للمراجعة'), 'الاسم: وصل للمراجعة');
const voiceToAdmin = cs.find((x) => x.method === 'sendVoice' && Number(x.payload.chat_id) === ADMIN);
let card = sentTo(cs, ADMIN).find((x) => /صوت مقترح #\d+/.test(x.payload.text));
check(voiceToAdmin && voiceToAdmin.payload.voice === 'FILEID_voice_0123456789abcdef', 'الأدمن يوصله الصوت نفسه (يسمعه)');
check(
  card &&
    card.payload.parse_mode === 'HTML' &&
    card.payload.reply_parameters &&
    card.payload.text.includes(`tg://user?id=${u1.id}`) &&
    card.payload.text.includes('5 ثانية') &&
    card.payload.text.includes('«ضحكة أبو عصام»'),
  'بطاقة المعلومات: الاسم، اللاعب، المدة (رد على الصوت)',
);
const sid1 = card ? Number(/#(\d+)/.exec(card.payload.text)[1]) : 0;
const kb1 = card ? card.payload.reply_markup.inline_keyboard[0] : [];
check(kb1[0] && kb1[0].callback_data === 'sb|ok|' + sid1 && kb1[1].callback_data === 'sb|no|' + sid1, 'أزرار ✅ قبول و❌ رفض');

/* ---------------- 2) القبول: صورته + 50 مايك و50 خبرة + إشعار */
const before = await post('/api/me', u1);
n = await mark();
await press(admin, 'sb|ok|' + sid1, 901);
await wait(900);
cs = await since(n);
check(cs.some((x) => x.method === 'getUserProfilePhotos' && x.payload.user_id === u1.id), 'جاب صورة بروفايل اللاعب');
const ed = cs.find((x) => x.method === 'editMessageReplyMarkup' && x.payload.message_id === 901);
check(ed && /✅ انقبل — صوت #\d+/.test(ed.payload.reply_markup.inline_keyboard[0][0].text), `الأزرار صارت «${ed && ed.payload.reply_markup.inline_keyboard[0][0].text}»`);
m = sentTo(cs, u1.id).pop();
check(m && m.payload.text.includes('انقبل صوتك «ضحكة أبو عصام»') && m.payload.text.includes('50 🎤') && m.payload.reply_markup.inline_keyboard[0][0].web_app, 'اللاعب وصله إشعار القبول + زر اللعب');
const after = await post('/api/me', u1);
check(after.profile.mics === before.profile.mics + 50, `+50 مايك (${before.profile.mics} → ${after.profile.mics})`);
check(after.profile.pass.xp === before.profile.pass.xp + 50, `+50 خبرة باس (${before.profile.pass.xp} → ${after.profile.pass.xp})`);
n = await mark();
await say(admin, '/sounds');
await wait(500);
m = await lastTo(n, ADMIN);
const rowsS = m ? m.payload.reply_markup.inline_keyboard.flat().map((b) => b.text) : [];
check(rowsS.some((t) => t.includes('🖼️ ضحكة أبو عصام')), 'الصوت انضاف للعبة ويا صورته (🖼️)');
n = await mark();
await press(admin, 'sb|ok|' + sid1, 901);
await wait(400);
check(answers(await since(n)).some((a) => a.text.includes('انقبل من قبل')), 'نفس الزر مرة ثانية: «انقبل من قبل»');

/* ---------------- 3) فيديو وياه كابشن (بدون /addsound) + إنكليزي + رفض بسبب */
n = await mark();
await say(u2, { video: { file_id: 'FILEID_video_0123456789abcdef', duration: 9, file_size: 900000 }, caption: "I'm the danger" });
await wait(800);
cs = await since(n);
m = sentTo(cs, u2.id).pop();
check(m && m.payload.text.includes('“I\'m the danger” was sent for review') && !m.payload.text.includes('‏'), `فيديو + كابشن = اسم مباشرة (إنكليزي): ${m && m.payload.text.split('\n')[0]}`);
card = sentTo(cs, ADMIN).find((x) => /صوت مقترح #\d+/.test(x.payload.text));
check(
  cs.some((x) => x.method === 'sendVideo' && x.payload.video === 'FILEID_video_0123456789abcdef') && card && card.payload.text.includes('🎬 فيديو (اللعبة تاخذ الصوت بس)'),
  'الأدمن يوصله الفيديو + «اللعبة تاخذ الصوت بس»',
);
const sid2 = card ? Number(/#(\d+)/.exec(card.payload.text)[1]) : 0;
n = await mark();
await press(admin, 'sb|no|' + sid2, 902);
await wait(500);
cs = await since(n);
m = sentTo(cs, ADMIN).pop();
check(m && m.payload.text.includes('اكتب سبب رفض') && m.payload.reply_markup.force_reply, 'الرفض: يطلب السبب');
n = await mark();
await say(admin, 'الصوت واطي وما ينسمع');
await wait(700);
cs = await since(n);
m = sentTo(cs, u2.id).pop();
check(m && m.payload.text.includes('“I\'m the danger” was not approved') && m.payload.text.includes('Reason: الصوت واطي وما ينسمع'), 'اللاعب وصله الرفض ويا السبب (بلغته)');
check(cs.some((x) => x.method === 'editMessageReplyMarkup' && x.payload.message_id === 902 && x.payload.reply_markup.inline_keyboard[0][0].text === '❌ انرفض'), 'بطاقة الأدمن صارت «انرفض»');
check(sentTo(cs, ADMIN).some((x) => x.payload.text.includes('ووصل السبب للاعب')), 'الأدمن: تأكيد الرفض');

/* ---------------- 4) /start addsound + ملف بلا مدة + رفض بدون سبب (/skip) + بدون صورة */
n = await mark();
await say(u3, '/start addsound');
await wait(400);
m = await lastTo(n, u3.id);
check(m && m.payload.text.includes('ضيف صوتك للعبة!'), 'رابط ?start=addsound يبدي الاقتراح');
await say(u3, { document: { file_id: 'FILEID_doc_0123456789abcdef', mime_type: 'audio/mpeg', file_name: 'x.mp3', file_size: 70000 } });
await wait(400);
n = await mark();
await say(u3, 'صوت سعاد فشرت');
await wait(700);
cs = await since(n);
card = sentTo(cs, ADMIN).find((x) => /صوت مقترح #\d+/.test(x.payload.text));
check(cs.some((x) => x.method === 'sendDocument') && card && card.payload.text.includes('المدة ما معروفة') && card.payload.text.includes('📎 ملف'), 'ملف صوت (بلا مدة): يوصل للأدمن');
const sid3 = card ? Number(/#(\d+)/.exec(card.payload.text)[1]) : 0;
await press(admin, 'sb|no|' + sid3, 903);
await wait(400);
n = await mark();
await say(admin, '/skip');
await wait(600);
m = await lastTo(n, u3.id);
check(m && m.payload.text.includes('ما انقبل صوتك «صوت سعاد فشرت»') && !m.payload.text.includes('السبب'), '/skip: رفض بدون سبب');

/* ---------------- 5) حد الانتظار (3) + قائمة المقترحة + عرض صوت */
for (let i = 1; i <= 3; i++) {
  await say(u4, { voice: { file_id: 'FILEID_voice_0123456789abcdef', duration: 3 }, caption: 'صوت ' + i });
  await wait(250);
}
n = await mark();
await say(u4, { voice: { file_id: 'FILEID_voice_0123456789abcdef', duration: 3 }, caption: 'صوت 4' });
await wait(500);
m = await lastTo(n, u4.id);
check(m && m.payload.text.includes('عندك 3 أصوات تنتظر المراجعة'), 'الرابع: «عندك 3 أصوات تنتظر»');
n = await mark();
await press(admin, 'ad|subs', 904);
await wait(500);
cs = await since(n);
let e = edits(cs).pop();
const subBtns = e ? e.reply_markup.inline_keyboard.flat().filter((b) => /^sb\|show\|\d+$/.test(b.callback_data)) : [];
check(e && e.text.includes('الأصوات المقترحة') && e.text.includes('«صوت 1»') && subBtns.length === 3, `قائمة المقترحة (${subBtns.length})`);
n = await mark();
if (subBtns[0]) await press(admin, subBtns[0].callback_data, 904);
await wait(500);
cs = await since(n);
check(cs.some((x) => x.method === 'sendVoice' && Number(x.payload.chat_id) === ADMIN) && sentTo(cs, ADMIN).some((x) => /صوت مقترح #\d+/.test(x.payload.text)), 'زر ▶️ يدز الصوت والبطاقة مرة ثانية');

/* ---------------- 6) /cancel يلغي الخطوة */
await say(u5, '/addsound');
await wait(300);
n = await mark();
await say(u5, '/cancel');
await wait(400);
m = await lastTo(n, u5.id);
check(m && m.payload.text.includes('Отменено'), '/cancel (روسي): Отменено');
n = await mark();
await say(u5, 'просто текст');
await wait(400);
m = await lastTo(n, u5.id);
check(m && !m.payload.text.includes('жду звук'), 'بعد الإلغاء: النص ما ينحسب اقتراح');

/* ---------------- 7) لوحة المطوّر والإحصائيات */
n = await mark();
await say(admin, '/admin');
await wait(500);
m = await lastTo(n, ADMIN);
const panel = m ? m.payload.reply_markup.inline_keyboard.flat().map((b) => b.callback_data) : [];
check(m && m.payload.text.includes('لوحة المطوّر') && ['ad|stats', 'ad|bc', 'ad|ban', 'ad|subs', 'ad|snd', 'ad|set'].every((d) => panel.includes(d)), '/admin: اللوحة بكل الأزرار');
n = await mark();
await say(u1, '/admin');
await wait(400);
check(!sentTo(await since(n), u1.id).some((x) => x.payload.text.includes('لوحة')), 'غير الأدمن ما يشوف اللوحة');
n = await mark();
await press(u1, 'ad|stats', 905);
await wait(400);
check(answers(await since(n)).some((a) => a.text.includes('بس الأدمن')), 'غير الأدمن ما يكدر يضغط أزرارها');
n = await mark();
await press(admin, 'ad|stats', 905);
await wait(500);
e = edits(await since(n)).pop();
check(e && e.text.includes('إحصائيات') && /كل اللاعبين: \d+/.test(e.text) && e.text.includes('مقترحة تنتظر: 3') && /النجوم: \d+/.test(e.text), 'الإحصائيات');

/* ---------------- 8) الصيانة */
n = await mark();
await press(admin, 'ad|set', 906);
await wait(400);
e = edits(await since(n)).pop();
check(e && e.text.includes('وضع الصيانة: مطفي') && e.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === 'ad|maint'), 'إعدادات البوت');
n = await mark();
await press(admin, 'ad|maint', 906);
await wait(500);
cs = await since(n);
check(answers(cs).some((a) => a.show_alert && a.text.includes('الصيانة شغّالة')) && edits(cs).pop().text.includes('وضع الصيانة: شغّال'), 'شغّل الصيانة');
n = await mark();
await say(u2, '/start');
await say(u1, '/top');
await wait(500);
cs = await since(n);
check((sentTo(cs, u2.id).pop() || { payload: {} }).payload.text === '🛠️ The bot is under maintenance — back soon', 'الصيانة: اللاعب (إنكليزي) يوصله «under maintenance»');
check((sentTo(cs, u1.id).pop() || { payload: {} }).payload.text.includes('البوت بالصيانة'), 'الصيانة: حتى الأوامر');
n = await mark();
await say(admin, '/top');
await wait(400);
check(sentTo(await since(n), ADMIN).some((x) => x.payload.text.includes('🏆')), 'الأدمن يعدّي الصيانة');
n = await mark();
await press(u2, 'sub|start', 907);
await wait(400);
check(answers(await since(n)).some((a) => a.show_alert && a.text.includes('maintenance')), 'زر «ضيف صوتك» وقت الصيانة: تنبيه');

/* ---------------- 9) الحظر */
n = await mark();
await press(admin, 'ad|ban', 908);
await wait(400);
e = edits(await since(n)).pop();
check(e && e.text.includes('🚫 الحظر') && e.text.includes('حوّل رسالة'), 'شاشة الحظر');
n = await mark();
await say(admin, `${u6.id} سبام بالكروبات`);
await wait(500);
m = await lastTo(n, ADMIN);
check(m && m.payload.text.includes(`انحظر Spammer (${u6.id})`) && m.payload.text.includes('السبب: سبام بالكروبات') && m.payload.reply_markup.inline_keyboard[0][0].callback_data === `ub|t${u6.id}`, 'حظر بالآيدي + زر فك الحظر');
await press(admin, 'ad|ban', 908);
await wait(300);
n = await mark();
await say(admin, { forward_origin: { type: 'user', sender_user: { id: u7.id, is_bot: false, first_name: 'Fwd' }, date: 1 }, text: 'رسالة محوّلة' });
await wait(500);
m = await lastTo(n, ADMIN);
check(m && m.payload.text.includes(`(${u7.id})`), 'حظر بتحويل رسالة منه');
await press(admin, 'ad|ban', 908);
await wait(300);
n = await mark();
await say(admin, { forward_origin: { type: 'hidden_user', sender_user_name: 'Ghost', date: 1 }, text: 'x' });
await wait(400);
m = await lastTo(n, ADMIN);
check(m && m.payload.text.includes('مخفي'), 'تحويل من حساب مخفي: يطلب الآيدي');
n = await mark();
await say(admin, '/cancel');
await say(admin, `/ban ${ADMIN}`);
await wait(500);
check(sentTo(await since(n), ADMIN).some((x) => x.payload.text.includes('ما تكدر تحظر أدمن')), 'ما يكدر يحظر أدمن');
n = await mark();
await press(admin, 'ad|maint', 906); // نطفي الصيانة حتى نشوف رسالة الحظر
await wait(400);
await say(u6, '/start');
await wait(400);
m = await lastTo(n, u6.id);
check(m && m.payload.text.includes('إنت محظور من البوت'), 'المحظور: البوت يكله محظور');

/* ---------------- 10) الإذاعة (المحظورين والحاظرين ما توصلهم، و429 ينعاد) */
n = await mark();
await press(admin, 'ad|bc', 909);
await wait(400);
e = edits(await since(n)).pop();
const reach = e ? Number((/\((\d+) لاعب\)/.exec(e.text) || [])[1]) : 0;
check(e && e.text.includes('📢 الإذاعة') && reach > 0, `شاشة الإذاعة (${reach} لاعب)`);
n = await mark();
const bcMsg = await say(admin, '📢 تحديث جديد: أصوات أكثر!');
await wait(500);
m = await lastTo(n, ADMIN);
const go = m ? m.payload.reply_markup.inline_keyboard[0][0] : {};
check(m && m.payload.text.includes(`توصل لـ${reach} لاعب`) && go.callback_data === `bc|go|${bcMsg}` && m.payload.reply_parameters.message_id === bcMsg, 'تأكيد قبل الإذاعة');
n = await mark();
await press(admin, go.callback_data, 910);
await wait(400);
e = edits(await since(n)).pop();
check(e && e.text.includes(`بدت الإذاعة لـ${reach} لاعب`), 'بدت الإذاعة');
let report = null;
for (let i = 0; i < 60 && !report; i++) {
  await wait(500);
  report = sentTo(await since(n), ADMIN).find((x) => x.payload.text.includes('خلصت الإذاعة'));
}
cs = await since(n);
const copies = cs.filter((x) => x.method === 'copyMessage');
check(copies.length && copies.every((x) => Number(x.payload.from_chat_id) === ADMIN && x.payload.message_id === bcMsg), `الإذاعة بـcopyMessage (${copies.length} محاولة)`);
check(!copies.some((x) => [u6.id, u7.id].includes(Number(x.payload.chat_id))), 'المحظورين ما توصلهم');
check(copies.filter((x) => Number(x.payload.chat_id) === urate.id).length === 2, '429: نفس اللاعب ينعاد بعد الانتظار');
check(report && report.payload.text.includes(`وصلت: ${reach - 1}`) && report.payload.text.includes('ما وصلت: 1'), `التقرير: ${report && report.payload.text.replace(/‏/g, '').split('\n').slice(1, 3).join(' · ')}`);
n = await mark();
await press(admin, 'ad|bc', 911);
await wait(400);
e = edits(await since(n)).pop();
check(e && e.text.includes(`(${reach - 1} لاعب)`), 'اللي حاظر البوت ما ينحسب بالإذاعة الجاية');
await say(admin, '/cancel');

/* ---------------- 11) فك الحظر */
n = await mark();
await press(admin, 'ub|t' + u7.id, 912, '‏🚫 انحظر Fwd');
await wait(400);
cs = await since(n);
check(answers(cs).some((a) => a.text.includes('انفك الحظر')) && cs.some((x) => x.method === 'editMessageReplyMarkup' && x.payload.message_id === 912), 'زر فك الحظر');
n = await mark();
await say(admin, `/unban ${u6.id}`);
await wait(400);
check(sentTo(await since(n), ADMIN).some((x) => x.payload.text.includes(`انفك الحظر عن ${u6.id}`)), '/unban');
n = await mark();
await say(u6, '/id');
await wait(400);
m = await lastTo(n, u6.id);
check(m && m.payload.text.includes(String(u6.id)), 'بعد فك الحظر يرجع يستخدم البوت');

/* ---------------- 12) اللعبة: الحظر والصيانة (ذاكرة العامل تتحدث كل 20 ثانية) */
await say(admin, `/ban ${u6.id} اختبار`);
await press(admin, 'ad|maint', 906);
console.log('… ننتظر 21 ثانية حتى تتحدث ذاكرة العامل');
await wait(21000);
let r = await post('/api/me', u6);
check(r.status === 403 && r.error === 'banned', 'المحظور: /api/me = 403');
r = await post('/api/rooms', u1, {});
check(r.status === 503 && r.error === 'maint', 'الصيانة: ما يكدر يسوّي غرفة (503)');
r = await post('/api/rooms', admin, {});
check(r.status === 200 && /^\d{5}$/.test(r.code), 'الأدمن يكدر وقت الصيانة');
const cfg = await (await fetch(BASE + '/api/config')).json();
check(cfg.maintenance === true, '/api/config يكول صيانة');
await press(admin, 'ad|maint', 906);
await say(admin, `/unban ${u6.id}`);
await wait(21000);
r = await post('/api/me', u6);
check(r.status === 200 && r.user, 'بعد فك الحظر: /api/me يرجع');
r = await post('/api/rooms', u1, {});
check(r.status === 200 && r.pub === false, 'بعد الصيانة: الغرف ترجع (خاصة)');

/* ---------------- 13) ريست التوب (اللفلات والمايكات تبقى) */
const top0 = (await (await fetch(BASE + '/api/top')).json()).top;
const sim = { id: Number(process.env.SIM_TG_ID || 900), first_name: 'بوت0' };
const p0 = await post('/api/me', sim);
n = await mark();
await press(admin, 'ad|reset', 913);
await wait(400);
e = edits(await since(n)).pop();
check(e && e.text.includes('متأكد') && e.reply_markup.inline_keyboard[0][0].callback_data === 'ad|reset2', 'ريست التوب يطلب تأكيد');
n = await mark();
await press(admin, 'ad|reset2', 913);
await wait(500);
cs = await since(n);
e = edits(cs).pop();
check(e && new RegExp(`صار ريست للتوب — ${top0.length} لاعب`).test(e.text), `ريست: ${e && e.text.replace(/‏/g, '').split('\n')[0]}`);
const top1 = (await (await fetch(BASE + '/api/top')).json()).top;
check(top0.length > 0 && top1.length === 0, `التوب انمسح (${top0.length} → ${top1.length})`);
const p1 = await post('/api/me', sim);
check(
  p0.profile && p1.profile && p1.profile.points === p0.profile.points && p1.profile.mics === p0.profile.mics && p1.profile.level.level === p0.profile.level.level && p1.stats.points === 0,
  `اللفل والمايكات ما انمست (لفل ${p1.profile && p1.profile.level.level}، ${p1.profile && p1.profile.mics} مايك) والترتيب صفر`,
);

/* ---------------- 14) أوامر الأدمن بالقائمة */
await fetch(BASE + '/api/setup');
await wait(300);
const scoped = (await calls()).filter((x) => x.method === 'setMyCommands' && x.payload.scope && x.payload.scope.type === 'chat').pop();
check(scoped && Number(scoped.payload.scope.chat_id) === ADMIN && scoped.payload.commands[0].command === 'admin', 'أمر /admin يبين للأدمن بس');

console.log(`\n${ok} نجح، ${bad} فشل`);
process.exit(bad ? 1 : 0);
