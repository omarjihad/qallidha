// عميل Telegram Bot API + منطق البوت (أوامر، إضافة الأصوات من الأدمن).

import { GAME_NAME, MAX_PLAYERS, ROUNDS } from '../public/js/shared.js';
import { seasonOf, seasonEnd, PASS, STAR_PACK, packPrice } from '../public/js/catalog.js';
import { passInvoice, passPrice, parsePackPayload } from './pass.js';
import RU from '../public/js/lang/ru.js';

/** ترجمة رسالة عربية للروسي (نفس قاموس اللعبة) */
const tr = (lang, s) => (lang === 'ru' && typeof RU[s] === 'string' ? RU[s] : s);
const langOf = (from) => (/^(ru|uk|be|kk|ky|uz|tg|tk)/i.test(String((from && from.language_code) || '')) ? 'ru' : 'ar');

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

function mediaOf(msg) {
  if (msg.voice) return { file_id: msg.voice.file_id, kind: 'voice', size: msg.voice.file_size, dur: msg.voice.duration };
  if (msg.audio)
    return { file_id: msg.audio.file_id, kind: 'audio', size: msg.audio.file_size, dur: msg.audio.duration, title: msg.audio.title };
  if (msg.video) return { file_id: msg.video.file_id, kind: 'video', size: msg.video.file_size, dur: msg.video.duration };
  if (msg.video_note)
    return { file_id: msg.video_note.file_id, kind: 'video', size: msg.video_note.file_size, dur: msg.video_note.duration };
  const d = msg.document;
  if (d && /^(audio|video)\//.test(d.mime_type || ''))
    return { file_id: d.file_id, kind: d.mime_type.startsWith('video') ? 'video' : 'audio', size: d.file_size, title: d.file_name };
  return null;
}

const lines = (...l) => l.map((s) => (s ? RLM + s : '')).join('\n');

const PER_PAGE = 10;

/** سطور عدد الأصوات (للأدمن ولغيره) */
export function countLines(c) {
  const lib = c.library;
  const libExtra = [lib.pending ? `⏳ ${lib.pending} بعدها تنزل` : '', lib.failed ? `❌ ${lib.failed} ما نزلت` : ''].filter(Boolean).join('، ');
  return [
    `✅ الأصوات الفعّالة باللعبة: ${c.active}`,
    `🎌 مكتبة الميمز: ${lib.on} من ${lib.ready}${libExtra ? ` (${libExtra})` : ''}`,
    `🎵 أصوات النظام: ${c.builtin.on} من ${c.builtin.total}`,
    `🎙️ أصواتك المضافة: ${c.custom.on} من ${c.custom.total}`,
  ];
}

/** قائمة الأصوات للأدمن: كل صوت زر يفعّل/يعطّل، و🗑️ يحذف أصواتك نهائيًا. */
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
  const on = counts.active;
  const text = lines(
    ...countLines(counts),
    '',
    'اضغط على الصوت حتى تعطّله 🚫 أو ترجّعه ✅',
    '🗑️ = يطلع من اللعبة (أصواتك تنحذف نهائيًا، والباقي ينعطل)',
    on === 0 ? '⚠️ ماكو ولا صوت شغّال — اللعبة ما تبدي' : on < 4 ? `⚠️ ${on} أصوات بس = ${on} جولات` : '',
  );
  return { text, reply_markup: { inline_keyboard: rows } };
}

/**
 * يعالج تحديثًا واحدًا من تيليجرام. لا يرمي أبدًا.
 * deps: { env, origin, hub, claimRoom(chatId) → code }
 */
