// الإقلاع: تيليجرام + المسرح + القائمة الرئيسية.

import { initTelegram, stageSize, onViewportChange, startParam, insideTelegram, unsafeUser, haptic, isRotated, setHaptics } from './tg.js';
import { Stage } from './stage.js';
import { AudioEngine } from './audio.js';
import { Game } from './game.js';
import { api, authBody, localName } from './net.js';
import * as ui from './ui.js';
import { $, el } from './ui.js';
import { REACTIONS, GAME_NAME, VERSION, MAX_PLAYERS, ROUNDS } from './shared.js';
import { Meta } from './meta.js';
import { t, applyLang, LANG } from './i18n.js';
import { settings, onSetting, syncFromCloud } from './settings.js';
import { openSettings, closeSettings, settingsOpen } from './settingsPanel.js';

applyLang();
initTelegram();

const audio = new AudioEngine();
const stage = new Stage($('#stage'));
let config = {};
let profile = null;
let game = null;
let busy = false;
const meta = new Meta({});

// اسم اللعبة بلغة اللاعب
document.title = t(GAME_NAME);
{
  const bl = document.querySelector('.boot-logo');
  if (bl) bl.textContent = t(GAME_NAME) + '!';
}

// إعدادات الرسوم والفريمات والتفاعلات
function applyVisualSettings(key) {
  if (!key || key === 'quality') stage.setQuality(settings.quality);
  if (!key || key === 'fps') stage.setFps(settings.fps);
  if (!key || key === 'showFps') stage.showFps(settings.showFps);
  if (!key || key === 'reactions') document.documentElement.dataset.reactions = settings.reactions ? 'on' : 'off';
  if (!key || key === 'haptics') setHaptics(settings.haptics);
}
applyVisualSettings();
onSetting((k) => applyVisualSettings(k));

function statsLine() {
  const u = profile && profile.user;
  return u && !u.guest ? `ID ${String(u.uid).replace(/^t/, '')}` : '';
}

function openGameSettings() {
  haptic('light');
  openSettings({ inGame: !!game, stats: statsLine() });
}

function layout() {
  const { w, h } = stageSize();
  const root = document.documentElement;
  root.style.setProperty('--u', `${(h / 100).toFixed(3)}px`);
  root.style.setProperty('--sw', `${w}px`);
  root.style.setProperty('--sh', `${h}px`);
  stage.resize(w, h);
}
layout();
onViewportChange(layout);
window.addEventListener('resize', () => setTimeout(layout, 50));

// شريط الغرفة يكدر ينلف لسطرين (لغات كلماتها أطول): النص اللي فوكه يصعد وياه
if (window.ResizeObserver) {
  const bar = $('#lobbyBar');
  new ResizeObserver(() => document.documentElement.style.setProperty('--lobby-h', `${bar.offsetHeight}px`)).observe(bar);
}

// أي لمسة تفتح الصوت (سياسات التشغيل التلقائي)
window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });

// أزرار التفاعل: زر صغير يفتح قائمة الوجوه
const reacts = $('#reacts');
reacts.appendChild(el('button', { class: 'react-toggle', 'aria-label': t('تفاعل'), onclick: () => reacts.classList.toggle('open') }, '😀'));
reacts.appendChild(
  el(
    'div',
    { class: 'react-list' },
    REACTIONS.map((e) =>
      el(
        'button',
        {
          class: 'react-btn',
          onclick: () => {
            if (game) game.sendReaction(e);
            reacts.classList.remove('open');
          },
        },
        e,
      ),
    ),
  ),
);

$('#exitBtn').addEventListener('click', () => game && game.askLeave());
$('#exitBtn').setAttribute('aria-label', t('خروج'));
$('#setBtn').addEventListener('click', () => openGameSettings());
$('#setBtn').setAttribute('aria-label', t('الإعدادات'));
$('#goText').textContent = t('يلا!');

/* ------------------------------------------------------------ القائمة */

