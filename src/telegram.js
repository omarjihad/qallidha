// عميل Telegram Bot API + منطق البوت: الأوامر، الأصوات (الأدمن يضيف واللاعبين يقترحون)، ولوحة المطوّر.
// رسائل اللاعبين بلغته (عربي/روسي/إنكليزي — نفس قاموس اللعبة)، ورسائل الأدمن بالعربي.

import { MAX_PLAYERS, ROUNDS } from '../public/js/shared.js';
import { seasonOf, seasonEnd, PASS, STAR_PACK, packPrice } from '../public/js/catalog.js';
import { passInvoice, passPrice, parsePackPayload } from './pass.js';
import { langFromCode } from '../public/js/lang/detect.js';
import RU from '../public/js/lang/ru.js';
import EN from '../public/js/lang/en.js';

const DICTS = { ru: RU, en: EN };

/** ترجمة نص عربي للغة اللاعب (نفس قاموس اللعبة). {x} = متغيرات */
export function tr(lang, s, vars) {
  const d = DICTS[lang];
  let v = d ? d[s] : undefined;
  if (typeof v === 'function') return v(vars || {});
  if (typeof v !== 'string') v = s;
  return vars ? v.replace(/\{(\w+)\}/g, (m, k) => (k in vars && vars[k] != null ? String(vars[k]) : m)) : v;
}

/** لغة اللاعب: اللي اختارها باللعبة، وإلا لغة تيليجرام مالته */
export function langOf(from, stored = '') {
  if (stored === 'ar' || stored === 'ru' || stored === 'en') return stored;
  return langFromCode((from && from.language_code) || '');
}

const RLM = '‏';

export class Tg {
  constructor(token, base) {
    this.token = (token || '').trim();
    this.base = (base || 'https://api.telegram.org').replace(/\/$/, '');
  }

