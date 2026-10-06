// هدايا الأدمن للاعب: مايكات، لفل، أغراض (شخصيات وإكسسوارات ومسارح)، الرويال باس المميز، ولفلات باس.
// الهدية ما تنحسب بالمدفوعات (إحصائيات النجوم تبقى صحيحة) وما تمس المتصدرين ولا المسابقة.

import { ITEM, ITEMS, MAX_LEVEL, levelOf, pointsForLevel, levelReward, seasonOf, PASS, isFree } from '../public/js/catalog.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(Number(v) || 0)));

/** مايكات */
export function giftMics(eco, uid, n) {
  n = clamp(n, 1, 1000000);
  eco.addMics(uid, n);
  return { mics: n };
}

/** يرفع لفل اللاعب للفل المطلوب (ويستلم جوائز اللفلات اللي عبرها مثل اللعب) */
export function giftLevel(eco, uid, to) {
  const row = eco.row(uid);
  if (!row) return { error: 'ماكو حساب' };
  to = clamp(to, 1, MAX_LEVEL);
  const from = levelOf(row.points);
  if (to <= from) return { error: `عنده لفل ${from} — اختار لفل أعلى` };
  let mics = 0;
  for (let l = from + 1; l <= to; l++) mics += levelReward(l);
  eco.sql.exec('UPDATE users SET points = MAX(points, ?) WHERE id = ?', pointsForLevel(to), uid);
  eco.addMics(uid, mics);
  return { from, to, mics };
}

/** أغراض للأبد. 'all' = كل الأغراض */
export function giftItems(eco, uid, items) {
  const list = items === 'all' || (Array.isArray(items) && items.includes('all')) ? ITEMS.map((x) => x.id) : Array.isArray(items) ? items : [items];
  const ids = [...new Set(list.map(String))].filter((id) => ITEM.has(id) && !isFree(ITEM.get(id)));
  if (!ids.length) return { error: 'اختار غرض واحد على الأقل' };
  const given = [];
  const had = [];
  for (const id of ids) {
    if (eco.giveItem(uid, id)) given.push(id);
    else had.push(id);
  }
  if (!given.length) return { error: 'عنده كل الأغراض اللي اخترتها', had };
  return { items: given, had };
}

/** الرويال باس المميز للموسم الحالي (وجوائز اللفلات اللي وصلها) */
export function giftPremium(eco, uid, now = Date.now()) {
  const season = seasonOf(now);
  const row = eco.row(uid);
  if (!row) return { error: 'ماكو حساب' };
  if (row.pass_prem === season) return { error: 'عنده الباس المميز لهالموسم' };
  eco.touchSeason(uid, now);
  eco.sql.exec('UPDATE users SET pass_prem = ? WHERE id = ?', season, uid);
  const rewards = eco.grantPassRewards(uid, now);
  const p = eco.passOf(eco.row(uid), now);
  return { season, level: p.level, rewards };
}

/** لفلات بالرويال باس (250 خبرة لكل لفل) */
export function giftPassLevels(eco, uid, n, now = Date.now()) {
  n = clamp(n, 1, PASS.premiumMax);
  eco.touchSeason(uid, now);
  const p = eco.passOf(eco.row(uid), now);
  if (p.level >= p.cap) return { error: p.premium ? 'خلّص الباس كله' : 'الباس المجاني واصل 50 — اهديه المميز أول' };
  const add = Math.min(n, p.cap - p.level);
  // نكمّل اللفل الحالي ونضيف الباقي (حتى يوصل بالضبط)
  const need = (p.level + add) * PASS.xpPerLevel - p.xp;
  const r = eco.addPassXp(uid, need, now);
  return { levels: add, from: r.from, to: r.to, rewards: r.rewards, season: p.season };
}
