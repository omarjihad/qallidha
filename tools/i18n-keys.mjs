// يجمع كل النصوص العربية اللي تنعرض للاعب (مفاتيح الترجمة) ويقارنها بالقاموس الروسي.
// node tools/i18n-keys.mjs           → يطبع الناقص
// node tools/i18n-keys.mjs --all     → يطبع كل المفاتيح
import { readFileSync, readdirSync } from 'node:fs';
import { ITEMS, RARITY } from '../public/js/catalog.js';
import { WHEEL, SAB_INFO, GAME_NAME } from '../public/js/shared.js';
import RU from '../public/js/lang/ru.js';

const AR = /[\u0600-\u06FF]/;
const keys = new Map(); // key → where

function add(k, where) {
  if (!k || !AR.test(k)) return;
  if (!keys.has(k)) keys.set(k, where);
}

function unescape(s) {
  return s.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`').replace(/\\\\/g, '\\');
}

// 1) t('...') بالواجهة والسيرفر
const files = [
  ...readdirSync('public/js')
    .filter((f) => f.endsWith('.js'))
    .map((f) => 'public/js/' + f),
  'src/telegram.js',
];
const callRe = /\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(callRe)) {
    if (m[1] === '`' && m[2].includes('${')) {
      console.error(`⚠️ قالب بمتغيرات داخل t(): ${f}: ${m[2].slice(0, 60)}`);
      continue;
    }
    add(unescape(m[2]), f);
  }
}

// 2) نصوص بالبيانات تمر بـ t(): الأغراض، الندرة، العجلة، التخريب، تبويبات المتجر، الإعدادات، أخطاء الغرفة، المساعدة
for (const it of ITEMS) add(it.name, 'catalog');
for (const r of Object.values(RARITY)) add(r.name, 'catalog');
for (const w of WHEEL) {
  add(w.label, 'wheel');
  add(w.title, 'wheel');
  add(w.desc, 'wheel');
}
for (const s of Object.values(SAB_INFO)) add(s.name, 'sab');
add(GAME_NAME, 'shared');
const literalArrays = (f, re) => {
  const src = readFileSync(f, 'utf8');
  const block = re.exec(src);
  if (!block) return;
  for (const m of block[0].matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'/g)) add(unescape(m[1]), f);
};
literalArrays('public/js/meta.js', /const TABS = \[[\s\S]*?\];/);
literalArrays('public/js/settingsPanel.js', /const QUALITY = \[[\s\S]*?\];/);
literalArrays('public/js/settingsPanel.js', /const FPS = \[[\s\S]*?\];/);
literalArrays('public/js/settingsPanel.js', /const MIC = \[[\s\S]*?\];/);
literalArrays('public/js/settingsPanel.js', /const micHint = [\s\S]*?;/);
literalArrays('public/js/game.js', /const ROOM_ERRORS = \{[\s\S]*?\};/);
literalArrays('public/js/main.js', /const steps = \[[\s\S]*?\];/);
literalArrays('public/js/ads.js', /[\s\S]*/);

// 3) رسائل السيرفر اللي توصل للواجهة (error: '...')
for (const f of ['src/economy.js', 'src/worker.js', 'src/auth.js', 'src/telegram.js']) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:error|message|m)\s*[:=]\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g)) add(unescape(m[1]), f);
  for (const m of src.matchAll(/new AuthError\('([^']*)'\)/g)) add(m[1], f);
}

// كل النصوص العربية بالاقتصاد رسائل للاعب
{
  const src = readFileSync('src/economy.js', 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of src.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'/g)) add(unescape(m[1]), 'src/economy.js');
}
// رسائل احتياطية تمر بـ t(متغير)
for (const k of ['صار خطأ', 'ما زبط', 'ما زبطت الفاتورة', 'ما ينفع هسه', 'ماكو اتصال', 'خطأ بالاتصال', 'صار خطأ بالاتصال']) add(k, 'fallback');

const all = process.argv.includes('--all');
let missing = 0;
for (const [k, where] of keys) {
  if (all) console.log(JSON.stringify(k), '//', where);
  else if (!(k in RU)) {
    missing++;
    console.log(JSON.stringify(k) + ':', '//', where);
  }
}
const extra = Object.keys(RU).filter((k) => !keys.has(k));
console.error(`\n${keys.size} مفتاح · ناقص بالروسي: ${missing} · زايد بالقاموس: ${extra.length}`);
if (process.argv.includes('--extra')) for (const k of extra) console.error('  extra:', JSON.stringify(k));
process.exit(missing ? 1 : 0);