  async call(method, payload = {}) {
    const res = await fetch(`${this.base}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) throw new Error(`${method}: ${body.description || res.status}`);
    return body.result;
  }

  fileUrl(path) {
    return `${this.base}/file/bot${this.token}/${path}`;
  }
}

export function adminIds(env) {
  return String(env.ADMIN_IDS || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function appLink(bot, env) {
  const short = String(env.APP_SHORT_NAME || '').trim();
  return short ? `https://t.me/${bot}/${short}` : `https://t.me/${bot}`;
}

/* ------------------------------------------------------------ الأصوات اللي يضيفها اللاعبين */

/** أطول صوت ينقبل (ثواني) */
export const SUB_MAX_SEC = 15;
/** مكافأة الصوت المقبول: مايكات وخبرة باس */
export const SUB_REWARD = 50;
const MAX_FILE = 20 * 1024 * 1024;

/** حتى الأدمن يسمع الصوت قبل ما يقرر: نفس نوع الملف اللي وصل */
const SEND = {
  voice: ['sendVoice', 'voice'],
  audio: ['sendAudio', 'audio'],
  video: ['sendVideo', 'video'],
  video_note: ['sendVideoNote', 'video_note'],
  document: ['sendDocument', 'document'],
};
const TYPE_NAME = { voice: '🎤 فويس', audio: '🎵 ملف صوت', video: '🎬 فيديو', video_note: '⭕ فيديو دائري', document: '📎 ملف' };

/** الصوت اللي بالرسالة: kind = نوعه باللعبة، type = نوع رسالة تيليجرام */
function mediaOf(msg) {
  if (msg.voice) return { file_id: msg.voice.file_id, kind: 'voice', type: 'voice', size: msg.voice.file_size, dur: msg.voice.duration };
  if (msg.audio)
    return {
      file_id: msg.audio.file_id,
      kind: 'audio',
      type: 'audio',
      size: msg.audio.file_size,
      dur: msg.audio.duration,
      title: msg.audio.title || msg.audio.file_name,
    };
  if (msg.video) return { file_id: msg.video.file_id, kind: 'video', type: 'video', size: msg.video.file_size, dur: msg.video.duration };
  if (msg.video_note)
    return { file_id: msg.video_note.file_id, kind: 'video', type: 'video_note', size: msg.video_note.file_size, dur: msg.video_note.duration };
  if (msg.animation) return null; // GIF بلا صوت
  const d = msg.document;
  if (d && /^(audio|video)\//.test(d.mime_type || ''))
    return { file_id: d.file_id, kind: d.mime_type.startsWith('video') ? 'video' : 'audio', type: 'document', size: d.file_size, title: d.file_name };
  return null;
}

/** سطور الرسالة: العربي ياخذ علامة RLM حتى يبين يمين لليسار، والباقي بدونها */
const lines = (...l) => l.map((s) => (s ? RLM + s : '')).join('\n');
const linesFor = (lang) => (lang === 'ar' ? lines : (...l) => l.join('\n'));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const kb = (rows) => ({ inline_keyboard: rows });
const btn = (text, data) => ({ text, callback_data: data });
const back = (data = 'ad|home', text = '→ رجوع') => [btn(text, data)];

const PER_PAGE = 10;

/** سطور عدد الأصوات (للأدمن ولغيره) */
export function countLines(c) {
  const lib = c.library;
  const libExtra = [lib.pending ? `⏳ ${lib.pending} بعدها تنزل` : '', lib.failed ? `❌ ${lib.failed} ما نزلت` : ''].filter(Boolean).join('، ');
  return [
    `✅ الأصوات الفعّالة باللعبة: ${c.active}`,
    `🎌 مكتبة الميمز: ${lib.on} من ${lib.ready}${libExtra ? ` (${libExtra})` : ''}`,
    `🎵 أصوات النظام: ${c.builtin.on} من ${c.builtin.total}`,
    `🎙️ الأصوات المضافة: ${c.custom.on} من ${c.custom.total}`,
  ];
}

/** قائمة الأصوات للأدمن: كل صوت زر يفعّل/يعطّل، و🗑️ يحذف الأصوات المضافة نهائيًا. */
export async function soundsMenu(hub, page = 0) {
  const [all, counts] = await Promise.all([hub.listAll(), hub.soundCounts()]);
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  page = Math.max(0, Math.min(pages - 1, page | 0));
  const rows = all.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE).map((x) => {
    const row = [{ text: `${x.active ? '✅' : '🚫'} ${x.emoji} ${x.title}`.slice(0, 60), callback_data: `t|${x.key}|${page}` }];
    row.push({ text: '🗑️', callback_data: `d|${x.key}|${page}` });
    return row;
  });
  const builtinOn = all.some((x) => (x.kind === 'builtin' || x.kind === 'library') && x.active);
  rows.push([{ text: builtinOn ? '🔇 عطّل كل أصوات النظام والمكتبة' : '🔊 رجّع كل أصوات النظام والمكتبة', callback_data: `ba|${builtinOn ? 0 : 1}|${page}` }]);
  if (counts.library.failed) rows.push([{ text: `🔄 أعد تحميل الأصوات اللي ما نزلت (${counts.library.failed})`, callback_data: `lr||${page}` }]);
  if (pages > 1) {
    const nav = [];
    if (page > 0) nav.push({ text: '→ السابق', callback_data: `p||${page - 1}` });
    nav.push({ text: `${page + 1} / ${pages}`, callback_data: `p||${page}` });
    if (page < pages - 1) nav.push({ text: 'التالي ←', callback_data: `p||${page + 1}` });
    rows.push(nav);
  }
  rows.push([btn('🛠️ لوحة المطوّر', 'ad|home')]);
  const on = counts.active;
  const text = lines(
    ...countLines(counts),
    '',
    'اضغط على الصوت حتى تعطّله 🚫 أو ترجّعه ✅',
    '🗑️ = يطلع من اللعبة (المضافة تنحذف نهائيًا، والباقي ينعطل)',
    on === 0 ? '⚠️ ماكو ولا صوت شغّال — اللعبة ما تبدي' : on < 4 ? `⚠️ ${on} أصوات بس = ${on} جولات` : '',
  );
  return { text, reply_markup: kb(rows) };
}

/** منين دخل اللاعب البوت (لإشعار الأدمن) */
function botSource(cmd, arg) {
  if (cmd !== '/start') return 'رسالة للبوت';
  const m = /^r(\d{5})$/.exec(arg || '');
  if (m) return `رابط دعوة لغرفة ${m[1]}`;
  if (arg === 'addsound') return 'زر «ضيف صوتك» باللعبة';
  return arg ? `/start ${String(arg).slice(0, 30)}` : '/start بالبوت';
}

/** كل اللي يحتاجه الرد: التيليجرام، اللغة، الأدمن، الحظر والصيانة، وخطوة المحادثة */
async function contextOf(deps, from, chat) {
  const { env, hub } = deps;
  const tg = new Tg(env.TELEGRAM_BOT_TOKEN, env.TG_API_BASE);
  const fromId = String((from && from.id) || '');
  const uid = fromId ? 't' + fromId : '';
  const isAdmin = !!fromId && adminIds(env).includes(fromId);
  const info = (await hub.botInfo(uid, isAdmin).catch(() => null)) || {};
  const lang = langOf(from, info.lang);
  const chatId = chat ? chat.id : Number(fromId);
  return {
    ...deps,
    tg,
    from: from || {},
    fromId,
    uid,
    isAdmin,
    info,
    lang,
    t: (s, vars) => tr(lang, s, vars),
    L: linesFor(lang),
    chatId,
    isPrivate: !chat || chat.type === 'private',
    send: (s, extra = {}) => tg.call('sendMessage', { chat_id: chatId, text: s, ...extra }).catch(() => null),
  };
}

async function botName(c) {
  if (c.info.bot) return c.info.bot;
  try {
    const b = (await c.tg.call('getMe')).username;
    await c.hub.setKV('bot', b);
    c.info.bot = b;
    return b;
  } catch {
    return '';
  }
}

/**
 * يعالج تحديثًا واحدًا من تيليجرام. لا يرمي أبدًا.
 * deps: { env, origin, hub, claimRoom(chatId) → code }
 */
export async function handleUpdate(update, deps) {
  if (update.callback_query) return handleCallback(update.callback_query, deps);
  if (update.pre_checkout_query) return handlePreCheckout(update.pre_checkout_query, deps);
  const msg = update.message;
  if (!msg || !msg.chat) return;
  if (msg.successful_payment) return handlePaid(msg, deps);
  const text = (msg.text || '').trim();
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = text.startsWith('/') ? (cmdRaw || '').split('@')[0].toLowerCase() : '';
  const arg = rest.join(' ').trim();
  const from = msg.from || {};

  // أول مرة يدخل البوت: إشعار للأدمن بمعلوماته (بالخلفية)
  const joined =
    msg.chat.type === 'private' && from.id && !from.is_bot
      ? deps.hub
          .join({
            id: from.id,
            first_name: from.first_name || '',
            last_name: from.last_name || '',
            username: from.username || '',
            language_code: from.language_code || '',
            is_premium: !!from.is_premium,
            src: botSource(cmd, arg),
            fromBot: true,
          })
          .catch(() => null)
      : null;

  try {
    const c = await contextOf(deps, from, msg.chat);
    await route(c, msg, text, cmd, arg);
  } catch (e) {
    console.log('bot error', e && e.message);
  } finally {
    if (joined) await joined;
  }
}

async function route(c, msg, text, cmd, arg) {
  const { env, hub, tg, t, L, send, isAdmin, isPrivate, info, uid, fromId, from, origin } = c;

  // محظور أو صيانة: الأدمن بس يعدّي
  if (!isAdmin && info.banned) {
    if (isPrivate) await send(L(t('🚫 إنت محظور من البوت')));
    return;
  }
  if (!isAdmin && info.maint) {
    if (isPrivate || cmd) await send(L(t('🛠️ البوت بالصيانة هسه — نرجع قريب')));
    return;
  }

  // ---------- خطوات الأدمن (رسالة الإذاعة، الحظر، سبب الرفض)
  if (isAdmin && isPrivate && info.adm && (await adminStep(c, msg, text, cmd))) return;

  if (cmd === '/cancel') {
    await hub.delKV('sub:' + uid);
    if (isAdmin) await hub.delKV('adm:' + uid);
    await send(L(t('تم الإلغاء ✅')));
    return;
  }

  // ---------- اقتراح صوت للعبة
  if (cmd === '/addsound' || (cmd === '/start' && arg === 'addsound')) return startSub(c);
  if (isPrivate && info.sub && !cmd && (await subStep(c, msg, text))) return;

  const bot = await botName(c);
  const link = bot ? appLink(bot, env) : '';
  const playButton = (room) => {
    if (isPrivate) return { text: t('🎮 العب هسه'), web_app: { url: origin + '/' + (room ? `?room=${room}` : '') } };
    if (link) return { text: t('🎮 ادخل اللعبة'), url: link + (room ? `?startapp=r${room}` : '') };
    return { text: t('🎮 العب'), url: origin + '/' };
  };

  // ---------- أوامر
  if (cmd === '/start' && isPrivate) {
    const m = /^r(\d{5})$/.exec(arg);
    const name = (from.first_name || '').slice(0, 20);
    const rows = [[playButton(m ? m[1] : '')]];
    if (bot) rows.push([{ text: t('👥 ضيفني لكروب حتى تلعبون سوا'), url: `https://t.me/${bot}?startgroup=play` }]);
    rows.push([btn(t('🎙️ ضيف صوتك للعبة'), 'sub|start')]);
    await send(
      L(
        t('🎤 هلا {name}! هاي «قلّدها» — لعبة تقليد الأصوات.', { name }),
        '',
        t('تسمعون صوت (إسعاف، بزونة، ضحكة شريرة، ميمز…) والكل يقلّده بنفس اللحظة — فرصة وحدة بس!'),
        t('وبعدين كل تسجيل ينعاد قدام الكل، وياخذ درجة من 100.'),
        t('بين الجولات تدور العجلة: نقاط، مضاعفات، وتخريب على ربعك 😈'),
        '',
        t('🧑‍🤝‍🧑 لحد {p} لاعبين — {r} جولات', { p: MAX_PLAYERS, r: ROUNDS }),
        t('🎲 العب ويا ربعك، أو عشوائي ويا ناس من كل مكان'),
        t('🎙️ عندك صوت يضحك؟ ضيفه للعبة وتاخذ مايكات: /addsound'),
        t('👇 اضغط وابدي'),
      ),
      { reply_markup: kb(rows) },
    );
    // زر القائمة بلغة اللاعب (الافتراضي عربي)
    if (c.lang !== 'ar') {
      await tg
        .call('setChatMenuButton', { chat_id: c.chatId, menu_button: { type: 'web_app', text: t('🎮 العب'), web_app: { url: origin + '/' } } })
        .catch(() => null);
    }
    return;
  }

  // بالكروب: /start (بعد الإضافة) و/play كلاهما يسوّي غرفة
  if (cmd === '/play' || cmd === '/game' || cmd === '/start') {
    const code = await c.claimRoom(isPrivate ? null : c.chatId);
    await send(
      L(
        t('🎤 تحدي تقليد الأصوات بدأ!'),
        t('🔢 الغرفة: {code}', { code }),
        t('🧑‍🤝‍🧑 لحد {p} لاعبين — أول واحد يدخل يصير المضيف', { p: MAX_PLAYERS }),
        t('👇 ادخلوا من الزر'),
      ),
      { reply_markup: kb([[playButton(code)]]) },
    );
    return;
  }

  if (cmd === '/top') {
    const rows = await hub.top(10);
    if (!rows.length) return void (await send(L(t('🏆 بعد ماكو أحد بالترتيب — كون أول واحد!'))));
    const medal = ['🥇', '🥈', '🥉'];
    await send(
      L(
        t('🏆 المتصدرين:'),
        '',
        ...rows.map((r, i) => t('{m} {name} — {p} نقطة ({w} فوز)', { m: medal[i] || i + 1 + '.', name: r.name, p: r.points, w: r.wins })),
      ),
    );
    return;
  }

  // ---------- الرويال باس والدفع بالنجوم
  if (cmd === '/pass') {
    const season = seasonOf();
    const days = Math.max(1, Math.ceil((seasonEnd(season) - Date.now()) / 86400000));
    if (!isPrivate) {
      await send(L(t('🎖️ الرويال باس يتفعّل بالخاص: افتح البوت واكتب /pass')));
      return;
    }
    const can = await hub.canBuyPass(uid, season);
    if (!can.ok) {
      await send(L(t(can.error), t('باقي على نهاية الموسم {s}: {d} يوم', { s: season, d: days })), { reply_markup: kb([[playButton('')]]) });
      return;
    }
    await send(
      L(
        t('🎖️ الرويال باس — الموسم {s} (باقي {d} يوم)', { s: season, d: days }),
        t('المجاني: {f} لفل بجوائز. المميز: {p} لفل وجوائز أقوى وأشياء حصرية.', { f: PASS.freeMax, p: PASS.premiumMax }),
        t('السعر: {price} ⭐ — تدفع هنا بالنجوم مباشرة 👇', { price: passPrice(env) }),
      ),
    );
    await tg.call('sendInvoice', { chat_id: c.chatId, ...passInvoice(env, uid, season, c.lang) }).catch((e) => console.log('sendInvoice', e.message));
    return;
  }

  if (cmd === '/terms') {
    await send(
      L(
        t('📜 شروط «قلّدها»:'),
        t('• الرويال باس المميز ولفلاته يخصّون الموسم الحالي بس (30 يوم) ويفتحون جوائز رقمية داخل اللعبة.'),
        t('• باقات المايكات تنضاف لرصيدك داخل اللعبة وتصرفها بالمتجر.'),
        t('• الدفع بنجوم تيليجرام، والأشياء الرقمية ما تتحول لفلوس ولا تنباع.'),
        t('• إذا صارت مشكلة بالدفع اكتب /paysupport وراح نرد عليك.'),
        t('• نحتفظ بحق إيقاف الحسابات اللي تغش.'),
      ),
    );
    return;
  }

  if (cmd === '/paysupport' || cmd === '/support') {
    if (!arg) {
      await send(L(t('🛟 للمساعدة بالدفع أو اللعبة: اكتب الأمر ووياه مشكلتك، مثل:'), t('{cmd} دفعت وما تفعّل الباس', { cmd })));
      return;
    }
    const who = `${from.first_name || ''}${from.username ? ' @' + from.username : ''} (${fromId})`;
    for (const a of adminIds(env)) await tg.call('sendMessage', { chat_id: a, text: lines(`🛟 طلب مساعدة من ${who}:`, arg.slice(0, 1500)) }).catch(() => null);
    await send(L(t('✅ وصلت رسالتك، راح نرد عليك بأقرب وقت.')));
    return;
  }

  if (cmd === '/id') {
    await send(L(t('🆔 الآيدي مالتك: {id}', { id: fromId }), isAdmin ? t('✅ إنت أدمن') : t('حطه بـADMIN_IDS إذا تريد تصير أدمن')));
    return;
  }

  if (cmd === '/help') {
    const base = [
      t('/play — سوّي غرفة لعب'),
      t('/addsound — ضيف صوتك للعبة 🎙️'),
      t('/pass — الرويال باس المميز بالنجوم'),
      t('/top — المتصدرين'),
      t('/sounds — كم صوت شغّال باللعبة'),
      t('/paysupport — مساعدة بالدفع'),
      t('/terms — الشروط'),
      t('/id — الآيدي مالتك'),
    ];
    const adm = isAdmin
      ? [
          '',
          'أوامر الأدمن:',
          '/admin — لوحة المطوّر: إحصائيات، إذاعة، حظر، إعدادات',
          'دز صوت / فويس / فيديو = ينضاف للعبة (الكابشن = اسمه)',
          '/sounds — عدد الأصوات وكل الأصوات بأزرار (تعطيل وحذف)',
          '/ban آيدي سبب — حظر لاعب · /unban آيدي — فك الحظر',
          '/title رقم اسم — تغيير الاسم',
          '/refund رقم_العملية — يرجّع نجوم دفعة ويسحب اللي انطته',
          '/newusers — تشغيل/إطفاء إشعار كل لاعب جديد',
        ]
      : [];
    await send(L(...base) + (adm.length ? '\n' + lines(...adm) : ''));
    return;
  }

  // ---------- أوامر الأدمن
  if (isAdmin && (cmd === '/admin' || cmd === '/panel')) {
    if (!isPrivate) return void (await send(lines('🛠️ لوحة المطوّر تنفتح بالخاص ويا البوت بس')));
    await hub.delKV('adm:' + uid);
    const v = await adminHome(c);
    await send(v.text, { reply_markup: v.reply_markup });
    return;
  }
  if (isAdmin && cmd === '/ban') {
    const m = /^(\d{2,15})(?:\s+([\s\S]+))?$/.exec(arg);
    if (!m) return void (await send(lines('الصيغة: /ban الآيدي السبب', 'أو من /admin ← 🚫 الحظر (تكدر تحوّل رسالة منه)')));
    await banUser(c, m[1], (m[2] || '').trim());
    return;
  }
  if (isAdmin && cmd === '/unban') {
    const id = (/\d{2,15}/.exec(arg) || [])[0];
    const r = id ? await hub.unban('t' + id) : { ok: false };
    await send(lines(r.ok ? `✅ انفك الحظر عن ${id}` : 'الصيغة: /unban الآيدي (لازم يكون محظور)'));
    return;
  }
  if (isAdmin && (cmd === '/newusers' || cmd === '/notify')) {
    const cur = await hub.joinStats();
    const on = /^(on|1|تشغيل|شغل)$/i.test(arg) ? true : /^(off|0|اطفاء|إطفاء|طفي)$/i.test(arg) ? false : !cur.on;
    const s = await hub.setJoinNotify(on);
    await send(
      lines(
        s.on ? '🔔 إشعار كل لاعب جديد: شغّال' : '🔕 إشعار كل لاعب جديد: مطفي',
        `👥 كل اللاعبين: ${s.total} — جدد آخر 24 ساعة: ${s.today}`,
        'تبدّله بنفس الأمر: /newusers',
      ),
    );
    return;
  }
  if (isAdmin && cmd === '/sounds') {
    const menu = await soundsMenu(hub, 0);
    await send(menu.text, { reply_markup: menu.reply_markup });
    return;
  }
  if (cmd === '/sounds') {
    const n = await hub.soundCounts();
    await send(L(t('🎵 الأصوات الفعّالة باللعبة: {n}', { n: n.active })));
    return;
  }
  if (isAdmin && cmd === '/del') {
    const id = parseInt(arg, 10);
    const ok = id ? await hub.delSound(id) : false;
    await send(lines(ok ? `🗑️ انحذف الصوت #${id}` : 'اكتب رقم الصوت: /del 12'));
    return;
  }
  if (isAdmin && cmd === '/refund') {
    const charge = arg.trim();
    const pay = charge ? await hub.paymentByCharge(charge) : null;
    if (!pay) return void (await send(lines('اكتب رقم العملية: /refund رقم_العملية (يوصلك برسالة كل دفعة)')));
    if (pay.refunded) return void (await send(lines('هاي الدفعة مرجّعة من قبل')));
    try {
      await tg.call('refundStarPayment', { user_id: Number(String(pay.uid).slice(1)), telegram_payment_charge_id: charge });
      await hub.refundPayment(charge);
      await send(lines(`↩️ رجعت ${pay.stars} ⭐ للاعب ${String(pay.uid).slice(1)} وانسحب: ${packName(pay.sku || 'pass', pay.qty)}`));
    } catch (e) {
      await send(lines('❌ ما زبط الاسترجاع: ' + e.message));
    }
    return;
  }
  if (isAdmin && cmd === '/title') {
    const m = /^(\d+)\s+(.+)$/.exec(arg);
    const ok = m ? await hub.renameSound(parseInt(m[1], 10), m[2].slice(0, 40)) : false;
    await send(lines(ok ? `✏️ تغيّر الاسم` : 'الصيغة: /title 12 الاسم الجديد'));
    return;
  }

  // ---------- صوت بالخاص: الأدمن ينضاف مباشرة، واللاعب يصير اقتراح ينتظر موافقة الأدمن
  const media = mediaOf(msg);
  if (media && isPrivate) {
    if (!isAdmin) return startSub(c, msg, media);
    if (media.size && media.size > MAX_FILE) return void (await send(lines('❌ الملف أكبر من 20MB — تيليجرام ما يسمح للبوت ينزّله')));
    const title = (msg.caption || media.title || '').trim().slice(0, 40);
    const id = await hub.addSound({ title, file_id: media.file_id, kind: media.kind, dur: media.dur || 0, added_by: fromId });
    await hub.setKV('pending:' + fromId, JSON.stringify({ id, ts: Date.now() }));
    await send(
      lines(
        `✅ انضاف الصوت #${id}: «${title || 'صوت #' + id}»`,
        media.kind === 'video' ? '🎬 الفيديو نفسه راح ينعرض وقت المثال' : '🖼️ إذا تريد صورة تنعرض وياه، دزها هسه (خلال 10 دقايق)',
        (media.dur || 0) > 7 ? '✂️ ملاحظة: اللعبة تاخذ أول 7 ثواني بس' : '',
        'غيّر الاسم: /title ' + id + ' الاسم',
      ),
    );
    return;
  }

  if (msg.photo && isPrivate && isAdmin) {
    const raw = await hub.getKV('pending:' + fromId);
    const pend = raw ? JSON.parse(raw) : null;
    if (!pend || Date.now() - pend.ts > 10 * 60 * 1000) return void (await send(lines('دز الصوت أول، وبعدين الصورة')));
    const best = msg.photo[msg.photo.length - 1];
    await hub.setSoundImage(pend.id, best.file_id);
    await send(lines(`🖼️ انضافت الصورة للصوت #${pend.id}`));
    return;
  }

  if (isPrivate && text && !cmd) {
    await send(L(t('اضغط الزر وابدي اللعب 👇')), { reply_markup: kb([[playButton('')]]) });
  }
}

/* ------------------------------------------------------------ اقتراح صوت (اللاعب) */

/** يبدي الاقتراح: يطلب الملف. إذا وصل ملف وياه (media) ينتقل لخطوة الاسم مباشرة */
async function startSub(c, msg = null, media = null) {
  const { hub, t, L, send, uid } = c;
  if (!c.isPrivate) {
    const bot = await botName(c);
    await send(
      L(t('🎙️ تضيف صوتك من الخاص ويا البوت 👇')),
      bot ? { reply_markup: kb([[{ text: t('🎙️ ضيف صوتك للعبة'), url: `https://t.me/${bot}?start=addsound` }]]) } : {},
    );
    return;
  }
  const can = await hub.subCheck(uid);
  if (!can.ok) {
    await hub.delKV('sub:' + uid);
    await send(L(can.error === 'daily' ? t('✋ وصلت حد اليوم (10 أصوات) — جرّب باچر') : t('⏳ عندك 3 أصوات تنتظر المراجعة — انتظر لحد ما يردون عليها')));
    return;
  }
  if (media) return takeSubMedia(c, msg, media, true);
  await hub.setKV('sub:' + uid, JSON.stringify({ step: 'file', at: Date.now() }));
  await send(
    L(
      t('🎙️ ضيف صوتك للعبة!'),
      '',
      t('دز الصوت هسه: فويس، فيديو، فيديو دائري، أو ملف صوت — البوت ياخذ الصوت بس.'),
      t('⏱️ لازم أقل من {s} ثانية.', { s: SUB_MAX_SEC }),
      t('🎁 إذا انقبل: ينضاف للعبة ويا اسمك وصورتك، وتاخذ {m} 🎤 و{x} خبرة.', { m: SUB_REWARD, x: SUB_REWARD }),
      '',
      t('/cancel — إلغاء'),
    ),
  );
}

/** وصل ملف: نتأكد من المدة والحجم، وبعدين نطلب الاسم (أو ناخذه من الكابشن) */
async function takeSubMedia(c, msg, media, direct = false) {
  const { hub, t, L, send, uid } = c;
  if (media.size && media.size > MAX_FILE) {
    await hub.setKV('sub:' + uid, JSON.stringify({ step: 'file', at: Date.now() }));
    await send(L(t('❌ الملف أكبر من 20MB — دز ملف أصغر')));
    return;
  }
  if ((media.dur || 0) > SUB_MAX_SEC) {
    await hub.setKV('sub:' + uid, JSON.stringify({ step: 'file', at: Date.now() }));
    await send(L(t('⏱️ الصوت طويل ({d} ثانية) — لازم أقل من {s} ثانية. قصّه ودزه مرة ثانية.', { d: media.dur, s: SUB_MAX_SEC }), t('/cancel — إلغاء')));
    return;
  }
  const st = { step: 'name', at: Date.now(), file_id: media.file_id, type: media.type, dur: media.dur || 0 };
  // كتب الاسم بالكابشن: ما نسأله مرة ثانية
  const caption = cleanTitle(msg && msg.caption);
  if (caption.length >= 2) return finishSub(c, st, caption);
  await hub.setKV('sub:' + uid, JSON.stringify(st));
  await send(
    L(
      direct ? t('🎙️ تريد تضيف هذا الصوت للعبة؟ اكتب اسمه هسه (مثل: ضحكة شريرة)') : t('✍️ حلو! هسه اكتب اسم الصوت (مثل: ضحكة شريرة)'),
      direct ? t('🎁 إذا انقبل: ينضاف للعبة ويا اسمك وصورتك، وتاخذ {m} 🎤 و{x} خبرة.', { m: SUB_REWARD, x: SUB_REWARD }) : '',
      t('/cancel — إلغاء'),
    ),
  );
}

const cleanTitle = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);

/** رسالة بنص الخطوة: true = انعالجت */
async function subStep(c, msg, text) {
  const { t, L, send } = c;
  const st = c.info.sub;
  const media = mediaOf(msg);
  if (media) {
    await takeSubMedia(c, msg, media);
    return true;
  }
  if (st.step === 'file') {
    if (msg.photo || msg.sticker || msg.animation) {
      await send(L(t('🎙️ دز صوت أو فيديو بيه صوت — مو صورة')));
      return true;
    }
    if (text) {
      await send(L(t('🎙️ بعدني أنتظر الصوت: فويس، فيديو، أو ملف صوت (أقل من {s} ثانية)', { s: SUB_MAX_SEC }), t('/cancel — إلغاء')));
      return true;
    }
    return false;
  }
  if (st.step === 'name') {
    const title = cleanTitle(text);
    if (title.length < 2) {
      await send(L(t('✍️ اكتب اسم الصوت (حرفين أو أكثر)')));
      return true;
    }
    await finishSub(c, st, title);
    return true;
  }
  return false;
}

/** ينحفظ الاقتراح ويوصل للأدمن */
async function finishSub(c, st, title) {
  const { hub, t, L, send, uid, from, lang } = c;
  const can = await hub.subCheck(uid);
  await hub.delKV('sub:' + uid);
  if (!can.ok) {
    await send(L(can.error === 'daily' ? t('✋ وصلت حد اليوم (10 أصوات) — جرّب باچر') : t('⏳ عندك 3 أصوات تنتظر المراجعة — انتظر لحد ما يردون عليها')));
    return;
  }
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  const id = await hub.addSub({ uid, name, username: from.username || '', title, file_id: st.file_id, media: st.type, dur: st.dur, lang });
  const sub = await hub.sub(id);
  await send(
    L(
      t('✅ وصل صوتك «{title}» للمراجعة!', { title }),
      t('من ينقبل يوصلك إشعار، وتاخذ {m} 🎤 و{x} خبرة 🎉', { m: SUB_REWARD, x: SUB_REWARD }),
    ),
  );
  if (sub) await sendSubCard(c, sub);
}

/** بطاقة الصوت المقترح للأدمن: الصوت نفسه، وتحته المعلومات وأزرار القبول والرفض */
function subCard(s) {
  const id = String(s.uid).slice(1);
  return [
    `🎙️ صوت مقترح #${s.id}`,
    `🏷️ الاسم: «${esc(s.title)}»`,
    `👤 من: <a href="tg://user?id=${Number(id)}">${esc(s.name || 'لاعب')}</a>${s.username ? ' · @' + esc(s.username) : ''}`,
    `🆔 <code>${esc(id)}</code>`,
    `⏱️ ${s.dur ? s.dur + ' ثانية' : 'المدة ما معروفة'} · ${TYPE_NAME[s.media] || '📎 ملف'}${/video/.test(s.media) ? ' (اللعبة تاخذ الصوت بس)' : ''}`,
    '',
    `✅ قبول: ينضاف للعبة ويا صورته واسمه، وياخذ ${SUB_REWARD} 🎤 و${SUB_REWARD} خبرة`,
    '❌ رفض: أطلب منك السبب ويوصله',
  ]
    .map((l) => (l ? RLM + l : ''))
    .join('\n');
}

const subButtons = (s) => kb([[btn(`✅ قبول (+${SUB_REWARD} 🎤)`, 'sb|ok|' + s.id), btn('❌ رفض', 'sb|no|' + s.id)]]);

async function sendSubCard(c, s, only = null) {
  const [method, field] = SEND[s.media] || SEND.document;
  for (const a of only ? [only] : adminIds(c.env)) {
    const m = await c.tg.call(method, { chat_id: a, [field]: s.file_id }).catch(() => null);
    await c.tg
      .call('sendMessage', {
        chat_id: a,
        text: subCard(s),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(m && m.message_id ? { reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } } : {}),
        reply_markup: subButtons(s),
      })
      .catch(() => null);
  }
}

