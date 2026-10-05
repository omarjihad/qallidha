// فواتير نجوم تيليجرام (XTR): الرويال باس المميز، باقات المايكات، لفلات الباس، والمميز+.
// تُستعمل من التطبيق ومن البوت. العنوان والوصف بلغة اللاعب (عربي، روسي أو إنكليزي).

import { STAR_PACK, packPrice } from '../public/js/catalog.js';

export function passPrice(env) {
  return Math.max(1, Math.round(Number(env.PASS_PRICE_STARS) || 99));
}

const fmt = (n) => Number(n).toLocaleString('en-US');

const TEXT = {
  ar: {
    passTitle: (s) => `رويال باس مميز — الموسم ${s}`,
    passDesc: 'يفتح 100 لفل بالرويال باس بدل 50، وجوائز أقوى: شخصيات وإكسسوارات ومسارح حصرية ومايكات أكثر. للموسم الحالي.',
    passLabel: 'رويال باس مميز',
    micsTitle: (n) => `${fmt(n)} مايك 🎤`,
    micsDesc: (n) => `ينضاف لرصيدك ${fmt(n)} مايك تشتري بيها شخصيات وإكسسوارات ومسارح بلعبة «قلّدها».`,
    lvTitle: (n) => (n === 1 ? 'لفل رويال باس' : `${n} ${n <= 10 ? 'لفلات' : 'لفل'} رويال باس`),
    lvDesc: (n) => `يقدّم الرويال باس ${n === 1 ? 'لفل واحد' : n + (n <= 10 ? ' لفلات' : ' لفل')} بالموسم الحالي، وتستلم جوائزها فورًا.`,
    plusTitle: (s) => `باس مميز + 10 لفلات — موسم ${s}`,
    plusDesc: 'الباس المميز (100 لفل) ويا 10 لفلات هدية تستلم جوائزها فورًا. للموسم الحالي.',
  },
  ru: {
    passTitle: (s) => `Премиум-пропуск, сезон ${s}`,
    passDesc: 'Открывает 100 уровней пропуска вместо 50 и награды получше: эксклюзивные персонажи, аксессуары, сцены и больше микрофонов. На текущий сезон.',
    passLabel: 'Премиум-пропуск',
    micsTitle: (n) => `${fmt(n)} микрофонов 🎤`,
    micsDesc: (n) => `На баланс добавится ${fmt(n)} микрофонов — на них покупаются персонажи, аксессуары и сцены в игре «Повтори».`,
    lvTitle: (n) => (n === 1 ? '1 уровень пропуска' : `${n} уровней пропуска`),
    lvDesc: (n) => `Продвигает Королевский пропуск на ${n} ур. в текущем сезоне, награды выдаются сразу.`,
    plusTitle: (s) => `Премиум +10 ур., сезон ${s}`,
    plusDesc: 'Премиум-пропуск (100 уровней) и 10 уровней в подарок с наградами сразу. На текущий сезон.',
  },
  en: {
    passTitle: (s) => `Premium Royal Pass — Season ${s}`,
    passDesc: 'Unlocks 100 Royal Pass levels instead of 50, with better rewards: exclusive characters, accessories, stages and more mics. For the current season.',
    passLabel: 'Premium Royal Pass',
    micsTitle: (n) => `${fmt(n)} mics 🎤`,
    micsDesc: (n) => `Adds ${fmt(n)} mics to your balance — spend them on characters, accessories and stages in “Copy That!”.`,
    lvTitle: (n) => (n === 1 ? '1 Royal Pass level' : `${n} Royal Pass levels`),
    lvDesc: (n) => `Advances your Royal Pass by ${n === 1 ? '1 level' : n + ' levels'} this season. Rewards are delivered instantly.`,
    plusTitle: (s) => `Premium + 10 levels, S${s}`,
    plusDesc: 'The Premium Royal Pass (100 levels) plus 10 bonus levels with instant rewards. For the current season.',
  },
};

const pickLang = (lang) => TEXT[lang] || TEXT.ar;

/** فاتورة الرويال باس المميز بالنجوم (XTR) */
export function passInvoice(env, uid, season, lang = 'ar') {
  const L = pickLang(lang);
  return {
    title: L.passTitle(season),
    description: L.passDesc,
    payload: `pass:${uid}:${season}`,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: L.passLabel, amount: passPrice(env) }],
  };
}

/** فاتورة باقة نجوم (مايكات / لفلات / مميز+). payload: st:uid:sku:season */
export function packInvoice(env, uid, sku, season, lang = 'ar') {
  const pack = STAR_PACK.get(sku);
  if (!pack) return null;
  const L = pickLang(lang);
  let title;
  let description;
  if (pack.kind === 'mics') {
    title = L.micsTitle(pack.mics);
    description = L.micsDesc(pack.mics);
  } else if (pack.kind === 'levels') {
    title = L.lvTitle(pack.levels);
    description = L.lvDesc(pack.levels);
  } else {
    title = L.plusTitle(season);
    description = L.plusDesc;
  }
  return {
    title: title.slice(0, 32),
    description: description.slice(0, 255),
    payload: `st:${uid}:${sku}:${season}`,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: title.slice(0, 32), amount: packPrice(pack, passPrice(env)) }],
  };
}

/** يفك payload باقة: {uid, sku, season} أو null */
export function parsePackPayload(s) {
  const m = /^st:(t\d+):([a-z0-9]+):(\d+)$/.exec(String(s || ''));
  return m && STAR_PACK.has(m[2]) ? { uid: m[1], sku: m[2], season: Number(m[3]) } : null;
}
