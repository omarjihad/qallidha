// لوحة المطوّر داخل اللعبة: كل أوامر البوت + المسابقة + الهدايا. الطلب يوصل هنا بس بعد التأكد إنه أدمن (initData موقّعة + ADMIN_IDS).
// الردود عربي (اللوحة للأدمن). رسائل اللاعبين (الهدايا) بلغة كل لاعب.

import { Tg, adminIds, tr, decideSub } from './telegram.js';
import { ITEM, PASS } from '../public/js/catalog.js';
import { CONTEST_DAYS } from '../public/js/contest.js';

const RLM = '‏';
const BC_BUSY = '📢 أكو إذاعة شغّالة هسه — انتظرها تخلص أو وقّفها';
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/** رسالة «وصلتك هدية» للاعب بلغته */
export function giftText(kind, res, lang = 'ar') {
  const t = (s, v) => tr(lang, s, v);
  const lines = [t('🎁 وصلتك هدية من المطوّر!'), ''];
  if (kind === 'mics') lines.push(t('• {n} 🎤 مايك', { n: fmt(res.mics) }));
  else if (kind === 'level') lines.push(t('• ⭐ صرت لفل {n}', { n: res.to }) + (res.mics ? ` (+${fmt(res.mics)} 🎤)` : ''));
  else if (kind === 'items') {
    for (const id of res.items || []) {
      const it = ITEM.get(id);
      if (it) lines.push(`• ${it.icon} ${t(it.name)}`);
    }
  } else if (kind === 'pass') lines.push(t('• 🎖️ الرويال باس المميز — الموسم {s}', { s: res.season }));
  else if (kind === 'passlv') lines.push(t('• 🎖️ +{n} لفل بالرويال باس (صرت لفل {to})', { n: res.levels, to: res.to }));
  const got = (res.rewards || []).length;
  if (got) lines.push(t('🎁 واستلمت {n} جوائز من الباس', { n: got }));
  lines.push('', t('👇 افتح اللعبة وشوف هديتك'));
  return lines.map((l) => (l && lang === 'ar' ? RLM + l : l)).join('\n');
}

/** نتيجة موحّدة */
const fail = (error, extra = {}) => ({ error, ...extra });

/**
 * ينفّذ أمر من اللوحة. deps: {env, origin, hub}, me: الأدمن (المستخدم الموثّق)
 */