/** صورة بروفايل اللاعب (تنعرض ويا صوته). فارغة إذا ماكو أو مخفية */
async function userPhoto(tg, uid) {
  try {
    const r = await tg.call('getUserProfilePhotos', { user_id: Number(String(uid).slice(1)), limit: 1 });
    const sizes = r && r.photos && r.photos[0];
    if (!sizes || !sizes.length) return '';
    return (sizes.find((p) => p.width >= 320) || sizes[sizes.length - 1]).file_id;
  } catch {
    return '';
  }
}

/** رسالة النتيجة للاعب بلغته */
function subResult(s, ok, reason = '') {
  const lang = s.lang || 'ar';
  const t = (k, v) => tr(lang, k, v);
  const L = linesFor(lang);
  if (ok)
    return L(
      t('🎉 انقبل صوتك «{title}» وانضاف للعبة!', { title: s.title }),
      t('🎁 أخذت {m} 🎤 و{x} خبرة باس', { m: SUB_REWARD, x: SUB_REWARD }),
      t('اسمك وصورتك يطلعون ويا الصوت لكل اللاعبين 😎'),
    );
  return L(
    t('😕 ما انقبل صوتك «{title}»', { title: s.title }),
    reason ? t('السبب: {r}', { r: reason }) : '',
    t('تكدر تدز صوت ثاني من /addsound 🎙️'),
  );
}

