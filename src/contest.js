// مسابقة المتصدرين (أسبوعية): نصوص البوت بلغة كل لاعب — البداية، التذكير، الفائزين، رسالة الفائز، وإشعار الأدمن.
// الحساب والتخزين بالـHub. الجوائز نجوم تيليجرام يدفعها الأدمن بإيده للفائزين.

import { tr } from './telegram.js';
import { fmtLeft, MEDALS } from '../public/js/contest.js';

const RLM = '‏';
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/** سطور الرسالة: العربي ياخذ RLM حتى يبين يمين لليسار */
function join(lang, lines) {
  return lines
    .filter((x) => x != null && x !== false)
    .map((s) => (s && lang === 'ar' ? RLM + s : s))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function prizeLines(c, t) {
  const p = c.prizes || [];
  return [
    p[0] ? t('🥇 المركز الأول: {n} ⭐', { n: fmt(p[0]) }) : null,
    p[1] ? t('🥈 المركز الثاني: {n} ⭐', { n: fmt(p[1]) }) : null,
    p[2] ? t('🥉 المركز الثالث: {n} ⭐', { n: fmt(p[2]) }) : null,
  ];
}

/**
 * نص إذاعة المسابقة بلغة اللاعب.
 * tpl: start (بدت) | remind (منشورة من قبل: الوقت المتبقي والمتصدرين هسه) | winners (خلصت)
 */
export function contestText(tpl, c, lang = 'ar', { top = [], now = Date.now() } = {}) {
  const t = (s, v) => tr(lang, s, v);
  const left = fmtLeft(c.end - now, lang);
  if (tpl === 'start') {
    return join(lang, [
      t('🔥 بدأت مسابقة المتصدرين!'),
      '',
      t('العب «قلّدها» وجمّع نقاط — أول 3 بالمتصدرين يربحون نجوم تيليجرام ⭐'),
      '',
      ...prizeLines(c, t),
      '',
      t('⏳ تبقى {left} على انتهاء المسابقة', { left }),
      '',
      t('🎮 النقاط تنحسب من اللعب ويا لاعبين ثانيين — عشوائي أو ويا ربعك'),
      t('👇 ادخل هسه ولحگ مكانك بالتوب!'),
    ]);
  }
  if (tpl === 'remind') {
    const p = c.prizes || [];
    const prizes = [p[0] ? `🥇 ${fmt(p[0])} ⭐` : '', p[1] ? `🥈 ${fmt(p[1])} ⭐` : '', p[2] ? `🥉 ${fmt(p[2])} ⭐` : ''].filter(Boolean).join(' · ');
    return join(lang, [
      t('⏰ مسابقة المتصدرين شغّالة!'),
      '',
      t('⏳ تبقى {left} على انتهاء المسابقة', { left }),
      prizes,
      '',
      top.length ? t('🏆 المتصدرين هسه:') : t('🏆 بعد ماكو أحد بالتوب — كون أول واحد!'),
      ...top.slice(0, 3).map((r, i) => t('{m} {name} — {p} نقطة', { m: MEDALS[i], name: r.name || t('لاعب'), p: fmt(r.points) })),
      '',
      t('👇 ادخل والعب قبل لا يخلص الوقت!'),
    ]);
  }
  // winners
  const w = c.winners || [];
  return join(lang, [
    t('🏁 خلصت مسابقة المتصدرين!'),
    '',
    w.length ? t('🏆 الفائزين:') : t('ماكو فائزين هالمرة — ماحد لعب ويا لاعبين ثانيين'),
    ...w.map((x) => t('{m} {name} — {p} نقطة — {s} ⭐', { m: MEDALS[x.rank - 1] || x.rank + '.', name: x.name || t('لاعب'), p: fmt(x.points), s: fmt(x.prize) })),
    '',
    w.length ? t('مبروك للفائزين 🎉 والمسابقة الجاية قريب — خليك جاهز 💪') : t('المسابقة الجاية قريب — خليك جاهز 💪'),
  ]);
}

/** رسالة الفائز (بلغته) */
export function winnerText(w, lang = 'ar') {
  const t = (s, v) => tr(lang, s, v);
  const place = [t('الأول'), t('الثاني'), t('الثالث')][w.rank - 1] || String(w.rank);
  return join(lang, [
    t('🎉 مبروك {name}!', { name: w.name || t('لاعب') }),
    t('فزت بالمركز {place} بمسابقة المتصدرين ({p} نقطة) وربحت {s} ⭐ نجمة تيليجرام!', { place, p: fmt(w.points), s: fmt(w.prize) }),
    t('🎁 الجائزة توصلك من المطوّر قريبًا.'),
  ]);
}

/** إشعار الأدمن من تخلص المسابقة (عربي، HTML) */
export function adminEndText(c) {
  const lines = [
    `🏁 خلصت مسابقة المتصدرين #${c.id}`,
    '',
    ...(c.winners && c.winners.length
      ? c.winners.map(
          (w) =>
            `${MEDALS[w.rank - 1] || w.rank + '.'} <a href="tg://user?id=${Number(String(w.uid).slice(1))}">${esc(w.name || 'لاعب')}</a>` +
            `${w.username ? ' @' + esc(w.username) : ''} · <code>${esc(String(w.uid).slice(1))}</code> — ${fmt(w.points)} نقطة (${fmt(w.games)} لعبة) — <b>${fmt(w.prize)} ⭐</b>`,
        )
      : ['ماكو فائزين (ماحد لعب ويا لاعبين ثانيين خلال المسابقة)']),
    '',
    c.winners && c.winners.length ? '💸 ادفع الجوائز بإيدك (اضغط على الاسم ← هدية ← نجوم)، وبعدين أشّر «✅ انطيته» من لوحة المطوّر باللعبة.' : '',
    '📢 تكدر تعلن الفائزين لكل اللاعبين من لوحة المطوّر ← 🏆 المسابقة.',
  ];
  return lines
    .map((l) => (l ? RLM + l : ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** أزرار رسائل المسابقة: العب + المتصدرين (داخل الخاص بس) */
export function contestButtons(origin, lang = 'ar') {
  const t = (s) => tr(lang, s);
  return {
    inline_keyboard: [
      [{ text: t('🎮 العب هسه'), web_app: { url: origin + '/' } }],
      [{ text: t('🏆 شوف المتصدرين'), web_app: { url: origin + '/?view=contest' } }],
    ],
  };
}