export async function handleUpdate(update, deps) {
  const { env, origin, hub } = deps;
  if (update.callback_query) return handleCallback(update.callback_query, deps);
  if (update.pre_checkout_query) return handlePreCheckout(update.pre_checkout_query, deps);
  const msg = update.message;
  if (!msg || !msg.chat) return;
  if (msg.successful_payment) return handlePaid(msg, deps);
  const tg = new Tg(env.TELEGRAM_BOT_TOKEN, env.TG_API_BASE);
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';
  const fromId = String(msg.from?.id || '');
  const isAdmin = adminIds(env).includes(fromId);
  const text = (msg.text || '').trim();
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = (cmdRaw || '').split('@')[0].toLowerCase();
  const arg = rest.join(' ').trim();
  const send = (t, extra = {}) => tg.call('sendMessage', { chat_id: chatId, text: t, ...extra }).catch(() => null);

  let bot = await hub.getKV('bot');
  if (!bot) {
    try {
      bot = (await tg.call('getMe')).username;
      await hub.setKV('bot', bot);
    } catch {
      bot = '';
    }
  }
  const link = bot ? appLink(bot, env) : '';

  const playButton = (room) => {
    if (isPrivate) return { text: '🎮 العب هسه', web_app: { url: origin + '/' + (room ? `?room=${room}` : '') } };
    if (link) return { text: '🎮 ادخل اللعبة', url: link + (room ? `?startapp=r${room}` : '') };
    return { text: '🎮 العب', url: origin + '/' };
  };

  try {
    // ---------- أوامر
    if (cmd === '/start' && isPrivate) {
      const m = /^r(\d{5})$/.exec(arg);
      const name = (msg.from?.first_name || '').slice(0, 20);
      const kb = [[playButton(m ? m[1] : '')]];
      if (bot) kb.push([{ text: '👥 ضيفني لكروب حتى تلعبون سوا', url: `https://t.me/${bot}?startgroup=play` }]);
      await send(
        lines(
          `🎤 هلا ${name}! هاي «${GAME_NAME}» — لعبة تقليد الأصوات.`,
          '',
          'تسمعون صوت (إسعاف، بزونة، ضحكة شريرة، ميمز…) والكل يقلّده بنفس اللحظة — فرصة وحدة بس!',
          'وبعدين كل تسجيل ينعاد قدام الكل، وياخذ درجة من 100.',
          'بين الجولات تدور العجلة: نقاط، مضاعفات، وتخريب على ربعك 😈',
          '',
          `🧑‍🤝‍🧑 لحد ${MAX_PLAYERS} لاعبين — ${ROUNDS} جولات`,
          '👇 اضغط وابدي',
        ),
        { reply_markup: { inline_keyboard: kb } },
      );
      return;
    }

    // بالكروب: /start (بعد الإضافة) و/play كلاهما يسوّي غرفة
    if (cmd === '/play' || cmd === '/game' || cmd === '/start') {
      const code = await deps.claimRoom(isPrivate ? null : chatId);
      await send(
        lines(
          '🎤 تحدي تقليد الأصوات بدأ!',
          `🔢 الغرفة: ${code}`,
          `🧑‍🤝‍🧑 لحد ${MAX_PLAYERS} لاعبين — أول واحد يدخل يصير المضيف`,
          '👇 ادخلوا من الزر',
        ),
        { reply_markup: { inline_keyboard: [[playButton(code)]] } },
      );
      return;
    }

    if (cmd === '/top') {
      const rows = await hub.top(10);
      if (!rows.length) return void (await send(lines('🏆 بعد ماكو أحد بالترتيب — كون أول واحد!')));
      const medal = ['🥇', '🥈', '🥉'];
      await send(
        lines(
          '🏆 المتصدرين:',
          '',
          ...rows.map((r, i) => `${medal[i] || i + 1 + '.'} ${r.name} — ${r.points} نقطة (${r.wins} فوز)`),
        ),
      );
      return;
    }

    // ---------- الرويال باس والدفع بالنجوم
    if (cmd === '/pass') {
      const uid = 't' + fromId;
      const season = seasonOf();
      const days = Math.max(1, Math.ceil((seasonEnd(season) - Date.now()) / 86400000));
      if (!isPrivate) {
        await send(lines('🎖️ الرويال باس يتفعّل بالخاص: افتح البوت واكتب /pass'));
        return;
      }
      const can = await hub.canBuyPass(uid, season);
      if (!can.ok) {
        await send(lines(can.error, `باقي على نهاية الموسم ${season}: ${days} يوم`), { reply_markup: { inline_keyboard: [[playButton('')]] } });
        return;
      }
      await send(
        lines(
          `🎖️ الرويال باس — الموسم ${season} (باقي ${days} يوم)`,
          `المجاني: ${PASS.freeMax} لفل بجوائز. المميز: ${PASS.premiumMax} لفل وجوائز أقوى وأشياء حصرية.`,
          `السعر: ${passPrice(env)} ⭐ — تدفع هنا بالنجوم مباشرة 👇`,
        ),
      );
      await tg.call('sendInvoice', { chat_id: chatId, ...passInvoice(env, uid, season) }).catch((e) => console.log('sendInvoice', e.message));
      return;
    }

    if (cmd === '/terms') {
      await send(
        lines(
          '📜 شروط «قلّدها»:',
          '• الرويال باس المميز ولفلاته يخصّون الموسم الحالي بس (30 يوم) ويفتحون جوائز رقمية داخل اللعبة.',
          '• باقات المايكات تنضاف لرصيدك داخل اللعبة وتصرفها بالمتجر.',
          '• الدفع بنجوم تيليجرام، والأشياء الرقمية ما تتحول لفلوس ولا تنباع.',
          '• إذا صارت مشكلة بالدفع اكتب /paysupport وراح نرد عليك.',
          '• نحتفظ بحق إيقاف الحسابات اللي تغش.',
        ),
      );
      return;
    }

    if (cmd === '/paysupport' || cmd === '/support') {
      if (!arg) {
        await send(lines('🛟 للمساعدة بالدفع أو اللعبة: اكتب الأمر ووياه مشكلتك، مثل:', `${cmd} دفعت وما تفعّل الباس`));
        return;
      }
      const admins = adminIds(env);
      const who = `${msg.from?.first_name || ''}${msg.from?.username ? ' @' + msg.from.username : ''} (${fromId})`;
      for (const a of admins) await tg.call('sendMessage', { chat_id: a, text: lines(`🛟 طلب مساعدة من ${who}:`, arg.slice(0, 1500)) }).catch(() => null);
      await send(lines('✅ وصلت رسالتك، راح نرد عليك بأقرب وقت.'));
      return;
    }

    if (cmd === '/id') {
      await send(lines(`🆔 الآيدي مالتك: ${fromId}`, isAdmin ? '✅ إنت أدمن' : 'حطه بـADMIN_IDS إذا تريد تصير أدمن'));
      return;
    }

    if (cmd === '/help') {
      const base = ['/play — سوّي غرفة لعب', '/pass — الرويال باس المميز بالنجوم', '/top — المتصدرين', '/sounds — كم صوت شغّال باللعبة', '/paysupport — مساعدة بالدفع', '/terms — الشروط', '/id — الآيدي مالتك'];
      const adm = isAdmin
        ? [
            '',
            'أوامر الأدمن:',
            'دز صوت / فويس / فيديو = ينضاف للعبة (الكابشن = اسمه)',
            '/sounds — عدد الأصوات وكل الأصوات بأزرار (تعطيل وحذف)',
            '/title رقم اسم — تغيير الاسم',
            '/refund رقم_العملية — يرجّع نجوم دفعة ويسحب اللي انطته',
          ]
        : [];
      await send(lines(...base, ...adm));
      return;
    }

    // ---------- أوامر الأدمن
    if (isAdmin && cmd === '/sounds') {
      const menu = await soundsMenu(hub, 0);
      await send(menu.text, { reply_markup: menu.reply_markup });
      return;
    }
    if (cmd === '/sounds') {
      const c = await hub.soundCounts();
      await send(lines(`🎵 الأصوات الفعّالة باللعبة: ${c.active}`));
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

    // ---------- إضافة صوت (الأدمن بالخاص)
    const media = mediaOf(msg);
    if (media && isPrivate) {
      if (!isAdmin) return void (await send(lines('بس الأدمن يكدر يضيف أصوات 🙂')));
      if (media.size && media.size > 20 * 1024 * 1024) return void (await send(lines('❌ الملف أكبر من 20MB — تيليجرام ما يسمح للبوت ينزّله')));
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

    if (isPrivate && text && !text.startsWith('/')) {
      await send(lines('اضغط الزر وابدي اللعب 👇'), { reply_markup: { inline_keyboard: [[playButton('')]] } });
    }
  } catch (e) {
    console.log('bot error', e && e.message);
  }
}

async function handleCallback(q, deps) {
  const { env, hub } = deps;
  const tg = new Tg(env.TELEGRAM_BOT_TOKEN, env.TG_API_BASE);
  const answer = (text) => tg.call('answerCallbackQuery', { callback_query_id: q.id, text: text || '' }).catch(() => null);
  const fromId = String((q.from && q.from.id) || '');
  if (!adminIds(env).includes(fromId)) return answer('بس الأدمن يكدر يعدّل الأصوات');
  const [act, key, pg] = String(q.data || '').split('|');
  const page = Number(pg) || 0;
  let note = '';
  try {
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
    if (q.message) {
      const menu = await soundsMenu(hub, page);
      await tg
        .call('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: menu.text, reply_markup: menu.reply_markup })
        .catch(() => null);
    }
  } catch (e) {
    note = 'صار خطأ، جرّب مرة ثانية';
    console.log('callback error', e && e.message);
  }
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

/** لازم نرد خلال 10 ثواني وإلا تيليجرام يلغي الدفع */
async function handlePreCheckout(q, deps) {
  const { env, hub } = deps;
  const tg = new Tg(env.TELEGRAM_BOT_TOKEN, env.TG_API_BASE);
  const lang = langOf(q.from);
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
  const lang = langOf(msg.from);
  const t = (s) => tr(lang, s);
  // الروسي يمين لليسار لا: بدون علامة RLM
  const out = lang === 'ru' ? (...l) => l.filter((x) => x !== '').join('\n') : lines;
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
      r.already ? t('✅ الباس المميز مفعّل عندك') : t('🎉 تفعّل الرويال باس المميز للموسم {s}!').replace('{s}', r.season || p.season),
      got ? t('🎁 استلمت {n} جوائز من اللفلات اللي وصلتها').replace('{n}', got) : '',
      t('صار عندك {n} لفل بجوائز أقوى — العب وكمّل 💪').replace('{n}', PASS.premiumMax),
      t('رقم العملية (للدعم): {c}').replace('{c}', charge),
    );
  } else {
    r = await hub.grantPack(p.uid, p.sku, p.season, charge, sp.total_amount);
    const def = STAR_PACK.get(p.sku);
    const to = r.pass ? r.pass.to : null;
    const got = r.pass ? (r.pass.rewards || []).length : 0;
    let head;
    if (r.already) head = t('✅ هاي الدفعة انحسبت من قبل');
    else if (def.kind === 'mics') head = t('🎤 انضاف لرصيدك {n} مايك!').replace('{n}', Number(def.mics).toLocaleString('en-US'));
    else if (def.kind === 'levels') head = t('🎖️ تقدّم الباس {n} لفل — صرت لفل {to}!').replace('{n}', def.levels).replace('{to}', to);
    else head = t('🎉 تفعّل الباس المميز ووياه 10 لفلات — صرت لفل {to}!').replace('{to}', to);
    text = out(head, got ? t('🎁 استلمت {n} جوائز من اللفلات اللي وصلتها').replace('{n}', got) : '', t('رقم العملية (للدعم): {c}').replace('{c}', charge));
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