/** بعد القرار: أزرار البطاقة تصير علامة وحدة */
async function markSub(tg, chat, mid, s) {
  if (!chat || !mid) return;
  const label = s.status === 'approved' ? `✅ انقبل${s.sound_id ? ' — صوت #' + s.sound_id : ''}` : '❌ انرفض';
  await tg.call('editMessageReplyMarkup', { chat_id: chat, message_id: mid, reply_markup: kb([[btn(label, 'noop')]]) }).catch(() => null);
}

async function rejectWithReason(c, st, reason) {
  const { hub, tg, send } = c;
  const r = await hub.rejectSub(st.id, reason);
  if (!r.ok) return void (await send(lines(r.error === 'done' ? 'هذا الصوت انحسم من قبل' : 'ما لگيت هذا الصوت')));
  await markSub(tg, st.chat, st.mid, r.sub);
  await tg.call('sendMessage', { chat_id: Number(String(r.sub.uid).slice(1)), text: subResult(r.sub, false, reason) }).catch(() => null);
  await send(lines(`❌ انرفض «${r.sub.title}»${reason ? ' ووصل السبب للاعب' : ' (بدون سبب)'}`));
}

/* ------------------------------------------------------------ لوحة المطوّر */

/** رسائل الأدمن اللي تكمّل خطوة (الإذاعة، الحظر، سبب الرفض). true = انعالجت */
async function adminStep(c, msg, text, cmd) {
  const { hub, uid, send } = c;
  const st = c.info.adm;
  if (cmd === '/cancel') return false;
  if (st.step === 'reject') {
    if (cmd && cmd !== '/skip') {
      await hub.delKV('adm:' + uid);
      return false;
    }
    if (!cmd && !text) {
      await send(lines('✍️ اكتب السبب كنص، أو /skip حتى ترفضه بدون سبب'));
      return true;
    }
    await hub.delKV('adm:' + uid);
    await rejectWithReason(c, st, cmd === '/skip' ? '' : text.slice(0, 300));
    return true;
  }
  // أي أمر ثاني يطلّعه من الخطوة
  if (cmd) {
    await hub.delKV('adm:' + uid);
    return false;
  }
  if (st.step === 'bc') {
    await hub.delKV('adm:' + uid);
    const s = await hub.adminStats();
    await send(lines(`📢 هاي الرسالة راح توصل لـ${s.reach} لاعب كما هي.`, 'أكيد؟'), {
      reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
      reply_markup: kb([[btn(`✅ أذيعها لـ${s.reach}`, `bc|go|${msg.message_id}`), btn('❌ إلغاء', 'bc|no')]]),
    });
    return true;
  }
  if (st.step === 'ban') {
    const fo = msg.forward_origin;
    let id = fo && fo.type === 'user' && fo.sender_user ? fo.sender_user.id : msg.forward_from ? msg.forward_from.id : null;
    let reason = '';
    if (!id && (fo || msg.forward_sender_name)) {
      await send(lines('🙈 هذا الحساب مخفي بالتحويل — دز الآيدي مالته رقم (يطلع بإشعار اللاعب الجديد)'));
      return true;
    }
    if (!id) {
      const m = /^(\d{2,15})(?:\s+([\s\S]+))?$/.exec(text);
      if (!m) {
        await send(lines('دز آيدي اللاعب (رقم) أو حوّل رسالة منه — /cancel للإلغاء'));
        return true;
      }
      id = m[1];
      reason = (m[2] || '').trim();
    }
    await hub.delKV('adm:' + uid);
    await banUser(c, id, reason);
    return true;
  }
  return false;
}

