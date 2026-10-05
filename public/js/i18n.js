// الترجمة: النص العربي بالكود هو المفتاح، وقاموس اللغة (روسي أو إنكليزي) يرجّع المقابل.
// t('الجولة {r} من {n}', {r: 1, n: 4}) — المتغيرات بين {}، والقيمة بالقاموس ممكن تكون دالة (للجمع).
// تغيير اللغة يعيد تحميل اللعبة، فاللغة ثابتة طول الجلسة.

import RU from './lang/ru.js';
import EN from './lang/en.js';
import { currentLang } from './settings.js';

export const LANG = currentLang();
export const RTL = LANG === 'ar';

const DICT = LANG === 'ru' ? RU : LANG === 'en' ? EN : null;
const missing = new Set();

function fill(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars && vars[k] != null ? String(vars[k]) : m));
}

/** يترجم نص عربي للغة الحالية */
export function t(s, vars) {
  if (s == null) return '';
  const key = String(s);
  if (DICT) {
    const v = DICT[key];
    if (typeof v === 'function') return v(vars || {});
    if (typeof v === 'string') return fill(v, vars);
    if (/[؀-ۿ]/.test(key) && !missing.has(key)) {
      missing.add(key);
      console.warn(`[i18n] ${LANG} missing:`, key);
    }
  }
  return fill(key, vars);
}

/** اتجاه الصفحة ولغتها */
export function applyLang() {
  const root = document.documentElement;
  root.lang = LANG;
  root.dir = RTL ? 'rtl' : 'ltr';
  root.dataset.lang = LANG;
}

/** النصوص اللي ما لكت ترجمة (للتشخيص) */
export function missingKeys() {
  return [...missing];
}

/** رقم مع إشارة + يبقى صحيح وسط النص العربي */
export const plusNum = (n) => `⁦+${Number(n || 0).toLocaleString('en-US')}⁩`;