export async function adminApi(deps, me, body) {
  const { env, origin, hub } = deps;
  const token = (env.TELEGRAM_BOT_TOKEN || '').trim();
  const tg = token ? new Tg(token, env.TG_API_BASE) : null;
  const by = String(me.tgId);
  const op = String(body.op || '');
  const uidOf = (v) => {
    const s = String(v || '').trim().replace(/^@/, '');
    const m = /^t?(\d{1,15})$/.exec(s);
    return m ? 't' + m[1] : '';
  };

  switch (op) {
    /* ---------------- الرئيسية */
    case 'dash': {
      const [stats, contest] = await Promise.all([hub.adminStats(), hub.contestAdmin()]);
      return { ok: true, stats, contest };
    }

    /* ---------------- المسابقة */
    case 'contest':
      return { ok: true, ...(await hub.contestAdmin()) };
    case 'contest.preview':
      return { ok: true, ...(await hub.contestPreview({ days: Number(body.days) || CONTEST_DAYS, prizes: body.prizes })) };
    case 'contest.publish': {
      // expect: شنو كان يشوف الأدمن (بداية/تذكير) — إذا اللوحة قديمة ما نسوي غير اللي قصده
      const r = await hub.contestPublish({
        origin,
        by,
        days: Number(body.days) || CONTEST_DAYS,
        prizes: body.prizes,
        silent: !!body.silent,
        expect: String(body.expect || ''),
        cid: Number(body.cid) || 0,
      });
      if (r.error) return fail(r.error === 'bc_running' || r.error === 'running' ? BC_BUSY : r.message || r.error);
      return { ok: true, tpl: r.tpl, total: r.total, ...(await hub.contestAdmin()) };
    }
    case 'contest.announce': {
      const r = await hub.contestAnnounce({ origin, by });
      if (r.error) return fail(r.error === 'bc_running' ? BC_BUSY : r.error);
      return { ok: true, total: r.total, ...(await hub.contestAdmin()) };
    }
    case 'contest.end': {
      const r = await hub.contestEndNow();
      if (r.error) return fail(r.error);
      return { ok: true, ...(await hub.contestAdmin()) };
    }
    case 'contest.cancel': {
      const r = await hub.contestCancel();
      if (r.error) return fail(r.error);
      return { ok: true, ...(await hub.contestAdmin()) };
    }
    case 'contest.edit': {
      const r = await hub.contestEdit({ prizes: body.prizes || null, end: body.end || null });
      if (r.error) return fail(r.error);
      return { ok: true, ...(await hub.contestAdmin()) };
    }
    case 'contest.paid': {
      const r = await hub.contestPaid(Number(body.cid), String(body.uid || ''), body.paid !== false);
      if (r.error) return fail(r.error);
      return { ok: true, ...(await hub.contestAdmin()) };
    }

    /* ---------------- اللاعبين والهدايا */
    case 'users':
      return { ok: true, users: await hub.adminFind(String(body.q || '')) };
    case 'user': {
      const u = await hub.adminUser(uidOf(body.uid));
      return u ? { ok: true, user: u } : fail('ما لگيت هذا اللاعب');
    }
    case 'gift': {
      const uid = uidOf(body.uid);
      if (!uid) return fail('آيدي غلط');
      const kind = String(body.kind || '');
      const r = await hub.gift(uid, kind, { n: body.n, to: body.to, items: body.items }, by);
      if (r.error) return fail(r.error);
      // رسالة للاعب بالبوت (بلغته) — إذا ما حاظر البوت
      let dm = false;
      if (tg && body.notify !== false) {
        const lang = await hub.langFor(uid);
        dm = await tg
          .call('sendMessage', {
            chat_id: Number(uid.slice(1)),
            text: giftText(kind, r.res, lang),
            reply_markup: { inline_keyboard: [[{ text: tr(lang, '🎮 العب هسه'), web_app: { url: origin + '/' } }]] },
          })
          .then(() => true)
          .catch(() => false);
      }
      return { ok: true, kind, res: r.res, user: r.user, dm };
    }
    case 'gifts':
      return { ok: true, gifts: await hub.adminGifts(30) };
    case 'dm': {
      // رابط اللاعب يوصلك بالبوت (تضغطه وتفتح حسابه — مثلًا حتى تهديه نجوم)
      const uid = uidOf(body.uid);
      const u = uid ? await hub.adminUser(uid) : null;
      if (!u) return fail('ما لگيت هذا اللاعب');
      if (!tg) return fail('البوت ما مربوط');
      const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
      const note = String(body.note || '').slice(0, 200);
      await tg.call('sendMessage', {
        chat_id: me.tgId,
        parse_mode: 'HTML',
        text: [
          note ? `${RLM}${esc(note)}` : '',
          `${RLM}👤 <a href="tg://user?id=${Number(u.id)}">${esc(u.name || 'لاعب')}</a>${u.username ? ' · @' + esc(u.username) : ''}`,
          `${RLM}🆔 <code>${esc(u.id)}</code>`,
          `${RLM}اضغط على الاسم حتى ينفتح حسابه`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
      return { ok: true };
    }

    /* ---------------- الحظر */
    case 'banned':
      return { ok: true, list: await hub.bannedList(50) };
    case 'ban': {
      const uid = uidOf(body.uid);
      if (!uid) return fail('آيدي غلط');
      if (adminIds(env).includes(uid.slice(1))) return fail('ما تكدر تحظر أدمن');
      const r = await hub.ban(uid, String(body.reason || '').slice(0, 200), by);
      return r.ok ? { ok: true, name: r.name, list: await hub.bannedList(50) } : fail('الآيدي غلط');
    }
    case 'unban': {
      const r = await hub.unban(uidOf(body.uid));
      return r.ok ? { ok: true, list: await hub.bannedList(50) } : fail('مو محظور');
    }

    /* ---------------- الإذاعة */
    case 'bc': {
      const text = String(body.text || '').trim();
      if (text.length < 2) return fail('اكتب الرسالة أول');
      if (text.length > 4000) return fail('الرسالة طويلة (الحد 4000 حرف)');
      const r = await hub.startBroadcast({ kind: 'text', text, button: body.button !== false, origin, by });
      if (r.error) return fail(BC_BUSY);
      return { ok: true, total: r.total };
    }
    case 'bc.stop': {
      const r = await hub.cancelBroadcast();
      return { ok: true, stopped: r.ok, job: r.job };
    }
    case 'bc.status': {
      const s = await hub.adminStats();
      return { ok: true, bc: s.bc, reach: s.reach };
    }

    /* ---------------- الأصوات المقترحة */
    case 'subs':
      return { ok: true, subs: await hub.adminSubs(30) };
    case 'sub.ok':
    case 'sub.no': {
      const r = await decideSub(deps, Number(body.id), op === 'sub.ok', String(body.reason || ''));
      if (r.error) return fail(r.error, { subs: await hub.adminSubs(30) });
      return { ok: true, soundId: r.soundId || null, img: r.img, subs: await hub.adminSubs(30) };
    }

    /* ---------------- الأصوات */
    case 'sounds':
      return { ok: true, sounds: await hub.adminSounds(), counts: await hub.soundCounts() };
    case 'sound.toggle': {
      const r = await hub.toggleSound(String(body.key || ''));
      return r ? { ok: true, ...r } : fail('ما لگيت هذا الصوت');
    }
    case 'sound.del': {
      const r = await hub.deleteSound(String(body.key || ''));
      return r ? { ok: true, ...r } : fail('ما لگيت هذا الصوت');
    }
    case 'sound.rename': {
      const key = String(body.key || '');
      const title = String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!key.startsWith('c:') || title.length < 1) return fail('تكدر تغيّر اسم الأصوات المضافة بس');
      return (await hub.renameSound(Number(key.slice(2)), title)) ? { ok: true } : fail('ما لگيت هذا الصوت');
    }
    case 'sounds.builtin':
      await hub.setBuiltinAll(!!body.on);
      return { ok: true };
    case 'sounds.retry':
      await hub.retryLibrary();
      return { ok: true };

    /* ---------------- المدفوعات */
    case 'payments':
      return { ok: true, payments: await hub.adminPayments(40) };
    case 'refund': {
      const charge = String(body.charge || '').trim();
      const pay = charge ? await hub.paymentByCharge(charge) : null;
      if (!pay) return fail('ما لگيت هاي الدفعة');
      if (pay.refunded) return fail('هاي الدفعة مرجّعة من قبل');
      if (!tg) return fail('البوت ما مربوط');
      try {
        await tg.call('refundStarPayment', { user_id: Number(String(pay.uid).slice(1)), telegram_payment_charge_id: charge });
      } catch (e) {
        return fail('ما زبط الاسترجاع: ' + e.message);
      }
      await hub.refundPayment(charge);
      return { ok: true, payments: await hub.adminPayments(40) };
    }

    /* ---------------- الإعدادات */
    case 'maint':
      await hub.setMaint(!!body.on);
      return { ok: true, stats: await hub.adminStats() };
    case 'notify':
      await hub.setJoinNotify(!!body.on);
      return { ok: true, stats: await hub.adminStats() };
    case 'resetTop': {
      const r = await hub.resetLeaderboard();
      return { ok: true, n: r.n };
    }
    case 'relink': {
      const r = await hub.ensureWebhook(origin, true);
      return r.ok ? { ok: true, bot: r.bot } : fail(r.reason || 'ما زبط');
    }

    /* ---------------- ثوابت للواجهة */
    case 'meta':
      return { ok: true, xpPerLevel: PASS.xpPerLevel };
  }
  return fail('أمر غلط');
}