async function banUser(c, id, reason) {
  const { hub, env, send, fromId } = c;
  id = String(id);
  if (adminIds(env).includes(id)) return void (await send(lines('❌ ما تكدر تحظر أدمن')));
  const r = await hub.ban('t' + id, reason.slice(0, 200), fromId);
  if (!r.ok) return void (await send(lines('❌ الآيدي غلط')));
  await send(
    lines(`🚫 انحظر ${r.name || 'اللاعب'} (${id})`, reason ? `السبب: ${reason}` : '', 'ما يكدر يلعب ولا يستخدم البوت، وما توصله الإذاعة (يتطبق خلال ثواني)'),
    { reply_markup: kb([[btn('✅ فك الحظر', 'ub|t' + id)]]) },
  );
}

async function adminHome(c) {
  const s = await c.hub.adminStats();
  return {
    text: lines(
      '🛠️ لوحة المطوّر — قلّدها',
      '',
      `👥 اللاعبين: ${s.users} · جدد اليوم: ${s.new24}`,
      `🟢 نشطين اليوم: ${s.active24} · 🎮 ألعاب اليوم: ${s.gamesToday}`,
      s.maint ? '🛠️ وضع الصيانة شغّال — اللاعبين ما يكدرون يلعبون' : '',
      s.bc ? `📢 إذاعة شغّالة: ${s.bc.sent} من ${s.bc.total}` : '',
      s.subsPending ? `🎙️ ${s.subsPending} صوت مقترح ينتظرك` : '',
    ),
    reply_markup: kb([
      [btn('📊 الإحصائيات', 'ad|stats'), btn('📢 إذاعة', 'ad|bc')],
      [btn(`🚫 الحظر (${s.banned})`, 'ad|ban'), btn(`🎙️ المقترحة (${s.subsPending})`, 'ad|subs')],
      [btn('🎵 الأصوات', 'ad|snd'), btn('⚙️ إعدادات البوت', 'ad|set')],
    ]),
  };
}