function demoStage() {
  // اللاعب بالنص بلبسه ومسرحه
  const lk = meta.look();
  stage.setTheme(lk.stage);
  stage.setPlayers([
    { uid: 'demo1', skin: lk.skin === 2 ? 4 : 2 },
    { uid: 'demo2', skin: lk.skin == null ? 0 : lk.skin, acc: lk.acc },
    { uid: 'demo3', skin: lk.skin === 1 ? 3 : 1 },
  ]);
  let i = 0;
  clearInterval(demoStage.iv);
  demoStage.iv = setInterval(() => {
    if (document.documentElement.dataset.screen !== 'menu') return;
    const ids = ['demo1', 'demo2', 'demo3'];
    const c = stage.char(ids[i % 3]);
    if (c) c.setMood(['sing', 'happy', 'sing', 'shock'][i % 4], 1500);
    i++;
  }, 1700);
}

function showMenu() {
  document.documentElement.dataset.screen = 'menu';
  stage.setShot('menu');
  demoStage();
  const name = (profile && profile.user && profile.user.name) || localName();
  const photo = profile && profile.user && profile.user.photo;
  const chip = meta.chip({ name, photo });
  const p = meta.profile;
  const side = el(
    'div',
    { class: 'menu-side' },
    el('button', { class: 'side-btn', onclick: () => meta.openShop({ onClose: showMenu }) }, el('span', {}, '🛒'), el('small', {}, t('المتجر'))),
    el('button', { class: 'side-btn pass', onclick: () => meta.openPass({ onClose: showMenu }) }, el('span', {}, '🎖️'), el('small', {}, p ? t('باس {n}', { n: p.pass.level }) : t('الباس'))),
    el(
      'button',
      { class: 'side-btn' + (p && meta.ads.rewarded && p.daily.box > 0 ? ' dot' : ''), onclick: () => meta.openShop({ tab: 'mics', onClose: showMenu }) },
      el('span', {}, '🎁'),
      el('small', {}, t('مجاني')),
    ),
  );
  const menu = el(
    'div',
    { class: 'menu' },
    chip,
    side,
    el('div', { class: 'menu-brand' }, el('div', { class: 'logo' }, t(GAME_NAME) + '!'), el('div', { class: 'tagline' }, t('قلّد الأصوات… والذكاء يحكم 🎤'))),
    el(
      'div',
      { class: 'menu-btns' },
      el('button', { class: 'btn pink big', onclick: () => createRoom(false) }, t('🎤 العب ويا ربعك')),
      el('button', { class: 'btn blue', onclick: joinByCode }, t('🔢 ادخل بكود')),
      el('button', { class: 'btn green', onclick: () => createRoom(true) }, t('🎯 تحدّي فردي')),
    ),
    // أزرار صغيرة بالزاوية: المتصدرين، المساعدة، الإعدادات
    el(
      'div',
      { class: 'menu-top' },
      el('button', { class: 'icon-btn top-btn top', 'aria-label': t('🏆 المتصدرين'), onclick: showTop }, '🏆'),
      el('button', { class: 'icon-btn top-btn help', 'aria-label': t('شلون تلعب؟'), onclick: showHelp }, '❓'),
      el('button', { class: 'icon-btn top-btn gear', 'aria-label': t('الإعدادات'), onclick: () => openSettings({ stats: statsLine() }) }, '⚙️'),
    ),
    el('div', { class: 'version' }, `v${VERSION}${insideTelegram ? '' : ' · ' + t('ضيف')}`),
  );
  ui.overlay(menu, 'menu-layer');
}

async function createRoom(solo) {
  if (busy) return;
  busy = true;
  haptic('medium');
  await audio.unlock();
  try {
    const { code } = await api('/api/rooms', authBody());
    enterRoom(code, solo);
  } catch (e) {
    ui.toast(t(e.message || 'صار خطأ'));
  } finally {
    busy = false;
  }
}

function joinByCode() {
  haptic('light');
  ui.overlay(
    ui.keypad(
      async (code) => {
        audio.unlock();
        const info = await api('/api/rooms/' + code);
        if (!info.exists) {
          haptic('error');
          return t('ماكو غرفة بهالكود 🤷 تأكد من الرقم');
        }
        if (info.phase !== 'lobby' && info.phase !== 'final') {
          haptic('error');
          return t('اللعبة بدأت بهاي الغرفة — انتظر تخلص');
        }
        if (info.players >= (info.max || 5)) {
          haptic('error');
          return t('الغرفة مليانة');
        }
        enterRoom(code, false);
        return true;
      },
      () => showMenu(),
    ),
    'panel-layer',
  );
}

