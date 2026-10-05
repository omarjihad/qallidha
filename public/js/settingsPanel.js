// نافذة الإعدادات ⚙️: اللغة، الجودة، الفريمات، الصوت، الاهتزاز، المايك، التفاعلات.
// بطبقة خاصة (#sheet) حتى ما تتسكّر وية تغيّر مراحل اللعبة.

import { settings, setSetting, resetSettings, onSetting } from './settings.js';
import { t, LANG } from './i18n.js';
import { $, el } from './ui.js';
import { haptic, platform, isRotated, toLocalPoint } from './tg.js';
import { VERSION } from './shared.js';

const QUALITY = [
  ['auto', 'تلقائي'],
  ['low', 'واطية'],
  ['medium', 'متوسطة'],
  ['high', 'عالية'],
  ['max', 'أعلى شي'],
];
const FPS = [
  [30, '30'],
  [45, '45'],
  [60, '60'],
  [90, '90'],
  [120, '120'],
  [0, 'حسب الشاشة'],
];
const MIC = [
  ['auto', 'تلقائي'],
  ['keep', 'يبقى مفتوح'],
  ['release', 'يتسكّر بعد كل تسجيل'],
];
const LANGS = [
  ['ar', 'العربية'],
  ['en', 'English'],
  ['ru', 'Русский'],
];

let open = null;

export function settingsOpen() {
  return !!open;
}

export function closeSettings() {
  const sheet = $('#sheet');
  if (!sheet) return;
  sheet.className = '';
  sheet.innerHTML = '';
  if (open && open.off) open.off();
  const cb = open && open.onClose;
  open = null;
  if (cb) cb();
}