function statsView(s) {
  const n = (x) => Number(x || 0).toLocaleString('en-US');
  return {
    text: lines(
      '📊 إحصائيات «قلّدها»',
      '',
      `👥 كل اللاعبين: ${n(s.users)} (توصلهم الإذاعة: ${n(s.reach)})`,
      `🆕 جدد: آخر 24 ساعة ${n(s.new24)} · آخر أسبوع ${n(s.new7)}`,
      `🟢 نشطين آخر 24 ساعة: ${n(s.active24)}`,
      `🎮 لعبوا ولو مرة: ${n(s.players)}`,
      `🕹️ ألعاب اليوم: ${n(s.gamesToday)} (${n(s.playsToday)} لاعب) · الكلي: ${n(s.gamesTotal)}`,
      `🎲 الغرف العامة هسه: ${n(s.rooms && s.rooms.rooms)} (ينتظرون: ${n(s.rooms && s.rooms.waiting)})`,
      `⭐ النجوم: ${n(s.stars)} (${n(s.payments)} دفعة) · آخر 24 ساعة: ${n(s.stars24)}`,
      `🎵 الأصوات الفعّالة: ${n(s.sounds)} (المكتبة ${n(s.library)} · المضافة ${n(s.custom)})`,
      `🎙️ مقترحة تنتظر: ${n(s.subsPending)}`,
      `🚫 محظورين: ${n(s.banned)}`,
      `🛠️ الصيانة: ${s.maint ? 'شغّالة' : 'مطفية'} · 🔔 إشعار الجدد: ${s.notify ? 'شغّال' : 'مطفي'}`,
    ),
    reply_markup: kb([[btn('🔄 تحديث', 'ad|stats'), btn('→ رجوع', 'ad|home')]]),
  };
}

function bcView(job) {
  return {
    text: lines('📢 الإذاعة شغّالة', '', `✅ وصلت: ${job.sent} من ${job.total}`, `❌ ما وصلت: ${job.failed}`, 'من تخلص يوصلك تقرير'),
    reply_markup: kb([[btn('⏹️ أوقف الإذاعة', 'bc|stop'), btn('🔄 الحالة', 'bc|st')], back()]),
  };
}

async function banView(c) {
  const [list, s] = await Promise.all([c.hub.bannedList(8), c.hub.adminStats()]);
  return {
    text: lines(
      '🚫 الحظر',
      '',
      'دز هسه آيدي اللاعب (رقم) أو حوّل رسالة منه حتى تحظره.',
      'أو بالأمر: /ban الآيدي السبب',
      '',
      `المحظورين: ${s.banned}`,
      ...list.map((b) => `• ${b.name || 'لاعب'} (${String(b.uid).slice(1)})${b.reason ? ' — ' + b.reason : ''}`),
    ),
    reply_markup: kb([...list.map((b) => [btn(`✅ فك الحظر: ${String(b.name || String(b.uid).slice(1)).slice(0, 24)}`, 'ub|' + b.uid)]), back()]),
  };
}

async function subsView(c) {
  const [list, s] = await Promise.all([c.hub.pendingSubs(8), c.hub.adminStats()]);
  return {
    text: lines(
      '🎙️ الأصوات المقترحة',
      '',
      list.length ? `تنتظر المراجعة: ${s.subsPending}` : '✅ ماكو أصوات تنتظر',
      ...list.map((x) => `#${x.id} «${x.title}» — ${x.name || 'لاعب'} · ${x.dur ? x.dur + ' ثانية' : '؟'}`),
      '',
      list.length ? 'اضغط على الصوت حتى أدزه إلك وتسمعه وتقرر' : 'اللاعبين يضيفون من /addsound أو زر «ضيف صوتك» باللعبة',
    ),
    reply_markup: kb([...list.map((x) => [btn(`▶️ #${x.id} ${x.title}`.slice(0, 60), 'sb|show|' + x.id)]), back()]),
  };
}

async function settingsView(c) {
  const s = await c.hub.adminStats();
  return {
    text: lines(
      '⚙️ إعدادات البوت',
      '',
      `🛠️ وضع الصيانة: ${s.maint ? 'شغّال (اللعبة والبوت واقفين للاعبين)' : 'مطفي'}`,
      `🔔 إشعار كل لاعب جديد: ${s.notify ? 'شغّال' : 'مطفي'}`,
      '',
      '♻️ ريست التوب: يحذف كل المتصدرين ويبدي الترتيب من صفر (اللفلات والمايكات والمشتريات والباس تبقى)',
      '🔗 إعادة ربط البوت: إذا غيّرت التوكن أو الأوامر ما تبين',
    ),
    reply_markup: kb([
      [btn(s.maint ? '✅ طفّي الصيانة' : '🛠️ شغّل الصيانة', 'ad|maint')],
      [btn(s.notify ? '🔕 طفّي إشعار الجدد' : '🔔 شغّل إشعار الجدد', 'ad|notify')],
      [btn('♻️ ريست التوب', 'ad|reset')],
      [btn('🔗 إعادة ربط البوت', 'ad|relink')],
      back(),
    ]),
  };
}

