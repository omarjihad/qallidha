// الاقتصاد المشترك بين السيرفر والواجهة: المايكات، اللفلات، الرويال باس، والمتجر.
// أي تعديل هنا يوصل للطرفين بنفس النشر.

export const CUR = { name: 'مايكات', one: 'مايك', icon: '🎤' };

/* ------------------------------------------------------------ اللفل (1–100) من مجموع النقاط */
export const MAX_LEVEL = 100;

/** مجموع النقاط المطلوبة حتى توصل للفل L (يصعب تدريجيًا) */
export function pointsForLevel(L) {
  const x = Math.max(0, Math.min(MAX_LEVEL, L) - 1);
  return 60 * x + 9 * x * x;
}

export function levelOf(points) {
  const p = Math.max(0, Number(points) || 0);
  const x = Math.floor((-60 + Math.sqrt(3600 + 36 * p)) / 18);
  return Math.max(1, Math.min(MAX_LEVEL, 1 + x));
}

/** تقدّم اللفل: {level, from, to, frac} */
export function levelProgress(points) {
  const level = levelOf(points);
  const from = pointsForLevel(level);
  const to = level >= MAX_LEVEL ? from : pointsForLevel(level + 1);
  const frac = level >= MAX_LEVEL ? 1 : (points - from) / Math.max(1, to - from);
  return { level, from, to, frac: Math.max(0, Math.min(1, frac)) };
}

/** مكافأة الوصول للفل (مايكات) */
export function levelReward(L) {
  return L % 10 === 0 ? 120 : 20;
}

/* ------------------------------------------------------------ مايكات اللعبة الوحدة */
export function gameMics(score, winner) {
  return 5 + Math.round(Math.max(0, score) / 10) + (winner ? 15 : 0);
}

/* ------------------------------------------------------------ المواسم والرويال باس */
export const SEASON_DAYS = 30;
export const SEASON_EPOCH = Date.UTC(2026, 9, 1); // 1 تشرين الأول 2026
const DAY = 86400000;

export function seasonOf(now = Date.now()) {
  return Math.max(1, Math.floor((now - SEASON_EPOCH) / (SEASON_DAYS * DAY)) + 1);
}

export function seasonEnd(season) {
  return SEASON_EPOCH + season * SEASON_DAYS * DAY;
}

export const PASS = {
  xpPerLevel: 250,
  freeMax: 50,
  premiumMax: 100,
  adXp: 60, // تقدّم بإعلان
  adXpPerDay: 3,
};

/** لفل الباس من الخبرة: 0 بالبداية، 250 خبرة لكل لفل، الحد 50 للمجاني و100 للمميز */
export function passLevel(xp, premium) {
  return Math.min(premium ? PASS.premiumMax : PASS.freeMax, Math.floor(Math.max(0, xp) / PASS.xpPerLevel));
}

