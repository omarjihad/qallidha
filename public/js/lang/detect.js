// اختيار لغة اللاعب تلقائيًا (مشترك بين اللعبة والبوت — بدون شي خاص بالمتصفح).
// العربي للعرب، الروسي للغات السلافية وآسيا الوسطى، والإنكليزي لكل الباقين.

export const LANGS = ['ar', 'ru', 'en'];

// لغات تيليجرام اللي ناسها يفهمون الروسي أكثر من الإنكليزي
export const CYRILLIC = ['ru', 'uk', 'be', 'kk', 'ky', 'uz', 'tg', 'tk', 'az', 'hy', 'ka', 'mn'];

// مناطق الوقت بالدول العربية: اللي تيليجرامه إنكليزي وهو بالعراق مثلًا، اللعبة تطلعله عربي
const ARAB_TZ =
  /^(Asia\/(Baghdad|Basra|Riyadh|Kuwait|Qatar|Bahrain|Dubai|Muscat|Aden|Amman|Damascus|Beirut|Gaza|Hebron)|Africa\/(Cairo|Tripoli|Tunis|Algiers|Casablanca|El_Aaiun|Khartoum|Nouakchott|Mogadishu|Djibouti)|Indian\/Comoro)$/;

/** من language_code مال تيليجرام (أو المتصفح): ar | ru | en. فارغ = عربي (جمهور اللعبة) */
export function langFromCode(code) {
  const c = String(code || '').toLowerCase();
  if (!c) return 'ar';
  const two = c.slice(0, 2);
  if (two === 'ar' || c === 'ckb' || two === 'ku') return 'ar';
  if (CYRILLIC.includes(two)) return 'ru';
  return 'en';
}

/** نفس الشي بس ويا منطقة الوقت ولغات الجهاز: الإنكليزي بالدول العربية يصير عربي */
export function detectLang(code, tz = '', deviceLangs = []) {
  const byCode = langFromCode(code);
  if (byCode !== 'en') return byCode;
  if (ARAB_TZ.test(String(tz || ''))) return 'ar';
  if ((deviceLangs || []).some((l) => /^ar\b/i.test(String(l || '')))) return 'ar';
  return 'en';
}