const resetView = () => ({
  text: lines(
    '⚠️ متأكد تريد تسوي ريست للتوب؟',
    '',
    'راح ينحذف كل المتصدرين (النقاط والفوز والألعاب بالترتيب) والكل يبدي من صفر.',
    'اللفلات والمايكات والأغراض والباس والمشتريات ما تنمس.',
    '',
    '⛔ ما تكدر ترجعه بعدين!',
  ),
  reply_markup: kb([[btn('🗑️ إي، سوّي ريست', 'ad|reset2')], back('ad|set', '→ لا، رجوع')]),
});

/* ------------------------------------------------------------ الأزرار */

async function handleCallback(q, deps) {
  const c = await contextOf(deps, q.from, q.message ? q.message.chat : null);
  const { tg, hub, isAdmin, t, info } = c;
  const answer = (text, alert = false) =>
    tg.call('answerCallbackQuery', { callback_query_id: q.id, text: String(text || '').slice(0, 190), show_alert: alert }).catch(() => null);
  const [act, a = '', b = ''] = String(q.data || '').split('|');
  if (act === 'noop') return answer('');

  // للاعبين: زر «ضيف صوتك» بالترحيب
  if (act === 'sub') {
    if (!isAdmin && info.banned) return answer(t('🚫 إنت محظور من البوت'), true);
    if (!isAdmin && info.maint) return answer(t('🛠️ البوت بالصيانة هسه — نرجع قريب'), true);
    await answer('');
    return startSub(c);
  }
  if (!isAdmin) return answer(t('بس الأدمن يكدر يعدّل الأصوات'));

  const edit = (v) =>
    q.message
      ? tg
          .call('editMessageText', {
            chat_id: q.message.chat.id,
            message_id: q.message.message_id,
            text: v.text,
            reply_markup: v.reply_markup,
            ...(v.parse_mode ? { parse_mode: v.parse_mode } : {}),
          })
          .catch(() => null)
      : null;

  try {
    if (act === 'ad') return await adminCallback(c, q, a, answer, edit);
    if (act === 'bc') return await bcCallback(c, q, a, b, answer, edit);
    if (act === 'sb') return await subCallback(c, q, a, b, answer);
    if (act === 'ub') {
      const r = await hub.unban(a);
      if (q.message && /^‏?🚫 انحظر/.test(q.message.text || '')) await markUnban(c, q);
      else await edit(await banView(c));
      return answer(r.ok ? '✅ انفك الحظر' : 'مو محظور');
    }
    return await soundsCallback(c, q, act, a, b, answer, edit);
  } catch (e) {
    console.log('callback error', e && e.message);
    await answer('صار خطأ، جرّب مرة ثانية');
  }
}