/* ------------------------------------------------------------ المتجر */
// type: skin | head | face | stage
// price: سعر بالمايكات (0 = مجاني، null = مو للبيع)
// ads: عدد الإعلانات اللي تفتحه للأبد (0 = لا)
// pass: 'free' | 'premium' = جائزة حصرية بالباس
// rarity: common | rare | epic | legendary
export const ITEMS = [
  // ---- الشخصيات الأصلية (مجانية)
  { id: 'skin:0', type: 'skin', skin: 0, name: 'الموظف', icon: '👔', price: 0, rarity: 'common' },
  { id: 'skin:1', type: 'skin', skin: 1, name: 'الوردية', icon: '🎀', price: 0, rarity: 'common' },
  { id: 'skin:2', type: 'skin', skin: 2, name: 'أبو الكاب', icon: '🧢', price: 0, rarity: 'common' },
  { id: 'skin:3', type: 'skin', skin: 3, name: 'أبو الطاقية', icon: '🧶', price: 0, rarity: 'common' },
  { id: 'skin:4', type: 'skin', skin: 4, name: 'الشقرة', icon: '🌼', price: 0, rarity: 'common' },
  { id: 'skin:5', type: 'skin', skin: 5, name: 'رجل الأعمال', icon: '💼', price: 0, rarity: 'common' },
  { id: 'skin:6', type: 'skin', skin: 6, name: 'أبو الشعر', icon: '🧑🏾', price: 0, rarity: 'common' },
  { id: 'skin:7', type: 'skin', skin: 7, name: 'الأستاذ', icon: '🤓', price: 0, rarity: 'common' },
  // ---- شخصيات مقفولة
  { id: 'skin:8', type: 'skin', skin: 8, name: 'النينجا', icon: '🥷', price: 700, ads: 3, rarity: 'epic' },
  { id: 'skin:9', type: 'skin', skin: 9, name: 'الزومبي', icon: '🧟', price: 700, ads: 3, rarity: 'epic' },
  { id: 'skin:10', type: 'skin', skin: 10, name: 'الروبوت', icon: '🤖', price: 900, ads: 4, rarity: 'epic' },
  { id: 'skin:11', type: 'skin', skin: 11, name: 'القرصان', icon: '🏴‍☠️', price: 700, ads: 3, rarity: 'rare' },
  { id: 'skin:12', type: 'skin', skin: 12, name: 'الطباخ', icon: '👨‍🍳', price: 500, ads: 2, rarity: 'rare' },
  { id: 'skin:13', type: 'skin', skin: 13, name: 'الروك ستار', icon: '🎸', price: null, pass: 'free', rarity: 'epic' },
  { id: 'skin:14', type: 'skin', skin: 14, name: 'الملك', icon: '🤴', price: null, pass: 'premium', rarity: 'legendary' },
  { id: 'skin:15', type: 'skin', skin: 15, name: 'رائد الفضاء', icon: '🧑‍🚀', price: null, pass: 'premium', rarity: 'legendary' },

  // ---- إكسسوارات الراس
  { id: 'head:party', type: 'head', name: 'قبعة حفلة', icon: '🥳', price: 150, ads: 1, rarity: 'common' },
  { id: 'head:cap', type: 'head', name: 'كاب بالمقلوب', icon: '🧢', price: 150, ads: 1, rarity: 'common' },
  { id: 'head:chef', type: 'head', name: 'قبعة طباخ', icon: '🍳', price: 200, ads: 1, rarity: 'common' },
  { id: 'head:headphones', type: 'head', name: 'سماعات', icon: '🎧', price: 350, ads: 2, rarity: 'rare' },
  { id: 'head:bunny', type: 'head', name: 'آذان أرنب', icon: '🐰', price: 350, ads: 2, rarity: 'rare' },
  { id: 'head:cowboy', type: 'head', name: 'قبعة كاوبوي', icon: '🤠', price: 400, ads: 2, rarity: 'rare' },
  { id: 'head:straw', type: 'head', name: 'قبعة قش', icon: '👒', price: 400, ads: 2, rarity: 'rare' },
  { id: 'head:tophat', type: 'head', name: 'قبعة رسمية', icon: '🎩', price: 450, ads: 2, rarity: 'rare' },
  { id: 'head:horns', type: 'head', name: 'قرون', icon: '😈', price: 700, ads: 3, rarity: 'epic' },
  { id: 'head:crown', type: 'head', name: 'تاج', icon: '👑', price: 900, ads: 4, rarity: 'epic' },
  { id: 'head:halo', type: 'head', name: 'هالة', icon: '😇', price: null, pass: 'free', rarity: 'epic' },
  { id: 'head:flower', type: 'head', name: 'تاج ورد', icon: '🌸', price: null, pass: 'free', rarity: 'rare' },
  { id: 'head:viking', type: 'head', name: 'خوذة فايكنغ', icon: '⚔️', price: null, pass: 'premium', rarity: 'epic' },
  { id: 'head:wizard', type: 'head', name: 'قبعة ساحر', icon: '🧙', price: null, pass: 'premium', rarity: 'epic' },
  { id: 'head:propeller', type: 'head', name: 'طاقية مروحة', icon: '🌀', price: null, pass: 'premium', rarity: 'rare' },
  { id: 'head:goldcrown', type: 'head', name: 'التاج الذهبي', icon: '💎', price: null, pass: 'premium', rarity: 'legendary' },

  // ---- إكسسوارات الوجه
  { id: 'face:clown', type: 'face', name: 'خشم مهرج', icon: '🤡', price: 120, ads: 1, rarity: 'common' },
  { id: 'face:sunglasses', type: 'face', name: 'نظارة شمسية', icon: '🕶️', price: 150, ads: 1, rarity: 'common' },
  { id: 'face:nerd', type: 'face', name: 'نظارة طبية', icon: '👓', price: 150, ads: 1, rarity: 'common' },
  { id: 'face:mustache', type: 'face', name: 'شوارب', icon: '🥸', price: 300, ads: 2, rarity: 'rare' },
  { id: 'face:eyepatch', type: 'face', name: 'رقعة قرصان', icon: '🏴‍☠️', price: 350, ads: 2, rarity: 'rare' },
  { id: 'face:star', type: 'face', name: 'نظارة نجوم', icon: '🤩', price: null, pass: 'free', rarity: 'epic' },
  { id: 'face:mask', type: 'face', name: 'لثام نينجا', icon: '🥷', price: null, pass: 'premium', rarity: 'epic' },
  { id: 'face:monocle', type: 'face', name: 'مونوكل', icon: '🧐', price: null, pass: 'premium', rarity: 'rare' },

  // ---- المسارح (مسرح المضيف ينطبق على كل الغرفة)
  { id: 'stage:classic', type: 'stage', name: 'الكلاسيكي', icon: '🎭', price: 0, rarity: 'common' },
  { id: 'stage:night', type: 'stage', name: 'ليلة نجوم', icon: '🌙', price: 800, ads: 4, rarity: 'rare' },
  { id: 'stage:studio', type: 'stage', name: 'الاستوديو', icon: '📺', price: 900, ads: 4, rarity: 'rare' },
  { id: 'stage:beach', type: 'stage', name: 'البحر', icon: '🏖️', price: 1000, ads: 4, rarity: 'epic' },
  { id: 'stage:neon', type: 'stage', name: 'نيون', icon: '💜', price: 1200, ads: 5, rarity: 'epic' },
  { id: 'stage:candy', type: 'stage', name: 'الحلويات', icon: '🍭', price: null, pass: 'free', rarity: 'epic' },
  { id: 'stage:gold', type: 'stage', name: 'المسرح الذهبي', icon: '🏆', price: null, pass: 'premium', rarity: 'legendary' },
  { id: 'stage:jungle', type: 'stage', name: 'الغابة', icon: '🌴', price: null, pass: 'premium', rarity: 'epic' },
];