/** يفتح الإعدادات. inGame: داخل غرفة (اللغة تتغيّر بس من القائمة) */
export function openSettings({ inGame = false, onClose = null, stats = null } = {}) {
  const sheet = $('#sheet');
  const row = (icon, title, control, hint = null) =>
    el('div', { class: 'set-row' }, el('div', { class: 'set-label' }, el('span', { class: 'set-ic' }, icon), el('b', {}, title), hint ? el('small', {}, hint) : null), el('div', { class: 'set-ctl' }, control));

  const seg = (key, options, { disabled = false, onPick = null } = {}) =>
    el(
      'div',
      { class: 'seg' + (disabled ? ' off' : '') },
      options.map(([v, label]) =>
        el(
          'button',
          {
            // اللغة على «تلقائي»: نأشّر على اللغة الشغّالة هسه
            class: 'seg-btn' + ((key === 'lang' ? settings.lang || LANG : settings[key]) === v ? ' on' : ''),
            'data-v': String(v),
            disabled: disabled ? '' : null,
            onclick: () => {
              if (disabled) return;
              haptic('select');
              if (onPick) onPick(v);
              else setSetting(key, v);
            },
          },
          /[Ѐ-ӿ]/.test(label) || key === 'lang' ? label : t(label),
        ),
      ),
    );

  // شريط صوت مسوّى باليد: <input type=range> داخل اللعبة المدوّرة يفلت من الإصبع (المتصفح يحسب السحب تمرير)،
  // فهنا السحب كله إلنا (touch-action: none) ونحسب الموقع بعد التدوير.
  const slider = (key) => {
    const pct = () => Math.round(settings[key] * 100);
    const val = el('span', { class: 'slider-val' }, `${pct()}%`);
    const track = el('div', { class: 'vs-track' }, el('i', { class: 'vs-fill' }));
    const bar = el(
      'div',
      { class: 'vslider', role: 'slider', tabindex: '0', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct()), 'data-key': key },
      track,
      el('b', { class: 'vs-thumb' }),
    );
    const paint = (v) => {
      bar.style.setProperty('--p', String(v / 100));
      bar.setAttribute('aria-valuenow', String(v));
      val.textContent = `${v}%`;
    };
    const set = (v, buzz = false) => {
      v = Math.max(0, Math.min(100, Math.round(v)));
      const before = pct();
      paint(v);
      if (v === before) return;
      setSetting(key, v / 100);
      if (buzz && Math.floor(v / 10) !== Math.floor(before / 10)) haptic('select');
    };
    // موقع الإصبع على الشريط (0..100) بفضاء اللعبة نفسه
    const at = (e) => {
      const r = track.getBoundingClientRect();
      const rot = isRotated();
      const p = rot ? toLocalPoint(e.clientX, e.clientY).x : e.clientX;
      const start = rot ? r.top : r.left;
      const len = (rot ? r.height : r.width) || 1;
      return ((p - start) / len) * 100;
    };
    let drag = null;
    bar.addEventListener('pointerdown', (e) => {
      if (drag !== null) return;
      drag = e.pointerId;
      try {
        bar.setPointerCapture(e.pointerId);
      } catch {
        /* */
      }
      bar.classList.add('drag');
      e.preventDefault();
      set(at(e), true);
    });
    bar.addEventListener('pointermove', (e) => {
      if (drag !== e.pointerId) return;
      e.preventDefault();
      set(at(e), true);
    });
    const end = (e) => {
      if (drag === null || (e && e.pointerId !== drag)) return;
      drag = null;
      bar.classList.remove('drag');
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('lostpointercapture', end);
    bar.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[e.key];
      if (!d) return;
      e.preventDefault();
      set(pct() + d);
    });
    paint(pct());
    const step = (d) => {
      set(pct() + d);
      haptic('select');
    };
    return el('div', { class: 'slider-box' }, el('button', { class: 'step-btn', onclick: () => step(-10) }, '−'), bar, el('button', { class: 'step-btn', onclick: () => step(10) }, '+'), val);
  };

  const toggle = (key) =>
    el(
      'button',
      {
        class: 'toggle' + (settings[key] ? ' on' : ''),
        'data-key': key,
        role: 'switch',
        'aria-checked': settings[key] ? 'true' : 'false',
        onclick: () => {
          setSetting(key, !settings[key]);
          haptic('select');
        },
      },
      el('i'),
    );

  const render = () => {
    const micHint = platform === 'ios' ? t('تلقائي = يتسكّر بعد كل تسجيل (الآيفون ما يعيد طلب الإذن)') : t('تلقائي = يبقى مفتوح حتى تيليجرام ما يسألك عن الإذن كل جولة');
    const body = el(
      'div',
      { class: 'set-body' },
      row(
        '🌐',
        t('اللغة'),
        seg('lang', LANGS, {
          disabled: inGame,
          onPick: (v) => {
            if (v === LANG) return;
            setSetting('lang', v);
            // اللغة تنطبق بعد إعادة تحميل (الكلام كله يتبدّل)
            setTimeout(() => location.reload(), 150);
          },
        }),
        inGame ? t('تتغيّر من القائمة الرئيسية') : null,
      ),
      row('🎨', t('جودة الرسوم'), seg('quality', QUALITY), t('واطية = أخف على الجهاز والبطارية')),
      row('🎞️', t('الفريمات (FPS)'), seg('fps', FPS)),
      row('📈', t('عدّاد الفريمات'), toggle('showFps')),
      row('🔊', t('الصوت العام'), slider('volume')),
      row('🔔', t('أصوات الواجهة'), slider('sfx')),
      row('📳', t('الاهتزاز'), toggle('haptics')),
      row('🎤', t('المايك'), seg('mic', MIC), micHint),
      row('🗣️', t('الدردشة الصوتية'), toggle('voice'), t('تسمع ربعك وتحچي وياهم بالغرفة — المايك ينسد لوحده وقت التقليد')),
      row('😀', t('تفاعلات اللاعبين'), toggle('reactions')),
      el(
        'div',
        { class: 'set-foot' },
        el(
          'button',
          {
            class: 'it-btn ghost',
            onclick: () => {
              resetSettings();
              haptic('success');
            },
          },
          t('↺ رجّع الافتراضي'),
        ),
        el('span', { class: 'set-ver' }, `v${VERSION}${stats ? ' · ' + stats : ''}`),
      ),
    );
    const prevBody = sheet.querySelector('.set-body');
    const keep = prevBody ? prevBody.scrollTop : 0;
    const panel = el(
      'div',
      { class: 'panel settings' + (sheet.firstChild ? ' still' : '') },
      el('button', { class: 'xbtn', 'aria-label': t('سكّر'), onclick: () => closeSettings() }, '✕'),
      el('div', { class: 'panel-title' }, t('⚙️ الإعدادات')),
      body,
    );
    sheet.innerHTML = '';
    sheet.appendChild(panel);
    body.scrollTop = keep;
  };

  if (open && open.off) open.off();
  sheet.className = 'show';
  sheet.onclick = (e) => {
    if (e.target === sheet) closeSettings();
  };
  render();
  const off = onSetting((k) => {
    // السلايدر ما نعيد رسمه وقت السحب (حتى ما يفلت من الإصبع)
    if (k === 'volume' || k === 'sfx') return;
    render();
  });
  open = { onClose, off };
}