async function markUnban(c, q) {
  await c.tg
    .call('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: kb([[btn('✅ انفك الحظر', 'noop')]]) })
    .catch(() => null);
}

async function adminCallback(c, q, a, answer, edit) {
  const { hub, uid } = c;
  switch (a) {
    case 'home':
      await hub.delKV('adm:' + uid);
      await edit(await adminHome(c));
      return answer('');
    case 'stats':
      await edit(statsView(await hub.adminStats()));
      return answer('📊');
    case 'bc': {
      const s = await hub.adminStats();
      if (s.bc) {
        await edit(bcView(s.bc));
        return answer('');
      }
      await hub.setKV('adm:' + uid, JSON.stringify({ step: 'bc', at: Date.now() }));
      await edit({
        text: lines(
          '📢 الإذاعة',
          '',
          `دز هسه الرسالة اللي تريدها توصل لكل اللاعبين (${s.reach} لاعب): نص، صورة، فيديو، فويس، ملصق…`,
          'توصلهم كما هي بالضبط، وقبل ما تنرسل أسألك تأكيد.',
          '',
          '/cancel — إلغاء',
        ),
        reply_markup: kb([back()]),
      });
      return answer('📢 دز الرسالة');
    }
    case 'ban':
      await hub.setKV('adm:' + uid, JSON.stringify({ step: 'ban', at: Date.now() }));
      await edit(await banView(c));
      return answer('');
    case 'subs':
      await edit(await subsView(c));
      return answer('');
    case 'snd':
      await edit(await soundsMenu(hub, 0));
      return answer('');
    case 'set':
      await edit(await settingsView(c));
      return answer('');
    case 'maint': {
      const on = !(await hub.adminStats()).maint;
      await hub.setMaint(on);
      await edit(await settingsView(c));
      return answer(on ? '🛠️ الصيانة شغّالة — اللاعبين ما يكدرون يلعبون (إنت تكدر)' : '✅ طفت الصيانة — رجعت اللعبة للكل', true);
    }
    case 'notify': {
      const j = await hub.joinStats();
      await hub.setJoinNotify(!j.on);
      await edit(await settingsView(c));
      return answer(!j.on ? '🔔 شغّال' : '🔕 مطفي');
    }
    case 'reset':
      await edit(resetView());
      return answer('');
    case 'reset2': {
      const r = await hub.resetLeaderboard();
      await edit({
        text: lines(`✅ صار ريست للتوب — ${r.n} لاعب رجعوا صفر`, 'اللفلات والمايكات والأغراض والباس ما انمست'),
        reply_markup: kb([back('ad|set')]),
      });
      return answer('♻️ صار ريست للتوب', true);
    }
    case 'relink': {
      const r = await hub.ensureWebhook(c.origin, true);
      return answer(r.ok ? `✅ انربط البوت @${r.bot}` : '❌ ' + r.reason, true);
    }
  }
  return answer('');
}

async function bcCallback(c, q, a, b, answer, edit) {
  const { hub } = c;
  if (a === 'go') {
    const r = await hub.startBroadcast({ from: q.message.chat.id, msg: Number(b), by: c.fromId });
    if (r.error) return answer('📢 أكو إذاعة شغّالة هسه — وقّفها أو انتظرها تخلص', true);
    await edit({
      text: lines(`📢 بدت الإذاعة لـ${r.total} لاعب…`, 'توصلهم بدفعات (حدود تيليجرام)، ومن تخلص يوصلك تقرير'),
      reply_markup: kb([[btn('⏹️ أوقف الإذاعة', 'bc|stop'), btn('🔄 الحالة', 'bc|st')]]),
    });
    return answer('📢 بدت');
  }
  if (a === 'no') {
    await edit({ text: lines('❌ انلغت الإذاعة') });
    return answer('');
  }
  if (a === 'stop') {
    const r = await hub.cancelBroadcast();
    await edit({ text: lines(r.ok ? `⏹️ وقفت الإذاعة — وصلت لـ${r.job.sent} من ${r.job.total}` : 'ماكو إذاعة شغّالة'), reply_markup: kb([back()]) });
    return answer('');
  }
  if (a === 'st') {
    const s = await hub.adminStats();
    if (s.bc) await edit(bcView(s.bc));
    else await edit({ text: lines('✅ ماكو إذاعة شغّالة هسه (اللي قبل خلصت ووصلك تقريرها)'), reply_markup: kb([back()]) });
    return answer('🔄');
  }
  return answer('');
}

async function subCallback(c, q, a, b, answer) {
  const { hub, tg, uid } = c;
  const s = await hub.sub(Number(b));
  if (!s) return answer('ما لگيت هذا الصوت');
  const chat = q.message && q.message.chat.id;
  const mid = q.message && q.message.message_id;
  if (s.status !== 'pending') {
    if (a !== 'show') await markSub(tg, chat, mid, s);
    return answer(s.status === 'approved' ? '✅ انقبل من قبل' : '❌ انرفض من قبل');
  }
  if (a === 'show') {
    await sendSubCard(c, s, chat);
    return answer('');
  }
  if (a === 'ok') {
    const img = await userPhoto(tg, s.uid);
    const r = await hub.approveSub(s.id, img);
    if (!r.ok) return answer(r.error === 'done' ? 'انحسم من قبل' : 'ما لگيت هذا الصوت');
    await markSub(tg, chat, mid, { ...r.sub, sound_id: r.soundId });
    await tg
      .call('sendMessage', {
        chat_id: Number(String(s.uid).slice(1)),
        text: subResult(s, true),
        reply_markup: kb([[{ text: tr(s.lang || 'ar', '🎮 العب هسه'), web_app: { url: c.origin + '/' } }]]),
      })
      .catch(() => null);
    return answer(`✅ انقبل «${s.title}» وانضاف للعبة (صوت #${r.soundId})${img ? '' : ' — بدون صورة (مخفية أو ماكو)'}`, true);
  }
  if (a === 'no') {
    await hub.setKV('adm:' + uid, JSON.stringify({ step: 'reject', id: s.id, chat, mid, at: Date.now() }));
    await c.send(lines(`✍️ اكتب سبب رفض «${s.title}» — يوصل للاعب`, '/skip — ارفضه بدون سبب', '/cancel — تراجع'), {
      reply_markup: { force_reply: true, input_field_placeholder: 'سبب الرفض…' },
    });
    return answer('✍️ اكتب السبب');
  }
  return answer('');
}

/** أزرار قائمة الأصوات (/sounds) */
async function soundsCallback(c, q, act, key, pg, answer, edit) {
  const { hub } = c;
  const page = Number(pg) || 0;
  let note = '';
  if (act === 't') {
    const r = await hub.toggleSound(key);
    note = r ? `${r.active ? '✅ رجع' : '🚫 انعطل'}: ${r.title}` : 'ما لگيت هذا الصوت';
  } else if (act === 'd') {
    const r = await hub.deleteSound(key);
    note = r ? `${r.deleted ? '🗑️ انحذف' : '🚫 انعطل'}: ${r.title}` : 'ما لگيت هذا الصوت';
  } else if (act === 'ba') {
    await hub.setBuiltinAll(key === '1');
    note = key === '1' ? '🔊 رجعت أصوات النظام والمكتبة' : '🔇 انعطلت أصوات النظام والمكتبة';
  } else if (act === 'lr') {
    await hub.retryLibrary();
    note = '🔄 جاري التحميل… راح أبلغك من يخلص';
  }
  await edit(await soundsMenu(hub, page));
  await answer(note);
}

/* ------------------------------------------------------------ الدفع بالنجوم */

function parsePassPayload(payload) {
  const m = /^pass:(t\d+):(\d+)$/.exec(String(payload || ''));
  return m ? { uid: m[1], season: Number(m[2]), sku: 'pass' } : null;
}

/** اسم المشتريات للأدمن */
function packName(sku, qty) {
  if (sku === 'pass') return 'رويال باس مميز';
  const p = STAR_PACK.get(sku);
  if (!p) return sku;
  if (p.kind === 'mics') return `${qty || p.mics} مايك`;
  if (p.kind === 'levels') return `${qty || p.levels} لفل باس`;
  return 'باس مميز + 10 لفلات';
}

/** لغة اللاعب للدفع: اللي محفوظة من اللعبة، وإلا لغة تيليجرام */
async function payLang(hub, from) {
  const info = await hub.botInfo('t' + ((from && from.id) || '')).catch(() => null);
  return langOf(from, info && info.lang);
}

/** لازم نرد خلال 10 ثواني وإلا تيليجرام يلغي الدفع */
async function handlePreCheckout(q, deps) {
  const { env, hub } = deps;
  const tg = new Tg(env.TELEGRAM_BOT_TOKEN, env.TG_API_BASE);
  const lang = await payLang(hub, q.from);
  const p = parsePassPayload(q.invoice_payload) || parsePackPayload(q.invoice_payload);
  let error = '';
  if (!p || p.uid !== 't' + q.from.id) error = 'الفاتورة مو إلك — افتحها من حسابك';
  else {
    const price = p.sku === 'pass' ? passPrice(env) : packPrice(STAR_PACK.get(p.sku), passPrice(env));
    if (q.currency !== 'XTR' || q.total_amount !== price) error = 'السعر تغيّر، اطلب فاتورة جديدة';
    else {
      const can = await (p.sku === 'pass' ? hub.canBuyPass(p.uid, p.season) : hub.canBuyPack(p.uid, p.sku, p.season)).catch(() => ({ ok: false, error: 'صار خطأ، جرّب بعد شوية' }));
      if (!can.ok) error = can.error;
    }
  }
  await tg
    .call('answerPreCheckoutQuery', error ? { pre_checkout_query_id: q.id, ok: false, error_message: tr(lang, error) } : { pre_checkout_query_id: q.id, ok: true })
    .catch((e) => console.log('answerPreCheckoutQuery', e.message));
}

async function handlePaid(msg, deps) {
  const { env, hub } = deps;
  const tg = new Tg(env.TELEGRAM_BOT_TOKEN, env.TG_API_BASE);
  const sp = msg.successful_payment;
  const lang = await payLang(hub, msg.from);
  const t = (s, vars) => tr(lang, s, vars);
  // الروسي والإنكليزي من اليسار: بدون علامة RLM
  const out = (...l) => linesFor(lang)(...l.filter((x) => x !== ''));
  const charge = sp.telegram_payment_charge_id;
  const pass = parsePassPayload(sp.invoice_payload);
  const pack = pass ? null : parsePackPayload(sp.invoice_payload);
  const p = pass || pack;
  if (!p) return;
  let text;
  let r;
  if (pass) {
    r = await hub.grantPremium(p.uid, p.season, charge, sp.total_amount);
    const got = (r.rewards || []).length;
    text = out(
      r.already ? t('✅ الباس المميز مفعّل عندك') : t('🎉 تفعّل الرويال باس المميز للموسم {s}!', { s: r.season || p.season }),
      got ? t('🎁 استلمت {n} جوائز من اللفلات اللي وصلتها', { n: got }) : '',
      t('صار عندك {n} لفل بجوائز أقوى — العب وكمّل 💪', { n: PASS.premiumMax }),
      t('رقم العملية (للدعم): {c}', { c: charge }),
    );
  } else {
    r = await hub.grantPack(p.uid, p.sku, p.season, charge, sp.total_amount);
    const def = STAR_PACK.get(p.sku);
    const to = r.pass ? r.pass.to : null;
    const got = r.pass ? (r.pass.rewards || []).length : 0;
    let head;
    if (r.already) head = t('✅ هاي الدفعة انحسبت من قبل');
    else if (def.kind === 'mics') head = t('🎤 انضاف لرصيدك {n} مايك!', { n: Number(def.mics).toLocaleString('en-US') });
    else if (def.kind === 'levels') head = t('🎖️ تقدّم الباس {n} لفل — صرت لفل {to}!', { n: def.levels, to });
    else head = t('🎉 تفعّل الباس المميز ووياه 10 لفلات — صرت لفل {to}!', { to });
    text = out(head, got ? t('🎁 استلمت {n} جوائز من اللفلات اللي وصلتها', { n: got }) : '', t('رقم العملية (للدعم): {c}', { c: charge }));
  }
  await tg.call('sendMessage', { chat_id: msg.chat.id, text }).catch(() => null);
  if (r.already) return;
  const f = msg.from || {};
  const who = `${f.first_name || ''}${f.username ? ' @' + f.username : ''} (${p.uid.slice(1)})`.trim();
  for (const a of adminIds(env)) {
    await tg
      .call('sendMessage', { chat_id: a, text: lines(`💰 دفعة ${sp.total_amount} ⭐ — ${packName(p.sku)}`, `اللاعب: ${who}`, `للاسترجاع: /refund ${charge}`) })
      .catch(() => null);
  }
}