export const ITEM = new Map(ITEMS.map((x) => [x.id, x]));
export const SLOTS = ['skin', 'head', 'face', 'stage'];
export const DEFAULT_EQUIP = { skin: null, head: null, face: null, stage: 'stage:classic' };
export const RARITY = {
  common: { name: 'عادي', color: '#9aa4b2' },
  rare: { name: 'نادر', color: '#3a86ff' },
  epic: { name: 'ملحمي', color: '#a24bff' },
  legendary: { name: 'أسطوري', color: '#ffb000' },
};

/** مجاني لكل لاعب بدون شراء */
export function isFree(item) {
  return !!item && item.price === 0;
}

/* ------------------------------------------------------------ جوائز الرويال باس */
// كل لفل: جائزة مجانية (1–50) وجائزة مميزة (1–100). المميز ياخذ الاثنين.
const FREE_SPECIAL = {
  5: { mics: 50 },
  10: { item: 'face:star' },
  15: { mics: 100 },
  20: { item: 'head:halo' },
  25: { mics: 150 },
  30: { item: 'stage:candy' },
  35: { mics: 200 },
  40: { item: 'head:flower' },
  45: { mics: 300 },
  50: { item: 'skin:13' },
};
const PREMIUM_SPECIAL = {
  5: { item: 'face:mask' },
  10: { mics: 200 },
  15: { item: 'head:viking' },
  20: { mics: 300 },
  25: { item: 'stage:gold' },
  30: { mics: 400 },
  35: { item: 'skin:14' },
  40: { mics: 500 },
  45: { item: 'stage:jungle' },
  50: { mics: 600 },
  55: { item: 'head:wizard' },
  60: { mics: 700 },
  65: { item: 'face:monocle' },
  70: { mics: 800 },
  75: { item: 'head:propeller' },
  80: { mics: 900 },
  85: { item: 'head:goldcrown' },
  90: { mics: 1000 },
  95: { mics: 1000 },
  100: { item: 'skin:15' },
};

export function passReward(level, track) {
  if (track === 'free') {
    if (level < 1 || level > PASS.freeMax) return null;
    return FREE_SPECIAL[level] || { mics: 15 };
  }
  if (level < 1 || level > PASS.premiumMax) return null;
  return PREMIUM_SPECIAL[level] || { mics: 30 };
}

/* ------------------------------------------------------------ الإعلانات المكافأة */
export const ADS = {
  coins: { mics: 20, perDay: 5 },
  box: { perDay: 1 },
  pass: { xp: PASS.adXp, perDay: PASS.adXpPerDay },
  trialHours: 24,
  doubleWindowMs: 15 * 60 * 1000, // تضاعف مايكات اللعبة خلال ربع ساعة بعدها
};

/** يوم اليوم بتوقيت بغداد (للحدود اليومية) */
export function dayKey(now = Date.now()) {
  return new Date(now + 3 * 3600000).toISOString().slice(0, 10);
}
