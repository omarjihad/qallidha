// ثوابت مشتركة بين السيرفر (Worker/Durable Objects) والواجهة.
// أي تعديل هنا يوصل للطرفين بنفس النشر.

export const VERSION = '1.4.0';
export const GAME_NAME = 'قلّدها';

export const ROUNDS = 4;
export const MAX_PLAYERS = 5;
export const MAX_REC = 7; // أقصى طول للصوت/التسجيل بالثواني
export const SKIN_COUNT = 8;
export const TAKE_SR = 16000;

// توقيتات اللعبة (ميلي ثانية)
export const T = {
  INTRO: 2600, // «الجولة 1 من 4»
  LOAD_WAIT: 9000, // أقصى انتظار لتحميل الصوت عند الكل
  LISTEN_LEAD: 900, // مهلة قبل تشغيل المثال
  AFTER_LISTEN: 350,
  REPRODUCE: 1700, // «حاول تقلّدها!»
  COUNT_STEP: 750, // كل رقم بالعد التنازلي (3، 2، 1)
  REC_MARGIN: 900, // يُضاف لطول التسجيل (مهلة للي يبدي متأخر)
  UPLOAD_GRACE: 4000, // انتظار وصول التسجيلات
  ANALYZE_MAX: 10000, // أقصى وقت للتحليل
  PLAY_LEAD: 900,
  WALK: 1100, // المشي للمايك
  REVEAL: 2200, // عرض الدرجة
  BACK: 500,
  NOTAKE: 1500,
  WHEEL_AUTOSPIN: 900, // العجلة تدور لوحدها أول ما تطلع
  WHEEL_MAX: 20000,
  SPIN_ANIM: 4300,
  TARGET_MAX: 7000,
  RESULT_HOLD: 1800,
  LOBBY_DROP: 20000, // حذف اللاعب المنقطع من غرفة الانتظار
  ROOM_TTL: 30 * 60 * 1000, // حذف الغرفة الفارغة
};

/** خط زمني لمرحلة الأداء — نفس الحساب بالسيرفر والواجهة. */
export function performTimeline(listenAt, dur) {
  const listenEnd = listenAt + dur * 1000;
  const reproduceAt = listenEnd + T.AFTER_LISTEN;
  const countAt = reproduceAt + T.REPRODUCE;
  const recAt = countAt + 3 * T.COUNT_STEP;
  const recDur = Math.min(MAX_REC, dur) * 1000 + T.REC_MARGIN;
  const recEnd = recAt + recDur;
  return { listenAt, listenEnd, reproduceAt, countAt, recAt, recDur, recEnd };
}

// قطع العجلة — بالترتيب مع عقارب الساعة ابتداءً من الأعلى.
// النقاط والمضاعفات تنحسب بالجولة الجاية (تنضاف ويا درجة تسجيلك)، والتخريب والتبديل على لاعب تختاره.
export const WHEEL = [
  { id: 'p10', kind: 'bonus', value: 10, label: '+10', icon: '⭐', color: '#a6dc2c', title: '+10 نقاط!', desc: 'تنضاف لدرجتك بالجولة الجاية' },
  { id: 'swap', kind: 'swap', label: 'تبديل', icon: '🔄', color: '#33c76e', title: 'تبديل الأصوات!', desc: 'اختار لاعب: بالجولة الجاية تتبادلون التسجيلات — تاخذ صوته ودرجته وياخذ صوتك' },
  { id: 'echo', kind: 'sab', sab: 'echo', label: 'صدى', icon: '🔊', color: '#2ccfc6', title: 'صدى!', desc: 'اختار لاعب: تسجيله الجاي يطلع بصدى' },
  { id: 'p20', kind: 'bonus', value: 20, label: '+20', icon: '🌟', color: '#27a7f2', title: '+20 نقطة!', desc: 'تنضاف لدرجتك بالجولة الجاية' },
  { id: 'chip', kind: 'sab', sab: 'chip', label: 'سنجاب', icon: '🐿️', color: '#3d6cf0', title: 'سنجاب!', desc: 'اختار لاعب: صوته الجاي يصير مثل السنجاب' },
  { id: 'x15', kind: 'mult', value: 1.5, label: '×1.5', icon: '✨', color: '#8b4fe6', title: '×1.5', desc: 'نقاطك بالجولة الجاية تنضرب ×1.5' },
  { id: 'chop', kind: 'sab', sab: 'chop', label: 'تقطيع', icon: '✂️', color: '#c23fe0', title: 'تقطيع!', desc: 'اختار لاعب: تسجيله الجاي يتقطّع' },
  { id: 'p5', kind: 'bonus', value: 5, label: '+5', icon: '⭐', color: '#ff3d9e', title: '+5 نقاط', desc: 'تنضاف لدرجتك بالجولة الجاية' },
  { id: 'dist', kind: 'sab', sab: 'dist', label: 'تشويش', icon: '📢', color: '#ff5656', title: 'تشويش!', desc: 'اختار لاعب: تسجيله الجاي يطلع مشوّش' },
  { id: 'x2', kind: 'mult', value: 2, label: '×2', icon: '💎', color: '#ff992b', title: '×2', desc: 'نقاطك بالجولة الجاية تتضاعف' },
  { id: 'crap', kind: 'sab', sab: 'crap', label: 'ضرطة', icon: '💩', color: '#ffd23a', title: 'ضرطة!', desc: 'اختار لاعب: الكل راح يسمع ضرطة بدل تسجيله!' },
];

export const WHEEL_WEIGHTS = { p10: 1.2, swap: 0.8, echo: 1, p20: 0.8, chip: 1, x15: 0.9, chop: 1, p5: 1.2, dist: 1, x2: 0.5, crap: 1 };

/** قطعة تحتاج تختار لاعب (تخريب أو تبديل) — ما تنكشف للباقين لحد الإعادة */
export const isTargeted = (seg) => !!seg && (seg.kind === 'sab' || seg.kind === 'swap');

export const SAB_INFO = {
  echo: { name: 'صدى', icon: '🔊' },
  chip: { name: 'سنجاب', icon: '🐿️' },
  chop: { name: 'تقطيع', icon: '✂️' },
  dist: { name: 'تشويش', icon: '📢' },
  crap: { name: 'ضرطة', icon: '💩' },
};

export const REACTIONS = ['😂', '🔥', '👏', '💩', '😱', '🤣'];

/** طول تشغيل التسجيل بعد التخريب (ثوانٍ) — يطابق effects.js حرفيًا. */
export function playbackSeconds(samples, types = []) {
  let d = samples / TAKE_SR;
  const set = new Set(types);
  if (set.has('crap')) d = Math.max(0.7, Math.min(4, d));
  if (set.has('chip')) d = d / 1.6;
  if (set.has('echo')) d = d + 0.8;
  return d;
}

export function median(list) {
  const a = list.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
