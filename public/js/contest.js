// مسابقة المتصدرين: الثوابت وتنسيق الوقت المتبقي — مشترك بين السيرفر (البوت) والواجهة.
// أي تعديل هنا يوصل للطرفين بنفس النشر.

/** الجوائز الافتراضية بنجوم تيليجرام: الأول، الثاني، الثالث */
export const CONTEST_PRIZES = [150, 75, 50];
/** مدة المسابقة الافتراضية (أيام) */
export const CONTEST_DAYS = 7;
/** اللعبة تنحسب للمسابقة بس إذا بيها لاعبين تيليجرام اثنين أو أكثر (اللعب وحدك ما ينحسب) */
export const CONTEST_MIN_PLAYERS = 2;
export const MEDALS = ['🥇', '🥈', '🥉'];

const pad = (n) => String(n).padStart(2, '0');

/** الوقت المتبقي بالأجزاء */
export function leftParts(ms) {
  const t = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

/** «6 أيام» / «6 days» / «6 дней» */
export function daysLabel(d, lang = 'ar') {
  d = Math.max(0, Math.floor(Number(d) || 0));
  if (lang === 'en') return d === 1 ? '1 day' : `${d} days`;
  if (lang === 'ru') {
    const a = d % 10;
    const b = d % 100;
    return `${d} ${a === 1 && b !== 11 ? 'день' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'дня' : 'дней'}`;
  }
  return d === 1 ? 'يوم' : d === 2 ? 'يومين' : d >= 3 && d <= 10 ? `${d} أيام` : `${d} يوم`;
}

/** الساعات والدقايق والثواني: «23:59:59» (وأقل من يوم «1:11:11») */
export function hmsLeft(ms) {
  const { d, h, m, s } = leftParts(ms);
  return `${d ? pad(h) : h}:${pad(m)}:${pad(s)}`;
}

/**
 * «6 أيام و 23:59:59» — وأقل من يوم «1:11:11».
 * الإنكليزي «6d 23:59:59» والروسي «6 д 23:59:59».
 */
export function fmtLeft(ms, lang = 'ar') {
  const { d } = leftParts(ms);
  const hms = hmsLeft(ms);
  if (!d) return hms;
  if (lang === 'en') return `${d}d ${hms}`;
  if (lang === 'ru') return `${d} д ${hms}`;
  return `${daysLabel(d, 'ar')} و ${hms}`;
}

/** الجوائز صالحة؟ (أرقام موجبة، ثلاثة) */
export function cleanPrizes(p) {
  const a = Array.isArray(p) ? p : CONTEST_PRIZES;
  return [0, 1, 2].map((i) => Math.max(0, Math.min(100000, Math.round(Number(a[i]) || 0))));
}