async function showTop() {
  haptic('light');
  ui.overlay(el('div', { class: 'panel board' }, el('div', { class: 'panel-title' }, t('🏆 المتصدرين')), el('div', { class: 'hint center' }, t('جاري التحميل…'))), 'panel-layer');
  try {
    const { top } = await api('/api/top');
    ui.overlay(ui.leaderboardPanel(top, profile && profile.user && profile.user.uid, () => showMenu()), 'panel-layer');
  } catch (e) {
    ui.toast(t(e.message));
    showMenu();
  }
}

function showHelp() {
  haptic('light');
  const steps = [
    ['👂', 'اسمع المثال', 'يشتغل صوت للكل بنفس اللحظة'],
    ['🎤', 'قلّده', 'الكل يسجّل سوا بعد العد — فرصة وحدة بس'],
    ['💯', 'الدرجة', 'كل تسجيل ينعاد قدام الكل وياخذ درجة من 100 على اللحن والإيقاع'],
    ['🎡', 'العجلة', 'نقاط للجولة الجاية، مضاعفات، تبديل أصوات، وتخريب على ربعك 😈'],
  ];
  ui.overlay(
    el(
      'div',
      { class: 'panel help' },
      el('button', { class: 'xbtn', onclick: () => showMenu() }, '✕'),
      el('div', { class: 'panel-title' }, t('شلون تلعب؟')),
      el(
        'div',
        { class: 'help-grid' },
        steps.map(([i, title, d]) => el('div', { class: 'help-step' }, el('div', { class: 'help-icon' }, i), el('b', {}, t(title)), el('span', {}, t(d)))),
      ),
      el('div', { class: 'hint center' }, t('لحد {p} لاعبين · {r} جولات · نبرة صوتك ما تفرق — المهم تقلّد اللحن', { p: MAX_PLAYERS, r: ROUNDS })),
    ),
    'panel-layer',
  );
}

function enterRoom(code, solo) {
  if (game) game.leave(true);
  stage.setPlayers([]);
  game = new Game({
    stage,
    audio,
    config,
    meta,
    onExit: (silent) => {
      game = null;
      refreshProfile().then(() => {
        if (document.documentElement.dataset.screen === 'menu' && !meta.panel) showMenu();
      });
      showMenu();
      if (!silent) haptic('light');
    },
  });
  if (solo) {
    const orig = game.apply.bind(game);
    let started = false;
    game.apply = (st) => {
      orig(st);
      if (!started && st.phase === 'lobby' && st.host === game.me) {
        started = true;
        game.start();
      }
    };
  }
  game.enter(code);
}

async function refreshProfile() {
  try {
    profile = await api('/api/me', authBody());
    if (profile && profile.profile) meta.set(profile.profile);
  } catch {
    /* */
  }
}

/* ------------------------------------------------------------ الإقلاع */

async function boot() {
  // جهاز جديد؟ ناخذ إعدادات اللاعب من حسابه بتيليجرام (وإذا لغته غير، نعيد التحميل)
  syncFromCloud().then((langChanged) => {
    if (langChanged && LANG !== settings.lang && settings.lang) location.reload();
  });
  try {
    [config, profile] = await Promise.all([api('/api/config').catch(() => ({})), api('/api/me', authBody()).catch((e) => ({ error: e.message }))]);
  } catch {
    /* */
  }
  meta.setConfig(config);
  if (profile && profile.profile) meta.set(profile.profile);
  $('#boot').classList.add('hide');
  setTimeout(() => $('#boot').remove(), 600);
  if (profile && profile.error) {
    ui.overlay(
      el('div', { class: 'panel' }, el('div', { class: 'panel-title' }, '😕'), el('div', { class: 'hint center' }, t(profile.error))),
      'panel-layer',
    );
    return;
  }
  const sp = startParam();
  const m = /^r(\d{5})$/.exec(sp || '');
  if (m) enterRoom(m[1], false);
  else showMenu();
}

boot();

// للتشخيص من DevTools
window.__qd = { stage, audio, meta, get game() { return game; }, isRotated, unsafeUser };
