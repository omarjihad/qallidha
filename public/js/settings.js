// إعدادات اللاعب: تنحفظ بالجهاز (localStorage) وتنسخ لحسابه بتيليجرام (CloudStorage) حتى تتبعه لأي جهاز.

import { tg as webApp, platform, unsafeUser } from './tg.js';
import { detectLang } from './lang/detect.js';

const KEY = 'qd_settings';
const CLOUD_KEY = 'settings';

export const DEFAULTS = {
  lang: '', // '' = حسب لغة تيليجرام
  quality: 'auto', // low | medium | high | max | auto
  fps: 60, // 30 | 45 | 60 | 90 | 120 | 0 (= حسب الشاشة)
  showFps: false,
  volume: 0.9, // الصوت العام 0..1
  sfx: 0.8, // أصوات الواجهة 0..1
  haptics: true,
  mic: 'auto', // auto | keep | release
  reactions: true,
};

const CHOICES = {
  quality: ['auto', 'low', 'medium', 'high', 'max'],
  fps: [30, 45, 60, 90, 120, 0],
  mic: ['auto', 'keep', 'release'],
  lang: ['', 'ar', 'ru', 'en'],
};

function clean(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in raw)) continue;
    const v = raw[k];
    if (CHOICES[k]) {
      if (CHOICES[k].includes(v)) out[k] = v;
    } else if (typeof DEFAULTS[k] === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = Math.max(0, Math.min(1, n));
    } else if (typeof DEFAULTS[k] === 'boolean') out[k] = !!v;
  }
  return out;
}

function readLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const listeners = new Set();
export const settings = clean(readLocal());
let hadLocal = !!readLocal();

function cloud() {
  try {
    return webApp && webApp.CloudStorage && webApp.isVersionAtLeast && webApp.isVersionAtLeast('6.9') ? webApp.CloudStorage : null;
  } catch {
    return null;
  }
}

function persist() {
  const json = JSON.stringify(settings);
  try {
    localStorage.setItem(KEY, json);
    hadLocal = true;
  } catch {
    /* وضع خاص */
  }
  const c = cloud();
  if (c) {
    try {
      c.setItem(CLOUD_KEY, json, () => undefined);
    } catch {
      /* */
    }
  }
}

/** يغيّر إعداد ويبلّغ المستمعين */
export function setSetting(key, value) {
  if (!(key in DEFAULTS)) return;
  const next = clean({ ...settings, [key]: value });
  if (next[key] === settings[key]) return;
  settings[key] = next[key];
  persist();
  for (const fn of listeners) fn(key, settings[key]);
}

export function resetSettings() {
  const lang = settings.lang;
  Object.assign(settings, DEFAULTS, { lang });
  persist();
  for (const k of Object.keys(DEFAULTS)) for (const fn of listeners) fn(k, settings[k]);
}

export function onSetting(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** أول مرة بجهاز جديد: ناخذ إعداداته من حسابه بتيليجرام. يرجع true إذا تغيّرت اللغة. */
export function syncFromCloud() {
  const c = cloud();
  if (!c || hadLocal) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      c.getItem(CLOUD_KEY, (err, value) => {
        if (err || !value) return resolve(false);
        let raw = null;
        try {
          raw = JSON.parse(value);
        } catch {
          return resolve(false);
        }
        const before = settings.lang;
        const next = clean(raw);
        for (const k of Object.keys(DEFAULTS)) {
          if (next[k] !== settings[k]) {
            settings[k] = next[k];
            for (const fn of listeners) fn(k, settings[k]);
          }
        }
        try {
          localStorage.setItem(KEY, JSON.stringify(settings));
          hadLocal = true;
        } catch {
          /* */
        }
        resolve(before !== settings.lang);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * اللغة الفعلية: اختيار اللاعب، وإلا لغة تيليجرام: عربي للعرب (حتى لو تيليجرامه إنكليزي وهو بدولة عربية)،
 * روسي للغات السلافية وآسيا الوسطى، وإنكليزي للباقين.
 */
export function currentLang() {
  if (settings.lang) return settings.lang;
  const u = unsafeUser();
  const code = String((u && u.language_code) || navigator.language || '');
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    /* */
  }
  return detectLang(code, tz, navigator.languages || []);
}

/** المايك يتسكّر بعد كل تسجيل؟ تيليجرام أندرويد يسأل عن الإذن كل مرة ينفتح، فهناك يبقى مفتوح */
export function releaseMicAfterRecord() {
  if (settings.mic === 'keep') return false;
  if (settings.mic === 'release') return true;
  return platform === 'ios';
}
